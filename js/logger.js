/**
 * Logger com gate de debug. Em producao so warn/error aparecem no console;
 * para ver os logs de depuracao, abra a pagina com ?debug.
 */

const hasLocation = typeof location !== 'undefined';
const DEBUG = hasLocation && new URLSearchParams(location.search).has('debug');

const prefix = '[analisador]';

export const logger = {
  debug(...args) {
    if (DEBUG) console.debug(prefix, ...args);
  },
  info(...args) {
    if (DEBUG) console.info(prefix, ...args);
  },
  warn(...args) {
    console.warn(prefix, ...args);
  },
  error(...args) {
    console.error(prefix, ...args);
  },
};

export const isDebug = DEBUG;