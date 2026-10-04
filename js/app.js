/**
 * Pagina principal do analisador.
 *
 * Decisao de arquitetura: existem dois canvas.
 *  - "display"   — o que o usuario ve. Reduzido para caber na tela.
 *  - "buffer"    — offscreen, no maior tamanho que o dispositivo permite.
 *
 * A medicao usa SEMPRE o buffer. E por isso que a precisao nao depende do
 * tamanho da janela: redimensionar so muda o que se ve.
 */

import { createSampler } from './sampler.js';
import { ciede2000, interpretDeltaE, formatRgb, formatLab, labToRgb } from './color.js';
import { storage, MAX_PALETTE } from './storage.js';
import { requireAuth, wireLogout } from './guard.js';
import { toast, reportError } from './toast.js';
import { logger } from './logger.js';

/** Maior lado do canvas visivel. A mira e limitada por isso; a medicao nao. */
const MAX_DISPLAY_DIMENSION = 1100;

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

const el = {};

function cacheElements() {
  const ids = [
    'upload-btn', 'image-input', 'image-canvas', 'image-click-marker',
    'zoom-canvas', 'sample-size', 'sample-size-value', 'analysis-name',
    'set-as-ref-btn', 'add-to-palette-btn', 'save-analysis-btn', 'palette-list',
    'palette-count', 'image-meta', 'color-ruler-ref', 'ref-color-marker',
    'sel-color-marker', 'ref-ruler-label', 'sel-ruler-label',
    'ref-preview', 'sel-preview', 'value-announcer', 'admin-panel-link',
  ];
  for (const id of ids) el[id] = $(id);
}

/** Le uma celula da tabela por data-cell, em vez de por indice posicional. */
function cell(role, column) {
  return document.querySelector(`[data-cell="${role}"][data-column="${column}"]`);
}

const sampler = createSampler();

const state = {
  user: null,
  reference: null,
  selected: null,
  palette: [],
  cursor: { x: 0, y: 0 },
  hasSelection: false,
  zoomContext: 0,
};

let displayCtx = null;
let zoomCtx = null;
let displaySize = { width: 0, height: 0 };

/* ------------------------------- iniciação ------------------------------- */

async function init() {
  cacheElements();

  const user = await requireAuth();
  if (!user) return;

  state.user = user;
  el['admin-panel-link'].hidden = !user.isMaster;

  displayCtx = el['image-canvas'].getContext('2d');
  zoomCtx = el['zoom-canvas'].getContext('2d');

  wireEvents();
  wireLogout();
  registerServiceWorker();

  state.palette = await storage.palettes.get(user.username);
  renderPalette();
  await restoreAnalysisName();

  const hasImage = false;
  setImageStatus(hasImage);
  updateComparison();
  updateButtons();
}

/* -------------------------------- imagem -------------------------------- */

async function handleFileSelected(event) {
  const file = event.target.files?.[0];
  // Permite reescolher o mesmo arquivo consecutively.
  event.target.value = '';
  if (!file) return;

  const loading = el['upload-btn'];
  loading.disabled = true;
  loading.textContent = 'Carregando…';

  try {
    const info = await sampler.load(file);
    state.reference = null;
    state.selected = null;
    state.hasSelection = false;
    state.cursor = { x: Math.floor(info.width / 2), y: Math.floor(info.height / 2) };

    el['image-click-marker'].hidden = true;
    el['zoom-canvas'].getContext('2d').clearRect(0, 0, el['zoom-canvas'].width, el['zoom-canvas'].height);

    renderDisplay();
    setImageStatus(true, info);
    updateComparison();
    updateButtons();

    toast.success(`Imagem carregada (${info.width}×${info.height} px).`);
  } catch (error) {
    logger.error('Falha ao carregar a imagem.', error);
    toast.error(error.message || 'Não foi possível carregar a imagem.');
  } finally {
    loading.disabled = false;
    loading.textContent = 'Carregar Imagem';
  }
}

function setImageStatus(hasImage, info = null) {
  const node = el['image-meta'];
  if (!node) return;

  if (!hasImage || !info) {
    node.textContent = 'Nenhuma imagem carregada.';
    return;
  }

  const parts = [`${info.naturalWidth}×${info.naturalHeight} px`];
  parts.push(info.reduced
    ? `medido em ${info.width}×${info.height} px (limite de memória)`
    : `medido em resolução real`);

  node.textContent = parts.join(' · ');
}

/**
 * Redesenha o canvas visivel a partir do buffer, cabendo no espaco disponivel.
 * Redimensionar a janela nao altera a medicao.
 */
function renderDisplay() {
  const info = sampler.info;
  if (!info || !displayCtx) return;

  const available = availableDisplaySize();
  const scale = Math.min(
    1,
    available.width / info.naturalWidth,
    available.height / info.naturalHeight,
  );

  const width = Math.max(1, Math.round(info.naturalWidth * scale));
  const height = Math.max(1, Math.round(info.naturalHeight * scale));

  if (width === displaySize.width && height === displaySize.height) return;

  displaySize = { width, height };
  el['image-canvas'].width = width;
  el['image-canvas'].height = height;

  displayCtx.imageSmoothingEnabled = true;
  displayCtx.imageSmoothingQuality = 'high';
  displayCtx.drawImage(
    sampler.canvas,
    0, 0, sampler.canvas.width, sampler.canvas.height,
    0, 0, width, height,
  );
}

function availableDisplaySize() {
  const wrapper = el['image-canvas'].parentElement;
  const style = getComputedStyle(wrapper);
  const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);

  return {
    width: Math.max(240, Math.min(MAX_DISPLAY_DIMENSION, wrapper.clientWidth - paddingX - 4)),
    height: Math.max(180, Math.min(MAX_DISPLAY_DIMENSION, window.innerHeight * 0.6)),
  };
}

/* ------------------------------ amostragem ------------------------------ */

/**
 * Converte coordenadas de tela para o espaco do buffer.
 * Usa as dimensoes do BUFFER, e nao as do canvas visivel — e por isso que a
 * operacao continua correta com a imagem reduzida, redimensionada ou rotacionada.
 */
function toBufferCoords(clientX, clientY) {
  const info = sampler.info;
  const rect = el['image-canvas'].getBoundingClientRect();

  return {
    x: clamp(Math.floor(((clientX - rect.left) / rect.width) * info.width), 0, info.width - 1),
    y: clamp(Math.floor(((clientY - rect.top) / rect.height) * info.height), 0, info.height - 1),
  };
}

function sampleAt(clientX, clientY) {
  const info = sampler.info;
  if (!info) return;

  const point = toBufferCoords(clientX, clientY);
  state.cursor = point;
  measure();
}

/** Mede a cor na posicao atual do cursor e atualiza a interface. */
function measure() {
  const info = sampler.info;
  if (!info) return;

  const size = Number(el['sample-size'].value);
  const color = sampler.sample(state.cursor.x, state.cursor.y, size);

  state.hasSelection = Boolean(color);
  state.selected = color;

  positionMarker();
  drawZoom();
  updateComparison();
  updateButtons();
}

function positionMarker() {
  const info = sampler.info;
  const marker = el['image-click-marker'];
  if (!info) {
    marker.hidden = true;
    return;
  }

  // Posicao relativa ao canvas visivel, convertida de volta para px de CSS.
  const rect = el['image-canvas'].getBoundingClientRect();
  const ratioX = state.cursor.x / info.width;
  const ratioY = state.cursor.y / info.height;

  marker.style.left = `${ratioX * rect.width}px`;
  marker.style.top = `${ratioY * rect.height}px`;
  marker.hidden = false;
}

/**
 * Zoom 1:1 dos pixels REAIS do buffer, com o reticulo marcando exatamente a
 * janela que entra na media. Antes, o reticulo era decorativo: media uma
 * janela de 21 px fixa, independente do tamanho de amostragem.
 */
function drawZoom() {
  const info = sampler.info;
  const canvas = el['zoom-canvas'];
  if (!info || !zoomCtx) return;

  const sampleSize = Number(el['sample-size'].value);
  const context = state.zoomContext % 2 === 0 ? Math.max(15, sampleSize + 10) : Math.max(13, sampleSize + 8);
  state.zoomContext = context;

  const half = Math.floor(context / 2);
  const region = sampler.readRegion(state.cursor.x - half, state.cursor.y - half, context, context);
  if (!region) return;

  const scratch = document.createElement('canvas');
  scratch.width = region.width;
  scratch.height = region.height;
  scratch.getContext('2d').putImageData(region, 0, 0);

  zoomCtx.imageSmoothingEnabled = false;
  zoomCtx.clearRect(0, 0, canvas.width, canvas.height);
  zoomCtx.drawImage(scratch, 0, 0, region.width, region.height, 0, 0, canvas.width, canvas.height);

  // Reticulo do tamanho exato da janela de amostragem.
  const cellSize = canvas.width / context;
  const offset = (context - sampleSize) / 2;

  zoomCtx.strokeStyle = '#ff3b30';
  zoomCtx.lineWidth = 2;
  zoomCtx.strokeRect(
    offset * cellSize, offset * cellSize,
    sampleSize * cellSize, sampleSize * cellSize,
  );
}

/* ----------------------------- comparacao ----------------------------- */

function paintSwatch(node, color) {
  if (!node) return;

  if (!color) {
    node.style.backgroundColor = 'var(--swatch-bg)';
    node.setAttribute('aria-label', 'Sem cor');
    return;
  }

  node.style.backgroundColor = color.hex;
  node.setAttribute('aria-label', `Cor ${color.hex.toUpperCase()}`);
  node.title = color.hex.toUpperCase();
}

function writeCell(role, column, value) {
  const node = cell(role, column);
  if (node) node.textContent = value;
}

function writeBadge(value) {
  const node = cell('interpretation', 'value');
  if (!node) return;

  node.replaceChildren();
  if (!value) {
    node.textContent = '-';
    return;
  }

  const badge = document.createElement('span');
  badge.className = `interpretation-badge ${value.class}`;
  badge.textContent = value.text;
  node.appendChild(badge);
}

function updateComparison() {
  const { reference, selected } = state;
  const hasReference = Boolean(reference);
  const hasSelected = Boolean(selected);

  paintSwatch(el['ref-preview'], reference);
  paintSwatch(el['sel-preview'], selected);

  writeCell('hex', 'ref', hasReference ? reference.hex.toUpperCase() : '-');
  writeCell('rgb', 'ref', hasReference ? formatRgb(reference) : '-');
  writeCell('lab', 'ref', hasReference ? formatLab(reference.lab) : '-');
  writeCell('lightness', 'ref', hasReference ? reference.lab.l.toFixed(2) : '-');

  writeCell('hex', 'sel', hasSelected ? selected.hex.toUpperCase() : '-');
  writeCell('rgb', 'sel', hasSelected ? formatRgb(selected) : '-');
  writeCell('lab', 'sel', hasSelected ? formatLab(selected.lab) : '-');
  writeCell('lightness', 'sel', hasSelected ? selected.lab.l.toFixed(2) : '-');

  if (hasReference && hasSelected) {
    const deltaE = ciede2000(selected.lab, reference.lab);
    writeCell('delta', 'value', deltaE.toFixed(2));
    writeBadge(interpretDeltaE(deltaE));
  } else {
    writeCell('delta', 'value', '-');
    writeBadge(null);
  }

  updateRuler();
  announce();
}

/**
 * Regua de luminosidade coerente com o proprio rotulo.
 *
 * A versao anterior escalava os canais RGB da referencia e posicionava o
 * marcador com a luminance NTSC (0.299/0.587/0.114), enquanto o eixo dizia
 * L*=0/50/100. O marcador nao estava na mesma escala do rotulo, e a divisao
 * quebrava com referencia preta. Aqui o gradiente e gerado variando L* de
 * verdade, entao a posicao do marcador e a propria fracao de luminosidade.
 */
function updateRuler() {
  const ruler = el['color-ruler-ref'];
  const { reference, selected } = state;

  if (!reference) {
    ruler.style.background = 'linear-gradient(to right, #000000, #808080, #ffffff)';
    el['ref-color-marker'].hidden = true;
    el['sel-color-marker'].hidden = true;
    el['ref-ruler-label'].textContent = 'Ref —';
    el['sel-ruler-label'].textContent = 'Sel —';
    return;
  }

  const stops = [];
  for (let l = 0; l <= 100; l += 2) {
    const { r, g, b } = labToRgb({ l, a: reference.lab.a, b: reference.lab.b });
    stops.push(`rgb(${r}, ${g}, ${b}) ${l}%`);
  }
  ruler.style.background = `linear-gradient(to right, ${stops.join(', ')})`;

  el['ref-ruler-label'].textContent = `Ref L*=${reference.lab.l.toFixed(1)}`;
  el['ref-color-marker'].style.left = `${reference.lab.l}%`;
  el['ref-color-marker'].hidden = false;

  if (selected) {
    el['sel-ruler-label'].textContent = `Sel L*=${selected.lab.l.toFixed(1)}`;
    el['sel-color-marker'].style.left = `${selected.lab.l}%`;
    el['sel-color-marker'].hidden = false;
  } else {
    el['sel-ruler-label'].textContent = 'Sel —';
    el['sel-color-marker'].hidden = true;
  }
}

/** Anuncia a cor medida para leitores de tela. */
function announce() {
  const node = el['value-announcer'];
  if (!node) return;

  if (!state.selected) {
    node.textContent = 'Nenhuma cor medida.';
    return;
  }

  const parts = [
    `Cor ${state.selected.hex.toUpperCase()}`,
    `RGB ${formatRgb(state.selected)}`,
    `L* ${state.selected.lab.l.toFixed(1)}`,
    `posição ${state.cursor.x}, ${state.cursor.y}`,
  ];

  if (state.reference) {
    parts.push(`diferença CIEDE2000 ${ciede2000(state.selected.lab, state.reference.lab).toFixed(2)}`);
  }

  node.textContent = parts.join(', ');
}

/* ------------------------------- paleta ------------------------------- */

function renderPalette() {
  const list = el['palette-list'];
  list.replaceChildren();

  el['palette-count'].textContent = state.palette.length
    ? `${state.palette.length}/${MAX_PALETTE}`
    : `0/${MAX_PALETTE}`;

  if (!state.palette.length) {
    const empty = document.createElement('p');
    empty.className = 'palette-empty';
    empty.textContent = 'Nenhuma cor de referência salva ainda.';
    list.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  state.palette.forEach((color, index) => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    if (state.reference && color.hex === state.reference.hex) {
      item.classList.add('is-active');
      item.setAttribute('aria-current', 'true');
    }

    const swatch = document.createElement('span');
    swatch.className = 'palette-swatch';
    swatch.style.backgroundColor = color.hex;

    const label = document.createElement('span');
    label.className = 'palette-hex';
    label.textContent = color.hex.toUpperCase();

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'palette-item-remove';
    remove.textContent = '×';
    remove.title = `Remover ${color.hex.toUpperCase()}`;
    remove.setAttribute('aria-label', `Remover ${color.hex.toUpperCase()} da paleta`);

    const useAsReference = () => setReference(color);
    item.addEventListener('click', useAsReference);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        useAsReference();
      }
    });
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removePaletteItem(index);
    });

    item.append(swatch, label, remove);
    fragment.appendChild(item);
  });

  list.appendChild(fragment);
}

async function addToPalette() {
  if (!state.selected) return;

  if (state.palette.some((color) => color.hex === state.selected.hex)) {
    toast.warn('Esta cor já está na paleta.');
    return;
  }

  if (state.palette.length >= MAX_PALETTE) {
    toast.warn(`A paleta está cheia (limite de ${MAX_PALETTE}). Remova uma cor antes de adicionar outra.`);
    return;
  }

  state.palette = [...state.palette, state.selected];
  renderPalette();

  try {
    await storage.palettes.set(state.user.username, state.palette);
  } catch (error) {
    state.palette = state.palette.slice(0, -1);
    renderPalette();
    reportError('Não foi possível salvar a paleta', error);
  }
}

async function removePaletteItem(index) {
  const [removed] = state.palette.splice(index, 1);

  if (state.reference && state.reference.hex === removed.hex) {
    state.reference = null;
  }

  renderPalette();
  updateComparison();
  updateButtons();

  try {
    await storage.palettes.set(state.user.username, state.palette);
  } catch (error) {
    reportError('Não foi possível atualizar a paleta', error);
  }
}

function setReference(color) {
  state.reference = color;
  renderPalette();
  updateComparison();
  updateButtons();
  toast.success(`Referência definida: ${color.hex.toUpperCase()}`);
}

/* ------------------------------ historico ------------------------------ */

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function saveAnalysis() {
  if (!state.reference || !state.selected) return;

  const deltaE = ciede2000(state.selected.lab, state.reference.lab);
  const name = el['analysis-name'].value.trim();

  const record = {
    id: makeId(),
    username: state.user.username,
    name: name || 'Sem nome',
    refColor: state.reference,
    selColor: state.selected,
    deltaE,
    deltaEMethod: 'CIEDE2000',
    interpretation: interpretDeltaE(deltaE),
    sampleSize: Number(el['sample-size'].value),
    position: { x: state.cursor.x, y: state.cursor.y },
    createdAt: new Date().toISOString(),
    schemaVersion: 2,
  };

  const button = el['save-analysis-btn'];
  button.disabled = true;

  try {
    await storage.history.add(record);
    toast.success(`Análise salva (ΔE ${deltaE.toFixed(2)}).`);
  } catch (error) {
    reportError('Não foi possível salvar a análise', error);
  } finally {
    updateButtons();
  }
}

/* ----------------------------- persistencia ----------------------------- */

let nameTimer = null;

function persistAnalysisName() {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(async () => {
    try {
      await storage.meta.set(`analysisName:${state.user.username}`, el['analysis-name'].value);
    } catch (error) {
      logger.warn('Não foi possível salvar o nome da análise.', error);
    }
  }, 400);
}

async function restoreAnalysisName() {
  try {
    const saved = await storage.meta.get(`analysisName:${state.user.username}`);
    if (typeof saved === 'string') el['analysis-name'].value = saved;
  } catch (error) {
    logger.warn('Não foi possível restaurar o nome da análise.', error);
  }
}

/* -------------------------------- botoes -------------------------------- */

function updateButtons() {
  const hasImage = Boolean(sampler.info);
  const hasSelected = Boolean(state.selected);
  const hasReference = Boolean(state.reference);

  el['set-as-ref-btn'].disabled = !hasSelected || (hasReference && state.reference.hex === state.selected.hex);
  el['add-to-palette-btn'].disabled = !hasSelected;
  el['save-analysis-btn'].disabled = !(hasSelected && hasReference);
  el['sample-size'].disabled = !hasImage;
}

/* -------------------------------- eventos -------------------------------- */

function wireEvents() {
  el['upload-btn'].addEventListener('click', () => el['image-input'].click());
  el['image-input'].addEventListener('change', handleFileSelected);

  const canvas = el['image-canvas'];

  canvas.addEventListener('click', (event) => sampleAt(event.clientX, event.clientY));
  canvas.addEventListener('touchstart', (event) => {
    // Impede a rolagem da pagina ao arrastar o dedo sobre a imagem.
    if (event.touches.length !== 1) return;
    event.preventDefault();
    sampleAt(event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: false });

  // Navegacao por teclado: sem isso, a area de amostragem e inacessivel.
  canvas.addEventListener('keydown', (event) => {
    const info = sampler.info;
    if (!info) return;

    const step = event.shiftKey ? 10 : 1;
    let { x, y } = state.cursor;
    let handled = true;

    switch (event.key) {
      case 'ArrowLeft': x -= step; break;
      case 'ArrowRight': x += step; break;
      case 'ArrowUp': y -= step; break;
      case 'ArrowDown': y += step; break;
      case 'Enter':
      case ' ':
        measure();
        break;
      case 'Home':
        x = 0;
        y = 0;
        break;
      case 'End':
        x = info.width - 1;
        y = info.height - 1;
        break;
      default:
        handled = false;
    }

    if (!handled) return;
    event.preventDefault();

    state.cursor = {
      x: clamp(x, 0, info.width - 1),
      y: clamp(y, 0, info.height - 1),
    };
    measure();
  });

  el['sample-size'].addEventListener('input', () => {
    const size = Number(el['sample-size'].value);
    el['sample-size-value'].textContent = `${size}×${size}`;

    // Remede a janela ao mudar o tamanho da amostragem.
    if (state.hasSelection) measure();
  });

  el['analysis-name'].addEventListener('input', persistAnalysisName);

  el['set-as-ref-btn'].addEventListener('click', () => {
    if (state.selected) setReference(state.selected);
  });

  el['add-to-palette-btn'].addEventListener('click', () => {
    addToPalette().catch((error) => reportError('Falha ao adicionar à paleta', error));
  });

  el['save-analysis-btn'].addEventListener('click', () => {
    saveAnalysis().catch((error) => reportError('Falha ao salvar a análise', error));
  });

  // Recalcula o display quando o espaco muda. A medicao permanece identica.
  const observer = new ResizeObserver(() => {
    if (!sampler.info) return;
    displaySize = { width: 0, height: 0 };
    renderDisplay();
    positionMarker();
  });
  observer.observe(el['image-canvas'].parentElement);
}

/* --------------------------- service worker --------------------------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            promptUpdate(worker);
          }
        });
      });
    } catch (error) {
      logger.warn('Service Worker não registrado.', error);
    }
  });
}

function promptUpdate(worker) {
  const container = document.getElementById('update-banner');
  const message = document.getElementById('update-message');
  const button = document.getElementById('update-btn');

  if (!container) return;

  message.textContent = 'Há uma versão nova do analisador disponível.';
  container.hidden = false;

  const apply = () => {
    worker.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  };

  button?.addEventListener('click', apply, { once: true });
  container.querySelector('.update-dismiss')?.addEventListener('click', () => {
    container.hidden = true;
  }, { once: true });

  toast.info('Atualização disponível. Recarregue para aplicar.');
}

export { init };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}