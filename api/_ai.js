// The one place that reads ANTHROPIC_API_KEY. The key is trimmed and refused unless it is a whole key:
// a key copied from the console's key list ("sk-ant-api03-bU0…ZQAA") or with stray spaces used to crash every AI call.
import Anthropic from '@anthropic-ai/sdk';

export const KEY_RX = /^sk-ant-[A-Za-z0-9_-]{40,}$/;
export const aiKey = () => {
  const k = String(process.env.ANTHROPIC_API_KEY || '').trim();
  return KEY_RX.test(k) ? k : '';
};

const key = aiKey();
if (process.env.ANTHROPIC_API_KEY && !key) console.error('AI KEY MALFORMED: ANTHROPIC_API_KEY is not a whole sk-ant- key');
export const client = key ? new Anthropic({ apiKey: key }) : null;

// what the app hears when the AI can't be reached because of the key (missing, malformed, expired or revoked)
export function aiDown(message) {
  return new Response(JSON.stringify({ error: 'ai_down', message }), { status: 503, headers: { 'content-type': 'application/json' } });
}
export function keyRejected(err) {
  if (err?.status !== 401 && err?.status !== 403) return false;
  console.error('AI KEY REJECTED by Anthropic:', err.status, err.message);
  return true;
}

// one log line per model call: which feature, which model answered, how many tokens — no text, no images
export function logUsage(kind, response) {
  const u = response?.usage;
  if (!u) return;
  console.log('ai usage', JSON.stringify({ kind, model: response.model, in: u.input_tokens, out: u.output_tokens, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 }));
}
