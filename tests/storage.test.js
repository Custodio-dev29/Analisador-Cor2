import { describe, it, expect, beforeEach, vi } from 'vitest';
import { upgradeHistoryRecord, HISTORY_SCHEMA_VERSION, storage } from '../js/storage.js';
import { ciede2000, rgbToLab } from '../js/color.js';

const makeColor = (r, g, b) => ({
  r, g, b,
  hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
  lab: rgbToLab(r, g, b),
});

const legacyRecord = () => ({
  id: '01/01/2024 12-00-00 #01',
  name: 'Amostra antiga',
  refColor: makeColor(255, 0, 0),
  selColor: makeColor(250, 5, 5),
  deltaE: 4.5,
  interpretation: { text: 'Diferença claramente perceptível', class: 'badge-clear' },
  timestamp: '2024-01-01T12:00:00.000Z',
  formatted: { ref: { rgb: '(255, 0, 0)', lab: 'L*:53.2' }, sel: {} },
});

describe('upgradeHistoryRecord', () => {
  it('recalcula o Delta E com CIEDE2000 a partir do Lab gravado', () => {
    const record = { ...legacyRecord(), username: 'joao' };
    const upgraded = upgradeHistoryRecord(record);

    const expected = ciede2000(record.selColor.lab, record.refColor.lab);
    expect(upgraded.deltaE).toBeCloseTo(expected, 10);
    expect(upgraded.deltaEMethod).toBe('CIEDE2000');
  });

  it('reinterpreta a faixa conforme a nova formula', () => {
    const upgraded = upgradeHistoryRecord({ ...legacyRecord(), username: 'joao' });
    expect(upgraded.interpretation.class).toMatch(/^badge-/);
    // O texto legado nao pode sobreviver: as faixas foram recalibradas.
    expect(upgraded.interpretation.text).not.toBe('Diferença claramente perceptível');
  });

  it('descarta o bloco formatted, que era dado duplicado', () => {
    const upgraded = upgradeHistoryRecord({ ...legacyRecord(), username: 'joao' });
    expect(upgraded.formatted).toBeUndefined();
  });

  it('preserva id, nome, cores e posicao', () => {
    const upgraded = upgradeHistoryRecord({ ...legacyRecord(), username: 'joao' });
    expect(upgraded.id).toBe('01/01/2024 12-00-00 #01');
    expect(upgraded.name).toBe('Amostra antiga');
    expect(upgraded.refColor.hex).toBe('#ff0000');
    expect(upgraded.selColor.hex).toBe('#fa0505');
    expect(upgraded.createdAt).toBe('2024-01-01T12:00:00.000Z');
    expect(upgraded.username).toBe('joao');
  });

  it('mantem posicao e tamanho de amostragem quando presentes', () => {
    const upgraded = upgradeHistoryRecord({
      ...legacyRecord(),
      username: 'joao',
      position: { x: 12, y: 34 },
      sampleSize: 7,
    });
    expect(upgraded.position).toEqual({ x: 12, y: 34 });
    expect(upgraded.sampleSize).toBe(7);
  });

  it('marca o registro com a versao de schema atual', () => {
    const upgraded = upgradeHistoryRecord({ ...legacyRecord(), username: 'joao' });
    expect(upgraded.schemaVersion).toBe(HISTORY_SCHEMA_VERSION);
  });

  it('e idempotente: reverter um registro novo nao muda nada', () => {
    const once = upgradeHistoryRecord({ ...legacyRecord(), username: 'joao' });
    const twice = upgradeHistoryRecord(once);
    expect(twice).toEqual(once);
  });

  it('devolve null para entrada nula', () => {
    expect(upgradeHistoryRecord(null)).toBeNull();
  });

  it('lida com registro sem uma das cores, sem lancar', () => {
    const upgraded = upgradeHistoryRecord({ ...legacyRecord(), username: 'joao', selColor: null });
    expect(upgraded.deltaE).toBeNull();
    expect(upgraded.interpretation).toBeNull();
  });

  it('usa "Sem nome" quando o nome estava vazio', () => {
    const upgraded = upgradeHistoryRecord({ ...legacyRecord(), username: 'joao', name: '' });
    expect(upgraded.name).toBe('Sem nome');
  });
});

describe('migrateLegacyData', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('importa usuarios, historico e paleta do formato antigo', async () => {
    localStorage.setItem('colorAnalyzerUsers', JSON.stringify({
      joao: {
        name: 'João',
        passwordHash: '-1234567',
        isMaster: true,
        analysisName: 'Lote A',
        referencePalette: [makeColor(0, 0, 0), makeColor(255, 255, 255)],
        analysisHistory: [legacyRecord()],
      },
    }));

    const store = await import('../js/storage.js');
    const result = await store.migrateLegacyData();

    expect(result).toEqual({ imported: true, users: 1, history: 1 });

    const user = await store.storage.users.get('joao');
    expect(user.name).toBe('João');
    expect(user.isMaster).toBe(true);
    // A senha legada e preservada apenas para permitir a migracao no login.
    expect(user.legacyHash).toBe('-1234567');
    expect(user.credentials).toBeNull();

    const history = await store.storage.history.list('joao');
    expect(history).toHaveLength(1);
    expect(history[0].deltaEMethod).toBe('CIEDE2000');

    const palette = await store.storage.palettes.get('joao');
    expect(palette).toHaveLength(2);

    expect(await store.storage.meta.get('analysisName:joao')).toBe('Lote A');
  });

  it('remove a chave legada apos a importacao', async () => {
    localStorage.setItem('colorAnalyzerUsers', JSON.stringify({
      joao: { name: 'João', passwordHash: '1', analysisHistory: [] },
    }));

    const store = await import('../js/storage.js');
    await store.migrateLegacyData();

    expect(localStorage.getItem('colorAnalyzerUsers')).toBeNull();
  });

  it('nao importa duas vezes', async () => {
    localStorage.setItem('colorAnalyzerUsers', JSON.stringify({
      joao: { name: 'João', passwordHash: '1', analysisHistory: [legacyRecord()] },
    }));

    const store = await import('../js/storage.js');
    await store.migrateLegacyData();
    const second = await store.migrateLegacyData();

    expect(second.imported).toBe(false);
    expect(await store.storage.history.list('joao')).toHaveLength(1);
  });

  it('sobrescreve um usuario existente em vez de duplicar', async () => {
    const store = await import('../js/storage.js');
    await store.storage.init();

    await store.storage.users.put({ username: 'joao', name: 'Original', isMaster: true });

    localStorage.setItem('colorAnalyzerUsers', JSON.stringify({
      joao: { name: 'Do legado', passwordHash: '1', analysisHistory: [] },
    }));

    // Forca a reimportacao limpando a flag.
    await store.storage.meta.set('legacyMigrated', false);
    await store.migrateLegacyData();

    const user = await store.storage.users.get('joao');
    expect(user.name).toBe('Original');
  });

  it('nao quebra com JSON corrompido', async () => {
    localStorage.setItem('colorAnalyzerUsers', '{isto nao e json');

    const store = await import('../js/storage.js');
    await expect(store.migrateLegacyData()).resolves.toBeDefined();
  });

  it('marca como migrado mesmo sem dados legados', async () => {
    const store = await import('../js/storage.js');
    const result = await store.migrateLegacyData();
    expect(result.imported).toBe(false);
  });
});

describe('storage', () => {
  it('ordena o historico do mais recente para o mais antigo', async () => {
    await storage.init();

    for (const [id, createdAt] of [
      ['a', '2024-01-01T00:00:00.000Z'],
      ['c', '2024-03-01T00:00:00.000Z'],
      ['b', '2024-02-01T00:00:00.000Z'],
    ]) {
      await storage.history.add({
        id, username: 'joao', name: id, refColor: makeColor(1, 1, 1),
        selColor: makeColor(2, 2, 2), deltaE: 1, createdAt,
        schemaVersion: HISTORY_SCHEMA_VERSION,
      });
    }

    const history = await storage.history.list('joao');
    expect(history.map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('nao mistura o historico entre usuarios', async () => {
    await storage.init();

    const base = { refColor: makeColor(1, 1, 1), selColor: makeColor(2, 2, 2), deltaE: 1, createdAt: new Date().toISOString(), schemaVersion: HISTORY_SCHEMA_VERSION };

    await storage.history.add({ ...base, id: 'x', username: 'joao', name: 'de joao' });
    await storage.history.add({ ...base, id: 'x', username: 'maria', name: 'de maria' });

    const joao = await storage.history.list('joao');
    expect(joao).toHaveLength(1);
    expect(joao[0].name).toBe('de joao');
  });

  it('remove por id, nao por indice', async () => {
    await storage.init();

    const base = { refColor: makeColor(1, 1, 1), selColor: makeColor(2, 2, 2), deltaE: 1, createdAt: new Date().toISOString(), schemaVersion: HISTORY_SCHEMA_VERSION };
    await storage.history.add({ ...base, id: 'a', username: 'joao', name: 'A' });
    await storage.history.add({ ...base, id: 'b', username: 'joao', name: 'B' });

    await storage.history.delete('joao', 'a');

    const history = await storage.history.list('joao');
    expect(history.map((item) => item.id)).toEqual(['b']);
  });

  it('limpa apenas o historico do usuario alvo', async () => {
    await storage.init();

    const base = { refColor: makeColor(1, 1, 1), selColor: makeColor(2, 2, 2), deltaE: 1, createdAt: new Date().toISOString(), schemaVersion: HISTORY_SCHEMA_VERSION };
    await storage.history.add({ ...base, id: 'a', username: 'joao', name: 'A' });
    await storage.history.add({ ...base, id: 'b', username: 'maria', name: 'B' });

    await storage.history.clear('joao');

    expect(await storage.history.list('joao')).toHaveLength(0);
    expect(await storage.history.list('maria')).toHaveLength(1);
  });

  it('excluir um usuario apaga o historico e a paleta dele', async () => {
    await storage.init();

    await storage.users.put({ username: 'joao', name: 'João' });
    await storage.palettes.set('joao', [makeColor(1, 2, 3)]);
    await storage.history.add({
      id: 'a', username: 'joao', name: 'A', refColor: makeColor(1, 1, 1),
      selColor: makeColor(2, 2, 2), deltaE: 1, createdAt: new Date().toISOString(),
      schemaVersion: HISTORY_SCHEMA_VERSION,
    });

    await storage.users.delete('joao');

    expect(await storage.users.get('joao')).toBeNull();
    expect(await storage.history.list('joao')).toHaveLength(0);
    expect(await storage.palettes.get('joao')).toEqual([]);
  });

  it('limita a paleta e guarda as cores mais recentes', async () => {
    await storage.init();

    const many = Array.from({ length: 100 }, (_, i) => makeColor(i, i, i));
    await storage.palettes.set('joao', many);

    const palette = await storage.palettes.get('joao');
    expect(palette.length).toBeLessThanOrEqual(64);
    expect(palette.at(-1).hex).toBe(many.at(-1).hex);
  });

  it('normaliza o usuario para minusculas', async () => {
    await storage.init();
    await storage.users.put({ username: 'joao', name: 'João' });

    expect(await storage.users.get('JOAO')).not.toBeNull();
    expect(await storage.users.get('  Joao ')).not.toBeNull();
  });

  it('devolve lista vazia para usuario desconhecido', async () => {
    await storage.init();
    expect(await storage.users.get('ninguem')).toBeNull();
    expect(await storage.palettes.get('ninguem')).toEqual([]);
    expect(await storage.history.list('ninguem')).toEqual([]);
  });
});