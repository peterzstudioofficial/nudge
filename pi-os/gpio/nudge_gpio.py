#!/usr/bin/env python3
"""
Nudge ND-1 hardware daemon.

Reads the physical controls and drives the lights, talking to the hub on this Pi over its
local WebSocket (the hub only accepts hardware traffic from 127.0.0.1).

  inputs  -> hub -> wall screen : 4 keys, rotary dial (+ push), touch pad, mic switch,
                                  power switch, NFC tag reader, voice (optional)
  outputs <- hub <- wall screen : 5x5 LED matrix + light bar (WS2812), dial LED

Every part is optional: missing hardware or libraries just switch that part off, so the same
daemon runs on a bare Pi with only a touchscreen.

Wiring (BCM numbering) — see pi-os/README.md for the full table:
  keys 1-4   GPIO 5, 6, 13, 19  (to GND, internal pull-ups)
  dial       A GPIO 17, B GPIO 27, push GPIO 22
  touch pad  GPIO 26            (TTP223 module, active high)
  mic switch GPIO 16            (closed = mic on; the other pole cuts the mic's power)
  power      GPIO 20            (closed = on)
  WS2812     GPIO 10 (SPI MOSI) 25 matrix LEDs then 16 light-bar LEDs, one chain
  dial LED   GPIO 12 (PWM)
"""

import asyncio
import json
import math
import os
import signal
import sys
import time

HUB = os.environ.get("NUDGE_HUB_WS", "ws://127.0.0.1:8788/api/ws")
PINS = {
    "keys": [5, 6, 13, 19],
    "enc_a": 17,
    "enc_b": 27,
    "enc_btn": 22,
    "touch": 26,
    "mic": 16,
    "power": 20,
    "dial_led": 12,
}
LED_MATRIX = 25
LED_BAR = int(os.environ.get("NUDGE_BAR_LEDS", "16"))
LED_BRIGHTNESS = float(os.environ.get("NUDGE_LED_BRIGHTNESS", "0.35"))
NFC_DEVICE = os.environ.get("NUDGE_NFC_DEVICE", "")  # e.g. /dev/input/by-id/usb-…-event-kbd


def log(*a):
    print("[nudge-gpio]", *a, flush=True)


class Hub:
    """Tiny reconnecting WebSocket client."""

    def __init__(self):
        self.ws = None
        self.queue: asyncio.Queue = asyncio.Queue()
        self.frame = None
        self.frame_at = 0.0

    async def run(self):
        import websockets  # python3-websockets

        while True:
            try:
                async with websockets.connect(HUB, max_size=2**20, ping_interval=20) as ws:
                    self.ws = ws
                    await ws.send(json.dumps({"type": "auth", "token": None}))
                    log("connected to hub")
                    sender = asyncio.create_task(self._send_loop(ws))
                    try:
                        async for raw in ws:
                            try:
                                msg = json.loads(raw)
                            except ValueError:
                                continue
                            if msg.get("type") == "leds":
                                self.frame = msg.get("frame")
                                self.frame_at = time.monotonic()
                            elif msg.get("type") == "play":
                                play_audio(msg.get("pcm") or "", int(msg.get("rate") or 24000))
                    finally:
                        sender.cancel()
            except Exception as e:  # noqa: BLE001 - keep the daemon alive whatever happens
                log("hub connection lost:", e)
            self.ws = None
            await asyncio.sleep(2)

    async def _send_loop(self, ws):
        while True:
            item = await self.queue.get()
            raw = item.pop("__raw", None) if isinstance(item, dict) else None
            await ws.send(json.dumps(raw if raw is not None else {"type": "input", "input": item}))

    def send(self, item: dict):
        self.queue.put_nowait(item)

    def send_raw(self, msg: dict):
        """A message that isn't a hardware input (e.g. microphone audio for the assistant)."""
        self.queue.put_nowait({"__raw": msg})


# ----------------------------------------------------------------------------- inputs


def setup_inputs(hub: Hub, loop: asyncio.AbstractEventLoop):
    try:
        from gpiozero import Button, RotaryEncoder
    except Exception as e:  # noqa: BLE001
        log("gpiozero not available, no physical controls:", e)
        return {}

    def emit(item):
        loop.call_soon_threadsafe(hub.send, item)

    parts = {}
    try:
        for i, pin in enumerate(PINS["keys"]):
            b = Button(pin, pull_up=True, bounce_time=0.02)
            b.when_pressed = lambda i=i: emit({"kind": "key", "key": i, "down": True})
            b.when_released = lambda i=i: emit({"kind": "key", "key": i, "down": False})
            parts[f"key{i}"] = b
        enc = RotaryEncoder(PINS["enc_a"], PINS["enc_b"], max_steps=0, bounce_time=0.002)
        enc.when_rotated_clockwise = lambda: emit({"kind": "dial", "delta": 1})
        enc.when_rotated_counter_clockwise = lambda: emit({"kind": "dial", "delta": -1})
        parts["enc"] = enc
        push = Button(PINS["enc_btn"], pull_up=True, bounce_time=0.03)
        push.when_pressed = lambda: emit({"kind": "dialPress"})
        parts["push"] = push
        touch = Button(PINS["touch"], pull_up=False, bounce_time=0.05)
        touch.when_pressed = lambda: (emit({"kind": "touch"}), loop.call_soon_threadsafe(start_listening))
        parts["touch"] = touch
        mic = Button(PINS["mic"], pull_up=True, bounce_time=0.05)
        mic.when_pressed = lambda: emit({"kind": "mic", "on": True})
        mic.when_released = lambda: emit({"kind": "mic", "on": False})
        parts["mic"] = mic
        power = Button(PINS["power"], pull_up=True, bounce_time=0.05)
        power.when_pressed = lambda: emit({"kind": "power", "on": True})
        power.when_released = lambda: emit({"kind": "power", "on": False})
        parts["power"] = power
        # report switch positions once at start
        emit({"kind": "mic", "on": mic.is_pressed})
        emit({"kind": "power", "on": power.is_pressed})
        log("controls ready")
    except Exception as e:  # noqa: BLE001
        log("some controls unavailable:", e)
    return parts


async def nfc_reader(hub: Hub):
    """USB NFC/RFID readers that act as keyboards: grab the device and read tag IDs."""
    if not NFC_DEVICE:
        return
    try:
        import evdev  # python3-evdev
    except Exception as e:  # noqa: BLE001
        log("evdev not available, no NFC:", e)
        return
    keymap = {f"KEY_{i}": str(i) for i in range(10)}
    keymap.update({f"KEY_{c}": c for c in "ABCDEF"})
    while True:
        try:
            dev = evdev.InputDevice(NFC_DEVICE)
            dev.grab()  # keep tag digits away from the kiosk (they'd look like key presses)
            log("NFC reader ready:", dev.name)
            buf = ""
            async for ev in dev.async_read_loop():
                if ev.type != evdev.ecodes.EV_KEY or ev.value != 1:
                    continue
                name = evdev.ecodes.KEY.get(ev.code)
                if isinstance(name, list):
                    name = name[0]
                if name == "KEY_ENTER":
                    if len(buf) >= 4:
                        hub.send({"kind": "nfc", "uid": buf[:40]})
                    buf = ""
                elif name in keymap:
                    buf += keymap[name]
        except Exception as e:  # noqa: BLE001
            log("NFC reader error:", e)
            await asyncio.sleep(5)


# ----------------------------------------------------------------------------- voice

_listen_task = None
_hub_ref: "Hub | None" = None


def start_listening():
    """Touch pad pressed: stream the microphone to the hub until the student stops talking.

    The hub decides what to do with it: Gemini Live if that's set up, otherwise on-device
    speech-to-text on the Pi. Nothing is recorded to disk.
    """
    global _listen_task
    if _listen_task and not _listen_task.done():
        return
    _listen_task = asyncio.ensure_future(stream_voice())


async def stream_voice():
    if _hub_ref is None:
        return
    import base64

    proc = await asyncio.create_subprocess_exec(
        "arecord", "-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-d", "12", "-t", "raw",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    heard_any = False
    silent_for = 0.0
    waited = 0.0
    assert proc.stdout
    try:
        while True:
            chunk = await proc.stdout.read(8000)  # 0.25 s
            if not chunk:
                break
            _hub_ref.send_raw({"type": "voice-audio", "pcm": base64.b64encode(chunk).decode()})
            level = max(abs(int.from_bytes(chunk[i:i + 2], "little", signed=True)) for i in range(0, len(chunk) - 1, 64))
            if level >= 800:
                heard_any = True
                silent_for = 0.0
            else:
                silent_for += 0.25
                waited += 0.25
            # Stop after a pause once they've spoken, or if nothing was said at all.
            if (heard_any and silent_for > 1.2) or (not heard_any and waited > 3.0):
                break
    finally:
        if proc.returncode is None:
            proc.terminate()
        _hub_ref.send_raw({"type": "voice-end"})


_player = None


def play_audio(pcm_b64: str, rate: int):
    """Spoken replies (only if they're switched on in setup): 16-bit mono PCM to the speaker."""
    global _player
    import base64
    import subprocess

    if not pcm_b64:
        return
    try:
        if _player is None or _player.poll() is not None or getattr(_player, "_rate", 0) != rate:
            _player = subprocess.Popen(["aplay", "-q", "-f", "S16_LE", "-r", str(rate), "-c", "1", "-t", "raw"], stdin=subprocess.PIPE)
            _player._rate = rate  # type: ignore[attr-defined]
        _player.stdin.write(base64.b64decode(pcm_b64))  # type: ignore[union-attr]
        _player.stdin.flush()  # type: ignore[union-attr]
    except Exception as e:  # noqa: BLE001
        log("can't play audio:", e)
        _player = None


# ----------------------------------------------------------------------------- lights


def hex_rgb(c: str):
    c = (c or "#000000").lstrip("#")
    if len(c) != 6:
        return (0, 0, 0)
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def anim_level(name: str, t: float, delay: float = 0.0) -> float:
    """Approximate the CSS keyframes from the design, 0..1."""
    t = t - delay
    if name in ("lPulse", "lSpark", "lSweep"):
        period = 1.4 if name == "lPulse" else 1.1
        return 0.15 + 0.85 * (0.5 - 0.5 * math.cos(2 * math.pi * t / period))
    if name in ("lDrift",):
        return 0.6 + 0.4 * (0.5 - 0.5 * math.cos(2 * math.pi * t / 6.5))
    if name == "lBreathe":
        p = (t % 16) / 16
        return 0.1 + 0.8 * (p * 4 if p < 0.25 else 1 if p < 0.5 else 1 - (p - 0.5) * 4 if p < 0.75 else 0)
    if name == "lAlarm":
        p = (t % 0.85) / 0.85
        return 1.0 if 0.22 < p < 0.54 else 0.06
    return 1.0


class Lights:
    def __init__(self):
        self.strip = None
        self.dial = None
        try:
            from rpi_ws281x import PixelStrip  # pip install rpi-ws281x

            n = LED_MATRIX + LED_BAR
            # GPIO 10 = SPI; leaves PWM audio free on the Pi 3.
            self.strip = PixelStrip(n, 10, 800000, 10, False, int(255 * LED_BRIGHTNESS), 0)
            self.strip.begin()
            log(f"LED chain ready ({n} LEDs)")
        except Exception as e:  # noqa: BLE001
            log("no WS2812 LEDs:", e)
        try:
            from gpiozero import PWMLED

            self.dial = PWMLED(PINS["dial_led"])
        except Exception:  # noqa: BLE001
            self.dial = None

    def draw(self, frame, t: float):
        if frame is None:
            return
        if self.strip:
            from rpi_ws281x import Color

            for i, cell in enumerate(frame.get("cells", [])[:LED_MATRIX]):
                r, g, b = hex_rgb(cell.get("c"))
                k = float(cell.get("o", 0)) * anim_level(cell.get("anim", "none"), t, (i % 5) * 0.09)
                self.strip.setPixelColor(i, Color(int(r * k), int(g * k), int(b * k)))
            bar = frame.get("bar", {})
            lit = int(round(LED_BAR * float(bar.get("pct", 0)) / 100))
            on = float(bar.get("on", 0))
            glow = float(bar.get("lit", 0))
            for j in range(LED_BAR):
                if j < lit and on:
                    col = (255, 77, 23)
                    k = 1.0
                else:
                    col = (255, 228, 212)
                    k = glow * 0.5
                self.strip.setPixelColor(LED_MATRIX + j, Color(int(col[0] * k), int(col[1] * k), int(col[2] * k)))
            self.strip.show()
        if self.dial:
            self.dial.value = max(0.0, min(1.0, float(frame.get("dialLed", 0))))

    def off(self):
        if self.strip:
            from rpi_ws281x import Color

            for i in range(self.strip.numPixels()):
                self.strip.setPixelColor(i, Color(0, 0, 0))
            self.strip.show()


async def light_loop(hub: Hub, lights: Lights):
    t0 = time.monotonic()
    while True:
        lights.draw(hub.frame, time.monotonic() - t0)
        await asyncio.sleep(1 / 30)


# ----------------------------------------------------------------------------- main


async def main():
    global _hub_ref
    hub = Hub()
    _hub_ref = hub
    loop = asyncio.get_running_loop()
    parts = setup_inputs(hub, loop)
    lights = Lights()
    stop = asyncio.Event()
    for s in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(s, stop.set)
    tasks = [
        asyncio.create_task(hub.run()),
        asyncio.create_task(light_loop(hub, lights)),
        asyncio.create_task(nfc_reader(hub)),
    ]
    await stop.wait()
    for t in tasks:
        t.cancel()
    lights.off()
    for p in parts.values():
        try:
            p.close()
        except Exception:  # noqa: BLE001
            pass
    log("stopped")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        # Quick check that the lights and inputs initialise, without a hub.
        lights = Lights()
        for k in range(26):
            lights.draw({"cells": [{"c": "#ff4d17", "o": 1 if i == k else 0, "anim": "none"} for i in range(25)], "bar": {"pct": k * 4, "on": 1, "lit": 0.1}, "dialLed": k / 25}, 0)
            time.sleep(0.05)
        lights.off()
        print("selftest done")
        sys.exit(0)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
