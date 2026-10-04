/**
 * Verificacao de integridade das referencias estaticas.
 *
 * Nao substitui um teste de navegador, mas pega o tipo de erro que so aparece
 * em runtime: modulo importado que nao existe, script referenciado no HTML que
 * sumiu no merge, arquivo do Service Worker fora do manifesto de cache.
 *
 *   node scripts/verify-refs.js
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const checked = new Set();

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

async function checkReference(fromFile, specifier, kind) {
  if (/^(https?:|data:|blob:|mailto:|#)/.test(specifier)) return;

  const target = resolve(dirname(fromFile), specifier.split(/[?#]/)[0]);
  const label = `${relative(root, fromFile)} -> ${specifier}`;

  if (checked.has(target)) return;
  checked.add(target);

  if (!await exists(target)) problems.push(`[${kind}] arquivo inexistente: ${label}`);
}

/** Extrai imports/esports de um modulo ES. */
async function checkModule(file) {
  const source = await readFile(file, 'utf8');

  const patterns = [
    /(?:^|\n)\s*import\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    for (const [, specifier] of source.matchAll(pattern)) {
      await checkReference(file, specifier, 'module');
    }
  }
}

/** Extrai src/href do HTML. */
async function checkHtml(file) {
  const source = await readFile(file, 'utf8');

  for (const [, attribute, value] of source.matchAll(/\b(src|href)\s*=\s*["']([^"']+)["']/g)) {
    await checkReference(file, value, `html:${attribute}`);
  }

  // Estilos e scripts inline violam a CSP declarada nos HTMLs.
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(source)) {
    problems.push(`[csp] script inline em ${relative(root, file)}`);
  }

  if (/\sstyle\s*=\s*["'][^"']+["']/i.test(source)) {
    problems.push(`[csp] atributo style inline em ${relative(root, file)}`);
  }
}

const htmlFiles = (await readdir(root)).filter((name) => name.endsWith('.html'));
const jsFiles = (await readdir(join(root, 'js'))).filter((name) => name.endsWith('.js'));

for (const name of htmlFiles) await checkHtml(join(root, name));
for (const name of jsFiles) await checkModule(join(root, 'js', name));

/* Todo arquivo do shell precisa estar no manifesto do Service Worker. */
const sw = await readFile(join(root, 'sw.js'), 'utf8');
const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] ?? '';

for (const name of ['index.html', 'login.html', 'history.html', 'profile.html', 'styles.css', 'manifest.json']) {
  if (!shell.includes(`./${name}`)) {
    problems.push(`[sw] "${name}" nao esta no SHELL do Service Worker`);
  }
}

for (const name of jsFiles) {
  if (!shell.includes(`./js/${name}`)) {
    problems.push(`[sw] "js/${name}" nao esta no SHELL do Service Worker`);
  }
}

/* O manifesto precisa apontar para icones que existem, nos tamanhos certos. */
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const declaredIcons = new Set();

for (const icon of manifest.icons ?? []) {
  await checkReference(join(root, 'manifest.json'), icon.src, 'manifest:icon');
  declaredIcons.add(`${icon.src}|${icon.sizes}`);

  if (!shell.includes(`./${icon.src}`)) {
    problems.push(`[sw] icone "${icon.src}" do manifesto nao esta no SHELL`);
  }

  // O arquivo precisa realmente ter o tamanho que o manifesto declara.
  const iconPath = join(root, icon.src);
  try {
    const buffer = await readFile(iconPath);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const [declaredWidth, declaredHeight] = icon.sizes.split('x').map(Number);

    if (width !== declaredWidth || height !== declaredHeight) {
      problems.push(`[manifest] "${icon.src}" e' ${width}x${height}, mas declara ${icon.sizes}`);
    }
  } catch {
    // checkReference ja reportou o arquivo ausente.
  }
}

if (![...declaredIcons].some((entry) => entry.endsWith('|512x512'))) {
  problems.push('[manifest] nenhum icone de 512x512 (exigido para instalacao)');
}

if (!manifest.icons?.some((icon) => icon.purpose === 'maskable')) {
  problems.push('[manifest] nenhum icone com purpose "maskable"');
}

/* O id do usuario nao pode vazar para lugar nenhum. */
const authSource = await readFile(join(root, 'js', 'auth.js'), 'utf8');
for (const name of [...htmlFiles, ...jsFiles.map((n) => `js/${n}`)]) {
  const source = name.endsWith('.js')
    ? await readFile(join(root, name), 'utf8')
    : await readFile(join(root, name), 'utf8');

  if (name !== 'js/auth.js' && /['"]master['"]/.test(source)) {
    problems.push(`[auth] usuario "master" hardcoded em ${name}`);
  }
}

/** Remove comentarios e literais, para checar apenas codigo executavel. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

/* Nenhum alerta bloqueante deve ter sobrado. */
for (const name of jsFiles) {
  const code = codeOnly(await readFile(join(root, 'js', name), 'utf8'));

  if (/\balert\s*\(/.test(code)) problems.push(`[ux] alert() em js/${name}`);
  if (/\bwindow\.(prompt|confirm)\s*\(/.test(code)) problems.push(`[ux] prompt()/confirm() em js/${name}`);
}

/* A URL do SheetJS tem que ser a mesma no app e no Service Worker, e precisa
 * estar fixada em uma versao. Sem o pin, um release novo quebra o hash de
 * integridade e a exportacao XLSX falha em silencio. */
const exportSource = await readFile(join(root, 'js', 'export.js'), 'utf8');
const sheetUrl = exportSource.match(/SHEETJS_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
const sheetSri = exportSource.match(/SHEETJS_SRI\s*=\s*['"]([^'"]+)['"]/)?.[1];

if (!sheetUrl) problems.push('[cdn] SHEETJS_URL nao encontrada em js/export.js');
if (!sheetSri?.startsWith('sha512-')) problems.push('[cdn] SHEETJS_SRI ausente ou em formato invalido');

if (sheetUrl && !/xlsx@\d+\.\d+\.\d+/.test(sheetUrl)) {
  problems.push(`[cdn] URL do SheetJS sem versao fixada (qualquer release quebra o SRI): ${sheetUrl}`);
}

if (sheetUrl && !sw.includes(sheetUrl)) {
  problems.push('[cdn] URL do SheetJS diverge entre js/export.js e sw.js');
}

const csp = await Promise.all(
  htmlFiles.map((name) => readFile(join(root, name), 'utf8')),
);

for (const [index, source] of csp.entries()) {
  if (sheetUrl && !source.includes(new URL(sheetUrl).origin)) {
    problems.push(`[csp] ${htmlFiles[index]} nao libera ${new URL(sheetUrl).origin} em script-src`);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problema(s) de integridade:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`Integridade OK: ${htmlFiles.length} HTML, ${jsFiles.length} modulos, ${checked.size} referencias.`);