#!/usr/bin/env bash
# Turns Raspberry Pi OS Lite (64-bit, Bookworm or newer) into a Nudge ND-1.
#
#   sudo ./install.sh                 full install (run from an unpacked nudge-pi bundle)
#   sudo ./install.sh --update        just replace the Nudge software, keep everything else
#   sudo ./install.sh --image         used by the pi-gen image build (inside a chroot)
#
# Options:
#   --no-models        skip the on-device AI models (speech-to-text ~45 MB, smart search ~23 MB)
#   --screen WxH       force an HDMI mode, e.g. --screen 1024x600 (only if the screen stays black)
#   --lan-only-ssh     keep SSH reachable from the home network (default: yes; tailnet always)
#   --no-tailscale     skip Tailscale (phones then only work on the home Wi-Fi)
#   --hostname NAME    default: nudge
#
# Safe to run again: every step checks before it changes anything.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
MODE=full MODELS=1 SCREEN="" TAILSCALE=1 HOST=nudge
while [ $# -gt 0 ]; do
  case "$1" in
    --update) MODE=update ;;
    --image) MODE=image ;;
    --no-models) MODELS=0 ;;
    --voice) ;; # old flag: speech is now part of the normal install
    --screen) SCREEN="$2"; shift ;;
    --no-tailscale) TAILSCALE=0 ;;
    --hostname) HOST="$2"; shift ;;
    --lan-only-ssh) ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
  shift
done

say() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "run with sudo"
[ -f "$HERE/hub/hub.mjs" ] || die "no hub/hub.mjs next to install.sh — run this from an unpacked nudge-pi bundle (npm run bundle:pi)"

ARCH=$(uname -m)
[ "$MODE" = image ] && ARCH=$(dpkg --print-architecture)
case "$ARCH" in
  aarch64|arm64) NODE_ARCH=arm64 ;;
  armv7l|armhf) NODE_ARCH=armv7l; warn "32-bit OS: works, but the 64-bit OS is faster and better supported" ;;
  x86_64|amd64) NODE_ARCH=x64; warn "not a Pi — fine for testing, hardware bits will switch themselves off" ;;
  *) die "unsupported CPU $ARCH" ;;
esac

[ -d "$HERE/hub/node_modules/onnxruntime-node/bin/napi-v6/linux/$NODE_ARCH" ] \
  || warn "this bundle's on-device AI is built for another CPU — speech-to-text and smart search stay off (everything else works)"

BOOT=/boot/firmware; [ -d "$BOOT" ] || BOOT=/boot
. /etc/os-release
CODENAME=${VERSION_CODENAME:-bookworm}
NODE_MAJOR=22

# ───────────────────────────── system packages ─────────────────────────────
install_packages() {
  say "Installing system packages (this is the slow bit)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    ca-certificates curl xz-utils bzip2 gnupg cage \
    python3 python3-venv python3-pip python3-dev python3-websockets python3-evdev \
    gcc libc6-dev ufw unattended-upgrades alsa-utils util-linux
  # Nice-to-haves (some only exist in the Raspberry Pi repo): skip any that aren't there.
  for pkg in seatd fonts-noto-color-emoji python3-gpiozero python3-lgpio zram-tools rfkill; do
    apt-get install -y -qq --no-install-recommends "$pkg" >/dev/null 2>&1 || warn "optional package $pkg not available"
  done
  apt-get install -y -qq --no-install-recommends chromium 2>/dev/null \
    || apt-get install -y -qq --no-install-recommends chromium-browser \
    || die "couldn't install Chromium"
  # Needed by the headless school reader.
  apt-get install -y -qq --no-install-recommends libnss3 libatk-bridge2.0-0 libgbm1 libxkbcommon0 libasound2 2>/dev/null \
    || apt-get install -y -qq --no-install-recommends libnss3 libatk-bridge2.0-0t64 libgbm1 libxkbcommon0 libasound2t64 || true
}

install_tailscale() {
  [ "$TAILSCALE" = 1 ] || return 0
  command -v tailscale >/dev/null && return 0
  say "Installing Tailscale (signed apt repo)"
  curl -fsSL "https://pkgs.tailscale.com/stable/debian/$CODENAME.noarmor.gpg" -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL "https://pkgs.tailscale.com/stable/debian/$CODENAME.tailscale-keyring.list" -o /etc/apt/sources.list.d/tailscale.list
  apt-get update -qq && apt-get install -y -qq tailscale
  systemctl enable tailscaled >/dev/null 2>&1 || true
}

# ───────────────────────────── Node.js (checksum-verified) ─────────────────────────────
install_node() {
  if [ -x /opt/nudge/node/bin/node ]; then
    local v; v=$(/opt/nudge/node/bin/node -p 'process.versions.node' 2>/dev/null || echo 0)
    [ "${v%%.*}" = "$NODE_MAJOR" ] && { say "Node $v already installed"; return 0; }
  fi
  say "Installing Node.js $NODE_MAJOR"
  local base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x" tmp file
  tmp=$(mktemp -d)
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file=$(grep -o "node-v[0-9.]*-linux-$NODE_ARCH.tar.xz" "$tmp/SHASUMS256.txt" | head -1)
  [ -n "$file" ] || die "no Node build for $NODE_ARCH"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -) || die "Node download failed its checksum — not installing it"
  rm -rf /opt/nudge/node && mkdir -p /opt/nudge/node
  tar -xJf "$tmp/$file" -C /opt/nudge/node --strip-components=1
  rm -rf "$tmp"
  /opt/nudge/node/bin/node -e 'require("node:sqlite")' || die "this Node has no node:sqlite"
}

# ───────────────────────────── users + folders ─────────────────────────────
make_users() {
  say "Creating the nudge (hub) and kiosk (screen) users"
  for g in gpio spi i2c input audio video render; do getent group "$g" >/dev/null || groupadd --system "$g"; done
  id nudge >/dev/null 2>&1 || useradd --system --home-dir /var/lib/nudge --no-create-home --shell /usr/sbin/nologin --user-group nudge
  usermod -aG gpio,spi,input,audio nudge
  id kiosk >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin --user-group kiosk
  usermod -aG video,render,input,audio kiosk
  passwd -l kiosk >/dev/null
  install -d -m 700 -o nudge -g nudge /var/lib/nudge
  install -d -m 755 /etc/nudge /opt/nudge /opt/nudge/bin
}

# ───────────────────────────── the Nudge software ─────────────────────────────
install_app() {
  say "Installing the Nudge software"
  local stage; stage=$(mktemp -d /opt/nudge/.new.XXXX)
  cp -a "$HERE/hub" "$stage/hub"
  cp -a "$HERE/screen" "$stage/screen"
  cp -a "$HERE/apps" "$stage/apps"
  cp -a "$HERE/gpio" "$stage/gpio"
  # Swap in atomically so a failed copy never leaves a half-installed device.
  for d in hub screen apps gpio; do
    rm -rf "/opt/nudge/$d.old"; [ -d "/opt/nudge/$d" ] && mv "/opt/nudge/$d" "/opt/nudge/$d.old"
    mv "$stage/$d" "/opt/nudge/$d"
  done
  rmdir "$stage"
  install -m 755 "$HERE"/files/bin/* /opt/nudge/bin/
  ln -sf /opt/nudge/bin/nudge /usr/local/bin/nudge
  cp -f "$HERE/VERSION" /opt/nudge/VERSION 2>/dev/null || true
  chown -R root:root /opt/nudge/hub /opt/nudge/screen /opt/nudge/apps /opt/nudge/gpio
  chmod -R a+rX,go-w /opt/nudge/hub /opt/nudge/screen /opt/nudge/apps /opt/nudge/gpio

  # Settings files: create once, never overwrite the user's copy.
  if [ ! -f /etc/nudge/hub.env ]; then
    install -m 600 -o root -g root "$HERE/files/etc/hub.env" /etc/nudge/hub.env
  fi
  local chrome; chrome=$(command -v chromium || command -v chromium-browser || true)
  # The school reader's Chromium runs at low CPU/disk priority so the wall never stutters.
  [ -n "$chrome" ] && sed -i "s#^NUDGE_CHROMIUM=.*#NUDGE_CHROMIUM=/opt/nudge/bin/nudge-chromium-low#" /etc/nudge/hub.env
  [ -f /etc/nudge/gpio.env ] || install -m 644 "$HERE/files/etc/gpio.env" /etc/nudge/gpio.env

  # Python side: system gpiozero/evdev/websockets + LED driver in a venv.
  if [ ! -x /opt/nudge/venv/bin/python ]; then
    python3 -m venv --system-site-packages /opt/nudge/venv
  fi
  /opt/nudge/venv/bin/pip install -q --disable-pip-version-check "rpi-ws281x>=5,<6" \
    || warn "LED driver didn't install — lights stay off, everything else works"
}

# On-device AI models. They run on the Pi, so voice notes and personal search never leave it.
MOONSHINE_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2
MOONSHINE_SHA=d5fe6ec4334fef36255b2a4010412cad4c007e33103fec62fb5d17cad88086f2
MINILM_URL=https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main
install_models() {
  [ "$MODELS" = 1 ] || return 0
  local dir=/var/lib/nudge/models tmp
  install -d -m 700 -o nudge -g nudge "$dir"
  if [ ! -f "$dir/moonshine/tokens.txt" ]; then
    say "Downloading on-device speech-to-text (Moonshine tiny, ~45 MB)"
    tmp=$(mktemp -d)
    if curl -fsSL "$MOONSHINE_URL" -o "$tmp/m.tar.bz2" && echo "$MOONSHINE_SHA  $tmp/m.tar.bz2" | sha256sum -c --quiet -; then
      tar -xjf "$tmp/m.tar.bz2" -C "$tmp"
      rm -rf "$dir/moonshine"; mkdir -p "$dir/moonshine"
      cp "$tmp"/sherpa-onnx-moonshine-tiny-en-int8/*.onnx "$tmp"/sherpa-onnx-moonshine-tiny-en-int8/tokens.txt "$dir/moonshine/"
    else
      warn "speech model didn't download (or didn't match) — voice notes stay audio-only; run install.sh --update to retry"
    fi
    rm -rf "$tmp"
  fi
  if [ ! -f "$dir/minilm/model.onnx" ]; then
    say "Downloading smart search (MiniLM, ~23 MB)"
    tmp=$(mktemp -d)
    if curl -fsSL "$MINILM_URL/onnx/model_quantized.onnx" -o "$tmp/model.onnx" \
      && curl -fsSL "$MINILM_URL/tokenizer.json" -o "$tmp/tokenizer.json" \
      && curl -fsSL "$MINILM_URL/tokenizer_config.json" -o "$tmp/tokenizer_config.json" \
      && [ "$(stat -c %s "$tmp/model.onnx")" -gt 5000000 ]; then
      rm -rf "$dir/minilm"; mkdir -p "$dir/minilm"; cp "$tmp"/* "$dir/minilm/"
    else
      warn "search model didn't download — search still works on keywords"
    fi
    rm -rf "$tmp"
  fi
  chown -R nudge:nudge "$dir"
}

install_services() {
  say "Setting up services"
  install -m 644 "$HERE"/files/systemd/* /etc/systemd/system/
  if [ "$MODE" != image ]; then systemctl daemon-reload; fi
  systemctl enable nudge-hub nudge-kiosk nudge-gpio nudge-firstboot nudge-cert.timer >/dev/null 2>&1 || warn "couldn't enable the services"
  systemctl set-default graphical.target >/dev/null 2>&1 || true
  # Stop the Lite console auto-login fighting the kiosk for the screen.
  systemctl disable getty@tty1 >/dev/null 2>&1 || true
  [ -f "$BOOT/nudge.txt" ] || install -m 600 "$HERE/files/nudge.txt" "$BOOT/nudge.txt" 2>/dev/null || true
}

# ───────────────────────────── hardening ─────────────────────────────
harden() {
  say "Locking things down (firewall, SSH, auto security updates)"
  fw() { ufw "$@" >/dev/null || warn "firewall step failed: ufw $*"; }
  # Firewall: nothing gets in except the hub (Tailscale + home network) and SSH.
  fw --force reset
  fw default deny incoming
  fw default allow outgoing
  fw allow in on tailscale0 to any port 8787 proto tcp
  fw allow in on tailscale0 to any port 22 proto tcp
  fw allow 41641/udp  # Tailscale direct connections
  for net in 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12; do
    fw allow from "$net" to any port 8787 proto tcp
    fw allow from "$net" to any port 22 proto tcp
  done
  fw allow in proto udp to 224.0.0.251 port 5353  # nudge.local (mDNS)
  sed -i 's/^ENABLED=.*/ENABLED=yes/' /etc/ufw/ufw.conf
  systemctl enable ufw >/dev/null 2>&1 || true
  [ "$MODE" = image ] || ufw --force enable >/dev/null

  # SSH: no root. Passwords only go once a key is in place (never locks you out).
  mkdir -p /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/10-nudge.conf <<'EOF'
PermitRootLogin no
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
EOF
  if ls /home/*/.ssh/authorized_keys >/dev/null 2>&1 && [ -s "$(ls /home/*/.ssh/authorized_keys | head -1)" ]; then
    printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/20-nudge-keys-only.conf
  else
    warn "no SSH key found — password SSH stays on for now (add ssh_pubkey to nudge.txt to switch it off)"
  fi
  [ "$MODE" = image ] || systemctl reload ssh 2>/dev/null || true

  # Security updates install themselves.
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  cat > /etc/apt/apt.conf.d/52nudge-upgrades <<'EOF'
Unattended-Upgrade::Origins-Pattern:: "origin=Raspberry Pi Foundation";
Unattended-Upgrade::Origins-Pattern:: "origin=Tailscale";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
EOF
}

# ───────────────────────────── Pi tuning ─────────────────────────────
tune() {
  say "Tuning for a small Pi (compressed RAM swap, fewer SD writes, quiet boot)"
  # zram instead of an SD-card swapfile: faster and saves the card.
  printf 'ALGO=zstd\nPERCENT=50\nPRIORITY=100\n' > /etc/default/zramswap
  systemctl enable zramswap >/dev/null 2>&1 || true
  systemctl disable dphys-swapfile >/dev/null 2>&1 || true
  # /tmp in RAM: browser caches and temp files stop wearing the SD card.
  [ -f /usr/share/systemd/tmp.mount ] && [ ! -e /etc/systemd/system/tmp.mount ] && cp /usr/share/systemd/tmp.mount /etc/systemd/system/tmp.mount
  systemctl enable tmp.mount >/dev/null 2>&1 || true
  mkdir -p /etc/systemd/journald.conf.d
  printf '[Journal]\nSystemMaxUse=48M\nMaxRetentionSec=2week\nCompress=yes\n' > /etc/systemd/journald.conf.d/nudge.conf

  hostnamectl set-hostname "$HOST" 2>/dev/null || echo "$HOST" > /etc/hostname
  sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$HOST/" /etc/hosts 2>/dev/null || true
  grep -q "127.0.1.1" /etc/hosts || echo -e "127.0.1.1\t$HOST" >> /etc/hosts 2>/dev/null || true
  timedatectl set-timezone Europe/London 2>/dev/null || ln -sf /usr/share/zoneinfo/Europe/London /etc/localtime

  local cfg="$BOOT/config.txt" cmd="$BOOT/cmdline.txt"
  if [ -f "$cfg" ]; then
    sed -i '/^# >>> nudge/,/^# <<< nudge/d' "$cfg"
    {
      echo "# >>> nudge (managed by install.sh)"
      echo "[all]"
      echo "dtparam=spi=on"
      echo "dtparam=audio=on"
      echo "disable_splash=1"
      echo "hdmi_force_hotplug=1"
      echo "gpu_mem=128"
      if [ -n "$SCREEN" ]; then
        echo "hdmi_group=2"; echo "hdmi_mode=87"; echo "hdmi_cvt=${SCREEN%x*} ${SCREEN#*x} 60 6 0 0 0"
      fi
      echo "[pi4]"
      echo "# keeps the LED strip's SPI clock steady"
      echo "core_freq_min=500"
      echo "[all]"
      echo "# <<< nudge"
    } >> "$cfg"
  fi
  if [ -f "$cmd" ]; then
    local line; line=$(head -1 "$cmd")
    for opt in quiet loglevel=3 logo.nologo vt.global_cursor_default=0 consoleblank=0; do
      case " $line " in *" $opt "*) ;; *) line="$line $opt" ;; esac
    done
    line=$(echo "$line" | sed 's/ video=HDMI-A-1:[^ ]*//')
    [ -n "$SCREEN" ] && line="$line video=HDMI-A-1:${SCREEN}@60"
    echo "$line" > "$cmd"
  fi
}

finish() {
  if [ "$MODE" = image ]; then say "Image stage done"; return; fi
  systemctl daemon-reload
  systemctl restart nudge-hub
  sleep 2
  systemctl restart nudge-gpio nudge-kiosk || true
  local ok=0
  for i in $(seq 1 20); do curl -sf http://127.0.0.1:8788/api/health >/dev/null && { ok=1; break; }; sleep 1; done
  [ "$ok" = 1 ] && say "Hub is up" || warn "hub isn't answering yet — check: nudge logs hub"

  if [ "$MODE" = full ] && [ "$TAILSCALE" = 1 ] && ! tailscale status >/dev/null 2>&1; then
    say "Join your Tailscale network (open the link on your phone or PC):"
    tailscale up --hostname="$HOST" || warn "Tailscale not joined — run: sudo tailscale up"
    /opt/nudge/bin/nudge-cert || true
  fi
  cat <<EOF

  ✓ Nudge is installed.

  Next:
    • set the assistant key:   sudo nudge key
    • pair your phone/PC:      the wall shows a code in Pair mode, or run  sudo nudge pair owner
    • open the setup page:     http://$HOST.local:8787/app/admin.html   (after pairing)
    • everything else:         nudge  (shows all commands)

EOF
  [ "$MODE" = full ] && echo "  Reboot once to switch on SPI, the kiosk and quiet boot:  sudo reboot"
}

if [ "$MODE" = update ]; then
  install_node; install_app; install_models; install_services; finish; exit 0
fi
install_packages
install_tailscale
install_node
make_users
install_app
install_models
install_services
harden
tune
finish
