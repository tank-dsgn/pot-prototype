// GET /api/cron-remind — run once a day by Vercel Cron (vercel.json).
// Pushes one reminder per device listing the plants due for water; drops subscriptions the browser has revoked.
import webpush from 'web-push';
import { list, get, put, del } from '@vercel/blob';
import { configured, PREFIX, json } from './_reminders.js';

const DAY = 86_400_000;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'forbidden' }, 403);
  if (!configured()) return json({ error: 'not_configured' }, 503);
  webpush.setVapidDetails('https://pot-prototype.vercel.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const now = Date.now(), soon = now + DAY / 2; // "today" for everyone the run reaches this morning
  let cursor, sent = 0, dropped = 0, checked = 0;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 500 });
    cursor = page.hasMore ? page.cursor : undefined;
    for (const b of page.blobs) {
      checked++;
      try {
        const res = await get(b.pathname, { access: 'private', useCache: false });
        if (!res) continue;
        const rec = JSON.parse(await new Response(res.stream).text());
        const due = (rec.plants || []).filter((p) => p.next <= soon);
        if (!due.length || (rec.lastSent && now - rec.lastSent < DAY * 0.8)) continue;
        const ru = rec.lang === 'ru';
        const names = due.map((p) => p.name);
        const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? (ru ? ` и ещё ${names.length - 3}` : ` and ${names.length - 3} more`) : '');
        const payload = JSON.stringify({
          title: ru ? 'Пора полить 💧' : 'Time to water 💧',
          body: ru ? `Сегодня: ${shown}` : `Today: ${shown}`,
          url: '/?open=garden',
        });
        try {
          await webpush.sendNotification(rec.subscription, payload);
          sent++;
          await put(b.pathname, JSON.stringify({ ...rec, lastSent: now }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) { await del(b.pathname).catch(() => {}); dropped++; }
          else console.error('reminder push failed', err.statusCode, err.body);
        }
      } catch (err) { console.error('reminder record failed', b.pathname, err?.message); }
    }
  } while (cursor);
  return json({ ok: true, checked, sent, dropped });
}
