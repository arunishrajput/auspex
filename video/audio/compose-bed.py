"""
The music bed, synthesised from the film's own timing data.

Additive synthesis only: every voice is a sum of sines, so no recursive filter is
needed and the whole thing is vectorised. Space comes from a handful of delay taps
rather than a reverb tail, which is cheaper and stays out of the voiceover's way.

Three things are driven directly by script/timings.json rather than guessed:
  - the intensity curve follows the scene boundaries,
  - the bed ducks under every measured voiceover line,
  - and it drops to near silence for the beat-7 hold, so "Reverted" lands in silence.
"""
import json, pathlib, wave
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 48_000
TOTAL = 240.0
T = json.loads((ROOT / "script" / "timings.json").read_text())

n = int(TOTAL * SR)
t = np.arange(n) / SR

scenes = {s["id"]: s for s in T["scenes"]}
INTENSITY = {
    "s1_thesis": 0.30, "s2_problem": 0.44, "s3_boundary": 0.60, "s4_pipeline": 0.60,
    "s5_gate": 0.66, "s6_agents": 0.78, "s7_refusal": 0.92, "s8_honesty": 0.34,
    "s9_verify": 0.58,
}
pts_t = [0.0]
pts_v = [0.0]
for s in T["scenes"]:
    pts_t.append(s["start"]); pts_v.append(INTENSITY[s["id"]])
pts_t += [T["total"], TOTAL]; pts_v += [0.62, 0.50]
intensity = np.interp(t, pts_t, pts_v)

# --- the beat-7 hold: silence around "Reverted." -------------------------------
s7 = scenes["s7_refusal"]
drop_from = s7["lines"][3]["end"]          # after "...one wei more than its on-chain cap."
drop_to = s7["lines"][4]["end"] + 0.55     # through "Reverted." and a beat after
ramp = 0.45
drop = np.ones(n)
drop = np.where((t > drop_from - ramp) & (t < drop_from), 1 - (t - (drop_from - ramp)) / ramp, drop)
drop = np.where((t >= drop_from) & (t <= drop_to), 0.0, drop)
drop = np.where((t > drop_to) & (t < drop_to + 1.6), (t - drop_to) / 1.6, drop)
intensity = intensity * np.clip(drop, 0, 1)

def lfo(rate, depth, phase=0.0):
    return 1.0 - depth + depth * (0.5 + 0.5 * np.sin(2 * np.pi * rate * t + phase))

# --- drone: D1/D2/A2/D3, slightly detuned ---------------------------------------
drone = np.zeros(n)
for f, g, d in [(36.71, 0.55, 0.0), (73.42, 0.40, 1.1), (110.00, 0.22, 2.2), (146.83, 0.16, 3.3)]:
    drone += g * np.sin(2 * np.pi * f * t + d) * lfo(0.031, 0.35, d)
    drone += g * 0.45 * np.sin(2 * np.pi * (f * 1.0023) * t + d)   # detuned twin, slow beating

# --- pad: D minor stack, breathing ----------------------------------------------
pad = np.zeros(n)
for f, g, ph in [(293.66, 0.16, 0.0), (349.23, 0.13, 1.7), (440.00, 0.10, 3.1), (523.25, 0.07, 4.6)]:
    pad += g * np.sin(2 * np.pi * f * t + ph) * lfo(0.017, 0.55, ph)

# --- arpeggio: sparse pentatonic plucks -----------------------------------------
arp = np.zeros(n)
notes = [587.33, 698.46, 880.00, 1046.50, 880.00, 698.46]   # D5 F5 A5 C6 A5 F5
step = 60.0 / 76.0 * 2          # every two beats at 76bpm
env_len = int(1.3 * SR)
env_t = np.arange(env_len) / SR
k = 0
pos = 4.0
while pos < TOTAL - 1.4:
    i = int(pos * SR)
    amp = float(np.interp(pos, t, intensity))
    if amp > 0.48:
        f = notes[k % len(notes)]
        pluck = (np.sin(2 * np.pi * f * env_t) + 0.3 * np.sin(2 * np.pi * f * 2 * env_t)) * np.exp(-env_t / 0.34)
        arp[i:i + env_len] += pluck * 0.085 * amp
    pos += step
    k += 1

# --- air: band-limited noise, via one spectral mask ------------------------------
rng = np.random.default_rng(20260929)
noise = rng.standard_normal(n)
spec = np.fft.rfft(noise)
freqs = np.fft.rfftfreq(n, 1 / SR)
spec *= np.exp(-((freqs - 3200) ** 2) / (2 * 1800 ** 2))
air = np.fft.irfft(spec, n)
air /= (np.max(np.abs(air)) + 1e-9)
air *= 0.05 * lfo(0.013, 0.7)

mono = drone * 0.19 + pad * 0.5 + arp + air
mono *= intensity

# --- impact on "Reverted." -------------------------------------------------------
imp_at = s7["lines"][4]["start"]
imp_len = int(2.2 * SR)
it = np.arange(imp_len) / SR
impact = (np.sin(2 * np.pi * 47 * it) * np.exp(-it / 0.55) * 0.5
          + np.sin(2 * np.pi * 94 * it) * np.exp(-it / 0.30) * 0.2
          + rng.standard_normal(imp_len) * np.exp(-it / 0.05) * 0.06)
i0 = int(imp_at * SR)
mono[i0:i0 + imp_len] += impact[: max(0, min(imp_len, n - i0))]

# --- ticks at scene starts --------------------------------------------------------
tick_len = int(0.09 * SR)
tt = np.arange(tick_len) / SR
tick = np.sin(2 * np.pi * 1180 * tt) * np.exp(-tt / 0.018) * 0.035
for s in T["scenes"][1:]:
    i = int(s["start"] * SR)
    mono[i:i + tick_len] += tick[: max(0, min(tick_len, n - i))]

# --- space: a few delay taps, offset per channel ----------------------------------
def tapped(sig, taps):
    out = sig.copy()
    for delay, gain in taps:
        d = int(delay * SR)
        out[d:] += sig[:-d] * gain
    return out

left = tapped(mono, [(0.083, 0.30), (0.171, 0.19), (0.293, 0.12), (0.517, 0.07)])
right = tapped(mono, [(0.097, 0.30), (0.189, 0.19), (0.311, 0.12), (0.541, 0.07)])

# --- duck under every measured voiceover line --------------------------------------
duck = np.ones(n)
fade = int(0.28 * SR)
ramp_in = np.linspace(1.0, 0.30, fade)
ramp_out = np.linspace(0.30, 1.0, fade)
for s in T["scenes"]:
    for ln in s["lines"]:
        a, b = int(ln["start"] * SR), int(ln["end"] * SR)
        duck[max(0, a - fade):a] = np.minimum(duck[max(0, a - fade):a], ramp_in[: a - max(0, a - fade)])
        duck[a:b] = 0.30
        e = min(n, b + fade)
        duck[b:e] = np.minimum(duck[b:e], ramp_out[: e - b])

left *= duck
right *= duck

# top and tail
head = int(2.5 * SR); tail = int(5.0 * SR)
left[:head] *= np.linspace(0, 1, head); right[:head] *= np.linspace(0, 1, head)
left[-tail:] *= np.linspace(1, 0, tail); right[-tail:] *= np.linspace(1, 0, tail)

stereo = np.stack([left, right], axis=1)
stereo /= (np.max(np.abs(stereo)) + 1e-9)
stereo *= 0.62

out = ROOT / "audio" / "bed.wav"
with wave.open(str(out), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((stereo * 32767).astype("<i2").tobytes())

print(f"bed.wav  {TOTAL:.1f}s  peak {np.max(np.abs(stereo)):.3f}")
print(f"  drop (silence) {drop_from:.1f}s -> {drop_to:.1f}s   impact at {imp_at:.1f}s")
print(f"  ducked under {sum(len(s['lines']) for s in T['scenes'])} voiceover lines")
