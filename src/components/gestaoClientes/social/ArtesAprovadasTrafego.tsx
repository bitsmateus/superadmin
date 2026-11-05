import * as React from 'react'
import {
  BarChart3, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FolderUp, Link2, Loader2, Megaphone, RefreshCw, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
import {
  gestaoClientes, type GcSocialAnuncio, type GcSocialDesempenho, type GcSocialDoCliente, type GcSocialProducao,
} from '@/services/gestaoClientes'
import { artesFinais, copiar, mesDeHoje, nomeDoMes, somarMes } from '@/lib/socialArtes'
import { cn } from '@/lib/utils'

/**
 * "Artes aprovadas" na aba Tráfego: o que o cliente aprovou chega aqui pro gestor de tráfego, por mês,
 * com o arquivo pronto pra baixar, a copy do anúncio (IA), o envio pro Drive e o desempenho de cada
 * arte nos anúncios (quando o gestor liga a arte ao anúncio da Meta).
 */

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const dataBr = (iso: string) => new Date(iso).toLocaleDateString('pt-BR')

function baixar(nome: string, dataUrl: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = nome
  a.click()
}

function CopyDoAnuncio({ card, onMudou }: { card: GcSocialProducao; onMudou: (c: GcSocialProducao) => void }) {
  const [gerando, setGerando] = React.useState(false)
  const gerar = async () => {
    setGerando(true)
    try {
      onMudou({ ...card, copy_anuncio: await gestaoClientes.iaCopyDaArte(card.id) })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setGerando(false)
    }
  }
  const opcoes = card.copy_anuncio?.opcoes ?? []
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Megaphone className="h-4 w-4 text-accent" /> Copy do anúncio</p>
        <Button size="sm" variant="ghost" loading={gerando} leftIcon={opcoes.length ? <RefreshCw className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />} onClick={() => void gerar()}>
          {opcoes.length ? 'Gerar outras' : 'Gerar com IA'}
        </Button>
      </div>
      {opcoes.length === 0 ? (
        <p className="text-xs text-foreground/45">{gerando ? 'Escrevendo 3 opções…' : '3 opções de texto principal + título no tom do cliente. Sai sozinho quando o cliente aprova.'}</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-3">
          {opcoes.map((o, i) => (
            <div key={i} className="rounded-lg bg-elevate/[0.03] p-2.5 text-xs">
              <p className="mb-1 font-semibold text-foreground/80">Opção {i + 1}</p>
              <p className="whitespace-pre-wrap text-foreground/80">{o.texto}</p>
              {o.titulo && <p className="mt-1.5 text-foreground/60"><b>Título:</b> {o.titulo}</p>}
              {o.descricao && <p className="text-foreground/60"><b>Descrição:</b> {o.descricao}</p>}
              <button
                type="button"
                onClick={() => void copiar(`${o.texto}\n\nTítulo: ${o.titulo}\nDescrição: ${o.descricao}`).then(() => toast.success('Copy copiada'))}
                className="mt-1.5 inline-flex items-center gap-1 text-accent hover:underline"
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LigarAnuncios({ card, anuncios, carregarAnuncios, onMudou }: {
  card: GcSocialProducao; anuncios: GcSocialAnuncio[] | null; carregarAnuncios: () => void; onMudou: (c: GcSocialProducao) => void
}) {
  const [aberto, setAberto] = React.useState(false)
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set(card.ad_ids))
  const [salvando, setSalvando] = React.useState(false)
  const salvar = async () => {
    setSalvando(true)
    try {
      onMudou(await gestaoClientes.ligarAnuncios(card.id, [...marcados]))
      setAberto(false)
      toast.success('Anúncios ligados à arte')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        leftIcon={<Link2 className="h-3.5 w-3.5" />}
        onClick={() => { setAberto((x) => !x); setMarcados(new Set(card.ad_ids)); carregarAnuncios() }}
      >
        {card.ad_ids.length ? `${card.ad_ids.length} anúncio${card.ad_ids.length === 1 ? '' : 's'} ligado${card.ad_ids.length === 1 ? '' : 's'}` : 'Ligar ao anúncio'}
      </Button>
      {aberto && (
        <div className="mt-2 rounded-xl border border-line p-2">
          {anuncios === null ? (
            <p className="flex items-center gap-1.5 p-2 text-xs text-foreground/55"><Loader2 className="h-3 w-3 animate-spin" /> Buscando anúncios…</p>
          ) : anuncios.length === 0 ? (
            <p className="p-2 text-xs text-foreground/55">Nenhum anúncio com gasto nos últimos 90 dias (ou a conta de anúncio não está ligada).</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {anuncios.map((a) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg p-1.5 hover:bg-elevate/[0.04]">
                    <input
                      type="checkbox"
                      checked={marcados.has(a.id)}
                      onChange={() => setMarcados((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n })}
                      className="h-4 w-4 accent-[#4F8EF7]"
                    />
                    {a.thumbnail ? <img src={a.thumbnail} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="h-8 w-8 rounded bg-elevate/[0.06]" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">{a.nome}</span>
                      <span className="block truncate text-[10px] text-foreground/45">{a.campanha} · {brl(a.gasto)} em 90 dias</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button size="sm" loading={salvando} onClick={() => void salvar()}>Salvar</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ItemArte({ card, desempenho, podeDrive, temPasta, anuncios, carregarAnuncios, onMudou }: {
  card: GcSocialProducao; desempenho?: GcSocialDesempenho; podeDrive: boolean; temPasta: boolean
  anuncios: GcSocialAnuncio[] | null; carregarAnuncios: () => void; onMudou: (c: GcSocialProducao) => void
}) {
  const [aberto, setAberto] = React.useState(false)
  const [enviandoDrive, setEnviandoDrive] = React.useState(false)
  const finais = artesFinais(card)
  const capa = finais.find((a) => a.type.startsWith('image/'))
  const nova = card.status === 'aprovado' && !card.visto_trafego_em

  const abrir = () => {
    setAberto((x) => !x)
    if (nova) {
      void gestaoClientes.vistoNoTrafego(card.id)
      onMudou({ ...card, visto_trafego_em: new Date().toISOString() })
    }
  }

  const marcarNoTrafego = async () => {
    try {
      onMudou(await gestaoClientes.atualizarSocialProducao(card.id, { status: 'trafego' }))
      toast.success('Marcada como no tráfego')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const mandarProDrive = async () => {
    setEnviandoDrive(true)
    try {
      const r = await gestaoClientes.enviarArteProDrive(card.id)
      onMudou({ ...card, drive_link: r.link, drive_enviado_em: new Date().toISOString() })
      toast.success(`${r.enviados} arquivo${r.enviados === 1 ? '' : 's'} no Drive`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviandoDrive(false)
    }
  }

  return (
    <li className={cn('rounded-2xl border bg-surface', nova ? 'border-accent/50' : 'border-line')}>
      <button type="button" onClick={abrir} className="flex w-full items-center gap-3 p-3 text-left">
        {capa ? <img src={capa.dataUrl} alt="" className="h-16 w-14 shrink-0 rounded-lg object-cover" /> : <span className="h-16 w-14 shrink-0 rounded-lg bg-elevate/[0.06]" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{card.titulo}</span>
            {nova && <span className="rounded bg-accent px-1.5 py-px text-[10px] font-semibold text-white">Nova</span>}
            <span className={cn('rounded px-1.5 py-px text-[10px] font-medium', card.status === 'trafego' ? 'bg-emerald-700/10 text-emerald-700' : 'bg-success/10 text-success')}>
              {card.status === 'trafego' ? 'No tráfego' : 'Aprovada'}
            </span>
          </span>
          <span className="block text-[11px] text-foreground/50">
            {card.aprovado_em ? `Aprovada em ${dataBr(card.aprovado_em)}` : 'Aprovada'}{card.aprovado_por ? ` por ${card.aprovado_por}` : ''}
            {' · '}{finais.length} arquivo{finais.length === 1 ? '' : 's'}
          </span>
          {desempenho && desempenho.impressoes > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-foreground/70">
              <span>Gasto {brl(desempenho.gasto)}</span>
              <span>CTR {desempenho.ctr != null ? `${desempenho.ctr.toFixed(2)}%` : '—'}</span>
              <span>{desempenho.resultados} resultado{desempenho.resultados === 1 ? '' : 's'}</span>
              <span className="font-medium">Custo/res. {desempenho.custoResultado != null ? brl(desempenho.custoResultado) : '—'}</span>
            </span>
          )}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-foreground/40 transition-transform', aberto && 'rotate-180')} />
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-line p-3">
          <div className="flex flex-wrap gap-2">
            {finais.map((a, i) => (
              <Button key={a.id} size="sm" variant="secondary" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => baixar(a.name, a.dataUrl)}>
                Baixar{finais.length > 1 ? ` ${i + 1}` : ''}
              </Button>
            ))}
            {card.status === 'aprovado' && (
              <Button size="sm" leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => void marcarNoTrafego()}>Subi no anúncio</Button>
            )}
            {card.drive_link ? (
              <a href={card.drive_link} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-accent hover:bg-accent/10">
                <FolderUp className="h-3.5 w-3.5" /> No Drive{card.drive_enviado_em ? ` (${dataBr(card.drive_enviado_em)})` : ''}
              </a>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                loading={enviandoDrive}
                disabled={!podeDrive || !temPasta}
                title={!podeDrive ? 'Envio pro Drive não configurado no servidor' : !temPasta ? 'Cole a pasta do Drive do cliente acima' : undefined}
                leftIcon={<FolderUp className="h-3.5 w-3.5" />}
                onClick={() => void mandarProDrive()}
              >
                Enviar pro Drive
              </Button>
            )}
          </div>
          {finais.some((a) => a.type.startsWith('image/')) && (
            <div className="flex gap-2 overflow-x-auto">
              {finais.filter((a) => a.type.startsWith('image/')).map((a) => (
                <img key={a.id} src={a.dataUrl} alt="" className="h-40 shrink-0 rounded-lg border border-line object-contain" />
              ))}
            </div>
          )}
          <CopyDoAnuncio card={card} onMudou={onMudou} />
          <LigarAnuncios card={card} anuncios={anuncios} carregarAnuncios={carregarAnuncios} onMudou={onMudou} />
        </div>
      )}
    </li>
  )
}

export function ArtesAprovadasTrafego({ clienteId }: { clienteId: string }) {
  const { data: perfis } = useTeamProfiles()
  const [dados, setDados] = React.useState<GcSocialDoCliente | null>(null)
  const [desempenho, setDesempenho] = React.useState<GcSocialDesempenho[]>([])
  const [anuncios, setAnuncios] = React.useState<GcSocialAnuncio[] | null>(null)
  const [mes, setMes] = React.useState<string | null>(mesDeHoje())
  const [pasta, setPasta] = React.useState('')
  const [aprendizado, setAprendizado] = React.useState('')
  const [analisando, setAnalisando] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try {
      const [s, d] = await Promise.all([gestaoClientes.social(clienteId), gestaoClientes.desempenhoDasArtes(clienteId).catch(() => [])])
      setDados(s)
      setPasta(s.drive_pasta_artes)
      setDesempenho(d)
    } catch (err) {
      toast.error('Falha ao carregar as artes: ' + (err as Error).message)
    }
  }, [clienteId])
  React.useEffect(() => { void carregar() }, [carregar])

  const carregarAnuncios = React.useCallback(() => {
    if (anuncios !== null) return
    gestaoClientes.anunciosParaArte(clienteId).then(setAnuncios).catch(() => setAnuncios([]))
  }, [anuncios, clienteId])

  if (!dados) {
    return (
      <section className="rounded-2xl border border-line p-4 text-sm text-foreground/55">
        <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" /> Carregando artes aprovadas…
      </section>
    )
  }

  const aprovadas = dados.producao.filter((p) => p.status === 'aprovado' || p.status === 'trafego')
  const doMes = (mes ? aprovadas.filter((p) => p.mes === mes) : aprovadas)
    .sort((a, b) => Number(b.status === 'aprovado') - Number(a.status === 'aprovado') || String(b.aprovado_em).localeCompare(String(a.aprovado_em)))
  const novas = aprovadas.filter((p) => p.status === 'aprovado' && !p.visto_trafego_em).length
  const porId = new Map(desempenho.map((d) => [d.id, d]))

  const trocar = (c: GcSocialProducao) => {
    setDados((d) => (d ? { ...d, producao: d.producao.map((p) => (p.id === c.id ? { ...p, ...c } : p)) } : d))
    if (c.ad_ids) void gestaoClientes.desempenhoDasArtes(clienteId).then(setDesempenho).catch(() => undefined)
  }

  const salvarConfig = async (x: { gestor_trafego_id?: string | null; drive_pasta_artes?: string }) => {
    try {
      const r = await gestaoClientes.configSocial(clienteId, x)
      setDados((d) => (d ? { ...d, ...r } : d))
      toast.success('Salvo')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const analisar = async () => {
    setAnalisando(true)
    try {
      setAprendizado((await gestaoClientes.iaAprendizados(clienteId)).texto)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setAnalisando(false)
    }
  }

  const atual = mes ?? mesDeHoje()
  return (
    <section className="space-y-3 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" /> Artes aprovadas
          {novas > 0 && <span className="rounded-full bg-accent px-2 text-xs font-semibold text-white">{novas} nova{novas === 1 ? '' : 's'}</span>}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded-xl border border-line bg-surface">
            <button type="button" onClick={() => setMes(somarMes(atual, -1))} className="p-1.5 text-foreground/55" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
            <span className={cn('min-w-[8.5rem] text-center text-sm font-medium', !mes && 'text-foreground/40')}>{nomeDoMes(atual)}</span>
            <button type="button" onClick={() => setMes(somarMes(atual, 1))} className="p-1.5 text-foreground/55" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button
            type="button"
            onClick={() => setMes(mes ? null : mesDeHoje())}
            className={cn('h-8 rounded-lg border px-2.5 text-xs', !mes ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-foreground/60')}
          >
            {mes ? `Todos os meses (${aprovadas.length})` : 'Todos os meses'}
          </button>
        </div>
      </div>

      <div className="grid gap-2 rounded-xl bg-elevate/[0.03] p-3 sm:grid-cols-2">
        <label className="text-xs text-foreground/65">
          <span className="mb-1 block font-medium">Gestor de tráfego (recebe o aviso quando o cliente aprova)</span>
          <select
            value={dados.gestor_trafego_id ?? ''}
            onChange={(e) => void salvarConfig({ gestor_trafego_id: e.target.value || null })}
            className="h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm text-foreground"
          >
            <option value="">Ninguém</option>
            {(perfis ?? []).map((p) => <option key={p.id} value={p.id}>{(p.name && p.name.trim()) || p.email}</option>)}
          </select>
        </label>
        <label className="text-xs text-foreground/65">
          <span className="mb-1 block font-medium">
            Pasta do Drive das artes aprovadas {dados.drive_configurado ? '(envio automático ao aprovar)' : '(envio pro Drive não configurado no servidor)'}
          </span>
          <span className="flex gap-2">
            <input
              value={pasta}
              onChange={(e) => setPasta(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-foreground"
            />
            {pasta !== dados.drive_pasta_artes && <Button size="sm" onClick={() => void salvarConfig({ drive_pasta_artes: pasta })}>Salvar</Button>}
          </span>
        </label>
      </div>

      {doMes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-foreground/50">
          Nenhuma arte aprovada {mes ? `em ${nomeDoMes(mes)}` : 'ainda'}. Quando o cliente aprovar no portal, ela aparece aqui.
        </p>
      ) : (
        <ul className="space-y-2">
          {doMes.map((c) => (
            <ItemArte
              key={c.id}
              card={c}
              desempenho={porId.get(c.id)}
              podeDrive={dados.drive_configurado}
              temPasta={!!dados.drive_pasta_artes}
              anuncios={anuncios}
              carregarAnuncios={carregarAnuncios}
              onMudou={trocar}
            />
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <BarChart3 className="h-4 w-4 text-accent" /> O que funcionou
            <span className="text-xs font-normal text-foreground/45">{desempenho.filter((d) => d.impressoes > 0).length} arte(s) com números</span>
          </p>
          <Button size="sm" variant="secondary" loading={analisando} leftIcon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => void analisar()}>
            Analisar com IA
          </Button>
        </div>
        {aprendizado ? (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">{aprendizado}</p>
        ) : (
          <p className="mt-1 text-xs text-foreground/45">
            Ligue cada arte ao anúncio dela. A IA cruza CTR e custo por resultado e diz que tipo de arte pedir mais. Isso também entra nos próximos pedidos feitos com IA.
          </p>
        )}
      </div>
    </section>
  )
}
