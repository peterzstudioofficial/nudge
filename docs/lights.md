# Nudge lights: the 5×5 matrix

The wall's 25 lights play built-in patterns for each moment (points won, the alarm, packing your
bag…). You can swap any moment for a glyph of your own, play one on demand ("nudge, show me a
heart", or the phone), or scroll a word.

## Glyphs

A glyph is a few 5×5 frames and a palette of up to 8 colours:

- each frame is 25 characters, row by row: `.` is off, `1`–`8` is that palette colour
  (spaces and `|` are ignored, so you can write rows apart: `"..1.. .111. 11111 .111. ..1.."`)
- `fps`: frames per second (0.2–20, default 4)
- `loop`: play forever (default) or once and hold the last frame
- `fade`: blend each frame into the next (soft, for slow glows) instead of cutting

Colours are `#rrggbb`. Dim colours (like `#5a1a08`) make softer cells; the Pi applies gamma, so
low values still look smooth.

## Packs

A pack is a JSON file: a `name` (lowercase, `a-z 0-9 -`), optionally `by`, and up to 40 glyphs
(64 frames each). See [`lights-example.json`](lights-example.json).

Add one from the phone: **Settings → lights → add a pack (.json)**. Up to 10 packs; adding one with
the same name replaces it. Then tap a moment and pick a glyph for it, or tap any glyph to play it.

From the computer (Claude Code, or a script) the same pack can be posted to the hub with the
computer's pairing: `POST /api/lights/packs` with the JSON as the body.

> Making one with Claude: "Make a Nudge light pack (format in docs/lights.md) called `drama` with a
> spotlight sweep, a mask, and curtains opening, 5×5, warm colours."

## Moments

| moment | when |
| --- | --- |
| resting | the wall is idle |
| points won | after a claim |
| reward unlocked | a reward unlocks |
| a question | the assistant is asking you something |
| talking | the assistant is listening or answering |
| morning alarm | the alarm is ringing |
| packing | the bag list is open |
| timer | a timer is counting down |

Glyphs never play during a focus session or at night, and the parent app never sees what's
playing.

## Energy

The Pi draws a still picture once and then sleeps until the next change: nothing runs, nothing is
re-sent to the LEDs. Moving patterns tick at 30 fps (a glyph at its own speed); one frame costs
about a tenth of a millisecond. At night everything is near-dark, and the brightness follows the
wall's brightness setting. (WS2812 LEDs still draw ~1 mA each when black; cut their 5 V with the
power switch if the wall is off for long.)
