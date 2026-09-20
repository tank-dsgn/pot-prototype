// Builds the installable (PWA) version of the prototype into build/pot-prototype/.
// Usage: node build.mjs. Vercel runs it on every push (see vercel.json).
import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const out = join(root, 'build', 'pot-prototype');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

let page = await readFile(join(root, 'index.html'), 'utf8');
const title = page.match(/<title>(.*?)<\/title>/)[1];
const description = page.match(/<meta name="description" content="(.*?)">/)[1];
page = page.replace(/<title>.*?<\/title>\n?/, '').replace(/<meta name="description".*?>\n?/, '');

await cp(join(root, 'assets'), join(out, 'assets'), { recursive: true });
for (const f of await readdir(join(root, 'pwa'))) await cp(join(root, 'pwa', f), join(out, f));

const manifest = {
  name: 'Pot — Identify & Grow Plants',
  short_name: 'Pot',
  description,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f1efec',
  theme_color: '#f1efec',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
await writeFile(join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

const head = `<!doctype html>
<html lang="en" translate="no" class="notranslate">
<head>
<meta charset="utf-8">
<meta name="google" content="notranslate">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Pot">
<script>
// the phone's status bar follows the app's own theme, before the first paint
(() => {
  let dark = false;
  try { dark = (localStorage.getItem('pot:mode') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'; } catch {}
  document.write('<meta name="theme-color" content="' + (dark ? '#0c0a09' : '#f1efec') + '">'
    + '<meta name="apple-mobile-web-app-status-bar-style" content="' + (dark ? 'black' : 'default') + '">');
})();
</script>
<style>*{-webkit-tap-highlight-color:transparent}img{max-width:100%}</style>
</head>
<body>
`;
const tail = `
<script>
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
</script>
</body>
</html>
`;
await writeFile(join(out, 'index.html'), head + page + tail);

// Service worker: precache every file so the installed app works offline.
async function list(dir, base = '') {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = base + '/' + e.name;
    if (e.isDirectory()) files.push(...await list(join(dir, e.name), rel));
    else if (e.name !== 'sw.js') files.push(rel);
  }
  return files;
}
const files = (await list(out)).map(f => f === '/index.html' ? '/' : f);
const hash = createHash('sha1');
for (const f of files) hash.update(await readFile(join(out, f === '/' ? 'index.html' : f)));
const version = hash.digest('hex').slice(0, 10);

await writeFile(join(out, 'sw.js'), `const CACHE = 'pot-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Pages: network first, so a new deploy shows up on the next launch; fall back to cache offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/', copy)); return r; }).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
`);

console.log(`Built ${files.length} files → ${out} (cache ${version})`);
