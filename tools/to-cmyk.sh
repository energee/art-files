#!/bin/sh
# to-cmyk.sh — convert the generated RGB PDFs to CMYK for the printer.
# Requires Ghostscript: brew install ghostscript
# Usage: tools/to-cmyk.sh Label.pdf Label-mask.pdf ...
# Writes <name>-cmyk.pdf next to each input.
set -eu
command -v gs >/dev/null || { echo "ghostscript not found: brew install ghostscript" >&2; exit 1; }
for f in "$@"; do
  out="${f%.pdf}-cmyk.pdf"
  # pdfwrite's default PageByPage auto-rotation turned the landscape label
  # into a portrait page; preserve the generated PDF's authored orientation.
  gs -q -dNOPAUSE -dBATCH -sDEVICE=pdfwrite \
    -dAutoRotatePages=/None \
    -dColorConversionStrategy=/CMYK \
    -dProcessColorModel=/DeviceCMYK \
    -dDownsampleColorImages=false -dDownsampleGrayImages=false \
    -dAutoFilterColorImages=false -dColorImageFilter=/FlateEncode \
    -o "$out" "$f"
  echo "wrote $out"
done
