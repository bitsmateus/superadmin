import * as React from 'react'
import { ExternalLink, Megaphone } from 'lucide-react'
import { api } from '@/services/api'
import { EditableField } from '@/components/comercial/EditableField'

interface Origem {
  campanha: { id: string | null; nome: string; nichoMirado: string; papel: string }
  conjunto: { id: string | null; nome: string }
  anuncio: { id: string | null; nome: string; thumbnail: string; link: string; formato: string; titulo: string }
}

export interface LeadOrigemBlockProps {
  leadRowId: string
  nicho: string
  motivoDesqualificacao: string
  onChange: (patch: { nicho?: string; motivoDesqualificacao?: string }) => void
}

/** "Origem" do lead vindo do Meta Ads: campanha › conjunto › anúncio com miniatura, nicho real e motivo de
 * desqualificação. Não aparece pra lead que não veio do Meta. */
export function LeadOrigemBlock({ leadRowId, nicho, motivoDesqualificacao, onChange }: LeadOrigemBlockProps) {
  const [dados, setDados] = React.useState<{ origem: Origem | null; motivos: string[] } | null>(null)

  React.useEffect(() => {
    let vivo = true
    setDados(null)
    api.get<{ origem: Origem | null; motivos: string[] }>(`/api/lead-rows/${leadRowId}/origem`)
      .then((d) => { if (vivo) setDados(d) })
      .catch(() => { if (vivo) setDados({ origem: null, motivos: [] }) })
    return () => { vivo = false }
  }, [leadRowId])

  if (!dados?.origem) return null
  const { campanha, conjunto, anuncio } = dados.origem
  // Motivo antigo que saiu da lista continua aparecendo no select em vez de sumir.
  const motivos = motivoDesqualificacao && !dados.motivos.includes(motivoDesqualificacao)
    ? [motivoDesqualificacao, ...dados.motivos] : dados.motivos

  return (
    <div className="my-2 rounded-lg border border-line bg-elevate/[0.03] p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Megaphone className="h-3.5 w-3.5 text-foreground/60" />
        Origem (Meta Ads)
      </div>
      <div className="flex gap-2.5">
        {anuncio.thumbnail ? (
          <img src={anuncio.thumbnail} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-md object-cover" />
        ) : null}
        <dl className="min-w-0 flex-1 space-y-1 text-[11px]">
          <div><dt className="text-foreground/40">Campanha</dt>
            <dd className="break-words font-medium text-foreground">{campanha.nome || campanha.id || '—'}</dd></div>
          <div><dt className="text-foreground/40">Conjunto</dt>
            <dd className="break-words text-foreground/80">{conjunto.nome || conjunto.id || '—'}</dd></div>
          <div><dt className="text-foreground/40">Anúncio</dt>
            <dd className="break-words text-foreground/80">{anuncio.nome || anuncio.id || '—'}</dd></div>
        </dl>
      </div>
      {anuncio.link && (
        <a href={anuncio.link} target="_blank" rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
          <ExternalLink className="h-3 w-3" />Ver o anúncio
        </a>
      )}
      <div className="mt-2 space-y-1.5 border-t border-line/60 pt-2">
        <label className="block text-[11px] text-foreground/40">
          Nicho do lead{campanha.nichoMirado ? ` (campanha mira: ${campanha.nichoMirado})` : ''}
          <EditableField
            value={nicho}
            placeholder="Segmento da empresa"
            onSave={(v) => onChange({ nicho: v.trim() })}
            className="mt-0.5 rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="block text-[11px] text-foreground/40">
          Motivo de desqualificação
          <select
            value={motivoDesqualificacao}
            onChange={(e) => onChange({ motivoDesqualificacao: e.target.value })}
            className="mt-0.5 w-full rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-foreground outline-none"
          >
            <option value="">— nenhum (lead válido) —</option>
            {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}
