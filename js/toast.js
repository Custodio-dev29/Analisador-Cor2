/**
 * Notificacoes e dialogs.
 *
 * O aplicativo usava alert()/prompt()/confirm() em 30 pontos. Isso bloqueia a
 * interface, e invisivel para leitores de tela e para testes. Aqui as
 * notificacoes sao uma regiao aria-live e as confirmacoes usam <dialog>, que
 * ja entrega foco preso e fechamento por Esc de graca.
 */

import { logger } from './logger.js';

const REGION_ID = 'toast-region';
const MAX_VISIBLE = 4;

function region() {
  let element = document.getElementById(REGION_ID);
  if (!element) {
    element = document.createElement('div');
    element.id = REGION_ID;
    element.className = 'toast-region';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-atomic', 'false');
    document.body.appendChild(element);
  }
  return element;
}

/**
 * Exibe uma notificacao nao bloqueante.
 * @param {string} message
 * @param {{type?: 'info'|'success'|'warn'|'error', timeout?: number}} [options]
 */
export function toast(message, options = {}) {
  const { type = 'info', timeout = type === 'error' ? 8000 : 4000 } = options;
  const host = region();

  while (host.children.length >= MAX_VISIBLE) host.firstElementChild?.remove();

  const element = document.createElement('output');
  element.className = `toast toast--${type}`;
  element.textContent = message;
  host.appendChild(element);

  // Um frame de atraso permite a transicao de entrada.
  requestAnimationFrame(() => element.classList.add('is-visible'));

  if (timeout > 0) {
    setTimeout(() => {
      element.classList.remove('is-visible');
      element.addEventListener('transitionend', () => element.remove(), { once: true });
      setTimeout(() => element.remove(), 400);
    }, timeout);
  }

  return {
    dismiss() {
      element.remove();
    },
  };
}

toast.success = (message, options = {}) => toast(message, { ...options, type: 'success' });
toast.warn = (message, options = {}) => toast(message, { ...options, type: 'warn' });
toast.error = (message, options = {}) => toast(message, { ...options, type: 'error', timeout: 8000 });

/**
 * Erro inesperado, com detalhe tecnico apenas no console.
 * O usuario ve uma mensagem util; o developer ve o stack.
 */
export function reportError(context, error) {
  logger.error(`${context}:`, error);
  const message = error instanceof Error ? error.message : String(error);
  toast.error(message || 'Ocorreu um erro inesperado.');
}

function buildDialog({ title, body, fields = [], confirmLabel, cancelLabel, danger }) {
  const dialog = document.createElement('dialog');
  dialog.className = `app-dialog${danger ? ' app-dialog--danger' : ''}`;

  const form = document.createElement('form');
  form.method = 'dialog';
  form.className = 'app-dialog__form';

  const heading = document.createElement('h2');
  heading.className = 'app-dialog__title';
  heading.textContent = title;
  form.appendChild(heading);

  if (body) {
    const paragraph = document.createElement('p');
    paragraph.className = 'app-dialog__body';
    paragraph.textContent = body;
    form.appendChild(paragraph);
  }

  const inputs = [];
  for (const field of fields) {
    const group = document.createElement('div');
    group.className = 'form-group';

    const label = document.createElement('label');
    label.setAttribute('for', `dialog-field-${field.name}`);
    label.textContent = field.label;

    const input = document.createElement('input');
    input.id = `dialog-field-${field.name}`;
    input.name = field.name;
    input.type = field.type ?? 'text';
    if (field.autocomplete) input.autocomplete = field.autocomplete;
    if (field.minLength) input.minLength = field.minLength;
    if (field.maxLength) input.maxLength = field.maxLength;
    input.required = true;

    group.append(label, input);
    form.appendChild(group);
    inputs.push({ field, input });
  }

  const actions = document.createElement('div');
  actions.className = 'app-dialog__actions';

  const cancel = document.createElement('button');
  cancel.type = 'submit';
  cancel.value = 'cancel';
  cancel.className = 'control-btn';
  cancel.textContent = cancelLabel ?? 'Cancelar';

  const confirm = document.createElement('button');
  confirm.type = 'submit';
  confirm.value = 'confirm';
  confirm.className = `control-btn${danger ? ' danger-btn' : ''}`;
  confirm.textContent = confirmLabel ?? 'Confirmar';

  actions.append(cancel, confirm);
  form.appendChild(actions);
  dialog.appendChild(form);

  return { dialog, inputs };
}

/**
 * Confirmacao modal.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false } = {}) {
  return new Promise((resolve) => {
    const { dialog } = buildDialog({ title, body: message, confirmLabel, cancelLabel, danger });

    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    }, { once: true });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/**
 * Pedido de texto (substitui window.prompt).
 * @returns {Promise<string|null>} null se cancelado.
 */
export function promptDialog({ title, message, label, type = 'text', confirmLabel, minLength, maxLength, autocomplete } = {}) {
  return new Promise((resolve) => {
    const { dialog, inputs } = buildDialog({
      title,
      body: message,
      fields: [{ name: 'value', label: label ?? 'Valor', type, minLength, maxLength, autocomplete }],
      confirmLabel,
    });

    dialog.addEventListener('close', () => {
      const value = dialog.returnValue === 'confirm' ? inputs[0].input.value : null;
      resolve(value);
      dialog.remove();
    }, { once: true });

    document.body.appendChild(dialog);
    dialog.showModal();
    inputs[0].input.focus();
  });
}