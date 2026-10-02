"""
The 5x5 matrix and the light bar, worked out on the Pi.

The wall sends a picture only when it changes (a "leds" frame). This turns it into colours:

- the same animations as the wall's simulator (CSS keyframes, with each cell's own speed and delay)
- glyphs (a few 5x5 frames + a palette) played at their own speed, so nothing streams
- a short crossfade whenever the picture changes
- gamma correction, so dim levels look smooth instead of jumping
- an overall brightness level from the wall (its brightness setting, and very low at night)

Energy: it says how long until anything can change. A still picture (most of the day) is drawn
once and then nothing runs until the next frame arrives; an identical result is never re-sent to
the LEDs. Only moving patterns tick, at 30 fps, or at a glyph's own speed.

Pure Python, no hardware: nudge_gpio.py writes the bytes this returns. Tests: test_lights.py.
"""

import math

GAMMA = bytes(int(round(255 * (i / 255) ** 2.2)) for i in range(256))
FADE_S = 0.22
FPS = 30
STEP = 1 / FPS

# CSS keyframes from the design (screen.css), as (position, level) points.
KEYS = {
    "lPulse": [(0, 0.16), (0.5, 1), (1, 0.16)],
    "lBurst": [(0, 0.14), (0.45, 1), (1, 0.14)],
    "lStep": [(0, 0.12), (0.12, 1), (0.6, 1), (0.72, 0.12), (1, 0.12)],
    "lSpark": [(0, 0.12), (0.5, 1), (1, 0.12)],
    "lGather": [(0, 0.5), (0.5, 1), (1, 0.5)],
    "lDrift": [(0, 0.6), (0.5, 1), (1, 0.6)],
    "lSweep": [(0, 0.1), (0.45, 1), (1, 0.1)],
    "lBreathe": [(0, 0.1), (0.25, 0.9), (0.5, 0.9), (0.75, 0.1), (1, 0.1)],
    "lAlarm": [(0, 0.06), (0.22, 1), (0.54, 1), (1, 0.06)],
}
# Played once, then held at the end.
ONCE = {"lRise": [(0, 0), (1, 1)], "lSettle": [(0, 1), (1, 0.3)]}
PERIOD = {"lPulse": 1.4, "lBurst": 1.2, "lStep": 1.6, "lSpark": 1.1, "lGather": 2.0, "lDrift": 6.5, "lSweep": 1.8, "lBreathe": 16.0, "lAlarm": 0.85, "lRise": 0.55, "lSettle": 1.0}


def hex_rgb(c):
    c = (c or "#000000").lstrip("#")
    if len(c) != 6:
        return (0, 0, 0)
    try:
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return (0, 0, 0)


def _ease(x):
    """ease-in-out between keyframes, like the CSS"""
    return 0.5 - 0.5 * math.cos(math.pi * x)


def _keyframes(points, p):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if p <= b:
            return va + (vb - va) * _ease((p - a) / (b - a) if b > a else 1)
    return points[-1][1]


def anim_level(name, t, period=None, delay=0.0):
    """How bright an animated cell is at time t (seconds), 0..1."""
    if not name or name == "none":
        return 1.0
    per = period or PERIOD.get(name, 1.4)
    t = t - delay
    if name in ONCE:
        return _keyframes(ONCE[name], min(1.0, max(0.0, t / per)))
    pts = KEYS.get(name)
    if not pts:
        return 1.0
    if t < 0:
        return pts[0][1]
    return _keyframes(pts, (t % per) / per)


def frame_at(glyph, ms):
    """Which glyph frame shows ms after it started; the last one stays if it doesn't loop."""
    frames = glyph.get("frames") or []
    if len(frames) < 2:
        return 0, 0.0
    pos = (ms / 1000.0) * float(glyph.get("fps") or 4)
    n = int(pos)
    if glyph.get("loop", True):
        return n % len(frames), pos - n
    if n >= len(frames) - 1:
        return len(frames) - 1, 0.0
    return n, pos - n


def glyph_rgb(glyph, f, i):
    frames = glyph["frames"]
    ch = frames[f % len(frames)][i] if i < len(frames[f % len(frames)]) else "."
    if ch == ".":
        return (0, 0, 0)
    pal = glyph.get("palette") or []
    k = ord(ch) - ord("1")
    return hex_rgb(pal[k]) if 0 <= k < len(pal) else (0, 0, 0)


class Renderer:
    """Frames in, LED bytes out (GRB order is the driver's job), with the time to wait until the next change."""

    def __init__(self, n_matrix=25, n_bar=16):
        self.nm = n_matrix
        self.nb = n_bar
        self.n = n_matrix + n_bar
        self.frame = None
        self.t0 = 0.0
        self.shown = [(0.0, 0.0, 0.0)] * self.n
        self.src = list(self.shown)
        self.fade_until = 0.0
        self.last = None

    def set_frame(self, frame, now):
        """A new picture from the wall: fade from what's showing now."""
        if frame is self.frame or frame == self.frame:
            self.frame = frame
            return False
        self.src = list(self.shown)
        self.frame = frame
        self.t0 = now
        self.fade_until = now + FADE_S
        return True

    def _target(self, now):
        """(colours, when): when is 0 for "moving all the time", a time for "next step at", or None for "still"."""
        f = self.frame
        if not f:
            return [(0.0, 0.0, 0.0)] * self.n, None
        level = max(0.0, min(1.0, float(f.get("level", 1) if f.get("level") is not None else 1)))
        out = []
        when = None
        glyph = f.get("glyph")
        if glyph and glyph.get("frames"):
            ms = (now - self.t0) * 1000
            k, frac = frame_at(glyph, ms)
            fade = glyph.get("fade") and len(glyph["frames"]) > 1 and (glyph.get("loop", True) or k < len(glyph["frames"]) - 1)
            nxt = (k + 1) % len(glyph["frames"])
            for i in range(self.nm):
                a = glyph_rgb(glyph, k, i)
                if fade:
                    b = glyph_rgb(glyph, nxt, i)
                    e = _ease(frac)
                    a = tuple(x + (y - x) * e for x, y in zip(a, b))
                out.append(tuple(v * level for v in a))
            if len(glyph["frames"]) > 1 and (glyph.get("loop", True) or k < len(glyph["frames"]) - 1):
                if fade:
                    when = 0
                else:
                    fps = float(glyph.get("fps") or 4)
                    when = self.t0 + (math.floor((now - self.t0) * fps) + 1) / fps
        else:
            cells = f.get("cells") or []
            for i in range(self.nm):
                c = cells[i] if i < len(cells) else {}
                r, g, b = hex_rgb(c.get("c"))
                anim = c.get("anim") or "none"
                o = float(c.get("o", 0))
                if o > 0 and anim != "none":
                    t = now - self.t0 if anim in ONCE else now
                    k = anim_level(anim, t, c.get("p"), float(c.get("d") or 0))
                    if anim in ONCE and t < float(c.get("d") or 0) + (c.get("p") or PERIOD.get(anim, 1)):
                        when = 0
                    elif anim not in ONCE:
                        when = 0
                else:
                    k = 1.0
                out.append((r * o * k * level, g * o * k * level, b * o * k * level))
        bar = f.get("bar") or {}
        lit = int(round(self.nb * float(bar.get("pct", 0)) / 100))
        on = float(bar.get("on", 0))
        glow = float(bar.get("lit", 0))
        for j in range(self.nb):
            if j < lit and on:
                out.append((255 * level, 77 * level, 23 * level))
            else:
                k = glow * 0.5 * level
                out.append((255 * k, 228 * k, 212 * k))
        return out, when

    def render(self, now):
        """(bytes or None if nothing changed since the last write, seconds to wait or None for "until the next frame")."""
        tgt, when = self._target(now)
        if now < self.fade_until:
            e = _ease(min(1.0, (now - (self.fade_until - FADE_S)) / FADE_S))
            px = [tuple(s + (t - s) * e for s, t in zip(a, b)) for a, b in zip(self.src, tgt)]
            wait = STEP
        else:
            px = tgt
            wait = STEP if when == 0 else (max(0.0, when - now) if when else None)
        self.shown = px
        out = bytes(GAMMA[min(255, max(0, int(v + 0.5)))] for rgb in px for v in rgb)
        if out == self.last:
            return None, wait
        self.last = out
        return out, wait
