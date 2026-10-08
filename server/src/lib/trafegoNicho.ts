/**
 * Convenção de nomes de campanha/conjunto do Meta: "NICHO | PAPEL | OFERTA".
 *   ex.: "Lavanderia | Escala | Chatbot 7 dias"  ->  nicho "Lavanderia", papel "escala".
 * Papel aceito: escala ou teste (sem acento e sem diferença de maiúscula). O terceiro pedaço (oferta)
 * é livre e hoje não é usado. Nome sem "|" não gera nicho nenhum — nunca se chuta nicho de nome solto.
 */

export type PapelCampanha = '' | 'escala' | 'teste';

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function papelDe(texto: string): PapelCampanha {
  const t = semAcento(texto);
  if (/^(escala|escalar|scale|escalando)$/.test(t)) return 'escala';
  if (/^(teste|test|testes|testando)$/.test(t)) return 'teste';
  return '';
}

export function lerNomeCampanha(nome: string | null | undefined): { nicho: string; papel: PapelCampanha } {
  const partes = (nome ?? '').split('|').map((p) => p.trim()).filter((p) => p.length > 0);
  if (partes.length < 2) return { nicho: '', papel: '' };
  const papel = papelDe(partes[1]);
  // Com 2 pedaços só vale se o segundo for um papel conhecido ("Lavanderia | Teste"); com 3 ou mais,
  // o segundo pode ser qualquer coisa e o nicho continua sendo o primeiro.
  if (partes.length === 2 && !papel) return { nicho: '', papel: '' };
  return { nicho: partes[0].slice(0, 80), papel };
}

/** Pergunta de segmento do formulário do Meta: a chave varia ("qual_o_segmento_da_sua_empresa?"). */
export function nichoDoFormulario(qualificacao: Record<string, unknown> | null | undefined): string {
  for (const [chave, valor] of Object.entries(qualificacao ?? {})) {
    if (!/segment|nicho|ramo|atividade/i.test(chave)) continue;
    const v = Array.isArray(valor) ? valor.join(', ') : valor;
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/_/g, ' ').slice(0, 80);
  }
  return '';
}

/** Lista fechada de motivos de desqualificação (o time pode ajustar aqui). */
export const MOTIVOS_DESQUALIFICACAO = [
  'Fora do perfil / segmento errado',
  'Sem orçamento',
  'Só curioso / sem interesse',
  'Já tem solução',
  'Não atende / telefone inválido',
  'Concorrente / fornecedor',
  'Outro',
] as const;
