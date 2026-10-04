/**
 * Protecao de rotas, sessao e ambiente.
 *
 * Antes, cada pagina repetia um <script> inline no <head> que verificava o
 * sessionStorage e redirecionava. Isso causava um aviso de tela branca antes do
 * CSS aplicar, nao podia ser testado, e a verificacao real de perfil
 * administrador acontecia so depois da renderizacao. Aqui a verificacao e
 * assincrona (precisa do banco) e acontece antes de montar a pagina.
 */

import { currentUser, endSession } from './auth.js';
import { toast } from './toast.js';
import { storage } from './storage.js';

/**
 * Exige sessao valida. Redireciona e devolve null quando nao ha.
 * @param {{master?: boolean}} [options]
 * @returns {Promise<object|null>} o usuario, ou null se a navegacao foi cancelada.
 */
export async function requireAuth({ master = false } = {}) {
  let user = null;

  try {
    await storage.init();
    user = await currentUser();
  } catch {
    user = null;
  }

  if (!user) {
    window.location.replace('login.html');
    return null;
  }

  if (master && !user.isMaster) {
    toast.error('Acesso restrito ao administrador.');
    window.location.replace('index.html');
    return null;
  }

  return user;
}

/** Desloga e volta para a tela de login. */
export function logout() {
  endSession();
  window.location.href = 'login.html';
}

/** Liga o botao de saida, se existir na pagina. */
export function wireLogout() {
  const button = document.getElementById('logout-btn');
  button?.addEventListener('click', logout);
}

/**
 * Explica por que o ambiente nao serve, sem depender do DOM.
 *
 * `crypto.subtle` (usado no login) e Service Worker (offline e instalacao) so
 * existem em contexto seguro: HTTPS ou localhost. Abrir o app pelo IP da rede
 * local e' o caso comum, e o sintoma aparece tarde e confuso: a tela abre
 * normalmente e so o login falha, sem explicacao util.
 *
 * @param {{hostname: string, protocol: string, hasSubtle: boolean}} ambiente
 * @returns {null|{message:string}} null quando o ambiente serve.
 */
export function describeContext({ hostname, protocol, hasSubtle }) {
  if (hasSubtle) return null;

  const isLoopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
    || hostname.endsWith('.localhost');

  // HTTPS e' contexto seguro; se o Web Crypto falta mesmo assim, o problema e'
  // o navegador, nao a forma de servir o app.
  if (protocol === 'https:' || isLoopback) {
    return {
      message: 'Este navegador não expõe a Web Crypto, necessária para proteger a senha. '
        + 'Tente um navegador atualizado.',
    };
  }

  return {
    message: `Você abriu o app em ${protocol}//${hostname}, que não é um contexto seguro, `
      + 'então o navegador bloqueou a Web Crypto e o login não vai funcionar. '
      + 'No computador, abra em http://localhost. No celular, publique o app em um '
      + 'endereço HTTPS (Cloudflare Pages, Netlify ou GitHub Pages) e acesse por lá.',
  };
}

/** @returns {null|{message:string}} problema do ambiente atual, se houver. */
export function secureContextProblem() {
  return describeContext({
    hostname: window.location.hostname,
    protocol: window.location.protocol,
    hasSubtle: typeof globalThis.crypto?.subtle?.importKey === 'function',
  });
}

/**
 * Mostra o problema de ambiente: no bloco #context-warning, se a pagina tiver
 * um; senao, em um toast.
 * @returns {boolean} true se havia problema.
 */
export function warnInsecureContext() {
  const problem = secureContextProblem();
  if (!problem) return false;

  const host = document.getElementById('context-warning');
  if (host) {
    host.textContent = problem.message;
    host.hidden = false;
  } else {
    toast.error(problem.message);
  }

  return true;
}