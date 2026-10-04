/**
 * Amostragem de cor em resolucao real.
 *
 * O canvas visivel e reduzido para caber na tela, mas a medicao nunca usa
 * esse canvas: ela le de um buffer offscreen que guarda a imagem no maior
 * tamanho que o dispositivo permite. Sem isso, o pixel medido seria um pixel
 * reamostrado com smoothing pelo navegador.
 */

import { makeColor } from './color.js';
import { logger } from './logger.js';

/** Teto de pixels do buffer (16 MP ≈ 64 MB em RGBA). */
export const MAX_BUFFER_PIXELS = 16 * 1024 * 1024;

/** Teto do maior lado do buffer, para nao estourar limites de textura em GPUs. */
export const MAX_BUFFER_DIMENSION = 6000;

const LOAD_TIMEOUT_MS = 30000;

/**
 * Media ponderada por alpha sobre um retangulo de ImageData.
 *
 * Pixels totalmente transparentes sao ignorados em vez de entrarem como
 * (0,0,0) — sem isso, areas transparentes puxariam a media para o preto.
 * Retorna null quando a regiao e 100% transparente (nao ha cor a medir).
 *
 * @param {{data: Uint8ClampedArray|number[]}} imageData
 * @returns {{r:number,g:number,b:number}|null}
 */
export function averageRegion(imageData) {
  const data = imageData.data;
  let r = 0;
  let g = 0;
  let b = 0;
  let weightSum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;

    const weight = alpha / 255;
    r += data[i] * weight;
    g += data[i + 1] * weight;
    b += data[i + 2] * weight;
    weightSum += weight;
  }

  if (weightSum === 0) return null;

  return {
    r: Math.round(r / weightSum),
    g: Math.round(g / weightSum),
    b: Math.round(b / weightSum),
  };
}

/**
 * Calcula o tamanho do buffer respeitando o orcamento de pixels.
 * @returns {{width:number,height:number,reduced:boolean}}
 */
export function fitWithinBudget(naturalWidth, naturalHeight, maxPixels = MAX_BUFFER_PIXELS, maxDimension = MAX_BUFFER_DIMENSION) {
  const total = naturalWidth * naturalHeight;
  let scale = 1;

  if (total > maxPixels) scale = Math.sqrt(maxPixels / total);

  const longest = Math.max(naturalWidth, naturalHeight) * scale;
  if (longest > maxDimension) scale *= maxDimension / longest;

  let width = Math.max(1, Math.round(naturalWidth * scale));
  let height = Math.max(1, Math.round(naturalHeight * scale));

  // O arredondamento pode estourar o orcamento em poucos pixels: corrige com
  // floor (garantindo <=) em vez de continuar arredondando.
  if (width * height > maxPixels) {
    const fix = Math.sqrt(maxPixels / (width * height));
    width = Math.max(1, Math.floor(width * fix));
    height = Math.max(1, Math.floor(height * fix));
  }

  const oversize = Math.max(width, height);
  if (oversize > maxDimension) {
    const fix = maxDimension / oversize;
    width = Math.max(1, Math.floor(width * fix));
    height = Math.max(1, Math.floor(height * fix));
  }

  return { width, height, reduced: scale < 0.999 };
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Formato de imagem não suportado ou arquivo corrompido.'));
    img.src = src;
  });
}

/**
 * Decodifica um File. Usa createImageBitmap (que ja aplica a orientacao EXIF)
 * e cai para <img> quando nao disponivel.
 */
async function decodeFile(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }

  const url = URL.createObjectURL(file);
  try {
    return await loadImageElement(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Cria um amostrador. Guarde a instancia e chame load()/sample().
 */
export function createSampler() {
  const buffer = document.createElement('canvas');
  const bufferCtx = buffer.getContext('2d', { willReadFrequently: true });

  let info = null;

  return {
    /** Metadados da imagem carregada, ou null. */
    get info() {
      return info;
    },

    /** O canvas offscreen em resolucao real (use-o para desenhar na tela). */
    get canvas() {
      return buffer;
    },

    /**
     * Carrega um File no buffer.
     * @param {File} file
     * @returns {Promise<{width:number,height:number,naturalWidth:number,naturalHeight:number,scale:number,reduced:boolean}>}
     */
    async load(file) {
      if (!file) throw new Error('Nenhum arquivo informado.');
      if (file.type && !file.type.startsWith('image/')) {
        throw new Error('Selecione um arquivo de imagem válido.');
      }

      const decoded = await withTimeout(
        decodeFile(file),
        LOAD_TIMEOUT_MS,
        'Tempo excedido ao carregar a imagem. Tente um arquivo menor.',
      );

      const naturalWidth = decoded.width || decoded.naturalWidth;
      const naturalHeight = decoded.height || decoded.naturalHeight;

      if (!naturalWidth || !naturalHeight) {
        decoded.close?.();
        throw new Error('A imagem foi carregada mas as dimensões são inválidas.');
      }

      const target = fitWithinBudget(naturalWidth, naturalHeight);

      buffer.width = target.width;
      buffer.height = target.height;
      bufferCtx.imageSmoothingEnabled = true;
      bufferCtx.imageSmoothingQuality = 'high';
      bufferCtx.clearRect(0, 0, target.width, target.height);
      bufferCtx.drawImage(decoded, 0, 0, naturalWidth, naturalHeight, 0, 0, target.width, target.height);

      decoded.close?.();

      info = {
        width: target.width,
        height: target.height,
        naturalWidth,
        naturalHeight,
        scale: target.width / naturalWidth,
        reduced: target.reduced,
      };

      logger.info('Imagem carregada', info);
      return info;
    },

    /** Libera o buffer. Chame ao trocar de imagem. */
    clear() {
      info = null;
      buffer.width = 0;
      buffer.height = 0;
    },

    /**
     * Le um retangulo cru do buffer. Coordenadas em espaco de buffer.
     */
    readRegion(x, y, width, height) {
      if (!info) return null;
      const w = Math.max(1, Math.min(Math.round(width), info.width));
      const h = Math.max(1, Math.min(Math.round(height), info.height));
      const sx = Math.max(0, Math.min(info.width - w, Math.round(x)));
      const sy = Math.max(0, Math.min(info.height - h, Math.round(y)));

      return bufferCtx.getImageData(sx, sy, w, h);
    },

    /**
     * Media de cor de uma janela size x size centrada em (x, y).
     *
     * A janela e deslocada para dentro em vez de ser cortada nas bordas, de
     * modo que a contagem de amostras — e portanto o peso de cada pixel —
     * permaneça constante em qualquer posicao.
     *
     * @returns {object|null} registro de cor, ou null se a regiao for
     *   totalmente transparente / nao houver imagem carregada.
     */
    sample(x, y, size) {
      if (!info) return null;

      const window = Math.max(1, Math.min(Math.round(size), info.width, info.height));
      const half = Math.floor(window / 2);

      const sx = Math.max(0, Math.min(info.width - window, Math.round(x) - half));
      const sy = Math.max(0, Math.min(info.height - window, Math.round(y) - half));

      const imageData = bufferCtx.getImageData(sx, sy, window, window);
      const average = averageRegion(imageData);
      if (!average) return null;

      return makeColor(average.r, average.g, average.b);
    },
  };
}