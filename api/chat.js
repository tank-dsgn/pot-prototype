// POST /api/chat — Dr Pot, the in-app assistant. Streams plain text back as it is generated.
// Body: { messages: [{ role: 'user' | 'assistant', text }], plant?: { name, latin, care }, image?: "<base64 JPEG>" }
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const SYSTEM = `You are Dr Pot, the plant doctor inside Pot, a plant care app. You help someone work out what is wrong with their plant and what to do about it.

- Write like a calm, practical plant person, not a chatbot. Short paragraphs, no headings, no bullet lists unless you are giving steps.
- Keep each reply under 70 words unless the person asks for detail.
- Diagnose by narrowing down: if the cause is unclear, ask ONE specific question (watering habit, light, soil moisture, undersides of leaves) and stop there.
- When you name a likely cause, say what to do about it in one or two concrete steps, then offer the next thing you could check.
- If a photo comes with the message, describe only what you actually see in it.
- Never invent plant facts you are unsure of; say what you would check instead.
- Answer in the language the person writes in.`;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request', message: 'Send JSON.' }, 400);
  }

  const history = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
  if (!history.length) return json({ error: 'bad_request', message: 'Nothing to answer.' }, 400);
  const image = typeof body.image === 'string' && body.image.length > 1000 && body.image.length < 4_000_000
    ? body.image.replace(/^data:image\/\w+;base64,/, '') : null;

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'not_configured', message: 'The assistant is not connected yet.' }, 503);
  }

  const messages = history.map((m, i) => {
    const text = String(m.text ?? '').slice(0, 4000);
    const last = i === history.length - 1;
    if (last && image && m.role === 'user') {
      return { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }, { type: 'text', text: text || 'Here is the plant.' }] };
    }
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: text || '…' };
  });

  const p = body.plant || {};
  const context = p.name
    ? `\n\nThe person is asking about their ${p.name}${p.latin ? ` (${p.latin})` : ''}.${p.care ? ` What the app knows about caring for it: ${String(p.care).slice(0, 1200)}` : ''}`
    : '';

  try {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5',
      max_tokens: 1200,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: SYSTEM + context,
      messages,
    });

    const encoder = new TextEncoder();
    const out = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (err) {
          console.error('Dr Pot stream error', err?.status, err?.message);
          controller.enqueue(encoder.encode('\n\n(The answer stopped early — try again.)'));
        }
        controller.close();
      },
      cancel() { stream.abort?.(); },
    });

    return new Response(out, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'busy', message: 'Too many questions right now. Try again in a minute.' }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'not_configured', message: 'The API key is invalid.' }, 503);
    if (err instanceof Anthropic.APIError) {
      console.error('Dr Pot error', err.status, err.message);
      return json({ error: 'api', message: 'The assistant is unavailable. Try again.' }, 502);
    }
    throw err;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
