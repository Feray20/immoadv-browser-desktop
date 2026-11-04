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
    # electron-builder will den Namen OHNE „Developer ID Application:“ (Protokoll 03.11.2026: „Please remove prefix“ –
    # deshalb scheiterte der erste Weg jedes Mal). Für den codesign-Rückweg bleibt der volle Name in MACID_FULL.
    export MACID_FULL="$MACID"
    export CSC_NAME="${MACID#Developer ID Application: }"; CSC_NAME="${CSC_NAME#Apple Development: }"
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
  # Ohne Apple-Zertifikat – oder wenn Signieren/Beglaubigen mit Zertifikat scheitert (03.11.2026: der Mac-Bau blieb seit
  # 4.1.17 aus, der Mac bekam keine neuen Versionen mehr) – wird ad-hoc signiert gebaut, damit der Mac nie zurückbleibt.
  # Protokoll der Signatur (03.11.2026: 4.1.38 kam trotz Zertifikat ad-hoc an – Ursache sichtbar machen). Liegt im
  # Arbeitsordner des Bau-Agenten, damit es nach dem Bau lesbar bleibt.
  SIGNLOG="${AGENT_WORKFOLDER:-$PWD/..}/browser-sign.log"
  { echo "== $(date -u +%FT%TZ) Version $(node -p "require('./package.json').version") · CSC_NAME=${CSC_NAME:-leer}"; security find-identity -v -p codesigning 2>&1 | head -5; } > "$SIGNLOG" 2>&1 || true
  adhoc() {
    # (02.11.2026, Feray: „ImmoAdv Browser ist beschädigt“): erst das Programm bauen, dann vollständig signieren
    # (gültige Signatur, gleiche Rechte) und daraus dmg + zip packen.
    # 03.11.2026: SIGN_ID gesetzt → mit Ferays Developer ID direkt per codesign (wie bei ImmoAdv Admin, das so zuverlässig
    # signiert ist); sonst ad-hoc („-“).
    local SID="${SIGN_ID:--}" TS=""; [ "$SID" != "-" ] && TS="--timestamp"
    unset CSC_NAME APPLE_KEYCHAIN_PROFILE; export CSC_IDENTITY_AUTO_DISCOVERY=false
    rm -rf dist
    npx electron-builder --mac dir --arm64 --publish never
    SRC=$(ls -d dist/mac-arm64/*.app | head -1)
    PRE="$(mktemp -d)"; cp -R "$SRC" "$PRE/"; APP="$PRE/$(basename "$SRC")"; rm -rf dist
    find "$APP/Contents" -type f \( -perm -u+x -o -name "*.dylib" -o -name "*.so" \) -print0 | while IFS= read -r -d '' f; do
      if file "$f" | grep -q "Mach-O"; then codesign --force $TS --sign "$SID" --options runtime --entitlements build/entitlements.mac.plist "$f" >>"$SIGNLOG" 2>&1 || echo "codesign FEHLER: $f" >>"$SIGNLOG"; fi
    done
    codesign --force --deep $TS --sign "$SID" --options runtime --entitlements build/entitlements.mac.plist "$APP" >>"$SIGNLOG" 2>&1 || { echo "codesign App FEHLER ($SID)" | tee -a "$SIGNLOG"; return 1; }
    codesign --verify --deep --strict "$APP" && echo "Signatur geprüft: ${SID}, gültig" | tee -a "$SIGNLOG"
    codesign -dvv "$APP" 2>&1 | grep -E "Authority|TeamIdentifier|Signature=" >>"$SIGNLOG" || true
    npx electron-builder --mac --arm64 --publish never --prepackaged "$APP"
  }
  if [ -n "${CSC_NAME:-}" ]; then
    # 03.11.2026 (Feray: Schlüsselbund fragt nach jedem Update, Passwort-Ausfüllen hängt): Der signierte Bau scheiterte und
    # fiel still auf ad-hoc zurück – für macOS ist dann jede Version ein fremdes Programm. Jetzt: zuerst mit Beglaubigung,
    # dann mit Zertifikat OHNE Beglaubigung (reicht für eigene Updates), erst danach ad-hoc – mit klarer Meldung im Log.
    SAVED_ID="${MACID_FULL:-$CSC_NAME}"
    set +e; npx electron-builder --mac --arm64 --publish never 2>&1 | tee -a "$SIGNLOG"; EB=${PIPESTATUS[0]}; set -e
    # Erst in eine Variable lesen (04.11.2026): „codesign | grep -q“ brach mit pipefail ab (grep beendet früh) und meldete
    # fälschlich „ohne Developer ID“ – dann wurde unnötig ein zweites Mal signiert.
    # Ohne jede Pipe vergleichen – auch „printf | grep -q“ kann unter pipefail abbrechen, wenn grep früh fertig ist.
    SIGINFO=$(codesign -dvv dist/mac-arm64/*.app 2>&1 || true)
    if [ "$EB" = "0" ] && [[ "$SIGINFO" != *"Developer ID Application"* ]]; then echo "electron-builder fertig, aber ohne Developer ID – signiere neu" | tee -a "$SIGNLOG"; EB=1; fi
    [ "$EB" = "0" ] \
      || { echo "Signierter Bau über electron-builder fehlgeschlagen – signiere direkt per codesign mit $SAVED_ID."; SIGN_ID="$SAVED_ID" adhoc; } \
      || { echo "##[warning]Mac-Browser NICHT mit Developer ID signiert – ad-hoc. Folge: Schlüsselbund fragt nach jedem Update."; SIGN_ID="-" adhoc; }
  else
    adhoc
  fi
  node scripts/publish-immoadv.mjs mac
fi
