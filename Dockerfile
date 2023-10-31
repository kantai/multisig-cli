# syntax=docker/dockerfile:1.3-labs
# vim:syntax=dockerfile

FROM node:20-bookworm

# Install system dependencies
RUN /bin/bash <<EOF
	apt-get update
	apt-get install -y --no-install-recommends \
		build-essential \
		gosu \
		libudev-dev \
		libusb-1.0-0-dev
	npm install -g ts-node
EOF

# Install app
WORKDIR /app
COPY . .

RUN /bin/bash <<EOF
	npm ci --omit-dev
EOF

COPY docker/patch /
ENTRYPOINT [ "/docker-entrypoint.sh" ]
CMD [ "--help" ]
