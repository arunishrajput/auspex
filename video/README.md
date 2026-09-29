# video/ — the AuspeX demo film

A 4-minute film built from the same evidence the project asks a judge to check: real captured
pixels from the live deployment and MSTScan, and transaction hashes re-verified against the
explorer before anything renders.

Not a pnpm workspace package. `pnpm-workspace.yaml` lists only `contracts` and `web`, and every
step in `.github/workflows/ci.yml` is `--filter`-scoped, so this directory cannot affect CI.
It has its own `node_modules` via plain `npm`.

## The pipeline

| Stage | Command | Produces |
|---|---|---|
| 1. Verify | `npm run verify` | fails if any on-screen hash disagrees with the chain |
| 2. Voiceover | `npm run vo` | `audio/vo/*.mp3`, `script/timings.json`, `out/AuspeX-demo.srt` |
| 3. Mix voice | `node scripts/mix-vo.mjs` | `audio/vo-full.wav` |
| 4. Music | `npm run bed` | `audio/bed.wav` |
| 5. Master | see below | `audio/mix.wav` at −16 LUFS |
| 6. Footage | `npm run shoot` | `assets/captured/*.png` + `capture-manifest.json` |
| 7. Render | `npm run render` | `out/AuspeX-demo-4min.mp4` |

Stage 5:

```bash
ffmpeg -y -i audio/vo-full.wav -i audio/bed.wav -filter_complex \
  "[0:a]apad=whole_dur=240[vo];[1:a]volume=0.34[bed];[vo][bed]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11" \
  -ar 48000 -ac 2 -c:a pcm_s16le audio/mix.wav
```

After stage 6, copy assets the bundler serves: `cp assets/captured/*.png public/shots/ &&
cp assets/captured/capture-manifest.json public/`.

Stage 2 needs AWS credentials with `polly:SynthesizeSpeech` (region `us-east-1`).
Stage 4 needs numpy: `uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python numpy`.

## Why it is built this way

**Timing is measured, never estimated.** Every narration line is synthesised as its own clip and
measured with `ffprobe`. Those durations drive scene lengths, caption timings, the SRT, the music's
intensity curve and its ducking envelope. Nothing is hand-timed, so a script edit re-times the whole
film automatically.

**The film verifies its own claims.** `scripts/verify-onscreen.mjs` re-fetches every transaction and
address the film shows and asserts status, sender and revert reason against what the script claims.
It exits non-zero on a mismatch. This exists because of the defect `PROGRESS.md` records: every link
resolved and every hash was real, but the column beside them was flattering and wrong. Getting a
signer wrong is the one mistake this demo cannot survive, so the claim is checked, not just the hash.

**Footage is photographed, not rebuilt.** Pages are captured full-page at `deviceScaleFactor: 2`, and
scroll motion is authored as a pan over the tall image. Shots are located by the text on the page and
their bounding boxes recorded in the manifest, so no CSS selector is baked into the edit. Every
footage scene carries its capture timestamp on screen, because a film is a snapshot and these
counters move.

**The explorer's ad slot is removed at capture.** MSTScan sells a sponsored slot and what it served
during capture was a gambling ad, which has no place in a prediction-market demo. Off-origin
subresources are blocked and the row is dropped before the screenshot.

**Nothing is mocked.** Same rule as the app. Every figure on screen was read off the live site or the
explorer at the timestamp shown, and the terminal scene is real captured stdout from
`pnpm check:links`, not retyped.

## Reproducing

`assets/captured/`, `public/`, `audio/` and `out/` are gitignored — the film is rebuilt from a fresh
capture rather than from stale pixels. Run stages 1–7 in order.
