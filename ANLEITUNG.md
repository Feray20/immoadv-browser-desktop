# ImmoAdv Browser 2.0 – Windows und Mac

## Aufbau

| Teil | Was es macht | Wer aktualisiert |
|---|---|---|
| **Google Chrome** (offiziell von Google) | Browser-Engine, Google-Konto, Sync, Passwörter, Passkeys, Übersetzen, Downloads mit Virenprüfung, Erweiterungen | Google, automatisch |
| **ImmoAdv-Programm** (dieses Repo, `src/`) | Richtet Chrome mit eigenem Profil „ImmoAdv“ ein, installiert Chrome bei Bedarf, setzt verschlüsseltes DNS, „Immer sichere Verbindungen“ und Windows Hello / Touch ID für Passwörter, Update-Knopf | GitHub-Releases, automatisch |
| **ImmoAdv-Schicht** (`extension/`) | Startseite, Datenschutz-Center, Blocker (Werbung/Tracker/Malware/Phishing), NordVPN, spurloses Surfen, Lesezeichen-Übernahme | kommt mit jedem Programm-Update und übernimmt sich selbst ohne Neustart |
| **ImmoAdv-Design** (`theme/`) | Farben des Chrome-Rahmens | wie oben |

Das ImmoAdv-Profil ist komplett getrennt von einem normal installierten Chrome (eigener Profilordner).

## Datenschutz – was passiert wirklich

- **Blocker:** gepflegte Listen (HaGeZi Multi PRO, URLhaus, Phishing-Filter) → Chrome-Regeln. Malware/Phishing werden zusätzlich täglich frisch geladen. Herkunft und Stand stehen im Datenschutz-Center.
- **Spurlos:** Verlauf wird sofort wieder gelöscht; Cookies und Website-Daten einer Seite werden 8 Sekunden nach dem Schließen ihres letzten Tabs gelöscht – außer bei „Angemeldet bleiben bei“ (Google, iCloud, immoadv.de …). Beim Start: Cache und Download-Liste leer.
- **NordVPN:** verschlüsselter NordVPN-Proxy (TLS, Port 89) für den gesamten Browser-Verkehr, schnellster Server laut NordVPN, Serverwechsel bei Ausfall, kein Rückfall auf eine ungeschützte Verbindung. Zugangsdaten AES-verschlüsselt nur auf dem Gerät. Gilt für den Browser, nicht für andere Programme.
- **WebRTC:** ohne VPN keine lokalen IPs, mit VPN nur über das VPN.
- **Keine Behauptung vollständiger Anonymität:** Wer sich bei einer Seite anmeldet, ist dort bekannt. Ohne NordVPN sieht der Internetanbieter, welche Seiten aufgerufen werden.

## NordVPN einrichten (einmalig)

1. my.nordaccount.com → NordVPN → **Manuelle Einrichtung** → „Dienst-Zugangsdaten“ (Benutzername + Passwort, nicht E-Mail).
2. Im Browser oben rechts auf das ImmoAdv-Symbol → Datenschutz-Center → „NordVPN einmalig anmelden“ → einfügen → Speichern.

## Ersteinrichtung

Das Programm führt durch drei Schritte: Chrome (wird bei Bedarf direkt von Google geladen und auf Googles Signatur geprüft), ImmoAdv in Chrome aktivieren (einmal „Entpackte Erweiterung laden“ – Ordner wird automatisch kopiert), mit Google anmelden.

## Neue Version veröffentlichen

`package.json` → `version` erhöhen, `NEUERUNGEN.md` anpassen, auf `main` pushen. CircleCI baut Windows und Mac, lädt die aktuellen Filterlisten und veröffentlicht das Release. Programme installieren es still beim nächsten Öffnen; die ImmoAdv-Schicht in Chrome übernimmt es innerhalb von 10 Minuten.

## Lokal testen

```
npm install
npm test
npm start          # erzeugt kleine Test-Filterlisten und startet das Programm
```
