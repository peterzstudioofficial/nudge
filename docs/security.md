# Security model

The goal: a school account and a family's data on a £40 computer in a bedroom, with **nothing that
can go wrong on its own**.

## Who can talk to the hub

| layer | rule |
|---|---|
| network | Firewall on the Pi: only Tailscale and the home LAN reach `:8787`. The hub also refuses any address that isn't loopback, Tailscale (`100.64.0.0/10`) or a private LAN. Set `NUDGE_ALLOW_LAN=0` to allow Tailscale only. |
| pairing | A 6-digit single-use code that lasts 10 minutes, shown on the wall or by `sudo nudge pair`. After 5 wrong tries an address is locked out for 10 minutes. Codes are stored only as SHA-256. |
| devices | Each device gets its own random 256-bit token, stored hashed on the Pi. Revoke any device from the setup page. The Windows app keeps its token in Windows' DPAPI (`safeStorage`); phones keep theirs in app storage. |
| roles | `owner` (Peter's phone), `desktop` (owner plus opening email drafts), `parent` (see the day and school to-dos, set rewards and rules, add up to 5 tasks a day — no notes, no assistant, no email) and `screen` (the wall). Every endpoint checks a capability, not just "logged in". |
| wall + hardware | Only accepted from `127.0.0.1`, and not from a browser page on another origin (checked with `Origin`). Hardware messages (keys, NFC, LEDs) are loopback-only. |
| browsers | CORS allows only the app origins (`capacitor://localhost`, `http(s)://localhost`, `app://nudge`) plus the hub's own. Every response gets `nosniff`, `no-referrer` and `DENY` framing. The web apps also get a strict CSP (own scripts only, no outside hosts). |

## The school reader ("no mess ups")

It uses Peter's real Microsoft session, so it's fenced in several ways.

- **Sign-in happens on Peter's PC**, in a real Microsoft window. The password is typed into
  Microsoft's page and is never seen or stored by Nudge. Only the resulting cookies go to the Pi.
- **Cookies are encrypted at rest** with AES-256-GCM. The key is in `/var/lib/nudge/secret.key`
  (0600, readable only by the `nudge` user). Only cookies for Microsoft domains are kept.
- **It reads, never writes.** Every request the headless browser makes goes through a guard:
  - only Microsoft hosts are allowed;
  - `PUT`/`PATCH`/`DELETE` are blocked;
  - any `POST` whose URL mentions send, delete, move, flag, reply, forward, recycle and the like
    is blocked. This check runs *before* the read allowlist.
  - It never clicks anything. It only reads the Outlook inbox list (subject, sender, preview), so
    messages aren't even marked as read.
  - These rules are unit-tested (`pi-hub/src/hub.test.ts`).
- **Actions stay on the Pi.** "Add as task", "add to bag", "remind me", "save as note" and
  "dismiss" change only Nudge's own data, and all of them can be undone.
- **Email replies are never sent by Nudge.** When Peter approves an assistant-drafted email, the
  Windows app opens Outlook's compose window pre-filled. Peter reads it and presses Send himself.
- **If the session expires**, the wall and the tray say "sign in to school again" instead of
  retrying.

## The assistant

- It's optional and switched off until a key is set (`sudo nudge key openrouter`).
- It can *read* tasks, notes, school items and the timetable. Anything that changes things (new
  tasks, reminders, email drafts, anything in a connected app) becomes an **ask** that Peter
  approves on the wall or phone. The model never gets a tool that acts directly.
- **Nothing leaves the house by accident.** Emails, connected-app actions (messages, posts,
  anything that changes something), computer hand-offs and paid builds need a **press-and-hold**
  on the wall ("hold" key fills) or phone, and the hub refuses a yes in the first 1.5 s after the
  question appears or without a hold. "No" is always one tap. Voice can never say yes.
- At most 4 of those per hour, and at most 40 questions an hour (nothing can loop and burn
  credit). Emails can only be drafted to school addresses or people Peter already approved an
  email to — and they're only ever drafts he sends himself.
- School mail, app data, notes and web results reach the model marked as "information, not
  instructions"; the model is told to report, not follow, anything in them that asks it to act.
- **Memory**: short facts it's told or picks up, kept on the Pi only, visible and deletable from
  the phone ("what it knows about you"). Passwords, money, health, addresses and numbers are
  refused by the hub, whatever the model asks.
- It won't interrupt a focus session. Questions asked mid-session are answered after it.
- Keys live only on the hub: `/etc/nudge/hub.env` (root-only), or, for OpenRouter connected from
  the setup page, encrypted in the hub's database with the same vault as the school sign-in.
  Phones and the PC never see them. Connecting with OAuth means a key is never typed or pasted
  anywhere; set a spend limit on it at openrouter.ai.
- In your OpenRouter account: keep **Input & Output Logging off**, turn on the account-wide
  **ZDR** guardrail with the model allowlist in `docs/openrouter-guardrail.md`, and give the key a
  monthly limit. Response caching isn't used (it would keep
  answers on OpenRouter for a while). Router metadata only puts the provider's name in the Pi's
  log.
- Connected apps run in a Composio session with its code sandbox switched off. Only actions from
  apps switched on in setup can run.

- Claude on the PC uses Peter's own sign-in to the unmodified Claude Code / Claude Desktop apps
  (personal use of his plan, as Anthropic allows). Nudge never sees, stores or passes on his
  Claude login. Everything Claude does through Nudge goes through the same tools and rules:
  hold-to-confirm, hourly caps, school-only email drafts, 150 tool calls an hour.

### Built tools

- Building is a big job: it always shows where it runs, when, and the estimated cost, and only a
  yes starts it. A monthly budget (setup) stops all cloud AI when it's reached; no request can
  reach an expensive model.
- Tools are AI-written code, so they run on their own origin (port 8790): they can't see the
  Nudge apps' storage or pairing keys, can't call the hub's API as you, and can't reach the
  internet. Only devices on the tailnet or home network can open them.
- Sandbox builds run in OpenRouter's container with networking switched off. Attachments are
  uploaded for that one job and deleted afterwards (OpenRouter's Files API isn't zero-retention
  while a file exists). Batch builds send only the build brief.
- Android can't install an app silently: a tool opens in Chrome and one tap on "Install app" adds
  it to the home screen.

### Handing work to Claude on the computer

- Only after a yes on the wall or phone, and only for what the desktop app reports it can do.
- Claude Desktop links (Cowork / Code) only fill in the task; Peter reads it and presses send.
- Build jobs on the computer run Claude Code only inside their own new folder in
  `Documents/Nudge Builds`, after the PC asks too; it may edit files there and nowhere else.
- Running Claude Code needs two switches in the tray (run, and separately edit files), a folder
  Peter added himself, and a second yes on the computer each time. It runs with
  `--permission-prompts none`, so anything beyond reading (or editing, if allowed) is refused.
  The task goes in on stdin, never on a command line.
- The hub only knows folder names. Everything Claude reads stays on the PC; a short summary
  (max 4,000 characters) comes back to the thread.

### Where data goes

| What | Where it's processed | What leaves the Pi |
| --- | --- | --- |
| Text assistant | OpenRouter, pinned to **zero-data-retention** providers that don't collect data (`provider.zdr`, `data_collection: "deny"`). If no such provider is free, the request fails; it never falls back to one that keeps data. | the question, a short context (today, week, profile) and the tool results it asks for |
| Web search + page reading (on by default, switch off in setup) | OpenRouter server tools: search via Parallel, pages fetched by OpenRouter itself. **Not covered by ZDR** (third-party search). | only the search topic; the assistant is told never to put names, school or personal details in a query. Parent-blocked sites are excluded. Capped at a few searches and $0.01–0.03 per question. |
| Tutor (advisor model) for hard questions | a stronger model on OpenRouter, same account ZDR setting | only the question the assistant writes for it, not the conversation |
| Voice note titles + tags | the text model, zero-retention, structured output | the note's words (only if the assistant is on) |
| Personal search (notes, school mail, calendar, tasks, birthdays, teachers, memory, library documents) | **on the Pi**: keywords plus a local MiniLM model, passage by passage | only the few passages that clearly match a question (or that the assistant searches for), inside that one request |
| Library documents (PDF, Word, PowerPoint, text) | text read **on the Pi** once when added; the file stays in the Pi's database | nothing when added; later only matching passages, as above |
| Voice notes → text | **on the Pi** (Moonshine, sherpa-onnx) | nothing |
| Talking to the wall | Gemini Live, if a Gemini key is set. Otherwise speech is turned into text **on the Pi** and goes to the text assistant as above. | the audio of that one question. Google's paid tier doesn't train on it but may keep it for a short time for abuse checks, so this isn't zero-retention. Leave the Gemini key out if that matters. |
| Connected apps (Google Calendar, Notion, Spotify…) | Composio holds the sign-ins (OAuth tokens) and makes the calls | the search query for finding an action, then whatever the approved or read-only action needs |
| Answers read out loud (only if spoken replies are on) | Gemini text-to-speech (Flash-Lite), same voice as Live; each phrase cached on the Pi | the answer's text, once per new phrase |
| Claude on the computer | Claude Desktop / Claude Code on Peter's PC, under his own Claude account | the task the assistant wrote (shown before the yes) |
| "Answers from: my Claude" (off by default) | the official Claude Code CLI on Peter's PC, signed in with his own plan; one ongoing chat; no built-in tools (no files, commands or web), only the Nudge connector | the question, the same short context, and whatever Nudge tools it calls; the wall keeps the quick model |
| Nudge connector in Claude Desktop / Code (added from the tray, after asking) | a small local MCP server that talks only to the running Nudge app over loopback, with its own key file; Nudge relays to the wall with its own pairing (the connector never sees a token) | whatever Claude asks the Nudge tools for, in his own Claude chats |

- Mic audio is streamed to the hub over loopback and never written to disk.
- The staff list and other private setup data never go to the parent app and are only sent to a
  model when a question needs them.

## Phone lock (Android)

- It only asks the hub one thing: is a session running? It sends this phone's own device key
  to `/api/session/lock` and nothing else.
- Which app is open is checked on the phone, through Android's usage access. It's never sent
  anywhere.
- If the hub can't be reached, the lock opens. It never locks anyone out because of the
  network.
- It can't be switched off from the phone mid-session, and it restarts after a reboot. Phone,
  messages, maps and school apps are always allowed.

## On the Pi

- Services run as `nudge` and `kiosk`, users that can't log in. The hub runs under systemd
  sandboxing: read-only filesystem except its data folder, private `/tmp` and devices, no new
  privileges.
- Security updates install nightly. SSH has no root login, and password login is switched off
  once a key is installed.
- Node.js is downloaded from nodejs.org and checked against its published SHA-256 before install.
  Tailscale comes from its signed apt repo.

## Reporting

Found something? Open a private security advisory on the GitHub repo.
