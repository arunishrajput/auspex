#!/usr/bin/env bash
# Polly's generative voice comes out near -25 LUFS — quieter than the score under it. Bring every
# clip to -16 LUFS with a plain gain change (no compression, no change in length), so the narration
# sits on top of the music and every clip is as loud as the next.
set -euo pipefail
for f in public/vo/*.mp3; do
  I=$(ffmpeg -hide_banner -i "$f" -af ebur128 -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}')
  G=$(python3 -c "print(round(-16 - ($I), 2))")
  ffmpeg -hide_banner -v error -y -i "$f" -af "volume=${G}dB,alimiter=limit=0.95:level=false" -ar 24000 -b:a 96k "$f.tmp.mp3"
  mv "$f.tmp.mp3" "$f"
  printf "%-28s %6s LUFS  %+6s dB\n" "$f" "$I" "$G"
done
