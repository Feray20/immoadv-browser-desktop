#!/usr/bin/env bash
# Meldet bei einem fehlgeschlagenen Build die letzten Protokollzeilen als Kommentar am Commit auf GitHub.
PLATTFORM="${1:-Build}"
[ -z "$GH_TOKEN" ] && { echo "GH_TOKEN fehlt"; exit 0; }
REPO="${GITHUB_REPOSITORY:-Feray20/immoadv-browser-desktop}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
API="https://api.github.com/repos/$REPO"
{ echo "**Build-Fehler ($PLATTFORM) – letzte Zeilen:**"; echo '```'; tail -120 build.log 2>/dev/null; echo '```'; } > comment.md
node -e 'console.log(JSON.stringify({body:require("fs").readFileSync("comment.md","utf8").slice(-60000)}))' > body.json
CODE=$(curl -s -o resp.txt -w "%{http_code}" -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$API/commits/$SHA/comments" -d @body.json)
LAST=$(grep -iE "error|fehler|failed" build.log 2>/dev/null | tail -1 | tr -d '"\\' | cut -c1-110)
node -e 'console.log(JSON.stringify({state:"error",context:"fehlerbericht/"+process.argv[3],description:(process.argv[1]+" "+process.argv[2]).slice(0,139)}))' "Kommentar:$CODE" "$LAST" "$PLATTFORM" > st.json
curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$API/statuses/$SHA" -d @st.json >/dev/null
echo "Kommentar-Antwort: $CODE"
