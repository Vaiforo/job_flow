SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := build

export IMAGE ?= job-flow:latest
OUT_DIR := $(CURDIR)/out
export HOST_UID := $(if $(SUDO_UID),$(SUDO_UID),$(shell id -u))
export HOST_GID := $(if $(SUDO_GID),$(SUDO_GID),$(shell id -g))
HOST_USER := $(HOST_UID):$(HOST_GID)
RUN_FLAGS := --rm --init --shm-size=1g --user "$(HOST_USER)" --env HOME=/tmp

.PHONY: build provision deploy run verify plan fmt lock logs clean destroy ci run-local verify-local ci-local

build:
	docker build --progress=plain --tag "$(IMAGE)" .

provision deploy run verify plan fmt lock destroy ci:
	bash scripts/infra.sh $@

deploy: build

logs:
	docker compose logs --tail=100 worker

run-local:
	mkdir -p "$(OUT_DIR)"
	@if [ "$$(id -u)" = 0 ]; then \
	  chown "$(HOST_USER)" "$(OUT_DIR)"; \
	  chmod u+rwx "$(OUT_DIR)"; \
	fi
	docker run $(RUN_FLAGS) --mount 'type=bind,src=$(OUT_DIR),dst=/app/out' "$(IMAGE)"

clean:
	docker compose rm --stop --force worker
	@if docker image inspect "$(IMAGE)" >/dev/null 2>&1; then \
	  docker image rm "$(IMAGE)"; \
	fi
	rm -rf "$(OUT_DIR)"

verify-local:
	docker run $(RUN_FLAGS) --mount 'type=bind,src=$(OUT_DIR),dst=/app/out,readonly' \
	  --entrypoint node "$(IMAGE)" src/verify.js

ci-local:
	@trap '$(MAKE) clean' EXIT; \
	  $(MAKE) build; \
	  $(MAKE) run-local; \
	  $(MAKE) verify-local
