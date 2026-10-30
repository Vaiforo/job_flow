SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := build

IMAGE ?= job-flow:latest
OUT_DIR := $(CURDIR)/out
HOST_UID := $(if $(SUDO_UID),$(SUDO_UID),$(shell id -u))
HOST_GID := $(if $(SUDO_GID),$(SUDO_GID),$(shell id -g))
HOST_USER := $(HOST_UID):$(HOST_GID)
RUN_FLAGS := --rm --init --shm-size=1g --user "$(HOST_USER)" --env HOME=/tmp

.PHONY: build run clean ci

build:
	docker build --progress=plain --tag "$(IMAGE)" .

run:
	mkdir -p "$(OUT_DIR)"
	@if [ "$$(id -u)" = 0 ]; then \
	  chown "$(HOST_USER)" "$(OUT_DIR)"; \
	  chmod u+rwx "$(OUT_DIR)"; \
	fi
	docker run $(RUN_FLAGS) --mount 'type=bind,src=$(OUT_DIR),dst=/app/out' "$(IMAGE)"

clean:
	@docker info >/dev/null
	@if docker image inspect "$(IMAGE)" >/dev/null 2>&1; then \
	  docker image rm "$(IMAGE)"; \
	fi
	rm -rf "$(OUT_DIR)"

ci:
	@trap '$(MAKE) clean' EXIT; \
	  $(MAKE) build; \
	  $(MAKE) run; \
	  docker run $(RUN_FLAGS) --mount 'type=bind,src=$(OUT_DIR),dst=/app/out,readonly' \
	    --entrypoint node "$(IMAGE)" src/verify.js
