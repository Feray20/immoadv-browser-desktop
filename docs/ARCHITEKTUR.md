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

## Upload-Verlauf (4.1.25, 02.11.2026)
| Teil | Datei | Aufgabe |
|---|---|---|
| Erkennung | `extension/content/uploads.js` (alle Frames, ab Dokumentstart) | Dateiauswahl (`input[type=file]`, Mehrfach, iFrames) und Drag & Drop auf Upload-Flächen (nur wenn die Seite das Ablegen übernimmt); SHA-256 lokal |
| Fingerabdruck | `extension/lib/sha256.js` | SHA-256 der unveränderten Bytes; bis 256 MB Web-Krypto, darüber in 4-MB-Stücken; Hex klein – gleich wie iOS (CryptoKit) |
| Regeln | `extension/lib/uploads-core.js` | Adresse bereinigen (keine Tokens/Sitzungen/Tracking/Mailadressen, kein #), Portal + Arbeitgeber (nur eindeutig aus der Adresse), Dokumenttyp (Dateiname, „vermutet“) |
| Status | `extension/lib/uploadtrack.js` | SELECTED → TRANSFER_STARTED/COMPLETED/FAILED nur bei passender Anfrage desselben Tabs (Dateiname im Formular oder Größe); SERVER_ACKNOWLEDGED wird nie geraten |
| Speicher | `launcher/uploads.js` | `uploads` in einstellungen.json, Felder fest begrenzt, Status nur vorwärts, seitenweise (< 1 MB je Nachricht) |
| Abgleich | `launcher/sync.js` | Datensatz-Art `up` (rid = HMAC der Ereignis-ID), Löschungen auf allen Geräten; Sofort-Abgleich über Supabase Realtime (`browser_sync` in `supabase_realtime`), Minuten-Takt bleibt Rückfall |
| Oberfläche | `extension/pages/uploads.*` | ⋯-Menü über „Einstellungen“; Verlauf, Bewerbungsakten, Versionen, Datei prüfen (inkl. PDF-Prüfung mit PDF.js), CSV/PDF-Export; Schalter unter Einstellungen → Allgemein |

Grenzen: Uploads über Wege, die Firefox der Erweiterung nicht zeigt (z. B. Datei-Inhalte, die eine Seite selbst erzeugt), werden nicht erkannt. Ob ein Upload übertragen wurde, ist eine Schätzung anhand der Anfrage (Dateiname/Größe) – ohne Treffer bleibt „Ausgewählt“.
