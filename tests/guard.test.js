import { describe, it, expect } from 'vitest';
import { describeContext } from '../js/guard.js';

/**
 * O caso que motivou esta funcao: abrir o app pelo IP da rede local. A tela
 * carrega, mas o navegador bloqueia a Web Crypto e o login falha sem explicar
 * o motivo. Aqui a mensagem precisa ser util, nao apenas existir.
 */
describe('describeContext', () => {
  const ambiente = (host, hasSubtle = true) => ({
    hostname: host,
    protocol: host.startsWith('localhost') || /^[\d.]+$/.test(host) ? 'http:' : 'https:',
    hasSubtle,
  });

  it('nao reclama quando a Web Crypto existe', () => {
    expect(describeContext(ambiente('192.168.0.10'))).toBeNull();
    expect(describeContext(ambiente('analisador.pages.dev'))).toBeNull();
  });

  it('reprova localhost sem Web Crypto, mas culpa o navegador', () => {
    // Sem Web Crypto o login falha em qualquer endereco, inclusive localhost.
    // O que muda em localhost e' a causa: nao e' a URL, e' o navegador.
    for (const host of ['localhost', '127.0.0.1', '[::1]', '::1', 'app.localhost']) {
      const problema = describeContext({ hostname: host, protocol: 'http:', hasSubtle: false });

      expect(problema).not.toBeNull();
      expect(problema.message).toContain('navegador');
      expect(problema.message).not.toContain('contexto seguro');
    }
  });

  it('reprova HTTPS sem Web Crypto, mas culpa o navegador', () => {
    const problema = describeContext({
      hostname: 'exemplo.pages.dev',
      protocol: 'https:',
      hasSubtle: false,
    });

    expect(problema).not.toBeNull();
    expect(problema.message).toContain('navegador');
    expect(problema.message).not.toContain('contexto seguro');
  });

  it('explica o problema ao abrir pelo IP da rede local', () => {
    const problema = describeContext({
      hostname: '192.168.0.10',
      protocol: 'http:',
      hasSubtle: false,
    });

    expect(problema).not.toBeNull();
    expect(problema.message).toContain('192.168.0.10');
    // A mensagem precisa apontar a solucao, nao softear o sintoma.
    expect(problema.message).toContain('localhost');
    expect(problema.message.toLowerCase()).toContain('https');
  });

  it('distingue navegador sem Web Crypto de URL insegura', () => {
    const problema = describeContext({
      hostname: 'exemplo.pages.dev',
      protocol: 'https:',
      hasSubtle: false,
    });

    expect(problema.message).toContain('navegador');
    expect(problema.message).not.toContain('contexto seguro');
  });

  it('nao acusa um host HTTPS de estar inseguro', () => {
    const problema = describeContext({
      hostname: '192.168.0.10',
      protocol: 'https:',
      hasSubtle: false,
    });

    // Com HTTPS o problema, se houver, e' do navegador, nao do endereco.
    expect(problema.message).not.toContain('192.168.0.10');
  });
});
