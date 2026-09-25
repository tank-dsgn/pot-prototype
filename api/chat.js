// POST /api/chat — Dr Pot, the in-app assistant. Streams plain text back as it is generated.
// Body: { messages: [{ role: 'user' | 'assistant', text }], plant?: { name, latin, care }, image?: "<base64 JPEG>" }
import Anthropic from '@anthropic-ai/sdk';
import { guard } from './_guard.js';

const client = new Anthropic();

const str = { type: 'string' };
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    cause: str,          // 2-4 words
    summary: str,        // one sentence
    steps: { type: 'array', items: str },
    days: { type: 'integer' },
    checkInDays: { type: 'integer' },
  },
  required: ['cause', 'summary', 'steps', 'days', 'checkInDays'],
  additionalProperties: false,
};

const PLAN_SYSTEM = `You are Dr Pot. Turn the conversation into a short treatment plan for this one plant.
- cause: the likely cause as a short label for a tag — 1 or 2 words, at most 16 characters, e.g. "Overwatering", "Low light", "Spider mites", "Cold & wet" (in Russian: "Перелив", "Мало света", "Паутинный клещ", "Холод и сырость").
- summary: one sentence the owner reads first — what is happening and what the plan does about it.
- steps: 3 to 5 actions in the order they should be done, each one sentence in the imperative, each something the owner can do today or this week.
- days: how many days the plan runs. checkInDays: how often the owner should report back, in days.
- If the conversation never pinned down a cause, pick the most likely one from what was said and keep the steps safe and reversible.`;

const SYSTEM = `You are Dr Pot, the plant doctor inside Pot, a plant care app. You help someone work out what is wrong with their plant and what to do about it.

- Write like a calm, practical plant person, not a chatbot. Short paragraphs, no headings, no bullet lists unless you are giving steps.
- Keep each reply under 70 words unless the person asks for detail.
- Diagnose by narrowing down: if the cause is unclear, ask ONE specific question (watering habit, light, soil moisture, undersides of leaves) and stop there.
- When you name a likely cause, say what to do about it in one or two concrete steps, then offer the next thing you could check.
- If a photo comes with the message, describe only what you actually see in it.
- Never invent plant facts you are unsure of; say what you would check instead.
- Answer in the app's language (given below), even if the person writes in another one.`;

export async function POST(request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request', message: 'Send JSON.' }, 400);
  }

  const history = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
  const ru = body.lang === 'ru';
  const langName = ru ? 'Russian' : 'English';
  if (body.plan) return treatmentPlan(history, body.plant || {}, langName);
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
      system: SYSTEM + context + `\n\nThe app is set to ${langName}. Always reply in ${langName}, whatever language earlier messages are in.`,
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

// A plan is a one-off structured answer, not a stream: the app stores it next to the plant.
async function treatmentPlan(history, plant, langName) {
  if (!history.length) return json({ error: 'bad_request', message: 'Nothing to plan.' }, 400);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'not_configured', message: 'The assistant is not connected yet.' }, 503);
  const transcript = history.map((m) => `${m.role === 'assistant' ? 'Dr Pot' : 'Owner'}: ${String(m.text ?? '').slice(0, 1500)}`).join('\n');
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      system: PLAN_SYSTEM + `\n- Write cause, summary and steps in ${langName}, whatever language the conversation is in.`,
      messages: [{ role: 'user', content: `Plant: ${plant.name || 'houseplant'}${plant.latin ? ` (${plant.latin})` : ''}.${plant.care ? ` Care profile: ${String(plant.care).slice(0, 900)}` : ''}\n\nConversation:\n${transcript}` }],
    });
    if (response.stop_reason === 'refusal') return json({ error: 'refused', message: 'No plan for this one.' }, 422);
    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return json({ error: 'empty', message: 'No plan came back.' }, 502);
    return json(JSON.parse(text));
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error('Dr Pot plan error', err.status, err.message);
      return json({ error: 'api', message: 'Couldn’t build the plan. Try again.' }, 502);
    }
    if (err instanceof SyntaxError) return json({ error: 'parse', message: 'The plan was malformed.' }, 502);
    throw err;
  }
}
