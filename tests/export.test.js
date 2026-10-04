import { describe, it, expect } from 'vitest';
import { historyToRows, toCsv } from '../js/export.js';
import { rgbToLab, ciede2000, interpretDeltaE } from '../js/color.js';

const makeColor = (r, g, b) => {
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return { r, g, b, hex, lab: rgbToLab(r, g, b) };
};

const makeRecord = (overrides = {}) => {
  const refColor = makeColor(255, 0, 0);
  const selColor = makeColor(250, 5, 5);
  const deltaE = ciede2000(selColor.lab, refColor.lab);

  return {
    id: 'abc',
    name: 'Amostra 1',
    refColor,
    selColor,
    deltaE,
    interpretation: interpretDeltaE(deltaE),
    sampleSize: 5,
    position: { x: 10, y: 20 },
    createdAt: '2024-01-01T12:00:00.000Z',
    schemaVersion: 2,
    ...overrides,
  };
};

describe('historyToRows', () => {
  it('achata o registro em colunas legiveis', () => {
    const [row] = historyToRows([makeRecord()]);

    expect(row['Nome da Amostra']).toBe('Amostra 1');
    expect(row['Ref HEX']).toBe('#FF0000');
    expect(row['Sel HEX']).toBe('#FA0505');
    expect(row['Ref RGB']).toBe('(255,0,0)');
    expect(row['Posição X']).toBe(10);
    expect(row['Amostragem']).toBe('5x5');
  });

  it('nomeia a coluna de Delta E com o metodo usado', () => {
    const [row] = historyToRows([makeRecord()]);
    expect(row).toHaveProperty('Delta E 2000');
  });

  it('usa "Sem nome" quando o nome esta vazio', () => {
    const [row] = historyToRows([makeRecord({ name: '' })]);
    expect(row['Nome da Amostra']).toBe('Sem nome');
  });

  it('lida com registro sem posicao salva', () => {
    const [row] = historyToRows([makeRecord({ position: null })]);
    expect(row['Posição X']).toBe('');
    expect(row['Posição Y']).toBe('');
  });

  it('nao lanca com cores incompletas', () => {
    const [row] = historyToRows([makeRecord({ selColor: null })]);
    expect(row['Sel HEX']).toBe('');
  });

  it('mantem a ordem das colunas em todos os registros', () => {
    const rows = historyToRows([makeRecord(), makeRecord({ name: 'Outra' })]);
    expect(Object.keys(rows[0])).toEqual(Object.keys(rows[1]));
  });
});

describe('toCsv', () => {
  it('comeca com BOM para o Excel reconhecer UTF-8', () => {
    expect(toCsv(historyToRows([makeRecord()]))).toMatch(/^\uFEFF/);
  });

  it('usa ponto e virgula, o separador esperado pelo Excel pt-BR', () => {
    const csv = toCsv(historyToRows([makeRecord()]));
    const header = csv.split('\r\n')[0];
    expect(header).toContain(';');
    expect(header).not.toContain(',');
  });

  it('usa CRLF como quebra de linha', () => {
    const csv = toCsv(historyToRows([makeRecord()]));
    expect(csv).toContain('\r\n');
  });

  it('gera uma linha por registro, mais o cabecalho', () => {
    const rows = historyToRows([makeRecord(), makeRecord(), makeRecord()]);
    const lines = toCsv(rows).replace('\uFEFF', '').trim().split('\r\n');
    expect(lines).toHaveLength(4);
  });

  it('devolve string vazia para historico vazio', () => {
    expect(toCsv([])).toBe('');
  });

it('escapa aspas duplas e quebra linhas vindas do usuario', () => {
    const csv = toCsv(historyToRows([makeRecord({ name: 'Aspa "e" quebra' })]));

    // Aspas duplas duplicadas, conforme RFC 4180.
    expect(csv).toContain('"Aspa ""e"" quebra"');
  });

it('mantem o campo entre aspas quando o texto tem quebra de linha', () => {
    // RFC 4180 permite quebra de linha dentro de um campo entre aspas; um
    // parser de CSV correto le como um unico valor. Em um <input type="text">
    // isso nao ocorre por digitacao, mas a funcao precisa ser correta.
    const csv = toCsv(historyToRows([makeRecord({ name: 'linha1\nlinha2' })]));

    expect(csv).toContain('"linha1\nlinha2"');
  });

it('coloca entre aspas o valor que contem o separador', () => {
    const csv = toCsv(historyToRows([makeRecord({ name: 'Lote; lote 2' })]));
    expect(csv).toContain('"Lote; lote 2"');
  });

it('neutraliza formula do Excel em texto livre', () => {
    // Sem o prefixo, "=1+1" viraria uma conta ao abrir no Excel.
    const csv = toCsv(historyToRows([makeRecord({ name: '=1+1' })]));

    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/;=1\+1/);
  });

it('neutraliza os outros prefixos de formula', () => {
    for (const attempt of ['+SUM(A1)', '-2+3', '@importe()']) {
      const csv = toCsv(historyToRows([makeRecord({ name: attempt })]));
      expect(csv).toContain(`'${attempt}`);
    }
  });

it('nao prefixa valores numericos legitimanente negativos', () => {
    // a* e b* podem ser negativos; prefixar quebraria o dado no Excel.
    const csv = toCsv(historyToRows([makeRecord()]));
    const row = csv.replace('\uFEFF', '').split('\r\n')[1];
    const cells = row.split(';');

    expect(cells.some((cell) => cell.startsWith("'-"))).toBe(false);
  });

  it('preserva os digitos do Delta E com 3 casas', () => {
    const csv = toCsv(historyToRows([makeRecord()]));
    expect(csv).toMatch(/\d\.\d{3}/);
  });
});