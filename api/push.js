// POST /api/push — sends one Web Push reminder to this device, after an optional short delay.
// Body: { subscription, delay?: seconds (≤ 40), title, body, url }
// Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the project's environment variables.
import webpush from 'web-push';
import { waitUntil } from '@vercel/functions';
import { guard } from './_guard.js';

// only the browsers' own push services — never an arbitrary URL
const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

export async function POST(request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const sub = body.subscription;
  let host = '';
  try { host = new URL(sub?.endpoint).hostname; } catch {}
  if (!sub?.keys || !PUSH_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
    return json({ error: 'bad_request', message: 'Not a push subscription.' }, 400);
  }
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return json({ error: 'not_configured', message: 'Reminders are not set up yet.' }, 503);
  webpush.setVapidDetails('https://pot-prototype.vercel.app', pub, priv);

  const payload = JSON.stringify({
    title: String(body.title || 'Pot').slice(0, 80),
    body: String(body.body || '').slice(0, 200),
    url: String(body.url || '/').slice(0, 200),
  });
  const delay = Math.max(0, Math.min(40, Number(body.delay) || 0));
  // answer right away; the reminder goes out after the delay even if the phone is locked meanwhile
  waitUntil((async () => {
    await new Promise((r) => setTimeout(r, delay * 1000));
    try { await webpush.sendNotification(sub, payload); }
    catch (err) { console.error('push failed', err.statusCode, err.body); }
  })());
  return json({ ok: true, in: delay });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
