/**
 * Consolidação dos CRMs do Comercial: CRM LUIS e CRM LUIS CLOSER entram no CRM ARTHUR (que passa a se chamar
 * "CRM LUIS ATUALIZADO"; o id `crm-arthur` não muda). Aqui só se MONTA O PLANO — função pura, não grava nada.
 *
 * Duplicado = mesmo telefone (com/sem 55, com/sem o 9), mesmo e-mail, ou card ligado a outro pela cópia automática
 * (espelho do closer / cópia da IA). CRM IA LUIZA e CRM TUBARAO não entram na junção: o que bate com eles só é listado.
 */
import { chaveTelefone, mesmoTelefone } from './integracaoCards.js';
import { normalizaNome } from './normalizaNome.js';

export const PAGINA_DESTINO = 'crm-arthur';
export const PAGINA_CLOSER = 'crm-luis-closer';
export const PAGINAS_PROTEGIDAS = ['crm-ia-luiza', 'crm-outbound'];
export const NOVO_NOME = 'CRM LUIS ATUALIZADO';

export interface Aba { id: string; name: string; arquivada: boolean }
export interface Quadro { id: string; name: string; page: string; position: number }
export interface Etiqueta { field: string; name: string; color: string; page_id: string | null }
/** Linha de lead_rows (todas as colunas) + o que o plano precisa saber sobre os vínculos dela. */
export type Lead = Record<string, unknown> & {
  id: string; board_id: string; deleted_at: unknown;
  /** Último movimento de quadro/status (histórico, linha do tempo ou entrada na coluna). */
  movido_em: string | null;
  /** Atualizações, eventos, reuniões etc. ligados a este card. */
  vinculos: Record<string, number>;
};

export interface Entrada { abas: Aba[]; quadros: Quadro[]; etiquetas: Etiqueta[]; leads: Lead[] }

export interface LeadResumo {
  id: string; aba: string; quadro: string; nome: string; empresa: string; telefone: string; email: string;
  status: string; sdr: string; movidoEm: string; vinculos: Record<string, number>; copiaAutomatica: boolean;
}

export interface Duplicado {
  motivos: string[];
  fica: LeadResumo;
  saem: LeadResumo[];
  /** Outros cards do próprio CRM de destino no mesmo grupo: não são tocados. */
  intocadosNoDestino: LeadResumo[];
  etapaFinal: { quadro: string | null; vemDe: string; quando: string };
  completar: { campo: string; valor: string; de: string }[];
  divergentes: { campo: string; fica: string; outro: string; de: string }[];
  alertas: string[];
}

export interface Plano {
  problemas: string[];
  /** Ids de cada aba envolvida e dos quadros dela (pra ajustar integrações). */
  ids: { aba: string; id: string; quadros: { nome: string; id: string }[] }[];
  destino: { id: string; nomeAtual: string; nomeNovo: string } | null;
  origens: { id: string; nome: string }[];
  protegidas: { id: string; nome: string; leads: number }[];
  contagem: { aba: string; quadro: string; ativos: number; naLixeira: number }[];
  mapeamento: { aba: string; quadro: string; destino: string | null; leads: number; parecidos: string[] }[];
  duplicados: Duplicado[];
  duplicadosSoNoDestino: LeadResumo[][];
  comProtegidas: { lead: LeadResumo; protegido: LeadResumo; motivo: string }[];
  etiquetasACriar: { campo: string; nome: string; cor: string; leads: number }[];
  responsavelMuda: number;
  porSdr: { sdr: string; leads: number }[];
  total: { destinoAntes: number; doLuis: number; doCloser: number; arquivados: number; esperadoNoFinal: number };
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));

/** Nome de quadro pra comparar: sem acento/maiúscula/pontuação e sem o que vem entre parênteses ("(após 3 tentativas)"). */
export const chaveDoQuadro = (nome: string): string => normalizaNome(nome.replace(/\([^)]*\)/g, ' '));

const emailValido = (v: unknown): string => {
  const e = texto(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
};
/** Os 8 dígitos finais, quando o telefone serve pra comparar (fora número repetido tipo 99999999). */
const chaveFone = (v: unknown): string => {
  const k = chaveTelefone(texto(v))?.ultimos8 ?? '';
  return /^(\d)\1{7}$/.test(k) ? '' : k;
};

/** Colunas que não se "completam" de um card pro outro: identidade, posição, etapa e controles do sistema. */
const NAO_COMPLETA = new Set([
  'id', 'board_id', 'position', 'created_at', 'updated_at', 'deleted_at', 'delete_reason', 'status', 'notes_count',
  'last_note_preview', 'last_note_at', 'entrou_coluna_em', 'espelho_origem_id', 'espelho_origens_extras',
  'copia_ia_origem_id', 'venda_origem_id', 'responsavel', 'movido_em', 'vinculos',
  // Estado da automação (réguas, boas-vindas): é de cada card, não se mistura.
  'regua', 'regua_etapa', 'regua_ultimo_envio_em', 'regua_status', 'boas_vindas_enviada_em', 'boas_vindas_erro',
]);
const vazio = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (typeof v === 'object' && !(v instanceof Date) && Object.keys(v as object).length === 0);
/** Booleanos e números são controle (retornado, pendências…), não "campo vazio". */
const completavel = (v: unknown): boolean => !vazio(v) && typeof v !== 'boolean' && typeof v !== 'number';
const mostrar = (v: unknown): string => {
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

const CAMPOS_DE_ETIQUETA: [string, string][] = [
  ['status', 'status'], ['tipo', 'tipo'], ['dia_contato', 'dia_contato'], ['ligacao', 'ligacao'], ['sdr', 'sdr'],
  ['etiqueta', 'etiqueta'], ['followup', 'followup'], ['disparo', 'disparo'],
];

export function montarPlano({ abas, quadros, etiquetas, leads }: Entrada): Plano {
  const problemas: string[] = [];
  const destino = abas.find((a) => a.id === PAGINA_DESTINO);
  const closer = abas.find((a) => a.id === PAGINA_CLOSER);
  // O CRM LUIS (SDR) é achado pelo nome: o id varia ("crm-luis", "crm_luis"…).
  const luis = abas.filter((a) => !a.arquivada && a.id !== PAGINA_DESTINO && a.id !== PAGINA_CLOSER
    && ['crmluis', 'crmnxluis'].includes(normalizaNome(a.name)));
  if (!destino) problemas.push(`Não achei a aba de destino (id ${PAGINA_DESTINO}).`);
  if (!closer) problemas.push(`Não achei o CRM LUIS CLOSER (id ${PAGINA_CLOSER}).`);
  if (luis.length !== 1) {
    problemas.push(luis.length
      ? `Há mais de uma aba chamada "CRM LUIS": ${luis.map((a) => `${a.name} (${a.id})`).join(', ')}.`
      : 'Não achei a aba "CRM LUIS" (nenhuma aba ativa com esse nome).');
  }
  const origens = [...(luis.length === 1 ? luis : []), ...(closer ? [closer] : [])];

  const abaPorId = new Map(abas.map((a) => [a.id, a]));
  const quadroPorId = new Map(quadros.map((q) => [q.id, q]));
  const paginaDo = (l: Lead) => quadroPorId.get(l.board_id)?.page ?? '';
  const idsOrigem = new Set(origens.map((a) => a.id));
  const juntaveis = new Set([PAGINA_DESTINO, ...idsOrigem]);
  const noEscopo = leads.filter((l) => juntaveis.has(paginaDo(l)));
  const ativos = noEscopo.filter((l) => !l.deleted_at);
  const protegidos = leads.filter((l) => !l.deleted_at && PAGINAS_PROTEGIDAS.includes(paginaDo(l)));

  const resumo = (l: Lead): LeadResumo => {
    const q = quadroPorId.get(l.board_id);
    return {
      id: l.id, aba: abaPorId.get(q?.page ?? '')?.name ?? q?.page ?? '', quadro: q?.name ?? '',
      nome: texto(l.nome), empresa: texto(l.empresa), telefone: texto(l.telefone), email: texto(l.email),
      status: texto(l.status), sdr: texto(l.sdr), movidoEm: texto(l.movido_em), vinculos: l.vinculos,
      copiaAutomatica: !!(l.espelho_origem_id || l.copia_ia_origem_id),
    };
  };

  // ── contagem por aba/quadro ──
  const contagem = [PAGINA_DESTINO, ...idsOrigem].flatMap((page) => quadros
    .filter((q) => q.page === page).sort((a, b) => a.position - b.position)
    .map((q) => ({
      aba: abaPorId.get(page)?.name ?? page, quadro: q.name,
      ativos: noEscopo.filter((l) => l.board_id === q.id && !l.deleted_at).length,
      naLixeira: noEscopo.filter((l) => l.board_id === q.id && l.deleted_at).length,
    })));

  // ── quadro de origem -> quadro de destino (nome igual; nada de "parecido" automático) ──
  const doDestino = quadros.filter((q) => q.page === PAGINA_DESTINO);
  const destinoDoQuadro = new Map<string, Quadro | null>();
  for (const q of doDestino) destinoDoQuadro.set(q.id, q);
  const mapeamento: Plano['mapeamento'] = [];
  for (const aba of origens) {
    for (const q of quadros.filter((x) => x.page === aba.id).sort((a, b) => a.position - b.position)) {
      const chave = chaveDoQuadro(q.name);
      const iguais = doDestino.filter((d) => chaveDoQuadro(d.name) === chave);
      const alvo = iguais.length === 1 ? iguais[0] : null;
      destinoDoQuadro.set(q.id, alvo);
      const quantos = ativos.filter((l) => l.board_id === q.id).length;
      const parecidos = alvo ? [] : (iguais.length > 1 ? iguais : doDestino.filter((d) => {
        const c = chaveDoQuadro(d.name);
        return c.startsWith(chave) || chave.startsWith(c) || c.replace(/s$/, '') === chave.replace(/s$/, '');
      })).map((d) => d.name);
      mapeamento.push({ aba: aba.name, quadro: q.name, destino: alvo?.name ?? null, leads: quantos, parecidos });
      if (!alvo && quantos) {
        problemas.push(`Quadro sem correspondente no destino: "${q.name}" de ${aba.name} (${quantos} lead(s))`
          + (parecidos.length ? `. Parecido(s): ${parecidos.join(', ')}.` : '.'));
      }
    }
  }

  // ── grupos de duplicados (união por telefone, e-mail e cópia automática) ──
  const pai = new Map<string, string>(ativos.map((l) => [l.id, l.id]));
  const raiz = (id: string): string => {
    let r = id;
    while (pai.get(r) !== r) r = pai.get(r)!;
    pai.set(id, r);
    return r;
  };
  const motivosDe = new Map<string, Set<string>>();
  const unir = (a: string, b: string, motivo: string) => {
    if (a === b || !pai.has(a) || !pai.has(b)) return;
    for (const id of [a, b]) motivosDe.set(id, (motivosDe.get(id) ?? new Set()).add(motivo));
    pai.set(raiz(a), raiz(b));
  };
  const porFone = new Map<string, Lead[]>();
  const porEmail = new Map<string, Lead[]>();
  for (const l of ativos) {
    const f = chaveFone(l.telefone);
    if (f) {
      for (const outro of porFone.get(f) ?? []) if (mesmoTelefone(texto(l.telefone), texto(outro.telefone))) unir(l.id, outro.id, 'mesmo telefone');
      porFone.set(f, [...(porFone.get(f) ?? []), l]);
    }
    const e = emailValido(l.email);
    if (e) {
      if (porEmail.has(e)) unir(l.id, porEmail.get(e)![0].id, 'mesmo e-mail');
      porEmail.set(e, [...(porEmail.get(e) ?? []), l]);
    }
  }
  const origensDoCard = (l: Lead): string[] => [
    l.espelho_origem_id, l.copia_ia_origem_id, ...(Array.isArray(l.espelho_origens_extras) ? l.espelho_origens_extras : []),
  ].filter((x): x is string => typeof x === 'string' && !!x);
  for (const l of ativos) for (const o of origensDoCard(l)) unir(l.id, o, 'cópia automática');

  const grupos = new Map<string, Lead[]>();
  for (const l of ativos) grupos.set(raiz(l.id), [...(grupos.get(raiz(l.id)) ?? []), l]);

  const instante = (l: Lead) => Date.parse(texto(l.movido_em)) || 0;
  const peso = (l: Lead) => Object.values(l.vinculos).reduce((s, n) => s + n, 0);
  const noDestino = (l: Lead) => paginaDo(l) === PAGINA_DESTINO;
  const copia = (l: Lead) => !!(l.espelho_origem_id || l.copia_ia_origem_id);

  const duplicados: Duplicado[] = [];
  const duplicadosSoNoDestino: LeadResumo[][] = [];
  const arquivados = new Set<string>();
  const sobreviventes = new Map<string, Record<string, unknown>>();
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const deOrigem = grupo.filter((l) => !noDestino(l));
    if (!deOrigem.length) { duplicadosSoNoDestino.push(grupo.map(resumo)); continue; }
    const doDest = grupo.filter(noDestino);
    // Fica: o do destino (de preferência a original de quem tem cópia); sem ele, a original com mais histórico.
    const apontados = new Set(grupo.flatMap(origensDoCard));
    const ordenar = (a: Lead, b: Lead) => Number(apontados.has(b.id)) - Number(apontados.has(a.id))
      || Number(copia(a)) - Number(copia(b)) || peso(b) - peso(a) || instante(b) - instante(a) || a.id.localeCompare(b.id);
    const fica = [...(doDest.length ? doDest : grupo)].sort(ordenar)[0];
    const saem = deOrigem.filter((l) => l.id !== fica.id);
    if (!saem.length) continue;
    saem.forEach((l) => arquivados.add(l.id));

    // Etapa final: a do card movido por último.
    const maisRecente = [fica, ...saem].sort((a, b) => instante(b) - instante(a))[0];
    const quadroFinal = destinoDoQuadro.get(maisRecente.board_id) ?? null;
    if (!quadroFinal) {
      problemas.push(`Duplicado "${texto(fica.nome) || texto(fica.empresa)}": a etapa mais recente está num quadro sem correspondente.`);
    }

    const completar: Duplicado['completar'] = [];
    const divergentes: Duplicado['divergentes'] = [];
    const junto: Record<string, unknown> = { ...fica };
    for (const outro of [...saem].sort((a, b) => instante(b) - instante(a))) {
      for (const [campo, valor] of Object.entries(outro)) {
        if (NAO_COMPLETA.has(campo) || !completavel(valor)) continue;
        if (vazio(junto[campo])) {
          junto[campo] = valor;
          completar.push({ campo, valor: mostrar(valor), de: `${resumo(outro).aba} / ${resumo(outro).quadro}` });
        } else if (CAMPOS_DE_ETIQUETA.some(([c]) => c === campo) || ['nome', 'empresa', 'valor_mrr', 'valor_implementacao', 'agendamento'].includes(campo)) {
          if (normalizaNome(String(junto[campo])) !== normalizaNome(String(valor))) {
            divergentes.push({ campo, fica: mostrar(junto[campo]), outro: mostrar(valor), de: resumo(outro).aba });
          }
        }
      }
    }
    sobreviventes.set(fica.id, junto);

    const alertas: string[] = [];
    const nomes = new Set([fica, ...saem].map((l) => normalizaNome(texto(l.nome))).filter(Boolean));
    if (nomes.size > 1) alertas.push('nomes diferentes: confira se é a mesma pessoa');
    const ddds = new Set([fica, ...saem].map((l) => chaveTelefone(texto(l.telefone))?.ddd).filter(Boolean));
    if (ddds.size > 1) alertas.push('DDDs diferentes');
    if ([fica, ...saem].some((l) => l.optout === true)) alertas.push('pediu pra não receber mensagem (opt-out): isso vale pro card que fica');
    const atual = destinoDoQuadro.get(fica.board_id);
    if (quadroFinal && atual && quadroFinal.position < atual.position) {
      alertas.push(`a movimentação mais recente VOLTA no funil (de "${atual.name}" pra "${quadroFinal.name}")`);
    }
    if (doDest.length > 1) alertas.push('já havia mais de um card no destino: os outros ficam como estão');

    duplicados.push({
      motivos: [...new Set([fica, ...saem].flatMap((l) => [...(motivosDe.get(l.id) ?? [])]))],
      fica: resumo(fica), saem: saem.map(resumo), intocadosNoDestino: doDest.filter((l) => l.id !== fica.id).map(resumo),
      etapaFinal: { quadro: quadroFinal?.name ?? null, vemDe: `${resumo(maisRecente).aba} / ${resumo(maisRecente).quadro}`, quando: texto(maisRecente.movido_em) },
      completar, divergentes, alertas,
    });
  }

  // ── o que bate com CRM IA LUIZA / CRM TUBARAO (só lista) ──
  const comProtegidas: Plano['comProtegidas'] = [];
  for (const l of ativos.filter((x) => !noDestino(x))) {
    for (const p of protegidos) {
      const motivo = origensDoCard(l).includes(p.id) || origensDoCard(p).includes(l.id) ? 'cópia automática'
        : chaveFone(l.telefone) && mesmoTelefone(texto(l.telefone), texto(p.telefone)) ? 'mesmo telefone'
          : emailValido(l.email) && emailValido(l.email) === emailValido(p.email) ? 'mesmo e-mail' : '';
      if (motivo) comProtegidas.push({ lead: resumo(l), protegido: resumo(p), motivo });
    }
  }

  // ── etiquetas que precisam existir no destino (as colunas do sistema são as mesmas em todas as abas) ──
  const temNoDestino = (campo: string, nome: string) => etiquetas.some((e) => e.field === campo
    && (e.page_id === null || e.page_id === PAGINA_DESTINO) && normalizaNome(e.name) === normalizaNome(nome));
  const faltam = new Map<string, Plano['etiquetasACriar'][number]>();
  const queChegam = ativos.filter((l) => !arquivados.has(l.id) && (!noDestino(l) || sobreviventes.has(l.id)));
  for (const l of queChegam) {
    const valores = sobreviventes.get(l.id) ?? l;
    for (const [coluna, campo] of CAMPOS_DE_ETIQUETA) {
      const nome = texto(valores[coluna]);
      if (!nome || temNoDestino(campo, nome)) continue;
      const modelo = etiquetas.find((e) => e.field === campo && normalizaNome(e.name) === normalizaNome(nome) && e.page_id && idsOrigem.has(e.page_id));
      if (!modelo) continue; // valor sem etiqueta em lugar nenhum: já aparece assim hoje
      const k = `${campo}|${normalizaNome(nome)}`;
      const atual = faltam.get(k) ?? { campo, nome: modelo.name, cor: modelo.color, leads: 0 };
      atual.leads++;
      faltam.set(k, atual);
    }
  }

  const finais = ativos.filter((l) => !arquivados.has(l.id));
  const porSdr = new Map<string, number>();
  for (const l of finais) {
    const s = texto((sobreviventes.get(l.id) ?? l).sdr) || '(sem SDR)';
    porSdr.set(s, (porSdr.get(s) ?? 0) + 1);
  }
  const daAba = (page: string) => ativos.filter((l) => paginaDo(l) === page).length;
  const destinoAntes = daAba(PAGINA_DESTINO);
  const doLuis = luis.length === 1 ? daAba(luis[0].id) : 0;
  const doCloser = closer ? daAba(closer.id) : 0;

  return {
    problemas: [...new Set(problemas)],
    ids: [PAGINA_DESTINO, ...idsOrigem, ...PAGINAS_PROTEGIDAS].filter((id) => abaPorId.has(id)).map((id) => ({
      aba: abaPorId.get(id)!.name, id,
      quadros: quadros.filter((q) => q.page === id).sort((a, b) => a.position - b.position).map((q) => ({ nome: q.name, id: q.id })),
    })),
    destino: destino ? { id: destino.id, nomeAtual: destino.name, nomeNovo: NOVO_NOME } : null,
    origens: origens.map((a) => ({ id: a.id, nome: a.name })),
    protegidas: PAGINAS_PROTEGIDAS.filter((id) => abaPorId.has(id))
      .map((id) => ({ id, nome: abaPorId.get(id)!.name, leads: protegidos.filter((l) => paginaDo(l) === id).length })),
    contagem,
    mapeamento,
    duplicados,
    duplicadosSoNoDestino,
    comProtegidas,
    etiquetasACriar: [...faltam.values()],
    responsavelMuda: finais.filter((l) => normalizaNome(texto(l.responsavel)) !== 'luis').length,
    porSdr: [...porSdr].map(([sdr, n]) => ({ sdr, leads: n })).sort((a, b) => b.leads - a.leads),
    total: { destinoAntes, doLuis, doCloser, arquivados: arquivados.size, esperadoNoFinal: destinoAntes + doLuis + doCloser - arquivados.size },
  };
}
