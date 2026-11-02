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
  # Auch direkt im Anmelde-Schlüsselbund suchen (02.11.2026): Der Bau-Dienst läuft im Hintergrund – dort ist er nicht
  # immer in der Suchliste, das Zertifikat würde sonst übersehen.
  LOGIN_KC="$HOME/Library/Keychains/login.keychain-db"
  IDS=$( { security find-identity -v -p codesigning 2>/dev/null; [ -f "$LOGIN_KC" ] && security find-identity -v -p codesigning "$LOGIN_KC" 2>/dev/null; } || true)
  if [ -f "$LOGIN_KC" ] && ! security list-keychains -d user 2>/dev/null | grep -q "login.keychain"; then
    security list-keychains -d user -s "$LOGIN_KC" $(security list-keychains -d user 2>/dev/null | tr -d '"') 2>/dev/null || true
  fi
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
  if [ -n "${CSC_NAME:-}" ]; then
    npx electron-builder --mac --arm64 --publish never
  else
    # Ohne Apple-Zertifikat (02.11.2026, Feray: „ImmoAdv Browser ist beschädigt“): electron-builder überspringt dann das
    # Signieren – die Signatur des Programms passte nicht mehr zum Inhalt, macOS meldete „beschädigt“. Darum erst das
    # Programm bauen, dann vollständig ad-hoc signieren (gültige Signatur, gleiche Rechte) und daraus dmg + zip packen.
    npx electron-builder --mac dir --arm64 --publish never
    SRC=$(ls -d dist/mac-arm64/*.app | head -1)
    PRE="$(mktemp -d)"; cp -R "$SRC" "$PRE/"; APP="$PRE/$(basename "$SRC")"; rm -rf dist
    find "$APP/Contents" -type f \( -perm -u+x -o -name "*.dylib" -o -name "*.so" \) -print0 | while IFS= read -r -d '' f; do
      if file "$f" | grep -q "Mach-O"; then codesign --force --sign - --options runtime --entitlements build/entitlements.mac.plist "$f" 2>/dev/null || true; fi
    done
    codesign --force --deep --sign - --options runtime --entitlements build/entitlements.mac.plist "$APP"
    codesign --verify --deep --strict "$APP" && echo "Signatur geprüft: ad-hoc, gültig"
    npx electron-builder --mac --arm64 --publish never --prepackaged "$APP"
  fi
  node scripts/publish-immoadv.mjs mac
fi
