/**
 * Captura de imagem pela câmera.
 *
 * O app so usa a API de arquivo (<input type="file">). Aqui entra o caminho
 * de câmera ao vivo com getUserMedia. Nada de terceiros: o fluxo e' o mesmo do
 * upload — o frame capturado vira um File (PNG, sem perda) e segue para o
 * sampler, entao a medicao de cor nao sofre recompressao de JPEG.
 *
 * Restricao de ambiente: getUserMedia so existe em contexto seguro (HTTPS ou
 * localhost). Em HTTP pela rede local o navegador nem expoe `mediaDevices`.
 */

import { logger } from './logger.js';

/** Aponta para a camera traseira quando houver; senao o navegador escolhe. */
const DEFAULT_CONSTRAINTS = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: false,
};

/** @returns {boolean} true se a API de camera existe neste contexto. */
export function isCameraSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Traduz o erro do getUserMedia em uma mensagem acionavel.
 *
 * E' pura (nao toca no DOM) para poder ser testada.
 * @param {{name?: string, message?: string}} [error]
 * @returns {string}
 */
export function describeCameraError(error = {}) {
  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permissão de câmera negada. Permita o acesso à câmera nas configurações do navegador e tente de novo.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Nenhuma câmera foi encontrada neste dispositivo.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'A câmera está em uso por outro aplicativo. Feche-o e tente novamente.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'A câmera não suporta a configuração solicitada.';
    case 'AbortError':
      return 'A captura da câmera foi interrompida. Tente novamente.';
    case 'NotSupportedError':
    case 'TypeError':
      return 'Este navegador não expõe a câmera. Abra o app por HTTPS (ou localhost) em um navegador atualizado.';
    default:
      return error.message || 'Não foi possível acessar a câmera.';
  }
}

/**
 * Abre a câmera.
 *
 * Se a configuração "ideal" for recusada por ser restritiva demais
 * (OverconstrainedError), cai para o minimo `{ video: true }`.
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(constraints = DEFAULT_CONSTRAINTS) {
  if (!isCameraSupported()) {
    const error = new Error('A câmera exige HTTPS ou localhost.');
    error.name = 'NotSupportedError';
    throw error;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    logger.info('Câmera iniciada.');
    return stream;
  } catch (error) {
    if (error?.name === 'OverconstrainedError') {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      logger.info('Câmera iniciada (configuração básica).');
      return stream;
    }
    throw error;
  }
}

/**
 * Encerra todas as trilhas da câmera. Sem isto a luz da câmera continua acesa.
 * @param {MediaStream|null|undefined} stream
 */
export function stopCamera(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

/**
 * Congela o frame atual do video em um File PNG (sem perda).
 *
 * @param {HTMLVideoElement} video
 * @returns {Promise<File>}
 */
export function captureFrame(video) {
  return new Promise((resolve, reject) => {
    const width = video?.videoWidth;
    const height = video?.videoHeight;

    if (!width || !height) {
      reject(new Error('A câmera ainda não produziu uma imagem. Aguarde um instante e tente de novo.'));
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Não foi possível capturar a imagem da câmera.'));
        return;
      }

      resolve(new File([blob], `foto-camera-${Date.now()}.png`, {
        type: 'image/png',
        lastModified: Date.now(),
      }));
    }, 'image/png');
  });
}
