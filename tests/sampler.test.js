import { describe, it, expect } from 'vitest';
import { averageRegion, fitWithinBudget, MAX_BUFFER_PIXELS } from '../js/sampler.js';

/** Constroi um ImageData-ish a partir de [r,g,b,a]tuplas. */
const pixels = (...tuples) => ({
  data: Uint8ClampedArray.from(tuples.flat()),
});

describe('averageRegion', () => {
  it('calcula a media simples de uma regiao opaca', () => {
    const region = pixels(
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
    );

    expect(averageRegion(region)).toEqual({ r: 85, g: 85, b: 85 });
  });

  it('ignora pixels totalmente transparentes em vez de conta-los como preto', () => {
    // Sem o ponderamento por alpha, os dois pixels transparentes puxariam a
    // media para preto e o resultado seria (34, 34, 34).
    const region = pixels(
      [200, 100, 50, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    );

    expect(averageRegion(region)).toEqual({ r: 200, g: 100, b: 50 });
  });

  it('pondera por alpha parcial', () => {
    const region = pixels(
      [255, 255, 255, 255],
      [0, 0, 0, 128],
    );

    // Media ponderada: branco com peso 1, preto com peso 128/255 ≈ 0.502.
    // 255 / (1 + 0.502) ≈ 169.8 -> 170.
    expect(averageRegion(region)).toEqual({ r: 170, g: 170, b: 170 });
  });

  it('devolve null para regiao 100% transparente', () => {
    const region = pixels([0, 0, 0, 0], [10, 20, 30, 0]);
    expect(averageRegion(region)).toBeNull();
  });

  it('devolve null para regiao vazia', () => {
    expect(averageRegion({ data: new Uint8ClampedArray(0) })).toBeNull();
  });

  it('preserva um unico pixel exato', () => {
    const region = pixels([17, 34, 51, 255]);
    expect(averageRegion(region)).toEqual({ r: 17, g: 34, b: 51 });
  });

  it('arredonda para o byte mais proximo', () => {
    // 1 e 2 daria 1.5 -> 2 (Math.round).
    const region = pixels([1, 1, 1, 255], [2, 2, 2, 255]);
    expect(averageRegion(region)).toEqual({ r: 2, g: 2, b: 2 });
  });

  it('nunca devolve canal fora de 0-255', () => {
    const region = pixels([255, 255, 255, 255], [255, 255, 255, 255]);
    const result = averageRegion(region);
    for (const channel of [result.r, result.g, result.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});

describe('fitWithinBudget', () => {
  it('nao reduz imagens pequenas', () => {
    const result = fitWithinBudget(800, 600);
    expect(result).toEqual({ width: 800, height: 600, reduced: false });
  });

  it('nao reduz imagens exatamente no limite', () => {
    const side = Math.sqrt(MAX_BUFFER_PIXELS);
    const result = fitWithinBudget(Math.floor(side), Math.floor(side));
    expect(result.reduced).toBe(false);
  });

  it('reduz imagens grandes e respeita o orcamento de pixels', () => {
    const result = fitWithinBudget(12000, 8000);
    expect(result.reduced).toBe(true);
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_BUFFER_PIXELS);
  });

  it('preserva a proporcao da imagem ao reduzir', () => {
    const result = fitWithinBudget(12000, 8000);
    expect(result.width / result.height).toBeCloseTo(12000 / 8000, 1);
  });

  it('respeita o teto de dimensao mesmo com o orcamento de pixels folgado', () => {
    const result = fitWithinBudget(20000, 100, 1e12, 6000);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(6000);
  });

  it('nunca devolve dimensao zero', () => {
    const result = fitWithinBudget(1, 1);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('uma foto grande de celular fica dentro do orcamento', () => {
    // 108 MP: exceede o orcamento e precisa ser reduzida.
    const result = fitWithinBudget(12000, 9000);
    expect(result.reduced).toBe(true);
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_BUFFER_PIXELS);
  });
});