# Nudge: first run

Everything below is a one-time job. Tick them off in order; each step says how you know it worked.

## 1. The wall (Raspberry Pi)

1. Either flash the image (Actions → build → "Run workflow" with **image** ticked, ~1 hour →
   artifact `nudge-os-image`) with Raspberry Pi Imager, or on Pi OS Lite 64-bit download the
   `nudge-pi` artifact and run `tar xzf nudge-pi.tar.gz && sudo bash nudge-pi/install.sh`.
2. First boot: join Wi-Fi, then scan the Tailscale QR on the screen and sign in.
   ✓ The wall shows the clock and "press any key".
3. Put your setup pack on the Pi and import it (your timetable, bells, staff, birthdays, terms,
   memory). It never goes into git.
   ```
   scp private/nudge-setup.json pi@nudge:~
   sudo nudge import nudge-setup.json
   ```
   ✓ It prints `imported: profile, 4 terms, timetable, …`.
4. Keys (stored only on the Pi, root-only):
   ```
   sudo nudge key openrouter      # the assistant (or use "Connect OpenRouter" in setup instead)
   sudo nudge key gemini          # optional: talking to the wall + read-out answers
   sudo nudge key composio        # optional: Google Calendar, Notion, Spotify…
   ```
   ✓ Setup page → assistant shows "on", your credit, and "search: on the Pi".

## 2. Your phone (Nothing Phone)

1. Install the APK from the CI build (Actions → build → artifacts → `nudge-android-my`, and
   `nudge-android-notes` for the notes app).
2. On the wall: hold key 3 → 1 (pair) for a code; type it in the app.
   ✓ Today shows your day and week A/B.
3. Settings → **documents it can read** → add revision guides, the syllabus, scripts.
   Scans and photos ask before costing anything.
4. Settings → **what it knows about you**: check the lines, delete anything you don't want.

## 3. Dad's phone

Install `nudge-android-parent`, pair with a parent code (wall: pair → "parent"). Set the reward, rules,
blocked sites and apps, and the "open for a subject" list (Pinterest is already open for art and
drama). He sees progress, never your questions, notes, documents or emails.

## 4. The computer (Windows)

1. Run the installer from the CI build (artifact `nudge-windows`, `Nudge-Setup-….exe`). Pair it like the phone.
   ✓ The on-task card appears in the corner when a session starts.
2. Browser blocker: tray → Browser blocker → "Copy install steps", then in Edge/Chrome:
   `edge://extensions` → Developer mode → Load unpacked → paste the folder.
   ✓ The extension popup says "SESSION ACTIVE" during a session.
3. Claude on your own plan (optional):
   - Install Claude Code and sign in with your Pro account (`claude` in a terminal).
   - Tray → Claude on this computer → **Add Nudge to Claude Desktop and Claude Code…**
     ✓ In Claude, "what have I got today?" uses the nudge tools.
   - Tray → tick **Answer my questions with my Claude plan**, then phone Settings →
     **answers from** → MY CLAUDE (PC).

## 5. OpenRouter account (once)

openrouter.ai → Settings:
- Input & Output Logging: **off**
- Guardrails: zero data retention **on**, the model allowlist from `docs/openrouter-guardrail.md`
  (add `qwen/qwen3-embedding-8b` and `google/gemini-3.5-flash-lite` if you use sharper search or
  OCR), prompt-injection detection on, budget $5/month.
- Rotate any key that was ever pasted into a chat.

## If something's off

- `sudo nudge dev on 2` turns on the dev tools for two hours (logs, status, test pop-up) —
  `sudo nudge dev off` or any update removes them.
- `npm run build && npm run e2e` on a computer runs the whole system end to end with a fake
  OpenRouter (41 checks); add `--pack private/nudge-setup.json` to run it on your own data.
