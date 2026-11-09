import test from 'node:test';
import assert from 'node:assert/strict';
import { tusUpload, signedParts, TEIL } from '../scripts/tus-upload.mjs';

const SIGNED = 'https://api.immoadv.de/storage/v1/object/upload/sign/desktop/browser/4.1.51/ImmoAdv-Browser-4.1.51-arm64-mac.zip?token=abc.def';
const hdr = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });

test('signierter Link → Basis, Bucket, Pfad, Token', () => {
  assert.deepEqual(signedParts(SIGNED), { base: 'https://api.immoadv.de/storage/v1', bucket: 'desktop', objectName: 'browser/4.1.51/ImmoAdv-Browser-4.1.51-arm64-mac.zip', token: 'abc.def' });
  assert.throws(() => signedParts('https://x.de/anders'), /unbekanntes Format/);
});

test('TUS: startet mit Token, schickt 6-MB-Teile in Reihenfolge, wiederholt einen Fehlversuch', async () => {
  const body = Buffer.alloc(TEIL * 2 + 123, 1);
  const calls = []; let server = 0; let fehler = 1;
  const f = async (url, o) => {
    calls.push({ url, m: o.method, h: o.headers, n: o.body?.length });
    if (o.method === 'POST') return { status: 201, headers: hdr({ location: 'http://storage:5000/upload/resumable/sign/xyz' }), text: async () => '' };
    assert.equal(o.headers['x-signature'], 'abc.def');
    assert.equal(url, 'https://api.immoadv.de/storage/v1/upload/resumable/sign/xyz', 'interne Adresse umgeschrieben');
    assert.equal(o.headers['Upload-Offset'], String(server));
    if (fehler-- > 0) return { status: 502, headers: hdr({}), text: async () => 'Bad Gateway' };
    server += o.body.length;
    return { status: 204, headers: hdr({ 'upload-offset': String(server) }), text: async () => '' };
  };
  await tusUpload(SIGNED, body, { f, log: () => {} });
  const post = calls[0];
  assert.equal(post.url, 'https://api.immoadv.de/storage/v1/upload/resumable/sign');
  assert.equal(post.h['x-signature'], 'abc.def');
  assert.equal(post.h['Upload-Length'], String(body.length));
  assert.match(post.h['Upload-Metadata'], new RegExp(`objectName ${Buffer.from('browser/4.1.51/ImmoAdv-Browser-4.1.51-arm64-mac.zip').toString('base64')}`));
  assert.equal(server, body.length);
  assert.ok(calls.filter((c) => c.m === 'PATCH').every((c) => c.n <= TEIL));
});

test('TUS: Start abgelehnt → klarer Fehler', async () => {
  const f = async () => ({ status: 413, headers: hdr({}), text: async () => '{"error":"Payload too large"}' });
  await assert.rejects(tusUpload(SIGNED, Buffer.alloc(10), { f, log: () => {} }), /nicht gestartet \(413\)/);
});
