#!/bin/sh
# Packs the extension/ folder into a zip for a release or the Chrome Web Store.
set -e
version=$(sed -nE 's/.*"version": "([^"]+)".*/\1/p' extension/manifest.json)
mkdir -p dist
rm -f "dist/discord-markdown-renderer-$version.zip"
(cd extension && zip -qr "../dist/discord-markdown-renderer-$version.zip" . -x '.DS_Store' -x '*/.DS_Store')
zip -q "dist/discord-markdown-renderer-$version.zip" LICENSE BRAND.md
echo "dist/discord-markdown-renderer-$version.zip"
