#!/usr/bin/env bash
# ImmoAdv Browser auf Ferays eigenem PC/Mac bauen (Azure-Agent) und privat auf immoadv.de veröffentlichen.
# Aufruf: bash scripts/azure-build.sh windows|mac
set -euo pipefail
P="${1:?windows oder mac}"
cd "$(dirname "$0")/.."
export CSC_IDENTITY_AUTO_DISCOVERY=false        # ohne eigenes Zertifikat (Store signiert die Store-Version kostenlos)
node --version
npm install --no-audit --no-fund
npm test
node scripts/fetch-vendor.mjs
node scripts/build-rules.mjs
node scripts/build-extension.mjs              # Version 4: ImmoAdv-Erweiterung für den Firefox-Motor
rm -rf dist
if [ "$P" = "windows" ]; then
  npx electron-builder --win --x64 --publish never
  node scripts/publish-immoadv.mjs windows       # zuerst das Update für installierte Browser
  node scripts/store-package.mjs                 # dann das Store-Paket (.appx) – liegt in Azure unter „Artefakte“
  rm -rf store && mkdir -p store && cp dist/*.appx store/ 2>/dev/null || true
else
  npx electron-builder --mac --universal --publish never
  node scripts/publish-immoadv.mjs mac
fi
