#!/usr/bin/env bash
# Write <site-dir>/latest.json, the auto-update feed, from the updater archives
# and signatures already downloaded into <site-dir> for release <tag>.
#
# The feed is built here, once, instead of taken from the release: each
# tauri-action matrix leg read-modify-wrote the release's shared latest.json,
# and concurrent legs dropped each other's platforms (v0.1.98 shipped with no
# macOS entries, so Macs failed to update). Used by release.yml and
# update-feed.yml.
#
# A platform with no archive+signature is left out with a warning, so one
# failed leg doesn't block the feed for the rest (#106); that platform keeps
# its current version until the leg is re-run.
set -euo pipefail

site=$1
tag=$2
base=https://energ.ee/art-files

# Bare keys only: the updater tries `<os>-<arch>-<bundle>` and then falls back
# to `<os>-<arch>`.
platforms='{}'
for pair in \
  "darwin-aarch64 *_aarch64.app.tar.gz" \
  "darwin-x86_64 *_x64.app.tar.gz" \
  "linux-x86_64 *.AppImage" \
  "windows-x86_64 *-setup.exe"; do
  read -r key pattern <<<"$pair"
  archive=$(cd "$site" && ls $pattern 2>/dev/null | head -n 1) || true
  if [[ -z "$archive" || ! -f "$site/$archive.sig" ]]; then
    echo "::warning::$tag has no $key update; it keeps its current version"
    continue
  fi
  platforms=$(jq --arg key "$key" --arg url "$base/$archive" \
    --rawfile sig "$site/$archive.sig" \
    '. + {($key): {signature: $sig, url: $url}}' <<<"$platforms")
done

if [[ "$platforms" == '{}' ]]; then
  echo "::error::$tag has no updater archives" >&2
  exit 1
fi

jq -n --arg version "${tag#label-lab-v}" \
  --arg notes "$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json body -q .body)" \
  --arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson platforms "$platforms" \
  '{$version, $notes, $pub_date, $platforms}' > "$site/latest.json"
