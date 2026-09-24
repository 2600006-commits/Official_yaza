// 자율학습실 PWA 서비스 워커
// - 앱 화면(index.html 등): "네트워크 우선" → 항상 최신 버전을 받고, 인터넷이 안 되거나 느릴 때만 저장본 사용
// - 외부 라이브러리(Firebase SDK, XLSX, html2canvas): 저장본 우선 + 백그라운드 갱신 → 오프라인에서도 앱이 열림
// - Firebase 데이터 통신(웹소켓/롱폴링)은 절대 가로채지 않음 (실시간 데이터는 그대로 서버와 직접 통신)
const VERSION = 'yaja-v2';
const SHELL_CACHE = VERSION + '-shell';
const LIB_CACHE = VERSION + '-lib';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const LIB_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com'];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 일부 파일이 없어도 설치가 실패하지 않도록 하나씩 저장
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(SHELL_CACHE);
  // GitHub Pages 등은 파일을 브라우저에 10분 정도 캐시하라고 지시하므로, 매번 서버에 최신 여부를 확인(no-cache)한다.
  const fresh = new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' });
  const fetching = fetch(fresh).then(res => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  });
  try {
    return await withTimeout(fetching, NETWORK_TIMEOUT_MS);
  } catch (e) {
    fetching.catch(() => {});   // 늦게 도착해도 저장본은 갱신되도록 그대로 둔다
    const cached = (await cache.match(request)) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (cached) return cached;
    return fetching;             // 저장본이 없으면 끝까지 기다림
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(LIB_CACHE);
  const cached = await cache.match(request);
  const update = fetch(request).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await update) || Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, req.mode === 'navigate' ? './index.html' : null));
    return;
  }
  if (LIB_HOSTS.includes(url.hostname) && req.destination === 'script') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // 그 외(Firebase Realtime Database 등)는 서비스 워커가 관여하지 않는다.
});
