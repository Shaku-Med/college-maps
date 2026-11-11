#!/usr/bin/env bash
# Root only wrapper so the deploy account can run a few compose actions on /opt/csimap
# without reading the env files or joining the docker group, which is root in all but name.
#
# Install:  sudo install -m 0750 -o root -g root csimap-compose.sh /usr/local/sbin/csimap-compose.sh
# Sudoers:  csideploy ALL=(root) NOPASSWD: /usr/local/sbin/csimap-compose.sh
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "csimap-compose: must run as root" >&2
  exit 1
fi

ACTION="${1:-}"
shift || true
cd /opt/csimap

case "$ACTION" in
  pull)
    exec docker compose pull --quiet
    ;;
  up)
    # Waits for every healthcheck, so a container that will not start turns the deploy red.
    exec docker compose up -d --remove-orphans --wait --wait-timeout 120
    ;;
  ps)
    exec docker compose ps
    ;;
  logs)
    exec docker compose logs --tail=200 --no-color
    ;;
  prune)
    exec docker image prune -af --filter "label=org.opencontainers.image.source=https://github.com/Shaku-Med/college-maps" --filter "until=72h"
    ;;
  login)
    user="${1:-}"
    if [[ ! "$user" =~ ^[A-Za-z0-9-]{1,39}$ ]]; then
      echo "csimap-compose: login needs a GitHub user name" >&2
      exit 2
    fi
    # The token comes on stdin only, never as an argument that shows up in ps.
    token="$(cat)"
    if [[ -z "$token" ]]; then
      echo "csimap-compose: login token missing on stdin" >&2
      exit 2
    fi
    printf '%s' "$token" | docker login ghcr.io -u "$user" --password-stdin
    ;;
  logout)
    exec docker logout ghcr.io
    ;;
  *)
    echo "csimap-compose: allowed actions are pull, up, ps, logs, prune, login, logout" >&2
    exit 2
    ;;
esac
