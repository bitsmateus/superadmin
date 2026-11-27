/** O relatório da simulação em texto (Markdown simples), pra ler na tela, copiar e guardar. */
import type { LeadResumo, Plano } from './consolidacaoCrm.js';

export interface ReferenciasDoBanco {
  pessoas: { nome: string; papel: string; veODestino: boolean | null }[];
  doArthur: { item: string; quantos: number }[];
  rotina: { pagina: string; blocos: number }[];
  /** Prévia da rotina do CRM unificado (SDR + closer, sem item repetido). */
  rotinaJunta: { inicio: string; fim: string; titulo: string; itens: string[] }[];
  ambiente: { variavel: string; valor: string }[];
}

const dia = (iso: string) => (iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—');
const quem = (l: LeadResumo) => [l.nome || l.empresa || 'sem nome', l.telefone, l.email].filter(Boolean).join(' · ');
const onde = (l: LeadResumo) => `${l.aba} / ${l.quadro}${l.sdr ? ` · SDR ${l.sdr}` : ''}${l.copiaAutomatica ? ' · cópia automática' : ''}`;
const ligados = (l: LeadResumo) => Object.entries(l.vinculos).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'nada ligado';

export function textoDoRelatorio(p: Plano, r: ReferenciasDoBanco, geradoEm: string): string {
  const L: string[] = [];
  const titulo = (t: string) => L.push('', `## ${t}`);
  L.push(`# Simulação da consolidação dos CRMs — ${dia(geradoEm)}`, 'NADA FOI ALTERADO.');
  if (p.destino) L.push(`Destino: ${p.destino.nomeAtual} (id ${p.destino.id}) → passa a se chamar ${p.destino.nomeNovo}.`);
  L.push(`Origens: ${p.origens.map((o) => `${o.nome} (${o.id})`).join(', ') || '—'}.`);

  titulo(`O que impede a execução (${p.problemas.length})`);
  L.push(...(p.problemas.length ? p.problemas.map((x) => `- ${x}`) : ['- nada']));

  titulo('Total esperado no CRM de destino');
  const t = p.total;
  L.push(`${t.destinoAntes} já no destino + ${t.doLuis} do CRM LUIS + ${t.doCloser} do CRM LUIS CLOSER − ${t.arquivados} duplicado(s) arquivado(s) = ${t.esperadoNoFinal}`);
  L.push(`Responsável passa a ser Luis em ${p.responsavelMuda} lead(s). Coluna SDR não muda: ${p.porSdr.map((s) => `${s.sdr} ${s.leads}`).join(', ') || '—'}.`);
  L.push(`Não são tocados: ${p.protegidas.map((x) => `${x.nome} (${x.leads} leads)`).join(', ') || '—'}.`);

  titulo('Ids das abas e dos quadros');
  for (const a of p.ids) {
    L.push(`- ${a.aba}: ${a.id}`);
    for (const q of a.quadros) L.push(`    ${q.nome}: ${q.id}`);
  }

  titulo('Leads por aba e quadro');
  for (const c of p.contagem) L.push(`- ${c.aba} / ${c.quadro}: ${c.ativos}${c.naLixeira ? ` (+${c.naLixeira} na lixeira, ficam onde estão)` : ''}`);

  titulo('Para onde vai cada quadro');
  for (const m of p.mapeamento) {
    L.push(`- ${m.aba} / ${m.quadro} (${m.leads}) → ${m.destino ?? `SEM CORRESPONDENTE${m.parecidos.length ? ` (parecido: ${m.parecidos.join(', ')})` : ''}`}`);
  }

  titulo(`Duplicados (${p.duplicados.length} grupo(s))`);
  p.duplicados.forEach((d, i) => {
    L.push('', `${i + 1}. ${quem(d.fica)} — ${d.motivos.join(', ')}${d.alertas.length ? ` — ATENÇÃO: ${d.alertas.join('; ')}` : ''}`);
    L.push(`   fica:  ${onde(d.fica)} [${ligados(d.fica)}]`);
    for (const s of d.saem) L.push(`   sai:   ${onde(s)} · ${quem(s)} [${ligados(s)}] (arquivado, histórico vai pro que fica)`);
    for (const s of d.intocadosNoDestino) L.push(`   também no destino, não é tocado: ${onde(s)} · ${quem(s)}`);
    L.push(`   etapa final: ${d.etapaFinal.quadro ?? '?'} (movimento mais recente: ${d.etapaFinal.vemDe}, ${dia(d.etapaFinal.quando)})`);
    if (d.completar.length) L.push(`   completa: ${d.completar.map((c) => `${c.campo} = ${c.valor}`).join(' | ')}`);
    if (d.divergentes.length) L.push(`   diferentes (vale o do que fica): ${d.divergentes.map((c) => `${c.campo}: "${c.fica}" x "${c.outro}"`).join(' | ')}`);
  });
  if (!p.duplicados.length) L.push('- nenhum');

  titulo(`Duplicados que já existem dentro do próprio destino (${p.duplicadosSoNoDestino.length}) — não são tocados`);
  for (const g of p.duplicadosSoNoDestino) L.push(`- ${g.map((l) => `${quem(l)} [${l.quadro}]`).join('  ==  ')}`);
  if (!p.duplicadosSoNoDestino.length) L.push('- nenhum');

  titulo(`Batem com CRM IA LUIZA / CRM TUBARAO (${p.comProtegidas.length}) — nesses nada é alterado`);
  for (const c of p.comProtegidas) L.push(`- ${quem(c.lead)} [${c.lead.aba} / ${c.lead.quadro}] ↔ ${c.protegido.aba} / ${c.protegido.quadro} (${c.motivo})`);
  if (!p.comProtegidas.length) L.push('- nenhum');

  titulo('Colunas e etiquetas');
  L.push('As colunas do quadro são do sistema, iguais em todas as abas: nenhuma coluna precisa ser criada.');
  L.push(...(p.etiquetasACriar.length
    ? p.etiquetasACriar.map((e) => `- criar etiqueta de ${e.campo}: "${e.nome}" (${e.cor}) — ${e.leads} lead(s)`)
    : ['- nenhuma etiqueta a criar']));

  titulo('Usuários e registros ligados ao Arthur');
  for (const x of r.pessoas) L.push(`- ${x.nome} (${x.papel})${x.veODestino === null ? '' : ` — ${x.veODestino ? 'vê o destino' : 'NÃO vê o destino'}`}`);
  for (const x of r.doArthur) L.push(`- ${x.item}: ${x.quantos}`);
  L.push('Suspender ou remover o usuário na Equipe não apaga nada disso.');
  for (const x of r.rotina) L.push(`- rotina da aba ${x.pagina}: ${x.blocos} bloco(s)`);
  for (const x of r.ambiente) L.push(`- variável do servidor ${x.variavel} = ${x.valor}`);

  titulo('Rotina junta (SDR + closer, sem item repetido) — prévia');
  for (const b of r.rotinaJunta) {
    L.push(`- ${b.inicio}–${b.fim} ${b.titulo}`);
    for (const i of b.itens) L.push(`    · ${i}`);
  }
  return L.join('\n');
}
