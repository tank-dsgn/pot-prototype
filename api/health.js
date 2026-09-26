// GET /api/health — is the AI working? Open https://pot-prototype.vercel.app/api/health to see.
import { checkAi } from './_aicheck.js';

export async function GET() {
  const ai = await checkAi();
  if (!ai.ok) console.error('AI KEY PROBLEM:', ai.reason);
  return new Response(JSON.stringify({ ai: ai.ok ? 'ok' : 'down', reason: ai.reason, checked: new Date().toISOString() }), {
    status: ai.ok ? 200 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
