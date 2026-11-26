import { paginar, precoNumero, type DadosTabloide, type ItemTabloide } from './layout.js';

/**
 * Locução do vídeo do tabloide: roteiro por página + voz (ElevenLabs).
 * Sem ELEVENLABS_API_KEY o vídeo sai sem voz — nada quebra.
 */

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0 a 999.999 por extenso ("cento e vinte e três"). */
export function extenso(n: number): string {
  n = Math.floor(n);
  if (n < 20) return UNIDADES[n];
  if (n < 100) return DEZENAS[Math.floor(n / 10)] + (n % 10 ? ` e ${UNIDADES[n % 10]}` : '');
  if (n === 100) return 'cem';
  if (n < 1000) return CENTENAS[Math.floor(n / 100)] + (n % 100 ? ` e ${extenso(n % 100)}` : '');
  if (n < 1_000_000) {
    const mil = Math.floor(n / 1000);
    const resto = n % 1000;
    return (mil === 1 ? 'mil' : `${extenso(mil)} mil`) + (resto ? (resto < 100 || resto % 100 === 0 ? ' e ' : ' ') + extenso(resto) : '');
  }
  return String(n);
}

/** "8,99" → "oito reais e noventa e nove centavos". */
export function precoFalado(preco: string): string {
  const v = precoNumero(preco);
  if (!Number.isFinite(v) || v <= 0) return '';
  const reais = Math.floor(v);
  const cent = Math.round((v - reais) * 100);
  const r = reais ? `${extenso(reais)} ${reais === 1 ? 'real' : 'reais'}` : '';
  const c = cent ? `${extenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}` : '';
  return [r, c].filter(Boolean).join(' e ');
}

const UNIDADE_FALADA: Record<string, string> = { kg: 'o quilo', un: 'a unidade', '100g': 'os cem gramas', bandeja: 'a bandeja' };

function textoFalado(t: string): string {
  return t
    .toLowerCase()
    .replace(/\bc\/\s*/g, 'com ')
    .replace(/(\d+)\s*kg\b/g, '$1 quilos')
    .replace(/(\d+)\s*g\b/g, '$1 gramas')
    .replace(/(\d+)\s*ml\b/g, '$1 mililitros')
    .replace(/(\d+)\s*l\b/g, '$1 litros')
    .replace(/\s+/g, ' ')
    .trim();
}

export function falaDoItem(it: ItemTabloide): string {
  const nome = textoFalado([it.nome, it.detalhe].filter(Boolean).join(' '));
  const preco = precoFalado(it.preco);
  const un = UNIDADE_FALADA[it.unidade.toLowerCase()];
  if (!nome) return '';
  if (!preco) return `${nome}.`;
  return `${nome}, por apenas ${preco}${un ? ` ${un}` : ''}.`;
}

/** Um texto por página do vídeo (as mesmas páginas que o vídeo mostra). */
export function roteiroPadrao(dados: DadosTabloide, maxPaginas: number): string[] {
  const paginas = paginar(dados.itens, 'story', dados.porPagina).slice(0, maxPaginas);
  const titulo = (dados.titulo || 'ofertas').trim();
  return paginas.map((itens, i) => {
    const partes: string[] = [];
    if (i === 0) partes.push(`Olha só as ${textoFalado(titulo)}!`);
    for (const it of itens) {
      const f = falaDoItem(it);
      if (f) partes.push(f);
    }
    if (i === paginas.length - 1) partes.push('Corre que é por tempo limitado!');
    return partes.join(' ');
  });
}

/** Roteiro do estilo Black Friday: abertura, uma fala por produto e fechamento (uma por página do vídeo). */
export function roteiroBlack(dados: DadosTabloide, maxProdutos: number): string[] {
  return [
    'Black Friday Nunes! Ofertas imperdíveis, com descontos em todos os setores.',
    ...dados.itens.slice(0, maxProdutos).map((it) => falaDoItem(it)),
    'Corre pro mercado, é por tempo limitado!',
  ];
}

export const vozDisponivel = () => !!process.env.ELEVENLABS_API_KEY;

/** Voz padrão (env); a tela pode escolher outra pelo id. */
export const VOZ_PADRAO = () => process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';

/** MP3 44,1 kHz / 128 kbps constante — a duração sai do tamanho do arquivo. */
export async function gerarVoz(texto: string, vozId?: string): Promise<Buffer> {
  const chave = process.env.ELEVENLABS_API_KEY;
  if (!chave) throw new Error('ELEVENLABS_API_KEY não configurada');
  const voz = vozId && /^[A-Za-z0-9]{10,40}$/.test(vozId) ? vozId : VOZ_PADRAO();
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': chave, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: texto.slice(0, 2500),
      model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.55, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

export const segundosDoMp3 = (b: Buffer) => (b.length * 8) / 128_000;
