// Shared gate for every /api route: the app's own pages only, sane body sizes,
// and a per-instance burst limit. The Vercel Firewall rate limit is the real wall;
// this keeps a stray script from reaching the Anthropic key through a warm instance.
const ALLOWED = [/^https:\/\/pot-prototype\.vercel\.app$/, /^https:\/\/pot-prototype-[a-z0-9-]+\.vercel\.app$/, /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
const MAX_BYTES = 6_000_000; // a 1280px JPEG as base64 is well under this
const WINDOW_MS = 60_000, MAX_PER_WINDOW = 60; // a language switch translates every plant at once
const hits = new Map(); // ip -> timestamps (lives as long as the warm instance)

export function guard(request) {
  const origin = request.headers.get('origin') || originOf(request.headers.get('referer'));
  if (!origin || !ALLOWED.some((rx) => rx.test(origin))) return deny(403, 'forbidden', 'Not allowed.');

  const size = Number(request.headers.get('content-length') || 0);
  if (size > MAX_BYTES) return deny(413, 'too_large', 'That request is too big.');

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  if (recent.length > MAX_PER_WINDOW) return deny(429, 'busy', 'Too many requests right now. Try again in a minute.');
  return null;
}

function originOf(url) { try { return new URL(url).origin; } catch { return ''; } }
function deny(status, error, message) {
  return new Response(JSON.stringify({ error, message }), { status, headers: { 'content-type': 'application/json' } });
}
