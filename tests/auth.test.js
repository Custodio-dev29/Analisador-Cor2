import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
register,
  login,
  setPassword,
currentUser,
  endSession,
  startSession,
  legacyHash,
  normalizeUsername,
  validateUsername,
  validatePassword,
  deleteUser,
  isCryptoAvailable,
  MIN_PASSWORD_LENGTH,
} from '../js/auth.js';
import { storage } from '../js/storage.js';

beforeEach(async () => {
  vi.resetModules();
  await storage.init();
});

describe('isCryptoAvailable', () => {
  it('encontra Web Crypto no ambiente de teste', () => {
    expect(isCryptoAvailable()).toBe(true);
  });
});

describe('validateUsername', () => {
  it('aceita usuarios validos', () => {
    for (const name of ['joao', 'joao.silva', 'joao_silva', 'user-01', 'abc']) {
      expect(validateUsername(name)).toBeNull();
    }
  });

  it('normaliza para minusculas antes de validar', () => {
    expect(validateUsername('  Joao  ')).toBeNull();
    expect(normalizeUsername('  Joao  ')).toBe('joao');
  });

  it('rejeita nomes curtos demais', () => {
    expect(validateUsername('ab')).toMatch(/3 a 32/);
  });

  it('rejeita caracteres fora do conjunto permitido', () => {
    for (const name of ['joao silva', 'joao@x', 'joão', 'joao/senha', '<script>']) {
      expect(validateUsername(name)).toMatch(/3 a 32/);
    }
  });

  it('rejeita vazio e nao-string', () => {
    expect(validateUsername('')).toBeTruthy();
    expect(validateUsername(null)).toBeTruthy();
    expect(validateUsername(undefined)).toBeTruthy();
  });

  it('rejeita nomes acima de 32 caracteres', () => {
    expect(validateUsername('a'.repeat(33))).toBeTruthy();
  });
});

describe('validatePassword', () => {
  it('exige o minimo definido', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/mínimo/);
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it('rejeita senha absurdamente longa', () => {
    expect(validatePassword('a'.repeat(500))).toMatch(/máximo/);
  });
});

describe('legacyHash', () => {
  it('mantem o algoritmo da v1, para conseguir validar senhas antigas', () => {
    // Valores conferidos a mao contra o algoritmo original (hash de 32 bits):
    //   hash = ((hash << 5) - hash) + charCode, com hash |= 0 a cada passo.
    expect(legacyHash('')).toBe('0');
    expect(legacyHash('a')).toBe('97');
    expect(legacyHash('abc')).toBe('96354');
  });

  it('produz o mesmo resultado para a mesma entrada', () => {
    expect(legacyHash('senha123')).toBe(legacyHash('senha123'));
  });

  it('separa entradas diferentes', () => {
    expect(legacyHash('senha123')).not.toBe(legacyHash('senha124'));
  });

  it('e determinístico e sem dependencia de Web Crypto', () => {
    //-importava um numero negativo: o bitwise not forca o sinal.
    expect(legacyHash('averyveryverylongpassword')).toMatch(/^-?\d+$/);
  });
});

describe('register', () => {
  it('cria o primeiro usuario como administrador', async () => {
    const result = await register({ name: 'João', username: 'joao', password: 'senha-secreta' });

    expect(result.ok).toBe(true);
    expect(result.user.isMaster).toBe(true);
  });

  it('nao da administrador a usuarios posteriores', async () => {
    await register({ name: 'João', username: 'joao', password: 'senha-secreta' });
    const result = await register({ name: 'Maria', username: 'maria', password: 'outra-senha' });

    expect(result.ok).toBe(true);
    expect(result.user.isMaster).toBe(false);
  });

  it('nunca grava a senha em texto legivel', async () => {
    await register({ name: 'João', username: 'joao', password: 'senha-secreta' });
    const user = await storage.users.get('joao');

    const serialized = JSON.stringify(user);
    expect(serialized).not.toContain('senha-secreta');
    expect(user.credentials.algo).toBe('PBKDF2-HMAC-SHA256');
    expect(user.credentials.iterations).toBeGreaterThanOrEqual(210000);
    expect(user.credentials.salt).toBeTruthy();
    expect(user.credentials.hash).toBeTruthy();
  });

  it('gera salt diferente para usuarios com a mesma senha', async () => {
    await register({ name: 'A', username: 'aaa', password: 'mesma-senha' });
    await register({ name: 'B', username: 'bbb', password: 'mesma-senha' });

    const first = await storage.users.get('aaa');
    const second = await storage.users.get('bbb');

    expect(first.credentials.salt).not.toBe(second.credentials.salt);
    expect(first.credentials.hash).not.toBe(second.credentials.hash);
  });

  it('rejeita usuario duplicado', async () => {
    await register({ name: 'João', username: 'joao', password: 'senha-secreta' });
    const result = await register({ name: 'Outro', username: 'joao', password: 'outra-senha' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/já está em uso/);
  });

  it('rejeita username invalido', async () => {
    const result = await register({ name: 'João', username: 'a b', password: 'senha-secreta' });
    expect(result.ok).toBe(false);
  });

  it('rejeita senha curta', async () => {
    const result = await register({ name: 'João', username: 'joao', password: '123' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/mínimo/);
  });

  it('rejeita nome vazio', async () => {
    const result = await register({ name: '   ', username: 'joao', password: 'senha-secreta' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nome/i);
  });

  it('normaliza o username gravado', async () => {
    await register({ name: 'João', username: '  Joao  ', password: 'senha-secreta' });
    expect(await storage.users.get('joao')).not.toBeNull();
  });
});

describe('login', () => {
  beforeEach(async () => {
    await register({ name: 'João', username: 'joao', password: 'senha-secreta' });
  });

  it('autentica com a senha correta', async () => {
    const result = await login('joao', 'senha-secreta');
    expect(result.ok).toBe(true);
    expect(result.user.username).toBe('joao');
  });

  it('autentica ignorando maiusculas no usuario', async () => {
    expect((await login('JOAO', 'senha-secreta')).ok).toBe(true);
  });

  it('rejeita senha errada', async () => {
    const result = await login('joao', 'senha-errada');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/inválidos/);
  });

  it('rejeita usuario inexistente com a mesma mensagem', async () => {
    const result = await login('ninguem', 'senha-secreta');
    expect(result.ok).toBe(false);
    // A mensagem nao revela se o usuario existe.
    expect(result.error).toMatch(/inválidos/);
  });

  it('abre sessao e a currentUser a enxerga', async () => {
    await login('joao', 'senha-secreta');
    const user = await currentUser();

    expect(user.username).toBe('joao');
    expect(user.isMaster).toBe(true);
  });

  it('devolve null sem sessao', async () => {
    expect(await currentUser()).toBeNull();
  });

  it('a sessao nao concede perfil de administrador por edicao', async () => {
    // Alguem forja uma sessao apontando para o proprio nome.
    sessionStorage.setItem('analisador-cores:sessao', JSON.stringify({ username: 'maria' }));

    // "maria" nao existe, entao nao ha usuario.
    expect(await currentUser()).toBeNull();
  });

  it('o papel de administrador vem do banco, nao do sessionStorage', async () => {
    await login('joao', 'senha-secreta');

    // O storage da sessao so guarda o username; isMaster nunca e lido de la.
    const raw = sessionStorage.getItem('analisador-cores:sessao');
    expect(JSON.parse(raw)).not.toHaveProperty('isMaster');
  });

  it('encerra a sessao apos o usuario ser excluido do banco', async () => {
    await login('joao', 'senha-secreta');
    await storage.users.delete('joao');

    expect(await currentUser()).toBeNull();
    expect(sessionStorage.getItem('analisador-cores:sessao')).toBeNull();
  });

it('endSession limpa a sessao', async () => {
    await login('joao', 'senha-secreta');
    expect(await currentUser()).not.toBeNull();

    endSession();

    expect(await currentUser()).toBeNull();
    expect(sessionStorage.getItem('analisador-cores:sessao')).toBeNull();
  });

  it('rejeita campos vazios sem tocar o banco', async () => {
    expect((await login('', '')).ok).toBe(false);
    expect((await login('joao', '')).ok).toBe(false);
  });
});

describe('migracao transparente do hash legado', () => {
  it('aceita a senha antiga e converte para PBKDF2', async () => {
    await storage.users.put({
      username: 'antigo',
      name: 'Antigo',
      credentials: null,
      legacyHash: legacyHash('senha-antiga'),
      isMaster: false,
      createdAt: new Date().toISOString(),
    });

    const result = await login('antigo', 'senha-antiga');
    expect(result.ok).toBe(true);

    const user = await storage.users.get('antigo');
    expect(user.credentials).not.toBeNull();
    expect(user.credentials.algo).toBe('PBKDF2-HMAC-SHA256');
    expect(user.legacyHash).toBeUndefined();
  });

  it('rejeita senha errada em registro legado', async () => {
    await storage.users.put({
      username: 'antigo', name: 'Antigo', credentials: null,
      legacyHash: legacyHash('senha-antiga'), isMaster: false,
      createdAt: new Date().toISOString(),
    });

    expect((await login('antigo', 'chute')).ok).toBe(false);
  });

  it('depois migrada, so a senha original continua valendo', async () => {
    await storage.users.put({
      username: 'antigo', name: 'Antigo', credentials: null,
      legacyHash: legacyHash('senha-antiga'), isMaster: false,
      createdAt: new Date().toISOString(),
    });

    await login('antigo', 'senha-antiga');
    sessionStorage.clear();

    expect((await login('antigo', 'senha-antiga')).ok).toBe(true);
    expect((await login('antigo', 'senha-errada')).ok).toBe(false);
  });

  it('o hash legado nao e aceito mais apos a conversao', async () => {
    await storage.users.put({
      username: 'antigo', name: 'Antigo', credentials: null,
      legacyHash: legacyHash('senha-antiga'), isMaster: false,
      createdAt: new Date().toISOString(),
    });

    await login('antigo', 'senha-antiga');

    const user = await storage.users.get('antigo');
    expect(user.legacyHash).toBeUndefined();
    expect(user.credentials).not.toBeNull();
  });
});

describe('setPassword', () => {
  beforeEach(async () => {
    await register({ name: 'João', username: 'joao', password: 'senha-secreta' });
  });

  it('troca a senha e permite o novo login', async () => {
    await setPassword('joao', 'nova-senha-forte');
    sessionStorage.clear();

    expect((await login('joao', 'nova-senha-forte')).ok).toBe(true);
    expect((await login('joao', 'senha-secreta')).ok).toBe(false);
  });

  it('rejeita senha nova invalida', async () => {
    await expect(setPassword('joao', '123')).rejects.toThrow(/mínimo/);
  });

  it('rejeita usuario inexistente', async () => {
    await expect(setPassword('ninguem', 'nova-senha-forte')).rejects.toThrow(/não encontrado/);
  });
});

describe('deleteUser', () => {
  it('impede que o administrador se autoexclua', async () => {
    await register({ name: 'Admin', username: 'admin', password: 'senha-secreta' });

    await expect(deleteUser('admin')).rejects.toThrow(/administrador/);
    expect(await storage.users.get('admin')).not.toBeNull();
  });

  it('exclui um usuario comum e os dados dele', async () => {
    await register({ name: 'Admin', username: 'admin', password: 'senha-secreta' });
    await register({ name: 'Maria', username: 'maria', password: 'outra-senha' });

    await deleteUser('maria');

    expect(await storage.users.get('maria')).toBeNull();
  });

  it('rejeita usuario inexistente', async () => {
    await expect(deleteUser('ninguem')).rejects.toThrow(/não encontrado/);
  });
});

describe('startSession', () => {
  it('ignora payload de sessao adulterado', async () => {
    await register({ name: 'João', username: 'joao', password: 'senha-secreta' });

    // Tentativa de forjar administrador via sessao.
    startSession({ username: 'joao' });
    sessionStorage.setItem('analisador-cores:sessao', JSON.stringify({
      username: 'joao', isMaster: true, admin: true,
    }));

    const user = await currentUser();
    // O papel vem do registro no banco, e' o 'joao' que foi admin no cadastro.
    expect(user.isMaster).toBe(true);
    // E o sessionStorage adulterado nao substitui a credencial real.
    expect(user.credentials).toBeTruthy();
    expect(user.credentials.algo).toBe('PBKDF2-HMAC-SHA256');
  });

  it('devolve null para sessao com JSON invalido', async () => {
    sessionStorage.setItem('analisador-cores:sessao', '{quebrado');
    expect(await currentUser()).toBeNull();
  });
});