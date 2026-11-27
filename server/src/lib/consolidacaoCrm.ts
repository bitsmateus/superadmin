/**
 * Consolidação dos CRMs do Comercial: CRM LUIS e CRM LUIS CLOSER entram no CRM ARTHUR (que passa a se chamar
 * "CRM LUIS ATUALIZADO"; o id `crm-arthur` não muda). Aqui só se MONTA O PLANO — função pura, não grava nada.
 *
 * Regras (27/11):
 *  A) CRM LUIS CLOSER — quase tudo é espelho do CRM ARTHUR.
 *     - Com par no CRM ARTHUR (é cópia automática de um card de lá, ou tem o mesmo telefone): o card do ARTHUR não muda
 *       nada; a cópia do closer só é arquivada e o histórico dela passa pro card do ARTHUR.
 *     - Sem par: é movido como está, sem alterar campo nenhum.
 *  B) CRM LUIS — tudo é movido.
 *     - Duplicado SÓ com mesmo telefone E mesmo primeiro nome (sem acento/maiúscula). Mesmo telefone com nome diferente:
 *       move os dois e lista.
 *     - Duplicado na mesma etapa: fica o card do ARTHUR, sem mudar campo preenchido. Do outro entram só os campos vazios
 *       (nunca retornar, agendamento e calendar_event_id), o histórico e os vínculos.
 *     - Duplicado em etapas diferentes: NÃO junta; os dois são movidos como estão e listados pra decidir depois.
 *  Responsável: todos os leads do CRM LUIS ATUALIZADO passam a ter "Luis" (única exceção ao "nenhum campo muda").
 *  SDR, histórico e autoria continuam como estão.
 *  C) Régua preservada (entrou_coluna_em e regua_* intactos), nenhuma comissão recalculada, lixeira e duplicados antigos do
 *     CRM ARTHUR sem mexer, CRM IA LUIZA e CRM TUBARAO intactos (o que bate com eles só é listado).
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

/** A) Card do closer arquivado porque o CRM ARTHUR já tem o par dele. */
export interface ParDoCloser { closer: LeadResumo; arthur: LeadResumo; motivo: 'cópia automática' | 'mesmo telefone' }

/** B) Card do CRM LUIS que junta no card do CRM ARTHUR. */
export interface DuplicadoDoLuis {
  fica: LeadResumo;
  sai: LeadResumo;
  completar: { campo: string; valor: string }[];
  divergentes: { campo: string; fica: string; outro: string }[];
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
  closerArquivados: ParDoCloser[];
  closerMovidos: LeadResumo[];
  /** Closer sem cópia ligada, com mais de um card do ARTHUR no mesmo telefone: não há como escolher sem deduzir. */
  closerAmbiguos: { closer: LeadResumo; candidatos: LeadResumo[] }[];
  luisDuplicados: DuplicadoDoLuis[];
  /** Mesmo telefone e nome, mas em etapas diferentes: não junta, os dois são movidos. */
  luisEtapaDiferente: { luis: LeadResumo; arthur: LeadResumo; etapaNoDestino: string | null }[];
  luisNomeDiferente: { luis: LeadResumo; arthur: LeadResumo }[];
  /** LUIS com mais de um card do ARTHUR de mesmo telefone e mesmo primeiro nome. */
  luisAmbiguos: { luis: LeadResumo; candidatos: LeadResumo[] }[];
  /** Mesmo telefone entre CRM LUIS e CRM LUIS CLOSER, sem par no ARTHUR: os dois são movidos (só informação). */
  luisCloserMesmoTelefone: { luis: LeadResumo; closer: LeadResumo }[];
  duplicadosSoNoDestino: LeadResumo[][];
  comProtegidas: { lead: LeadResumo; protegido: LeadResumo; motivo: string }[];
  etiquetasACriar: { campo: string; nome: string; cor: string; leads: number }[];
  /** Leads que hoje não têm "Luis" como responsável (e passam a ter). */
  responsavelMuda: number;
  porSdr: { sdr: string; leads: number }[];
  total: { destinoAntes: number; doLuis: number; doCloser: number; arquivados: number; esperadoNoFinal: number };
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));

/** Nome de quadro pra comparar: sem acento/maiúscula/pontuação e sem o que vem entre parênteses ("(após 3 tentativas)"). */
export const chaveDoQuadro = (nome: string): string => normalizaNome(nome.replace(/\([^)]*\)/g, ' '));

/** Primeiro nome pra comparar: a primeira palavra, sem acento, maiúscula nem pontuação. Vazio = não compara. */
export const primeiroNomeDoLead = (nome: unknown): string =>
  normalizaNome(texto(nome).split(/\s+/)[0] ?? '');

/** O que a régua (n8n) lê e grava no card: nunca muda na consolidação. */
export const CAMPOS_DA_REGUA = ['entrou_coluna_em', 'regua', 'regua_etapa', 'regua_status', 'regua_ultimo_envio_em'];
/** Os 8 dígitos finais, quando o telefone serve pra comparar (fora número repetido tipo 99999999). */
const chaveFone = (v: unknown): string => {
  const k = chaveTelefone(texto(v))?.ultimos8 ?? '';
  return /^(\d)\1{7}$/.test(k) ? '' : k;
};
const mesmoFone = (a: Lead, b: Lead) => !!chaveFone(a.telefone) && mesmoTelefone(texto(a.telefone), texto(b.telefone));

/** Colunas que não se "completam" de um card pro outro: identidade, posição, etapa, datas de agenda e controles do sistema. */
const NAO_COMPLETA = new Set([
  'id', 'board_id', 'position', 'created_at', 'updated_at', 'deleted_at', 'delete_reason', 'status', 'notes_count',
  'last_note_preview', 'last_note_at', 'espelho_origem_id', 'espelho_origens_extras',
  'copia_ia_origem_id', 'venda_origem_id', 'movido_em', 'vinculos', 'responsavel',
  // Nunca copiados (regra B).
  'retornar', 'agendamento', 'calendar_event_id',
  // Estado da automação (régua, boas-vindas): é de cada card.
  ...CAMPOS_DA_REGUA, 'boas_vindas_enviada_em', 'boas_vindas_erro', 'meta_lead_id',
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
const DIVERGENCIA_QUE_IMPORTA = new Set(['nome', 'empresa', 'valor_mrr', 'valor_implementacao', ...CAMPOS_DE_ETIQUETA.map(([c]) => c)]);

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
  const abaLuis = luis.length === 1 ? luis[0] : null;
  const origens = [...(abaLuis ? [abaLuis] : []), ...(closer ? [closer] : [])];

  const abaPorId = new Map(abas.map((a) => [a.id, a]));
  const quadroPorId = new Map(quadros.map((q) => [q.id, q]));
  const paginaDo = (l: Lead) => quadroPorId.get(l.board_id)?.page ?? '';
  const idsOrigem = new Set(origens.map((a) => a.id));
  const noEscopo = leads.filter((l) => paginaDo(l) === PAGINA_DESTINO || idsOrigem.has(paginaDo(l)));
  const ativos = noEscopo.filter((l) => !l.deleted_at);
  const protegidos = leads.filter((l) => !l.deleted_at && PAGINAS_PROTEGIDAS.includes(paginaDo(l)));
  const doArthur = ativos.filter((l) => paginaDo(l) === PAGINA_DESTINO);
  const doCloser = ativos.filter((l) => paginaDo(l) === PAGINA_CLOSER);
  const doLuis = abaLuis ? ativos.filter((l) => paginaDo(l) === abaLuis.id) : [];
  const porId = new Map(ativos.map((l) => [l.id, l]));

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
  const quadrosDoDestino = quadros.filter((q) => q.page === PAGINA_DESTINO);
  const destinoDoQuadro = new Map<string, Quadro | null>();
  for (const q of quadrosDoDestino) destinoDoQuadro.set(q.id, q);
  const mapeamento: Plano['mapeamento'] = [];
  for (const aba of origens) {
    for (const q of quadros.filter((x) => x.page === aba.id).sort((a, b) => a.position - b.position)) {
      const chave = chaveDoQuadro(q.name);
      const iguais = quadrosDoDestino.filter((d) => chaveDoQuadro(d.name) === chave);
      const alvo = iguais.length === 1 ? iguais[0] : null;
      destinoDoQuadro.set(q.id, alvo);
      const quantos = ativos.filter((l) => l.board_id === q.id).length;
      const parecidos = alvo ? [] : (iguais.length > 1 ? iguais : quadrosDoDestino.filter((d) => {
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

  const arquivados = new Set<string>();

  // ── A) CRM LUIS CLOSER ──
  const closerArquivados: ParDoCloser[] = [];
  const closerMovidos: LeadResumo[] = [];
  const closerAmbiguos: Plano['closerAmbiguos'] = [];
  for (const c of doCloser) {
    const ligadas = [texto(c.espelho_origem_id), ...(Array.isArray(c.espelho_origens_extras) ? c.espelho_origens_extras.map(texto) : [])]
      .filter(Boolean);
    const origem = ligadas.map((id) => porId.get(id)).find((o) => o && paginaDo(o) === PAGINA_DESTINO);
    if (origem) {
      closerArquivados.push({ closer: resumo(c), arthur: resumo(origem), motivo: 'cópia automática' });
      arquivados.add(c.id);
      continue;
    }
    const pares = doArthur.filter((a) => mesmoFone(c, a));
    if (pares.length === 1) {
      closerArquivados.push({ closer: resumo(c), arthur: resumo(pares[0]), motivo: 'mesmo telefone' });
      arquivados.add(c.id);
    } else if (pares.length > 1) {
      closerAmbiguos.push({ closer: resumo(c), candidatos: pares.map(resumo) });
      problemas.push(`Card do closer ${texto(c.nome) || 'sem nome'} (${texto(c.telefone)}) tem ${pares.length} cards no CRM ARTHUR com o mesmo telefone e não é cópia de nenhum: decidir qual é o par.`);
    } else {
      closerMovidos.push(resumo(c));
    }
  }

  // ── B) CRM LUIS ──
  const luisDuplicados: DuplicadoDoLuis[] = [];
  const luisNomeDiferente: Plano['luisNomeDiferente'] = [];
  const luisAmbiguos: Plano['luisAmbiguos'] = [];
  const luisEtapaDiferente: Plano['luisEtapaDiferente'] = [];
  const sobreviventes = new Map<string, Record<string, unknown>>();
  for (const l of doLuis) {
    const doTelefone = doArthur.filter((a) => mesmoFone(l, a));
    if (!doTelefone.length) continue;
    const nome = primeiroNomeDoLead(l.nome);
    const mesmoNome = nome ? doTelefone.filter((a) => primeiroNomeDoLead(a.nome) === nome) : [];
    if (mesmoNome.length > 1) {
      luisAmbiguos.push({ luis: resumo(l), candidatos: mesmoNome.map(resumo) });
      problemas.push(`Card do CRM LUIS ${texto(l.nome)} (${texto(l.telefone)}) tem ${mesmoNome.length} cards no CRM ARTHUR com o mesmo telefone e o mesmo nome: decidir qual fica.`);
      continue;
    }
    if (!mesmoNome.length) {
      for (const a of doTelefone) luisNomeDiferente.push({ luis: resumo(l), arthur: resumo(a) });
      continue;
    }
    const fica = mesmoNome[0];
    // Etapas diferentes: não junta até decidir; os dois são movidos como estão.
    const etapaDoLuis = destinoDoQuadro.get(l.board_id);
    if (!etapaDoLuis || etapaDoLuis.id !== fica.board_id) {
      luisEtapaDiferente.push({ luis: resumo(l), arthur: resumo(fica), etapaNoDestino: etapaDoLuis?.name ?? null });
      continue;
    }
    arquivados.add(l.id);
    // Só o que está VAZIO no que fica; nada preenchido dele muda (inclusive a etapa).
    const junto = sobreviventes.get(fica.id) ?? { ...fica };
    const completar: DuplicadoDoLuis['completar'] = [];
    const divergentes: DuplicadoDoLuis['divergentes'] = [];
    for (const [campo, valor] of Object.entries(l)) {
      if (NAO_COMPLETA.has(campo) || !completavel(valor)) continue;
      if (vazio(junto[campo])) {
        junto[campo] = valor;
        completar.push({ campo, valor: mostrar(valor) });
      } else if (DIVERGENCIA_QUE_IMPORTA.has(campo) && normalizaNome(String(junto[campo])) !== normalizaNome(String(valor))) {
        divergentes.push({ campo, fica: mostrar(junto[campo]), outro: mostrar(valor) });
      }
    }
    sobreviventes.set(fica.id, junto);
    const alertas: string[] = [];
    if (l.optout === true && fica.optout !== true) alertas.push('o card do CRM LUIS tem opt-out (pediu pra não receber mensagem); o do ARTHUR não');
    if ((l.vinculos['vendas'] ?? 0) > 0 && (fica.vinculos['vendas'] ?? 0) > 0) {
      alertas.push('os dois têm venda registrada: a venda do card que sai fica ligada a ele (só pode haver uma por card)');
    }
    luisDuplicados.push({
      fica: resumo(fica), sai: resumo(l), completar, divergentes, alertas,
    });
  }

  // Mesmo telefone entre LUIS e CLOSER sem par no ARTHUR: os dois vão (só informação).
  const luisCloserMesmoTelefone: Plano['luisCloserMesmoTelefone'] = [];
  for (const l of doLuis.filter((x) => !arquivados.has(x.id))) {
    for (const c of doCloser.filter((x) => !arquivados.has(x.id))) {
      if (mesmoFone(l, c)) luisCloserMesmoTelefone.push({ luis: resumo(l), closer: resumo(c) });
    }
  }

  // Duplicados que já existiam dentro do CRM ARTHUR (não são tocados).
  const duplicadosSoNoDestino: LeadResumo[][] = [];
  const visto = new Set<string>();
  for (const a of doArthur) {
    if (visto.has(a.id)) continue;
    const grupo = doArthur.filter((b) => b.id === a.id || mesmoFone(a, b));
    grupo.forEach((b) => visto.add(b.id));
    if (grupo.length > 1) duplicadosSoNoDestino.push(grupo.map(resumo));
  }

  // ── o que bate com CRM IA LUIZA / CRM TUBARAO (só lista) ──
  const comProtegidas: Plano['comProtegidas'] = [];
  for (const l of [...doLuis, ...doCloser]) {
    for (const p of protegidos) {
      const ligado = texto(l.espelho_origem_id) === p.id || texto(l.copia_ia_origem_id) === p.id
        || texto(p.espelho_origem_id) === l.id || texto(p.copia_ia_origem_id) === l.id;
      const motivo = ligado ? 'cópia automática' : mesmoFone(l, p) ? 'mesmo telefone' : '';
      if (motivo) comProtegidas.push({ lead: resumo(l), protegido: resumo(p), motivo });
    }
  }

  // ── etiquetas que precisam existir no destino (as colunas do sistema são as mesmas em todas as abas) ──
  const temNoDestino = (campo: string, nome: string) => etiquetas.some((e) => e.field === campo
    && (e.page_id === null || e.page_id === PAGINA_DESTINO) && normalizaNome(e.name) === normalizaNome(nome));
  const faltam = new Map<string, Plano['etiquetasACriar'][number]>();
  const queChegam = ativos.filter((l) => !arquivados.has(l.id) && (paginaDo(l) !== PAGINA_DESTINO || sobreviventes.has(l.id)));
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
    closerArquivados,
    closerMovidos,
    closerAmbiguos,
    luisDuplicados,
    luisNomeDiferente,
    luisAmbiguos,
    luisEtapaDiferente,
    luisCloserMesmoTelefone,
    duplicadosSoNoDestino,
    comProtegidas,
    etiquetasACriar: [...faltam.values()],
    responsavelMuda: finais.filter((l) => normalizaNome(texto(l.responsavel)) !== 'luis').length,
    porSdr: [...porSdr].map(([sdr, n]) => ({ sdr, leads: n })).sort((a, b) => b.leads - a.leads),
    total: {
      destinoAntes: doArthur.length, doLuis: doLuis.length, doCloser: doCloser.length, arquivados: arquivados.size,
      esperadoNoFinal: doArthur.length + doLuis.length + doCloser.length - arquivados.size,
    },
  };
}
