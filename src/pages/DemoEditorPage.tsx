import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, BarChart3, Check, Code2, Copy, Eye, History, Layers, Link2, ImagePlus, Loader2, Settings2, Trash2, Upload } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { CanvasEtapa } from '@/components/demoStudio/editor/CanvasEtapa'
import { ListaEtapas, TIPOS_DE_ETAPA, pendenciasDaEtapa } from '@/components/demoStudio/editor/ListaEtapas'
import { PainelEtapa } from '@/components/demoStudio/editor/PainelEtapa'
import { copyToClipboard } from '@/lib/clipboard'
import { dataHora } from '@/lib/demoStudio/format'
import type { Mascara, StepKind } from '@/lib/demoStudio/types'
import {
  demoStudio,
  lerComoDataUrl,
  urlDoArquivo,
  urlPublicaDaDemo,
  type DemoCompleta,
  type Etapa,
  type Frame,
  type MeuAcesso,
  type Versao,
} from '@/services/demoStudio'

type AlteracaoEtapa = Partial<Omit<Etapa, 'id' | 'order'>>

/**
 * Editor de demo (§4.3): etapas à esquerda (arrastar reordena), canvas com o destaque no centro e
 * propriedades à direita. Mudanças de etapa salvam sozinhas (debounce de 600ms por etapa).
 */
export function DemoEditorPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [demo, setDemo] = React.useState<DemoCompleta | null>(null)
  const [erro, setErro] = React.useState('')
  const [acesso, setAcesso] = React.useState<MeuAcesso | null>(null)
  const [sel, setSel] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(0)
  const [telasAberto, setTelasAberto] = React.useState<'trocar' | 'gerenciar' | null>(null)
  const [configAberta, setConfigAberta] = React.useState(false)
  const [versoesAberta, setVersoesAberta] = React.useState(false)
  const [capitulosAberto, setCapitulosAberto] = React.useState(false)
  const [incorporarAberto, setIncorporarAberto] = React.useState(false)
  const [publicando, setPublicando] = React.useState(false)

  const pendentes = React.useRef(new Map<string, { dados: AlteracaoEtapa; timer: ReturnType<typeof setTimeout> }>())

  const carregar = React.useCallback(async () => {
    try {
      const d = await demoStudio.obter(id)
      setDemo(d)
      setSel((s) => (s && d.steps.some((x) => x.id === s) ? s : d.steps[0]?.id ?? null))
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [id])

  React.useEffect(() => {
    carregar()
    demoStudio.eu().then(setAcesso).catch(() => undefined)
  }, [carregar])

  const podeEditar = acesso?.role === 'ADMIN' || acesso?.role === 'EDITOR'
  const frames = React.useMemo(() => new Map((demo?.frames ?? []).map((f) => [f.id, f])), [demo?.frames])
  const etapa = demo?.steps.find((s) => s.id === sel) ?? null

  const enviarEtapa = React.useCallback(async (stepId: string) => {
    const p = pendentes.current.get(stepId)
    if (!p) return
    pendentes.current.delete(stepId)
    clearTimeout(p.timer)
    setSalvando((n) => n + 1)
    try {
      await demoStudio.editarEtapa(stepId, p.dados)
    } catch (e) {
      toast.error(`Não salvou: ${(e as Error).message}`)
    } finally {
      setSalvando((n) => n - 1)
    }
  }, [])

  /** Manda tudo o que ainda está esperando o debounce (antes de publicar, pré-visualizar, sair). */
  const descarregar = React.useCallback(async () => {
    await Promise.all([...pendentes.current.keys()].map(enviarEtapa))
  }, [enviarEtapa])

  React.useEffect(() => () => { void descarregar() }, [descarregar])

  const mudarEtapa = (stepId: string, a: AlteracaoEtapa) => {
    setDemo((d) => (d ? { ...d, steps: d.steps.map((s) => (s.id === stepId ? { ...s, ...a } : s)) } : d))
    const atual = pendentes.current.get(stepId)
    if (atual) clearTimeout(atual.timer)
    const dados = { ...(atual?.dados ?? {}), ...a }
    pendentes.current.set(stepId, { dados, timer: setTimeout(() => enviarEtapa(stepId), 600) })
  }

  const reordenar = async (ids: string[]) => {
    setDemo((d) => (d ? { ...d, steps: ids.map((i, n) => ({ ...d.steps.find((s) => s.id === i)!, order: n + 1 })) } : d))
    try {
      await descarregar()
      await demoStudio.reordenar(id, ids)
    } catch (e) {
      toast.error((e as Error).message)
      carregar()
    }
  }

  const adicionarEtapa = async (kind: StepKind) => {
    if (!demo) return
    const frameId = etapa?.frameId ?? demo.frames[demo.frames.length - 1]?.id
    if (!frameId) {
      toast.info('Envie uma tela primeiro.')
      setTelasAberto('gerenciar')
      return
    }
    try {
      await descarregar()
      const nova = await demoStudio.criarEtapa(id, { kind, frameId, afterOrder: etapa?.order })
      await carregar()
      setSel(nova.id)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const apagarEtapa = async (stepId: string) => {
    if (!window.confirm('Apagar esta etapa?')) return
    pendentes.current.delete(stepId)
    try {
      await demoStudio.apagarEtapa(stepId)
      await carregar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  /** Máscaras são da TELA (valem em todas as etapas que usam esse frame). */
  const salvarMascaras = async (frameId: string, masks: Mascara[]) => {
    setDemo((d) => (d ? { ...d, frames: d.frames.map((f) => (f.id === frameId ? { ...f, masks } : f)) } : d))
    setSalvando((n) => n + 1)
    try {
      await demoStudio.editarFrame(frameId, { masks })
    } catch (e) {
      toast.error(`Não salvou a máscara: ${(e as Error).message}`)
      carregar()
    } finally {
      setSalvando((n) => n - 1)
    }
  }

  const novoCapitulo = async () => {
    const nome = window.prompt('Nome do capítulo (ex.: Atendimento, Inteligência Artificial):')?.trim()
    if (!nome) return
    try {
      const c = await demoStudio.criarCapitulo(id, nome)
      setDemo((d) => (d ? { ...d, chapters: [...d.chapters, c] } : d))
      if (etapa) mudarEtapa(etapa.id, { chapterId: c.id })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const salvarDemo = async (dados: Parameters<typeof demoStudio.editar>[1]) => {
    try {
      await demoStudio.editar(id, dados)
      setDemo((d) => (d ? { ...d, ...dados, theme: { ...d.theme, ...(dados.theme ?? {}) }, settings: { ...d.settings, ...(dados.settings ?? {}) } } : d))
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const linkPublico = demo ? urlPublicaDaDemo(demo.slug, acesso?.publicBaseUrl) : ''

  const publicar = async () => {
    setPublicando(true)
    try {
      await descarregar()
      const r = await demoStudio.publicar(id)
      toast.success(`Versão ${r.version} publicada`, {
        description: linkPublico,
        action: { label: 'Copiar link', onClick: () => copyToClipboard(linkPublico) },
      })
      await carregar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPublicando(false)
    }
  }
  const despublicar = async () => {
    if (!window.confirm('Tirar a demo do ar? O link para de funcionar até publicar de novo.')) return
    try {
      await demoStudio.despublicar(id)
      await carregar()
      toast.success('Demo fora do ar')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (erro) return <div className="p-6"><EmptyState title="Não deu para abrir a demo" description={erro} action={<Button size="sm" onClick={() => navigate('/demo-studio/demos')}>Voltar</Button>} /></div>
  if (!demo) return <div className="grid h-64 place-items-center text-foreground/50"><Loader2 className="h-5 w-5 animate-spin" /></div>

  const publicada = demo.status === 'PUBLISHED'
  const totalPendencias = demo.steps.reduce((n, s) => n + pendenciasDaEtapa(s).length, 0)

  return (
    <>
      <TopBar
        compacto
        title={demo.name}
        subtitle="Editor"
        breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Demos', to: '/demo-studio/demos' }, { label: demo.name }]}
        titleAddon={<Badge tone={publicada ? 'success' : 'neutral'} dot>{publicada ? 'Publicada' : 'Rascunho'}</Badge>}
      />

      <div className="px-4 pb-10 lg:px-6">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-auto inline-flex items-center gap-1 text-xs text-foreground/45">
              {salvando > 0 ? <><Loader2 className="h-3 w-3 animate-spin" /> Salvando…</> : <><Check className="h-3 w-3" /> Salvo</>}
            </span>
            {podeEditar && <Button size="sm" variant="ghost" leftIcon={<Settings2 className="h-4 w-4" />} onClick={() => setConfigAberta(true)}>Configurações</Button>}
            <Button size="sm" variant="ghost" leftIcon={<History className="h-4 w-4" />} onClick={() => setVersoesAberta(true)}>Versões</Button>
            <Button size="sm" variant="ghost" leftIcon={<BarChart3 className="h-4 w-4" />} onClick={() => navigate(`/demo-studio/demos/${id}/analytics`)}>Analytics</Button>
            <Button size="sm" variant="ghost" leftIcon={<Link2 className="h-4 w-4" />} onClick={() => navigate(`/demo-studio/demos/${id}/links`)}>Links</Button>
            {podeEditar && <Button size="sm" variant="ghost" leftIcon={<Layers className="h-4 w-4" />} onClick={() => setCapitulosAberto(true)}>Capítulos</Button>}
            {publicada && <Button size="sm" variant="ghost" leftIcon={<Code2 className="h-4 w-4" />} onClick={() => setIncorporarAberto(true)}>Incorporar</Button>}
            <Button size="sm" variant="outline" leftIcon={<Eye className="h-4 w-4" />} onClick={async () => { await descarregar(); navigate(`/demo-studio/demos/${id}/preview`) }}>
              Pré-visualizar
            </Button>
            {publicada && (
              <Button size="sm" variant="outline" leftIcon={<Copy className="h-4 w-4" />} onClick={() => { copyToClipboard(linkPublico); toast.success('Link copiado') }}>
                Copiar link
              </Button>
            )}
            {podeEditar && publicada && <Button size="sm" variant="ghost" onClick={despublicar}>Despublicar</Button>}
            {podeEditar && <Button size="sm" loading={publicando} onClick={publicar}>{publicada ? 'Publicar alterações' : 'Publicar'}</Button>}
          </div>

        {publicada && (
          <p className="mb-3 text-xs text-foreground/50">
            No ar em <a href={linkPublico} target="_blank" rel="noreferrer" className="text-accent hover:underline">{linkPublico}</a>
            {demo.lastPublishedAt && ` · última publicação ${dataHora(demo.lastPublishedAt)}`}. Editar não muda o que está no ar até publicar de novo.
          </p>
        )}

        {demo.steps.length === 0 ? (
          <EmptyState
            icon={<ImagePlus className="h-5 w-5" />}
            title="Comece enviando as telas"
            description="Envie os prints do sistema (PNG, JPG ou WebP). Cada tela vira uma etapa; depois é só desenhar o destaque e escrever o texto."
            action={podeEditar ? <Button size="sm" leftIcon={<Upload className="h-4 w-4" />} onClick={() => setTelasAberto('gerenciar')}>Enviar telas</Button> : undefined}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)_300px]">
            <aside className="space-y-3 lg:row-span-2 2xl:row-span-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-foreground/45">
                  Etapas ({demo.steps.length}){totalPendencias > 0 && <span className="ml-1 text-amber-500">· {totalPendencias} pendência(s)</span>}
                </span>
              </div>
              <ListaEtapas etapas={demo.steps} frames={frames} selecionada={sel} onSelecionar={setSel} onReordenar={reordenar} somenteLeitura={!podeEditar} />
              {podeEditar && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-foreground/45">Adicionar depois da selecionada:</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(TIPOS_DE_ETAPA) as StepKind[]).map((k) => {
                      const T = TIPOS_DE_ETAPA[k]
                      return (
                        <Button key={k} size="sm" variant="outline" leftIcon={<T.icone className="h-3.5 w-3.5" />} onClick={() => adicionarEtapa(k)}>
                          {T.rotulo}
                        </Button>
                      )
                    })}
                  </div>
                  <Button size="sm" variant="ghost" className="w-full" leftIcon={<ImagePlus className="h-4 w-4" />} onClick={() => setTelasAberto('gerenciar')}>
                    Telas da demo ({demo.frames.length})
                  </Button>
                </div>
              )}
            </aside>

            <section className="min-w-0">
              {etapa && frames.get(etapa.frameId) ? (
                <CanvasEtapa
                  etapa={etapa}
                  frame={frames.get(etapa.frameId)!}
                  onHotspot={(h) => mudarEtapa(etapa.id, { hotspot: h })}
                  onMascaras={(m) => salvarMascaras(etapa.frameId, m)}
                  somenteLeitura={!podeEditar}
                />
              ) : (
                <EmptyState title="Selecione uma etapa" />
              )}
            </section>

            <aside className="min-w-0 lg:col-start-2 2xl:col-start-auto">
              {etapa && (
                <PainelEtapa
                  key={etapa.id}
                  etapa={etapa}
                  frame={frames.get(etapa.frameId)}
                  onChange={(a) => mudarEtapa(etapa.id, a)}
                  capitulos={demo.chapters}
                  onNovoCapitulo={novoCapitulo}
                  onTrocarTela={() => setTelasAberto('trocar')}
                  onApagar={() => apagarEtapa(etapa.id)}
                  somenteLeitura={!podeEditar}
                />
              )}
            </aside>
          </div>
        )}
      </div>

      <BibliotecaTelas
        aberto={telasAberto !== null}
        modo={telasAberto ?? 'gerenciar'}
        demo={demo}
        frameAtual={etapa?.frameId}
        podeEditar={podeEditar}
        onFechar={() => setTelasAberto(null)}
        onEscolher={(f) => { if (etapa) mudarEtapa(etapa.id, { frameId: f.id }); setTelasAberto(null) }}
        onMudou={carregar}
      />
      <ConfigDemoModal aberto={configAberta} demo={demo} onFechar={() => setConfigAberta(false)} onSalvar={salvarDemo} />
      <CapitulosModal aberto={capitulosAberto} demo={demo} onFechar={() => setCapitulosAberto(false)} onMudou={carregar} />
      <IncorporarModal aberto={incorporarAberto} slug={demo.slug} base={acesso?.publicBaseUrl} onFechar={() => setIncorporarAberto(false)} />
      <VersoesModal aberto={versoesAberta} demoId={id} podeEditar={podeEditar} onFechar={() => setVersoesAberta(false)} onRestaurada={carregar} />
    </>
  )
}

/* ------------------------------------------------------------------ telas (frames) */

function BibliotecaTelas({ aberto, modo, demo, frameAtual, podeEditar, onFechar, onEscolher, onMudou }: {
  aberto: boolean
  modo: 'trocar' | 'gerenciar'
  demo: DemoCompleta
  frameAtual?: string
  podeEditar: boolean
  onFechar: () => void
  onEscolher: (f: Frame) => void
  onMudou: () => Promise<void> | void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pixelRatio, setPixelRatio] = React.useState<'auto' | '1' | '2'>('auto')
  const [criarEtapas, setCriarEtapas] = React.useState(true)
  const [enviando, setEnviando] = React.useState<{ feito: number; total: number } | null>(null)
  const [enderecoPadrao, setEnderecoPadrao] = React.useState('app.nxsystems.com.br/')

  const enviar = async (lista: FileList | null) => {
    const arquivos = [...(lista ?? [])].filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type))
    if (!arquivos.length) return
    setEnviando({ feito: 0, total: arquivos.length })
    let ok = 0
    // Um por vez, na ordem escolhida: cada tela vira a próxima etapa.
    for (const [i, arq] of arquivos.entries()) {
      try {
        await demoStudio.enviarFrame(demo.id, {
          dataUrl: await lerComoDataUrl(arq),
          name: arq.name.replace(/\.[a-z0-9]+$/i, ''),
          pixelRatio: pixelRatio === 'auto' ? undefined : Number(pixelRatio),
          displayUrl: enderecoPadrao || undefined,
          createStep: criarEtapas ? 'HOTSPOT' : undefined,
        })
        ok++
      } catch (e) {
        toast.error(`${arq.name}: ${(e as Error).message}`)
      }
      setEnviando({ feito: i + 1, total: arquivos.length })
    }
    setEnviando(null)
    if (inputRef.current) inputRef.current.value = ''
    if (ok) toast.success(`${ok} tela(s) enviada(s)`)
    await onMudou()
  }

  const apagar = async (f: Frame) => {
    if (!window.confirm('Apagar esta tela?')) return
    try {
      await demoStudio.apagarFrame(f.id)
      await onMudou()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Modal open={aberto} onClose={onFechar} size="2xl" title={modo === 'trocar' ? 'Escolher a tela da etapa' : 'Telas da demo'}
      description="Prints do sistema em PNG, JPG ou WebP. Coordenadas ficam em px CSS: informe o pixel ratio se a captura foi em tela retina.">
      {podeEditar && (
        <div className="mb-4 space-y-3 rounded-xl border border-dashed border-line p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-foreground/70">
              Pixel ratio
              <select className="mt-1.5 h-9 w-full rounded-lg border border-line bg-transparent px-2 text-sm" value={pixelRatio} onChange={(e) => setPixelRatio(e.target.value as 'auto' | '1' | '2')}>
                <option value="auto">Automático (2x se ≥ 2560px)</option>
                <option value="1">1x</option>
                <option value="2">2x (retina)</option>
              </select>
            </label>
            <Input label="Endereço na barra" value={enderecoPadrao} onChange={(e) => setEnderecoPadrao(e.target.value)} />
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={criarEtapas} onChange={(e) => setCriarEtapas(e.target.checked)} />
              Criar uma etapa por tela
            </label>
          </div>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => enviar(e.target.files)} />
          <Button size="sm" leftIcon={enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} disabled={!!enviando} onClick={() => inputRef.current?.click()}>
            {enviando ? `Enviando ${enviando.feito}/${enviando.total}…` : 'Enviar telas'}
          </Button>
        </div>
      )}
      {demo.frames.length === 0 ? (
        <p className="py-6 text-center text-sm text-foreground/50">Nenhuma tela ainda.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {demo.frames.map((f) => (
            <div key={f.id} className={`overflow-hidden rounded-lg border ${f.id === frameAtual ? 'border-accent' : 'border-line'}`}>
              <button type="button" className="block aspect-[16/9] w-full bg-elevate/[0.04]" onClick={() => modo === 'trocar' && podeEditar && onEscolher(f)} disabled={modo !== 'trocar'}>
                <img src={urlDoArquivo(f.thumb)} alt="" className="h-full w-full object-cover object-top" />
              </button>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-xs text-foreground/60">{f.name || 'Tela'} · {f.width}×{f.height}</span>
                {modo === 'trocar' && podeEditar && <Button size="sm" variant="ghost" onClick={() => onEscolher(f)}>Usar</Button>}
                {modo === 'gerenciar' && podeEditar && (
                  <button type="button" aria-label="Apagar tela" className="p-1 text-foreground/40 hover:text-red-500" onClick={() => apagar(f)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ configurações da demo */

function ConfigDemoModal({ aberto, demo, onFechar, onSalvar }: {
  aberto: boolean
  demo: DemoCompleta
  onFechar: () => void
  onSalvar: (d: Parameters<typeof demoStudio.editar>[1]) => Promise<boolean>
}) {
  const [f, setF] = React.useState(() => valoresIniciais(demo))
  const [salvando, setSalvando] = React.useState(false)
  React.useEffect(() => { if (aberto) setF(valoresIniciais(demo)) }, [aberto, demo])
  const set = (a: Partial<typeof f>) => setF((v) => ({ ...v, ...a }))

  const salvar = async () => {
    setSalvando(true)
    const ok = await onSalvar({
      name: f.name.trim() || demo.name,
      slug: f.slug.trim(),
      description: f.description.trim() || null,
      isTemplate: f.isTemplate,
      segment: f.segment.trim() || null,
      theme: { accent: f.accent, brandName: f.brandName.trim(), logoText: f.logoText.trim() },
      settings: {
        showProgress: f.showProgress, showRestart: f.showRestart, ctaPhone: f.ctaPhone.replace(/\D/g, ''), ctaMessage: f.ctaMessage,
        leadGateStep: f.leadGateStep ? Number(f.leadGateStep) : null,
      },
    })
    setSalvando(false)
    if (ok) onFechar()
  }

  return (
    <Modal open={aberto} onClose={onFechar} size="lg" title="Configurações da demo"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onFechar}>Cancelar</Button><Button loading={salvando} onClick={salvar}>Salvar</Button></div>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nome" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        <Input label="Endereço (/d/…)" value={f.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} hint="Trocar o endereço quebra o link antigo." />
        <div className="sm:col-span-2">
          <Textarea label="Descrição (aparece no preview do link)" rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <Input label="Nome da marca" value={f.brandName} onChange={(e) => set({ brandName: e.target.value })} />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input label="Logo (texto)" value={f.logoText} maxLength={12} onChange={(e) => set({ logoText: e.target.value })} />
          <label className="text-xs font-medium text-foreground/70">
            Cor
            <input type="color" className="mt-1.5 block h-9 w-14 cursor-pointer rounded-lg border border-line bg-transparent" value={f.accent} onChange={(e) => set({ accent: e.target.value })} />
          </label>
        </div>
        <Input label="WhatsApp do CTA" value={f.ctaPhone} onChange={(e) => set({ ctaPhone: e.target.value })} hint="Com DDI e DDD. Padrão: 5548936181649." />
        <Input label="Mensagem do botão do topo" value={f.ctaMessage} onChange={(e) => set({ ctaMessage: e.target.value })} placeholder="Olá! Estou vendo o tour…" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.showProgress} onChange={(e) => set({ showProgress: e.target.checked })} /> Mostrar barra de progresso</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.showRestart} onChange={(e) => set({ showRestart: e.target.checked })} /> Mostrar "Recomeçar"</label>
        <div className="sm:col-span-2">
          <Input
            label="Pedir o contato antes da etapa nº (vazio = não pedir)"
            type="number"
            min={1}
            max={demo.steps.length}
            value={f.leadGateStep}
            onChange={(e) => set({ leadGateStep: e.target.value })}
            hint="Ao chegar nessa etapa, o formulário aparece e só libera o restante depois do envio. Links personalizados pulam essa parte (o lead já é conhecido)."
          />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isTemplate} onChange={(e) => set({ isTemplate: e.target.checked })} /> Usar como exemplo (template)</label>
        <Input label="Segmento" value={f.segment} placeholder="Clínica, Autopeças, Provedor…" onChange={(e) => set({ segment: e.target.value })} />
      </div>
    </Modal>
  )
}

function valoresIniciais(d: DemoCompleta) {
  return {
    name: d.name,
    slug: d.slug,
    description: d.description ?? '',
    isTemplate: d.isTemplate,
    segment: d.segment ?? '',
    accent: d.theme.accent || '#2c6bc8',
    brandName: d.theme.brandName ?? '',
    logoText: d.theme.logoText ?? '',
    showProgress: d.settings.showProgress !== false,
    showRestart: d.settings.showRestart !== false,
    leadGateStep: d.settings.leadGateStep ? String(d.settings.leadGateStep) : '',
    ctaPhone: d.settings.ctaPhone ?? '',
    ctaMessage: d.settings.ctaMessage ?? '',
  }
}

/* ------------------------------------------------------------------ versões */

function VersoesModal({ aberto, demoId, podeEditar, onFechar, onRestaurada }: {
  aberto: boolean
  demoId: string
  podeEditar: boolean
  onFechar: () => void
  onRestaurada: () => Promise<void> | void
}) {
  const [versoes, setVersoes] = React.useState<Versao[] | null>(null)
  React.useEffect(() => {
    if (!aberto) return
    setVersoes(null)
    demoStudio.versoes(demoId).then(setVersoes).catch((e: Error) => { toast.error(e.message); setVersoes([]) })
  }, [aberto, demoId])

  const restaurar = async (v: Versao) => {
    if (!window.confirm(`Voltar o rascunho para a versão ${v.number}? As etapas atuais do rascunho são substituídas. O que está no ar não muda até publicar.`)) return
    try {
      await demoStudio.restaurar(demoId, v.number)
      toast.success(`Rascunho restaurado da versão ${v.number}`)
      await onRestaurada()
      onFechar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Modal open={aberto} onClose={onFechar} title="Versões publicadas" description="Cada Publicar gera uma versão. O link público sempre mostra a versão marcada como no ar.">
      {versoes === null ? (
        <div className="grid h-24 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-foreground/40" /></div>
      ) : versoes.length === 0 ? (
        <p className="py-6 text-center text-sm text-foreground/50">Nenhuma versão publicada ainda.</p>
      ) : (
        <ul className="divide-y divide-line">
          {versoes.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="font-medium tabular-nums">v{v.number}</span>
              {v.isCurrent && <Badge tone="success">No ar</Badge>}
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/55">
                {dataHora(v.createdAt)} · {v.stepsCount} etapas{v.publishedBy ? ` · ${v.publishedBy}` : ''}
              </span>
              {podeEditar && <Button size="sm" variant="ghost" onClick={() => restaurar(v)}>Restaurar</Button>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-foreground/45">
        Precisa de uma demo nova a partir desta? <Link className="text-accent hover:underline" to="/demo-studio/demos">Duplique na lista de demos</Link>.
      </p>
    </Modal>
  )
}

/* ------------------------------------------------------------------ capítulos */

function CapitulosModal({ aberto, demo, onFechar, onMudou }: {
  aberto: boolean
  demo: DemoCompleta
  onFechar: () => void
  onMudou: () => Promise<void> | void
}) {
  const [nome, setNome] = React.useState('')
  const lista = [...demo.chapters].sort((a, b) => a.order - b.order)
  const etapasPor = (capId: string) => demo.steps.filter((s) => s.chapterId === capId).length
  const fazer = async (acao: () => Promise<unknown>) => {
    try {
      await acao()
      await onMudou()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <Modal open={aberto} onClose={onFechar} title="Capítulos"
      description="Agrupam as etapas (Atendimento, IA, Campanhas…). Com 2 ou mais, o visitante pula entre eles pelo menu do player. Cada etapa escolhe o capítulo no painel ao lado.">
      <ul className="divide-y divide-line">
        {lista.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <input
              defaultValue={c.name}
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2 text-sm"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) fazer(() => demoStudio.editarCapitulo(c.id, { name: v })) }}
              aria-label="Nome do capítulo"
            />
            <span className="w-16 text-right text-xs text-foreground/45">{etapasPor(c.id)} etapa(s)</span>
            <button type="button" aria-label="Subir" disabled={i === 0} className="p-1 text-foreground/50 disabled:opacity-30" onClick={() => fazer(() => demoStudio.editarCapitulo(c.id, { order: c.order - 1 }))}>
              <ArrowUp className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Descer" disabled={i === lista.length - 1} className="p-1 text-foreground/50 disabled:opacity-30" onClick={() => fazer(() => demoStudio.editarCapitulo(c.id, { order: c.order + 1 }))}>
              <ArrowDown className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Apagar capítulo" className="p-1 text-foreground/40 hover:text-red-500"
              onClick={() => window.confirm(`Apagar o capítulo "${c.name}"? As etapas continuam, só ficam sem capítulo.`) && fazer(() => demoStudio.apagarCapitulo(c.id))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
        {!lista.length && <li className="py-3 text-sm text-foreground/50">Nenhum capítulo ainda.</li>}
      </ul>
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1"><Input label="Novo capítulo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Inteligência Artificial" /></div>
        <Button size="sm" disabled={!nome.trim()} onClick={() => fazer(async () => { await demoStudio.criarCapitulo(demo.id, nome.trim()); setNome('') })}>Adicionar</Button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ incorporação (§7.3) */

/** Código para colar no site/LP: iframe responsivo e, opcionalmente, o script que ajusta a altura sozinho. */
export function codigoDeIncorporacao(slug: string, base: string, altura: boolean): string {
  const id = `nxdemo-${slug}`
  const iframe = `<iframe id="${id}" src="${base}/e/${slug}" title="Tour interativo" style="width:100%;aspect-ratio:16/9;border:0" allow="fullscreen" loading="lazy"></iframe>`
  if (!altura) return iframe
  return `${iframe}
<script>
  window.addEventListener('message', function (e) {
    if (e.origin !== '${base}' || !e.data || e.data.type !== 'nxdemo:height' || e.data.slug !== '${slug}') return;
    var f = document.getElementById('${id}');
    if (f) { f.style.aspectRatio = 'auto'; f.style.height = e.data.height + 'px'; }
  });
</script>`
}

function IncorporarModal({ aberto, slug, base, onFechar }: { aberto: boolean; slug: string; base?: string | null; onFechar: () => void }) {
  const [altura, setAltura] = React.useState(true)
  const origem = (base || window.location.origin).replace(/\/+$/, '')
  const codigo = codigoDeIncorporacao(slug, origem, altura)
  return (
    <Modal open={aberto} onClose={onFechar} size="lg" title="Incorporar no site"
      description="Cole este código no HTML do site ou da landing page. A versão incorporada não tem o cabeçalho e conta views normalmente.">
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={altura} onChange={(e) => setAltura(e.target.checked)} />
        Ajustar a altura sozinho (recomendado: no celular o tour fica mais alto que 16:9)
      </label>
      <Textarea readOnly rows={altura ? 10 : 3} value={codigo} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
      <div className="mt-3 flex justify-end gap-2">
        <a href={`${origem}/e/${slug}`} target="_blank" rel="noreferrer"><Button variant="ghost">Ver versão incorporada</Button></a>
        <Button leftIcon={<Copy className="h-4 w-4" />} onClick={async () => { await copyToClipboard(codigo); toast.success('Código copiado') }}>Copiar código</Button>
      </div>
    </Modal>
  )
}
