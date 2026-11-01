# ImmoAdv Browser 3 – Architektur & Umsetzungsstand

## Aufbau
| Schicht | Datei(en) | Aufgabe |
|---|---|---|
| Engine | Electron (Chromium) | Webseiten in `WebContentsView` je Tab, Sandbox an, kein Node in Webseiten |
| Hauptprozess | `src/main/main.js` | Fenster, Tabs, Arbeitsbereiche, geteilte Ansicht, Schlafmodus, Sitzung, Downloads, IPC |
| Datenschutz | `privacy.js`, `blocker.js`, `shared/lists.js` | eine Browser-Sitzung, HTTPS-Zwang, Link-Bereinigung, Berechtigungen, Spurlos-Löschung, Filterlisten |
| Netz | `vpn.js` | NordVPN-HTTPS-Proxy (Port 89) mit Notaus und Serverwechsel; DoH (Quad9 Standard) |
| Zugangsdaten | `vault.js` | Passwörter einzeln mit `safeStorage` (DPAPI/Schlüsselbund), Freigabe per Windows Hello / Touch ID |
| Verlauf | `history.js` | lokal, Frist einstellbar, Suche, Löschen |
| KI | `ai.js` | Claude/ChatGPT mit eigenem Schlüssel oder Ollama lokal, Streaming, Gespräche lokal |
| Updates | `updater.js` | GitHub-Releases; Windows still per NSIS, Mac (unsigniert) per eigenem App-Austausch |
| Oberfläche | `src/renderer/*`, `preload/chrome-preload.js` | ImmoAdv Fade, nur über schmale IPC-Schnittstelle; Tab-Skript `preload/tab-preload.js` meldet nur Anmeldeformulare |

Sicherheitsgrenzen: Befehle nur vom eigenen Fenster (`fromUI`), Passwort-Meldungen nur von echten Tabs, Seitenadresse kommt vom Browser (nicht von der Seite), Ausfüllen nur auf der gespeicherten Domain, KI ohne Werkzeuge (Seiteninhalt nur als Daten), keine Pop-up-Fenster, keine `<webview>`, Electron-Fuses (kein RunAsNode, ASAR-Integrität, Cookie-Verschlüsselung).

## Umsetzungsstand der Vorgabe (Master-Prompt 3.0)
**Umgesetzt:** Adressleiste mit Vorschlägen (Tabs, Lesezeichen, Verlauf), Suchmaschinen, Tastenkürzel, Tabs oben/links, Anheften, Duplizieren, Ziehen, Tab-Suche mit Vorschau, Schlafmodus, wieder öffnen, geteilte Ansicht, Sitzung wiederherstellen, Arbeitsbereiche (Name/Farbe/Symbol), Lesezeichen (Ordner, Tags, Suche, Import/Export, Dubletten), Verlauf (Suche, Zeitraum, Seite, einzeln/alles löschen, Frist), Downloads mit Defender-Prüfung, KI-Assistent (Zusammenfassen, Erklären, Übersetzen, Fragen zur Seite/Auswahl, Streaming, Gesprächsverlauf, Export, Quellenangabe, eigene Vorgaben, Prompt-Injection-Schutz), Übersetzen (Google), Vorlesen (Systemstimme), PDF-Betrachter mit Unterschrift, Entwicklertools, Drucken, Blocker/Malware/Phishing, HTTPS-Zwang, DoH, NordVPN, Passwort-Tresor, Windows Hello/Touch ID, Datenschutz-Center mit echten Werten, Einstellungen in Kategorien, Auto-Update.

**Teilweise:** Geräte-Sync (Passwörter/Lesezeichen per Export/Import; Ende-zu-Ende-Sync über ImmoAdv-Konto geplant), Workspace-Lesezeichen (Ordner statt getrennter Listen), Tab-Gruppen (über Arbeitsbereiche).

**Nicht umgesetzt (bewusst):** privater Modus (Spurlos-Regeln gelten immer), KI-Browser-Agent und Automations-Center (Risiko ungewollter Aktionen; erst mit Freigabe-Workflow), Recherche-Engine mit Mehrquellen-Prüfung, Shopping-Assistent, Notizen, mehrere Fenster, Erweiterungen.

**Plattform-Grenzen:** Mac-App ist ohne Apple-Entwicklerzertifikat nicht beglaubigt (erster Start per Rechtsklick → Öffnen). Kein Schutz ist 100 %.
