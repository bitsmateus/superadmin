/**
 * Tela inicial (src/pages/InicioPage.tsx): o catálogo de telas do sistema, as páginas recentes e o que cada pessoa
 * escolheu (3 atalhos + acesso rápido). Funções puras — quem diz se a pessoa PODE abrir uma tela é quem chama
 * (as mesmas regras do ProtectedRoute), então aqui nada aparece que ela não abriria.
 */

export type GrupoDaPagina = 'Suporte' | 'Comercial' | 'Demandas' | 'NX Digital' | 'Demo Studio' | 'Gestão' | 'Sistema'

/** Nome do ícone (lucide) — a tela traduz. Fica como texto pra este arquivo continuar puro (e testável). */
export type IconeDaPagina =
  | 'dashboard' | 'tarefas' | 'pipeline' | 'clientes' | 'followups' | 'agenda' | 'atendimento' | 'canais' | 'tenants'
  | 'comunicados' | 'tickets' | 'templates' | 'arquivados' | 'crm' | 'demandas' | 'grafico' | 'trafego' | 'kanban'
  | 'social' | 'demo' | 'vendas' | 'contrato' | 'pontos' | 'gestao' | 'comando' | 'equipe' | 'performance'
  | 'configuracoes' | 'relatorios' | 'nps' | 'risco'

export interface PaginaDoSistema {
  to: string
  label: string
  grupo: GrupoDaPagina
  icone: IconeDaPagina
  descricao: string
}

export interface AbaDoComercial { id: string; name: string; section: 'comercial' | 'demandas'; noPipeline?: boolean }
export interface CopiaDoSuporte { id: string; name: string; sourceKey: string }

const p = (to: string, label: string, grupo: GrupoDaPagina, icone: IconeDaPagina, descricao: string): PaginaDoSistema =>
  ({ to, label, grupo, icone, descricao })

/** Telas fixas (as abas do Comercial/Demandas e as cópias do Suporte entram em `catalogoDePaginas`). */
export const PAGINAS_FIXAS: PaginaDoSistema[] = [
  p('/dashboard-suporte', 'Dashboard Suporte', 'Suporte', 'dashboard', 'Indicadores e fila do suporte'),
  p('/tarefas', 'Tarefas', 'Suporte', 'tarefas', 'Tarefas e lembretes do suporte'),
  p('/pipeline', 'Pipeline', 'Suporte', 'pipeline', 'Clientes por etapa da implantação'),
  p('/clients', 'Clientes', 'Suporte', 'clientes', 'Cadastro e ficha dos clientes'),
  p('/followups', 'Follow-ups', 'Suporte', 'followups', 'Follow-ups depois da entrega'),
  p('/agenda', 'Agenda', 'Suporte', 'agenda', 'Reuniões e compromissos'),
  p('/atendimento', 'Monitor de Atendimento', 'Suporte', 'atendimento', 'Tickets do atendimento e alertas'),
  p('/canais', 'Canais', 'Suporte', 'canais', 'Conexões de WhatsApp dos clientes'),
  p('/tenants', 'Tenants', 'Suporte', 'tenants', 'Contas dos clientes na plataforma'),
  p('/comunicados', 'Comunicados', 'Suporte', 'comunicados', 'Novidades e avisos aos clientes'),
  p('/tickets', 'Tickets', 'Suporte', 'tickets', 'Chamados abertos pelos clientes'),
  p('/templates', 'Templates', 'Suporte', 'templates', 'Modelos de mensagem'),
  p('/arquivados', 'Clientes arquivados', 'Suporte', 'arquivados', 'Clientes fora da operação'),
  p('/comercial-dashboard', 'Dashboard Comercial', 'Comercial', 'dashboard', 'Indicadores do funil de vendas'),
  p('/comercial-dashboard-mensal', 'Painel mensal', 'Comercial', 'grafico', 'Metas e resultado do mês'),
  p('/clientesnxdigital/clientes', 'Clientes NX Digital', 'NX Digital', 'clientes', 'Clientes de tráfego'),
  p('/clientesnxdigital/trafego', 'Tráfego NX Digital', 'NX Digital', 'trafego', 'Campanhas e investimento'),
  p('/clientesnxdigital/demandas', 'Kanban demandas', 'NX Digital', 'kanban', 'Demandas dos clientes de tráfego'),
  p('/clientesnxdigital/socialmedia', 'Social media', 'NX Digital', 'social', 'Calendário e posts'),
  p('/clientesnxdigital/demandassocial', 'Demandas social', 'NX Digital', 'kanban', 'Pedidos de social media'),
  p('/demo-studio', 'Demo Studio', 'Demo Studio', 'demo', 'Demos interativas por link'),
  p('/gestao/vendas', 'Vendas', 'Gestão', 'vendas', 'Vendas fechadas do período'),
  p('/gestao/contrato', 'Contrato', 'Gestão', 'contrato', 'Geração e status de contratos'),
  p('/gestao/pontos', 'Pontos', 'Gestão', 'pontos', 'Registro de ponto da equipe'),
  p('/gestao', 'Gestão', 'Gestão', 'gestao', 'Financeiro da empresa'),
  p('/comando', 'Centro de Comando', 'Gestão', 'comando', 'Visão geral da operação'),
  p('/trafego', 'Tráfego', 'Gestão', 'trafego', 'Investimento em anúncios da NX'),
  p('/users', 'Equipe', 'Sistema', 'equipe', 'Usuários e permissões'),
  p('/equipe', 'Performance', 'Sistema', 'performance', 'Desempenho do time'),
  p('/relatorios', 'Relatórios', 'Sistema', 'relatorios', 'Relatórios da operação'),
  p('/nps', 'NPS', 'Sistema', 'nps', 'Satisfação dos clientes'),
  p('/risco-churn', 'Risco de churn', 'Sistema', 'risco', 'Clientes em risco de cancelar'),
  p('/settings', 'Configurações', 'Sistema', 'configuracoes', 'Preferências do sistema'),
]

/**
 * Todas as telas, com as abas que existem agora. `podeAbrir` decide o que entra (permissões da pessoa).
 * `abaDeFora`: aba que mora dentro de outra (CRM IA LUIZA dentro do CRM LUIS ATUALIZADO) só entra se a de fora não
 * estiver na lista — mesma regra do menu lateral.
 */
export function catalogoDePaginas(entrada: {
  abas: AbaDoComercial[]
  abasFinanceiras: Set<string>
  copiasDoSuporte: CopiaDoSuporte[]
  abaDeFora: (id: string) => string | null | undefined
  podeAbrir: (to: string) => boolean
}): PaginaDoSistema[] {
  const { abas, abasFinanceiras, copiasDoSuporte, abaDeFora, podeAbrir } = entrada
  const ids = new Set(abas.map((a) => a.id))
  const dasAbas = abas
    .filter((a) => !abasFinanceiras.has(a.id))
    .filter((a) => { const fora = abaDeFora(a.id); return !fora || !ids.has(fora) })
    .map((a) => a.noPipeline
      ? p(`/pipeline/crm/${a.id}`, a.name, 'Suporte', 'crm', 'CRM do time do suporte')
      : a.section === 'demandas'
        ? p(`/demandas/${a.id}`, a.name, 'Demandas', 'demandas', 'Pipe de entregas')
        : p(`/comercial/${a.id}`, a.name, 'Comercial', 'crm', 'Quadros de leads'))
  const fixa = (key: string) => PAGINAS_FIXAS.find((x) => x.to === `/${key}` || x.grupo === 'Suporte' && x.to.endsWith(key))
  const copias = copiasDoSuporte
    .filter((c) => c.id !== c.sourceKey)
    .map((c) => p(`/visao/${c.id}`, c.name, 'Suporte', fixa(c.sourceKey)?.icone ?? 'dashboard', 'Cópia de uma tela do Suporte'))
  const vistos = new Set<string>()
  return [...PAGINAS_FIXAS, ...dasAbas, ...copias].filter((x) => {
    if (vistos.has(x.to) || !podeAbrir(x.to)) return false
    vistos.add(x.to)
    return true
  })
}

/** A tela do catálogo que corresponde a um endereço (a própria, ou a "mãe": /clients/123 -> Clientes). */
export function paginaDoEndereco(catalogo: PaginaDoSistema[], pathname: string): PaginaDoSistema | null {
  const limpo = pathname.replace(/\/+$/, '') || '/'
  if (limpo === '/') return null
  const exata = catalogo.find((x) => x.to === limpo)
  if (exata) return exata
  return catalogo
    .filter((x) => x.to !== '/gestao' && limpo.startsWith(`${x.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0] ?? null
}

export const MAXIMO_RECENTES = 5
export const MAXIMO_ATALHOS = 3
export const MAXIMO_ACESSO_RAPIDO = 8

/** Mais recente primeiro, sem repetir, no máximo 5. */
export function registrarRecente(recentes: string[], to: string, maximo = MAXIMO_RECENTES): string[] {
  return [to, ...recentes.filter((r) => r !== to)].slice(0, maximo)
}

export type AreaDaPessoa = 'comercial' | 'entrega' | 'ambos'

/** O que a pessoa vê antes de escolher: o mais usado da área dela, só entre o que ela pode abrir. */
const PREFERIDOS: Record<'atalhos' | 'acessoRapido', Record<AreaDaPessoa, string[]>> = {
  atalhos: {
    entrega: ['/tarefas', '/pipeline', '/clients'],
    comercial: ['/comercial/crm-arthur', '/agenda', '/comercial-dashboard'],
    ambos: ['/pipeline', '/comercial/crm-arthur', '/agenda'],
  },
  acessoRapido: {
    entrega: ['/dashboard-suporte', '/agenda', '/followups', '/atendimento', '/canais', '/tenants'],
    comercial: ['/comercial/novos_leads', '/comercial-dashboard-mensal', '/comercial-dashboard', '/agenda'],
    ambos: ['/dashboard-suporte', '/clients', '/comercial/novos_leads', '/comercial-dashboard', '/followups', '/tenants'],
  },
}

/**
 * Os caminhos que valem de fato: o que a pessoa escolheu (só o que ela ainda pode abrir) ou, se nunca escolheu,
 * o padrão da área completado com as primeiras telas que ela pode abrir — da área dela primeiro.
 */
export function escolhidas(
  catalogo: PaginaDoSistema[], salvas: string[] | null | undefined, qual: 'atalhos' | 'acessoRapido', area: AreaDaPessoa,
): PaginaDoSistema[] {
  const maximo = qual === 'atalhos' ? MAXIMO_ATALHOS : MAXIMO_ACESSO_RAPIDO
  const porCaminho = new Map(catalogo.map((x) => [x.to, x]))
  if (salvas) return salvas.map((s) => porCaminho.get(s)).filter((x): x is PaginaDoSistema => !!x).slice(0, maximo)
  const daArea = (x: PaginaDoSistema) => area === 'comercial' ? x.grupo === 'Comercial'
    : area === 'entrega' ? x.grupo === 'Suporte' : x.grupo === 'Suporte' || x.grupo === 'Comercial'
  const ordem = [
    ...PREFERIDOS[qual][area].map((s) => porCaminho.get(s)),
    ...catalogo.filter(daArea),
    ...catalogo,
  ].filter((x): x is PaginaDoSistema => !!x)
  return [...new Map(ordem.map((x) => [x.to, x])).values()].slice(0, maximo)
}
