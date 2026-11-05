// KI-Anfragen für den Hintergrund (Zusammenfassung direkt auf der Webseite, 05.11.2026).
// Gleiche Anbieter wie der KI-Assistent: lokal über Ollama oder Claude/ChatGPT mit eigenem Schlüssel.
// Webseiten-Inhalt geht nur als Daten in <webseite> mit; der Assistent hat keine Aktionen.
'use strict';
const AiCall = (() => {
  const OLLAMA = 'http://127.0.0.1:11434';

  async function* lines(res) {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) yield l; }
    }
    if (buf.trim()) yield buf.trim();
  }
  function fail(msg, action) { const e = new Error(msg); e.action = action; return e; }
  async function errorText(res) {
    if (res.status === 401 || res.status === 403) return 'Schlüssel ungültig oder ohne Berechtigung – bitte in den Einstellungen prüfen.';
    if (res.status === 429) return 'Zu viele Anfragen oder Guthaben aufgebraucht – kurz warten.';
    if (res.status === 404) return 'Modell nicht gefunden – bitte in den Einstellungen prüfen.';
    return `Der KI-Anbieter meldet einen Fehler (${res.status}).`;
  }

  async function ollamaReady(cfg) {
    let tags;
    try { tags = await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) })).json(); }
    catch (e) { throw fail('Ollama läuft gerade nicht – bitte das Programm „Ollama“ öffnen und erneut versuchen.', 'ollama'); }
    const want = String(cfg.model || '');
    const have = (tags.models || []).map((m) => m.name || m.model);
    if (!have.some((n) => n === want || n === `${want}:latest` || n.split(':')[0] === want)) {
      const p = await Native.call('ai.pull', { model: want }).catch(() => null);
      throw fail(`Die ImmoAdv KI wird gerade einmalig eingerichtet (${want}${p && p.pct ? `, ${p.pct} %` : ''}) – in ein paar Minuten noch einmal versuchen.`, 'settings');
    }
  }

  async function stream(cfg, sys, messages, signal, onText) {
    if (!cfg || (cfg.needsKey && !cfg.key)) throw fail('Die KI ist noch nicht eingerichtet.', 'settings');
    if (cfg.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal, credentials: 'omit',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: cfg.model, max_tokens: 1500, system: sys, messages, stream: true }) });
      if (!res.ok) throw fail(await errorText(res), 'settings');
      for await (const l of lines(res)) { if (!l.startsWith('data:')) continue; let d; try { d = JSON.parse(l.slice(5)); } catch (e) { continue; } if (d.type === 'content_block_delta' && d.delta && d.delta.text) onText(d.delta.text); }
      return;
    }
    if (cfg.provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal, credentials: 'omit',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, stream: true, messages: [{ role: 'system', content: sys }, ...messages] }) });
      if (!res.ok) throw fail(await errorText(res), 'settings');
      for await (const l of lines(res)) { if (!l.startsWith('data:') || l.includes('[DONE]')) continue; try { const c = JSON.parse(l.slice(5)).choices; const t = c && c[0] && c[0].delta && c[0].delta.content; if (t) onText(t); } catch (e) { /* weiter */ } }
      return;
    }
    await ollamaReady(cfg);
    const think = /^qwen3/i.test(cfg.model) ? { think: false } : {};
    const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, stream: true, keep_alive: '30m', ...think, messages: [{ role: 'system', content: sys }, ...messages] }) });
    if (!res.ok) throw fail(await errorText(res), 'settings');
    let inThink = false;
    for await (const l of lines(res)) {
      let m; try { m = JSON.parse(l).message; } catch (e) { continue; }
      let t = (m && m.content) || '', out = '';
      while (t) {
        if (inThink) { const e = t.indexOf('</think>'); if (e < 0) { t = ''; break; } inThink = false; t = t.slice(e + 8); }
        else { const b = t.indexOf('<think>'); if (b < 0) { out += t; t = ''; break; } out += t.slice(0, b); inThink = true; t = t.slice(b + 7); }
      }
      if (out) onText(out);
    }
  }
  return { stream };
})();
