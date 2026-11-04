import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Eye, LayoutTemplate, Sparkles } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { demoStudio, urlDoArquivo, urlPublicaDaDemo, type DemoResumo, type MeuAcesso } from '@/services/demoStudio'

/**
 * Galeria de exemplos (§4.1, M5): demos marcadas como exemplo, separadas por segmento. "Usar este exemplo"
 * duplica a demo (telas reaproveitadas por referência, etapas copiadas) e abre o editor da cópia.
 */
export function DemoExemplosPage() {
  const navigate = useNavigate()
  const [demos, setDemos] = React.useState<DemoResumo[] | null>(null)
  const [acesso, setAcesso] = React.useState<MeuAcesso | null>(null)
  const [usando, setUsando] = React.useState<DemoResumo | null>(null)
  const [segmento, setSegmento] = React.useState('')

  React.useEffect(() => {
    demoStudio.listar().then((d) => setDemos(d.filter((x) => x.isTemplate))).catch((e: Error) => { toast.error(e.message); setDemos([]) })
    demoStudio.eu().then(setAcesso).catch(() => undefined)
  }, [])

  const podeEditar = acesso?.role === 'ADMIN' || acesso?.role === 'EDITOR'
  const segmentos = React.useMemo(() => [...new Set((demos ?? []).map((d) => d.segment || 'Geral'))].sort(), [demos])
  const visiveis = (demos ?? []).filter((d) => !segmento || (d.segment || 'Geral') === segmento)
  const grupos = segmentos.filter((s) => !segmento || s === segmento).map((s) => ({ s, itens: visiveis.filter((d) => (d.segment || 'Geral') === s) }))

  const ver = (d: DemoResumo) => {
    if (d.status === 'PUBLISHED') window.open(urlPublicaDaDemo(d.slug, acesso?.publicBaseUrl), '_blank', 'noopener')
    else navigate(`/demo-studio/demos/${d.id}/preview`)
  }

  return (
    <>
      <TopBar compacto title="Exemplos" subtitle="Demo Studio" breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Exemplos' }]} />
      <div className="px-4 pb-10 lg:px-6">
        {segmentos.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {['', ...segmentos].map((s) => (
              <button key={s || 'todos'} type="button" onClick={() => setSegmento(s)}
                className={`rounded-full border px-3 py-1 text-xs ${segmento === s ? 'border-accent/60 bg-accent/10 text-foreground' : 'border-line text-foreground/60 hover:text-foreground'}`}>
                {s || 'Todos'}
              </button>
            ))}
          </div>
        )}
        {demos === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
        ) : demos.length === 0 ? (
          <EmptyState
            icon={<LayoutTemplate className="h-5 w-5" />}
            title="Nenhum exemplo ainda"
            description="Abra uma demo, vá em Configurações e marque “Usar como exemplo”, com o segmento (Clínica, Autopeças, Provedor…). Ela aparece aqui para a equipe usar de ponto de partida."
          />
        ) : (
          <div className="space-y-6">
            {grupos.map((g) => (
              <section key={g.s}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">{g.s}</h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {g.itens.map((d) => (
                    <div key={d.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                      <button type="button" onClick={() => ver(d)} className="block aspect-[16/8] w-full overflow-hidden bg-elevate/[0.04]">
                        {d.coverThumb
                          ? <img src={urlDoArquivo(d.coverThumb)} alt="" className="h-full w-full object-cover object-top transition-transform hover:scale-[1.02]" />
                          : <span className="grid h-full place-items-center text-xs text-foreground/40">Sem telas</span>}
                      </button>
                      <div className="space-y-2 p-4">
                        <div className="flex items-start gap-2">
                          <p className="min-w-0 flex-1 font-medium text-foreground">{d.name}</p>
                          {d.status !== 'PUBLISHED' && <Badge>Rascunho</Badge>}
                        </div>
                        {d.description && <p className="line-clamp-2 text-xs text-foreground/55">{d.description}</p>}
                        <p className="text-xs text-foreground/45">{d.stepsCount} etapas · {d.views30d} views em 30 dias</p>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="secondary" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => ver(d)}>Ver</Button>
                          {podeEditar && <Button size="sm" leftIcon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => setUsando(d)}>Usar este exemplo</Button>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <UsarExemploModal exemplo={usando} onFechar={() => setUsando(null)} onCriada={(id) => navigate(`/demo-studio/demos/${id}`)} />
    </>
  )
}

function UsarExemploModal({ exemplo, onFechar, onCriada }: { exemplo: DemoResumo | null; onFechar: () => void; onCriada: (id: string) => void }) {
  const [nome, setNome] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  React.useEffect(() => { if (exemplo) setNome(`${exemplo.name} · `) }, [exemplo])
  const criar = async () => {
    if (!exemplo || !nome.trim()) return
    setSalvando(true)
    try {
      const { id } = await demoStudio.criar(nome.trim(), exemplo.id)
      toast.success('Cópia criada: ajuste os textos e publique')
      onCriada(id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  return (
    <Modal open={!!exemplo} onClose={onFechar} title="Usar este exemplo"
      description="Cria uma demo nova com as mesmas telas e etapas, em rascunho. O exemplo original não muda."
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onFechar}>Cancelar</Button><Button loading={salvando} disabled={!nome.trim()} onClick={criar}>Criar cópia</Button></div>}>
      <Input label="Nome da nova demo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="NX Systems para clínicas" autoFocus />
    </Modal>
  )
}
