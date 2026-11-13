#!/bin/sh
# Rebuild the landing without a gap: build into dist-next, then swap it in, so the
# preview never serves an empty dist (Astro's own 404) mid-build.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../apps/landing"
rm -rf dist-next dist-old
PUBLIC_SHOP_API=http://localhost:3199 pnpm exec astro build --outDir dist-next 2>&1 | grep -iE "error|page\(s\) built" || true
[ -f dist-next/index.html ] || { echo "build failed"; exit 1; }
mv dist dist-old && mv dist-next dist && rm -rf dist-old
# Tell the open pages (notes server, live reload).
date > "$HERE/.stamp" 2>/dev/null || true
