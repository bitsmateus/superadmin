import * as React from 'react'
import { toast } from 'sonner'
import { Ban, Eye, Plus, Send } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { engeApi, type EngeCanais, type EngeEmpreendimento, type EngeEnvio, type EngeGarantia, type EnvioNovo } from '@/api/engeEnvio'
import { dataBr, dataHoraBr, diasAte, expandirRegua, hoje, paraCampo, somarDias, statusEnvio, sugerirEnvios, textoDias } from '@/lib/engeEnvio'
import { CanaisToggle, useCanaisPadrao, useEngeConfig, useModelos, useRecarregar, useReguas } from './shared'
import { ListaEnviosNovos } from './ReguaEditor'
import { EmailModal } from './EmailModal'

/**
 * Uma garantia e os avisos dela: escolher/remarcar o dia, a hora, o modelo e os canais de cada
 * envio, aplicar uma régua, mandar na hora, cancelar e marcar o chamado aberto na construtora.
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
  const [canaisEdit, setCanaisEdit] = React.useState<Record<string, EngeCanais>>({})
  const canaisPadrao = useCanaisPadrao()
  const [canaisNovo, setCanaisNovo] = React.useState<EngeCanais>(canaisPadrao)
  const [modeloEdit, setModeloEdit] = React.useState<Record<string, string | null>>({})
  const [modeloNovo, setModeloNovo] = React.useState<string | null>(null)
  const [reguaId, setReguaId] = React.useState('')
  const [enviosRegua, setEnviosRegua] = React.useState<EnvioNovo[]>([])
  const { data: modelos = [] } = useModelos()
  const { data: reguas = [] } = useReguas()
  const { data: cfg } = useEngeConfig()
  const whatsappDisponivel = Boolean(cfg?.nxOk)
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
    setCanaisEdit({})
    setCanaisNovo(canaisPadrao)
    setModeloEdit({})
    setModeloNovo(null)
    setReguaId('')
    setEnviosRegua([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Mesmo com erro pode ter mudado algo (ex.: o e-mail saiu e o WhatsApp falhou).
      await recarregar()
    } finally {
      setOcupado(null)
    }
  }

  const ordenados = [...envios].sort((a, b) => a.enviarEm.localeCompare(b.enviarEm))
  const pendentes = envios.filter((e) => e.status === 'agendado' || e.status === 'erro').length
  const dias = diasAte(garantia.vencimento)
  const nomeModelo = (id: string | null) =>
    modelos.find((m) => m.id === id)?.nome ?? `Padrão${modelos.find((m) => m.padrao) ? ` (${modelos.find((m) => m.padrao)!.nome})` : ''}`
  const seletorModelo = (id: string, valor: string | null, onChange: (v: string | null) => void) => (
    <select
      id={id}
      value={valor ?? ''}
      onChange={(ev) => onChange(ev.target.value || null)}
      className="h-8 max-w-[200px] rounded-md border border-line bg-surface px-2 text-xs text-foreground"
      aria-label="Modelo da mensagem"
    >
      <option value="">{nomeModelo(null)}</option>
      {modelos.map((m) => (
        <option key={m.id} value={m.id}>
          {m.nome}
        </option>
      ))}
    </select>
  )
  const escolherRegua = (id: string) => {
    setReguaId(id)
    const r = reguas.find((x) => x.id === id)
    setEnviosRegua(r ? expandirRegua(r.etapas, garantia.vencimento, { whatsappDisponivel }) : [])
  }

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
            <p className="break-words text-xs text-foreground/50">
              E-mail: {empreendimento?.emails || <span className="text-danger">sem e-mail cadastrado</span>} · WhatsApp:{' '}
              {empreendimento?.telefone || <span className="text-warning">sem número cadastrado</span>}
            </p>
            {ordenados.length === 0 && <p className="text-sm text-foreground/50">Nenhum aviso agendado para esta garantia.</p>}
            <ul className="divide-y divide-line rounded-lg border border-line">
              {ordenados.map((e) => {
                const s = statusEnvio(e)
                const editavel = e.status !== 'enviado'
                const valor = remarcar[e.id] ?? paraCampo(e.enviarEm)
                const canaisAtuais = { email: e.canalEmail, whatsapp: e.canalWhatsapp }
                const canais = canaisEdit[e.id] ?? canaisAtuais
                const modelo = e.id in modeloEdit ? modeloEdit[e.id] : e.modeloId
                const mudou =
                  valor !== paraCampo(e.enviarEm) ||
                  canais.email !== canaisAtuais.email ||
                  canais.whatsapp !== canaisAtuais.whatsapp ||
                  modelo !== e.modeloId
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
                        Enviado em {dataHoraBr(e.enviadoEm ?? e.whatsappEnviadoEm)}
                        {e.cienteEm && ` · ciente por ${e.cienteNome} em ${dataHoraBr(e.cienteEm)}`}
                      </span>
                    )}
                    {editavel ? (
                      <>
                        {seletorModelo(`ee-env-${e.id}-modelo`, modelo, (v) => setModeloEdit((m) => ({ ...m, [e.id]: v })))}
                        <CanaisToggle idBase={`ee-env-${e.id}`} valor={canais} onChange={(v) => setCanaisEdit((c) => ({ ...c, [e.id]: v }))} compacto />
                      </>
                    ) : (
                      <span className="text-xs text-foreground/50">· {nomeModelo(e.modeloId)}</span>
                    )}
                    <ResultadoCanais envio={e} />
                    <span className="ml-auto flex flex-wrap gap-1">
                      {editavel && mudou && (
                        <Button
                          size="sm"
                          loading={ocupado === `r${e.id}`}
                          onClick={() => agir(`r${e.id}`, () => engeApi.remarcarEnvio(e.id, valor, canais, modelo), 'Aviso salvo')}
                        >
                          Salvar
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
                      {(e.enviadoEm || e.whatsappEnviadoEm) && (
                        <Button size="sm" variant="ghost" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => setVerEmail(e.id)}>
                          Ver enviado
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
                {seletorModelo('ee-novo-modelo', modeloNovo, setModeloNovo)}
                <CanaisToggle idBase="ee-novo-canais" valor={canaisNovo} onChange={setCanaisNovo} compacto />
                <Button
                  size="sm"
                  className="ml-auto"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  disabled={!novoEnvio}
                  loading={ocupado === 'novo'}
                  onClick={() => agir('novo', () => engeApi.agendarEnvio(garantia.id, novoEnvio, canaisNovo, modeloNovo), `Aviso agendado para ${dataBr(novoEnvio)}`)}
                >
                  Agendar
                </Button>
              </li>
            </ul>
          </section>

          <section className="space-y-3 rounded-lg border border-line p-3">
            <h3 className="text-sm font-semibold text-foreground">Aplicar uma régua</h3>
            <p className="text-xs text-foreground/50">Agenda de uma vez os avisos de uma régua para este vencimento (os que já existem continuam).</p>
            <select
              id="ee-g-regua"
              value={reguaId}
              onChange={(e) => escolherRegua(e.target.value)}
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none"
            >
              <option value="">Escolha uma régua…</option>
              {reguas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome}
                </option>
              ))}
            </select>
            {reguaId && (
              <>
                <ListaEnviosNovos
                  idBase="ee-g-regua-env"
                  envios={enviosRegua}
                  onChange={setEnviosRegua}
                  modelos={modelos}
                  whatsappDisponivel={whatsappDisponivel}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!enviosRegua.length}
                    loading={ocupado === 'regua'}
                    onClick={() =>
                      agir('regua', () => engeApi.agendarLote(garantia.id, enviosRegua), `${enviosRegua.length} aviso(s) agendado(s)`).then(() =>
                        escolherRegua(''),
                      )
                    }
                  >
                    Agendar {enviosRegua.length} {enviosRegua.length === 1 ? 'aviso' : 'avisos'}
                  </Button>
                </div>
              </>
            )}
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

/** O que já aconteceu em cada canal escolhido do aviso (saiu, falhou ou ainda não). */
function ResultadoCanais({ envio: e }: { envio: EngeEnvio }) {
  const linhas: { texto: string; cor: string }[] = []
  if (e.canalEmail) {
    if (e.enviadoEm) linhas.push({ texto: `E-mail enviado para ${e.destinatarios}`, cor: 'text-foreground/50' })
    else if (e.erro) linhas.push({ texto: `E-mail: ${e.erro}`, cor: 'text-danger' })
  }
  if (e.canalWhatsapp) {
    if (e.whatsappEnviadoEm) linhas.push({ texto: `WhatsApp enviado para ${e.whatsappPara}`, cor: 'text-foreground/50' })
    if (e.whatsappErro) linhas.push({ texto: `WhatsApp: ${e.whatsappErro}`, cor: e.whatsappEnviadoEm ? 'text-warning' : 'text-danger' })
  }
  if (!linhas.length) return null
  return (
    <span className="w-full space-y-0.5">
      {linhas.map((l) => (
        <span key={l.texto} className={`block break-words text-xs ${l.cor}`}>
          {l.texto}
        </span>
      ))}
    </span>
  )
}
