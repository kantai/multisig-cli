IMAGE     := "hirosystems/multisig-cli"
TAG       := "latest"
PLATFORMS := "linux/amd64,linux/arm64/v8"

build:
	DOCKER_BUILDKIT=1 docker build -t {{IMAGE}}:{{TAG}} .

buildx-setup:
	docker buildx create --name cross-builder --platform {{PLATFORMS}}
	docker buildx use cross-builder
	docker buildx inspect --bootstrap

buildx-push:
	docker buildx build --push --platform {{PLATFORMS}} -t {{IMAGE}}:{{TAG}} .

run *args:
	#!/usr/bin/env bash
	set -euxo pipefail
	docker run \
		--rm -i \
		--privileged \
		--env APP_USER="$(id -un)" \
		--env APP_UID="$(id -u)" \
		--env APP_GROUP="$(id -gn)" \
		--env APP_GID="$(id -g)" \
		--env APP_DIR=/mnt \
		--mount src="$(pwd)",target=/mnt,type=bind \
		--mount src=/dev,target=/dev,type=bind \
		{{IMAGE}}:{{TAG}} {{args}}

lint:
	docker run --rm -i hadolint/hadolint < Dockerfile
