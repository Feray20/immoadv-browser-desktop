// Baut das Microsoft-Store-Paket (.appx) – kostenlos: Microsoft signiert es beim Hochladen in Partner Center.
// Braucht die Produktidentität aus Partner Center (App → Produktverwaltung → Produktidentität):
//   STORE_IDENTITY_NAME   „Package/Identity/Name“, z. B. 12345FerayKorkmaz.ImmoAdvBrowser
//   STORE_PUBLISHER       „Package/Identity/Publisher“, z. B. CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
// Fehlt eins davon, wird nichts gebaut (kein Fehler).
import fs from 'node:fs';
import { createRequire } from 'node:module';

const identityName = (process.env.STORE_IDENTITY_NAME || '').trim();
const publisher = (process.env.STORE_PUBLISHER || '').trim();
if (!identityName || !publisher) {
  console.log('Keine Store-Produktidentität hinterlegt – Store-Paket wird übersprungen.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const builder = require('electron-builder');
const yaml = require(createRequire(require.resolve('electron-builder')).resolve('js-yaml'));

const config = yaml.load(fs.readFileSync('electron-builder.yml', 'utf8'));
// Store-Pakete dürfen http/https nicht selbst als Protokoll anmelden (reservierte Namen) –
// als Standardbrowser wird die App unter Windows über die Einstellungen gewählt.
config.protocols = (config.protocols || []).filter((p) => !p.schemes.some((s) => s === 'http' || s === 'https'));
delete config.publish;                       // Store-Version holt Updates nur aus dem Store
config.appx = { ...config.appx, identityName, publisher };

await builder.build({
  targets: builder.Platform.WINDOWS.createTarget('appx', builder.Arch.x64),
  config,
  publish: 'never'
});
const files = fs.readdirSync('dist').filter((f) => f.endsWith('.appx'));
console.log(`Store-Paket fertig: ${files.join(', ')} – in Partner Center unter „Pakete“ hochladen.`);
