#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_dir"
tf_root=${TF_ROOT:-$repo_dir/infra}
runtime_env=${RUNTIME_ENV_FILE:-$repo_dir/out/runtime.env}

compose() { docker compose "$@"; }
tf() { compose run --rm --no-deps -T terraform "$@"; }
start_floci() { compose up -d --wait --wait-timeout 90 floci; }
init() { tf init -input=false -lockfile=readonly; }

prepare_out() {
  mkdir -p out
  if [[ $(id -u) == 0 ]]; then
    chown "${HOST_UID}:${HOST_GID}" out
    chmod u+rwx out
  fi
}

outputs() {
  prepare_out
  local bucket queue
  bucket=$(tf output -raw bucket_name)
  queue=$(tf output -raw queue_url)
  printf 'S3_BUCKET=%s\nSQS_QUEUE_URL=%s\n' "$bucket" "$queue" > "$runtime_env"
}

require_worker() {
  if [[ $(compose ps --status running --services worker) != worker ]]; then
    echo 'Worker is not running; use make provision and make deploy first.' >&2
    exit 1
  fi
}

case "${1:-}" in
  provision)
    start_floci
    init
    tf validate
    tf apply -input=false -auto-approve
    outputs
    ;;
  deploy)
    outputs
    compose up -d --wait --wait-timeout 90 worker
    ;;
  run|verify)
    require_worker
    if [[ $1 == run ]]; then command_file=run-task.js; else command_file=verify-cloud.js; fi
    compose run --rm --no-deps -T worker node "src/$command_file"
    ;;
  plan)
    start_floci
    init
    tf plan -input=false
    ;;
  fmt)
    tf fmt
    ;;
  lock)
    tf init -input=false -upgrade
    tf providers lock -platform=linux_amd64 -platform=linux_arm64
    ;;
  destroy)
    compose stop worker
    if [[ -f $tf_root/terraform.tfstate ]]; then
      # Floci must remain available until Terraform has deleted its resources.
      start_floci
      init
      tf destroy -input=false -auto-approve
    fi
    compose down --volumes --remove-orphans
    rm -f "$runtime_env"
    ;;
  ci)
    prepare_out
    ci_dir=$(mktemp -d "$repo_dir/out/ci.XXXXXX")
    mkdir "$ci_dir/infra"
    cp "$tf_root/"*.tf "$tf_root/.terraform.lock.hcl" "$ci_dir/infra/"
    if [[ $(id -u) == 0 ]]; then chown -R "${HOST_UID}:${HOST_GID}" "$ci_dir"; fi
    export TF_ROOT="$ci_dir/infra"
    export RUNTIME_ENV_FILE="$ci_dir/runtime.env"
    export COMPOSE_PROJECT_NAME="job-flow-ci-$$"
    export FLOCI_PORT=0
    trap 'status=$?; trap - EXIT; if ! compose down --volumes --remove-orphans; then status=1; fi; rm -rf -- "$ci_dir"; exit "$status"' EXIT
    tf fmt -check -diff
    init
    tf validate
    start_floci
    # A clean environment should propose two resources. Plan does not apply them.
    tf plan -input=false
    ;;
  *)
    echo "Unknown infrastructure command: ${1:-}" >&2
    exit 1
    ;;
esac
