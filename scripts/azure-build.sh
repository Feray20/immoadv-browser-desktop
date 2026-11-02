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
if [ "$P" = "windows" ]; then
  export CSC_IDENTITY_AUTO_DISCOVERY=false
else
  # Mac: ausdrücklich Ferays „Developer ID Application“ (sonst „Apple Development“) – nicht dem Zufall überlassen.
  IDS=$(security find-identity -v -p codesigning 2>/dev/null || true)
  MACID=$(printf '%s\n' "$IDS" | grep -E '"Developer ID Application:' | head -1 | sed -E 's/.*"(.*)"/\1/' || true)
  [ -n "$MACID" ] || MACID=$(printf '%s\n' "$IDS" | grep -E '"Apple Development:' | head -1 | sed -E 's/.*"(.*)"/\1/' || true)
  if [ -n "$MACID" ]; then
    export CSC_NAME="$MACID"
    echo "Signatur: $MACID"
    # Beglaubigung bei Apple, wenn ein notarytool-Profil „ImmoAdv“ im Schlüsselbund liegt (sonst nur signiert).
    if xcrun notarytool history --keychain-profile "ImmoAdv" >/dev/null 2>&1; then export APPLE_KEYCHAIN_PROFILE="ImmoAdv"; fi
  else
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    echo "Kein Apple-Zertifikat gefunden – Browser wird ohne eigene Signatur gebaut."
  fi
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
  npx electron-builder --mac --arm64 --publish never
  node scripts/publish-immoadv.mjs mac
fi
