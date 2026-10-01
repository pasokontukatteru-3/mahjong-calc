// index.html（Artifact 用の本体）から、オフラインで動く PWA 一式を docs/ に書き出す。
// 使い方: node build.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const out = path.join(__dirname, 'docs');
fs.mkdirSync(out, { recursive: true });

// ---- アイコン（緑のラシャに一筒の牌） ----
function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function colorAt(x, y) { // x, y は 0..1
  const felt = [28, 95, 67], ivory = [247, 244, 230], edge = [214, 208, 184], red = [179, 38, 30], green = [31, 107, 74];
  const hw = 0.23, hh = 0.31, r = 0.05;
  const dx = Math.max(Math.abs(x - 0.5) - (hw - r), 0), dy = Math.max(Math.abs(y - 0.5) - (hh - r), 0);
  if (Math.hypot(dx, dy) > r) {
    const sx = Math.max(Math.abs(x - 0.5) - (hw - r), 0), sy = Math.max(Math.abs(y - 0.53) - (hh - r), 0);
    return Math.hypot(sx, sy) <= r ? edge : felt; // 牌の厚み
  }
  const d = Math.hypot(x - 0.5, y - 0.5);
  if (d < 0.055) return red;
  if (d < 0.085) return ivory;
  if (d < 0.15) return green;
  return ivory;
}
function png(size) {
  const ss = 3, raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) {
        const c = colorAt((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = acc[0] / (ss * ss); raw[o + 1] = acc[1] / (ss * ss); raw[o + 2] = acc[2] / (ss * ss);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}
[180, 192, 512].forEach(function (s) { fs.writeFileSync(path.join(out, 'icon-' + s + '.png'), png(s)); });

// ---- index.html ----
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const cut = src.indexOf('<div class="app">');
const head = src.slice(0, cut).replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '');
const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1c5f43">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="麻雀計算帳">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-180.png">
<style>:root { padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); }</style>
${head.trim()}
</head>
<body>
${src.slice(cut).trim()}
<script>
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);

fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  name: '麻雀計算帳', short_name: '麻雀計算帳', lang: 'ja', start_url: './', scope: './', display: 'standalone',
  background_color: '#e9eee8', theme_color: '#1c5f43',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]
}, null, 2));

// ---- service worker：オンラインなら最新を取り、だめならキャッシュで開く ----
const ver = crypto.createHash('sha1').update(html).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(out, 'sw.js'), `const CACHE = 'mahjong-calc-${ver}';
const SHELL = ['./', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
function store(req, res) {
  if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
  return res;
}
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) { // フォントは一度取ったらキャッシュ優先
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { return store(req, res); });
    }));
    return;
  }
  e.respondWith(new Promise(function (resolve, reject) {
    const fallback = function () {
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('./') : undefined);
      }).then(function (hit) { hit ? resolve(hit) : reject(new Error('offline')); });
    };
    const timer = setTimeout(fallback, 3000);
    fetch(req).then(function (res) { clearTimeout(timer); resolve(store(req, res)); }, function () { clearTimeout(timer); fallback(); });
  }));
});
`);
console.log('built docs/ (' + ver + ')');
