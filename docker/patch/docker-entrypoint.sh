#!/bin/bash

# Exit on failure
set -e

# Use Docker ENV variables if available
user="${APP_USER:-"user"}"
uid="${APP_UID:-"1000"}"
group="${APP_GROUP:-"user"}"
gid="${APP_GID:-"1000"}"
dir="${APP_DIR:-"/home/$user"}"

# Make new user and group
groupadd -f -g "$gid" "$group"
id "$uid" &> /dev/null || useradd -u "$uid" -g "$gid" -m "$user"

# Start here
cd "$dir"

# Run `cmd` as new user
gosu "$uid:$gid" ts-node /app/src/index.ts "$@"
