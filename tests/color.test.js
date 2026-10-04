import { describe, it, expect } from 'vitest';
import {
  srgbToLinear,
  linearToSrgb,
  rgbToLab,
  labToRgb,
  labToXyz,
  rgbToHex,
  hexToRgb,
  deltaE76,
  ciede2000,
  interpretDeltaE,
  makeColor,
  readableTextColor,
} from '../js/color.js';

/** Tolera arredondamento de ponto flutuante nas sweeps. */
const near = (value, expected, precision = 4) =>
  expect(value).toBeCloseTo(expected, precision);

describe('sRGB <-> linear', () => {
  it('aplica a curva correta nos pontos de ancoragem', () => {
    near(srgbToLinear(0), 0);
    near(srgbToLinear(1), 1);
    near(srgbToLinear(0.04045), 0.04045 / 12.92, 6);
    near(srgbToLinear(0.5), 0.21404114, 6);
  });

  it('e reversivel', () => {
    for (const v of [0, 0.01, 0.04, 0.2, 0.5, 0.9, 1]) {
      near(linearToSrgb(srgbToLinear(v)), v, 10);
    }
  });
});

describe('rgbToLab', () => {
  it('devolve L*=100 para branco puro', () => {
    const lab = rgbToLab(255, 255, 255);
    near(lab.l, 100, 3);
    near(lab.a, 0, 3);
    near(lab.b, 0, 3);
  });

  it('devolve L*=0 para preto puro', () => {
    const lab = rgbToLab(0, 0, 0);
    near(lab.l, 0, 6);
    near(lab.a, 0, 6);
    near(lab.b, 0, 6);
  });

  it('mantem a*=b*=0 em cinzas (eixo neutro)', () => {
    // A matriz sRGB de precisao estendida soma 1.0000001 na linha Y, o que
    // deixa um residual da ordem de 4e-6 no eixo neutro. Isso e irrelevante
    // para medicao de cor (o JND perceptivel e ~1.0), mas precisa ser
    // documentado como tolerancia conhecida.
    for (const v of [0, 32, 64, 128, 192, 255]) {
      const lab = rgbToLab(v, v, v);
      near(lab.a, 0, 4);
      near(lab.b, 0, 4);
    }
  });

  it('da L* monotonico ao longo da escala de cinzas', () => {
    const lightness = [0, 32, 64, 96, 128, 160, 192, 224, 255].map((v) => rgbToLab(v, v, v).l);
    for (let i = 1; i < lightness.length; i += 1) {
      expect(lightness[i]).toBeGreaterThan(lightness[i - 1]);
    }
    expect(lightness[0]).toBe(0);
    expect(lightness[8]).toBeCloseTo(100, 3);
  });

  it('produz a* positivo para vermelho e b* positivo para azul', () => {
    expect(rgbToLab(255, 0, 0).a).toBeGreaterThan(0);
    expect(rgbToLab(255, 0, 0).b).toBeGreaterThan(0);
    expect(rgbToLab(0, 0, 255).b).toBeLessThan(0);
  });

  it('bate com valores publicados de referencia', () => {
    // Valores de referencia widely citados para cores sRGB.
    near(rgbToLab(255, 255, 255).l, 100.000, 3);
    near(rgbToLab(0, 0, 0).l, 0.000, 3);
    const red = rgbToLab(255, 0, 0);
    near(red.l, 53.24, 2);
    near(red.a, 80.09, 2);
    near(red.b, 67.20, 2);
    const green = rgbToLab(0, 255, 0);
    near(green.l, 87.73, 2);
    near(green.a, -86.18, 2);
    near(green.b, 83.18, 2);
    const blue = rgbToLab(0, 0, 255);
    near(blue.l, 32.30, 2);
    near(blue.a, 79.19, 2);
    near(blue.b, -107.86, 2);
  });
});

describe('labToRgb (round-trip)', () => {
  it('preserva cores sRGB dentro da gamut', () => {
    const samples = [
      [0, 0, 0], [255, 255, 255], [128, 128, 128],
      [255, 0, 0], [0, 255, 0], [0, 0, 255],
      [12, 200, 77], [250, 128, 8], [77, 77, 200],
    ];
    for (const [r, g, b] of samples) {
      const back = labToRgb(rgbToLab(r, g, b));
      expect(Math.abs(back.r - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - b)).toBeLessThanOrEqual(1);
    }
  });

  it('recorta valores fora da gamut em vez de estourar o byte', () => {
    const rgb = labToRgb({ l: 120, a: 0, b: 0 });
    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
      expect(Number.isInteger(channel)).toBe(true);
    }
  });

  it('labToXyz(0,0,0) volta ao ponto negro D65', () => {
    const { x, y, z } = labToXyz(0, 0, 0);
    near(x, 0, 6);
    near(y, 0, 6);
    near(z, 0, 6);
  });
});

describe('hexToRgb / rgbToHex', () => {
  it('faz round-trip', () => {
    for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [18, 52, 86], [171, 205, 239]]) {
      expect(hexToRgb(rgbToHex(r, g, b))).toEqual({ r, g, b });
    }
  });

  it('aceita a forma curta e o prefixo ausente', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('abc')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('devolve null para entradas invalidas (barreira anti-XSS)', () => {
    const malicious = [
      '"><script>alert(1)</script>',
      'javascript:alert(1)',
      'red',
      '#ff',
      '#fffff',
      '#12345g',
      'rgb(1,2,3)',
      '',
      null,
      undefined,
      123,
      {},
      ['#ffffff'],
    ];
    for (const value of malicious) {
      expect(hexToRgb(value)).toBeNull();
    }
  });
});

describe('ciede2000', () => {
  // Pares de referencia publicados por Sharma, Wu & Dalal (2005),
  // "The CIEDE2000 Color-Difference Formula".
  const SHARMA = [
    [50.0000, 2.6772, -79.7751, 50.0000, 0.0000, -82.7485, 2.0425],
    [50.0000, 3.1571, -77.2803, 50.0000, 0.0000, -82.7485, 2.8615],
    [50.0000, 2.8361, -74.0200, 50.0000, 0.0000, -82.7485, 3.4412],
    [50.0000, -1.3802, -84.2814, 50.0000, 0.0000, -82.7485, 1.0000],
    [50.0000, -1.1848, -84.8006, 50.0000, 0.0000, -82.7485, 1.0000],
    [50.0000, -0.9009, -85.5211, 50.0000, 0.0000, -82.7485, 1.0000],
    [50.0000, 0.0000, 0.0000, 50.0000, -1.0000, 2.0000, 2.3669],
    [50.0000, -1.0000, 2.0000, 50.0000, 0.0000, 0.0000, 2.3669],
    [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0009, 7.1792],
    [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0010, 7.1792],
    [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0011, 7.2195],
    [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0012, 7.2195],
    [50.0000, -0.0010, 2.4900, 50.0000, 0.0009, -2.4900, 4.8045],
    [50.0000, -0.0010, 2.4900, 50.0000, 0.0010, -2.4900, 4.8045],
    [50.0000, -0.0010, 2.4900, 50.0000, 0.0011, -2.4900, 4.7461],
    [50.0000, 2.5000, 0.0000, 50.0000, 0.0000, -2.5000, 4.3065],
    [50.0000, 2.5000, 0.0000, 73.0000, 25.0000, -18.0000, 27.1492],
    [50.0000, 2.5000, 0.0000, 61.0000, -5.0000, 29.0000, 22.8977],
    [50.0000, 2.5000, 0.0000, 56.0000, -27.0000, -3.0000, 31.9030],
    [50.0000, 2.5000, 0.0000, 58.0000, 24.0000, 15.0000, 19.4535],
    [50.0000, 2.5000, 0.0000, 50.0000, 3.1736, 0.5854, 1.0000],
    [50.0000, 2.5000, 0.0000, 50.0000, 3.2972, 0.0000, 1.0000],
    [50.0000, 2.5000, 0.0000, 50.0000, 1.8634, 0.5757, 1.0000],
    [50.0000, 2.5000, 0.0000, 50.0000, 3.2592, 0.3350, 1.0000],
    [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
    [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.2630],
    [61.2901, 3.7196, -5.3901, 61.4292, 2.2480, -4.9620, 1.8731],
    [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
    [22.7233, 20.0904, -46.6940, 23.0331, 14.9730, -42.5619, 2.0373],
    [36.4612, 47.8580, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
    [90.8027, -2.0831, 1.4410, 91.1528, -1.6435, 0.0447, 1.4441],
    [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
    [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
    [2.0776, 0.0795, -1.1350, 0.9033, -0.0636, -0.5514, 0.9082],
  ];

  it.each(SHARMA.map((row, i) => [i + 1, row]))(
    'reproduz o par de referencia %i de Sharma',
    (_index, [l1, a1, b1, l2, a2, b2, expected]) => {
      const actual = ciede2000({ l: l1, a: a1, b: b1 }, { l: l2, a: a2, b: b2 });
      near(actual, expected, 4);
    },
  );

  it('e zero para cores identicas', () => {
    const lab = rgbToLab(120, 60, 200);
    near(ciede2000(lab, lab), 0, 10);
  });

  it('e simetrica', () => {
    const a = { l: 40, a: -12, b: 55 };
    const b = { l: 62, a: 24, b: -30 };
    near(ciede2000(a, b), ciede2000(b, a), 10);
  });

  it('e sempre nao-negativo', () => {
    const random = [
      [50, 2.6, -79.7], [0, 0, 0], [100, 0, 0], [55, -60, 40], [12, 3, -8],
    ];
    for (const x of random) {
      for (const y of random) {
        expect(ciede2000(
          { l: x[0], a: x[1], b: x[2] },
          { l: y[0], a: y[1], b: y[2] },
        )).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('respeita os parametros de ponderacao', () => {
    const a = { l: 50, a: 0, b: 0 };
    const b = { l: 60, a: 0, b: 0 };
    expect(ciede2000(a, b, { kL: 0.5 })).toBeGreaterThan(ciede2000(a, b));
  });

  it('difere de ΔE*ab nas regioes onde CIE76 erra (matiz azul)', () => {
    // Casos em que ΔE*ab superestima a diferenca perceptivel.
    const bluePairs = [
      [rgbToLab(0, 0, 255), rgbToLab(0, 20, 255)],
      [rgbToLab(10, 10, 250), rgbToLab(20, 30, 240)],
    ];
    for (const [a, b] of bluePairs) {
      expect(ciede2000(a, b)).not.toBeCloseTo(deltaE76(a, b), 2);
    }
  });

  it('distingue cores que o olho distingue (JND em torno de 1.0)', () => {
    const dE = ciede2000(rgbToLab(255, 0, 0), rgbToLab(254, 0, 0));
    expect(dE).toBeGreaterThan(0);
    expect(dE).toBeLessThan(1.5);
  });
});

describe('interpretDeltaE', () => {
  it('classifica nas faixas esperadas', () => {
    expect(interpretDeltaE(0.5).class).toBe('badge-imperceptible');
    expect(interpretDeltaE(1.5).class).toBe('badge-slight');
    expect(interpretDeltaE(3).class).toBe('badge-noticeable');
    expect(interpretDeltaE(4).class).toBe('badge-clear');
    expect(interpretDeltaE(8).class).toBe('badge-significant');
    expect(interpretDeltaE(40).class).toBe('badge-very-different');
  });

  it('respeita os limites exatos das faixas', () => {
    expect(interpretDeltaE(1).class).toBe('badge-slight');
    expect(interpretDeltaE(2).class).toBe('badge-noticeable');
    expect(interpretDeltaE(3.5).class).toBe('badge-clear');
    expect(interpretDeltaE(5).class).toBe('badge-significant');
    expect(interpretDeltaE(10).class).toBe('badge-very-different');
  });

  it('sempre devolve texto e classe', () => {
    for (const v of [0, 1.9, 4.9, 100]) {
      const result = interpretDeltaE(v);
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.class).toMatch(/^badge-[a-z-]+$/);
    }
  });
});

describe('makeColor', () => {
  it('monta um registro coerente', () => {
    const color = makeColor(18, 52, 86);
    expect(color.hex).toBe('#123456');
    expect(color.lab).toEqual(rgbToLab(18, 52, 86));
  });

  it('arredonda para bytes validos', () => {
    const color = makeColor(-20, 300, 128.7);
    expect(color.r).toBe(0);
    expect(color.g).toBe(255);
    expect(color.b).toBe(129);
  });
});

describe('readableTextColor', () => {
  it('usa texto escuro em fundo claro e claro em fundo escuro', () => {
    expect(readableTextColor({ r: 255, g: 255, b: 255 })).toBe('#1a1a1a');
    expect(readableTextColor({ r: 0, g: 0, b: 0 })).toBe('#ffffff');
  });
});