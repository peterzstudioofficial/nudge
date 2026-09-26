# Nudge

A focus system for school: the **ND-1** wall device (a Raspberry Pi with a screen, keys, dial and
lights) plus apps that all sync with it.

```
                   ┌──────────── Raspberry Pi (ND-1) ────────────┐
 phone / PC  ◄────►│  pi-hub  :8787  database · rules · school   │◄── school SharePoint + Outlook (read-only)
 (Tailscale / Wi-Fi)│    ▲ loopback :8788                          │◄── weather, news
                   │    ├── pi-screen   (Chromium kiosk)          │──► Claude (assistant, optional)
                   │    └── nudge_gpio  (keys, dial, LEDs, NFC)   │
                   └──────────────────────────────────────────────┘
```

| folder | what | runs on |
|---|---|---|
| [`pi-os/`](pi-os/README.md) | installer, image builder, services, hardware daemon | the Pi |
| `pi-hub/` | the server: API, sync, rules, school reader, assistant | the Pi |
| `pi-screen/` | Screen v2, the wall UI, plus the ND-1 simulator | the Pi's screen / your browser |
| `apps/` | **my app**, **notes**, **parent** (plus the setup page) as installable web apps | phones, PCs |
| `android/` | the three apps as Android APKs (Capacitor) | Android |
| `windows-desktop/` | desktop HUD, assistant window, app watcher, browser blocker, school sign-in | Windows |
| `shared/` | data model, rules, term dates, sync client, design tokens | everywhere |
| `design/` | the original Claude Design files | — |

## Try it on your computer (no Pi needed)

You need Node 22.13 or newer.

```sh
npm install
npm run dev
```

Then open:

- **http://localhost:5173/sim.html**: the full ND-1 with clickable keys, dial, touch pad, LEDs,
  plus a panel for time travel, forced states and screen sizes.
- **http://localhost:5174/**: the apps. Pair them with the code the hub prints.

Dev mode uses demo data and saved school pages, so nothing touches real accounts. The data lives
in `pi-hub/data/`. Delete that folder to start fresh.

Keyboard on the simulator:

| keys | action |
|---|---|
| `1`–`4` | the four keys (hold for long-press) |
| `←` / `→` | dial |
| `Enter` / `Space` | dial push |
| `T` | touch pad |

NFC, the switches and voice are buttons in the simulator's side panel.

## Get the real thing

Every push builds everything on GitHub (**Actions → build**, artifacts at the bottom):

| artifact | install |
|---|---|
| `nudge-pi` | on the Pi: see [pi-os/README.md](pi-os/README.md) |
| `nudge-windows` | double-click `Nudge-Setup-x.y.z.exe`. It installs for you only, no admin. |
| `nudge-android-my` / `-notes` / `-parent` | open the `.apk` on the phone and allow "install unknown apps" |
| `nudge-os-image` | run the workflow by hand with *Pi OS image* ticked, then flash with Raspberry Pi Imager |

Tag a version (`git tag v0.1.0 && git push --tags`) to get all of them on a GitHub Release.

The apps also work straight from the Pi in any browser: `http://nudge.local:8787/app/`. Use
*Add to home screen* to install them.

### Windows extras

- **School sign-in**: tray → *Sign in to school…*. It opens the real Microsoft login (MFA works). Only the resulting
  session cookies go to the Pi, encrypted. Your password never leaves Microsoft's page.
- **Browser blocker**: tray → *Browser blocker → Open the extension folder*. In Chrome or Edge go to
  `chrome://extensions`, turn on Developer mode, then *Load unpacked* and pick that folder. It
  blocks the sites in your block list during focus sessions. YouTube stays open only for videos
  that match what you're working on.

## Commands

```sh
npm run dev          # everything, live reload
npm test             # rule, auth, school-reader and API tests
npm run typecheck
npm run build        # web apps + hub
npm run bundle:pi    # → pi-os/deploy/nudge-pi.tar.gz
npm run build:desktop  # Windows installer (run on Windows)
```

More reading: [security model](docs/security.md) · [how it fits together](docs/architecture.md)
