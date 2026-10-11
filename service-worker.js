/* 服务工作线程 —— 只做「离线兜底」，绝不长期缓存页面/脚本/样式。
 *
 * 历史教训（2026-10-10）：
 *   旧版本在这里写死了一份 1.0.53 的预缓存清单，从此再没更新过。
 *   那份清单既是死的（URL 带旧版本号），又让 SW 在 install 时缓存一批
 *   来历不明的副本；更糟的是它不在热更新清单里，永远不可能被换掉。
 *   一旦它把某个旧副本 serve 出去，用户看到的就是「一部分界面变回旧样子」。
 *
 * 现在的策略：
 *   · 页面 / 脚本 / 样式 / 清单：一律 network-first，成功后才更新缓存。
 *     在线的时候拿到的永远是最新内容，不存在「被旧缓存盖住」。
 *   · 图片 / 字体 / 媒体：cache-first（它们本来就不会变，省流量）。
 *   · 断网时才退缓存；缓存也没有就返回 index.html 让 App 自己起来。
 *   · 不写任何静态预缓存清单 —— 那份清单必然过期，过期就是隐患。
 */
const CACHE = 'mine-warmjournal-runtime';

self.addEventListener('install', () => {
  // 不预缓存任何东西：等真正用到什么再缓存什么。
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => key === CACHE ? null : caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const NETWORK_FIRST = new Set(['document', 'script', 'style', 'manifest']);

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const destination = request.destination || '';
  if (NETWORK_FIRST.has(destination) || request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.mode === 'navigate') {
            const shell = await caches.match('./index.html');
            if (shell) return shell;
          }
          return new Response('', { status: 504, statusText: 'offline' });
        })
    );
    return;
  }

  // 图片 / 字体 / 媒体：cache-first，miss 再走网络并补缓存
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => new Response('', { status: 504, statusText: 'offline' }));
    })
  );
});
