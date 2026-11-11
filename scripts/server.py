"""Local VM lifecycle. All guest configuration is performed by Ansible."""
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / '.lab'
NAME = 'job-flow'


def run(arguments, **options):
    return subprocess.run(arguments, check=True, text=True, **options)


def multipass(*arguments, **options):
    binary = shutil.which('multipass') or shutil.which('multipass.exe')
    if not binary:
        raise RuntimeError('Install Multipass on the host; on Windows enable WSL interoperability')
    return run([binary, *arguments], **options)


def playbook(name, extra=None):
    environment = os.environ.copy()
    environment['ANSIBLE_LOCAL_TEMP'] = str(ROOT / '.venv/ansible-tmp')
    environment['ANSIBLE_CONFIG'] = str(ROOT / 'infra/ansible/ansible.cfg')
    arguments = [str(ROOT / '.venv/bin/ansible-playbook'),
                 '-i', str(STATE / 'hosts.yml'),
                 str(ROOT / 'infra/ansible/playbooks' / f'{name}.yml')]
    if extra:
        arguments += ['--extra-vars', json.dumps(extra)]
    run(arguments, cwd=ROOT / 'infra/ansible', env=environment)


def provision():
    STATE.mkdir(mode=0o700, exist_ok=True)
    for key in ['bootstrap', 'admin']:
        if not (STATE / key).exists():
            run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(STATE / key)])
    machines = json.loads(multipass('list', '--format', 'json', capture_output=True).stdout)['list']
    machine = next((item for item in machines if item['name'] == NAME), None)
    fresh = machine is None
    if fresh:
        cloud_init = (ROOT / 'infra/cloud-init.yaml').read_text()
        cloud_init = cloud_init.replace('BOOTSTRAP_PUBLIC_KEY', json.dumps((STATE / 'bootstrap.pub').read_text().strip()))
        multipass('launch', '24.04', '--name', NAME, '--cpus', '2', '--memory', '4G', '--disk', '20G',
                  '--cloud-init', '-', input=cloud_init)
    elif machine['state'] == 'Stopped':
        multipass('start', NAME)
    elif machine['state'] != 'Running':
        raise RuntimeError(f'VM is in state {machine["state"]}; inspect Multipass before retrying')
    inventory_path = STATE / 'hosts.yml'
    if fresh or not inventory_path.exists():
        # These are read-only bootstrap operations over the local hypervisor channel.
        multipass('exec', NAME, '--', 'cloud-init', 'status', '--wait')
        info = json.loads(multipass('info', NAME, '--format', 'json', capture_output=True).stdout)
        address = info['info'][NAME]['ipv4'][0]
        host_key = multipass('exec', NAME, '--', 'sudo', 'cat', '/etc/ssh/ssh_host_ed25519_key.pub', capture_output=True).stdout.strip()
        (STATE / 'known_hosts').write_text(f'{address} {host_key}\n')
        inventory = {'all': {'hosts': {'job_flow': {'ansible_host': address, 'ansible_user': 'ubuntu',
                     'ansible_ssh_private_key_file': str(STATE / 'bootstrap')}}, 'vars': {
                     'project_root': str(ROOT), 'admin_key_file': str(STATE / 'admin'),
                     'admin_public_key': (STATE / 'admin.pub').read_text().strip(),
                     'ansible_python_interpreter': '/usr/bin/python3',
                     'ansible_ssh_common_args': f'-o StrictHostKeyChecking=yes -o UserKnownHostsFile={shlex.quote(str(STATE / "known_hosts"))}' }}}
        inventory_path.write_text(json.dumps(inventory, indent=2))
    # DHCP may assign a new address after the same VM is restarted.
    info = json.loads(multipass('info', NAME, '--format', 'json', capture_output=True).stdout)
    address = info['info'][NAME]['ipv4'][0]
    inventory = json.loads(inventory_path.read_text())
    if inventory['all']['hosts']['job_flow']['ansible_host'] != address:
        key = (STATE / 'known_hosts').read_text().split(' ', 1)[1]
        (STATE / 'known_hosts').write_text(f'{address} {key}')
        inventory['all']['hosts']['job_flow']['ansible_host'] = address
        inventory_path.write_text(json.dumps(inventory, indent=2))
    # Persist the switch as soon as the admin connection works, before the full deployment.
    playbook('bootstrap')
    inventory = json.loads(inventory_path.read_text())
    host = inventory['all']['hosts']['job_flow']
    host['ansible_user'] = 'admin'
    host['ansible_ssh_private_key_file'] = str(STATE / 'admin')
    inventory_path.write_text(json.dumps(inventory, indent=2))
    playbook('site')


def destroy():
    machines = json.loads(multipass('list', '--format', 'json', capture_output=True).stdout)['list']
    if any(item['name'] == NAME for item in machines):
        multipass('delete', '--purge', NAME)
    shutil.rmtree(STATE, ignore_errors=True)


try:
    action = sys.argv[1]
    if action == 'provision':
        provision()
    elif action == 'destroy':
        destroy()
    elif action == 'run':
        playbook('run', {'job_url': os.environ.get('URL', 'https://quotes.toscrape.com/scroll')})
    else:
        playbook(action)
except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
    print(f'Job Flow: {error}', file=sys.stderr)
    sys.exit(1)
