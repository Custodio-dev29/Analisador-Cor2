/**
 * Utilitarios de cor. Modulo puro (sem DOM), coberto por testes.
 *
 * Referencia: CIELAB sob iluminante D65 (2 graus), com a matriz sRGB de
 * precisao estendida. A comparacao entre cores usa CIEDE2000, que e o
 * metodo atualmente recomendado (CIE 142-2001) por corrigir as falhas de
 * ΔE*ab (CIE76) nas regioes de baixo croma e de matiz azul.
 */

const D65 = Object.freeze({ X: 95.047, Y: 100.0, Z: 108.883 });

// ε^3 = 216/24389 ≈ 0.008856 ; κ = (29/3)^3 = 24389/27 ≈ 903.2963
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

// Fatores de luminancia relativa sRGB -> XYZ (matriz sRGB de precisao estendida).
const M_XYZ_FROM_RGB = Object.freeze([
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.0721750,
  0.0193339, 0.1191920, 0.9503041,
]);

// Fatores chromaticos RGB (linear) -> XYZ (matriz inversa).
const M_RGB_FROM_XYZ = Object.freeze([
  3.2404542, -1.5371385, -0.4985314,
  -0.9692660, 1.8760108, 0.0415560,
  0.0556434, -0.2040259, 1.0572252,
]);

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
const clamp01 = (v) => clamp(v, 0, 1);
const toByte = (v) => clamp(Math.round(v), 0, 255);

/** Funcao de transferencia sRGB -> linear (des-gamma). */
export function srgbToLinear(channel) {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Funcao de transferencia linear -> sRGB (gamma). */
export function linearToSrgb(channel) {
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

/** XYZ (0-100) -> CIELAB D65. */
export function xyzToLab(x, y, z) {
  const fx = x / D65.X;
  const fy = y / D65.Y;
  const fz = z / D65.Z;

  const f = (t) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
  const gx = f(fx);
  const gy = f(fy);
  const gz = f(fz);

  return {
    l: 116 * gy - 16,
    a: 500 * (gx - gy),
    b: 200 * (gy - gz),
  };
}

/** CIELAB D65 -> XYZ (0-100). */
export function labToXyz(l, a, b) {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const inv = (t) => {
    const t3 = t * t * t;
    return t3 > EPSILON ? t3 : (116 * t - 16) / KAPPA;
  };

  return { x: inv(fx) * D65.X, y: inv(fy) * D65.Y, z: inv(fz) * D65.Z };
}

/**
 * RGB (0-255, sRGB) -> CIELAB D65.
 * @param {{r:number,g:number,b:number}|number} rgbOrR
 */
export function rgbToLab(rgbOrR, g, b) {
  const { r, g: gg, b: bb } = typeof rgbOrR === 'object' && rgbOrR !== null
    ? rgbOrR
    : { r: rgbOrR, g, b };

  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(gg / 255);
  const lb = srgbToLinear(bb / 255);

  return xyzToLab(
    (M_XYZ_FROM_RGB[0] * lr + M_XYZ_FROM_RGB[1] * lg + M_XYZ_FROM_RGB[2] * lb) * 100,
    (M_XYZ_FROM_RGB[3] * lr + M_XYZ_FROM_RGB[4] * lg + M_XYZ_FROM_RGB[5] * lb) * 100,
    (M_XYZ_FROM_RGB[6] * lr + M_XYZ_FROM_RGB[7] * lg + M_XYZ_FROM_RGB[8] * lb) * 100,
  );
}

/**
 * CIELAB D65 -> RGB (0-255, sRGB). Valores fora da gamut sao recortados.
 * @param {{l:number,a:number,b:number}} lab
 */
export function labToRgb(lab) {
  const { x, y, z } = labToXyz(lab.l, lab.a, lab.b);

  const lr = M_RGB_FROM_XYZ[0] * x + M_RGB_FROM_XYZ[1] * y + M_RGB_FROM_XYZ[2] * z;
  const lg = M_RGB_FROM_XYZ[3] * x + M_RGB_FROM_XYZ[4] * y + M_RGB_FROM_XYZ[5] * z;
  const lb = M_RGB_FROM_XYZ[6] * x + M_RGB_FROM_XYZ[7] * y + M_RGB_FROM_XYZ[8] * z;

  return {
    r: toByte(clamp01(linearToSrgb(lr / 100)) * 255),
    g: toByte(clamp01(linearToSrgb(lg / 100)) * 255),
    b: toByte(clamp01(linearToSrgb(lb / 100)) * 255),
  };
}

/** RGB (0-255) -> "#rrggbb". */
export function rgbToHex(r, g, b) {
  const hex = (v) => toByte(v).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * "#rgb", "#rrggbb" ou "rrggbb" -> {r,g,b}.
 * Retorna null para qualquer entrada invalida — use como validador antes de
 * injetar o valor em um atributo style ou em uma URL.
 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;

  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;

  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** ΔE*ab (CIE76) — mantido apenas para interpretar dados gravados por versoes antigas. */
export function deltaE76(lab1, lab2) {
  const dl = lab1.l - lab2.l;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

/**
 * CIEDE2000 (CIE 142-2001).
 * Retorna a diferenca perceptual entre dois pares CIELAB.
 * ~1.0 equivale ao limiar de diferenca perceptivel (JND).
 *
 * @param {{l:number,a:number,b:number}} lab1
 * @param {{l:number,a:number,b:number}} lab2
 * @param {{kL?:number,kC?:number,kH?:number}} [weights] parametros ponderados
 */
export function ciede2000(lab1, lab2, weights = {}) {
  const { kL = 1, kC = 1, kH = 1 } = weights;

  const { l: L1, a: a1, b: b1 } = lab1;
  const { l: L2, a: a2, b: b2 } = lab2;

  // 1) Croma
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const CBar = (C1 + C2) / 2;

  const CBar7 = Math.pow(CBar, 7);
  const G = 0.5 * (1 - Math.sqrt(CBar7 / (CBar7 + 6103515625))); // 25^7 = 6103515625

  // 2) Croma e matiz corrigidos
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const hue = (b, ap) => {
    if (Math.abs(ap) < 1e-12 && Math.abs(b) < 1e-12) return 0;
    const h = Math.atan2(b, ap) * DEG;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  // 3) Diferencas
  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

  // 4) Medias
  const LBarP = (L1 + L2) / 2;
  const CBarP = (C1p + C2p) / 2;

  let hBarP;
  if (C1p * C2p === 0) {
    hBarP = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarP = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hBarP = (h1p + h2p + 360) / 2;
  } else {
    hBarP = (h1p + h2p - 360) / 2;
  }

  // 5) Fatores de ponderacao
  const T = 1
    - 0.17 * Math.cos((hBarP - 30) * RAD)
    + 0.24 * Math.cos(2 * hBarP * RAD)
    + 0.32 * Math.cos((3 * hBarP + 6) * RAD)
    - 0.20 * Math.cos((4 * hBarP - 63) * RAD);

  const dTheta = 30 * Math.exp(-Math.pow((hBarP - 275) / 25, 2));
  const CBarP7 = Math.pow(CBarP, 7);
  const RC = 2 * Math.sqrt(CBarP7 / (CBarP7 + 6103515625));
  const SL = 1 + (0.015 * Math.pow(LBarP - 50, 2)) / Math.sqrt(20 + Math.pow(LBarP - 50, 2));
  const SC = 1 + 0.045 * CBarP;
  const SH = 1 + 0.015 * CBarP * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;

  const termL = dLp / (kL * SL);
  const termC = dCp / (kC * SC);
  const termH = dHp / (kH * SH);

  return Math.sqrt(
    termL * termL + termC * termC + termH * termH + RT * termC * termH,
  );
}

/**
 * Faixas de interpretacao calibradas para CIEDE2000.
 * 1.0 ≈ JND perceptivel; 5.0 ≈ claramente notavel.
 */
export function interpretDeltaE(deltaE) {
  if (deltaE < 1) {
    return { text: 'Diferença imperceptível', class: 'badge-imperceptible' };
  }
  if (deltaE < 2) {
    return { text: 'Perceptível apenas em observação atenta', class: 'badge-slight' };
  }
  if (deltaE < 3.5) {
    return { text: 'Perceptível de relance', class: 'badge-noticeable' };
  }
  if (deltaE < 5) {
    return { text: 'Diferença notável', class: 'badge-clear' };
  }
  if (deltaE < 10) {
    return { text: 'Diferença significativa', class: 'badge-significant' };
  }
  return { text: 'Cores muito diferentes', class: 'badge-very-different' };
}

/** Monta um registro de cor completo (RGB + HEX + Lab). */
export function makeColor(r, g, b) {
  return {
    r: toByte(r),
    g: toByte(g),
    b: toByte(b),
    hex: rgbToHex(r, g, b),
    lab: rgbToLab(r, g, b),
  };
}

/** "(r, g, b)" */
export function formatRgb(color) {
  return `(${color.r}, ${color.g}, ${color.b})`;
}

/** "L*:50.0 a*:2.7 b*:-79.8" */
export function formatLab(lab) {
  return `L*:${lab.l.toFixed(1)} a*:${lab.a.toFixed(1)} b*:${lab.b.toFixed(1)}`;
}

/**
 * Luminancia perceived (0-1) para contraste de UI.
 * Usa WCAG 2.x, que pondera em espaco linear e nao a luminance NTSC.
 */
export function relativeLuminance(rgb) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

/** Escolhe texto claro ou escuro sobre um fundo, conforme WCAG 2.x. */
export function readableTextColor(rgb) {
  return relativeLuminance(rgb) > 0.179 ? '#1a1a1a' : '#ffffff';
}