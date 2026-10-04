/**
 * Persistencia local sobre IndexedDB.
 *
 * Antes, cada salvamento reescrevia um unico objeto localStorage contendo
 * TODOS os usuarios com TODO o historico de cada um. Digitar o nome de uma
 * amostra disparava dozens de serializacoes completas. Aqui cada registro tem
 * sua propria chave e nada mais e reescrito do que o necessario.
 */

import { ciede2000, interpretDeltaE } from './color.js';
import { logger } from './logger.js';

const DB_NAME = 'analisador-cores';
const DB_VERSION = 1;

const STORE = Object.freeze({
  users: 'users',
  history: 'history',
  palettes: 'palettes',
  meta: 'meta',
});

/** Chave do formato antigo (v1), importado uma unica vez. */
const LEGACY_KEY = 'colorAnalyzerUsers';

/** Versao do formato de registro de historico. */
export const HISTORY_SCHEMA_VERSION = 2;

/** Limite de cores na paleta, para ninguem estourar a cota de armazenamento. */
export const MAX_PALETTE = 64;

let dbPromise = null;
let backend = 'idb';

const promisifyRequest = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE.users)) {
        db.createObjectStore(STORE.users, { keyPath: 'username' });
      }
      if (!db.objectStoreNames.contains(STORE.history)) {
        const store = db.createObjectStore(STORE.history, { keyPath: ['username', 'id'] });
        store.createIndex('by-user', 'username', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE.palettes)) {
        db.createObjectStore(STORE.palettes, { keyPath: 'username' });
      }
      if (!db.objectStoreNames.contains(STORE.meta)) {
        db.createObjectStore(STORE.meta, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Se outra aba abrir uma versao mais nova, fecha esta para nao bloquear.
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponível.'));
    request.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba do aplicativo.'));
  });
}

/* ------------------------------------------------------------------ *
 * Backend de reserva: localStorage.
 *
 * Modo privado de alguns navegadores bloqueia o IndexedDB. O app ainda
 * precisa funcionar, mesmo que sem a mesma capacidade de armazenamento.
 * ------------------------------------------------------------------ */

const FALLBACK_KEY = 'analisador-cores:fallback';

function readFallback() {
  try {
    return JSON.parse(localStorage.getItem(FALLBACK_KEY)) || {};
  } catch {
    return {};
  }
}

function writeFallback(data) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
}

const fallbackAdapter = {
  users: {
    async get(username) {
      return readFallback().users?.[username] ?? null;
    },
    async put(user) {
      const data = readFallback();
      data.users = { ...data.users, [user.username]: user };
      writeFallback(data);
      return user;
    },
    async all() {
      return Object.values(readFallback().users ?? {});
    },
async delete(username) {
    const data = readFallback();
    if (data.users) delete data.users[username];
    if (data.palettes) delete data.palettes[username];
    writeFallback(data);
  },
  },
  history: {
    async list(username) {
      return Object.values(readFallback().history ?? {}).filter((item) => item.username === username);
    },
    async put(item) {
      const data = readFallback();
      data.history = { ...data.history, [`${item.username}|${item.id}`]: item };
      writeFallback(data);
      return item;
    },
    async delete(username, id) {
      const data = readFallback();
      if (data.history) delete data.history[`${username}|${id}`];
      writeFallback(data);
    },
    async clear(username) {
      const data = readFallback();
      data.history = Object.fromEntries(
        Object.entries(data.history ?? {}).filter(([key]) => !key.startsWith(`${username}|`)),
      );
      writeFallback(data);
    },
  },
  palettes: {
    async get(username) {
      return readFallback().palettes?.[username] ?? { username, colors: [] };
    },
    async put(entry) {
      const data = readFallback();
      data.palettes = { ...data.palettes, [entry.username]: entry };
      writeFallback(data);
      return entry;
    },
  },
  meta: {
    async get(key) {
      return readFallback().meta?.[key]?.value ?? null;
    },
    async put(key, value) {
      const data = readFallback();
      data.meta = { ...data.meta, [key]: { key, value } };
      writeFallback(data);
    },
  },
};

const idbAdapter = {
  users: {
    async get(username) {
      const db = await getDb();
      const tx = db.transaction(STORE.users, 'readonly');
      return (await promisifyRequest(tx.objectStore(STORE.users).get(username))) ?? null;
    },
    async put(user) {
      const db = await getDb();
      const tx = db.transaction(STORE.users, 'readwrite');
      tx.objectStore(STORE.users).put(user);
      return user;
    },
    async all() {
      const db = await getDb();
      const tx = db.transaction(STORE.users, 'readonly');
      return (await promisifyRequest(tx.objectStore(STORE.users).getAll())) ?? [];
    },
    async delete(username) {
      const db = await getDb();
      const tx = db.transaction(STORE.users, 'readwrite');
      tx.objectStore(STORE.users).delete(username);
    },
  },
  history: {
    async list(username) {
      const db = await getDb();
      const tx = db.transaction(STORE.history, 'readonly');
      const index = tx.objectStore(STORE.history).index('by-user');
      return (await promisifyRequest(index.getAll(IDBKeyRange.only(username)))) ?? [];
    },
    async put(item) {
      const db = await getDb();
      const tx = db.transaction(STORE.history, 'readwrite');
      tx.objectStore(STORE.history).put(item);
      return item;
    },
    async delete(username, id) {
      const db = await getDb();
      const tx = db.transaction(STORE.history, 'readwrite');
      tx.objectStore(STORE.history).delete([username, id]);
    },
    async clear(username) {
      const db = await getDb();
      const tx = db.transaction(STORE.history, 'readwrite');
      const index = tx.objectStore(STORE.history).index('by-user');
      const keys = await promisifyRequest(index.getAllKeys(IDBKeyRange.only(username)));
      for (const key of keys) tx.objectStore(STORE.history).delete(key);
    },
  },
palettes: {
    async get(username) {
      const db = await getDb();
      const tx = db.transaction(STORE.palettes, 'readonly');
      return (await promisifyRequest(tx.objectStore(STORE.palettes).get(username))) ?? { username, colors: [] };
    },
    async put(entry) {
      const db = await getDb();
      const tx = db.transaction(STORE.palettes, 'readwrite');
      tx.objectStore(STORE.palettes).put(entry);
      return entry;
    },
    async delete(username) {
      const db = await getDb();
      const tx = db.transaction(STORE.palettes, 'readwrite');
      tx.objectStore(STORE.palettes).delete(username);
    },
  },
  meta: {
    async get(key) {
      const db = await getDb();
      const tx = db.transaction(STORE.meta, 'readonly');
      const record = await promisifyRequest(tx.objectStore(STORE.meta).get(key));
      return record?.value ?? null;
    },
    async put(key, value) {
      const db = await getDb();
      const tx = db.transaction(STORE.meta, 'readwrite');
      tx.objectStore(STORE.meta).put({ key, value });
    },
  },
};

function getDb() {
  if (!dbPromise) dbPromise = openDatabase();
  return dbPromise;
}

async function resolveAdapter() {
  try {
    await getDb();
    backend = 'idb';
  } catch (error) {
    logger.warn('IndexedDB indisponível, usando localStorage como reserva.', error);
    backend = 'localstorage';
  }
  return backend === 'idb' ? idbAdapter : fallbackAdapter;
}

function adapter() {
  return backend === 'idb' ? idbAdapter : fallbackAdapter;
}

/* ------------------------------------------------------------------ *
 * Migracao do formato legado (v1 -> v2)
 * ------------------------------------------------------------------ */

/**
 * Converte um registro do formato antigo para o formato atual.
 * O Delta E legado era CIEDE76 e as faixas de interpretacao eram as
 * dessa formula; recalculamos com CIEDE2000 a partir do Lab ja gravado.
 */
export function upgradeHistoryRecord(record) {
  if (!record) return null;
  if (record.schemaVersion >= HISTORY_SCHEMA_VERSION) return record;

  const refLab = record.refColor?.lab;
  const selLab = record.selColor?.lab;

  const deltaE = refLab && selLab ? ciede2000(selLab, refLab) : null;

  return {
    id: record.id,
    username: record.username,
    name: record.name || 'Sem nome',
    refColor: record.refColor ?? null,
    selColor: record.selColor ?? null,
    deltaE,
    deltaEMethod: 'CIEDE2000',
    interpretation: deltaE === null ? null : interpretDeltaE(deltaE),
    sampleSize: record.sampleSize ?? null,
    position: record.position ?? null,
    createdAt: record.timestamp ?? record.createdAt ?? new Date().toISOString(),
    schemaVersion: HISTORY_SCHEMA_VERSION,
  };
}

/**
 * Importa os dados do localStorage legado uma unica vez.
 * @returns {Promise<{imported:boolean, users:number, history:number}>}
 */
export async function migrateLegacyData() {
  const store = await resolveAdapter();

  if (await store.meta.get('legacyMigrated')) {
    return { imported: false, users: 0, history: 0 };
  }

  let legacy = null;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    legacy = raw ? JSON.parse(raw) : null;
  } catch (error) {
    logger.error('Não foi possível ler os dados legados.', error);
  }

  if (!legacy || typeof legacy !== 'object') {
    await store.meta.put('legacyMigrated', true);
    return { imported: false, users: 0, history: 0 };
  }

  let userCount = 0;
  let historyCount = 0;

for (const [rawUsername, user] of Object.entries(legacy)) {
    if (!user || typeof user !== 'object') continue;

    const username = rawUsername.trim().toLowerCase();
    const existing = await store.users.get(username);
    if (!existing) {
      await store.users.put({
        username,
        name: user.name ?? username,
        // A senha legado nao e um hash utilizavel: mantemos apenas para
        // permitir a migracao transparente para PBKDF2 no primeiro login.
        legacyHash: typeof user.passwordHash === 'string' ? user.passwordHash : null,
        credentials: null,
        isMaster: Boolean(user.isMaster),
        createdAt: new Date().toISOString(),
        schemaVersion: HISTORY_SCHEMA_VERSION,
      });
      userCount += 1;
    }

    const palette = Array.isArray(user.referencePalette) ? user.referencePalette : [];
    if (palette.length) await store.palettes.put({ username, colors: palette });

    const records = Array.isArray(user.analysisHistory) ? user.analysisHistory : [];
    for (const record of records) {
      const upgraded = upgradeHistoryRecord({ ...record, username });
      if (!upgraded?.refColor || !upgraded?.selColor) continue;
      await store.history.put(upgraded);
      historyCount += 1;
    }

    if (typeof user.analysisName === 'string' && user.analysisName) {
      await store.meta.put(`analysisName:${username}`, user.analysisName);
    }
  }

  await store.meta.put('legacyMigrated', true);

  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch (error) {
    logger.warn('Não foi possível remover a chave legada.', error);
  }

  logger.info('Migração legada concluída', { userCount, historyCount, backend });
  return { imported: true, users: userCount, history: historyCount };
}

/* ------------------------------------------------------------------ *
 * API publica
 * ------------------------------------------------------------------ */

/** Nome do backend em uso: 'idb' ou 'localstorage'. */
export function storageBackend() {
  return backend;
}

/** Normaliza a chave de usuario: minusculas e sem espacos nas pontas. */
const userKey = (username) => String(username ?? '').trim().toLowerCase();

/**
 * Fecha a conexao com o banco, para que a proxima chamada reabra.
 * Usado no encerramento limpo e na isolacao dos testes.
 */
export async function closeDatabase() {
  if (!dbPromise) return;
  try {
    (await dbPromise).close();
  } catch {
    // A conexao pode ja estar fechada; nada a fazer.
  }
  dbPromise = null;
}

export const storage = {
  async init() {
    const chosen = await resolveAdapter();
    await migrateLegacyData();
    return chosen;
  },

  users: {
    async get(username) {
      await resolveAdapter();
      return adapter().users.get(userKey(username));
    },
    async put(user) {
      await resolveAdapter();
      return adapter().users.put(user);
    },
    async list() {
      await resolveAdapter();
      return adapter().users.all();
    },
    async delete(username) {
      const key = userKey(username);
      await resolveAdapter();
      const store = adapter();
      await store.users.delete(key);
      // Apagar um usuario tem que apagar os dados dele, senao ficam orfaos.
      await store.history.clear(key);
      await store.palettes.delete(key);
    },
  },

  history: {
    /** Historico do usuario, do mais recente para o mais antigo. */
    async list(username) {
      await resolveAdapter();
      const items = await adapter().history.list(userKey(username));
      return items
        .map(upgradeHistoryRecord)
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    async add(item) {
      await resolveAdapter();
      return adapter().history.put(item);
    },

    async delete(username, id) {
      await resolveAdapter();
      return adapter().history.delete(userKey(username), id);
    },

    async clear(username) {
      await resolveAdapter();
      return adapter().history.clear(userKey(username));
    },
  },

palettes: {
    async get(username) {
      await resolveAdapter();
      const entry = await adapter().palettes.get(userKey(username));
      return Array.isArray(entry?.colors) ? entry.colors : [];
    },

    async set(username, colors) {
      await resolveAdapter();
      const key = userKey(username);
      return adapter().palettes.put({ username: key, colors: colors.slice(-MAX_PALETTE) });
    },

    async delete(username) {
      await resolveAdapter();
      return adapter().palettes.delete(userKey(username));
    },
  },

  meta: {
    async get(key) {
      await resolveAdapter();
      return adapter().meta.get(key);
    },
    async set(key, value) {
      await resolveAdapter();
      return adapter().meta.put(key, value);
    },
  },
};

