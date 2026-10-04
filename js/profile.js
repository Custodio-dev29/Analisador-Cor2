/**
 * Painel de administracao de usuarios.
 *
 * IMPORTANTE: o controle de acesso desta tela e convencao, nao seguranca.
 * O aplicativo roda inteiramente no navegador e nao existe servidor. Qualquer
 * pessoa com acesso ao dispositivo pode ler e alterar os dados guardados —
 * inclusive remover a conta de administrador. Ver README.md, secao "Modelo de
 * ameaca".
 *
 * O que a tela faz de verdade: gestao de contas com confirmacao explicita,
 * e exclusao do administrador bloqueada por codigo para nao haver autorremocao
 * acidental.
 */

import { requireAuth, wireLogout } from './guard.js';
import { listUsers, setPassword, deleteUser } from './auth.js';
import { promptDialog, confirmDialog, toast, reportError } from './toast.js';

const $ = (id) => document.getElementById(id);

async function render() {
  const body = $('user-list-body');
  body.replaceChildren();

  const users = await listUsers();
  const others = users.filter((user) => user.username !== state.user.username);

  $('user-count').textContent = `${users.length} ${users.length === 1 ? 'conta' : 'contas'}`;

  if (!others.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty-state';
    cell.textContent = 'Nenhum usuário além de você.';
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const user of others) {
    const row = document.createElement('tr');

    const username = document.createElement('td');
    username.textContent = user.username;

    const fullName = document.createElement('td');
    fullName.textContent = user.name;

    const created = document.createElement('td');
    created.className = 'record-meta';
    created.textContent = new Date(user.createdAt).toLocaleDateString('pt-BR');

    const actions = document.createElement('td');
    actions.className = 'table-actions';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'control-btn';
    reset.textContent = 'Redefinir senha';
    reset.addEventListener('click', () => resetPassword(user.username));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'control-btn danger-btn';
    remove.textContent = 'Excluir';
    remove.addEventListener('click', () => removeUser(user));

    actions.append(reset, remove);
    row.append(username, fullName, created, actions);
    fragment.appendChild(row);
  }

  body.appendChild(fragment);
}

async function resetPassword(username) {
  const password = await promptDialog({
    title: 'Redefinir senha',
    message: `Defina uma nova senha para "${username}".`,
    label: 'Nova senha',
    type: 'password',
    confirmLabel: 'Redefinir',
    autocomplete: 'new-password',
  });

  if (password === null) return;

  try {
    await setPassword(username, password);
    toast.success(`Senha de "${username}" redefinida.`);
  } catch (error) {
    reportError('Falha ao redefinir a senha', error);
  }
}

async function removeUser(user) {
  const confirmed = await confirmDialog({
    title: 'Excluir usuário',
    message: `Excluir "${user.username}" (${user.name})? O histórico e a paleta dessa conta também serão apagados. Esta ação não pode ser desfeita.`,
    confirmLabel: 'Excluir definitivamente',
    danger: true,
  });

  if (!confirmed) return;

  try {
    await deleteUser(user.username);
    toast.success(`Usuário "${user.username}" excluído.`);
    await render();
  } catch (error) {
    reportError('Falha ao excluir o usuário', error);
  }
}

const state = { user: null };

async function init() {
  const user = await requireAuth({ master: true });
  if (!user) return;

  state.user = user;
  wireLogout();

  $('current-user').textContent = `${user.name} (${user.username})`;

  try {
    await render();
  } catch (error) {
    reportError('Não foi possível carregar a lista de usuários', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}