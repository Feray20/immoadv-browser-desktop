# ImmoAdv Browser 3 – Anleitung

## Installieren
- **Windows:** ImmoAdv Programme → ImmoAdv Browser → „Für Windows“ → Setup öffnen.
- **Mac:** ImmoAdv Programme → „Für Mac“ → .dmg öffnen → in „Programme“ ziehen. Beim ersten Start Rechtsklick → „Öffnen“ (die App ist noch nicht von Apple beglaubigt).
- Wer schon 2.x hat: im Browser „Update jetzt installieren“ drücken – Lesezeichen und Download-Ordner bleiben.

## Updates
„Update jetzt installieren“ lädt die neue Version, installiert sie still und startet den Browser neu. Automatisch geladene Updates werden beim Beenden installiert. Protokoll: Einstellungen → Updates → „Update-Protokoll anzeigen“.

## Bedienung
| Was | Wo |
|---|---|
| Arbeitsbereiche | Punkte links oben (bzw. oben in der Seitenleiste), verwalten unter Einstellungen → Bereiche |
| Tabs links statt oben | Einstellungen → Allgemein → „Tabs anzeigen“ |
| Geteilte Ansicht | Rechtsklick auf Tab bzw. Strg/⌘+Umschalt+S |
| KI-Assistent | ✦ oben rechts bzw. Strg/⌘+Umschalt+A; einrichten unter Einstellungen → KI |
| NordVPN | Einstellungen → NordVPN (Dienst-Zugangsdaten aus nordaccount.com) |
| Passwörter | ⋯ → Passwörter; Import als CSV aus „Passwörter“ (Mac/iPhone) oder Google |
| Verlauf / Lesezeichen / Downloads | Strg/⌘+H / ⋯ → Lesezeichen / Strg/⌘+E |
| Schnellbefehle | Strg/⌘+K |

## Daten
Alles liegt nur auf diesem Computer: `einstellungen.json` (Passwörter und Schlüssel einzeln verschlüsselt mit DPAPI/Schlüsselbund), `verlauf.json`, `ki-gespraeche.json` im App-Ordner (Windows `%APPDATA%\ImmoAdv Browser`, Mac `~/Library/Application Support/ImmoAdv Browser`).

## Entwicklung
```
npm install
npm start          # lädt PDF.js + Test-Filterlisten, startet den Browser
npm test
```
Neue Version: `version` in package.json erhöhen und auf `main` pushen – Azure Pipelines (`azure-pipelines.yml`) baut auf Ferays eigenem PC (Windows) und Mac und veröffentlicht die Updates privat auf immoadv.de (`/api/browser/update`); die Programme holen sie sich selbst. Das Store-Paket liegt im Azure-Lauf unter „Artefakte“. GitHub-Workflows laufen nur noch von Hand. Details und Umsetzungsstand: `docs/ARCHITEKTUR.md`.
