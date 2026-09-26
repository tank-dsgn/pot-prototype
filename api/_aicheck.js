// Is the AI reachable with the current key? A free call (the models list), no tokens spent.
import { aiKey } from './_ai.js';

export async function checkAi() {
  const key = aiKey();
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'missing' };
  if (!key) return { ok: false, reason: 'malformed' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected' }; // expired, revoked or wrong
    return { ok: res.ok, reason: res.ok ? 'ok' : 'http_' + res.status };
  } catch { return { ok: false, reason: 'unreachable' }; }
}
