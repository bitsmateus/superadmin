import { cn } from '@/lib/utils'
import {
  MINIMO_DETALHE_MOTIVO, MINIMO_OUTRO, MOTIVOS_DESQUALIFICACAO, ORIGENS_DO_LEAD, PREFIXO_ORIGEM_OUTROS,
  juntarMotivo, origemEhOutros, rotuloDaOrigem, separarMotivo, textoDaOrigemOutros,
} from '@/lib/regraDoStatus'
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
  /** De onde o lead veio (lead cadastrado à mão). Lead com anúncio ligado mostra o anúncio. */
  origem: string
  /** Lead sem anúncio ligado: mostra a escolha da origem, o nicho e o motivo. Desligado nos CRMs de demanda. */
  mostrarSemAnuncio?: boolean
  onChange: (patch: { nicho?: string; motivoDesqualificacao?: string; origem?: string }) => void
}

/** Motivo da desqualificação: escolhe da lista e detalha o porquê (salvo como "<Motivo>: <detalhe>"). O detalhe
 * só é salvo com pelo menos 10 caracteres — o aviso aparece só depois de tentar sair do campo com menos. */
function MotivoComOutro({ valor, onChange }: { valor: string; motivos?: string[]; onChange: (v: string) => void }) {
  const salvo = separarMotivo(valor)
  const [motivo, setMotivo] = React.useState(salvo.motivo)
  const [detalhe, setDetalhe] = React.useState(salvo.detalhe)
  const [tentou, setTentou] = React.useState(false)
  React.useEffect(() => { const s = separarMotivo(valor); setMotivo(s.motivo); setDetalhe(s.detalhe); setTentou(false) }, [valor])
  const naLista = (MOTIVOS_DESQUALIFICACAO as readonly string[]).includes(motivo)
  const curto = detalhe.trim().length < MINIMO_DETALHE_MOTIVO
  const salvar = (m: string, d: string) => {
    if (!m) { onChange(''); return }
    if (d.trim().length >= MINIMO_DETALHE_MOTIVO) onChange(juntarMotivo(m, d))
  }
  return (
    <div className="block text-[11px] text-foreground/40">
      Motivo de desqualificação
      <select
        value={motivo}
        onChange={(e) => { setMotivo(e.target.value); setTentou(false); salvar(e.target.value, detalhe) }}
        className="mt-0.5 w-full rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-foreground outline-none"
      >
        <option value="">— nenhum (lead válido) —</option>
        {!naLista && motivo && <option value={motivo}>{motivo} (antigo)</option>}
        {MOTIVOS_DESQUALIFICACAO.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      {!!motivo && (
        <>
          <textarea
            value={detalhe}
            onChange={(e) => setDetalhe(e.target.value)}
            onBlur={() => { setTentou(true); salvar(motivo, detalhe) }}
            rows={2}
            placeholder="Detalhe a desqualificação"
            className={cn('mt-1 w-full rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-foreground outline-none', tentou && curto && 'ring-1 ring-warning/50')}
          />
          {tentou && curto && <span className="text-[11px] text-warning">Detalhe um pouco mais (mínimo de {MINIMO_DETALHE_MOTIVO} caracteres) pra salvar.</span>}
        </>
      )}
    </div>
  )
}

/** Origem do lead (cadastro manual): a lista, e em "Outros" um campo pra escrever de onde veio (mínimo 5 letras),
 * salvo como "outros: …". */
function OrigemComOutros({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const ehOutros = origemEhOutros(valor)
  const [texto, setTexto] = React.useState(textoDaOrigemOutros(valor))
  React.useEffect(() => { setTexto(origemEhOutros(valor) ? textoDaOrigemOutros(valor) : '') }, [valor])
  const curto = ehOutros && texto.trim().length < MINIMO_OUTRO
  return (
    <div className="block text-[11px] text-foreground/40">
      De onde o lead veio
      <select
        value={ehOutros ? 'outros' : valor}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-foreground outline-none"
      >
        <option value="">— não informado —</option>
        {/* Origem que veio da automação (ex.: "lp_teste") e não está na lista da tela: aparece com o rótulo dela. */}
        {valor && !ehOutros && !ORIGENS_DO_LEAD.some((o) => o.valor === valor) && <option value={valor}>{rotuloDaOrigem(valor)}</option>}
        {ORIGENS_DO_LEAD.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {ehOutros && (
        <>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => { const v = texto.trim(); if (v.length >= MINIMO_OUTRO) onChange(`${PREFIXO_ORIGEM_OUTROS}${v}`) }}
            placeholder="De onde ele veio? (mínimo 5 letras)"
            className={cn('mt-1 w-full rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-foreground outline-none', curto && 'ring-1 ring-warning/50')}
          />
          {curto && <span className="text-[11px] text-warning">Escreva de onde veio com pelo menos {MINIMO_OUTRO} letras.</span>}
        </>
      )}
    </div>
  )
}

/** "Origem" do lead. Veio do Meta Ads: campanha › conjunto › anúncio com miniatura, nicho real e motivo de
 * desqualificação. Não veio (cadastro manual): escolha da origem (bio, site, indicação…), nicho e motivo. */
export function LeadOrigemBlock({ leadRowId, nicho, motivoDesqualificacao, origem, mostrarSemAnuncio = false, onChange }: LeadOrigemBlockProps) {
  const [dados, setDados] = React.useState<{ origem: Origem | null; motivos: string[] } | null>(null)

  React.useEffect(() => {
    let vivo = true
    setDados(null)
    api.get<{ origem: Origem | null; motivos: string[] }>(`/api/lead-rows/${leadRowId}/origem`)
      .then((d) => { if (vivo) setDados(d) })
      .catch(() => { if (vivo) setDados({ origem: null, motivos: [] }) })
    return () => { vivo = false }
  }, [leadRowId])

  if (!dados) return null
  // Motivo antigo que saiu da lista continua aparecendo no select em vez de sumir.
  const motivos = motivoDesqualificacao && !dados.motivos.includes(motivoDesqualificacao)
    ? [motivoDesqualificacao, ...dados.motivos] : dados.motivos

  // Lead sem anúncio ligado (cadastrado à mão, link na bio, site, indicação…): escolhe a origem aqui.
  if (!dados.origem) {
    if (!mostrarSemAnuncio) return null
    return (
      <div className="my-2 rounded-lg border border-line bg-elevate/[0.03] p-2.5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Megaphone className="h-3.5 w-3.5 text-foreground/60" />
          Origem
        </div>
        <OrigemComOutros valor={origem} onChange={(v) => onChange({ origem: v })} />
        <div className="mt-2 space-y-1.5 border-t border-line/60 pt-2">
          <label className="block text-[11px] text-foreground/40">
            Nicho do lead
            <EditableField
              value={nicho}
              placeholder="Segmento da empresa"
              onSave={(v) => onChange({ nicho: v.trim() })}
              className="mt-0.5 rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <MotivoComOutro valor={motivoDesqualificacao} motivos={motivos} onChange={(v) => onChange({ motivoDesqualificacao: v })} />
        </div>
      </div>
    )
  }

  const { campanha, conjunto, anuncio } = dados.origem

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
        <MotivoComOutro valor={motivoDesqualificacao} motivos={motivos} onChange={(v) => onChange({ motivoDesqualificacao: v })} />
      </div>
    </div>
  )
}
