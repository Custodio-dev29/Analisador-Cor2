/**
 * Gera o diretorio `dist/` para publicar num host estatico.
 *
 * Publicar a pasta do projeto inteira arrasta node_modules, tests e scripts
 * junto, o que engorda o upload e expoe codigo de teste na internet. Aqui so
 * vai o que o navegador precisa.
 *
 *   npm run build   ->   dist/  (depois: envie dist/, nao o projeto)
 */

import { mkdir, rm, cp, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** Arquivos e pastas que o app precisa em producao. */
const ASSETS = [
  'index.html',
  'login.html',
  'history.html',
  'profile.html',
  'styles.css',
  'manifest.json',
  'sw.js',
  'icons',
  'js',
];

/**
 * Headers de seguranca para Netlify e Cloudflare Pages (ambos leem `_headers`).
 *
 * O Service Worker nao pode ser servido com `no-store`: ele e' a base do
 * funcionamento offline, e um `no-cache` faria o navegador revalidar tudo sem
 * parar.
 */
const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(), microphone=(), interest-cohort=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'

/sw.js
  Cache-Control: no-cache

/*.html
  Cache-Control: no-cache
`;

/**
 * Github Pages usa Jekyll e ignora diretorios underscored. Nao ha nada para
 * ignorar aqui, mas o symlink `.nojekyll` evita que a pasta seja processada.
 */
const NOJEKYLL = '';

/** O GitHub Pages nao le `_headers`; os headers ficam no workflow de deploy. */
async function writeGitHubPagesWorkflow() {
  const workflow = `name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
`;

  await writeFile(join(root, '.github', 'workflows', 'deploy.yml'), workflow, 'utf8');
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const asset of ASSETS) {
  await cp(join(root, asset), join(dist, asset), { recursive: true });
}

await writeFile(join(dist, '_headers'), HEADERS, 'utf8');
await writeFile(join(dist, '.nojekyll'), NOJEKYLL, 'utf8');

// Contexto seguro para os scripts: o GitHub Pages sobe em HTTPS, o cache do
// service worker e' atualizado a cada publicacao pelo VERSION em sw.js.
await mkdir(join(root, '.github', 'workflows'), { recursive: true });
await writeGitHubPagesWorkflow();

/* Relatorio: o que foi publicado e o que, comJustificativa, ficou de fora. */
const SKIPPED = ['package.json', 'package-lock.json', 'node_modules', 'tests', 'scripts', 'eslint.config.js', 'vitest.config.js', 'README.md'];

let files = 0;
let bytes = 0;
async function walk(dir) {
  for (const entry of await import('node:fs/promises').then((fs) => fs.readdir(dir, { withFileTypes: true }))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else { files += 1; bytes += (await stat(full)).size; }
  }
}
await walk(dist);

console.log(`dist/ pronto: ${files} arquivos, ${(bytes / 1024).toFixed(1)} KB`);
console.log(`Ignorado de proposito: ${SKIPPED.join(', ')}`);

// O build nao pode gerar algo quebrado: confere que o shell existe.
for (const required of ['index.html', 'login.html', 'styles.css', 'sw.js', 'manifest.json']) {
  try {
    await readFile(join(dist, required));
  } catch {
    console.error(`Falha no build: dist/${required} nao foi gerado.`);
    process.exit(1);
  }
}
