/**
 * Autenticacao local.
 *
 * AVISO DE MODELO DE AMEACA
 * Este aplicativo e uma ferramenta local. As credenciais nunca sao enviadas a
 * um servidor porque ele nao existe. Isso significa que o controle de acesso
 * e convencao, nao seguranca: qualquer pessoa com acesso ao navegador e ao
 * DevTools consegue ler e alterar os dados guardados.
 *
 * O que esta modulo faz e reduzir o dano acidental e aijenamento de senha em
 * texto legivel, usando PBKDF2-HMAC-SHA256 com salt por usuario. Para
 * autenticacao de verdade, o backend precisa ser uma opcao.
 */

import { storage } from './storage.js';
import { logger } from './logger.js';

const SESSION_KEY = 'analisador-cores:sessao';

/** Recomendacao OWASP para PBKDF2-HMAC-SHA256. Custa ~150ms no login. */
const PBKDF2_ITERATIONS = 210000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

const encoder = new TextEncoder();

/** true quando o WebCrypto esta disponivel (exige contexto seguro). */
export function isCryptoAvailable() {
  return typeof globalThis.crypto?.subtle?.importKey === 'function';
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Comparacao em tempo constante, para nao vazar informacao por temporizacao. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Hash legado (o "simpleHash" da v1: 32 bits, sem salt).
 * Existe apenas para validar e converter senhas antigas no primeiro login.
 */
export function legacyHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

export async function createCredential(password) {
  if (!isCryptoAvailable()) {
    throw new Error('Este navegador não expõe Web Crypto. Sirva o app por HTTP(S) em localhost para habilitar o login.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS);

  return {
    algo: 'PBKDF2-HMAC-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    hash: toBase64(hash),
  };
}

async function verifyAgainstCredential(password, credential) {
  const salt = fromBase64(credential.salt);
  const expected = fromBase64(credential.hash);
  const actual = await deriveBits(password, salt, credential.iterations);
  return timingSafeEqual(actual, expected);
}

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    return 'Use de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.';
  }
  return null;
}

export function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `A senha deve ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}

/**
 * Cria um usuario. A senha nunca e gravada: apenas o resultado do PBKDF2.
 * @returns {Promise<{ok:boolean, error?:string, user?:object}>}
 */
export async function register({ name, username, password }) {
  const error = validateUsername(username) ?? validatePassword(password);
  if (error) return { ok: false, error };

  const key = normalizeUsername(username);
  const trimmedName = String(name ?? '').trim();
  if (!trimmedName) return { ok: false, error: 'Informe o nome.' };

  const existing = await storage.users.get(key);
  if (existing) return { ok: false, error: 'Este nome de usuário já está em uso.' };

  const isFirstUser = (await storage.users.list()).length === 0;

  const user = {
    username: key,
    name: trimmedName,
    credentials: await createCredential(password),
    legacyHash: null,
    // O primeiro usuario registrado e o administrador. Sem um "master" fixo
    // no codigo, nao existe conta administrativa conhecida por ataque.
    isMaster: isFirstUser,
    createdAt: new Date().toISOString(),
    schemaVersion: 2,
  };

  try {
    await storage.users.put(user);
  } catch (cause) {
    logger.error('Falha ao gravar usuario.', cause);
    return { ok: false, error: 'Não foi possível salvar o usuário. O armazenamento pode estar cheio ou bloqueado.' };
  }

  return { ok: true, user };
}

/**
 * Autentica e, se o registro ainda usar o hash legado, converte para PBKDF2
 * de forma transparente.
 * @returns {Promise<{ok:boolean, error?:string, user?:object}>}
 */
export async function login(username, password) {
  const key = normalizeUsername(username);

  if (!key || !password) {
    return { ok: false, error: 'Informe usuário e senha.' };
  }

  const user = await storage.users.get(key);

  if (!user) {
    // Deriva mesmo assim, para nao revelar por temporizacao se o usuario existe.
    if (isCryptoAvailable()) {
      await deriveBits(String(password), new Uint8Array(SALT_BYTES), PBKDF2_ITERATIONS).catch(() => {});
    }
    return { ok: false, error: 'Usuário ou senha inválidos.' };
  }

  let valid = false;

  if (user.credentials) {
    try {
      valid = await verifyAgainstCredential(String(password), user.credentials);
    } catch (error) {
      logger.error('Falha ao verificar credencial.', error);
      return { ok: false, error: 'Não foi possível verificar a senha neste navegador.' };
    }
  } else if (typeof user.legacyHash === 'string') {
    valid = legacyHash(String(password)) === user.legacyHash;
  }

  if (!valid) return { ok: false, error: 'Usuário ou senha inválidos.' };

  if (!user.credentials) {
    try {
      user.credentials = await createCredential(String(password));
      delete user.legacyHash;
      await storage.users.put(user);
      logger.info('Credencial migrada para PBKDF2.', user.username);
    } catch (error) {
      // O login foi valido; apenas a modernizacao falhou.
      logger.warn('Não foi possível migrar a credencial legada.', error);
    }
  }

  startSession(user);
  return { ok: true, user };
}

/** Redefine a senha de um usuario. */
export async function setPassword(username, newPassword) {
  const error = validatePassword(newPassword);
  if (error) throw new Error(error);

  const key = normalizeUsername(username);
  const user = await storage.users.get(key);
  if (!user) throw new Error('Usuário não encontrado.');

  user.credentials = await createCredential(newPassword);
  delete user.legacyHash;
  await storage.users.put(user);
  return user;
}

/* ---------------------------- sessao ---------------------------- */

export function startSession(user) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    username: user.username,
    startedAt: Date.now(),
  }));
}

export function endSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

/**
 * Usuario da sessao atual.
 *
 * O usuario e lido do banco a cada chamada, e nao do sessionStorage. Assim,
 * editar `sessionStorage` nao concede perfil de administrador — o que
 * acontece se o papel ficar no proprio storage do cliente.
 */
export async function currentUser() {
  const session = readSession();
  if (!session?.username) return null;

  const user = await storage.users.get(session.username);
  if (!user) {
    endSession();
    return null;
  }
  return user;
}

export async function listUsers() {
  const users = await storage.users.list();
  return users.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function deleteUser(username) {
  const key = normalizeUsername(username);
  const user = await storage.users.get(key);
  if (!user) throw new Error('Usuário não encontrado.');
  if (user.isMaster) throw new Error('Não é possível excluir o administrador do sistema.');
  await storage.users.delete(key);
}