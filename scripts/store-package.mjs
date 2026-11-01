// Baut das Microsoft-Store-Paket (.appx) – kostenlos: Microsoft signiert es beim Hochladen in Partner Center.
// Produktidentität aus Partner Center steht in electron-builder.yml (appx.identityName / appx.publisher);
// optional überschreibbar mit STORE_IDENTITY_NAME / STORE_PUBLISHER. Fehlt sie, wird nichts gebaut (kein Fehler).
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const builder = require('electron-builder');
const yaml = require(createRequire(require.resolve('electron-builder')).resolve('js-yaml'));

const config = yaml.load(fs.readFileSync('electron-builder.yml', 'utf8'));
const identityName = (process.env.STORE_IDENTITY_NAME || config.appx?.identityName || '').trim();
const publisher = (process.env.STORE_PUBLISHER || config.appx?.publisher || '').trim();
if (!identityName || !/^CN=[0-9A-F-]{36}$/i.test(publisher)) {
  console.log('Keine gültige Store-Produktidentität hinterlegt – Store-Paket wird übersprungen.');
  process.exit(0);
}
// Store-Paket: keine eigenen Protokolle im Manifest (http/https sind reserviert, sonst doppelte Einträge → MakeAppx-Fehler).
// Als Standardbrowser wird die App unter Windows über die Einstellungen gewählt.
config.protocols = [];
delete config.publish;                       // Store-Version holt Updates nur aus dem Store
config.appx = { ...config.appx, identityName, publisher };

await builder.build({
  targets: builder.Platform.WINDOWS.createTarget('appx', builder.Arch.x64),
  config,
  publish: 'never'
});
const files = fs.readdirSync('dist').filter((f) => f.endsWith('.appx'));
console.log(`Store-Paket fertig: ${files.join(', ')} – in Partner Center unter „Pakete“ hochladen.`);
