/**
 * Smoke test: serve o app e o percorre como um navegador faria.
 *
 * Cobre dois erros que nenhum teste de unidade pega em aplicacao estatica:
 *
 *  1. o servidor respondendo `.js` como `text/plain`, que o navegador recusa;
 *  2. caminhos absolutos (`/js/app.js`). O GitHub Pages serve em
 *     `user.github.io/repo/`, e um caminho absoluto apontaria para a raiz do
 *     dominio e o app nao abriria. Aqui o app e' montado sob um subpath e cada
 *     referencia e' resolvida como o navegador resolveria.
 *
 *   node scripts/smoke-server.js            # a pasta do projeto
 *   node scripts/smoke-server.js dist       # o artefato de build
 */

import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(projectRoot, process.argv[2] ?? '.');
const label = process.argv[2] ?? 'projeto';

/** Prefixo que imita o GitHub Pages: tudo sob /usuario/repo/. */
const MOUNT = '/analisador-cores';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const problems = [];

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  // Remove o prefixo de montagem, como um servidor de subpath faria.
  if (pathname === MOUNT) {
    response.writeHead(301, { Location: `${MOUNT}/` }).end();
    return;
  }
  if (pathname.startsWith(`${MOUNT}/`)) pathname = pathname.slice(MOUNT.length);
  else { response.writeHead(404).end('fora do mount'); return; }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = join(root, normalize(pathname).replace(/^([/\\])+/, ''));

  // Impede travessia de diretorio.
  if (!target.startsWith(root + sep)) {
    response.writeHead(403).end('proibido');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('nao e arquivo');

    const body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Content-Length': body.length,
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('nao encontrado');
  }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

/** Baixa um recurso montado e valida status e Content-Type. */
async function get(pathname) {
  const response = await fetch(base + pathname, { redirect: 'manual' });
  const type = response.headers.get('content-type') ?? '';
  const expected = MIME[extname(pathname.split('?')[0]) || '.html'];

  if (response.status === 301) return { redirected: response.headers.get('location') };

  if (response.status !== 200) {
    problems.push(`${pathname} -> HTTP ${response.status}`);
    return null;
  }

  if (expected && !type.startsWith(expected.split(';')[0])) {
    problems.push(`${pathname} -> Content-Type "${type}", esperado "${expected}"`);
  }

  if (pathname.endsWith('.js') && !type.includes('javascript')) {
    problems.push(`${pathname} -> modulo nao seria aceito pelo navegador`);
  }

  return response;
}

/**
 * Percorre o grafo de referencias a partir de uma pagina.
 *
 * `docBase` importa: um modulo JS e' carregado por um documento, e os caminhos
 * relativos dentro dele sao resolvidos pelo navegador contra a URL do
 * *documento*, nao contra a URL do modulo. `import './storage.js'` em
 * `/js/app.js` vira `/js/storage.js` porque ambos estao no mesmo diretorio, mas
 * `location.href = 'index.html'` dentro de `/js/guard.js` vira `/index.html`,
 * nao `/js/index.html`.
 */
async function crawl(entry, docBase, seen = new Set()) {
  const url = new URL(entry, `http://x${MOUNT}/`);
  const pathname = url.pathname;
  const base = docBase ?? url;

  if (seen.has(pathname)) return seen;
  seen.add(pathname);

  const response = await get(pathname);
  if (!response || response.redirected) return seen;

  const type = response.headers.get('content-type') ?? '';
  const body = await response.text();
  const isHtml = type.includes('text/html');
  const isCss = type.includes('text/css');
  const isJs = type.includes('javascript');

  const insideMount = (resolved) => resolved.pathname.startsWith(`${MOUNT}/`)
    || resolved.pathname === MOUNT;

  const follow = async (raw, from, kind) => {
    if (/^(https?:|data:|blob:|mailto:|#)/.test(raw)) {
      if (/^https?:/.test(raw) && new URL(raw).origin === 'http://x') {
        problems.push(`${kind} absoluta "${raw}" em ${from}`);
      }
      return;
    }

    const resolved = new URL(raw, from);
    if (!insideMount(resolved)) {
      problems.push(`${kind} "${raw}" em ${from} escapa de ${MOUNT}`);
      return;
    }

    await crawl(resolved.href, base, seen);
  };

  // Referencias de HTML: resolvidas contra a propria pagina.
  if (isHtml) {
    for (const [, , value] of body.matchAll(/\b(src|href)\s*=\s*["']([^"']+)["']/g)) {
      await follow(value, url, 'atributo');
    }
  }

  if (isCss) {
    for (const [, raw] of body.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      await follow(raw, url, 'url()');
    }
    for (const [, raw] of body.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g)) {
      await follow(raw, url, '@import');
    }
  }

  if (isJs) {
    for (const [, raw] of body.matchAll(/(?:^|\n)\s*(?:import|export)\s+[^'"]*from\s*['"]([^'"]+)['"]/g)) {
      // Modulos usam caminho relativo ao modulo, que coincide com o documento
      // porque todos os modulos estao em /js/.
      await follow(raw, url, 'import');
    }

    // O Service Worker tem que estar dentro do mount, senao o scope falha.
    const swMatch = body.match(/serviceWorker\.register\(\s*['"]([^'"]+)['"]/);
    if (swMatch) {
      const resolved = new URL(swMatch[1], base);
      if (!insideMount(resolved)) {
        problems.push(`Service Worker "${resolved.pathname}" fora de ${MOUNT}`);
      } else {
        await crawl(resolved.href, base, seen);
      }
    }
  }

  return seen;
}

// O manifesto declara o start_url: precisa resolver dentro do mount.
const manifestResponse = await get(`${MOUNT}/manifest.json`);
if (manifestResponse) {
  const manifest = JSON.parse(await manifestResponse.text());

  for (const field of ['start_url', 'scope']) {
    if (!manifest[field]) continue;
    const resolved = new URL(manifest[field], `http://x${MOUNT}/`);
    if (!resolved.pathname.startsWith(`${MOUNT}/`)) {
      problems.push(`manifest.${field} "${manifest[field]}" escapa de ${MOUNT}`);
    }
  }

  for (const icon of manifest.icons ?? []) {
    const resolved = new URL(icon.src, `http://x${MOUNT}/`);
    if (!resolved.pathname.startsWith(`${MOUNT}/`)) {
      problems.push(`manifest icon "${icon.src}" escapa de ${MOUNT}`);
      continue;
    }
    await get(resolved.pathname);
  }
}

// Todas as paginas precisam ser alcancaveis a partir do mount.
for (const page of ['login.html', 'index.html', 'history.html', 'profile.html']) {
  const response = await get(`${MOUNT}/${page}`);
  if (!response) continue;
}

// O service worker e a raiz precisam responder.
await get(`${MOUNT}/sw.js`);
await get(`${MOUNT}/`);

const visited = new Set();
for (const page of ['login.html', 'index.html', 'history.html', 'profile.html']) {
  await crawl(`http://x${MOUNT}/${page}`, null, visited);
}

server.close();

if (problems.length) {
  console.error(`\n${problems.length} falha(s) no smoke test de "${label}" (montado em ${MOUNT}):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`Smoke test OK (${label}): ${visited.size} recursos percorridos a partir de ${MOUNT}/, `
  + 'sem caminho absoluto e com MIME correto.');
