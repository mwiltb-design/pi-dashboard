#!/usr/bin/env bash
# Generate assets/icon.icns from the shared PNG logo using macOS built-in tools.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE="$ROOT_DIR/assets/icon.png"
ICONSET="$ROOT_DIR/assets/icon.iconset"
OUTPUT="$ROOT_DIR/assets/icon.icns"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Mac icon generation must run on macOS (sips and iconutil are required)." >&2
  exit 1
fi
if [[ ! -f "$SOURCE" ]]; then
  echo "Source icon not found: $SOURCE" >&2
  exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"
cleanup() { rm -rf "$ICONSET"; }
trap cleanup EXIT

for spec in "16:icon_16x16.png" "32:icon_16x16@2x.png" "32:icon_32x32.png" "64:icon_32x32@2x.png" "128:icon_128x128.png" "256:icon_128x128@2x.png" "256:icon_256x256.png" "512:icon_256x256@2x.png" "512:icon_512x512.png" "1024:icon_512x512@2x.png"; do
  size="${spec%%:*}"
  filename="${spec#*:}"
  sips -s format png -z "$size" "$size" "$SOURCE" --out "$ICONSET/$filename" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$OUTPUT"
echo "Generated $OUTPUT"
