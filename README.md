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

## Your school setup

The personal side isn't in this repo: your timetable, homework plan, birthdays and the staff
list. It lives in one private setup file, `private/nudge-setup.json`, which git ignores.

- **Load it:** on the setup page go to **week → import setup file**, or on the Pi run
  `sudo nudge import nudge-setup.json`.
- **Dev mode:** `npm run dev` loads it by itself if the file is there.

With it loaded, the wall knows:

- **Week A / B.** Weeks alternate through each term, skipping half term. Autumn 2026 starts on
  week A, as the school calendar says.
- **Bell times.** Registration at 08:30, 8 × 40-minute lessons, out at 16:00.
- **Rooms and teachers**, taken from the timetable codes.
- **Homework.** After school it adds the homework your plan says was set that day. Each piece is
  due at that subject's next lesson and sized from 60 min per subject per week. If one wasn't
  actually set, tap **NOT SET?** on your phone.
- **Calendar.** Each term, upload the school calendar PDF on the setup page (**week → school
  calendar**) or run `sudo nudge calendar calendar.pdf`. It keeps the dates that matter to you:
  term dates, your year's events, mocks, parents' evenings and creative things. It leaves out
  fixtures and other years.

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
