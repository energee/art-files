#!/bin/sh
# to-cmyk.sh — convert the generated RGB PDFs to CMYK for the printer.
# Requires Ghostscript: brew install ghostscript
# Usage: tools/to-cmyk.sh Label.pdf Label-mask.pdf ...
# Writes <name>-cmyk.pdf next to each input.
set -eu
command -v gs >/dev/null || { echo "ghostscript not found: brew install ghostscript" >&2; exit 1; }
for f in "$@"; do
  out="${f%.pdf}-cmyk.pdf"
  gs -q -dNOPAUSE -dBATCH -sDEVICE=pdfwrite \
    -dColorConversionStrategy=/CMYK \
    -dProcessColorModel=/DeviceCMYK \
    -dDownsampleColorImages=false -dDownsampleGrayImages=false \
    -dAutoFilterColorImages=false -dColorImageFilter=/FlateEncode \
    -o "$out" "$f"
  echo "wrote $out"
done
