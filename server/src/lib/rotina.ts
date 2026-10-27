import { dateParaAgendamento } from './reuniaoResultado.js';

/**
 * Rotina do dia (barra lateral do SDR e do closer, ver routes/rotina.ts). Funções puras: horário sempre de Brasília
 * ("HH:MM", "YYYY-MM-DD"), o mesmo do campo Agendamento. Segunda a sexta; o admin marca folga num dia.
 */

export const TIPOS_DE_BLOCO = ['tarefa', 'ligacao', 'reuniao', 'crm'] as const;
export type TipoDeBloco = (typeof TIPOS_DE_BLOCO)[number];

export const STATUS_DA_MARCACAO = ['feito', 'parcial', 'nao_deu'] as const;
export type StatusDaMarcacao = (typeof STATUS_DA_MARCACAO)[number];

/** Depois do fim do bloco, quanto tempo ele fica "pendente" antes de virar "sem resposta" (ainda dá pra marcar). */
export const TOLERANCIA_MIN = 30;
export const MINIMO_MOTIVO = 5;
/** Aviso de início de bloco: vale até 5 min depois do horário (cobre o servidor reiniciando bem na hora). */
export const JANELA_DO_AVISO_MIN = 5;

export interface Bloco {
  id: string;
  /** "YYYY-MM-DDTHH:MM" de Brasília. */
  criado_em?: string;
  inicio: string;
  fim: string;
  titulo: string;
  itens: string[];
  tipo: TipoDeBloco;
}

export interface Marcacao {
  status: StatusDaMarcacao;
  motivo: string;
  /** "YYYY-MM-DDTHH:MM" de Brasília. */
  marcado_em: string;
}

/** futuro/agora/pendente/sem_resposta (sem marcação), reuniao (bloco de reunião que teve reunião), fora (o bloco ainda
 * não existia nesse horário — não conta), ou a marcação. */
export type EstadoDoBloco = 'futuro' | 'agora' | 'pendente' | 'sem_resposta' | 'reuniao' | 'fora' | StatusDaMarcacao;

export interface BlocoModelo { inicio: string; fim: string; titulo: string; itens: string[]; tipo: TipoDeBloco }

const CRM_DA_REUNIAO: BlocoModelo = {
  inicio: '', fim: '', titulo: 'CRM da reunião', tipo: 'crm',
  itens: ['Atualizar o CRM da reunião, enviar a proposta e a mensagem com o link para a próxima reunião.'],
};
const crmDaReuniao = (inicio: string, fim: string): BlocoModelo => ({ ...CRM_DA_REUNIAO, inicio, fim });
const reuniao = (inicio: string, fim: string, ...itens: string[]): BlocoModelo => ({ inicio, fim, titulo: 'Reunião', tipo: 'reuniao', itens });

/** As rotinas de partida (a do print), por aba. O admin edita depois na tela da rotina. */
export const ROTINAS_INICIAIS: Record<string, BlocoModelo[]> = {
  'crm-arthur': [
    { inicio: '08:00', fim: '08:40', titulo: 'Auditoria e pipeline', tipo: 'tarefa', itens: [
      'Leads novos (inbound) de ontem: cadastrar no CRM se não estiver.',
      'Organizar as demandas do dia, ver o que tem de retorno.',
    ] },
    { inicio: '08:40', fim: '09:30', titulo: 'Envio do D1 ao D7', tipo: 'tarefa', itens: [] },
    { inicio: '09:30', fim: '11:30', titulo: 'Ligação manhã (flow de ligação)', tipo: 'ligacao', itens: [
      'Chegou lead novo: entra na frente e depois continua.',
      'Sem sair do foco, respondendo o WhatsApp.',
    ] },
    { inicio: '11:30', fim: '12:00', titulo: 'Finalizar demandas', tipo: 'tarefa', itens: [
      'Organizar, enviar as últimas mensagens e as de no-show.',
    ] },
    { inicio: '13:30', fim: '14:30', titulo: 'Envios e social selling', tipo: 'tarefa', itens: [
      'Terminar alguns envios de mensagem.',
      'Seguir, curtir postagem, comentar e mandar direct personalizado.',
    ] },
    { inicio: '14:30', fim: '16:30', titulo: 'Ligação tarde', tipo: 'ligacao', itens: [
      'Ligar para todos que estão no D1 ao D7.',
      'Quando acabar: ligar para os leads que já foram para disparo em massa recente, pós 7 dias de contato.',
    ] },
    { inicio: '16:30', fim: '18:00', titulo: 'Organizar CRM e fechamento', tipo: 'tarefa', itens: [
      'Organizar o CRM e fazer os envios de no-show.',
      'Ligação para lead nova, se cair.',
    ] },
  ],
  'crm-luis-closer': [
    { inicio: '08:00', fim: '09:00', titulo: 'Início do dia', tipo: 'tarefa', itens: [
      'Enviar todas as confirmações do dia.',
      'Organizar o CRM e ver as propostas.',
      'Olhar se tem gente sem resposta.',
    ] },
    reuniao('09:00', '09:45', 'Sem reunião: retorna as propostas do horário, se tiver.', 'Inicia o social selling inbound.'),
    crmDaReuniao('09:45', '10:00'),
    reuniao('10:00', '10:45', 'Sem reunião: retorna as propostas do horário, se tiver.',
      'Continua o social selling outbound: seguir, comentar e mandar direct (seguir o roteiro).'),
    crmDaReuniao('10:45', '11:00'),
    reuniao('11:00', '11:45', 'Sem reunião: retorna as propostas do horário, se tiver.', 'Inicia ligação para o D1 ao D7 do CRM Arthur.'),
    { inicio: '11:45', fim: '12:00', titulo: 'Organizar e confirmar a tarde', tipo: 'tarefa', itens: [
      'Organizar o CRM.',
      'Confirmar as reuniões da parte da tarde.',
    ] },
    { inicio: '13:30', fim: '14:00', titulo: 'Confirmar de novo', tipo: 'tarefa', itens: [
      'Confirmar novamente as reuniões da parte da tarde.',
      'Responder a galera.',
    ] },
    reuniao('14:00', '14:45', 'Sem reunião: retorno de proposta do horário.', 'Ligação para follow-up de proposta.'),
    crmDaReuniao('14:45', '15:00'),
    reuniao('15:00', '15:45', 'Sem reunião: retorno de proposta do horário.', 'Ligação para as propostas não respondidas do dia.'),
    crmDaReuniao('15:45', '16:00'),
    reuniao('16:00', '16:45', 'Sem reunião: retorno das propostas do horário.', 'Ligação para a lista da 3C.'),
    { inicio: '16:45', fim: '18:00', titulo: 'Dia seguinte e fechamento', tipo: 'tarefa', itens: [
      'Confirmar todas as reuniões do dia seguinte e enviar mensagem.',
      'Ligar para a galera do dia que não apareceu e para a galera de proposta do dia que não atendeu.',
      'Organizar o CRM.',
    ] },
  ],
};

/** Agora em Brasília: { data: "YYYY-MM-DD", hora: "HH:MM" }. */
export function agoraLocal(d: Date = new Date()): { data: string; hora: string } {
  const s = dateParaAgendamento(d);
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

/** Segunda a sexta. */
export function ehDiaDeRotina(data: string): boolean {
  const dia = new Date(`${data}T12:00:00Z`).getUTCDay();
  return dia >= 1 && dia <= 5;
}

/** "YYYY-MM-DD" + n dias. */
export function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Segunda-feira da semana da data. */
export function segundaDaSemana(data: string): string {
  const dia = new Date(`${data}T12:00:00Z`).getUTCDay();
  return somarDias(data, dia === 0 ? -6 : 1 - dia);
}

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Limite pra marcar sem contar como atrasado: fim do bloco + TOLERANCIA_MIN, no mesmo dia. */
export function limiteDoBloco(bloco: Pick<Bloco, 'fim'>, data: string): string {
  return `${data}T${hhmm(Math.min(minutos(bloco.fim) + TOLERANCIA_MIN, 23 * 60 + 59))}`;
}

/**
 * Estado do bloco num dia, visto de `agora`. Bloco de reunião em que teve reunião marcada no horário não pede
 * marcação (quem responde é o popup de resultado da reunião) — a não ser que a pessoa tenha marcado mesmo assim.
 * `criadoEm` ("YYYY-MM-DDTHH:MM"): bloco que já tinha terminado quando foi criado não cobra nada (a rotina começou
 * depois — não vira "sem resposta").
 */
export function estadoDoBloco(
  bloco: Pick<Bloco, 'inicio' | 'fim' | 'tipo'>, data: string, agora: { data: string; hora: string },
  marcacao: Marcacao | null | undefined, teveReuniao: boolean, criadoEm = '',
): EstadoDoBloco {
  if (marcacao) return marcacao.status;
  if (criadoEm && `${data}T${bloco.fim}` <= criadoEm) return 'fora';
  const agoraTxt = `${agora.data}T${agora.hora}`;
  if (agoraTxt < `${data}T${bloco.inicio}`) return 'futuro';
  if (agoraTxt < `${data}T${bloco.fim}`) return 'agora';
  if (bloco.tipo === 'reuniao' && teveReuniao) return 'reuniao';
  return agoraTxt < limiteDoBloco(bloco, data) ? 'pendente' : 'sem_resposta';
}

/** Pode marcar: bloco que já começou, só no dia dele (e que já existia quando terminou). */
export function podeMarcar(
  bloco: Pick<Bloco, 'inicio' | 'fim'>, data: string, agora: { data: string; hora: string }, criadoEm = '',
): boolean {
  return data === agora.data && agora.hora >= bloco.inicio && !(criadoEm && `${data}T${bloco.fim}` <= criadoEm);
}

/** Marcou depois do limite (fim + tolerância)? */
export function marcouAtrasado(bloco: Pick<Bloco, 'fim'>, data: string, marcacao: Marcacao): boolean {
  return marcacao.marcado_em > limiteDoBloco(bloco, data);
}

/** Valida o pedido de marcação. Parcial/Não deu pedem o motivo. */
export function validarMarcacao(body: unknown): { erro: string } | { ok: { status: StatusDaMarcacao; motivo: string } } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const status = typeof b.status === 'string' ? b.status : '';
  if (!(STATUS_DA_MARCACAO as readonly string[]).includes(status)) return { erro: `"status" deve ser ${STATUS_DA_MARCACAO.join(', ')}.` };
  const motivo = typeof b.motivo === 'string' ? b.motivo.trim().slice(0, 500) : '';
  if (status !== 'feito' && motivo.length < MINIMO_MOTIVO) return { erro: `Escreva o motivo (mínimo ${MINIMO_MOTIVO} caracteres).` };
  return { ok: { status: status as StatusDaMarcacao, motivo } };
}

/** Valida a lista inteira de blocos que o admin salva. Devolve os blocos limpos, em ordem de horário. */
export function validarBlocos(body: unknown): { erro: string } | { ok: (BlocoModelo & { id?: string })[] } {
  const lista = (body as { blocos?: unknown })?.blocos;
  if (!Array.isArray(lista)) return { erro: '"blocos" deve ser uma lista.' };
  if (lista.length > 40) return { erro: 'No máximo 40 blocos.' };
  const out: (BlocoModelo & { id?: string })[] = [];
  for (const [i, x] of lista.entries()) {
    const b = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const txt = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
    const n = `Bloco ${i + 1}`;
    const inicio = txt('inicio');
    const fim = txt('fim');
    if (!HORA.test(inicio) || !HORA.test(fim)) return { erro: `${n}: horário inválido (use HH:MM).` };
    if (fim <= inicio) return { erro: `${n}: o fim tem que ser depois do início.` };
    const titulo = txt('titulo').slice(0, 120);
    if (!titulo) return { erro: `${n}: falta o título.` };
    const tipo = txt('tipo');
    if (!(TIPOS_DE_BLOCO as readonly string[]).includes(tipo)) return { erro: `${n}: tipo inválido.` };
    const itens = (Array.isArray(b.itens) ? b.itens : [])
      .filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, 10).map((t) => t.slice(0, 300));
    const id = typeof b.id === 'string' && /^[0-9a-f-]{36}$/i.test(b.id) ? b.id : undefined;
    out.push({ id, inicio, fim, titulo, tipo: tipo as TipoDeBloco, itens });
  }
  return { ok: out.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fim.localeCompare(b.fim)) };
}

/** Blocos que começam agora (dentro da janela do aviso). */
export function blocosComecando<T extends Pick<Bloco, 'inicio'>>(blocos: T[], hora: string): T[] {
  const m = minutos(hora);
  return blocos.filter((b) => m >= minutos(b.inicio) && m < minutos(b.inicio) + JANELA_DO_AVISO_MIN);
}

/** Texto do push do início do bloco. */
export function textoDoAviso(
  bloco: Pick<Bloco, 'inicio' | 'fim' | 'titulo' | 'itens' | 'tipo'>,
  reunioes: { nome: string; empresa: string; agendamento: string }[],
  faltaMarcar: Pick<Bloco, 'inicio' | 'titulo'>[],
): { title: string; body: string } {
  const title = `${bloco.inicio}–${bloco.fim} · ${bloco.titulo}`;
  let corpo: string;
  if (bloco.tipo === 'reuniao' && reunioes.length) {
    corpo = reunioes.map((r) => `Reunião ${r.agendamento.slice(11, 16)}: ${r.nome || r.empresa || 'lead sem nome'}`).join(' · ');
  } else {
    corpo = (bloco.tipo === 'reuniao' ? bloco.itens.join(' ') : bloco.itens[0]) || 'Hora de começar esse bloco.';
  }
  if (faltaMarcar.length) {
    corpo += ` · Falta marcar: ${faltaMarcar.map((b) => `${b.inicio} ${b.titulo}`).join(', ')}`;
  }
  return { title, body: corpo.slice(0, 300) };
}
