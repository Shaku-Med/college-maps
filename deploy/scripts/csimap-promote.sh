#!/usr/bin/env bash
# Root only, run by the deploy user through sudo with no arguments.
# Moves what CI staged in the deploy user's ~/csimap-staging into /opt/csimap as root 0600, then wipes staging.
#
# Install:  sudo install -m 0750 -o root -g root csimap-promote.sh /usr/local/sbin/csimap-promote.sh
# Sudoers:  csideploy ALL=(root) NOPASSWD: /usr/local/sbin/csimap-promote.sh
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "csimap-promote: must run as root" >&2
  exit 1
fi

DEPLOY_DIR=/opt/csimap
FILES=(.env api.env realtime.env compose.yaml)
DEPLOY_USER="${SUDO_USER:-}"

if [[ -z "$DEPLOY_USER" ]] || ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "csimap-promote: run this through sudo from the deploy account" >&2
  exit 1
fi
STAGING="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)/csimap-staging"

# Copy without following links into a root only folder first, then check the copies,
# so a staged file swapped for a link to /etc/shadow mid run is caught, not read.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for name in "${FILES[@]}"; do
  cp -P --no-preserve=all "$STAGING/$name" "$work/$name" 2>/dev/null || true
  if [[ -L "$work/$name" || ! -f "$work/$name" ]] || (( $(stat -c %s "$work/$name") > 65536 )); then
    echo "csimap-promote: $name is missing, a link, or too big" >&2
    exit 2
  fi
done

# The deploy account may only choose which commit runs, never which registry or image.
owner_repo='ghcr\.io/shaku-med/college-maps'
if [[ "$(grep -c . "$work/.env")" != 3 ]] \
  || ! grep -Eq "^API_IMAGE=${owner_repo}/api:[0-9a-f]{40}$" "$work/.env" \
  || ! grep -Eq "^REALTIME_IMAGE=${owner_repo}/realtime:[0-9a-f]{40}$" "$work/.env" \
  || ! grep -Eq "^WEB_IMAGE=${owner_repo}/web:[0-9a-f]{40}$" "$work/.env"; then
  echo "csimap-promote: .env must hold exactly the three pinned image lines" >&2
  exit 2
fi

install -d -m 0750 -o root -g root "$DEPLOY_DIR"
for name in "${FILES[@]}"; do
  install -m 0600 -o root -g root "$work/$name" "$DEPLOY_DIR/$name"
done

rm -f "$STAGING/.env" "$STAGING/api.env" "$STAGING/realtime.env" "$STAGING/compose.yaml"
rmdir --ignore-fail-on-non-empty "$STAGING" 2>/dev/null || true
echo "csimap-promote: locked $DEPLOY_DIR"
