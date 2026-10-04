import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { closeDatabase } from '../js/storage.js';

const DB_NAME = 'analisador-cores';

/** Storage Web em memória, suficiente para o código sob teste. */
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get length() {
    return this.map.size;
  }

  key(index) {
    return [...this.map.keys()][index] ?? null;
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();

beforeEach(async () => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();

  // O IndexedDB falso e' processo-wide e sobrevive entre testes, o que faria
  // os dados vazarem de um teste para o seguinte.
  await closeDatabase();
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });
});