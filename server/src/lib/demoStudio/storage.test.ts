import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { LocalDiskStorage, chaveComHash, resolverChave, tipoDoArquivo } from './storage.js';

const raiz = path.resolve('/tmp/ds-raiz');

test('resolverChave aceita caminhos normais dentro da raiz', () => {
  assert.equal(resolverChave(raiz, 'frames/abc.webp'), path.join(raiz, 'frames', 'abc.webp'));
});

test('resolverChave recusa qualquer tentativa de sair da raiz', () => {
  for (const ruim of ['../etc/passwd', 'frames/../../x', '/etc/passwd', 'C:/x', 'a\\b', 'a//b', './a', '', 'a\0b']) {
    assert.equal(resolverChave(raiz, ruim), null, ruim);
  }
});

test('chaveComHash é estável para o mesmo conteúdo', () => {
  const a = chaveComHash('frames', Buffer.from('x'), 'webp');
  assert.equal(a, chaveComHash('frames', Buffer.from('x'), 'webp'));
  assert.notEqual(a, chaveComHash('frames', Buffer.from('y'), 'webp'));
  assert.match(a, /^frames\/[0-9a-f]{16}\.webp$/);
});

test('tipoDoArquivo pelo final', () => {
  assert.equal(tipoDoArquivo('a/b.webp'), 'image/webp');
  assert.equal(tipoDoArquivo('a/b.bin'), 'application/octet-stream');
});

test('LocalDiskStorage grava, lê e apaga', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ds-storage-'));
  const s = new LocalDiskStorage(dir);
  await s.put('frames/um.webp', Buffer.from('conteudo'));
  const lido = await s.get('frames/um.webp');
  assert.ok(lido);
  assert.equal(lido.size, 8);
  lido.stream.destroy();
  assert.equal(await s.get('../fora.txt'), null);
  await assert.rejects(s.put('../fora.txt', Buffer.from('x')));
  await s.delete('frames/um.webp');
  assert.equal(await s.get('frames/um.webp'), null);
  await fs.rm(dir, { recursive: true, force: true });
});
