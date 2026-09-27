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
- It won't interrupt a focus session. Questions asked mid-session are answered after it.
- Keys live only in `/etc/nudge/hub.env` (root-only). Phones and the PC never see them.

### Where data goes

| What | Where it's processed | What leaves the Pi |
| --- | --- | --- |
| Text assistant | OpenRouter, pinned to **zero-data-retention** providers that don't collect data (`provider.zdr`, `data_collection: "deny"`). If no such provider is free, the request fails; it never falls back to one that keeps data. | the question, a short context (today, week, profile) and the tool results it asks for |
| Web search + page reading (on by default, switch off in setup) | OpenRouter server tools: search via Parallel, pages fetched by OpenRouter itself. **Not covered by ZDR** (third-party search). | only the search topic; the assistant is told never to put names, school or personal details in a query. Parent-blocked sites are excluded. Capped at a few searches and $0.01–0.03 per question. |
| Tutor (advisor model) for hard questions | a stronger model on OpenRouter, same account ZDR setting | only the question the assistant writes for it, not the conversation |
| Voice note titles + tags | the text model, zero-retention, structured output | the note's words (only if the assistant is on) |
| Personal search (notes, school mail, calendar, tasks, birthdays, teachers) | **on the Pi**: keywords plus a local MiniLM model | only the few results the assistant asked for, inside that one request |
| Voice notes → text | **on the Pi** (Moonshine, sherpa-onnx) | nothing |
| Talking to the wall | Gemini Live, if a Gemini key is set. Otherwise speech is turned into text **on the Pi** and goes to the text assistant as above. | the audio of that one question. Google's paid tier doesn't train on it but may keep it for a short time for abuse checks, so this isn't zero-retention. Leave the Gemini key out if that matters. |
| Connected apps (Google Calendar, Notion, Spotify…) | Composio holds the sign-ins (OAuth tokens) and makes the calls | whatever the approved or read-only app action needs |

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
