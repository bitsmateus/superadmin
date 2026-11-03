import * as React from 'react'
import { BarChart3, Link2, LayoutTemplate, MousePointerClick, Settings, UserCheck } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Telas do Demo Studio (docs/demo-studio/). No M0 cada seção é só o estado vazio explicando o próximo
 * passo; os marcos seguintes trocam cada uma pela tela de verdade.
 */
export type DemoStudioSecao = 'visao-geral' | 'demos' | 'exemplos' | 'leads' | 'links' | 'configuracoes'

const SECOES: Record<DemoStudioSecao, { titulo: string; icone: React.ReactNode; vazio: string; detalhe: string }> = {
  'visao-geral': {
    titulo: 'Visão geral',
    icone: <BarChart3 className="h-5 w-5" />,
    vazio: 'Nenhuma sessão ainda',
    detalhe: 'Compartilhe o link de uma demo para começar a medir views, conclusão e leads.',
  },
  demos: {
    titulo: 'Demos',
    icone: <MousePointerClick className="h-5 w-5" />,
    vazio: 'Nenhuma demo criada',
    detalhe: 'Crie uma demo em branco, a partir de um exemplo ou importando uma captura da extensão.',
  },
  exemplos: {
    titulo: 'Exemplos',
    icone: <LayoutTemplate className="h-5 w-5" />,
    vazio: 'Nenhum exemplo publicado',
    detalhe: 'Marque uma demo como exemplo para ela aparecer aqui, separada por segmento.',
  },
  leads: {
    titulo: 'Leads',
    icone: <UserCheck className="h-5 w-5" />,
    vazio: 'Nenhum lead ainda',
    detalhe: 'Os leads aparecem quando alguém preenche o formulário da demo ou abre um link personalizado.',
  },
  links: {
    titulo: 'Links',
    icone: <Link2 className="h-5 w-5" />,
    vazio: 'Nenhum link criado',
    detalhe: 'Crie links por canal (site, Instagram) ou personalizados para cada lead dentro de uma demo.',
  },
  configuracoes: {
    titulo: 'Configurações',
    icone: <Settings className="h-5 w-5" />,
    vazio: 'Configurações do Demo Studio',
    detalhe: 'Token da extensão, regras de anonimização, webhooks e CTA padrão chegam nos próximos marcos.',
  },
}

export function DemoStudioPage({ secao }: { secao: DemoStudioSecao }) {
  const s = SECOES[secao]
  return (
    <>
      <TopBar
        compacto
        title={s.titulo}
        subtitle="Demo Studio"
        breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: s.titulo }]}
      />
      <div className="px-4 pb-10 lg:px-6">
        <EmptyState icon={s.icone} title={s.vazio} description={s.detalhe} />
      </div>
    </>
  )
}
