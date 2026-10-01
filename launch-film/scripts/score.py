"""
The score and sound effects, synthesised from scratch so nothing in the film carries a licence
question. Reads src/data/timeline.json and captions.json so every hit lands on the frame the
picture changes, and ducks itself under the narration rather than relying on a mixer to.

    .venv/bin/python scripts/score.py   ->  public/audio/score.wav, public/sfx/*.wav
"""
import json
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)

tl = json.load(open("src/data/timeline.json"))
caps = json.load(open("src/data/captions.json"))
FPS = tl["fps"]
TOTAL = tl["durationInFrames"] / FPS + 0.5
N = int(TOTAL * SR)
scene = {s["id"]: s for s in tl["scenes"]}


def t_scene(sid):
    return scene[sid]["from"] / FPS


def t_phrase(sid, i, edge="start"):
    s = scene[sid]
    return (s["from"] + s["voFrom"]) / FPS + caps[sid]["phrases"][i][edge]


# ---------------------------------------------------------------- primitives
def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def lp(x, hz, order=2):
    return sosfilt(butter(order, hz, "low", fs=SR, output="sos"), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def saw(f, n, harm=10, phase=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, harm + 1):
        if f * k > SR / 2.2:
            break
        out += np.sin(2 * np.pi * f * k * t + phase * k) / k
    return out


def env_adsr(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    na, nr = min(na, n), min(nr, n)
    e[:na] = np.linspace(0, 1, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def add(buf, x, t, gain=1.0):
    i = int(t * SR)
    if i >= len(buf) or i + len(x) <= 0:
        return
    j0 = max(0, -i)
    x = x[j0:]
    i = max(i, 0)
    m = min(len(x), len(buf) - i)
    buf[i:i + m] += x[:m] * gain


def reverb(x, secs=2.6, mix=0.28, tone=5000):
    n = int(secs * SR)
    ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 7, n))
    ir = lp(ir, tone)
    wet = fftconvolve(x, ir)[: len(x)]
    wet /= np.max(np.abs(wet)) + 1e-9
    dry = x / (np.max(np.abs(x)) + 1e-9)
    return (1 - mix) * dry + mix * wet


# ---------------------------------------------------------------- sections
# Each scene gets an intensity: which layers play. Changes are quantised to the bar so the music
# moves like music; the hits are not quantised, because they belong to the picture.
SECTION = {
    "hook": "intro", "title": "lift", "overview": "groove", "pipeline": "groove", "review": "groove",
    "injection": "groove", "agents": "drive", "layers": "drive", "probe": "tension", "revert": "drive",
    "honest": "groove", "roles": "groove", "resolution": "drive", "market8": "drive", "audit": "groove",
    "close": "outro",
}
LAYERS = {
    "intro":   dict(pad=0.55, cutoff=700,  bass=0.0, kick=0.0, hat=0.0, clap=0.0, arp=0.0, tick=0.35),
    "lift":    dict(pad=0.9,  cutoff=2600, bass=0.0, kick=0.0, hat=0.0, clap=0.0, arp=0.0, tick=0.0),
    "groove":  dict(pad=0.7,  cutoff=1800, bass=0.75, kick=0.7, hat=0.35, clap=0.0, arp=0.0, tick=0.0),
    "drive":   dict(pad=0.7,  cutoff=2400, bass=0.85, kick=0.85, hat=0.45, clap=0.45, arp=0.5, tick=0.0),
    "tension": dict(pad=0.6,  cutoff=900,  bass=0.6, kick=0.0, hat=0.0, clap=0.0, arp=0.0, tick=0.55),
    "outro":   dict(pad=1.0,  cutoff=3000, bass=0.6, kick=0.0, hat=0.0, clap=0.0, arp=0.35, tick=0.0),
}


def section_at(t):
    cur = "intro"
    for s in tl["scenes"]:
        if s["from"] / FPS <= t:
            cur = SECTION[s["id"]]
    return cur


def bar_section(b):
    # the section in force at the middle of the bar decides the bar
    return section_at(b * BAR + BAR * 0.5)


# A minor: i - VI - III - VII, two bars each. Tension sections sit on a drone.
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOTS = [45, 41, 48, 43]

pad_l = np.zeros(N); pad_r = np.zeros(N)
drums = np.zeros(N); bass = np.zeros(N); arp = np.zeros(N); fx = np.zeros(N)

nbars = int(TOTAL / BAR) + 2
for b in range(nbars):
    sec = bar_section(b)
    L = LAYERS[sec]
    t0 = b * BAR
    ci = 0 if sec in ("tension", "intro") else (b // 2) % 4
    chord, root = CHORDS[ci], ROOTS[ci]
    # pad: one bar, overlapping release into the next
    n = int((BAR + 1.2) * SR)
    voice_l = np.zeros(n); voice_r = np.zeros(n)
    for note in chord + [chord[0] + 12]:
        f = midi(note)
        voice_l += saw(f * 2 ** (-6 / 1200), n, 8) + 0.6 * saw(f / 2, n, 6)
        voice_r += saw(f * 2 ** (6 / 1200), n, 8, phase=1.3) + 0.6 * saw(f / 2 * 1.002, n, 6)
    e = env_adsr(n, 0.9, 1.4)
    add(pad_l, lp(voice_l, L["cutoff"]) * e, t0, L["pad"] * 0.06)
    add(pad_r, lp(voice_r, L["cutoff"]) * e, t0, L["pad"] * 0.06)

    for beat in range(4):
        tb = t0 + beat * BEAT
        if L["kick"]:
            n = int(0.45 * SR); t = np.arange(n) / SR
            f = 45 + 85 * np.exp(-t * 28)
            k = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
            k[:200] += rng.standard_normal(200) * 0.25 * np.linspace(1, 0, 200)
            add(drums, k, tb, L["kick"] * 0.9)
        if L["clap"] and beat in (1, 3):
            n = int(0.25 * SR); t = np.arange(n) / SR
            c = bp(rng.standard_normal(n), 900, 3500) * np.exp(-t * 22)
            c += 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
            add(drums, c, tb, L["clap"] * 0.55)
        for half in (0, 1):
            th = tb + half * BEAT / 2
            if L["hat"] and half == 1:
                n = int(0.07 * SR)
                h = hp(rng.standard_normal(n), 7500) * np.exp(-np.arange(n) / SR * 70)
                add(drums, h, th, L["hat"] * 0.35)
            if L["bass"]:
                n = int(BEAT / 2 * SR * 0.95); t = np.arange(n) / SR
                f = midi(root - 12)
                bs = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)
                # pumping shape: ducked on the beat, swelling on the off-beat
                shape = np.minimum(1, t / 0.06) * np.exp(-t * 3) if half else np.minimum(1, t / 0.12) * np.exp(-t * 6) * 0.6
                add(bass, bs * shape, th, L["bass"] * 0.26)
        if L["tick"]:
            for q in range(4 if sec == "tension" else 2):
                n = int(0.03 * SR)
                tk = hp(rng.standard_normal(n), 5000) * np.exp(-np.arange(n) / SR * 160)
                add(fx, tk, tb + q * BEAT / (4 if sec == "tension" else 2), L["tick"] * (0.32 if q == 0 else 0.18))
        if L["arp"]:
            pattern = [0, 1, 2, 3, 2, 1, 2, 3]
            notes = chord + [chord[0] + 12]
            for s16 in range(2):
                ts = tb + s16 * BEAT / 2
                note = notes[pattern[(beat * 2 + s16) % 8]] + 12
                n = int(0.35 * SR); t = np.arange(n) / SR
                p = lp(saw(midi(note), n, 12), 3200) * np.exp(-t * 9)
                add(arp, p, ts, L["arp"] * 0.09)


# ---------------------------------------------------------------- hits
def impact(t, gain=1.0, sub=48):
    n = int(2.2 * SR); tt = np.arange(n) / SR
    f = sub + 40 * np.exp(-tt * 12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 2.2)
    noise = lp(rng.standard_normal(n), 2200) * np.exp(-tt * 9) * 0.5
    add(fx, (boom + noise), t, gain * 0.5)


def riser(t_end, secs=2.4, gain=1.0):
    n = int(secs * SR); tt = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    # sweep a band upward in blocks
    blocks = 24
    for i in range(blocks):
        a, b = i * n // blocks, (i + 1) * n // blocks
        lo = 300 * 2 ** (i / blocks * 4)
        out[a:b] = bp(noise, lo, min(lo * 2.2, 20000))[a:b]
    tone = np.sin(2 * np.pi * np.cumsum(200 * 2 ** (tt / secs * 2)) / SR) * 0.25
    shape = (tt / secs) ** 2.2
    add(fx, (out + tone) * shape, t_end - secs, gain * 0.5)


def gap(t0, t1, buf_list):
    # carve silence for a beat of drama
    i0, i1 = int(t0 * SR), int(t1 * SR)
    fade = int(0.08 * SR)
    for buf in buf_list:
        buf[i0:i0 + fade] *= np.linspace(1, 0, fade)
        buf[i0 + fade:i1] = 0
        buf[i1:i1 + fade] *= np.linspace(0, 1, fade)


T_TITLE = t_scene("title") + 0.3
T_CHAIN = t_phrase("layers", 4)
T_REVERTED = t_phrase("revert", 4)
T_CLOSE = t_scene("close") + 0.25
T_END = t_phrase("close", 7, "end")

riser(T_TITLE, 2.6, 1.0)
impact(T_TITLE, 1.0)
gap(T_CHAIN - 0.55, T_CHAIN, [pad_l, pad_r, drums, bass, arp])
impact(T_CHAIN, 0.9, sub=42)
riser(T_REVERTED, 3.0, 1.1)
gap(T_REVERTED - 0.45, T_REVERTED, [pad_l, pad_r, drums, bass, arp])
impact(T_REVERTED, 1.1, sub=40)
riser(T_CLOSE, 2.4, 0.9)
impact(T_CLOSE, 0.9)
impact(T_END + 0.05, 0.8, sub=55)

# ---------------------------------------------------------------- mix + ducking
pad_l = reverb(pad_l, 3.2, 0.35) * np.max(np.abs(pad_l))
pad_r = reverb(pad_r, 3.2, 0.35) * np.max(np.abs(pad_r))
arp_wet = arp.copy()
d = int(BEAT * 0.75 * SR)
for k, g in ((1, 0.45), (2, 0.22), (3, 0.1)):
    arp_wet[d * k:] += arp[:-d * k] * g
fx = reverb(fx, 2.0, 0.25) * np.max(np.abs(fx))

mono = drums + bass
left = pad_l + mono + arp_wet * 0.8 + fx + 0.2 * np.roll(arp_wet, int(0.011 * SR))
right = pad_r + mono + arp_wet * 0.6 + fx + 0.35 * np.roll(arp_wet, int(0.017 * SR))

# duck under every spoken phrase: about 9 dB, quick down, slow back up
duck = np.ones(N)
for s in tl["scenes"]:
    base = (s["from"] + s["voFrom"]) / FPS
    for p in caps[s["id"]]["phrases"]:
        a, b = int((base + p["start"] - 0.12) * SR), int((base + p["end"] + 0.1) * SR)
        duck[max(a, 0):b] = 0.36
# smooth the envelope (one-pole, separate attack/release)
sm = np.empty_like(duck); v = 1.0
att, rel = np.exp(-1 / (0.06 * SR)), np.exp(-1 / (0.45 * SR))
for i in range(N):
    c = att if duck[i] < v else rel
    v = c * v + (1 - c) * duck[i]
    sm[i] = v
# never duck the hits themselves too hard
left *= sm; right *= sm

# fade in, and fade the tail out after the last word
fi = int(1.0 * SR)
left[:fi] *= np.linspace(0, 1, fi); right[:fi] *= np.linspace(0, 1, fi)
fo0 = int((T_END + 0.8) * SR)
fo = N - fo0
if fo > 0:
    curve = np.linspace(1, 0, fo) ** 1.6
    left[fo0:] *= curve; right[fo0:] *= curve

st = np.stack([left, right], axis=1)
st = np.stack([hp(st[:, 0], 32), hp(st[:, 1], 32)], axis=1)
# soft limiter: bring the bed up so the hits sit on top of it rather than towering over it
st /= np.percentile(np.abs(st), 99.5) + 1e-9
st = np.tanh(st * 0.9) / np.tanh(0.9 * 1.6)
st /= np.max(np.abs(st)) + 1e-9
st *= 0.89
os.makedirs("public/audio", exist_ok=True)
wavfile.write("public/audio/score.wav", SR, (st * 32767).astype(np.int16))
print(f"score: {N / SR:.1f}s  hits at title {T_TITLE:.2f}s, chain {T_CHAIN:.2f}s, reverted {T_REVERTED:.2f}s, close {T_CLOSE:.2f}s")


# ---------------------------------------------------------------- UI sound effects
def write(name, x, gain=0.8):
    os.makedirs("public/sfx", exist_ok=True)
    x = x / (np.max(np.abs(x)) + 1e-9) * gain
    wavfile.write(f"public/sfx/{name}.wav", SR, (np.stack([x, x], 1) * 32767).astype(np.int16))


def whoosh(secs=0.55, up=True):
    n = int(secs * SR); tt = np.arange(n) / SR
    noise = rng.standard_normal(n); out = np.zeros(n)
    blocks = 20
    for i in range(blocks):
        a, b = i * n // blocks, (i + 1) * n // blocks
        frac = i / blocks if up else 1 - i / blocks
        lo = 400 * 2 ** (frac * 3.5)
        out[a:b] = bp(noise, lo, min(lo * 2.5, 20000))[a:b]
    shape = np.sin(np.pi * np.clip(tt / secs, 0, 1)) ** 1.5
    return out * shape


tt = np.arange(int(0.09 * SR)) / SR
write("tick", np.sin(2 * np.pi * 1850 * tt) * np.exp(-tt * 60) + 0.3 * np.sin(2 * np.pi * 3700 * tt) * np.exp(-tt * 90), 0.5)
tt = np.arange(int(0.25 * SR)) / SR
write("pop", np.sin(2 * np.pi * np.cumsum(500 + 700 * np.exp(-tt * 30)) / SR) * np.exp(-tt * 18), 0.55)
write("whoosh", whoosh(0.6, True), 0.55)
write("swoosh-down", whoosh(0.5, False), 0.45)
tt = np.arange(int(0.6 * SR)) / SR
deny = (np.sign(np.sin(2 * np.pi * 110 * tt)) + np.sign(np.sin(2 * np.pi * 116.5 * tt))) * 0.5
write("deny", lp(deny, 1400) * np.exp(-tt * 5) * (tt < 0.42), 0.6)
tt = np.arange(int(0.9 * SR)) / SR
chime = sum(np.sin(2 * np.pi * midi(n) * tt) * np.exp(-tt * (3 + i)) for i, n in enumerate([76, 81, 88]))
write("confirm", chime, 0.42)
tt = np.arange(int(0.12 * SR)) / SR
write("type", hp(rng.standard_normal(len(tt)), 3000) * np.exp(-tt * 120), 0.28)
tt = np.arange(int(0.4 * SR)) / SR
write("stamp", lp(rng.standard_normal(len(tt)), 900) * np.exp(-tt * 25) + np.sin(2 * np.pi * 70 * tt) * np.exp(-tt * 12), 0.85)
print("sfx:", sorted(os.listdir("public/sfx")))
