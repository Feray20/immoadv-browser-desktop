# ImmoAdv Browser für Windows und Mac – Anleitung

Ein gemeinsames Programm für beide Systeme. Jedes Update wird automatisch für Windows **und** Mac gebaut.

## Was drin ist

- Tor fest eingebaut (offizielles Tor-Paket des Tor-Projekts, beim Bauen per Prüfsumme kontrolliert)
- Snowflake-Brücken: Internetanbieter sieht nicht leicht, dass du Tor nutzt
- Keine einzige DNS-Anfrage am Tor vorbei, WebRTC-Leck gesperrt, kein Verlauf, keine Cookies nach dem Schließen
- Tabs, Lesezeichen, Startseite im ImmoAdv-Fade
- **Immobilien-Check** als Seitenleiste auf Inseraten (gleiche Rechnung wie in der iPhone-App), Bericht als PDF
- **PDF-Werkzeug**: ausfüllen, markieren, zeichnen, Text, Bild, Unterschrift; „PDF speichern“ (Strg/⌘+S) schreibt direkt in die Datei
- Beim ersten Start: **Download-Ordner wählen** – danach landet jeder Download automatisch dort
- Mac: optional Touch-ID-Sperre

## Automatisch bauen mit CircleCI (Gratis-Plan)

1. Den Ordner als neues GitHub-Repository hochladen (z. B. `immoadv-browser-desktop`).
2. In CircleCI: „Projects“ → Repository → „Set Up Project“ → vorhandene `.circleci/config.yml` verwenden.
3. Für den **Mac** in CircleCI → Project Settings → Environment Variables eintragen:
   - `CSC_LINK` – dein „Developer ID Application“-Zertifikat (aus dem Apple-Konto, als .p12 exportiert, Base64)
   - `CSC_KEY_PASSWORD` – Passwort der .p12
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` – für Apples Beglaubigung (Notarisierung)
4. Bei jedem Push auf `main` entstehen unter „Artifacts“:
   - Windows: `ImmoAdv-Browser-Setup-x.y.z.exe` (Installer) und ein `.appx` für den Microsoft Store
   - Mac: `ImmoAdv-Browser-x.y.z.dmg` (läuft auf Apple-Chip und Intel)

## Microsoft Store

Im Partner Center eine neue App „ImmoAdv Browser“ anlegen. Die dort angezeigten Werte für **Package/Identity/Name** und **Publisher** in `electron-builder.yml` bei `appx` eintragen, dann das `.appx` hochladen. Microsoft signiert es kostenlos.

## Lokal testen (optional)

```
npm install
npm run vendor
npm start
```

## Ehrliche Grenzen

Auf dem Computer ist der offizielle **Tor Browser** beim Schutz vor Fingerabdrücken noch etwas stärker, weil er viele Browser-Merkmale vereinheitlicht. Der ImmoAdv Browser schützt IP-Adresse, DNS und Verlauf zuverlässig und bringt die ImmoAdv-Werkzeuge mit. Sobald du dich irgendwo einloggst, kennt dich diese Seite.

## Automatische Updates

- Das Programm sucht beim Start und alle 4 Stunden nach einer neuen Version (auch das über Tor), lädt sie im Hintergrund und zeigt dann ein Pop-up mit den **Neuerungen**: „Jetzt neu starten und installieren“ oder „Später“ (dann beim Beenden).
- In den Einstellungen: Schalter **„Automatische Updates“**, Knopf **„Jetzt nach Updates suchen“ / „Update jetzt starten“**, aktuelle Version.
- Die Microsoft-Store-Version wird vom Store aktualisiert.

**Einmalig einrichten:**
1. Auf GitHub ein **öffentliches** Repository `immoadv-browser-desktop` anlegen (Konto Feray20 ist schon eingetragen).
2. GitHub → Settings → Developer settings → Fine-grained tokens → neues Token nur für dieses Repository mit „Contents: Read and write“ → in CircleCI unter Project Settings → Environment Variables als `GH_TOKEN` eintragen.
3. Fertige Installer liegen danach unter github.com/Feray20/immoadv-browser-desktop/releases.

**Neues Update veröffentlichen:** In `package.json` die `"version"` erhöhen (z. B. `1.0.0` → `1.0.1`) und in `NEUERUNGEN.md` kurz aufschreiben, was neu ist – genau dieser Text erscheint im Update-Pop-up. Nach dem Push baut CircleCI Windows und Mac und veröffentlicht – alle installierten Programme aktualisieren sich dann selbst.

**Mac:** Updates funktionieren nur mit signierter App (Developer-ID-Zertifikat, siehe oben).
