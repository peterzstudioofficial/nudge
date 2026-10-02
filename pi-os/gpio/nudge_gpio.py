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

from lights import Renderer

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
        self.frame_event = asyncio.Event()

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
                                self.frame_event.set()
                            elif msg.get("type") == "play":
                                play_audio(msg.get("pcm") or "", int(msg.get("rate") or 24000))
                            elif msg.get("type") == "wake-config" and MIC:
                                MIC.set_wake(bool(msg.get("on")))
                            elif msg.get("type") == "wake" and MIC:
                                # "nudge" was heard: the wall lights up and the question streams
                                self.send({"kind": "touch"})
                                MIC.listen(preroll=True)
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
        mic.when_pressed = lambda: (emit({"kind": "mic", "on": True}), loop.call_soon_threadsafe(lambda: MIC and MIC.set_hw(True)))
        mic.when_released = lambda: (emit({"kind": "mic", "on": False}), loop.call_soon_threadsafe(lambda: MIC and MIC.set_hw(False)))
        parts["mic"] = mic
        power = Button(PINS["power"], pull_up=True, bounce_time=0.05)
        power.when_pressed = lambda: emit({"kind": "power", "on": True})
        power.when_released = lambda: emit({"kind": "power", "on": False})
        parts["power"] = power
        # report switch positions once at start
        emit({"kind": "mic", "on": mic.is_pressed})
        loop.call_soon_threadsafe(lambda on=mic.is_pressed: MIC and MIC.set_hw(on))
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

_hub_ref: "Hub | None" = None


class Mic:
    """The one owner of the microphone.

    Two jobs, one recording process (and none at all when neither is needed, to save power):
      - wake word: a cheap loudness gate runs here; only while someone is talking does audio go to
        the hub, where the small keyword spotter looks for "nudge". Silence never leaves this loop.
      - a question: after the touch pad or the wake word, audio streams to the hub (Gemini Live, or
        on-device speech-to-text) until the speaker pauses. The last ~1.2 s before the wake word is
        included, so "nudge, what's next" arrives whole.
    Nothing is ever written to disk. The hardware mic switch cuts the mic's power and wins over all.
    """

    CHUNK = 3200          # 0.1 s of 16 kHz 16-bit mono
    PREROLL = 12          # chunks kept for "nudge, …" (1.2 s)

    def __init__(self):
        from collections import deque

        self.proc = None
        self.reader = None
        self.wake_on = False
        self.hw_on = True        # mic switch
        self.ring = deque(maxlen=self.PREROLL)
        self.floor = 300.0       # running noise floor (RMS)
        self.open_for = 0.0      # seconds the wake gate stays open
        self.streaming = None    # dict while a question is being streamed
        self.ignore_until = 0.0  # don't re-trigger straight after a question

    # -- control -----------------------------------------------------------
    def set_wake(self, on: bool):
        self.wake_on = bool(on)
        self._sync()

    def set_hw(self, on: bool):
        self.hw_on = bool(on)
        if not on:
            self.streaming = None
        self._sync()

    def listen(self, preroll: bool):
        """Start streaming a question (touch pad or wake word)."""
        if not self.hw_on or self.streaming is not None:
            return
        self.streaming = {"heard": False, "silent": 0.0, "waited": 0.0, "total": 0.0}
        if preroll and _hub_ref:
            for c in list(self.ring):
                self._send_voice(c)
        self.ring.clear()
        self._sync()

    # -- the recording process ----------------------------------------------
    def _wanted(self) -> bool:
        return self.hw_on and (self.wake_on or self.streaming is not None)

    def _sync(self):
        if self._wanted() and self.reader is None:
            self.reader = asyncio.ensure_future(self._run())
        elif not self._wanted() and self.proc is not None:
            try:
                self.proc.terminate()
            except ProcessLookupError:
                pass

    async def _run(self):
        try:
            self.proc = await asyncio.create_subprocess_exec(
                "arecord", "-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
            assert self.proc.stdout
            while self._wanted():
                try:
                    chunk = await self.proc.stdout.readexactly(self.CHUNK)
                except asyncio.IncompleteReadError:
                    break
                self._on_chunk(chunk)
        except FileNotFoundError:
            log("no arecord: voice off")
        except Exception as e:  # noqa: BLE001
            log("mic stopped:", e)
        finally:
            if self.proc and self.proc.returncode is None:
                self.proc.terminate()
            self.proc = None
            self.reader = None
            if self.streaming is not None:
                self._end()
        if self._wanted():  # e.g. arecord hiccup: try again shortly
            await asyncio.sleep(1)
            self._sync()

    # -- per 0.1 s ------------------------------------------------------------
    @staticmethod
    def rms(chunk: bytes) -> float:
        import array

        a = array.array("h", chunk)
        s = a[::4]  # every 4th sample is plenty for a loudness gate
        return math.sqrt(sum(x * x for x in s) / max(1, len(s)))

    def _on_chunk(self, chunk: bytes):
        level = self.rms(chunk)
        st = self.streaming
        if st is not None:
            self._send_voice(chunk)
            st["total"] += 0.1
            if level >= max(800, self.floor * 3):
                st["heard"] = True
                st["silent"] = 0.0
            else:
                st["silent"] += 0.1
                st["waited"] += 0.1
            # Stop after a pause once they've spoken, if nothing was said, or after 12 s.
            if (st["heard"] and st["silent"] > 1.2) or (not st["heard"] and st["waited"] > 3.0) or st["total"] > 12:
                self._end()
            return
        self.ring.append(chunk)
        if not self.wake_on or time.monotonic() < self.ignore_until:
            return
        loud = level > max(350.0, self.floor * 2.5)
        if not loud and self.open_for <= 0:
            # quiet: learn the room's noise floor slowly
            self.floor = self.floor * 0.98 + level * 0.02
            return
        if loud:
            if self.open_for <= 0 and _hub_ref:
                # gate opens: send the moment before it too
                for c in list(self.ring)[-5:-1]:
                    _hub_ref.send_raw({"type": "wake-audio", "pcm": _b64(c)})
            self.open_for = 1.0
        if _hub_ref:
            _hub_ref.send_raw({"type": "wake-audio", "pcm": _b64(chunk)})
        self.open_for -= 0.1
        if self.open_for <= 0 and _hub_ref:
            _hub_ref.send_raw({"type": "wake-gap"})

    def _send_voice(self, chunk: bytes):
        if _hub_ref:
            _hub_ref.send_raw({"type": "voice-audio", "pcm": _b64(chunk)})

    def _end(self):
        self.streaming = None
        self.ignore_until = time.monotonic() + 2.0
        self.open_for = 0
        if _hub_ref:
            _hub_ref.send_raw({"type": "voice-end"})
        self._sync()


def _b64(chunk: bytes) -> str:
    import base64

    return base64.b64encode(chunk).decode()


MIC = None


def start_listening():
    """Touch pad pressed: stream the question (no pre-roll: it starts now)."""
    if MIC:
        MIC.listen(preroll=False)


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


class Lights:
    """The WS2812 chain and the dial LED. What to show is worked out by lights.Renderer."""

    def __init__(self):
        self.strip = None
        self.dial = None
        self.dial_v = -1.0
        try:
            from rpi_ws281x import PixelStrip  # pip install rpi-ws281x

            n = LED_MATRIX + LED_BAR
            # GPIO 10 = SPI; leaves PWM audio free on the Pi 3. LED_BRIGHTNESS caps the current.
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

    def write(self, rgb: bytes):
        if not self.strip:
            return
        from rpi_ws281x import Color

        for i in range(min(self.strip.numPixels(), len(rgb) // 3)):
            self.strip.setPixelColor(i, Color(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]))
        self.strip.show()

    def dial_to(self, v: float):
        v = round(max(0.0, min(1.0, v)), 2)
        if self.dial and v != self.dial_v:
            self.dial_v = v
            self.dial.value = v

    def off(self):
        self.write(bytes(3 * (LED_MATRIX + LED_BAR)))
        self.dial_to(0)


async def light_loop(hub: Hub, lights: Lights):
    """Draw when the picture changes or something on it moves; otherwise sleep until the next frame."""
    r = Renderer(LED_MATRIX, LED_BAR)
    while True:
        now = time.monotonic()
        f = hub.frame
        r.set_frame(f, now)
        out, wait = r.render(now)
        if out is not None:
            lights.write(out)
        if f:
            lights.dial_to(float(f.get("dialLed", 0)) * float(f.get("level", 1) or 1))
        hub.frame_event.clear()
        try:
            await asyncio.wait_for(hub.frame_event.wait(), timeout=wait)
        except asyncio.TimeoutError:
            pass


# ----------------------------------------------------------------------------- main


async def main():
    global _hub_ref, MIC
    hub = Hub()
    _hub_ref = hub
    MIC = Mic()
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
        r = Renderer(LED_MATRIX, LED_BAR)
        for k in range(26):
            r.set_frame({"cells": [{"c": "#ff4d17", "o": 1 if i == k else 0, "anim": "none"} for i in range(25)], "bar": {"pct": k * 4, "on": 1, "lit": 0.1}, "dialLed": k / 25}, 0)
            out, _ = r.render(1)
            if out:
                lights.write(out)
            lights.dial_to(k / 25)
            time.sleep(0.05)
        lights.off()
        print("selftest done")
        sys.exit(0)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
