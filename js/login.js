/**
 * Tela de autenticacao.
 *
 * O "Esqueceu a senha?" da versao anterior nao recuperava nada: abria um
 * formulario de credencial de administrador. O fluxo de recuperacao por token
 * (reset-password.js) existia no repositorio mas nada gerava o token, entao
 * era codigo morto. Este arquivo mantem apenas o que funciona, com os rotulos
 * dizendo o que realmente acontece.
 */

import { register, login, setPassword, validateUsername, listUsers } from './auth.js';
import { currentUser, normalizeUsername } from './auth.js';
import { storage } from './storage.js';
import { toast, reportError } from './toast.js';
import { warnInsecureContext } from './guard.js';

const $ = (id) => document.getElementById(id);

const FORMS = ['login-form', 'register-form', 'admin-form', 'admin-reset-form'];

function showForm(id) {
  for (const formId of FORMS) $(formId).classList.toggle('is-active', formId === id);
  $(id).querySelector('input')?.focus();
}

function setBusy(form, busy, label) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = busy;
  if (label) button.textContent = label;
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const username = $('login-username').value;
  const password = $('login-password').value;

  setBusy(form, true, 'Entrando…');

  try {
    const result = await login(username, password);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    window.location.href = 'index.html';
  } catch (error) {
    reportError('Falha no login', error);
  } finally {
    setBusy(form, false, 'Entrar');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.target;

  const usernameError = validateUsername($('register-username').value);
  if (usernameError) {
    toast.warn(usernameError);
    return;
  }

  setBusy(form, true, 'Criando…');

  try {
    const result = await register({
      name: $('register-name').value,
      username: $('register-username').value,
      password: $('register-password').value,
    });

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(
      result.user.isMaster
        ? 'Conta de administrador criada. Faça login para continuar.'
        : 'Conta criada. Faça login para continuar.',
    );
    form.reset();
    showForm('login-form');
  } catch (error) {
    reportError('Falha no cadastro', error);
  } finally {
    setBusy(form, false, 'Criar conta');
  }
}

/**
 * O antigo "recuperar senha" era, na verdade, o acesso do administrador.
 * Mantem esse comportamento, mas com o rotulo correto.
 */
async function handleAdminAccess(event) {
  event.preventDefault();
  const form = event.target;

  setBusy(form, true, 'Verificando…');

  try {
    const username = normalizeUsername($('admin-username').value);
    const user = await storage.users.get(username);

    const valid = user?.isMaster
      && (await login(username, $('admin-password').value)).ok;

    if (!valid) {
      toast.error('Credenciais de administrador inválidas.');
      return;
    }

    await loadAdminTargets();
    showForm('admin-reset-form');
  } catch (error) {
    reportError('Falha ao verificar administrador', error);
  } finally {
    setBusy(form, false, 'Entrar como administrador');
  }
}

async function loadAdminTargets() {
  const select = $('admin-target');
  select.replaceChildren();

  const users = await listUsers();
  const targets = users.filter((user) => !user.isMaster);

  if (!targets.length) {
    const option = document.createElement('option');
    option.textContent = 'Nenhum usuário cadastrado';
    option.value = '';
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const user of targets) {
    const option = document.createElement('option');
    option.value = user.username;
    option.textContent = `${user.name} (${user.username})`;
    select.appendChild(option);
  }
}

async function handleAdminReset(event) {
  event.preventDefault();
  const form = event.target;
  const target = $('admin-target').value;

  if (!target) {
    toast.warn('Selecione um usuário.');
    return;
  }

  setBusy(form, true, 'Redefinindo…');

  try {
    await setPassword(target, $('admin-new-password').value);
    toast.success(`Senha de "${target}" redefinida.`);
    form.reset();
    showForm('login-form');
  } catch (error) {
    reportError('Falha ao redefinir a senha', error);
  } finally {
    setBusy(form, false, 'Redefinir senha');
  }
}

async function init() {
  // Sem contexto seguro o login e' impossivel. Avisa antes, e desabilita os
  // formularios: e' melhor que a pessoa Discover so no submit que nada vai
  // acontecer.
  if (warnInsecureContext()) {
    for (const id of FORMS) {
      $(id).querySelector('button[type="submit"]').disabled = true;
    }
    return;
  }

  await storage.init().catch(() => {});

  // Ja autenticado? Vai direto para o analisador.
  if (await currentUser()) {
    window.location.replace('index.html');
    return;
  }

  $('login-form').addEventListener('submit', handleLogin);
  $('register-form').addEventListener('submit', handleRegister);
  $('admin-form').addEventListener('submit', handleAdminAccess);
  $('admin-reset-form').addEventListener('submit', handleAdminReset);

  $('show-register').addEventListener('click', (event) => {
    event.preventDefault();
    showForm('register-form');
  });

  for (const id of ['show-login', 'show-login-from-register', 'show-login-from-admin', 'show-login-from-admin-reset']) {
    $(id)?.addEventListener('click', (event) => {
      event.preventDefault();
      showForm('login-form');
    });
  }

  $('show-admin').addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await loadAdminTargets();
    } catch (error) {
      reportError('Falha ao carregar usuários', error);
    }
    showForm('admin-form');
  });

  // A ordem dos formularios no HTML e' a ordem em que sao exibidos.
  const first = FORMS.find((id) => $(id).classList.contains('is-active')) ?? 'login-form';
  showForm(first);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}