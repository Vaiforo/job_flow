# Job Flow

Job Flow collects source data for a future job aggregator. The current source is
[Quotes to Scrape](https://quotes.toscrape.com/scroll). The browser worker collects
quotes with their text, author and tags. Job-site integrations are not implemented yet.

## Server architecture

```text
Make -> Multipass -> Ubuntu 24.04 -> Ansible -> Docker Compose
                                               Redis Streams -> scraper
                                                                  |
                                                               results -> Nginx
```

One VM has 2 CPUs, 4 GB RAM and a 20 GB disk. Redis stores tasks in stream `jobs`,
consumer group `scrapers`. The worker saves JSON in
`/srv/quotes-scraper/results/<job_id>.json`. Nginx serves it at
`http://<VM_IP>/results/<job_id>.json`.

Only Nginx publishes a container port (80). Redis has no published port and keeps
its data in a Docker volume with AOF enabled. Nginx mounts results read-only.
SSH on the VM is used by Ansible for administration.

## Host requirements

Use Linux, macOS, or WSL2 on Windows. Install Git, GNU Make, Python 3.12 with venv,
OpenSSH tools and Multipass with a working virtualization backend. Have enough
free memory and disk space for the VM. On Windows, install Multipass on Windows
and allow WSL to run `multipass.exe`. The VM's SSH and HTTP addresses must be
reachable from the control node. No CPU architecture is fixed in the configuration.

For configuration checks, install Docker CLI with the Compose plugin. The
`docker compose config` check does not need a running local Docker daemon.
Docker Engine for the application is installed on the VM by Ansible.

On Windows, open an Ubuntu WSL2 terminal and clone the project into its Linux
filesystem, for example `~/projects/job_flow`. Run Linux Make, Bash and Python
there. Windows Make, PowerShell and Git Bash are not supported control nodes.
Multipass stays installed on Windows; the script calls `multipass.exe` from WSL.
The repository enforces LF line endings through `.gitattributes`.

If a previous Windows checkout reports `CreateProcess ... id -u` or an invalid
`pipefail` option, use a fresh clone inside WSL rather than running that checkout
with Windows tools. Do not copy a Windows `.venv` into WSL; `make setup` creates
the Linux environment.

Initial setup needs access to PyPI, official Ansible collection GitHub repositories,
Ubuntu images and packages, download.docker.com, Docker Hub, npm and Playwright's
browser download servers. The worker needs access to the source website.

## Start the server

Run commands from the repository root:

```sh
make setup
make provision
make deploy
make run URL=https://quotes.toscrape.com/scroll
make verify
```

- `setup` creates `.venv`, installs pinned Python tools and both collections from
  `infra/ansible/requirements.yml`. Collection dependencies are explicitly listed.
- `provision` also runs setup, creates the VM if missing, waits for cloud-init,
  generates inventory and configures the server. The first run deploys the app too.
- `deploy` updates only the app on an existing server. It builds the image when
  build inputs change and applies Compose configuration through Ansible.
- `run` submits exactly one task with a new `job_id` and the given `url`. It saves
  task details in `.lab/last-job.json`. Each invocation submits a new job.
- `verify` waits with bounded retries for that job's valid JSON, no temporary file
  and an empty pending list. It checks HTTP from the control node and compares the
  response checksum with the saved file. It submits no additional task.

Repeat `make provision` and `make deploy` without editing inputs: Ansible should
report `changed=0`, `failed=0`, `unreachable=0`.

Cloud-init prepares only the temporary `ubuntu` account, SSH key, sudo and Python.
Ansible creates `admin` and tests a fresh key-based SSH connection and sudo before
closing temporary access. Root login, password and keyboard-interactive login are
disabled. SSH configuration is validated before reload. Host key checking stays
on: the initial host key is obtained through the local Multipass management channel
and saved in `.lab/known_hosts`. Admin is not in the Docker group; Ansible uses sudo.
After hardening, use the admin connection rather than Multipass guest execution.

## Job recovery

The worker receives one job at a time with `XREADGROUP`. Unacknowledged messages
remain in Redis's pending entries list. `XAUTOCLAIM` reassigns messages idle for
150 seconds after a crash. New messages and pending messages are both handled.
The browser task has a 120-second timer. Ordinary shutdown allows a current task
to finish; Docker grants 130 seconds before forcing termination.

Results are validated, written to `.<job_id>.tmp` in the results directory and
renamed atomically to `<job_id>.json`. `XACK` runs last. A repeated job ID reuses an
existing valid result without changing it. Invalid existing results produce an
error and remain pending rather than being silently acknowledged.

```sh
make fault-test
```

This creates a job, pauses the worker after rename and before acknowledgment,
kills it with SIGKILL and checks that the message remains pending. After restart,
the worker claims and acknowledges it. The same job ID is then delivered again.
The result checksum and inode must be unchanged. Pause files live in a separate
control directory that Nginx cannot access. The scenario removes its control flags
even when a check fails. Allow several minutes for the pending recovery interval.

XACK removes a pending entry, not the stream record. An empty XPENDING therefore
does not imply an empty stream. AOF uses `appendfsync everysec`; this setup tests
worker crashes and does not promise zero data loss after a host power failure.

## Checks and removal

```sh
make ci
make destroy
make destroy
```

`ci` installs collections, checks YAML, runs ansible-lint and syntax checks with
`hosts.example.yml`, and validates Compose. It creates no VM. SSH changes,
idempotence and the crash scenario must also be checked on a host with Multipass.

`destroy` deletes only the `job-flow` VM and `.lab/`, including its local keys,
inventory and logs. All VM results and Redis data are lost. Repeated removal is
successful. Run `make provision` to create a new server afterwards.

Do not commit `.lab/`, `.venv/`, private keys, generated inventory, results or state.
Tracked files contain configuration and public examples only.

## Other execution modes

The existing Floci SQS/S3 mode remains available:

```sh
make cloud-provision
make cloud-deploy
make cloud-run
make cloud-verify
make cloud-ci
make cloud-destroy
```

Terraform state stays in `infra/terraform.tfstate` and is excluded from Git.
`infra/.terraform.lock.hcl` is tracked. Local Floci uses port 4566.

To collect directly into `out/result.json` without a queue:

```sh
make build
make run-local
make verify-local
```

The Docker image has two stages: npm dependencies and the browser/application.
`make ci-local` checks this local mode and cleans its image and `out/` afterwards.
