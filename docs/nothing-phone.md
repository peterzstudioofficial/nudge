# Nudge on a Nothing Phone

The three Android apps (nudge, nudge notes, nudge parent) are tuned for the Nothing Phone (4a): its
screen, Android 16, the gesture bar, and the Glyph lights on the back. They run the same on any
other Android phone, just without the Glyphs.

## Install

Grab the APKs from the latest CI build (Actions → build → artifacts: `nudge-android-my`,
`nudge-android-notes`, `nudge-android-parent`) and open them on the phone.

## Glyph lights (Phone (4a): the six-zone Glyph Bar)

While the nudge app is open:

| what's going on | the Glyph Bar |
| --- | --- |
| focus session | time left, as a bar that shrinks from the top |
| paused | the bottom zone breathes (it's kept) |
| break | the whole bar breathes slowly |
| time's up, ready to claim | the top zone pulses |
| an email / message waiting for your held yes | the top zone pulses |
| a held yes goes through | a short flash |
| points won | a quick run down the bar |
| recording a voice note (notes app) | the bottom zone stays on |

Turn them off in **Settings → this phone → glyph lights** (the row only shows on a Nothing phone).

Nothing only lets the app that's on screen use the Glyphs, so they switch off when nudge is in the
background or the screen goes off, and come back when you open it.

**No setup needed on the Phone (4a)**: the apps target Android 16, where Nothing no longer asks
for an API key. On an older Nothing phone still on Android 15 or earlier, turn on Glyph debug mode
first (it lasts 48 hours):

```
adb shell settings put global nt_glyph_interface_debug_enable 1
```

Other Nothing phones work too (the 4b's four zones get the same bar; older models light their whole
Glyph for these moments). The Phone (4a) Pro's Glyph Matrix isn't used yet.

## How it's built

- `android/native/.../GlyphPlugin.java` reaches Nothing's Glyph SDK by reflection, so the app
  builds and runs without it, and on any phone where it isn't there every call does nothing.
- CI fetches the SDK (`scripts/fetch-glyph-sdk.mjs`): Nothing's official AAR from
  `Nothing-Developer-Programme/Glyph-Developer-Kit`, pinned to one commit and checked against its
  SHA-256. It isn't kept in this repo.
- What the lights show is worked out in `shared/src/glyph.ts` (tested), and only sent when it
  changes.
