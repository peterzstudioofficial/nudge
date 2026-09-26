# Nudge OS — the ND-1 wall device

Raspberry Pi OS Lite (64-bit), stripped down to one job: the Nudge hub and the wall screen.
There's no desktop. The Pi boots straight into the screen, full-screen, in about 25 seconds.

| | Pi 3 B/B+ (1 GB) | Pi 4 (2 GB+) — recommended |
|---|---|---|
| Wall screen, keys, lights, apps syncing | ✓ | ✓ |
| School reader (headless Chromium every 30–60 min) | ✓ slower (about 40 s per run, uses swap) | ✓ (about 10 s) |
| Assistant, voice | ✓ | ✓ |

Pi 3 works because the reader only runs on a schedule, and compressed RAM swap (zram) absorbs
the spikes. If the screen ever stutters while the reader is running, a Pi 4 fixes it.

## Install: pick one

### A. Raspberry Pi Imager + installer (easiest)

1. **Raspberry Pi Imager** → *Raspberry Pi OS Lite (64-bit)*. Under **Edit settings**:
   - hostname `nudge`
   - a username and password
   - your Wi-Fi
   - under Services, turn on SSH
2. Boot the Pi, then from your PC: `ssh you@nudge.local`
3. Get `nudge-pi.tar.gz` (GitHub → Actions → latest *build* run → **nudge-pi** artifact, or a Release),
   copy it over and install:
   ```sh
   scp nudge-pi.tar.gz you@nudge.local:
   ssh you@nudge.local
   tar xzf nudge-pi.tar.gz && cd nudge-pi && sudo ./install.sh
   sudo reboot
   ```
   Add `--voice` to include offline speech for the touch pad. Add `--screen 1024x600` only if the
   screen stays black.

### B. Flash the ready-made image

GitHub → Actions → *build* → **Run workflow** with *Pi OS image* ticked. After about an hour you
get **nudge-os-image**. Flash it with Imager (*Use custom*). Before first boot, open the SD card's
boot partition on your PC and fill in `nudge.txt`:

```
wifi_country = GB
wifi_ssid = YourWifi
wifi_password = …
ssh_pubkey = ssh-ed25519 AAAA…   # optional — switches password login off
tailscale_authkey = tskey-…      # optional — joins your tailnet by itself
```

It's applied once at boot, then wiped. The SSH user is `admin`. Its password is the
`NUDGE_ADMIN_PASS` repo secret (or use the key).

## After installing

```sh
sudo nudge key              # paste your Anthropic API key → the assistant switches on
sudo nudge pair owner       # pairing code for your phone / PC (the wall's Pair screen shows one too)
sudo nudge pair parent      # …for a parent's phone
nudge status                # what's running + addresses
nudge logs hub              # live logs (hub | kiosk | gpio)
sudo nudge update nudge-pi.tar.gz   # new version, keeps all data
sudo nudge backup           # database + secrets → one private file
sudo nudge import nudge-setup.json  # timetable, homework plan, birthdays, staff
sudo nudge calendar term.pdf        # read a term's school calendar
```

**Tailscale** is how your phone and PC reach the Pi away from home. The installer asks you to log
in once. For the `https://nudge.<tailnet>.ts.net:8787` address (needed for the mic in phone
browsers), turn on **HTTPS Certificates** in the Tailscale admin console under DNS. The Pi fetches
and renews its certificate by itself.

## What's running

| service | user | what |
|---|---|---|
| `nudge-hub` | `nudge` (no login) | API, rules, database, school reader, assistant: `:8787`, plus loopback-only `:8788` |
| `nudge-kiosk` | `kiosk` (no login) | `cage` + Chromium full-screen on `http://127.0.0.1:8788/screen/` |
| `nudge-gpio` | `nudge` | keys, dial, touch pad, switches, LEDs, NFC, voice → hub over loopback |
| `nudge-cert.timer` | root | weekly Tailscale HTTPS certificate renewal |
| `nudge-firstboot` | root | applies `nudge.txt` |

Layout:

- `/opt/nudge`: the software. Owned by root, read-only to the services.
- `/var/lib/nudge`: data, only readable by the hub. It holds the database, the encrypted school
  cookies and the key.
- `/etc/nudge/hub.env`: settings and the API key, readable by root only.

### Security, in short

- **Firewall:** everything in is blocked except the hub and SSH, and only from Tailscale or the
  home network.
- **The hub itself** turns away any address that isn't loopback, Tailscale or a private LAN. Every
  request needs a paired device token. Pairing codes are single-use, last 10 minutes and are
  rate-limited.
- **Hardware control** (keys, NFC, LEDs) is only accepted from the Pi itself.
- **Services** run as users that can't log in, under systemd sandboxing: read-only system, no
  home dirs, no privilege escalation.
- **Maintenance:** security updates install nightly and the Pi reboots at 03:30 if one needs it.
  SSH never accepts root. Password login switches off as soon as an SSH key is installed.
- **The school reader** only ever *reads*. It can't click, send, delete or post a form. Only
  Microsoft addresses are allowed, and anything that looks like a write is blocked at the network
  level. See [`../docs/security.md`](../docs/security.md).

## Screen

Any HDMI screen works. The UI is designed at 320×240 and scales to fill the screen, widening for
wide screens. Tested at 1024×600 (Waveshare 7") and 800×480 (5"). Touch works if the screen has
USB touch. Brightness follows the time of day and the "doze" states.

If the picture is black or the wrong size:

```sh
sudo ./install.sh --update --screen 1024x600   # or 800x480, 1280x800 …
sudo reboot
```

## Wiring (BCM numbers)

```
                      3V3  (1) (2)  5V  ─── LED strip +5V (use a separate 5V 2A supply for >20 LEDs)
                            …
 dial A ── GPIO17 (11) (12) GPIO18
 dial B ── GPIO27 (13) (14) GND ─── common ground (buttons, dial, LED strip)
 dial push GPIO22 (15) (16) GPIO23
                      3V3 (17) (18) GPIO24
 LEDs DIN ─ GPIO10 (19) (20) GND           ← SPI MOSI, via a 330 Ω resistor (+ 74AHCT125 level shifter ideally)
                            …
 key 1 ─── GPIO5  (29) (30) GND
 key 2 ─── GPIO6  (31) (32) GPIO12 ─── dial LED (via 220 Ω)
 key 3 ─── GPIO13 (33) (34) GND
 key 4 ─── GPIO19 (35) (36) GPIO16 ─── mic switch (closed = mic on)
 touch ─── GPIO26 (37) (38) GPIO20 ─── power switch (closed = on)
                      GND (39) (40) GPIO21
```

| part | pins | notes |
|---|---|---|
| 4 keys | GPIO 5, 6, 13, 19 → GND | internal pull-ups, no resistors needed |
| rotary encoder (EC11) | A 17, B 27, push 22, C → GND | |
| touch pad (TTP223) | OUT → 26, VCC 3V3, GND | active high |
| mic switch (DPDT) | one pole GPIO16 → GND, other pole cuts the USB mic's 5 V | the mic is physically off, not just muted |
| power switch | GPIO20 → GND | open = the wall goes into night mode |
| WS2812 chain | DIN GPIO10 | 25 LEDs (5×5 matrix, row by row) then the 16-LED light bar |
| dial LED | GPIO12 → 220 Ω → LED → GND | PWM |
| NFC | USB reader that types tag IDs (e.g. an ACR122U in keyboard mode, or a cheap 125 kHz / 13.56 MHz USB reader) | set `NUDGE_NFC_DEVICE` in `/etc/nudge/gpio.env` (see `ls /dev/input/by-id/`) |
| mic | any USB mic | only needed for voice |

Test the hardware without the hub:

```sh
sudo systemctl stop nudge-gpio
sudo -u nudge /opt/nudge/venv/bin/python /opt/nudge/gpio/nudge_gpio.py --selftest
```

Every part is optional. Anything missing is simply skipped, so a Pi with only a touchscreen works
too.

## Building the image yourself

This needs Linux with Docker, and takes about an hour:

```sh
npm ci && npm run bundle:pi
NUDGE_ADMIN_PASS='something-long' pi-os/pi-gen/build-image.sh   # → pi-os/deploy/nudge-os-*.img.xz
```
