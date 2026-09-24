// Tiny static server for local preview: node serve.mjs [port]
// Also serves POST /api/identify. Without ANTHROPIC_API_KEY, run POT_MOCK=1 node serve.mjs for a canned result.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2] || 6420);
const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.css': 'text/css' };
const shell = body => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${body}</body></html>`;

http.createServer(async (req, res) => {
  if (req.method === 'POST' && ['/api/identify', '/api/chat', '/api/push'].includes(req.url)) {
    const { POST } = await import('.' + req.url + '.js');
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await POST(new Request('http://localhost' + req.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks) }));
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
    if (!r.body) return res.end(await r.text());
    for await (const chunk of r.body) res.write(Buffer.from(chunk)); // streamed answers arrive piece by piece
    return res.end();
  }
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path.endsWith('/') ? 'index.html' : path);
  try {
    let data = await readFile(file);
    if (file.endsWith('index.html')) data = shell(data.toString());
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Pot prototype on http://localhost:${port}`));
