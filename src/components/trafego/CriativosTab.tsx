import * as React from 'react'
import { ExternalLink, Image as ImageIcon, Users } from 'lucide-react'
import { trafegoService, type FiltroPapel } from '@/services/trafego'
import { Estado, SeloBadge, brl, num, seloDe, useCarregar } from '@/components/trafego/format'
import { LeadsModal } from '@/components/trafego/CampanhasTab'

/** Galeria de criativos (anúncios) com miniatura, selo e o funil de cada um. */
export function CriativosTab({ de, ate, papel, versao }: { de: string; ate: string; papel: FiltroPapel; versao: number }) {
  const { dados, erro, carregando } = useCarregar(() => trafegoService.ranking('anuncio', de, ate, papel), [de, ate, papel, versao])
  const [leadsDe, setLeadsDe] = React.useState<{ id: string; nome: string } | null>(null)
  // Só entra criativo que gastou ou trouxe lead no período; o resto é ruído.
  const linhas = (dados?.linhas ?? []).filter((l) => l.gasto > 0 || l.leads > 0)

  return (
    <Estado carregando={carregando} erro={erro}>
      {linhas.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground/40">Nenhum criativo com gasto ou lead no período.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {linhas.map((a) => (
            <article key={a.id} className="flex gap-3 rounded-xl border border-line bg-card p-3">
              {a.thumbnail ? (
                <img src={a.thumbnail} alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="grid h-24 w-24 shrink-0 place-items-center rounded-lg bg-elevate/[0.05] text-foreground/25"><ImageIcon className="h-6 w-6" /></div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1.5">
                  <h3 className="min-w-0 flex-1 break-words text-sm font-medium leading-tight text-foreground">{a.nome}</h3>
                  <SeloBadge selo={seloDe(a)} />
                </div>
                <p className="mt-0.5 truncate text-[11px] text-foreground/40">
                  {[a.formato, a.campanhaNome].filter(Boolean).join(' · ')}
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-[11px]">
                  <div><dt className="text-foreground/40">Gasto</dt><dd className="font-medium text-foreground">{brl(a.gasto)}</dd></div>
                  <div><dt className="text-foreground/40">Leads</dt><dd className="font-medium text-foreground">{num(a.leads)}</dd></div>
                  <div><dt className="text-foreground/40">CPL</dt><dd className="font-medium text-foreground">{brl(a.cpl)}</dd></div>
                  <div><dt className="text-foreground/40">Reuniões</dt><dd className="font-medium text-foreground">{num(a.reunioes)}</dd></div>
                  <div><dt className="text-foreground/40">Custo/reun.</dt><dd className="font-medium text-foreground">{brl(a.custoReuniao)}</dd></div>
                  <div><dt className="text-foreground/40">Freq.</dt><dd className="font-medium text-foreground">{a.frequencia.toFixed(1)}</dd></div>
                </dl>
                <div className="mt-1.5 flex items-center gap-2 max-sm:mt-0.5 max-sm:gap-4">
                  <button type="button" onClick={() => setLeadsDe({ id: a.id, nome: a.nome })}
                    className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline max-sm:min-h-8 max-sm:text-xs"><Users className="h-3 w-3" />Ver leads</button>
                  {a.previewUrl && (
                    <a href={a.previewUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-foreground/45 hover:text-foreground max-sm:min-h-8 max-sm:text-xs"><ExternalLink className="h-3 w-3" />Anúncio</a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <LeadsModal alvo={leadsDe ? { chave: 'ad_id', ...leadsDe } : null} onClose={() => setLeadsDe(null)} />
    </Estado>
  )
}
