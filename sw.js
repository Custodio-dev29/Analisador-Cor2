/**
 * Service Worker do Analisador de Cores.
 *
 * Correcoes em relacao a versao anterior:
 *
 *  1. install usava cache.addAll(), que e atomico: UMA falha (o CDN do
 *     SheetJS, por exemplo) invalidava o install inteiro e o app ficava sem
 *     qualquer suporte offline. Agora o shell e os recursos opcionais sao
 *     cacheados separadamente, com falhas opcionais nao fatais.
 *  2. o handler de fetch interceptava TUDO, inclusive requisicoes nao-GET,
 *     que lancam ao serem cacheadas.
 *  3. faltavam skipWaiting/clients.claim: atualizacoes ficavam presas ate
 *     todas as abas do usuario serem fechadas.
 *  4. nao havia checagem de response.ok nem de response.type, entao
 *     respostas de erro e respostas opacas entravam no cache.
 */

const VERSION = 'v8';
const CACHE_NAME = `analisador-cores-${VERSION}`;

/** Shell do aplicativo: obrigatorio para o app funcionar offline. */
const SHELL = [
  './',
  './index.html',
  './login.html',
  './history.html',
  './profile.html',
  './styles.css',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/icon-maskable-192x192.png',
  './icons/icon-maskable-512x512.png',
  './js/app.js',
  './js/auth.js',
  './js/color.js',
  './js/export.js',
  './js/guard.js',
  './js/history.js',
  './js/login.js',
  './js/logger.js',
  './js/profile.js',
  './js/sampler.js',
  './js/storage.js',
  './js/toast.js',
];

/** Recursos de terceiros. A falta deles nao pode derrubar o install. */
const OPTIONAL = [
  'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
];

const CDN_ORIGIN = 'https://unpkg.com';

/**
 * Cacheia uma lista sem propagar falha individual.
 * @returns {Promise<{cached:number, failed:number}>}
 */
async function cacheAll(cacheName, urls) {
  const cache = await caches.open(cacheName);
  let cached = 0;
  let failed = 0;

  await Promise.all(urls.map(async (url) => {
    try {
      // cache: 'reload' ignora o cache HTTP para pegar a versao mais nova.
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      await cache.put(url, response);
      cached += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[sw] não foi possível cachear "${url}":`, error.message);
    }
  }));

  return { cached, failed };
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await cacheAll(CACHE_NAME, SHELL);
    console.info(`[sw] shell: ${shell.cached} cacheado(s), ${shell.failed} falha(s)`);

    // Recursos opcionais: a falha aqui apenas significa que a.exportação
    // para XLSX exigira rede na primeira vez. CSV continua funcionando.
    await cacheAll(CACHE_NAME, OPTIONAL);

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('analisador-cores-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );

    await self.clients.claim();
    console.info(`[sw] ativo: ${CACHE_NAME}`);
  })());
});

/** A pagina pede para assumir a versao nova imediatamente. */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function isCacheable(response) {
  if (!response) return false;
  // 'opaque' = resposta cross-origin sem CORS: nao da para inspecionar.
  if (response.type === 'opaque') return false;
  return response.status === 200;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // POST/PUT/etc. nunca sao cacheaveis; tentei-los lancaria aqui.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const isSameOrigin = url.origin === self.location.origin;
  const isKnownCdn = url.origin === CDN_ORIGIN;
  if (!isSameOrigin && !isKnownCdn) return;

  // CDN: o script e' versionado e imutavel, entao cache-first e seguro.
  if (isKnownCdn) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navegacao: rede primeiro, para pegar atualizacoes; cache como reserva.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Demais recursos do mesmo origin: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (error) {
    return new Response('Recurso indisponível offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request)
      ?? await cache.match('./index.html')
      ?? await cache.match('./');
    if (cached) return cached;

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>'
      + '<p>Sem conexão e sem cópia em cache desta página.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const revalidate = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch((error) => {
      console.warn(`[sw] falha ao revalidar "${request.url}":`, error.message);
      return undefined;
    });

  if (cached) {
    revalidate.catch(() => {});
    return cached;
  }

  const response = await revalidate;
  if (response) return response;

  return new Response('', { status: 504, statusText: 'Gateway Timeout' });
}