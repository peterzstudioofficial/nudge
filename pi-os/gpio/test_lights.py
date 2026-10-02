"""Checks for the light engine (no hardware needed): python3 pi-os/gpio/test_lights.py"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lights import GAMMA, Renderer, anim_level, frame_at  # noqa: E402

OFF = {"c": "#000000", "o": 0, "anim": "none"}


def frame(cells=None, glyph=None, level=1.0, pct=0):
    return {"cells": cells or [OFF] * 25, "bar": {"pct": pct, "on": 1, "lit": 0}, "dialLed": 0, "touchRing": False, "glyph": glyph, "level": level}


def test_gamma():
    assert GAMMA[0] == 0 and GAMMA[255] == 255
    assert all(GAMMA[i] <= GAMMA[i + 1] for i in range(255))
    assert GAMMA[128] < 64  # dim levels get room to breathe


def test_still_picture_is_drawn_once_then_sleeps():
    r = Renderer()
    f = frame([{"c": "#ff4d17", "o": 1, "anim": "none"}] + [OFF] * 24)
    r.set_frame(f, 0)
    out, wait = r.render(0.0)
    assert out is not None and wait is not None  # fading in
    out, wait = r.render(0.5)  # fade done
    assert out[0] == 255 and wait is None, (out[:3], wait)
    out, wait = r.render(5.0)
    assert out is None and wait is None  # nothing changed: no LED write, nothing to wake for
    # the same picture again changes nothing
    assert r.set_frame(dict(f), 6) is False


def test_moving_cells_tick_at_30fps():
    r = Renderer()
    r.set_frame(frame([{"c": "#ff4d17", "o": 1, "anim": "lPulse", "p": 1.4, "d": 0}] + [OFF] * 24), 0)
    r.render(1.0)
    _, wait = r.render(1.0)
    assert abs(wait - 1 / 30) < 1e-9
    assert abs(anim_level("lPulse", 0.7, 1.4) - 1.0) < 1e-9
    assert abs(anim_level("lPulse", 0.0, 1.4) - 0.16) < 1e-9
    assert anim_level("lRise", 10, 0.55) == 1.0  # plays once, then holds


def test_crossfade():
    r = Renderer()
    r.set_frame(frame([{"c": "#ffffff", "o": 1, "anim": "none"}] * 25), 0)
    r.render(1)
    r.set_frame(frame(), 2.0)
    out, _ = r.render(2.0 + 0.11)  # half way
    assert 0 < out[0] < 255, out[0]
    out, wait = r.render(2.5)
    assert out[0] == 0 and wait is None


def test_glyph_steps_at_its_own_speed():
    g = {"palette": ["#ffffff"], "frames": ["1" * 25, "." * 25], "fps": 4, "loop": True, "fade": False}
    r = Renderer()
    r.set_frame(frame(glyph=g), 0)
    r.render(0.3)
    out, wait = r.render(0.3)  # frame 1 (dark) at 0.25-0.5 s
    assert abs(wait - 0.2) < 1e-6, wait
    assert frame_at(g, 260)[0] == 1
    once = dict(g, loop=False)
    r.set_frame(frame(glyph=once), 10)
    r.render(11)
    _, wait = r.render(11)
    assert wait is None  # finished: holds the last frame, sleeps


def test_brightness_level():
    r = Renderer()
    r.set_frame(frame([{"c": "#ffffff", "o": 1, "anim": "none"}] * 25, level=0.1), 0)
    out, _ = r.render(1)
    assert 0 < out[0] < 10, out[0]


def test_cost_per_draw():
    r = Renderer()
    r.set_frame(frame([{"c": "#ff4d17", "o": 1, "anim": "lSpark", "p": 1.1, "d": i * 0.05} for i in range(25)], pct=50), 0)
    n = 300
    t = time.perf_counter()
    for k in range(n):
        r.render(1 + k / 30)
    ms = (time.perf_counter() - t) * 1000 / n
    print(f"  one animated draw: {ms:.3f} ms")
    assert ms < 5


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
    print("lights ok")
