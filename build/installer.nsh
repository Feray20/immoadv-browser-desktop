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
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserURL\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserHTML" "" "ImmoAdv Browser – HTML-Datei"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserHTML\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\html.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserHTML\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserPDF" "" "ImmoAdv Browser – PDF"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserPDF\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\pdf.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowserPDF\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.htm\OpenWithProgids" "ImmoAdvBrowserHTML" ""
  WriteRegStr SHCTX "Software\Classes\.html\OpenWithProgids" "ImmoAdvBrowserHTML" ""
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "ImmoAdvBrowserPDF" ""
  ; Windows über die neue Browser-Anmeldung informieren
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Symbol-Zwischenspeicher von Windows auffrischen – sonst zeigt die Taskleiste noch das alte Programm-Symbol
  ExecWait '"$SYSDIR\ie4uinit.exe" -show'
  ; Word, Excel, PowerPoint und Bilder (01.11.2026): eigene Klasse je Endung mit dem Symbol des Dateityps –
  ; erscheint unter „Öffnen mit“; der Standard wird nie ungefragt umgestellt.
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.docx" "" "Word-Dokument"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.docx\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\docx.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.docx\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.docx\OpenWithProgids" "ImmoAdvBrowser.docx" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".docx" "ImmoAdvBrowser.docx"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.doc" "" "Word-Dokument"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.doc\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\doc.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.doc\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.doc\OpenWithProgids" "ImmoAdvBrowser.doc" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".doc" "ImmoAdvBrowser.doc"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.xlsx" "" "Excel-Tabelle"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.xlsx\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\xlsx.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.xlsx\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.xlsx\OpenWithProgids" "ImmoAdvBrowser.xlsx" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".xlsx" "ImmoAdvBrowser.xlsx"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.xls" "" "Excel-Tabelle"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.xls\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\xls.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.xls\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.xls\OpenWithProgids" "ImmoAdvBrowser.xls" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".xls" "ImmoAdvBrowser.xls"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.csv" "" "CSV-Tabelle"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.csv\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\csv.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.csv\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.csv\OpenWithProgids" "ImmoAdvBrowser.csv" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".csv" "ImmoAdvBrowser.csv"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.pptx" "" "PowerPoint-Präsentation"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.pptx\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\pptx.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.pptx\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.pptx\OpenWithProgids" "ImmoAdvBrowser.pptx" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".pptx" "ImmoAdvBrowser.pptx"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.ppt" "" "PowerPoint-Präsentation"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.ppt\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\ppt.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.ppt\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.ppt\OpenWithProgids" "ImmoAdvBrowser.ppt" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".ppt" "ImmoAdvBrowser.ppt"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.png" "" "PNG-Bild"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.png\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\png.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.png\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.png\OpenWithProgids" "ImmoAdvBrowser.png" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".png" "ImmoAdvBrowser.png"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.jpg" "" "JPG-Bild"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.jpg\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\jpg.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.jpg\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.jpg\OpenWithProgids" "ImmoAdvBrowser.jpg" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".jpg" "ImmoAdvBrowser.jpg"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.jpeg" "" "JPEG-Bild"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.jpeg\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\jpeg.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.jpeg\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.jpeg\OpenWithProgids" "ImmoAdvBrowser.jpeg" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".jpeg" "ImmoAdvBrowser.jpeg"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.gif" "" "GIF-Bild"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.gif\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\gif.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.gif\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.gif\OpenWithProgids" "ImmoAdvBrowser.gif" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".gif" "ImmoAdvBrowser.gif"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.webp" "" "WEBP-Bild"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.webp\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\webp.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.webp\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.webp\OpenWithProgids" "ImmoAdvBrowser.webp" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".webp" "ImmoAdvBrowser.webp"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.bmp" "" "BMP-Bild"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.bmp\DefaultIcon" "" "$INSTDIR\resources\dateisymbole\bmp.ico"
  WriteRegStr SHCTX "Software\Classes\ImmoAdvBrowser.bmp\shell\open\command" "" '"${IA_EXE}" -- "%1"'
  WriteRegStr SHCTX "Software\Classes\.bmp\OpenWithProgids" "ImmoAdvBrowser.bmp" ""
  WriteRegStr SHCTX "${IA_KEY}\Capabilities\FileAssociations" ".bmp" "ImmoAdvBrowser.bmp"
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
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.docx"
  DeleteRegValue SHCTX "Software\Classes\.docx\OpenWithProgids" "ImmoAdvBrowser.docx"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.doc"
  DeleteRegValue SHCTX "Software\Classes\.doc\OpenWithProgids" "ImmoAdvBrowser.doc"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.xlsx"
  DeleteRegValue SHCTX "Software\Classes\.xlsx\OpenWithProgids" "ImmoAdvBrowser.xlsx"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.xls"
  DeleteRegValue SHCTX "Software\Classes\.xls\OpenWithProgids" "ImmoAdvBrowser.xls"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.csv"
  DeleteRegValue SHCTX "Software\Classes\.csv\OpenWithProgids" "ImmoAdvBrowser.csv"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.pptx"
  DeleteRegValue SHCTX "Software\Classes\.pptx\OpenWithProgids" "ImmoAdvBrowser.pptx"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.ppt"
  DeleteRegValue SHCTX "Software\Classes\.ppt\OpenWithProgids" "ImmoAdvBrowser.ppt"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.png"
  DeleteRegValue SHCTX "Software\Classes\.png\OpenWithProgids" "ImmoAdvBrowser.png"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.jpg"
  DeleteRegValue SHCTX "Software\Classes\.jpg\OpenWithProgids" "ImmoAdvBrowser.jpg"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.jpeg"
  DeleteRegValue SHCTX "Software\Classes\.jpeg\OpenWithProgids" "ImmoAdvBrowser.jpeg"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.gif"
  DeleteRegValue SHCTX "Software\Classes\.gif\OpenWithProgids" "ImmoAdvBrowser.gif"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.webp"
  DeleteRegValue SHCTX "Software\Classes\.webp\OpenWithProgids" "ImmoAdvBrowser.webp"
  DeleteRegKey SHCTX "Software\Classes\ImmoAdvBrowser.bmp"
  DeleteRegValue SHCTX "Software\Classes\.bmp\OpenWithProgids" "ImmoAdvBrowser.bmp"
!macroend
