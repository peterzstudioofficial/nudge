"""The mic daemon's wake-word gate, without a microphone. Run: python3 pi-os/gpio/test_gate.py"""
import math, struct, sys, time, asyncio
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nudge_gpio as g

class FakeHub:
    def __init__(self): self.raw = []
    def send_raw(self, m): self.raw.append(m["type"])
g._hub_ref = FakeHub()
m = g.Mic()
m.wake_on = True
def chunk(amp, freq=220):
    return b"".join(struct.pack("<h", int(amp * math.sin(2 * math.pi * freq * i / 16000))) for i in range(1600))
quiet, loud = chunk(60), chunk(4000)
for _ in range(50): m._on_chunk(quiet)          # 5 s of a quiet room
assert len(g._hub_ref.raw) == 0, "a quiet room must send nothing"
for _ in range(10): m._on_chunk(loud)           # 1 s of speech
n = g._hub_ref.raw.count("wake-audio")
for _ in range(15): m._on_chunk(quiet)          # silence after
assert n >= 10 and "wake-gap" in g._hub_ref.raw, "speech must open the gate, then close it"
total = len(g._hub_ref.raw)
for _ in range(100): m._on_chunk(quiet)
assert len(g._hub_ref.raw) == total, "quiet again must send nothing"
# a question after the wake word streams with pre-roll, then stops at the pause
g._hub_ref.raw.clear()
m._sync = lambda: None
for _ in range(12): m.ring.append(loud)
m.listen(preroll=True)
for _ in range(8): m._on_chunk(loud)
for _ in range(14): m._on_chunk(quiet)
assert g._hub_ref.raw.count("voice-audio") >= 20 and g._hub_ref.raw[-1] == "voice-end" and m.streaming is None, "the question streams with pre-roll and stops at the pause"
t0 = time.perf_counter()
for _ in range(1000): g.Mic.rms(loud)
print("gate ok — cost per 0.1 s of audio: %.3f ms" % ((time.perf_counter() - t0)))
