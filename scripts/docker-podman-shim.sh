#!/bin/bash
# Docker-to-podman compat shim — lets tools that shell out to `docker`
# (e.g. pakstr) drive podman instead.
#
# Install on a podman-only machine (e.g. <build-server>):
#   mkdir -p ~/bin && cp scripts/docker-podman-shim.sh ~/bin/docker && chmod +x ~/bin/docker
# (~/.local/bin or ~/bin must be on PATH.)
#
# pakstr passes `--tmpfs /signing:mode=0700,uid=0` for its in-memory signing
# keystore. Docker accepts `uid=`/`gid=` tmpfs options; podman rejects them
# ("unknown mount option"). uid=0/gid=0 are already the default inside the
# container, so stripping those options is semantically identical.

args=()
tmpfs_next=0
for arg in "$@"; do
  if [ "$tmpfs_next" = "1" ]; then
    arg="${arg//,uid=0/}"
    arg="${arg//,gid=0/}"
    tmpfs_next=0
  fi
  [ "$arg" = "--tmpfs" ] && tmpfs_next=1
  args+=("$arg")
done
exec podman "${args[@]}"
