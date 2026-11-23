/**
 * Nota interna com o que o cliente respondeu no briefing (pedido de 23/11): quando o cliente envia o briefing (ou completa as
 * pendências), o time de suporte vê o mesmo conteúdo também na aba "Notas internas" do cliente, além da aba Briefing.
 *
 * SENHAS e tokens nunca vão pra nota: ficam só nos campos próprios do briefing.
 */

type Obj = Record<string, unknown>;

/** Id fixo: um reenvio do briefing atualiza essa nota em vez de empilhar uma nova a cada vez. */
export const ID_NOTA_BRIEFING = 'briefing-cliente';

const ehObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

const SIM_NAO = (v: unknown): string => (v === true ? 'Sim' : v === false ? 'Não' : '');

const TOM: Record<string, string> = { formal: 'Formal', casual: 'Casual', tecnico: 'Técnico' };

function valor(v: unknown): string {
  if (typeof v === 'boolean') return SIM_NAO(v);
  if (Array.isArray(v)) return v.map(texto).filter(Boolean).join(', ');
  return texto(v);
}

function linhaDeCampos(d: Obj, campos: [string, string][]): string[] {
  const out: string[] = [];
  for (const [chave, rotulo] of campos) {
    const v = valor(d[chave]);
    if (v) out.push(`${rotulo}: ${v}`);
  }
  return out;
}

function secao(titulo: string, linhas: string[]): string[] {
  return linhas.length ? ['', titulo.toUpperCase(), ...linhas] : [];
}

/** O texto da nota a partir do briefing_data. Vazio se o cliente não respondeu nada que valha mostrar. */
export function textoDaNotaDoBriefing(data: unknown, quando: Date = new Date()): string {
  if (!ehObj(data)) return '';
  const d = data;

  const empresa = linhaDeCampos(d, [
    ['razaoSocial', 'Razão social'], ['nomeFantasia', 'Nome fantasia'], ['cnpj', 'CNPJ'], ['site', 'Site'],
  ]);

  const usuarios = (Array.isArray(d.users) ? d.users : []).filter(ehObj).map((u) => {
    const setores = Array.isArray(u.sectors) && u.sectors.length ? u.sectors.map(texto).filter(Boolean).join(', ') : texto(u.sector);
    const partes = [texto(u.email), setores && `setor: ${setores}`, texto(u.role)].filter(Boolean);
    return `• ${texto(u.name) || 'Sem nome'}${partes.length ? ` — ${partes.join(' · ')}` : ''}`;
  });

  const horarios = (Array.isArray(d.schedule) ? d.schedule : []).filter(ehObj)
    .filter((s) => s.active === true && texto(s.day))
    .map((s) => `• ${texto(s.day)}: ${texto(s.start)} às ${texto(s.end)}`);
  const fuso = texto(d.timezone);

  const whatsapp = linhaDeCampos(d, [['whatsappNumbers', 'Números'], ['whatsappType', 'Tipo de conexão'], ['useFacebook', 'Usa Facebook/Meta']]);
  const oa = ehObj(d.officialApi) ? linhaDeCampos(d.officialApi, [
    ['businessPortfolioName', 'Portfólio empresarial (Meta)'], ['numeroDedicado', 'Número dedicado'], ['displayNamePretendido', 'Nome no WhatsApp'],
    ['verificacaoNegocioStatus', 'Verificação do negócio'], ['partnerAccessStatus', 'Partner access'],
  ]) : [];
  const canais = ehObj(d.channelAccess) ? Object.keys(d.channelAccess).filter(Boolean) : [];

  const fluxo = ehObj(d.chatbotFlow) ? d.chatbotFlow : null;
  const atendimento = [
    ...linhaDeCampos(d, [['departments', 'Setores'], ['greetingMessage', 'Mensagem de boas-vindas']]),
    ...(d.offHoursEnabled === false ? ['Mensagem fora do horário: não enviar'] : linhaDeCampos(d, [['offHoursMessage', 'Mensagem fora do horário']])),
    ...(fluxo ? linhaDeCampos(fluxo, [['description', 'Como o atendimento deve funcionar'], ['collectFields', 'Dados a coletar'], ['closingMessage', 'Mensagem de encerramento']]) : []),
    ...(fluxo && Array.isArray(fluxo.transfers)
      ? fluxo.transfers.filter(ehObj).map((t) => `• Opção "${texto(t.option)}" → ${texto(t.department)}`).filter((l) => !l.includes('"" →'))
      : []),
    ...linhaDeCampos(d, [['mainFlow', 'Fluxo principal (antigo)']]),
  ];

  const ia = [
    ...(d.useAI === true || d.useAI === false ? [`Usa IA: ${SIM_NAO(d.useAI)}`] : []),
    ...(texto(d.aiTone) ? [`Tom: ${TOM[texto(d.aiTone)] ?? texto(d.aiTone)}`] : []),
    ...linhaDeCampos(d, [
      ['aiAgentName', 'Nome do agente'], ['aiCompanyDescription', 'Sobre a empresa'], ['aiServices', 'Serviços/produtos'], ['aiHasPrices', 'Passa preços'],
      ['aiPrices', 'Preços'], ['aiLocation', 'Localização'], ['aiAddress', 'Endereço'], ['aiSocialMedia', 'Redes sociais'], ['aiSlogan', 'Frase da empresa'],
      ['aiMostSought', 'Mais procurados'], ['aiPartnerships', 'Convênios e parcerias'], ['aiPaymentMethods', 'Formas de pagamento'], ['aiPromotions', 'Promoções'],
      ['aiAttendanceFlow', 'Fluxo de atendimento'], ['aiFirstMessage', 'Primeira mensagem'], ['aiSchedulingData', 'Dados pra agendar'],
      ['aiPostDataMessage', 'Mensagem depois dos dados'], ['aiExistingClient', 'Quando já é cliente'], ['aiTransferConditions', 'Quando transferir'],
      ['aiWhenUnknown', 'Quando não sabe'], ['aiFaq', 'Perguntas frequentes'], ['aiInstructions', 'Instruções'], ['aiRestrictions', 'Restrições'],
      ['aiExternalSystem', 'Sistema externo'], ['aiExternalApiUrl', 'API do sistema'], ['aiExternalWhatToQuery', 'O que consultar'], ['aiExternalExamples', 'Exemplos'],
    ]),
  ];

  const site = linhaDeCampos(d, [
    ['siteCompanyName', 'Nome da empresa'], ['siteType', 'Tipo de site'], ['siteGoals', 'Objetivos'], ['siteGoalsOther', 'Outro objetivo'],
    ['siteTargetAudience', 'Público-alvo'], ['siteHasLogo', 'Tem logo'], ['siteColors', 'Cores'], ['siteHasDomain', 'Tem domínio'], ['siteDomain', 'Domínio'],
    ['sitePages', 'Páginas'], ['sitePagesOther', 'Outras páginas'], ['siteFeatures', 'Funcionalidades'], ['siteReferences', 'Referências'], ['siteAbout', 'Sobre'],
    ['siteServices', 'Serviços'], ['siteDifferentials', 'Diferenciais'], ['siteContactWhatsapp', 'WhatsApp do site'], ['siteContactEmail', 'E-mail do site'],
    ['siteAddress', 'Endereço'], ['siteHours', 'Horário'], ['siteHasTexts', 'Tem textos'], ['siteHasPhotos', 'Tem fotos'], ['siteTestimonials', 'Depoimentos'],
    ['siteSocialMedia', 'Redes sociais'],
  ]);

  const outros = [
    ...linhaDeCampos(d, [
      ['wavoipInfo', 'Wavoip'], ['olxInfo', 'OLX'], ['mercadolivreInfo', 'Mercado Livre'], ['emailConfig', 'E-mail'], ['externalAutomationInfo', 'Automação externa'],
      ['extraNotes', 'Observações'],
    ]),
    ...(ehObj(d.customAnswers) ? Object.entries(d.customAnswers).map(([k, v]) => [k, texto(v)]).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`) : []),
    ...(canais.length ? [`Acessos por canal informados: ${canais.join(', ')} (as senhas ficam só na aba Briefing)`] : []),
  ];

  const corpo = [
    ...secao('Empresa', empresa),
    ...secao('Atendentes', usuarios),
    ...secao('Horário de atendimento', horarios.length && fuso ? [...horarios, `Fuso: ${fuso}`] : horarios),
    ...secao('WhatsApp', [...whatsapp, ...oa]),
    ...secao('Atendimento e chatbot', atendimento),
    ...secao('IA', ia),
    ...secao('Site', site),
    ...secao('Outras informações', outros),
  ];
  if (!corpo.length) return '';

  const dataTexto = quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  return [`📋 BRIEFING PREENCHIDO PELO CLIENTE — ${dataTexto}`, ...corpo, '', 'Senhas e tokens não aparecem aqui: veja na aba Briefing.'].join('\n');
}

/** A lista de notas do cliente com a nota do briefing atualizada (a antiga sai e a nova entra no topo). */
export function comNotaDoBriefing(notas: unknown, data: unknown, quando: Date = new Date()): unknown[] {
  const atuais = (Array.isArray(notas) ? notas : []).filter((n) => !(ehObj(n) && n.id === ID_NOTA_BRIEFING));
  const text = textoDaNotaDoBriefing(data, quando);
  if (!text) return atuais;
  return [
    { id: ID_NOTA_BRIEFING, text, author: 'Cliente (briefing)', createdAt: quando.toISOString(), internal: true, origem: 'notas_internas' },
    ...atuais,
  ];
}
