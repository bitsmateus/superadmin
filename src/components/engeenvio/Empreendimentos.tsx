import * as React from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { engeApi, type EngeEmpreendimento, type EngeTudo } from '@/api/engeEnvio'
import { cn } from '@/lib/utils'
import { dataBr, dataHoraBr, diasAte, statusGarantia, sugerirEnvios, textoDias } from '@/lib/engeEnvio'
import { CanaisToggle, Cartao, Vazio, td, th, useCanaisPadrao, useIndices, useRecarregar } from './shared'
import { EmpreendimentoForm } from './EmpreendimentoForm'
import { GarantiaModal } from './GarantiaModal'

export function Empreendimentos({
  dados,
  selecionado,
  onSelecionar,
}: {
  dados: EngeTudo
  selecionado: string | null
  onSelecionar: (id: string | null) => void
}) {
  const [novo, setNovo] = React.useState(false)
  const emp = selecionado ? dados.empreendimentos.find((e) => e.id === selecionado) : undefined

  if (emp) return <Detalhe emp={emp} dados={dados} onVoltar={() => onSelecionar(null)} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground/60">Cada condomínio, com o síndico que recebe os avisos e a construtora responsável.</p>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNovo(true)}>
          Novo empreendimento
        </Button>
      </div>
      {dados.empreendimentos.length === 0 ? (
        <Cartao>
          <Vazio>Nenhum empreendimento ainda. Clique em “Novo empreendimento” para cadastrar o primeiro.</Vazio>
        </Cartao>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dados.empreendimentos.map((e) => {
            const gs = dados.garantias.filter((g) => g.empreendimentoId === e.id)
            const conta = (k: string) => gs.filter((g) => statusGarantia(g).chave === k).length
            const proxima = gs.filter((g) => diasAte(g.vencimento) >= 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0]
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelecionar(e.id)}
                className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 text-left transition-colors hover:border-accent/50 focus-ring"
              >
                <div>
                  <p className="font-semibold text-foreground">{e.nome}</p>
                  <p className="text-xs text-foreground/50">{[e.cidade, e.entrega && `entregue em ${dataBr(e.entrega)}`].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-foreground/50">Síndico</dt>
                  <dd className="truncate text-foreground/80">{e.sindico || '—'}</dd>
                  <dt className="text-foreground/50">Construtora</dt>
                  <dd className="truncate text-foreground/80">{e.construtora || '—'}</dd>
                  <dt className="text-foreground/50">Próximo</dt>
                  <dd className="truncate text-foreground/80">
                    {proxima ? `${proxima.item} · ${textoDias(diasAte(proxima.vencimento))}` : '—'}
                  </dd>
                </dl>
                <div className="flex flex-wrap gap-1.5">
                  {conta('vencida') > 0 && <Badge tone="danger">{conta('vencida')} vencida(s)</Badge>}
                  {conta('breve') > 0 && <Badge tone="warning">{conta('breve')} vence(m) em breve</Badge>}
                  {conta('chamado') > 0 && <Badge tone="info">{conta('chamado')} com chamado</Badge>}
                  <Badge tone="neutral">{gs.length} garantias</Badge>
                </div>
              </button>
            )
          })}
        </div>
      )}
      <EmpreendimentoForm aberto={novo} onFechar={() => setNovo(false)} onCriado={(id) => onSelecionar(id)} />
    </div>
  )
}

const FILTROS = [
  { id: 'ativas', label: 'Ativas' },
  { id: 'vencida', label: 'Vencidas' },
  { id: 'breve', label: 'Vencem em breve' },
  { id: 'chamado', label: 'Com chamado' },
  { id: 'todas', label: 'Todas' },
]

function Detalhe({ emp, dados, onVoltar }: { emp: EngeEmpreendimento; dados: EngeTudo; onVoltar: () => void }) {
  const recarregar = useRecarregar()
  const { enviosPorGar } = useIndices(dados)
  const [filtro, setFiltro] = React.useState('ativas')
  const [editar, setEditar] = React.useState(false)
  const [aberta, setAberta] = React.useState<string | null>(null)
  const [nova, setNova] = React.useState(false)
  const [confirmarExclusao, setConfirmarExclusao] = React.useState(false)

  const garantias = dados.garantias
    .filter((g) => g.empreendimentoId === emp.id)
    .filter((g) => {
      const s = statusGarantia(g).chave
      if (filtro === 'todas') return true
      if (filtro === 'ativas') return s !== 'encerrada'
      return s === filtro
    })
  const garantiaAberta = aberta ? dados.garantias.find((g) => g.id === aberta) ?? null : null

  const excluir = async () => {
    try {
      await engeApi.removerEmpreendimento(emp.id)
      toast.success('Empreendimento excluído')
      onVoltar()
      await recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onVoltar} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" /> Empreendimentos
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{emp.nome}</h2>
          <p className="text-sm text-foreground/50">
            {[emp.cidade, emp.entrega && `entregue em ${dataBr(emp.entrega)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditar(true)}>
            Editar
          </Button>
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNova(true)}>
            Nova garantia
          </Button>
        </div>
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Síndico', emp.sindico],
          ['E-mail dos avisos', emp.emails],
          ['WhatsApp dos avisos', emp.telefone],
          ['Construtora', emp.construtora],
        ].map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0 bg-card px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">{rotulo}</p>
            <p className={cn('break-words text-sm', valor ? 'text-foreground' : 'text-foreground/40')}>{valor || '—'}</p>
          </div>
        ))}
      </div>
      {!emp.telefone && dados.envios.some((v) => v.canalWhatsapp && v.status === 'agendado' && dados.garantias.some((g) => g.id === v.garantiaId && g.empreendimentoId === emp.id)) && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Há avisos marcados para WhatsApp, mas o empreendimento não tem número do síndico. Cadastre em “Editar”.
        </p>
      )}
      {!emp.emails && (
        <p className="rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2 text-sm text-danger">
          Sem e-mail do síndico: os avisos agendados vão falhar até você cadastrar um em “Editar”.
        </p>
      )}

      <Cartao
        titulo="Garantias"
        acao={
          <div className="flex flex-wrap gap-1">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  filtro === f.id ? 'bg-accent/15 text-accent' : 'text-foreground/60 hover:bg-elevate/[0.05] hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        {garantias.length === 0 ? (
          <Vazio>Nenhuma garantia neste filtro.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-elevate/[0.02]">
                <tr>
                  <th className={th}>Item</th>
                  <th className={th}>Prazo</th>
                  <th className={th}>Vencimento</th>
                  <th className={th}>Próximo aviso</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {garantias.map((g) => {
                  const s = statusGarantia(g)
                  const envs = enviosPorGar.get(g.id) ?? []
                  const prox = envs.filter((e) => e.status === 'agendado').sort((a, b) => a.enviarEm.localeCompare(b.enviarEm))[0]
                  const enviados = envs.filter((e) => e.status === 'enviado')
                  const ciente = enviados.some((e) => e.cienteEm)
                  return (
                    <tr key={g.id} className="cursor-pointer hover:bg-elevate/[0.03]" onClick={() => setAberta(g.id)}>
                      <td className={`${td} font-medium`}>{g.item}</td>
                      <td className={`${td} text-foreground/70`}>{g.prazo || '—'}</td>
                      <td className={td}>
                        <span className="tabular-nums">{dataBr(g.vencimento)}</span>
                        <span className="block text-xs text-foreground/50">{textoDias(diasAte(g.vencimento))}</span>
                      </td>
                      <td className={`${td} text-xs`}>
                        {prox ? <span className="tabular-nums">{dataHoraBr(prox.enviarEm)}</span> : <span className="text-foreground/40">—</span>}
                        <span className="block text-foreground/50">
                          {enviados.length} enviado{enviados.length === 1 ? '' : 's'}
                          {ciente && ' · ciente'}
                        </span>
                      </td>
                      <td className={td}>
                        <Badge tone={s.tom} dot>
                          {s.label}
                        </Badge>
                      </td>
                      <td className={`${td} text-right`}>
                        <span className="text-xs font-medium text-accent">Avisos</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmarExclusao(true)}>
          Excluir empreendimento
        </Button>
      </div>

      <EmpreendimentoForm aberto={editar} onFechar={() => setEditar(false)} editando={emp} />
      <GarantiaModal
        garantia={garantiaAberta}
        empreendimento={emp}
        envios={garantiaAberta ? enviosPorGar.get(garantiaAberta.id) ?? [] : []}
        onFechar={() => setAberta(null)}
      />
      <NovaGarantiaModal aberto={nova} empreendimentoId={emp.id} onFechar={() => setNova(false)} />
      <Modal
        open={confirmarExclusao}
        onClose={() => setConfirmarExclusao(false)}
        size="sm"
        title="Excluir empreendimento?"
        description="Apaga o empreendimento, todas as garantias e o histórico de avisos dele. Não dá para desfazer."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmarExclusao(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={excluir}>
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground/70">{emp.nome}</p>
      </Modal>
    </div>
  )
}

function NovaGarantiaModal({ aberto, empreendimentoId, onFechar }: { aberto: boolean; empreendimentoId: string; onFechar: () => void }) {
  const recarregar = useRecarregar()
  const [item, setItem] = React.useState('')
  const [prazo, setPrazo] = React.useState('')
  const [vencimento, setVencimento] = React.useState('')
  const [envios, setEnvios] = React.useState<string[]>([])
  const canaisPadrao = useCanaisPadrao()
  const [canais, setCanais] = React.useState(canaisPadrao)
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (aberto) {
      setItem('')
      setPrazo('')
      setVencimento('')
      setEnvios([])
      setCanais(canaisPadrao)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  const mudarVencimento = (v: string) => {
    setVencimento(v)
    if (v) setEnvios(sugerirEnvios(v, [30, 15, 7], '09:00'))
  }

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    try {
      await engeApi.criarGarantia(empreendimentoId, { item, prazo, vencimento, envios: envios.filter(Boolean), canais })
      toast.success('Garantia criada')
      await recarregar()
      onFechar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      title="Nova garantia"
      footer={
        <>
          <Button variant="secondary" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" form="ee-form-gar" loading={salvando}>
            Criar garantia
          </Button>
        </>
      }
    >
      <form id="ee-form-gar" onSubmit={salvar} className="space-y-3">
        <Input id="ee-ng-item" label="Item" value={item} onChange={(e) => setItem(e.target.value)} required />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="ee-ng-prazo" label="Prazo" placeholder="ex.: 2 anos" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          <Input id="ee-ng-venc" type="date" label="Vencimento" value={vencimento} onChange={(e) => mudarVencimento(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground/70">Dias de envio dos avisos</p>
            <CanaisToggle idBase="ee-ng-canais" valor={canais} onChange={setCanais} />
          </div>
          {envios.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                id={`ee-ng-env-${i}`}
                type="datetime-local"
                value={v}
                onChange={(e) => setEnvios((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-foreground"
                aria-label={`Aviso ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => setEnvios((l) => l.filter((_, j) => j !== i))}
                className="rounded p-1 text-foreground/40 hover:text-danger"
                aria-label="Remover aviso"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setEnvios((l) => [...l, ''])}
          >
            Adicionar dia de envio
          </Button>
        </div>
      </form>
    </Modal>
  )
}
