// POST /api/feedback — a note from inside the prototype, with the context needed to act on it.
// Nothing is stored: it goes to the Vercel runtime log, which is where we read it from.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const text = String(body.text ?? '').trim();
  if (!text || text.length > 2000) return json({ error: 'bad_request', message: 'Write a short note.' }, 400);

  const one = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').slice(0, max);
  console.log('POT FEEDBACK', JSON.stringify({
    text: text.slice(0, 2000),
    screen: one(body.screen, 40),
    theme: one(body.theme, 10),
    build: one(body.build, 40),
    standalone: !!body.standalone,
    viewport: one(body.viewport, 20),
    ua: one(request.headers.get('user-agent'), 200),
    at: new Date().toISOString(),
  }));
  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
