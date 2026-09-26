# How it fits together

**One source of truth: the hub on the Pi.** Every app is a client of it.

## Sync

- Clients load `GET /api/state`, a snapshot of today: tasks, session, bag, points, reward, weather,
  school headlines and asks. They then keep a WebSocket open.
- On any change the hub broadcasts `{"t":"changed","topics":[…]}`, and clients re-fetch the
  snapshot. Snapshots are small, so there are no merge conflicts.
- Writes carry an `Idempotency-Key`. If a phone is offline, writes wait in a local outbox and
  replay when it reconnects. Replays are safe because the hub remembers each key's result.
- Away from home, everything reaches the Pi over Tailscale. The hub is the only server; there's no
  cloud.

## Rules (shared/src/rules.ts)

- **Points:** +1 for starting a task, +3 for finishing it. Points never go down. The reward bank
  counts points earned since the reward was set, and leftovers carry over to the next reward.
- **Claiming:** only when the timer is done or after at least 60 s of work.
- **Limits:**
  - a break needs 5 minutes of work first;
  - 2 skips a day;
  - parents can add up to 5 tasks a day.
- **Power cuts:** the hub writes a heartbeat. After a power cut, a running session resumes from
  the last beat instead of counting the outage as work.
- **Term dates** decide school days vs holidays (`shared/src/termDates.ts`). They're refreshed
  weekly from the school site and can be edited on the setup page.

## School reader (pi-hub/src/school)

The steps are `vault` → `reader` → `extract` → `classify` → `actions`:

1. Cookies come from the desktop sign-in and are sealed in the vault.
2. Every 30 minutes in term (60 in holidays), between 7 am and 10 pm, the reader opens headless
   Chromium with those cookies. Every request goes through `guard`.
3. It loads the configured SharePoint pages and the Outlook inbox list, and extracts text.
4. Each item is classified as bring / homework / deadline / event / info, with a due date where
   it can find one.
5. Items show on the wall and phone, where one tap turns them into a task, bag item, reminder or
   note, all undoable.

## Assistant (pi-hub/src/agent)

- It uses the Claude API tool runner. Read tools see tasks, notes, school items and the timetable.
- `propose_*` tools create asks, which Peter approves.
- The wall uses low effort for quick answers; the desktop agent window uses high effort. Long
  answers are saved as notes.

## Screen (pi-screen)

- `device.ts` is a port of the ND-1 Panel v2 state machine: modes, keys, dial, doze, alarms and
  overlays.
- `vm.ts` turns the state into what's drawn and what the LEDs show.
- The UI is laid out at 240 px tall and scaled to the screen height. Its width stretches to the
  screen's shape.
- LED frames go to the hub, which forwards them to the hardware daemon.
