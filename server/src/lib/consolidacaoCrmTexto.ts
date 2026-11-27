/** O relatório da simulação em texto (Markdown simples), pra ler na tela, copiar e guardar. */
import type { LeadResumo, Plano } from './consolidacaoCrm.js';

export interface ReferenciasDoBanco {
  pessoas: { nome: string; papel: string; veODestino: boolean | null }[];
  doArthur: { item: string; quantos: number }[];
  ambiente: { variavel: string; valor: string }[];
}

const dia = (iso: string) => (iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—');
const quem = (l: LeadResumo) => [l.nome || l.empresa || 'sem nome', l.telefone].filter(Boolean).join(' · ');
const onde = (l: LeadResumo) => `${l.aba} / ${l.quadro}${l.sdr ? ` · SDR ${l.sdr}` : ''}${l.copiaAutomatica ? ' · cópia automática' : ''}`;
const ligados = (l: LeadResumo) => Object.entries(l.vinculos).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'nada ligado';

export function textoDoRelatorio(p: Plano, r: ReferenciasDoBanco, geradoEm: string): string {
  const L: string[] = [];
  const titulo = (t: string) => L.push('', `## ${t}`);
  const nenhum = (n: number) => { if (!n) L.push('- nenhum'); };
  L.push(`# Simulação da consolidação dos CRMs — ${dia(geradoEm)}`, 'NADA FOI ALTERADO.');
  if (p.destino) L.push(`Destino: ${p.destino.nomeAtual} (id ${p.destino.id}) → passa a se chamar ${p.destino.nomeNovo}.`);
  L.push(`Origens: ${p.origens.map((o) => `${o.nome} (${o.id})`).join(', ') || '—'}.`);
  L.push('Nenhum card do CRM ARTHUR muda de etapa. Régua (entrou_coluna_em, regua_*) preservada em todos. Comissão não é recalculada.');
  L.push('Lixeira e duplicados antigos do CRM ARTHUR, CRM IA LUIZA e CRM TUBARAO: sem mexer.');

  titulo(`O que impede a execução (${p.problemas.length})`);
  L.push(...(p.problemas.length ? p.problemas.map((x) => `- ${x}`) : ['- nada']));

  titulo('Total esperado no CRM de destino');
  const t = p.total;
  L.push(`${t.destinoAntes} já no destino + ${t.doLuis} do CRM LUIS + ${t.doCloser} do CRM LUIS CLOSER − ${t.arquivados} arquivado(s) = ${t.esperadoNoFinal}`);
  L.push(`Arquivados: ${p.closerArquivados.length} do closer (par no ARTHUR) + ${p.luisDuplicados.length} do CRM LUIS (duplicado confirmado).`);
  L.push(`Coluna SDR não muda: ${p.porSdr.map((s) => `${s.sdr} ${s.leads}`).join(', ') || '—'}.`);
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

  titulo(`A) CRM LUIS CLOSER com par no CRM ARTHUR (${p.closerArquivados.length}) — closer arquivado, card do ARTHUR sem nenhuma mudança`);
  for (const c of p.closerArquivados) {
    L.push(`- ${quem(c.closer)} [${c.closer.quadro}] → ${onde(c.arthur)} (${c.motivo}) · histórico do closer vai pro ARTHUR: ${ligados(c.closer)}`);
  }
  nenhum(p.closerArquivados.length);

  titulo(`A) CRM LUIS CLOSER sem par (${p.closerMovidos.length}) — movidos como estão`);
  for (const c of p.closerMovidos) L.push(`- ${quem(c)} [${c.quadro}]${c.copiaAutomatica ? ' · cópia automática (origem fora do CRM ARTHUR)' : ''}`);
  nenhum(p.closerMovidos.length);

  if (p.closerAmbiguos.length) {
    titulo(`A) Closer com mais de um par possível (${p.closerAmbiguos.length}) — DECIDIR`);
    for (const c of p.closerAmbiguos) L.push(`- ${quem(c.closer)} [${c.closer.quadro}] ↔ ${c.candidatos.map((x) => `${x.nome || 'sem nome'} [${x.quadro}]`).join(' | ')}`);
  }

  titulo(`B) CRM LUIS duplicado confirmado — mesmo telefone e mesmo nome (${p.luisDuplicados.length})`);
  p.luisDuplicados.forEach((d, i) => {
    L.push('', `${i + 1}. ${quem(d.fica)}${d.alertas.length ? ` — ATENÇÃO: ${d.alertas.join('; ')}` : ''}`);
    L.push(`   fica: ${onde(d.fica)} [${ligados(d.fica)}] — etapa e campos preenchidos não mudam`);
    L.push(`   sai:  ${onde(d.sai)} [${ligados(d.sai)}] (arquivado, histórico vai pro que fica)`);
    if (d.completar.length) L.push(`   completa (estava vazio): ${d.completar.map((c) => `${c.campo} = ${c.valor}`).join(' | ')}`);
    if (d.divergentes.length) L.push(`   diferentes (vale o do ARTHUR): ${d.divergentes.map((c) => `${c.campo}: "${c.fica}" x "${c.outro}"`).join(' | ')}`);
  });
  nenhum(p.luisDuplicados.length);

  const etapas = p.luisDuplicados.filter((d) => d.etapaDiferente);
  titulo(`B) Etapa diferente (${etapas.length}) — a etapa NÃO muda; decidir caso a caso`);
  for (const d of etapas) L.push(`- ${d.fica.nome || d.sai.nome} · ${d.fica.telefone}: CRM ARTHUR em "${d.fica.quadro}" x CRM LUIS em "${d.sai.quadro}"`);
  nenhum(etapas.length);

  titulo(`B) Mesmo telefone, nome diferente (${p.luisNomeDiferente.length}) — NÃO junta, os dois ficam; decidir`);
  for (const x of p.luisNomeDiferente) L.push(`- CRM LUIS: ${quem(x.luis)} [${x.luis.quadro}] · CRM ARTHUR: ${x.arthur.nome || 'sem nome'} [${x.arthur.quadro}]`);
  nenhum(p.luisNomeDiferente.length);

  if (p.luisAmbiguos.length) {
    titulo(`B) Mais de um card do ARTHUR com mesmo telefone e nome (${p.luisAmbiguos.length}) — DECIDIR`);
    for (const x of p.luisAmbiguos) L.push(`- ${quem(x.luis)} [${x.luis.quadro}] ↔ ${x.candidatos.map((c) => `[${c.quadro}]`).join(' | ')}`);
  }

  titulo(`Mesmo telefone entre CRM LUIS e CRM LUIS CLOSER, sem par no ARTHUR (${p.luisCloserMesmoTelefone.length}) — os dois são movidos`);
  for (const x of p.luisCloserMesmoTelefone) L.push(`- ${quem(x.luis)} [LUIS / ${x.luis.quadro}] · ${x.closer.nome || 'sem nome'} [CLOSER / ${x.closer.quadro}]`);
  nenhum(p.luisCloserMesmoTelefone.length);

  titulo(`Duplicados que já existem dentro do CRM ARTHUR (${p.duplicadosSoNoDestino.length}) — não são tocados`);
  for (const g of p.duplicadosSoNoDestino) L.push(`- ${g.map((l) => `${quem(l)} [${l.quadro}]`).join('  ==  ')}`);
  nenhum(p.duplicadosSoNoDestino.length);

  titulo(`Batem com CRM IA LUIZA / CRM TUBARAO (${p.comProtegidas.length}) — nesses nada é alterado`);
  for (const c of p.comProtegidas) L.push(`- ${quem(c.lead)} [${c.lead.aba} / ${c.lead.quadro}] ↔ ${c.protegido.aba} / ${c.protegido.quadro} (${c.motivo})`);
  nenhum(p.comProtegidas.length);

  titulo('Colunas e etiquetas');
  L.push('As colunas do quadro são do sistema, iguais em todas as abas: nenhuma coluna precisa ser criada.');
  L.push(...(p.etiquetasACriar.length
    ? p.etiquetasACriar.map((e) => `- criar etiqueta de ${e.campo}: "${e.nome}" (${e.cor}) — ${e.leads} lead(s)`)
    : ['- nenhuma etiqueta a criar']));

  titulo('Usuários e registros ligados ao Arthur');
  for (const x of r.pessoas) L.push(`- ${x.nome} (${x.papel})${x.veODestino === null ? '' : ` — ${x.veODestino ? 'vê o destino' : 'NÃO vê o destino'}`}`);
  for (const x of r.doArthur) L.push(`- ${x.item}: ${x.quantos}`);
  L.push('Suspender ou remover o usuário na Equipe não apaga nada disso.');
  for (const x of r.ambiente) L.push(`- variável do servidor ${x.variavel} = ${x.valor}`);
  return L.join('\n');
}
