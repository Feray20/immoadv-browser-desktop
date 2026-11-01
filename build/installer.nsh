; ImmoAdv Browser als Webbrowser bei Windows anmelden (erscheint dann unter Einstellungen → Apps → Standard-Apps).
; Nur Registrierung – Windows fragt selbst, welcher Browser Standard sein soll (wird nie ungefragt umgestellt).
!macro customInstall
  !define IA_KEY "Software\Clients\StartMenuInternet\ImmoAdvBrowser"
  !define IA_EXE "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr SHCTX "${IA_KEY}" "" "ImmoAdv Browser"
  WriteRegStr SHCTX "${IA_KEY}\DefaultIcon" "" "${IA_EXE},0"
  WriteRegStr SHCTX "${IA_KEY}\shell\open\command" "" '"${IA_EXE}"'
  WriteRegStr SHCTX "${IA_KEY}\Capabilities" "ApplicationName" "ImmoAdv Browser"
  WriteRegStr SHCTX "${IA_KEY}\Capabilities" "ApplicationDescription" "ImmoAdv Browser – Webbrowser mit NordVPN, Blocker und KI-Assistent"
  WriteRegStr SHCTX "${IA_KEY}\Capabilities" "ApplicationIcon" "${IA_EXE},0"
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\StartMenu" "StartMenuInternet" "ImmoAdvBrowser"
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\URLAssociations" "http" "ImmoAdvBrowserURL"
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\URLAssociations" "https" "ImmoAdvBrowserURL"
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".htm" "ImmoAdvBrowserHTML"
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".html" "ImmoAdvBrowserHTML"
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".pdf" "ImmoAdvBrowserPDF"
  WriteRegStr SHCTX "Software\RegisteredApplications" "ImmoAdv Browser" "${IA_KEY}\Capabilities"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserURL" "" "ImmoAdv Browser – Webadresse"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserURL\DefaultIcon" "" "${IA_EXE},0"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserURL\shell\open\command" "" '"${IA_EXE}" "%1"'
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserHTML" "" "ImmoAdv Browser – HTML-Datei"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserHTML\DefaultIcon" "" "${IA_EXE},0"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserHTML\shell\open\command" "" '"${IA_EXE}" "%1"'
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserPDF" "" "ImmoAdv Browser – PDF"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserPDF\DefaultIcon" "" "${IA_EXE},0"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserPDF\shell\open\command" "" '"${IA_EXE}" "%1"'
  WriteRegStr SHCTX "Software\Classes\.htm\OpenWithProgids" "ImmoAdvBrowserHTML" ""
  WriteRegStr SHCTX "Software\Classes\.html\OpenWithProgids" "ImmoAdvBrowserHTML" ""
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "ImmoAdvBrowserPDF" ""
  ; Windows über die neue Browser-Anmeldung informieren
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\ImmoAdvBrowser"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "ImmoAdv Browser"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowserURL"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowserHTML"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowserPDF"
  DeleteRegValue SHCTX "Software\Classes\.htm\OpenWithProgids" "ImmoAdvBrowserHTML"
  DeleteRegValue SHCTX "Software\Classes\.html\OpenWithProgids" "ImmoAdvBrowserHTML"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "ImmoAdvBrowserPDF"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
