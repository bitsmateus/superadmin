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

/** Vozes escolhidas para o mercado (biblioteca do ElevenLabs); a tela escolhe entre elas. */
const VOZES_DO_MERCADO = ['UaeEQHfiDI8l58WWXiwS', 'zhza6dIY7yb1xz5MKTvQ', 'rpNe0HOx7heUulPiOEaG', '9EeK37hO7iJiXi8aJfRG', 'Vt2wXa5zSaS5HQMb3E9Q'];

/** Voz padrão: a do env, se houver; senão a primeira da lista. */
export const VOZ_PADRAO = () => process.env.ELEVENLABS_VOICE_ID || VOZES_DO_MERCADO[0];

export interface Voz {
  id: string;
  nome: string;
  /** Amostra pronta do ElevenLabs (ouvir não gasta crédito). */
  amostra: string | null;
}

const vozesLidas = new Map<string, Voz>();

/** Lista pra tela, com nome e amostra. Se o ElevenLabs não responder (chave sem permissão de ler vozes), vai "Voz N". */
export async function listarVozes(): Promise<Voz[]> {
  const chave = process.env.ELEVENLABS_API_KEY;
  if (!chave) return [];
  const ids = [...new Set([VOZ_PADRAO(), ...VOZES_DO_MERCADO])];
  return Promise.all(
    ids.map(async (id, i) => {
      const ja = vozesLidas.get(id);
      if (ja) return ja;
      try {
        const r = await fetch(`https://api.elevenlabs.io/v1/voices/${id}`, { headers: { 'xi-api-key': chave }, signal: AbortSignal.timeout(8_000) });
        if (r.ok) {
          const v = (await r.json()) as { name?: string; preview_url?: string };
          const voz: Voz = { id, nome: v.name || `Voz ${i + 1}`, amostra: v.preview_url || null };
          vozesLidas.set(id, voz);
          return voz;
        }
      } catch {
        /* sem rede: segue com o nome genérico */
      }
      return { id, nome: `Voz ${i + 1}`, amostra: null };
    }),
  );
}

/** MP3 44,1 kHz / 128 kbps constante — a duração sai do tamanho do arquivo. */
export async function gerarVoz(texto: string, vozId?: string, espera = 1500): Promise<Buffer> {
  const chave = process.env.ELEVENLABS_API_KEY;
  if (!chave) throw new Error('ELEVENLABS_API_KEY não configurada');
  const voz = vozId && /^[A-Za-z0-9]{10,40}$/.test(vozId) ? vozId : VOZ_PADRAO();
  const pedir = () => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': chave, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: texto.slice(0, 2500),
      model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.55, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  let r = await pedir();
  // 429 (muitos pedidos ao mesmo tempo) e erro do lado deles passam sozinhos: espera e pede de novo.
  for (let tentativa = 1; tentativa <= 3 && (r.status === 429 || r.status >= 500); tentativa++) {
    await new Promise((ok) => setTimeout(ok, espera * tentativa));
    r = await pedir();
  }
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Uma fala por página, de 2 em 2: o ElevenLabs limita pedidos simultâneos pelo plano (2 no grátis, 3 no de
 * entrada) e o Black Friday tem até 10 falas.
 */
export async function gerarVozes(textos: string[], vozId?: string, espera?: number): Promise<(Buffer | null)[]> {
  const audios: (Buffer | null)[] = textos.map(() => null);
  let proximo = 0;
  let falhou = false;
  const trabalhar = async () => {
    while (!falhou && proximo < textos.length) {
      const i = proximo++;
      if (!textos[i]) continue;
      try {
        audios[i] = await gerarVoz(textos[i], vozId, espera);
      } catch (err) {
        falhou = true; // não gasta crédito com o resto: o vídeo vai sair sem voz
        throw err;
      }
    }
  };
  await Promise.all([trabalhar(), trabalhar()]);
  return audios;
}

/** Motivo da falha em português, pra aparecer na tela. */
export function motivoDaVoz(erro: string): string {
  if (/quota_exceeded/i.test(erro)) return 'acabaram os créditos do ElevenLabs neste mês';
  if (/missing_permissions/i.test(erro)) return 'a chave não tem permissão de Text to Speech';
  if (/invalid_api_key| 401/i.test(erro)) return 'a chave do ElevenLabs foi recusada';
  if (/voice_not_found/i.test(erro)) return 'essa voz não está em "My Voices" da conta';
  if (/paid_plan_required|payment_required| 402|free users|subscription/i.test(erro)) return 'essa voz ou recurso pede um plano pago';
  if (/unusual_activity/i.test(erro)) return 'o ElevenLabs bloqueou a conta grátis neste servidor';
  if (/ 429|concurrent/i.test(erro)) return 'muitos pedidos ao mesmo tempo, tente de novo';
  return erro.replace(/\s+/g, ' ').slice(0, 160);
}

export const segundosDoMp3 = (b: Buffer) => (b.length * 8) / 128_000;
