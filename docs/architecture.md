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

## School week (shared/src/school.ts)

- The timetable is keyed `A1`…`B5` (or `1`…`5` if every week is the same). `weekLetter()`
  counts teaching weeks through each term, skipping weeks with no school, starting from the
  term's `abStart` letter. `lessonTimes()` lays lessons onto the bell times.
- **Homework:** at 16:05 on school days, `planHomework()` reads the homework plan for that day.
  For each subject it:
  - finds the next lesson with `nextLesson()`, which becomes the due date;
  - sizes the task as the weekly allowance divided by how many times that subject sets
    homework that week;
  - plans it on the first evening that still has room.

  These tasks are marked `expected` until confirmed. Turning a matching school email into a task
  fills in the expected task instead of adding a second one.
- **Calendar PDFs** are read with pdf.js on the hub. `parseSchoolCalendar()` turns them into
  dated lines, and `calendarTags()` keeps what matters for the year group and house.
- **Staff:** timetable codes (e.g. NEC) are matched to the staff list by initials, with the
  subject breaking ties. The staff list is only readable by owner devices.

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

- `llm.ts` talks to OpenRouter (OpenAI-style chat + tools). Default model is a fast, cheap one
  (`deepseek/deepseek-v4.1-flash`, falling back to `z-ai/glm-5.3-flash`), always on
  zero-data-retention providers, sorted by speed, under a price ceiling. Cost per month is
  tracked in `spend.ts`. Each question uses its thread id as `session_id`, so every turn hits the
  same provider's prompt cache; `context-compression` keeps long threads from failing; read tools
  the model asks for together run in parallel.
- OpenRouter server tools run inside the request: `datetime`, `web_search` (Parallel turbo, the
  cheapest engine) + `web_fetch`, and `advisor` (a stronger "tutor" model the cheap one consults
  on hard questions, desktop/app only). `stop_server_tools_when` caps steps and spend. Answers list
  the web pages they used.
- Voice notes get a title and tags from a structured (JSON Schema) answer with the free
  `response-healing` plugin.
- `tools.ts` defines each tool once (zod schema → JSON Schema). The same tools serve the text
  assistant and Gemini Live. Read tools see tasks, notes, school items, calendar and timetable;
  `propose_*` tools create asks, which Peter approves.
- `composio.ts` adds connected apps through a Composio session (one per set of switched-on apps,
  Composio's remote sandbox off, its own meta tools never exposed). The model gets two tools:
  `find_app_actions` (Composio's semantic tool search) and `use_app`. Actions Composio tags
  read-only (and whose names don't look like writes) run straight away; everything else becomes an
  ask and only runs after a yes, and not at all outside "act" mode.
- `hand_to_claude` passes bigger computer jobs to Claude on Peter's PC after a yes. The desktop
  app either opens Claude Desktop (`claude://cowork/new` or `claude://code/new`) with the task
  typed in but not sent, or runs Claude Code headless (`claude -p`, prompt on stdin) in a folder
  Peter added from the tray, after the PC asks him again. Read-and-plan only unless he allows
  edits. The result goes back into the assistant's thread.
- `builder/` builds tools: small offline web apps for the phone's Tools tab. The `build_tool` ask
  shows where, when and the estimated cost; only a yes starts a job. "now" runs on OpenRouter's
  Responses API with the sandboxed `openrouter:bash` container (network off): the model writes
  `out/`, tests it, and the files are read back with the Containers API. "later" uses the Batch
  API at half price, falling back to an overnight sandbox build. Attachments go up with the Files
  API for that one job and are deleted after. "computer" hands the job to Claude Code on the PC,
  which builds in `Documents/Nudge Builds/<job>` and uploads `out/`.
- `tools-server.ts` serves built tools on their own port (8790), so their own origin: they can't
  read the apps' storage or keys, and `connect-src 'self'` keeps them off the internet. Each gets
  a manifest, PNG icons and an offline service worker, so Chrome on Android offers "Install app".
- Cost guards: a price ceiling on every request (no Claude-class models can be reached), a block
  on setting expensive models, a per-question spend cap, and a monthly budget that stops all cloud
  AI (assistant and builds) when it's reached.
- `keys.ts` holds the OpenRouter key: from `hub.env`, or connected from the setup page with
  OpenRouter's OAuth PKCE flow and stored encrypted in the database.
- `rag/` is private search: BM25 plus on-device MiniLM embeddings, fused by rank, cached in SQLite
  and rebuilt when data changes. The embedding model loads on first use and unloads when idle.
- `voice/` handles the wall mic. The GPIO daemon streams 16 kHz PCM over loopback; `wall.ts` runs
  one Gemini Live turn with the same tools, or turns the speech into text on the Pi (`stt.ts`,
  Moonshine) and hands it to the text assistant. Voice notes from the apps are transcribed the
  same way.
- Long answers are saved as notes.

## Screen (pi-screen)

- `device.ts` is a port of the ND-1 Panel v2 state machine: modes, keys, dial, doze, alarms and
  overlays.
- `vm.ts` turns the state into what's drawn and what the LEDs show.
- The UI is laid out at 240 px tall and scaled to the screen height. Its width stretches to the
  screen's shape.
- LED frames go to the hub, which forwards them to the hardware daemon.
