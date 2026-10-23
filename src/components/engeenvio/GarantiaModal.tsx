import * as React from 'react'
import { toast } from 'sonner'
import { Ban, Eye, Plus, Send } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { engeApi, type EngeEmpreendimento, type EngeEnvio, type EngeGarantia } from '@/api/engeEnvio'
import { dataBr, dataHoraBr, diasAte, hoje, paraCampo, somarDias, statusEnvio, sugerirEnvios, textoDias } from '@/lib/engeEnvio'
import { useRecarregar } from './shared'
import { EmailModal } from './EmailModal'

/**
 * Uma garantia e os avisos dela: escolher/remarcar o dia e a hora de cada envio, mandar na hora,
 * cancelar e marcar o chamado aberto na construtora.
 */
export function GarantiaModal({
  garantia,
  empreendimento,
  envios,
  onFechar,
}: {
  garantia: EngeGarantia | null
  empreendimento?: EngeEmpreendimento
  envios: EngeEnvio[]
  onFechar: () => void
}) {
  const recarregar = useRecarregar()
  const [item, setItem] = React.useState('')
  const [prazo, setPrazo] = React.useState('')
  const [vencimento, setVencimento] = React.useState('')
  const [chamadoEm, setChamadoEm] = React.useState('')
  const [protocolo, setProtocolo] = React.useState('')
  const [novoEnvio, setNovoEnvio] = React.useState('')
  const [remarcar, setRemarcar] = React.useState<Record<string, string>>({})
  const [ocupado, setOcupado] = React.useState<string | null>(null)
  const [verEmail, setVerEmail] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!garantia) return
    setItem(garantia.item)
    setPrazo(garantia.prazo ?? '')
    setVencimento(garantia.vencimento)
    setChamadoEm(garantia.chamadoEm ?? '')
    setProtocolo(garantia.chamadoProtocolo ?? '')
    setNovoEnvio(sugerirEnvios(garantia.vencimento, [30], '09:00')[0] ?? `${somarDias(hoje(), 1)}T09:00`)
    setRemarcar({})
  }, [garantia])

  if (!garantia) return null

  const agir = async (chave: string, fn: () => Promise<unknown>, ok: string) => {
    setOcupado(chave)
    try {
      await fn()
      toast.success(ok)
      await recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  const ordenados = [...envios].sort((a, b) => a.enviarEm.localeCompare(b.enviarEm))
  const pendentes = envios.filter((e) => e.status === 'agendado' || e.status === 'erro').length
  const dias = diasAte(garantia.vencimento)

  const salvarDados = () =>
    agir('dados', () => engeApi.salvarGarantia(garantia.id, { item, prazo, vencimento }), 'Garantia salva')

  const marcarChamado = (abrir: boolean) =>
    agir(
      'chamado',
      () =>
        engeApi.salvarGarantia(garantia.id, {
          chamadoEm: abrir ? chamadoEm || hoje() : null,
          chamadoProtocolo: abrir ? protocolo : null,
          cancelarPendentes: abrir,
        }),
      abrir
        ? pendentes
          ? `Chamado registrado. ${pendentes} aviso(s) pendente(s) cancelado(s).`
          : 'Chamado registrado.'
        : 'Chamado desmarcado',
    )

  return (
    <>
      <Modal
        open
        onClose={onFechar}
        size="xl"
        title={garantia.item}
        description={`${empreendimento?.nome ?? ''} · vence em ${dataBr(garantia.vencimento)} (${textoDias(dias)})`}
      >
        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Avisos ao síndico</h3>
            <p className="text-xs text-foreground/50">
              Para: {empreendimento?.emails || <span className="text-danger">cadastre o e-mail do síndico no empreendimento</span>}
            </p>
            {ordenados.length === 0 && <p className="text-sm text-foreground/50">Nenhum aviso agendado para esta garantia.</p>}
            <ul className="divide-y divide-line rounded-lg border border-line">
              {ordenados.map((e) => {
                const s = statusEnvio(e)
                const editavel = e.status !== 'enviado'
                const valor = remarcar[e.id] ?? paraCampo(e.enviarEm)
                const mudou = valor !== paraCampo(e.enviarEm)
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <Badge tone={s.tom} dot className="shrink-0">
                      {s.label}
                    </Badge>
                    {editavel ? (
                      <input
                        id={`ee-env-${e.id}`}
                        type="datetime-local"
                        value={valor}
                        onChange={(ev) => setRemarcar((r) => ({ ...r, [e.id]: ev.target.value }))}
                        className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground"
                        aria-label="Dia e hora do envio"
                      />
                    ) : (
                      <span className="text-xs tabular-nums text-foreground/70">
                        Enviado em {dataHoraBr(e.enviadoEm)}
                        {e.cienteEm && ` · ciente por ${e.cienteNome} em ${dataHoraBr(e.cienteEm)}`}
                      </span>
                    )}
                    {e.status === 'erro' && e.erro && <span className="w-full text-xs text-danger">{e.erro}</span>}
                    <span className="ml-auto flex flex-wrap gap-1">
                      {editavel && mudou && (
                        <Button
                          size="sm"
                          loading={ocupado === `r${e.id}`}
                          onClick={() => agir(`r${e.id}`, () => engeApi.remarcarEnvio(e.id, valor), 'Aviso remarcado')}
                        >
                          Salvar data
                        </Button>
                      )}
                      {e.status === 'cancelado' && !mudou && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={ocupado === `r${e.id}`}
                          onClick={() => agir(`r${e.id}`, () => engeApi.remarcarEnvio(e.id, valor), 'Aviso reagendado')}
                        >
                          Reativar
                        </Button>
                      )}
                      {(e.status === 'agendado' || e.status === 'erro') && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            leftIcon={<Send className="h-3.5 w-3.5" />}
                            loading={ocupado === `s${e.id}`}
                            onClick={() => agir(`s${e.id}`, () => engeApi.enviarAgora(e.id), 'Aviso enviado')}
                          >
                            Enviar agora
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Ban className="h-3.5 w-3.5" />}
                            loading={ocupado === `c${e.id}`}
                            onClick={() => agir(`c${e.id}`, () => engeApi.cancelarEnvio(e.id), 'Aviso cancelado')}
                          >
                            Cancelar
                          </Button>
                        </>
                      )}
                      {e.status === 'enviado' && (
                        <Button size="sm" variant="ghost" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => setVerEmail(e.id)}>
                          Ver e-mail
                        </Button>
                      )}
                    </span>
                  </li>
                )
              })}
              <li className="flex flex-wrap items-center gap-2 bg-elevate/[0.02] px-3 py-2.5">
                <span className="text-xs font-medium text-foreground/70">Novo aviso em</span>
                <input
                  id="ee-novo-envio"
                  type="datetime-local"
                  value={novoEnvio}
                  onChange={(e) => setNovoEnvio(e.target.value)}
                  className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground"
                  aria-label="Dia e hora do novo aviso"
                />
                <Button
                  size="sm"
                  className="ml-auto"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  disabled={!novoEnvio}
                  loading={ocupado === 'novo'}
                  onClick={() => agir('novo', () => engeApi.agendarEnvio(garantia.id, novoEnvio), `Aviso agendado para ${dataBr(novoEnvio)}`)}
                >
                  Agendar
                </Button>
              </li>
            </ul>
          </section>

          <section className="space-y-3 rounded-lg border border-line p-3">
            <h3 className="text-sm font-semibold text-foreground">Chamado na construtora</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input id="ee-ch-data" type="date" label="Aberto em" value={chamadoEm} onChange={(e) => setChamadoEm(e.target.value)} />
              <Input id="ee-ch-prot" label="Protocolo (opcional)" value={protocolo} onChange={(e) => setProtocolo(e.target.value)} />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {garantia.chamadoEm && (
                <Button size="sm" variant="ghost" loading={ocupado === 'chamado'} onClick={() => marcarChamado(false)}>
                  Desmarcar chamado
                </Button>
              )}
              <Button size="sm" variant="secondary" loading={ocupado === 'chamado'} onClick={() => marcarChamado(true)}>
                {garantia.chamadoEm ? 'Salvar chamado' : 'Registrar chamado aberto'}
              </Button>
            </div>
            {!garantia.chamadoEm && pendentes > 0 && (
              <p className="text-xs text-foreground/50">Ao registrar o chamado, os avisos que ainda não saíram são cancelados.</p>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-line p-3">
            <h3 className="text-sm font-semibold text-foreground">Dados da garantia</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input id="ee-g-item" label="Item" value={item} onChange={(e) => setItem(e.target.value)} containerClassName="sm:col-span-3" />
              <Input id="ee-g-prazo" label="Prazo" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
              <Input id="ee-g-venc" type="date" label="Vencimento" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                size="sm"
                variant="danger"
                loading={ocupado === 'remover'}
                onClick={() =>
                  agir('remover', () => engeApi.removerGarantia(garantia.id), 'Garantia removida').then(onFechar)
                }
              >
                Remover garantia
              </Button>
              <Button size="sm" loading={ocupado === 'dados'} onClick={salvarDados}>
                Salvar dados
              </Button>
            </div>
          </section>
        </div>
      </Modal>
      <EmailModal envioId={verEmail} onFechar={() => setVerEmail(null)} />
    </>
  )
}
