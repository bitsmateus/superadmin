/**
 * O briefing de onboarding: as 27 perguntas (blocos 1 a 7). Os acessos e materiais (bloco 8 do documento original)
 * têm campos próprios na aba Briefing, então não entram aqui.
 *
 * Onde há `indicador`, a resposta precisa de número (R$, %, quantidade ou prazo). Se o cliente não souber,
 * escreve-se "não sabe": isso já é um diagnóstico.
 */
export interface PerguntaDoBriefing {
  bloco: string
  pergunta: string
  /** Por que a pergunta importa. */
  porque: string
  /** O número que a resposta precisa trazer. */
  indicador?: string
}

export const BRIEFING_MODELO: PerguntaDoBriefing[] = [
  // ---------------------------------------------------------------- Bloco 1
  {
    bloco: 'Bloco 1 — Negócio e oferta',
    pergunta: 'O que você vende (produtos/serviços) e qual é o carro-chefe?',
    porque: 'Define o que entra na campanha primeiro.',
  },
  {
    bloco: 'Bloco 1 — Negócio e oferta',
    pergunta: 'Qual o ticket médio e a margem de cada item?',
    porque: 'Define quanto pode pagar por cliente (CAC máximo).',
    indicador: 'ticket médio (R$) e margem (%)',
  },
  {
    bloco: 'Bloco 1 — Negócio e oferta',
    pergunta: 'Qual o ciclo de decisão: compra na hora, em dias ou em meses?',
    porque: 'Define se o foco é venda direta ou nutrição.',
    indicador: 'tempo entre o 1º contato e a compra (dias)',
  },
  {
    bloco: 'Bloco 1 — Negócio e oferta',
    pergunta: 'Há sazonalidade? Quais meses vendem mais e menos?',
    porque: 'Planeja verba e campanhas ao longo do ano.',
    indicador: 'faturamento dos meses de pico e de baixa (R$)',
  },
  {
    bloco: 'Bloco 1 — Negócio e oferta',
    pergunta: 'Qual seu principal diferencial frente à concorrência?',
    porque: 'Vira ângulo de anúncio e argumento de venda.',
  },
  {
    bloco: 'Bloco 1 — Negócio e oferta',
    pergunta: 'Existem promoções, condições ou garantias que já funcionam?',
    porque: 'Oferta pronta para testar em campanha.',
  },
  // ---------------------------------------------------------------- Bloco 2
  {
    bloco: 'Bloco 2 — Ponto A: onde o cliente está hoje',
    pergunta: 'Quanto fatura por mês hoje? E nos melhores e piores meses dos últimos 12?',
    porque: 'É o ponto de partida de toda meta.',
    indicador: 'faturamento mensal (R$): atual, melhor e pior mês',
  },
  {
    bloco: 'Bloco 2 — Ponto A: onde o cliente está hoje',
    pergunta: 'De onde vêm os clientes hoje (indicação, orgânico, ponto físico, anúncio, WhatsApp)? Em que proporção?',
    porque: 'Mostra de onde vem a venda e onde está a dependência.',
    indicador: '% de vendas por origem',
  },
  {
    bloco: 'Bloco 2 — Ponto A: onde o cliente está hoje',
    pergunta: 'Qual a maior dor: falta lead, sobra lead ruim ou o lead não fecha?',
    porque: 'A resposta muda toda a estratégia.',
  },
  // ---------------------------------------------------------------- Bloco 3
  {
    bloco: 'Bloco 3 — Ponto B: metas de 6 e 12 meses',
    pergunta: 'Qual faturamento mensal você quer daqui a 6 meses? E daqui a 12?',
    porque: 'Meta sem número vira frustração; é a base do cálculo reverso.',
    indicador: 'faturamento mensal desejado (R$) em 6 e 12 meses',
  },
  {
    bloco: 'Bloco 3 — Ponto B: metas de 6 e 12 meses',
    pergunta: 'Qual verba de mídia aceita investir para chegar nessa meta?',
    porque: 'Alinha expectativa de investimento com a meta.',
    indicador: 'verba mensal de mídia (R$) em 6 e 12 meses',
  },
  // ---------------------------------------------------------------- Bloco 4
  {
    bloco: 'Bloco 4 — Processo comercial e rotina',
    pergunta: 'Por onde chegam os contatos (WhatsApp, ligação, formulário, direct, loja)?',
    porque: 'Define o destino das campanhas.',
  },
  {
    bloco: 'Bloco 4 — Processo comercial e rotina',
    pergunta: 'Quem responde os contatos? Uma pessoa, equipe ou o próprio dono? Em que horários?',
    porque: 'Define a capacidade real de atendimento.',
    indicador: 'nº de atendentes e horário de atendimento',
  },
  {
    bloco: 'Bloco 4 — Processo comercial e rotina',
    pergunta: 'Em quanto tempo o primeiro contato é respondido? E fora do horário comercial?',
    porque: 'Lead respondido depois de 1 hora esfria rápido.',
    indicador: 'tempo médio de 1ª resposta (minutos)',
  },
  {
    bloco: 'Bloco 4 — Processo comercial e rotina',
    pergunta: 'Existe script, perguntas de qualificação ou proposta padrão?',
    porque: 'Atendimento sem roteiro desperdiça lead.',
  },
  {
    bloco: 'Bloco 4 — Processo comercial e rotina',
    pergunta: 'O que acontece com quem não fecha na hora? Quantas tentativas de retorno são feitas?',
    porque: 'Follow-up recupera vendas que o anúncio já pagou.',
    indicador: 'nº de tentativas de retorno por lead',
  },
  {
    bloco: 'Bloco 4 — Processo comercial e rotina',
    pergunta: 'Por que os clientes dizem não (preço, prazo, confiança, concorrente)?',
    porque: 'As objeções viram argumento nos anúncios.',
  },
  // ---------------------------------------------------------------- Bloco 5
  {
    bloco: 'Bloco 5 — CRM, ferramentas e rastreamento',
    pergunta: 'Os contatos e vendas são anotados em algum lugar? Onde?',
    porque: 'Sem registro não há como medir resultado.',
  },
  {
    bloco: 'Bloco 5 — CRM, ferramentas e rastreamento',
    pergunta: 'Existe funil com etapas (novo, em atendimento, proposta, fechado, perdido)?',
    porque: 'Permite achar onde os leads travam.',
  },
  // ---------------------------------------------------------------- Bloco 6
  {
    bloco: 'Bloco 6 — Histórico de tráfego e marketing',
    pergunta: 'Já fez tráfego pago? Se sim, em quais plataformas e por quanto tempo?',
    porque: 'Define o ponto de partida: aprender com o histórico ou começar do zero.',
    indicador: 'tempo de investimento (meses)',
  },
  {
    bloco: 'Bloco 6 — Histórico de tráfego e marketing',
    pergunta: 'Qual era a verba mensal e qual foi o resultado (leads, vendas, custo por contato)?',
    porque: 'Dá o parâmetro de custo para comparar.',
    indicador: 'verba (R$), custo por lead (R$) e custo por venda (R$)',
  },
  // ---------------------------------------------------------------- Bloco 7
  {
    bloco: 'Bloco 7 — Público, concorrência e posicionamento',
    pergunta: 'Quem é o melhor cliente atual (perfil, idade, região, o que compra, quanto gasta)?',
    porque: 'É o público que a campanha deve replicar.',
  },
  {
    bloco: 'Bloco 7 — Público, concorrência e posicionamento',
    pergunta: 'E o pior cliente, o que dá mais trabalho e menos retorno?',
    porque: 'Define quem a campanha deve evitar.',
  },
  {
    bloco: 'Bloco 7 — Público, concorrência e posicionamento',
    pergunta: 'Qual problema ou desejo leva a pessoa a procurar você? O que ela pesquisa antes de comprar?',
    porque: 'Vira ângulo de anúncio e palavras-chave.',
  },
  {
    bloco: 'Bloco 7 — Público, concorrência e posicionamento',
    pergunta: 'Quais objeções aparecem com mais frequência (preço, confiança, prazo, localização)?',
    porque: 'O anúncio já deve quebrar a objeção.',
  },
  {
    bloco: 'Bloco 7 — Público, concorrência e posicionamento',
    pergunta: 'Por que o cliente escolhe você e não o concorrente? Por que às vezes escolhe o concorrente?',
    porque: 'Revela o diferencial real e as fraquezas.',
  },
  {
    bloco: 'Bloco 7 — Público, concorrência e posicionamento',
    pergunta: 'Quem são os 3 principais concorrentes (nome e perfil nas redes)?',
    porque: 'Base para análise e diferenciação.',
  },
]

/**
 * Junta o que está salvo com o modelo: as 27 perguntas sempre aparecem, na ordem do modelo, com a resposta já
 * dada (casando pelo texto da pergunta); o que a equipe acrescentou por conta própria vem depois.
 */
export function comModeloDoBriefing(salvas: { pergunta: string; resposta: string }[]): { pergunta: string; resposta: string }[] {
  const porTexto = new Map(salvas.map((p) => [p.pergunta, p.resposta]))
  const doModelo = BRIEFING_MODELO.map((m) => ({ pergunta: m.pergunta, resposta: porTexto.get(m.pergunta) ?? '' }))
  const nomes = new Set(BRIEFING_MODELO.map((m) => m.pergunta))
  return [...doModelo, ...salvas.filter((p) => !nomes.has(p.pergunta))]
}
