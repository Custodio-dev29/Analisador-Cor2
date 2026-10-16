import { describe, it, expect, afterEach, vi } from 'vitest';
import { describeCameraError, isCameraSupported, stopCamera } from '../js/camera.js';

describe('describeCameraError', () => {
  it('explica permissao negada', () => {
    expect(describeCameraError({ name: 'NotAllowedError' })).toMatch(/permiss/i);
  });

  it('explica que nao ha camera no dispositivo', () => {
    expect(describeCameraError({ name: 'NotFoundError' })).toMatch(/nenhuma c[âa]mera/i);
  });

  it('explica que a camera esta em uso', () => {
    expect(describeCameraError({ name: 'NotReadableError' })).toMatch(/em uso/i);
  });

  it('explica configuracao nao suportada', () => {
    expect(describeCameraError({ name: 'OverconstrainedError' })).toMatch(/configura/i);
  });

  it('explica falta de suporte do navegador', () => {
    expect(describeCameraError({ name: 'NotSupportedError' })).toMatch(/HTTPS/i);
    expect(describeCameraError({ name: 'TypeError' })).toMatch(/HTTPS/i);
  });

  it('usa a mensagem original quando o erro e desconhecido', () => {
    expect(describeCameraError({ name: 'CoisaEstranha', message: 'detalhe cru' })).toBe('detalhe cru');
  });

  it('tem mensagem padrao sem erro', () => {
    expect(describeCameraError()).toMatch(/n[ãa]o foi poss[íi]vel/i);
  });
});

describe('isCameraSupported', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('e false sem mediaDevices', () => {
    vi.stubGlobal('navigator', {});
    expect(isCameraSupported()).toBe(false);
  });

  it('e false quando mediaDevices nao tem getUserMedia', () => {
    vi.stubGlobal('navigator', { mediaDevices: {} });
    expect(isCameraSupported()).toBe(false);
  });

  it('e true quando getUserMedia existe', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => {} } });
    expect(isCameraSupported()).toBe(true);
  });
});

describe('stopCamera', () => {
  it('para todas as trilhas', () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }, { stop }] };

    stopCamera(stream);

    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('tolera stream nulo ou sem getTracks', () => {
    expect(() => stopCamera(null)).not.toThrow();
    expect(() => stopCamera({})).not.toThrow();
    expect(() => stopCamera(undefined)).not.toThrow();
  });
});
