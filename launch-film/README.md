# launch-film/ — the AuspeX launch video

A 3:47 film for YouTube: Remotion motion graphics over real captures of the live deployment and
MSTScan, narrated by Amazon Polly (voice **Matthew**, generative engine), with a score and sound
effects synthesised from scratch so nothing in it carries a licence question.

It replaces nothing. The September film in `../video/` is part of the build record and is left as it was.

Not a pnpm workspace package — `pnpm-workspace.yaml` lists only `contracts` and `web`, so this
directory cannot affect CI. It has its own `node_modules` via plain `npm`.

## The rule it keeps

Every hash, address and number on screen is real. `npm run verify` re-reads each transaction in
`src/data/evidence.ts` from `testnet.mstscan.com/api/v2` — status, method, sender, revert reason —
plus the contract's verification, and exits non-zero on any disagreement. `npm run render` runs it
first and will not render if it fails.

Two things on screen are not chain data, and both say so on screen:

- the draining wallet in the opening is labelled **hypothetical — not a real wallet**;
- the article in the resolution scene is drawn as grey bars and labelled **illustration**.

The refusal counts in the "four layers" scene (0 / 16 / 1 / 11) are what `/trust` showed on
1 Oct 2026, and the scene says that date. The cap probe could not be pressed for the film — no
market was open, and the button refused to run, which the film shows rather than hides. The
probe on screen is a real earlier one: `0xbfe9bb2c…ced060a`, run from the live site on 29 Sep 2026.

## Pipeline

| Step | Command | Produces |
|---|---|---|
| 1. Capture | `npm run shoot` | `public/frames/*.png` (1600×900 @2x) + `manifest.json` with DOM-measured highlight boxes |
| 2. Narration | `npm run vo` | `public/vo/*.mp3` (Polly), `src/data/captions.json`, `src/data/timeline.json` |
| 3. Score | `npm run score` | `public/audio/score.wav`, `public/sfx/*.wav` — reads the timeline, so hits land on picture |
| 4. Render | `npm run render` | verify → `out/auspex-raw.mp4` → master to −14 LUFS → `out/AuspeX-demo.mp4` |
| 5. Extras | `npm run srt` · `npm run thumbnail` | `out/auspex.srt`, `out/chapters.txt`, `out/thumbnail.png` |

Step 2 needs AWS credentials with `polly:SynthesizeSpeech`. Step 3 needs a venv:
`python3 -m venv .venv && .venv/bin/pip install numpy scipy`.

`scripts/probe.mjs` presses the public cap probe on `/trust`. When a market is open that sends a real
(reverting) transaction from an agent wallet — about 0.0001 tMSTC of gas — so it is not part of `shoot`.

## How the timing works

Polly's generative engine returns no speech marks, so `scripts/align.mjs` finds the pauses Polly
actually left (`ffmpeg silencedetect`) and snaps each phrase boundary to the nearest one;
`script/align-overrides.json` corrects the one clip where that guessed wrong. Every animation cue in
`src/scenes/*` is `useCue(scene).at(phraseIndex)` — the moment the narrator starts that phrase — so
changing a line of narration moves the picture with it.

## Editing

- Narration text: `script/vo.json`, then `npm run vo` and `npm run score` (the score follows the timeline).
- Preview: `npm run dev` — every scene is also registered on its own under *Scenes*.
- Colours are the product's tokens (`src/theme.ts`) and keep their meaning: blue a model proposing,
  amber deterministic code, violet a person, green the chain, red a refusal. Orange is chrome only.
