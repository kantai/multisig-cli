IMAGE := "hirosystems/multisig-cli"
TAG   := "latest"

build:
	DOCKER_BUILDKIT=1 docker build -t {{IMAGE}}:{{TAG}} .

run *args:
	#!/usr/bin/env bash
	set -euxo pipefail
	docker run \
		--rm -it \
		--privileged \
		--env APP_USER="$(id -un)" \
		--env APP_UID="$(id -u)" \
		--env APP_GROUP="$(id -gn)" \
		--env APP_GID="$(id -g)" \
		--env APP_DIR=/mnt \
		--mount src="$(pwd)",target=/mnt,type=bind \
		{{IMAGE}}:{{TAG}} {{args}}

lint:
	docker run --rm -i hadolint/hadolint < Dockerfile
