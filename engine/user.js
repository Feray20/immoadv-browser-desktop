// ImmoAdv Browser – Grundeinstellungen des ImmoAdv-Profils (Firefox-Motor).
// Der Starter schreibt diese Datei bei jedem Start neu; Firefox übernimmt sie beim Öffnen.
// Platzhalter {{…}} füllt der Starter aus (Einstellungen der ImmoAdv-Seite „Einstellungen“).

// ---------- Aussehen: ImmoAdv-Fade-Oberfläche ----------
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);   // userChrome.css / userContent.css
user_pref("browser.theme.content-theme", 1);                               // Inhalt hell (Feray 03.11.2026: „hell Inhalt, nicht ImmoAdv-Fade weg“)
user_pref("browser.theme.toolbar-theme", 0);                               // Oberfläche (Leisten, Tabs, Menüs) im dunklen ImmoAdv-Fade
user_pref("layout.css.prefers-color-scheme.content-override", 1);   // Webseiten immer hell (Feray 03.11.2026: „Browser bitte immer hell lassen“)
user_pref("browser.tabs.inTitlebar", 1);                                   // Tabs in der Titelleiste (kein Extra-Rahmen)
user_pref("browser.compactmode.show", true);
user_pref("browser.uidensity", 0);
user_pref("browser.toolbars.bookmarks.visibility", "{{bookmarkBar}}");
user_pref("sidebar.revamp", {{sidebarRevamp}});                 // nur bei Tabs links; sonst keine Leiste am linken Rand (Verlauf/Lesezeichen im ⋯-Menü)
user_pref("sidebar.verticalTabs", {{verticalTabs}});
user_pref("sidebar.visibility", "{{sidebarVisibility}}");
user_pref("sidebar.main.tools", "aichat,history,bookmarks");
user_pref("browser.tabs.firefox-view", false);
user_pref("browser.tabs.tabmanager.enabled", true);
user_pref("browser.tabs.hoverPreview.enabled", true);
user_pref("browser.tabs.hoverPreview.showThumbnails", true);
user_pref("browser.tabs.groups.enabled", true);
user_pref("browser.tabs.unloadOnLowMemory", true);                         // Tabs schlafen legen, wenn der Speicher knapp wird
user_pref("browser.tabs.min_inactive_duration_before_unload", {{suspendMs}});
user_pref("browser.tabs.closeWindowWithLastTab", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.ctrlTab.sortByRecentlyUsed", true);
user_pref("browser.startup.page", {{startupPage}});                          // 3 = letzte Sitzung wiederherstellen
user_pref("extensions.webextensions.uuids", "{{extUuids}}");
user_pref("browser.startup.homepage", "moz-extension://6f1a5c1e-3d2b-4e8a-9b7c-1d2e3f4a5b6c/pages/newtab.html");   // ImmoAdv-Startseite
user_pref("browser.newtabpage.enabled", true);
user_pref("browser.aboutConfig.showWarning", false);
user_pref("browser.aboutwelcome.enabled", false);
// Kein Firefox-Willkommensfenster: Der ImmoAdv Browser richtet alles selbst ein (Mozilla-Nutzungsbedingungen gelten weiter)
user_pref("browser.preonboarding.enabled", false);
user_pref("termsofuse.bypassNotification", true);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("browser.termsofuse.prefMigrationCheck", true);
// Sofort sichtbar beim Start über Dock/Taskleiste (Feray 03.11.2026): Windows zeigt das Fenstergerüst, bevor alles geladen ist;
// Tabs der letzten Sitzung laden erst beim Anklicken; das Programm prüft nicht bei jedem Start, ob es Standardbrowser ist.
user_pref("browser.startup.preXulSkeletonUI", true);
user_pref("browser.sessionstore.restore_on_demand", true);
user_pref("browser.sessionstore.restore_pinned_tabs_on_demand", true);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("startup.homepage_welcome_url", "");
user_pref("startup.homepage_welcome_url.additional", "");
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.display.use_system_colors", false);
user_pref("widget.non-native-theme.scrollbar.style", 1);
// Keine stehenden Scrollleisten (Feray 02.11.2026: „scrollen und links/rechts mit der Maus ohne Scrollleiste“):
// schmale Leisten erscheinen nur kurz beim Scrollen und liegen über dem Inhalt – wie am Mac/iPhone.
user_pref("ui.useOverlayScrollbars", 1);
// Ganz ohne Scrollleisten (02.11.2026, userContent.css): Rollen mit gedrücktem Mausrad (Mittelklick) bleibt möglich.
user_pref("general.autoScroll", true);
user_pref("mousewheel.with_shift.action", 4);
user_pref("ui.key.menuAccessKeyFocuses", false);
user_pref("general.smoothScroll", true);
user_pref("intl.locale.requested", "de");
user_pref("intl.accept_languages", "de-DE,de,en-US,en");
user_pref("font.language.group", "x-western");

// Symbolleiste: Zurück, Vor, Neu laden, Adresse, ImmoAdv-Knöpfe, Downloads, Menü
user_pref("browser.uiCustomization.state", "{\"placements\":{\"widget-overflow-fixed-list\":[],\"unified-extensions-area\":[],\"nav-bar\":[\"back-button\",\"forward-button\",\"stop-reload-button\",\"urlbar-container\",\"immoadv-ki-button\",\"downloads-button\",\"browser_immoadv_de-browser-action\"],\"toolbar-menubar\":[\"menubar-items\"],\"TabsToolbar\":[\"tabbrowser-tabs\",\"new-tab-button\"],\"vertical-tabs\":[],\"PersonalToolbar\":[\"personal-bookmarks\"]},\"seen\":[\"browser_immoadv_de-browser-action\",\"immoadv-ki-button\",\"developer-button\",\"save-to-pocket-button\",\"profile-button\"],\"dirtyAreaCache\":[\"nav-bar\",\"TabsToolbar\",\"PersonalToolbar\",\"vertical-tabs\",\"toolbar-menubar\"],\"currentVersion\":23,\"newElementCount\":0}");
user_pref("immoadv.ui.version", 2);

// ---------- Suche ----------
user_pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
user_pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
user_pref("browser.urlbar.suggest.trending", false);
user_pref("browser.urlbar.suggest.topsites", false);
user_pref("browser.urlbar.trimHttps", true);
user_pref("browser.search.suggest.enabled", true);
user_pref("browser.urlbar.showSearchSuggestionsFirst", true);

// ---------- Startseite/Neuer Tab: kein Firefox-Inhalt, keine Werbung ----------
user_pref("browser.newtabpage.activity-stream.showSponsored", false);
user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
user_pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
user_pref("browser.newtabpage.activity-stream.feeds.snippets", false);
user_pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
user_pref("browser.newtabpage.activity-stream.telemetry", false);
user_pref("extensions.pocket.enabled", false);
user_pref("browser.vpn_promo.enabled", false);
user_pref("browser.promo.focus.enabled", false);
user_pref("browser.promo.pin.enabled", false);
user_pref("browser.preferences.moreFromMozilla", false);
user_pref("extensions.getAddons.showPane", false);
user_pref("extensions.htmlaboutaddons.recommendations.enabled", false);
user_pref("browser.discovery.enabled", false);
user_pref("browser.ml.chat.enabled", false);                   // eigener KI-Assistent statt Firefox-Chat
user_pref("browser.ml.chat.sidebar", false);

// ---------- Datenschutz & Sicherheit ----------
user_pref("dom.security.https_only_mode", {{httpsOnly}});
user_pref("dom.security.https_only_mode_send_http_background_request", false);
user_pref("browser.contentblocking.category", "standard");    // Google-Anmeldung überall (03.11.2026): „streng“ brach „Mit Google anmelden“ auf vielen Seiten – Tracker-Schutz und Cookie-Trennung bleiben an
user_pref("privacy.trackingprotection.enabled", true);
user_pref("privacy.trackingprotection.socialtracking.enabled", true);
user_pref("privacy.query_stripping.enabled", true);
user_pref("privacy.query_stripping.enabled.pbmode", true);
user_pref("privacy.globalprivacycontrol.enabled", true);
user_pref("privacy.donottrackheader.enabled", true);
user_pref("privacy.fingerprintingProtection", false);         // verfälschte Werte ließ Googles Anmeldung scheitern („Browser nicht sicher“) – bekannte Fingerprinter blockt der Tracker-Schutz weiter
user_pref("privacy.trackingprotection.fingerprinting.enabled", true);
user_pref("privacy.trackingprotection.cryptomining.enabled", true);
// Anmelde-Fenster („Mit Google/Apple/Microsoft anmelden“) dürfen ihre Anmeldung an die Seite übergeben (Standard von Firefox).
user_pref("privacy.restrict3rdpartystorage.heuristic.opened_window_after_interaction", true);
user_pref("privacy.restrict3rdpartystorage.heuristic.redirect", true);
user_pref("privacy.restrict3rdpartystorage.heuristic.recently_visited", true);
user_pref("dom.storage_access.enabled", true);
user_pref("dom.storage_access.auto_grants", true);
user_pref("network.cookie.cookieBehavior", 5);                 // vollständiger Cookie-Schutz (jede Seite eigene Keksdose)
// Anmelde-Weiterleitungen (Google → ChatGPT usw.) nicht als „Bounce-Tracker“ löschen (02.11.2026).
user_pref("privacy.bounceTrackingProtection.mode", 3);   // 3 = nur erkennen, nichts löschen
user_pref("browser.safebrowsing.malware.enabled", true);
user_pref("browser.safebrowsing.phishing.enabled", true);
user_pref("browser.safebrowsing.downloads.enabled", true);
user_pref("browser.safebrowsing.downloads.remote.enabled", false);
user_pref("network.trr.mode", {{trrMode}});                    // 2 = verschlüsseltes DNS, 0 = aus (über NordVPN löst der Server auf)
user_pref("network.trr.uri", "{{trrUri}}");
user_pref("network.trr.custom_uri", "{{trrUri}}");
user_pref("network.dns.disablePrefetch", false);          // 03.11.2026 (Feray: „Ladezeiten langsamer“): Adressen von Links vorab auflösen – über das verschlüsselte DNS
user_pref("network.prefetch-next", true);                   // nächste Seite (rel=next) vorab laden – Vorhersage-Dienst bleibt aus
user_pref("network.predictor.enabled", false);
user_pref("media.peerconnection.ice.default_address_only", true);   // WebRTC verrät die echte IP nicht am VPN vorbei
user_pref("media.peerconnection.ice.no_host", true);
user_pref("media.peerconnection.ice.proxy_only_if_behind_proxy", true);
user_pref("geo.provider.network.url", "");
user_pref("browser.region.update.enabled", false);
user_pref("browser.send_pings", false);
user_pref("beacon.enabled", false);
user_pref("browser.formfill.enable", true);
user_pref("permissions.default.desktop-notification", 0);
user_pref("security.OCSP.enabled", 1);
user_pref("security.ssl.require_safe_negotiation", true);
user_pref("security.tls.enable_0rtt_data", false);
user_pref("security.mixed_content.block_display_content", true);
user_pref("security.webauthn.enable_softtoken", false);       // Passkeys nur über Windows Hello / Touch ID / Sicherheitsschlüssel
user_pref("security.webauthn.ctap2", true);
user_pref("security.webauthn.enable_macos_passkeys", true);
user_pref("signon.rememberSignons", {{firefoxPasswords}});     // Passwörter: ImmoAdv-Tresor (Windows Hello) statt Firefox-Speicher
user_pref("signon.management.page.os-auth.optout", "");
user_pref("signon.firefoxRelay.feature", "disabled");
user_pref("extensions.formautofill.creditCards.enabled", false);
user_pref("privacy.history.custom", true);
user_pref("places.history.enabled", {{keepHistory}});
user_pref("privacy.sanitize.sanitizeOnShutdown", false);

// ---------- Keine Telemetrie, keine Studien, keine Werbung ----------
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("toolkit.telemetry.unified", false);
user_pref("toolkit.telemetry.archive.enabled", false);
user_pref("app.shield.optoutstudies.enabled", false);
user_pref("app.normandy.enabled", false);
user_pref("browser.crashReports.unsubmittedCheck.autoSubmit2", false);
user_pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
user_pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
user_pref("messaging-system.rsexperimentloader.enabled", false);

// ---------- Downloads ----------
user_pref("browser.download.autohideButton", false);   // Download-Knopf immer sichtbar
user_pref("browser.download.useDownloadDir", true);
user_pref("browser.download.dir", "{{downloadDir}}");
user_pref("browser.download.folderList", 2);
user_pref("browser.download.always_ask_before_handling_new_types", false);
user_pref("browser.download.open_pdf_attachments_inline", true);
user_pref("pdfjs.enabledCache.state", true);
user_pref("pdfjs.disabled", false);

// ---------- ImmoAdv-Erweiterung (liegt im Profil, wird automatisch aktiviert) ----------
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.installDistroAddons", true);
user_pref("extensions.webextensions.restrictedDomains", "accounts-static.cdn.mozilla.net,accounts.firefox.com,addons.cdn.mozilla.net,addons.mozilla.org,api.accounts.firefox.com,content.cdn.mozilla.net,discovery.addons.mozilla.org,install.mozilla.org,oauth.accounts.firefox.com,profile.accounts.firefox.com,support.mozilla.org,sync.services.mozilla.com");

// ---------- Fenster/Taskleiste: eigenes ImmoAdv-Fenster, getrennt von einem normalen Firefox ----------
// false (02.11.2026): Fenster nutzen die feste Kennung aus TaskBarIDs (launcher/engine.js) – ein Symbol, bleibt bei Updates angeheftet.
user_pref("taskbar.grouping.useprofile", false);
user_pref("browser.taskbar.previews.enable", false);
user_pref("app.update.auto", true);                            // Sicherheitsupdates des Motors direkt von Mozilla
user_pref("app.update.background.enabled", true);

// „Adresse speichern?“ nie mehr fragen (Feray 02.11.2026): Beim Bestellen für Kunden (Dropshipping) sind es fremde Adressen.
// Eigene Adressen trägt man selbst unter Einstellungen → Firefox-Einstellungen → Datenschutz → Adressen ein; nur diese werden angeboten.
user_pref("extensions.formautofill.addresses.capture.enabled", false);
user_pref("extensions.formautofill.addresses.enabled", true);
// Startseite: kein Firefox-Wetter-Kästchen (Feray 02.11.2026: Knopf ragte über den Rahmen; braucht außerdem den Standort)
user_pref("browser.newtabpage.activity-stream.showWeather", false);
user_pref("browser.newtabpage.activity-stream.system.showWeather", false);
user_pref("browser.newtabpage.activity-stream.widgets.system.enabled", false);
// Favicons der Lesezeichen behalten (auch wenn der Verlauf kurz gehalten wird)
user_pref("browser.chrome.site_icons", true);
user_pref("browser.chrome.favicons", true);

// ---------- 02.11.2026 (Feray): Rechtsklick-Menü dunkel statt durchsichtig, Doppelklick wie in Chrome ----------
user_pref("widget.windows.mica.popups", 0);                      // Windows 11: kein durchscheinender „Mica“-Hintergrund in Menüs
user_pref("widget.windows.mica", false);
user_pref("browser.ml.linkPreview.enabled", false);              // Link-Vorschau beim Gedrückthalten aus – störte Doppelklick/Markieren
user_pref("browser.ml.linkPreview.longPress", false);
user_pref("browser.ml.linkPreview.shift", false);
user_pref("ui.click_hold_context_menus", false);
user_pref("browser.tabs.splitView.enabled", false);              // „Link in geteilter Ansicht“ ausblenden (Menü kürzer)
user_pref("layout.word_select.eat_space_to_next_word", false);   // Doppelklick markiert nur das Wort (wie Chrome), ohne Leerzeichen dahinter
// Arbeitsseiten wie im normalen Browser (02.11.2026, Feray: „eBay klappt wieder nicht“): Der Fingerabdruck-Schutz verfälscht
// Canvas/Bildschirm-Werte – die Bot-Erkennung von eBay, Amazon und PayPal hält das für einen Roboter (Anmeldung, Menüs,
// Kasse hängen). Für diese Seiten aus, überall sonst bleibt er an.
// Anmeldedienste (02.11.2026, Feray: „kann mich nicht mit Google anmelden“ bei ChatGPT): deren Bot-Prüfung lehnt
// verfälschte Werte ab („OAuthCallback“) – Fingerabdruck-Schutz dort aus, Tracker-Schutz bleibt.
user_pref("privacy.fingerprintingProtection.granularOverrides", "[{\"firstPartyDomain\":\"ebay.de\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"ebay.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"ebaystatic.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"amazon.de\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"paypal.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"immoadv.de\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"chatgpt.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"openai.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"google.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"google.de\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"youtube.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"gstatic.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"apple.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"icloud.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"live.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"microsoftonline.com\",\"overrides\":\"-AllTargets\"},{\"firstPartyDomain\":\"microsoft.com\",\"overrides\":\"-AllTargets\"}]");
