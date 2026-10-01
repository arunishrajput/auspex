#!/usr/bin/env bash
# Final audio master: two-pass EBU R128 loudness normalisation to YouTube's -14 LUFS, -1 dBTP.
# The picture is copied bit-for-bit; only the audio stream is re-encoded.
set -euo pipefail
IN=${1:-out/auspex-raw.mp4}
OUT=${2:-out/AuspeX-demo.mp4}
read -r I TP LRA TH OFF < <(ffmpeg -hide_banner -i "$IN" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 \
  | python3 -c "import sys,json,re; d=json.loads(re.search(r'\{[^{}]*\}', sys.stdin.read(), re.S).group()); print(d['input_i'], d['input_tp'], d['input_lra'], d['input_thresh'], d['target_offset'])")
echo "measured: I=$I LUFS  TP=$TP dBTP  LRA=$LRA"
ffmpeg -hide_banner -v error -y -i "$IN" -c:v copy \
  -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true,aresample=48000" \
  -c:a aac -b:a 320k -movflags +faststart "$OUT"
ffmpeg -hide_banner -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|Peak):" | sed 's/^/mastered: /'
