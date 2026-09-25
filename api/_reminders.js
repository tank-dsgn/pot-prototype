// Where each device's watering schedule lives: one private Vercel Blob per push subscription.
import { createHash } from 'node:crypto';

export const configured = () => !!(process.env.BLOB_READ_WRITE_TOKEN && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const PREFIX = 'reminders/';
export const pathFor = (endpoint) => PREFIX + createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40) + '.json';

// only the browsers' own push services — never an arbitrary URL
const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];
export function validSubscription(sub) {
  let host = '';
  try { host = new URL(sub?.endpoint).hostname; } catch {}
  return !!(sub?.keys?.p256dh && sub?.keys?.auth && PUSH_HOSTS.some((h) => host === h || host.endsWith('.' + h)));
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
