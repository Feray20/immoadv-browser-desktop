#!/usr/bin/env bash
# ImmoAdv Browser auf Ferays eigenem PC/Mac bauen (Azure-Agent) und privat auf immoadv.de veröffentlichen.
# Aufruf: bash scripts/azure-build.sh windows|mac
set -euo pipefail
P="${1:?windows oder mac}"
cd "$(dirname "$0")/.."
# Windows: ohne eigenes Zertifikat (Store signiert die Store-Version kostenlos).
# Mac (02.11.2026): Liegt auf Ferays Mac ein Apple-Zertifikat (Xcode-Konto), signiert electron-builder damit – dann
# erkennt macOS den Browser nach Updates wieder (keine erneute Schlüsselbund-Abfrage für gespeicherte Passwörter).
# Ohne Zertifikat wie bisher unsigniert/ad-hoc.
if [ "$P" = "windows" ] || ! security find-identity -v -p codesigning 2>/dev/null | grep -qE '"(Developer ID Application|Apple Development|Mac Developer):'; then
  export CSC_IDENTITY_AUTO_DISCOVERY=false
fi
node --version
npm install --no-audit --no-fund
npm test
node scripts/fetch-vendor.mjs
node scripts/build-rules.mjs
node scripts/build-extension.mjs              # Version 4: ImmoAdv-Erweiterung für den Firefox-Motor
rm -rf dist
if [ "$P" = "windows" ]; then
  npx electron-builder --win --x64 --publish never
  node scripts/publish-immoadv.mjs windows       # zuerst das Update für installierte Browser
  node scripts/store-package.mjs                 # dann das Store-Paket (.appx) – liegt in Azure unter „Artefakte“
  rm -rf store && mkdir -p store && cp dist/*.appx store/ 2>/dev/null || true
else
  npx electron-builder --mac --universal --publish never
  node scripts/publish-immoadv.mjs mac
fi
