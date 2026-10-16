// @ts-check
// sw.js — PTracker service worker: versioned precache, cache-first, prompted update (CD-7 §4).
'use strict';

const VERSION = '0.9.1+20261016.2356';           // stamped (CC-34); must equal js/version.js
const SHELL_HASH = '3576a753adb22dd8';           // stamped; hash of the shell files (CD-7 §10)
const PRECACHE = [                               // stamped/checked; = shellFiles() (CD-7 §3)
  'css/app.css',
  'icons/apple-touch-icon-180.png',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'index.html',
  'js/app.js',
  'js/categories/nevro/comment.js',
  'js/categories/nevro/constants.js',
  'js/categories/nevro/csv.js',
  'js/categories/nevro/display.js',
  'js/categories/nevro/fields.js',
  'js/categories/nevro/index.js',
  'js/categories/nevro/metrics.js',
  'js/categories/nevro/programs.js',
  'js/categories/registry.js',
  'js/core/columns.js',
  'js/core/dates.js',
  'js/core/engine.js',
  'js/core/errors.js',
  'js/core/events.js',
  'js/core/format.js',
  'js/core/migrations.js',
  'js/core/numbers.js',
  'js/core/record-model.js',
  'js/core/schema.js',
  'js/core/settings-model.js',
  'js/core/types.js',
  'js/core/validation.js',
  'js/infra/clock.js',
  'js/infra/db.js',
  'js/infra/prefs.js',
  'js/infra/storage-persist.js',
  'js/infra/sw-client.js',
  'js/services/record-service.js',
  'js/services/save-queue.js',
  'js/services/settings-service.js',
  'js/ui/dom.js',
  'js/ui/messages.js',
  'js/ui/pages/baseline.js',
  'js/ui/pages/entry.js',
  'js/ui/pages/history.js',
  'js/ui/router.js',
  'js/ui/shell.js',
  'js/ui/toast.js',
  'js/ui/widgets.js',
  'js/version.js',
  'js/vm/baseline-vm.js',
  'js/vm/entry-vm.js',
  'js/vm/history-vm.js',
  'js/vm/shell-vm.js',
  'manifest.webmanifest',
];

const CACHE_PREFIX = 'ptracker-shell-';
const CACHE_NAME = `ptracker-shell-${VERSION}`;  // CC-34
const SCOPE = new URL('./', self.location.href).href;
const INDEX_URL = new URL('index.html', SCOPE).href;
const VERSION_URL = new URL('js/version.js', SCOPE).href;
const PRECACHE_URLS = new Set(PRECACHE.map((p) => new URL(p, SCOPE).href));

// ---------- install (CD-7 §4.3) ----------

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  try {
    await Promise.all(PRECACHE.map(async (path) => {
      const url = new URL(path, SCOPE).href;
      // 'reload' bypasses the browser HTTP cache (GitHub Pages sends max-age=600).
      const res = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
      if (!res.ok) throw new Error(`precache ${path}: HTTP ${res.status}`);
      await cache.put(url, await withoutRedirect(res));
    }));
    // Mixed-deploy guard: the cached version.js must be the version this sw.js was stamped with.
    const v = await cache.match(VERSION_URL);
    if (!v || !(await v.text()).includes(`'${VERSION}'`)) {
      throw new Error(`precache: js/version.js does not contain ${VERSION}`);
    }
  } catch (err) {
    await caches.delete(CACHE_NAME);   // never leave a partial cache behind
    throw err;                         // install fails → worker becomes redundant; retried on next check
  }
}

/** Safari refuses to use a redirected response for a navigation; store a clean copy. */
async function withoutRedirect(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

// ---------- activate (CD-7 §4.4) ----------

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ---------- fetch (CD-7 §4.5) ----------

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                        // browser default
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  if (req.mode === 'navigate') {
    if (isAppNavigation(url)) event.respondWith(serveShell(req));
    return;                                               // e.g. …/README.md goes to the network
  }
  const key = url.origin + url.pathname;                  // ignore ?query and #hash
  if (PRECACHE_URLS.has(key)) event.respondWith(cacheFirst(key, req));
  // anything else: browser default, network
});

/** The scope root or index.html, with any query; the hash never reaches the worker. */
function isAppNavigation(url) {
  const rel = url.pathname.slice(new URL(SCOPE).pathname.length);
  return rel === '' || rel === 'index.html';
}

async function serveShell(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(INDEX_URL);
  if (hit) return hit;
  try { return await fetch(req); }
  catch { return offlineMissing(); }
}

async function cacheFirst(key, req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(key);
  if (hit) return hit;
  // Self-repair: the entry is missing (e.g. storage pressure). Refetch and store it.
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(key, await withoutRedirect(res.clone()));
    return res;
  } catch {
    return Response.error();
  }
}

function offlineMissing() {
  return new Response('PTracker is offline and its files are missing. Connect to the internet and reopen the app.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// ---------- message (CD-7 §4.6, §5) ----------

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (msg.type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ type: 'VERSION', version: VERSION, shellHash: SHELL_HASH });
  }
});
