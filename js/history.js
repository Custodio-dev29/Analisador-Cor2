/**
 * Pagina de historico.
 *
 * A versao anterior montava as celulas de cor com innerHTML interpolando
 * `color.hex` — e o proprio arquivo carregava um comentario dizendo que
 * aquilo tinha sido corrigido. Alem do risco de XSS, a interpolacao de um
 * valor invalido quebrava o layout. Aqui tudo e montado com textContent e
 * o hex passa por hexToRgb antes de tocar em style.
 */

import { requireAuth, wireLogout } from './guard.js';
import { storage } from './storage.js';
import { formatRgb, formatLab, hexToRgb } from './color.js';
import { exportCsv, exportXlsx } from './export.js';
import { toast, reportError, confirmDialog } from './toast.js';

const PAGE_SIZE = 50;

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  history: [],
  visible: PAGE_SIZE,
};

function visibleRecords() {
  return state.history.slice(0, state.visible);
}

/** Aplica uma cor a um elemento de amostra, validando o valor antes. */
function paintSwatch(node, hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    node.hidden = true;
    return false;
  }
  node.hidden = false;
  node.style.backgroundColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  node.title = hex.toUpperCase();
  return true;
}

function buildColorCell(color, label) {
  const cell = document.createElement('td');
  cell.dataset.label = label;

  const wrapper = document.createElement('div');
  wrapper.className = 'color-cell';

  const swatch = document.createElement('span');
  swatch.className = 'history-swatch';
  swatch.setAttribute('role', 'img');

  const valid = paintSwatch(swatch, color?.hex ?? '');

  const details = document.createElement('div');
  details.className = 'history-color-details';

  if (valid) {
    swatch.setAttribute('aria-label', `Cor ${color.hex.toUpperCase()}`);
    details.append(
      document.createTextNode(color.hex.toUpperCase()),
      document.createElement('br'),
    );

    const meta = document.createElement('small');
    meta.textContent = `${formatRgb(color)} · ${formatLab(color.lab)}`;
    details.append(meta);
  } else {
    swatch.setAttribute('aria-label', 'Cor inválida');
    details.textContent = 'registro inválido';
  }

  wrapper.append(swatch, details);
  cell.appendChild(wrapper);
  return cell;
}

function buildRow(record) {
  const row = document.createElement('tr');

  const nameCell = document.createElement('td');
  nameCell.dataset.label = 'ID / Nome da Amostra';

  const name = document.createElement('b');
  name.textContent = record.name || 'Sem nome';

  const meta = document.createElement('small');
  meta.className = 'record-meta';
  meta.textContent = new Date(record.createdAt).toLocaleString('pt-BR');

  const position = record.position
    ? ` · px ${record.position.x},${record.position.y}`
    : '';

  meta.textContent += position;

  nameCell.append(name, document.createElement('br'), meta);
  row.appendChild(nameCell);

  row.append(
    buildColorCell(record.refColor, 'Cor de Referência'),
    buildColorCell(record.selColor, 'Cor Analisada'),
  );

  const deltaCell = document.createElement('td');
  deltaCell.dataset.label = 'Diferença (ΔE)';
  deltaCell.className = 'delta-cell';
  deltaCell.textContent = typeof record.deltaE === 'number' ? record.deltaE.toFixed(2) : '—';
  row.appendChild(deltaCell);

  const interpretationCell = document.createElement('td');
  interpretationCell.dataset.label = 'Interpretação';

  if (record.interpretation) {
    const badge = document.createElement('span');
    badge.className = `interpretation-badge ${record.interpretation.class}`;
    badge.textContent = record.interpretation.text;
    interpretationCell.appendChild(badge);
  } else {
    interpretationCell.textContent = '—';
  }
  row.appendChild(interpretationCell);

  const actionCell = document.createElement('td');
  actionCell.dataset.label = 'Ação';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-history-btn';
  remove.textContent = '×';
  remove.title = 'Remover análise';
  remove.setAttribute('aria-label', `Remover análise ${record.name || record.id}`);

  // Remove por id, e nao por indice: a lista e reordenada por data e o indice
  // capturado no render pode apontar para outro registro.
  remove.addEventListener('click', () => removeRecord(record.id));

  actionCell.appendChild(remove);
  row.appendChild(actionCell);

  return row;
}

function render() {
  const body = $('analysis-history-body');
  body.replaceChildren();

  $('history-count').textContent = state.history.length
    ? `${state.history.length} ${state.history.length === 1 ? 'registro' : 'registros'}`
    : '';

  if (!state.history.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'empty-state';
    cell.textContent = 'Nenhuma análise salva ainda. Volte ao analisador e use “Salvar Análise”.';
    row.appendChild(cell);
    body.appendChild(row);
    $('load-more-btn').hidden = true;
    $('clear-history-btn').hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const record of visibleRecords()) fragment.appendChild(buildRow(record));
  body.appendChild(fragment);

  $('load-more-btn').hidden = state.visible >= state.history.length;
  $('clear-history-btn').hidden = false;
}

async function loadHistory() {
  try {
    state.history = await storage.history.list(state.user.username);
    render();
  } catch (error) {
    reportError('Não foi possível carregar o histórico', error);
  }
}

async function removeRecord(id) {
  const record = state.history.find((item) => item.id === id);
  if (!record) return;

  const confirmed = await confirmDialog({
    title: 'Remover análise',
    message: `Remover "${record.name || 'Sem nome'}" do histórico? Esta ação não pode ser desfeita.`,
    confirmLabel: 'Remover',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await storage.history.delete(state.user.username, id);
    state.history = state.history.filter((item) => item.id !== id);
    render();
    toast.success('Análise removida.');
  } catch (error) {
    reportError('Não foi possível remover a análise', error);
  }
}

async function clearHistory() {
  const confirmed = await confirmDialog({
    title: 'Limpar histórico',
    message: `Remover todas as ${state.history.length} análises deste usuário? Esta ação não pode ser desfeita.`,
    confirmLabel: 'Remover tudo',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await storage.history.clear(state.user.username);
    state.history = [];
    render();
    toast.success('Histórico limpo.');
  } catch (error) {
    reportError('Não foi possível limpar o histórico', error);
  }
}

async function init() {
  const user = await requireAuth();
  if (!user) return;

  state.user = user;
  wireLogout();

  $('load-more-btn').addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    render();
  });

  $('clear-history-btn').addEventListener('click', () => {
    clearHistory().catch((error) => reportError('Falha ao limpar o histórico', error));
  });

  $('export-csv-btn').addEventListener('click', () => exportCsv(state.history));
  $('export-xlsx-btn').addEventListener('click', () => {
    exportXlsx(state.history).catch((error) => reportError('Falha ao exportar', error));
  });

  await loadHistory();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}