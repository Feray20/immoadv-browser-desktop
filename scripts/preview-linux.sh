#!/usr/bin/env bash
# Vorschau für Version 4 (nur Prüfzweig): echter Firefox ESR + ImmoAdv-Profil + Erweiterung unter Linux/Xvfb,
# Bildschirmfotos als Assets am Entwurfs-Release „v4-vorschau“ (nur zum Prüfen, wird nie veröffentlicht).
set -euo pipefail
ROOT="$(pwd)"
W="$ROOT/vorschau"; rm -rf "$W"; mkdir -p "$W/shots"
FF="$W/motor"; PROF="$W/profil"; mkdir -p "$FF" "$PROF/chrome" "$PROF/extensions"

echo "== Firefox ESR laden"
curl -sSL -o "$W/ff.tar" "https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=linux64&lang=de"
tar -xf "$W/ff.tar" -C "$FF"
APP="$FF/firefox"
"$APP/firefox" --version || true

echo "== Motor-Einstellungen"
mkdir -p "$APP/defaults/pref" "$APP/distribution"
cp engine/autoconfig.js "$APP/defaults/pref/autoconfig.js"
cp engine/immoadv.cfg "$APP/immoadv.cfg"
XPI="$ROOT/vendor/extension/immoadv.xpi"
node -e '
const fs=require("fs"); const p=JSON.parse(fs.readFileSync("engine/policies.json","utf8"));
p.policies.ExtensionSettings["browser@immoadv.de"].install_url="file://"+process.argv[1];
fs.writeFileSync(process.argv[2], JSON.stringify(p,null,2));' "$XPI" "$APP/distribution/policies.json"

echo "== Profil (wie der Starter es schreibt)"
LAYOUT="${LAYOUT:-horizontal}"
node -e '
const fs=require("fs"); const vertical=process.argv[2]==="vertical";
const uuids=JSON.stringify({"browser@immoadv.de":"6f1a5c1e-3d2b-4e8a-9b7c-1d2e3f4a5b6c"}).replace(/"/g,"\\\"");
const v={bookmarkBar:"always",verticalTabs:String(vertical),sidebarVisibility:vertical?"always-show":"hide-sidebar",suspendMs:"1800000",startupPage:"1",
 httpsOnly:"true",trrMode:"2",trrUri:"https://dns.quad9.net/dns-query",firefoxPasswords:"false",keepHistory:"true",downloadDir:"/tmp",extUuids:uuids};
let t=fs.readFileSync("engine/user.js","utf8").replace(/\{\{(\w+)\}\}/g,(_,k)=>v[k]);
t+="\nuser_pref(\"browser.policies.loglevel\", \"debug\");\nuser_pref(\"browser.dom.window.dump.enabled\", true);\nuser_pref(\"devtools.console.stdout.chrome\", true);\nuser_pref(\"devtools.console.stdout.content\", true);\n";
fs.writeFileSync(process.argv[1], t);' "$PROF/user.js" "$LAYOUT"
cp engine/chrome/userChrome.css engine/chrome/userContent.css "$PROF/chrome/"
cp "$XPI" "$PROF/extensions/browser@immoadv.de.xpi"
# Lesezeichen wie aus Version 3 kommen über die Erweiterung (Übernahme) – hier ein paar Beispiele über die Richtlinie
node -e '
const fs=require("fs"); const f=process.argv[1]; const p=JSON.parse(fs.readFileSync(f,"utf8"));
p.policies.Bookmarks=[["ImmoAdv","https://immoadv.de"],["ImmoScout24","https://www.immobilienscout24.de"],["Immowelt","https://www.immowelt.de"],["Kleinanzeigen","https://www.kleinanzeigen.de/s-immobilien/c195"]]
 .map(([Title,URL])=>({Title,URL,Placement:"toolbar"}));
fs.writeFileSync(f, JSON.stringify(p,null,2));' "$APP/distribution/policies.json"

echo "== Starten (Xvfb)"
export DISPLAY=:99
Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 &
sleep 2
(command -v openbox >/dev/null && openbox >/dev/null 2>&1 &) || true
shot() { sleep "${2:-6}"; import -window root "$W/shots/$1.png" || xwd -root -silent | convert xwd:- "$W/shots/$1.png"; echo "Foto $1"; }
# je Foto ein frischer Start (Fernsteuerung eines laufenden Firefox hängt unter Xvfb)
run() { local name=$1 wait=$2; shift 2
  "$APP/firefox" --profile "$PROF" "$@" >> "$W/firefox.log" 2>&1 &
  local pid=$!; shot "$name" "$wait"; kill $pid 2>/dev/null || true; sleep 3; pkill -f "$PROF" 2>/dev/null || true; sleep 1; }
run 01-start 20
run 02-seite 15 "https://www.immowelt.de/"
run 03-einstellungen 10 "moz-extension://6f1a5c1e-3d2b-4e8a-9b7c-1d2e3f4a5b6c/pages/settings.html#sicherheit"
run 04-google 15 "https://accounts.google.com/"
run 06-neuertab 10 "moz-extension://6f1a5c1e-3d2b-4e8a-9b7c-1d2e3f4a5b6c/pages/newtab.html"
run 05-menue 10 "moz-extension://6f1a5c1e-3d2b-4e8a-9b7c-1d2e3f4a5b6c/pages/popup.html"
grep -vE "channel error|dbus-launch|OnProxyReady|JavaScript warning" "$W/firefox.log" | head -400 > "$W/shots/log.txt" || true
ls "$PROF/extensions" >> "$W/shots/log.txt" || true
echo "--- addons" >> "$W/shots/log.txt"; (node -e 'const j=require(process.argv[1]);for(const a of j.addons)console.log(a.id,a.version,"aktiv="+a.active,a.location,"sig="+a.signedState)' "$PROF/extensions.json" >> "$W/shots/log.txt") || true
cat "$W/shots/log.txt" | head -80

echo "== Hochladen"
[ -z "${GH_TOKEN:-}" ] && { echo "GH_TOKEN fehlt"; exit 0; }
API="https://api.github.com/repos/$CIRCLE_PROJECT_USERNAME/$CIRCLE_PROJECT_REPONAME"
TAG="v4-vorschau"
REL=$(curl -s -H "Authorization: Bearer $GH_TOKEN" "$API/releases?per_page=30" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(x=>x.tag_name===process.argv[1]);console.log(r?r.id:"")})' "$TAG")
if [ -z "$REL" ]; then
  REL=$(curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" "$API/releases" -d "{\"tag_name\":\"$TAG\",\"name\":\"Vorschau Version 4 (nur Prüfung)\",\"draft\":true,\"target_commitish\":\"$CIRCLE_SHA1\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
fi
# alte Fotos ersetzen
curl -s -H "Authorization: Bearer $GH_TOKEN" "$API/releases/$REL/assets?per_page=100" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).forEach(a=>console.log(a.id)))' | while read -r A; do
  curl -s -X DELETE -H "Authorization: Bearer $GH_TOKEN" "$API/releases/assets/$A" >/dev/null; done
for f in "$W"/shots/*; do
  n="${LAYOUT}-$(basename "$f")"
  ct=$([[ "$f" == *.png ]] && echo image/png || echo text/plain)
  curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: $ct" --data-binary @"$f" "https://uploads.github.com/repos/$CIRCLE_PROJECT_USERNAME/$CIRCLE_PROJECT_REPONAME/releases/$REL/assets?name=$n" >/dev/null && echo "hochgeladen $n"
done
exit 0
