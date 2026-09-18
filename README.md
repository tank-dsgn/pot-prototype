# Pot — clickable iOS prototype

Pot identifies plants from a photo and keeps a care guide for each one. This repository is a clickable HTML prototype of the iOS app, built from the Figma design, with light and dark themes.

**Live:** https://pot-prototype.vercel.app — open it in Safari on an iPhone and choose Share → Add to Home Screen to install it as an app. It works offline after the first launch.

## Run locally

```bash
node serve.mjs          # http://localhost:6420
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
- `build.mjs` — adds the web app manifest and a service worker for offline use
