import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caminhoFfmpeg } from './render.js';

/** Músicas que o mercado sobe pra tocar no fundo do vídeo. */

/**
 * Formato pelo começo do arquivo, só os de áudio/vídeo comuns. O ffmpeg é obrigado a ler assim: deixar ele
 * adivinhar abriria listas (m3u8, concat) que leem arquivos do servidor, e a rota é pública.
 */
export function formatoDoAudio(b: Buffer): 'mp3' | 'wav' | 'ogg' | 'mov' | 'aac' | null {
  if (b.length < 12) return null;
  const txt = (de: number, ate: number) => b.toString('latin1', de, ate);
  if (txt(0, 3) === 'ID3') return 'mp3';
  if (txt(0, 4) === 'RIFF' && txt(8, 12) === 'WAVE') return 'wav';
  if (txt(0, 4) === 'OggS') return 'ogg';
  if (txt(4, 8) === 'ftyp') return 'mov'; // m4a, mp4, mov
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/**
 * Converte pra mp3 (até 3 min) com o volume nivelado, pra o controle de volume da tela valer igual pra
 * qualquer música. Aceita vídeo também: fica só o som.
 */
export async function prepararMusica(bruto: Buffer): Promise<Buffer> {
  const formato = formatoDoAudio(bruto);
  if (!formato) throw new Error('Envie um áudio MP3, M4A, WAV ou OGG (ou um vídeo MP4/MOV, que fica só o som).');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'musica-'));
  try {
    const entrada = path.join(dir, 'entrada');
    const saida = path.join(dir, 'saida.mp3');
    await fs.writeFile(entrada, bruto);
    const args = [
      '-loglevel', 'error', '-protocol_whitelist', 'file', '-f', formato, '-i', entrada,
      '-vn', '-t', '180', '-af', 'loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-ac', '2', '-b:a', '128k', '-y', saida,
    ];
    await new Promise<void>((resolve, reject) => {
      const ff = spawn(caminhoFfmpeg(), args, { stdio: 'ignore' });
      const limite = setTimeout(() => ff.kill('SIGKILL'), 90_000);
      ff.on('error', reject);
      ff.on('close', (code) => {
        clearTimeout(limite);
        if (code === 0) resolve();
        else reject(new Error('Não consegui ler esse áudio. Tente outro arquivo.'));
      });
    });
    return await fs.readFile(saida);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
