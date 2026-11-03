import { createHash } from 'node:crypto';
import { promises as fs, createReadStream, type ReadStream } from 'node:fs';
import path from 'node:path';

/**
 * Armazenamento de arquivos do Demo Studio (frames WebP, miniaturas, snapshots HTML, CSS).
 *
 * Interface pequena pra dar lugar a um S3Storage depois; hoje só existe o disco local, que no
 * Easypanel é o volume montado em /data. Os nomes levam hash do conteúdo, então um arquivo
 * nunca muda depois de gravado — é isso que deixa o /files servir com cache imutável.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  /** Stream do arquivo, ou null se não existe (ou se a chave tenta sair da raiz). */
  get(key: string): Promise<{ stream: ReadStream; size: number } | null>;
  delete(key: string): Promise<void>;
}

/**
 * Normaliza a chave e garante que ela fica DENTRO da raiz. Devolve null pra qualquer coisa que
 * tente escapar (`..`, caminho absoluto, barra invertida, byte nulo).
 */
export function resolverChave(raiz: string, key: string): string | null {
  if (!key || key.includes('\0') || key.includes('\\')) return null;
  if (key.startsWith('/') || /^[a-zA-Z]:/.test(key)) return null;
  const partes = key.split('/');
  if (partes.some((p) => p === '' || p === '.' || p === '..')) return null;
  const base = path.resolve(raiz);
  const alvo = path.resolve(base, ...partes);
  if (alvo !== base && !alvo.startsWith(base + path.sep)) return null;
  return alvo;
}

/** Chave com hash do conteúdo: `<pasta>/<sha256 16>.<ext>` — mesmo arquivo, mesma chave. */
export function chaveComHash(pasta: string, data: Buffer, ext: string): string {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  return `${pasta}/${hash}.${ext}`;
}

export class LocalDiskStorage implements Storage {
  constructor(private readonly raiz: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    const alvo = resolverChave(this.raiz, key);
    if (!alvo) throw new Error(`Chave de arquivo inválida: ${key}`);
    await fs.mkdir(path.dirname(alvo), { recursive: true });
    await fs.writeFile(alvo, data);
  }

  async get(key: string) {
    const alvo = resolverChave(this.raiz, key);
    if (!alvo) return null;
    try {
      const stat = await fs.stat(alvo);
      if (!stat.isFile()) return null;
      return { stream: createReadStream(alvo), size: stat.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const alvo = resolverChave(this.raiz, key);
    if (!alvo) return;
    await fs.rm(alvo, { force: true });
  }
}

/** Raiz: STORAGE_DIR (no Easypanel, /data); em dev, ./data ao lado do servidor. */
export const storage: Storage = new LocalDiskStorage(process.env.STORAGE_DIR || path.resolve('data'));

const TIPOS: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  json: 'application/json; charset=utf-8',
  css: 'text/css; charset=utf-8',
  gz: 'application/gzip',
};

export function tipoDoArquivo(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return TIPOS[ext] ?? 'application/octet-stream';
}
