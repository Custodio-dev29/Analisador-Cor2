/**
 * Exportacao do historico.
 *
 * CSV e o caminho principal: gerado nativamente, sem dependencia, funciona
 * sempre. O XLSX e opcional e carregado sob demanda a partir de CDN, com
 * integridade verificada; se falhar, o app cai de volta para CSV.
 */

import { toast, reportError } from './toast.js';
import { logger } from './logger.js';

// Versao fixada: um URL sem versao continua servindo a ultima versao publicada,
// e qualquer release novo quebraria o hash de integridade sem aviso. Pinar a
// versao torna o conteudo imutavel e o SRI estavel.
const SHEETJS_URL = 'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js';
const SHEETJS_SRI = 'sha512-af6da00a10e71af072964f74fb67bfc9caf7455ac38bc0c83a420636126529fbb240ce2d211008d3ad8c695f2c7e340a6151a338169904e03cef3f8885913d0c';

const COLUMNS = Object.freeze([
  ['Data/Hora', (item) => new Date(item.createdAt).toLocaleString('pt-BR')],
  ['Nome da Amostra', (item) => item.name || 'Sem nome'],
  ['Posição X', (item) => item.position?.x ?? ''],
  ['Posição Y', (item) => item.position?.y ?? ''],
  ['Amostragem', (item) => (item.sampleSize ? `${item.sampleSize}x${item.sampleSize}` : '')],
  ['Ref HEX', (item) => item.refColor?.hex?.toUpperCase() ?? ''],
  ['Ref RGB', (item) => `(${item.refColor?.r},${item.refColor?.g},${item.refColor?.b})`],
  ['Ref L*', (item) => item.refColor?.lab?.l?.toFixed(2) ?? ''],
  ['Ref a*', (item) => item.refColor?.lab?.a?.toFixed(2) ?? ''],
  ['Ref b*', (item) => item.refColor?.lab?.b?.toFixed(2) ?? ''],
  ['Sel HEX', (item) => item.selColor?.hex?.toUpperCase() ?? ''],
  ['Sel RGB', (item) => `(${item.selColor?.r},${item.selColor?.g},${item.selColor?.b})`],
  ['Sel L*', (item) => item.selColor?.lab?.l?.toFixed(2) ?? ''],
  ['Sel a*', (item) => item.selColor?.lab?.a?.toFixed(2) ?? ''],
  ['Sel b*', (item) => item.selColor?.lab?.b?.toFixed(2) ?? ''],
  ['Delta E 2000', (item) => item.deltaE?.toFixed(3) ?? ''],
  ['Interpretação', (item) => item.interpretation?.text ?? ''],
]);

/** Achata o historico em uma lista de objetos com chaves de coluna fixas. */
export function historyToRows(history) {
  return history.map((item) => Object.fromEntries(COLUMNS.map(([key, get]) => [key, get(item)])));
}

/**
 * Valores que o Excel interpretaria como formula ao abrir o arquivo.
 * Um nome de amostra como "=1+1" viraria conta; "=HYPERLINK(...)" viraria link.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const escapeCsvValue = (value) => {
  let text = String(value ?? '');

  // Neutraliza formula apenas em texto livre: campos numericos legitimately
  // negativos (como a* = -12.34) nao podem ser prefixados.
  const isNumeric = value !== null && value !== '' && !Number.isNaN(Number(value));
  if (!isNumeric && FORMULA_PREFIX.test(text)) text = `'${text}`;

  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Gera CSV compativel com o Excel pt-BR: separador ";", BOM UTF-8 e
 * quebras CRLF.
 */
export function toCsv(rows) {
  if (!rows.length) return '';

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsvValue).join(';'),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(';')),
  ];

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function timestampSlug() {
  return new Date().toISOString().slice(0, 10);
}

function download(filename, mime, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exporta para CSV. Nao depende de nada. */
export function exportCsv(history) {
  if (!history.length) {
    toast.warn('Não há histórico para exportar.');
    return false;
  }

  try {
    download(`historico_cores_${timestampSlug()}.csv`, 'text/csv;charset=utf-8', toCsv(historyToRows(history)));
    toast.success(`Histórico exportado (${history.length} registros).`);
    return true;
  } catch (error) {
    reportError('Falha ao exportar CSV', error);
    return false;
  }
}

let sheetJsPromise = null;

/** Carrega o SheetJS sob demanda, verificando a integridade do script. */
function loadSheetJs() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  if (sheetJsPromise) return sheetJsPromise;

  sheetJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SHEETJS_URL;
    script.integrity = SHEETJS_SRI;
    script.crossOrigin = 'anonymous';
    script.async = true;

    script.addEventListener('load', () => {
      if (globalThis.XLSX) resolve(globalThis.XLSX);
      else reject(new Error('A biblioteca de Excel carregou sem expor a API esperada.'));
    });
    script.addEventListener('error', () => {
      reject(new Error('Não foi possível carregar a biblioteca de Excel (sem rede ou bloqueio de CDN).'));
    });

    document.head.appendChild(script);
  }).catch((error) => {
    sheetJsPromise = null;
    throw error;
  });

  return sheetJsPromise;
}

/** Exporta para .xlsx. Cai para CSV se a biblioteca nao estiver disponivel. */
export async function exportXlsx(history) {
  if (!history.length) {
    toast.warn('Não há histórico para exportar.');
    return false;
  }

  let XLSX;
  try {
    XLSX = await loadSheetJs();
  } catch (error) {
    logger.warn('SheetJS indisponível, exportando CSV.', error);
    toast.warn('Biblioteca de Excel indisponível. Exportando CSV no lugar.');
    return exportCsv(history);
  }

  try {
    const worksheet = XLSX.utils.json_to_sheet(historyToRows(history));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Histórico');
    XLSX.writeFile(workbook, `historico_cores_${timestampSlug()}.xlsx`);
    toast.success(`Histórico exportado para Excel (${history.length} registros).`);
    return true;
  } catch (error) {
    reportError('Falha ao exportar Excel', error);
    return false;
  }
}