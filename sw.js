// 画面の部品をスマホに控え、電波が弱い山の中でもすぐ開けるようにする(控えを先に使う)。
// 新しい版を出す時は、VERSION を書き換える。→ スマホ側が変化に気づき、「更新する」を出す。
// 地図の絵(タイル)は、見たことのある範囲だけ控える(まとめて先読みはしない: OpenStreetMapの利用ルールのため)。
// 写真や記録のデータはここでは控えない(見えなくなった記録が残らないように)。

const VERSION = '2026.10.11-2';
const SHELL_CACHE = `shell-${VERSION}`;
const TILE_CACHE = 'tiles-v1';
const MAX_TILES = 400;

const SHELL = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/store.js',
  'js/db.js',
  'js/photo.js',
  'js/location.js',
  'js/permission-help.js',
  'js/backend-mock.js',
  'js/backend-supabase.js',
  'js/config.js',
  'js/record-shape.js',
  'js/michi-layer.js',
  'js/banana-layer.js',
  'data/banana-shops.json',
  'js/station-notes.js',
  'js/station-picker.js',
  'js/station-editor.js',
  'data/michi-no-eki.json',
  'js/sample-data.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js',
];

// 新しい版の部品を控える。すぐには切り替えず、利用者が「更新する」を押すまで待つ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL.map((url) =>
      new Request(url, { cache: 'reload', mode: url.startsWith('http') ? 'cors' : 'same-origin' })
    )))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage(VERSION);
});

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(key);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 地図の絵: 控えがあれば使い、なければ取りに行って控える
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          cache.put(req, res.clone());
          trimTiles();
        }
        return res;
      })
    );
    return;
  }

  // 画面の部品: この版の控えを使う。控えにない物だけ取りに行く
  // 保存先(Supabase)とのやり取り・写真は控えない(ここで素通りさせる)
  const isShell = url.origin === self.location.origin || url.hostname === 'unpkg.com'
    || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@supabase/supabase-js@'));
  if (!isShell) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
    if (hit) return hit;
    return fetch(req);
  })());
});
