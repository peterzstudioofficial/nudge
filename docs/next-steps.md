# Next steps

Everything in the repo is built and tested (unit tests, a 55-check end-to-end run, a real install
in Debian, the Windows installer and three Android apps, all in CI). What's left needs hardware,
accounts or decisions only you can make. In order:

## 1. Before anything else (5 min)

- [ ] Rotate the API keys that were pasted into chat earlier (OpenRouter, Gemini, Composio). New
      ones go on the Pi with `sudo nudge key …`, never in chat or git.
- [ ] OpenRouter account settings: logging **off**, ZDR guardrail **on**, model allowlist from
      `docs/openrouter-guardrail.md`, monthly limit **$5**.

## 2. Build the wall (an afternoon)

- [ ] Flash the Pi image (Actions → build → Run workflow → tick **image**) or run `install.sh`
      on Pi OS Lite. See `docs/first-run.md`.
- [ ] Wire the parts: 4 keys, dial, touch pad, mic + mic switch, 5×5 LEDs + light bar, NFC
      (`pi-os/gpio/nudge_gpio.py` lists the pins). Then
      `sudo systemctl stop nudge-gpio && sudo /opt/nudge/venv/bin/python /opt/nudge/gpio/nudge_gpio.py --selftest && sudo systemctl start nudge-gpio`:
      a light should run across the matrix and the bar should fill.
- [ ] Check `NUDGE_BAR_LEDS` in `/etc/nudge/gpio.env` matches your light bar.
- [ ] Tailscale: scan the QR on first boot and sign in (free account).
- [ ] Import your setup pack: `sudo nudge import nudge-setup.json`.
- [ ] Keys: `sudo nudge key openrouter` (or **Connect OpenRouter** in setup), `sudo nudge key gemini`
      for talking to it, optional `sudo nudge key composio` for Google Calendar, Notion and so on.

## 3. Phone (Nothing Phone (4a), Nothing OS 5.0)

- [ ] Install `nudge-android-my` and `nudge-android-notes` from the latest CI build.
- [ ] On the wall: hold key 3 → key 1 (pair) and scan the QR, or type the code in the app.
- [ ] Settings → **documents it can read**: add revision guides, the syllabus, your scripts.
- [ ] Settings → **what it knows about you**: check it, delete anything you don't want.
- [ ] Try the **Ask** tab (the sparkle icon): "what's due this week?", then "shorter".
- [ ] Start a task with nudge open: does the Glyph Bar light? If Settings says **NOT AVAILABLE**,
      look in Nothing's Glyph app for a setting that lets other apps use the Glyphs, and tell me.
- [ ] Optional: Settings → **wake word**, **lights**, **phone lock** (asks for usage access).

## 3b. Your own apps (tool builder)

- [ ] Tools tab → **add your logo**: pick the peterzstudio logo (PNG with a transparent
      background, or a plain SVG). Tools use it only where it fits.
- [ ] Ask tab → the small **widgets** button (left of the box) → finish "make me a tool that…",
      e.g. "…tests me on my Inspector Calls quotes". Check the cost, hold yes.
- [ ] Want a different look? Say so ("light, pastel, like a film poster") or pick **my own look**
      in Tools → ask for a tool. Your words beat the Nudge style.
- [ ] When it's ready: tap **open**, then **install app** in Chrome to put it on the home screen.
- [ ] Keep the good ones (the **keep** switch). Anything not kept tidies itself away after a week.
- [ ] Hold a tool (or ⋯) → **open on my computer** / **put it on my computer's desktop**
      (the PC needs Nudge running).

## 4. Dad's phone

- [ ] Install `nudge-android-parent`; pair it with a **parent** code (wall: pair → parent).
- [ ] Set the reward, the rules, blocked sites/apps, and what opens for a subject.

## 5. Your computer (Windows)

- [ ] Install `Nudge-Setup-….exe` from the `nudge-windows` artifact (unsigned, so Windows
      SmartScreen asks "run anyway" once). Pair it like the phone.
- [ ] Tray → **Browser blocker** → follow the steps to load the extension in Edge/Chrome.
- [ ] Tray → **Sign in to school…** once, so the wall can read SharePoint and Outlook.
- [ ] Optional: Claude Code signed in with your Pro plan; tray → **Add Nudge to Claude…**.
- [ ] Ctrl+Shift+Space anywhere: Ask Nudge.
- [ ] Tray → **My tools** → a tool → **Open** or **Add to desktop**.

## 6. Tell me (so I can finish the last bits)

- [ ] The SharePoint pages to read (the "main few pages": copy their addresses). The setup pack
      has none yet, so the wall only reads Outlook for now.
- [ ] How the wake word does in your room after a day: misses, or times it woke on its own.
- [ ] Whether the Glyph Bar works on Nothing OS 5.0.
- [ ] The first tool you build: did it look and feel right? Anything about the style to change?
- [ ] Anything that feels slow, confusing or wrong. Screenshots help.

## Later (optional)

- [ ] Signed release builds (an Android keystore and a Windows code-signing certificate) so
      updates install without warnings. Debug builds are fine for your own devices.
- [ ] A GitHub release: push a tag like `v1.0.0` and CI attaches the APKs, installer and Pi bundle.
