// The shell map is explicit so no user data, API traffic, or downloads enter Cache Storage.
// CACHE_NAME is a content hash written by `npm run stamp`; `npm run verify` rejects a stale one.
const CACHE_NAME = 'diet-tracker-shell-schema-v3-1cf547a72e2f';
const SHELL_PREFIX = 'diet-tracker-shell-';
// Paths are relative to this worker's folder so the app can be hosted at a domain root or a subfolder.
const SHELL_FILES = Object.freeze([
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './sw.js',
  './icons/app-icon.svg',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',
  './src/app.js',
  './src/views.js',
  './src/storage.js',
  './src/constants.js',
  './src/calculations.js',
  './src/analysis.js',
  './src/nutrition-label.js',
  './src/ocr.js',
  './src/sugar.js',
  './src/gi-reference.js',
  './src/glycemic.js',
  './src/meals.js',
  './src/cardiometabolic.js',
  './src/trends.js',
  './src/pwa.js',
  './src/activity.js',
  './src/cloud.js',
  './src/services/usda-local.js',
  './data/usda-foods.json',
  './src/services/anthropic.js',
  './src/services/food-data-central.js'
]);
const SHELL_URLS = Object.freeze(SHELL_FILES.map(path => new URL(path, self.location.href).href));
const SHELL_SET = new Set(SHELL_URLS);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith(SHELL_PREFIX) && name !== CACHE_NAME)
    .map(name => caches.delete(name)))).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// The label reader's engine (vendor/tesseract/) is large and versioned by folder, so it is cached on first
// use instead of at install, and kept across app updates.
const OCR_CACHE = 'diet-tracker-ocr-tesseract-5.1.1';
const OCR_PREFIX = new URL('./vendor/tesseract/', self.location.href).href;

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.search && url.href.startsWith(OCR_PREFIX)) {
    event.respondWith(caches.open(OCR_CACHE).then(async cache => {
      const hit = await cache.match(url.href);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(url.href, response.clone());
      return response;
    }));
    return;
  }
  if (url.search || !SHELL_SET.has(url.href)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache =>
    (await cache.match(url.href)) ?? fetch(request)));
});
