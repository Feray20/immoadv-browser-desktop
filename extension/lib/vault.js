// Kleiner Tresor für die VPN-Zugangsdaten: AES-GCM (WebCrypto) mit einem nicht exportierbaren Schlüssel,
// der nur in diesem Chrome-Profil liegt. Nichts im Klartext, nichts wird synchronisiert oder versendet.
const DB = 'immoadv-vault';

function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('keys', mode);
    const req = fn(tx.objectStore('keys'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
async function key() {
  let k = await idb('readonly', (s) => s.get('main'));
  if (!k) {
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idb('readwrite', (s) => s.put(k, 'main'));
  }
  return k;
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function saveSecret(name, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(value)));
  await chrome.storage.local.set({ ['secret:' + name]: { iv: b64(iv), ct: b64(ct) } });
}
export async function readSecret(name) {
  const box = (await chrome.storage.local.get('secret:' + name))['secret:' + name];
  if (!box) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await key(), unb64(box.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }
}
export const deleteSecret = (name) => chrome.storage.local.remove('secret:' + name);
export const hasSecret = async (name) => !!(await chrome.storage.local.get('secret:' + name))['secret:' + name];
