#!/usr/bin/env bash
# tools/frames.sh <video> <folder> <second> [<second> …] — frames from a video as PNG: <folder>/<video name>_<second>.png
set -e
v=$1; out=$2; shift 2
mkdir -p "$out"
n=$(basename "$v" .mp4)
for ts in "$@"; do ffmpeg -v error -y -ss "$ts" -i "$v" -frames:v 1 "$out/${n}_$ts.png"; done
