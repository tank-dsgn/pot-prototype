// POST /api/install — one anonymous mark per installed copy of the app: a random id made on the device,
// the kind of phone and the language. No names, no IP, no user agent are kept.
// GET /api/install?k=… — the owner's summary page (the key is the STATS_KEY env var).
import { put, list, del } from '@vercel/blob';
import { guard } from './_guard.js';
import { json } from './_reminders.js';

const PREFIX = 'installs/';

export async function POST(request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: 'not_configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const id = String(body.id || '');
  if (!/^[a-f0-9]{16,40}$/.test(id)) return json({ error: 'bad_request' }, 400);
  const os = ['ios', 'android'].includes(body.os) ? body.os : 'other';
  const lang = body.lang === 'ru' ? 'ru' : 'en';
  // everything the summary needs is in the path and the upload date, so counting never opens a record;
  // a repeated mark from the same copy lands on the same path and keeps the first date
  try {
    await put(`${PREFIX}${id}__${os}_${lang}.json`, '{}', { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
  } catch { /* already counted */ }
  return json({ ok: true });
}

export async function GET(request) {
  const key = process.env.STATS_KEY;
  if (!key || new URL(request.url).searchParams.get('k') !== key) return new Response('Not found', { status: 404 });
  // the owner can drop a mark (a test one, say): ?k=…&del=<id>
  const drop = new URL(request.url).searchParams.get('del');
  if (drop && /^[a-f0-9]{16,40}$/.test(drop)) {
    const found = await list({ prefix: `${PREFIX}${drop}__`, limit: 10 });
    await Promise.all(found.blobs.map((b) => del(b.url)));
    return json({ ok: true, removed: found.blobs.length });
  }
  const rows = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    cursor = page.hasMore ? page.cursor : undefined;
    for (const b of page.blobs) {
      const m = b.pathname.match(/__(ios|android|other)_(ru|en)\.json$/);
      if (m) rows.push({ os: m[1], lang: m[2], at: new Date(b.uploadedAt) });
    }
  } while (cursor);
  rows.sort((a, b) => b.at - a.at);
  const count = (f) => rows.filter(f).length;
  const days = {};
  for (const r of rows) { const d = r.at.toISOString().slice(0, 10); days[d] = (days[d] || 0) + 1; }
  const OS = { ios: 'iPhone', android: 'Android', other: 'другое' };
  const fmt = (d) => d.toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Pot — установки</title>
<style>body{font:17px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:24px 16px;background:#f1efec;color:#1c1917}
main{max-width:480px;margin:0 auto}h1{font-size:28px;line-height:34px;margin:0 0 4px}p{margin:0;color:#78716c}
.big{font-size:56px;line-height:64px;font-weight:700;color:#15803d;margin:24px 0 0}
table{width:100%;border-collapse:collapse;margin-top:24px;background:#fff;border-radius:12px;overflow:hidden}
td,th{text-align:left;padding:12px 16px;border-bottom:1px solid #f1efec;font-weight:400}th{color:#78716c;font-size:15px}td:last-child,th:last-child{text-align:right}
h2{font-size:20px;line-height:25px;margin:32px 0 0}
@media (prefers-color-scheme:dark){body{background:#0c0a09;color:#fff}table{background:#1c1917}td,th{border-color:#0c0a09}p,th{color:#d6d3d1}.big{color:#22c55e}}</style>
<main><h1>Установки Pot</h1><p>Копии приложения, запущенные с экрана «Домой». Без имён: каждая отметка — одно устройство.</p>
<div class="big">${rows.length}</div><p>всего · iPhone ${count((r) => r.os === 'ios')} · Android ${count((r) => r.os === 'android')} · другое ${count((r) => r.os === 'other')} · на русском ${count((r) => r.lang === 'ru')} · на английском ${count((r) => r.lang === 'en')}</p>
<h2>По дням</h2><table><tr><th>День</th><th>Установок</th></tr>${Object.entries(days).map(([d, n]) => `<tr><td>${d.split('-').reverse().join('.')}</td><td>${n}</td></tr>`).join('') || '<tr><td>Пока нет</td><td>0</td></tr>'}</table>
<h2>Последние</h2><table><tr><th>Когда (Минск)</th><th>Телефон · язык</th></tr>${rows.slice(0, 30).map((r) => `<tr><td>${fmt(r.at)}</td><td>${OS[r.os]} · ${r.lang}</td></tr>`).join('') || '<tr><td>Пока нет</td><td></td></tr>'}</table>
<p style="margin-top:24px;font-size:15px">Переустановка считается новой установкой: при удалении с экрана «Домой» телефон стирает данные приложения.</p></main></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
