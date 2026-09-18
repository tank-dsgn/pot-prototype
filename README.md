# Pot — clickable iOS prototype

Pot identifies plants from a photo and keeps a care guide for each one. This repository is a clickable HTML prototype of the iOS app, built from the Figma design, with light and dark themes.

**Live:** https://pot-prototype.vercel.app — open it in Safari on an iPhone and choose Share → Add to Home Screen to install it as an app. It works offline after the first launch.

## Plant recognition

The camera button takes a real photo on a phone (a demo photo on desktop), and `api/identify.js` sends it to Claude (`claude-opus-5`), which names the plant and fills its care card. It needs an `ANTHROPIC_API_KEY` environment variable in the Vercel project. Without the key the app shows a demo result instead.

## Run locally

```bash
npm install
node serve.mjs                     # http://localhost:6420, needs ANTHROPIC_API_KEY for recognition
POT_MOCK=1 node serve.mjs          # canned recognition result, no key needed
```

On macOS you can double-click `Pot Prototype.command` instead.

## Build

```bash
node build.mjs          # installable PWA → build/pot-prototype
```

Vercel runs the same build on every push to `main`.

## Structure

- `index.html` — all screens, styles and interactions
- `assets/` — images and icons exported from Figma
- `pwa/` — app icons
- `api/identify.js` — Vercel function that identifies the plant in a photo
- `build.mjs` — adds the web app manifest and a service worker for offline use
