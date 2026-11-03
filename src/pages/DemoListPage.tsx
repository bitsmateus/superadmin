import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Copy, Eye, MousePointerClick, Pencil, Plus, Trash2 } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { demoStudio, urlDoArquivo, type DemoResumo, type MeuAcesso } from '@/services/demoStudio'
import { dataHora } from '@/lib/demoStudio/format'

/** Grid de demos (§4.1): miniatura, status, etapas, views e leads dos últimos 30 dias. */
export function DemoListPage() {
  const navigate = useNavigate()
  const [demos, setDemos] = React.useState<DemoResumo[] | null>(null)
  const [acesso, setAcesso] = React.useState<MeuAcesso | null>(null)
  const [novaAberta, setNovaAberta] = React.useState(false)

  const carregar = React.useCallback(() => {
    demoStudio.listar().then(setDemos).catch((e: Error) => { toast.error(e.message); setDemos([]) })
  }, [])
  React.useEffect(() => {
    carregar()
    demoStudio.eu().then(setAcesso).catch(() => undefined)
  }, [carregar])

  const podeEditar = acesso?.role === 'ADMIN' || acesso?.role === 'EDITOR'

  const duplicar = async (d: DemoResumo) => {
    try {
      const { id } = await demoStudio.duplicar(d.id)
      toast.success('Demo duplicada')
      navigate(`/demo-studio/demos/${id}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const apagar = async (d: DemoResumo) => {
    if (!window.confirm(`Apagar a demo "${d.name}"? Os links dela param de funcionar. Não dá pra desfazer.`)) return
    try {
      await demoStudio.apagar(d.id)
      toast.success('Demo apagada')
      carregar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <TopBar
        compacto
        title="Demos"
        subtitle="Demo Studio"
        breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Demos' }]}
        rightSlot={podeEditar ? <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNovaAberta(true)}>Nova demo</Button> : undefined}
      />
      <div className="px-4 pb-10 lg:px-6">
        {demos === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
          </div>
        ) : demos.length === 0 ? (
          <EmptyState
            icon={<MousePointerClick className="h-5 w-5" />}
            title="Nenhuma demo criada"
            description="Crie uma demo em branco ou a partir de um exemplo, envie as telas e desenhe os destaques."
            action={podeEditar ? <Button size="sm" onClick={() => setNovaAberta(true)}>Nova demo</Button> : undefined}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {demos.map((d) => (
              <div key={d.id} className="group overflow-hidden rounded-xl border border-line bg-surface">
                <Link to={`/demo-studio/demos/${d.id}`} className="block aspect-[16/8] overflow-hidden bg-elevate/[0.04]">
                  {d.coverThumb ? (
                    <img src={urlDoArquivo(d.coverThumb)} alt="" className="h-full w-full object-cover object-top transition-transform group-hover:scale-[1.02]" />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-foreground/40">Sem telas ainda</div>
                  )}
                </Link>
                <div className="p-4">
                  <div className="flex items-start gap-2">
                    <Link to={`/demo-studio/demos/${d.id}`} className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline">{d.name}</Link>
                    {d.isTemplate && <Badge tone="info">Exemplo</Badge>}
                    <Badge tone={d.status === 'PUBLISHED' ? 'success' : 'neutral'} dot>{d.status === 'PUBLISHED' ? 'Publicada' : 'Rascunho'}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/55">
                    <span>{d.stepsCount} etapas</span>
                    <span>{d.views30d} views · 30d</span>
                    <span>{d.leads30d} leads · 30d</span>
                  </div>
                  <p className="mt-1 text-xs text-foreground/40">Atualizada em {dataHora(d.updatedAt)}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => navigate(`/demo-studio/demos/${d.id}`)}>
                      {podeEditar ? 'Editar' : 'Abrir'}
                    </Button>
                    <Button size="sm" variant="ghost" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => navigate(`/demo-studio/demos/${d.id}/preview`)}>
                      Ver
                    </Button>
                    {podeEditar && (
                      <Button size="sm" variant="ghost" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => duplicar(d)}>Duplicar</Button>
                    )}
                    {acesso?.role === 'ADMIN' && (
                      <Button size="sm" variant="ghost" className="ml-auto text-red-500" aria-label="Apagar demo" onClick={() => apagar(d)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <NovaDemoModal
        open={novaAberta}
        onClose={() => setNovaAberta(false)}
        exemplos={(demos ?? []).filter((d) => d.isTemplate)}
        onCriada={(id) => navigate(`/demo-studio/demos/${id}`)}
      />
    </>
  )
}

function NovaDemoModal({ open, onClose, exemplos, onCriada }: {
  open: boolean
  onClose: () => void
  exemplos: DemoResumo[]
  onCriada: (id: string) => void
}) {
  const [nome, setNome] = React.useState('')
  const [origem, setOrigem] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  React.useEffect(() => { if (open) { setNome(''); setOrigem('') } }, [open])

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return
    setSalvando(true)
    try {
      const { id } = await demoStudio.criar(nome.trim(), origem || undefined)
      onCriada(id)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova demo"
      description="Comece em branco e envie as telas, ou parta de um exemplo pronto."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="nova-demo" loading={salvando} disabled={!nome.trim()}>Criar demo</Button>
        </div>
      }
    >
      <form id="nova-demo" onSubmit={criar} className="space-y-4">
        <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: NX Systems para clínicas" autoFocus />
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground/70">Começar de</p>
          <div className="grid gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input type="radio" name="origem" checked={origem === ''} onChange={() => setOrigem('')} />
              Em branco
            </label>
            {exemplos.map((ex) => (
              <label key={ex.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <input type="radio" name="origem" checked={origem === ex.id} onChange={() => { setOrigem(ex.id); if (!nome) setNome(`${ex.name} (cópia)`) }} />
                <span className="min-w-0 flex-1 truncate">{ex.name}</span>
                <span className="text-xs text-foreground/45">{ex.stepsCount} etapas</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-foreground/45">Importar captura da extensão chega no M4.</p>
        </div>
      </form>
    </Modal>
  )
}
