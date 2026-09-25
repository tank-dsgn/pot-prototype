// POST /api/remind — saves (or removes) this device's watering schedule for the daily reminder.
// Body: { subscription, lang, plants: [{ name, next }] } or { subscription, off: true }
// `next` is the time (ms) the plant should be watered; the daily run pushes the ones that are due.
import { put, del } from '@vercel/blob';
import { guard } from './_guard.js';
import { configured, pathFor, validSubscription, json } from './_reminders.js';

export async function POST(request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (!validSubscription(body.subscription)) return json({ error: 'bad_request', message: 'Not a push subscription.' }, 400);
  if (!configured()) return json({ error: 'not_configured', message: 'Reminders are not set up on the server yet.' }, 503);

  const path = pathFor(body.subscription.endpoint);
  if (body.off) {
    await del(path).catch(() => {});
    return json({ ok: true, off: true });
  }
  const plants = (Array.isArray(body.plants) ? body.plants : []).slice(0, 100)
    .map((p) => ({ name: String(p.name || '').slice(0, 60), next: Number(p.next) || 0 }))
    .filter((p) => p.name && p.next);
  const record = {
    subscription: { endpoint: body.subscription.endpoint, keys: { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth } },
    lang: body.lang === 'ru' ? 'ru' : 'en',
    plants,
    updated: Date.now(),
  };
  await put(path, JSON.stringify(record), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  return json({ ok: true, plants: plants.length });
}
