#!/usr/bin/env bash
# Builds a flashable nudge-os-*.img.xz with pi-gen (needs Docker; takes ~1 hour).
#   NUDGE_ADMIN_PASS=…  password for the "admin" SSH user (random if unset; printed at the end)
#   NUDGE_SSH_PUBKEY=…  optional SSH public key (then password login is switched off)
#   NUDGE_PIGEN_BRANCH  pi-gen branch (default arm64 = latest 64-bit Raspberry Pi OS)
# Output: pi-os/deploy/
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK="$ROOT/pi-os/build"
BUNDLE="$ROOT/pi-os/deploy/nudge-pi.tar.gz"

[ -f "$BUNDLE" ] || (cd "$ROOT" && npm run bundle:pi)
mkdir -p "$WORK" "$ROOT/pi-os/deploy"
[ -d "$WORK/pi-gen" ] || git clone --depth 1 --branch "${NUDGE_PIGEN_BRANCH:-arm64}" https://github.com/RPi-Distro/pi-gen.git "$WORK/pi-gen"

PASS=${NUDGE_ADMIN_PASS:-$(head -c 12 /dev/urandom | base64 | tr -d '/+=' | head -c 14)}
cp "$HERE/config" "$WORK/pi-gen/config"
{
  echo "FIRST_USER_PASS='$PASS'"
  if [ -n "${NUDGE_SSH_PUBKEY:-}" ]; then
    echo "PUBKEY_SSH_FIRST_USER='$NUDGE_SSH_PUBKEY'"
    echo "PUBKEY_ONLY_SSH=1"
  fi
} >> "$WORK/pi-gen/config"

rm -rf "$WORK/pi-gen/stage-nudge"
cp -a "$HERE/stage-nudge" "$WORK/pi-gen/stage-nudge"
mkdir -p "$WORK/pi-gen/stage-nudge/files"
cp "$BUNDLE" "$WORK/pi-gen/stage-nudge/files/nudge-pi.tar.gz"
# Lite image only: skip the desktop stages' exports.
touch "$WORK/pi-gen/stage2/SKIP_IMAGES" 2>/dev/null || true
for s in stage3 stage4 stage5; do touch "$WORK/pi-gen/$s/SKIP" "$WORK/pi-gen/$s/SKIP_IMAGES" 2>/dev/null || true; done

(cd "$WORK/pi-gen" && ./build-docker.sh)
cp "$WORK"/pi-gen/deploy/*.img.xz "$ROOT/pi-os/deploy/"
if [ -z "${NUDGE_ADMIN_PASS:-}" ]; then
  echo "$PASS" > "$ROOT/pi-os/deploy/admin-password.txt"; chmod 600 "$ROOT/pi-os/deploy/admin-password.txt"
fi
echo
echo "Image: $(ls "$ROOT"/pi-os/deploy/*.img.xz)"
[ -z "${NUDGE_ADMIN_PASS:-}" ] && echo "SSH user: admin   password: in pi-os/deploy/admin-password.txt"
