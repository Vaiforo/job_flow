#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export ANSIBLE_LOCAL_TEMP="$PWD/.venv/ansible-tmp"
export XDG_CACHE_HOME="$PWD/.venv/cache"
export PATH="$PWD/.venv/bin:$PATH"
export ANSIBLE_CONFIG="$PWD/infra/ansible/ansible.cfg"
yamllint .
ansible-lint --offline infra/ansible/playbooks/*.yml
for playbook in infra/ansible/playbooks/*.yml; do
  ansible-playbook -i infra/ansible/inventories/hosts.example.yml --syntax-check "$playbook"
done
docker compose -f deploy/compose.yaml config --quiet
