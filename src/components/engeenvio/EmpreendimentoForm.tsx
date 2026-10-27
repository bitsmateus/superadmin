import * as React from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { engeApi, type EmpreendimentoDados, type EngeEmpreendimento, type EngeRegua, type EtapaRegua } from '@/api/engeEnvio'
import { cn } from '@/lib/utils'
import { MODELO_GARANTIAS, expandirRegua, hoje, prazoTexto, somarMeses } from '@/lib/engeEnvio'
import { useEngeConfig, useModelos, useRecarregar, useReguas } from './shared'
import { ReguaEditor, ReguaLinhaTempo } from './ReguaEditor'

interface LinhaGarantia {
  chave: string
  marcada: boolean
  item: string
  prazo: string
  meses: number | null
  vencimento: string
  /** '' = régua principal do empreendimento; senão o id de outra régua salva. */
  reguaId: string
}

const CVCB = 'CVCB – Certificado de Vistoria do Corpo de Bombeiros'

const vazio: EmpreendimentoDados = {
  nome: '',
  cidade: '',
  entrega: '',
  sindico: '',
  emails: '',
  telefone: '',
  construtora: '',
  observacoes: '',
}

/**
 * Cadastro/edição de empreendimento. Ao CRIAR, monta as garantias a partir da data de entrega
 * (modelo de garantias + CVCB) e agenda os avisos de cada uma pela régua de envio escolhida —
 * a régua principal vale pra todas, e cada garantia pode usar outra (ex.: o CVCB). Os dias de
 * cada aviso ainda podem ser trocados depois, item por item, na tela do empreendimento.
 */
export function EmpreendimentoForm({
  aberto,
  onFechar,
  editando,
  onCriado,
}: {
  aberto: boolean
  onFechar: () => void
  editando?: EngeEmpreendimento | null
  onCriado?: (id: string) => void
}) {
  const recarregar = useRecarregar()
  const { data: reguas = [] } = useReguas()
  const { data: modelos = [] } = useModelos()
  const { data: cfg } = useEngeConfig()
  const whatsappDisponivel = Boolean(cfg?.nxOk)

  const [dados, setDados] = React.useState<EmpreendimentoDados>(vazio)
  const [linhas, setLinhas] = React.useState<LinhaGarantia[]>([])
  const [reguaId, setReguaId] = React.useState('')
  const [etapas, setEtapas] = React.useState<EtapaRegua[]>([])
  const [ajustar, setAjustar] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  const reguaCvcb = reguas.find((r) => /cvcb/i.test(r.nome))

  React.useEffect(() => {
    if (!aberto) return
    setDados(editando ? { ...vazio, ...editando } : vazio)
    setLinhas([
      ...MODELO_GARANTIAS.map((m, i) => ({
        chave: `m${i}`,
        marcada: true,
        item: m.item,
        prazo: prazoTexto(m.meses),
        meses: m.meses,
        vencimento: '',
        reguaId: '',
      })),
      { chave: 'cvcb', marcada: true, item: CVCB, prazo: 'Renovação anual', meses: null, vencimento: '', reguaId: reguaCvcb?.id ?? '' },
    ])
    setAjustar(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, editando])

  // Régua principal começa na padrão (quando a lista de réguas chega).
  React.useEffect(() => {
    if (!aberto || editando || reguaId) return
    const padrao = reguas.find((r) => r.padrao) ?? reguas[0]
    if (padrao) {
      setReguaId(padrao.id)
      setEtapas(padrao.etapas)
    }
    if (reguaCvcb) setLinhas((ls) => ls.map((l) => (l.chave === 'cvcb' && !l.reguaId ? { ...l, reguaId: reguaCvcb.id } : l)))
  }, [aberto, editando, reguas, reguaId, reguaCvcb])

  React.useEffect(() => {
    if (!aberto) setReguaId('')
  }, [aberto])

  const escolherRegua = (id: string) => {
    setReguaId(id)
    setEtapas(reguas.find((r) => r.id === id)?.etapas ?? [])
  }

  // Trocar a entrega recalcula o vencimento das garantias que vêm do modelo.
  const mudarEntrega = (entrega: string) => {
    setDados((d) => ({ ...d, entrega }))
    if (entrega) setLinhas((ls) => ls.map((l) => (l.meses ? { ...l, vencimento: somarMeses(entrega, l.meses) } : l)))
  }

  const set = (campo: keyof EmpreendimentoDados) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDados((d) => ({ ...d, [campo]: e.target.value }))
  const setLinha = (chave: string, patch: Partial<LinhaGarantia>) =>
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...patch } : l)))

  const etapasDaLinha = (l: LinhaGarantia): EtapaRegua[] =>
    l.reguaId ? (reguas.find((r: EngeRegua) => r.id === l.reguaId)?.etapas ?? []) : etapas
  const enviosDaLinha = (l: LinhaGarantia) => (l.vencimento ? expandirRegua(etapasDaLinha(l), l.vencimento, { whatsappDisponivel }) : [])

  const garantiasParaCriar = () =>
    linhas
      .filter((l) => l.marcada && l.item.trim() && l.vencimento)
      .map((l) => ({ item: l.item.trim(), prazo: l.prazo, vencimento: l.vencimento, envios: enviosDaLinha(l) }))

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dados.nome?.trim()) return toast.error('Dê um nome ao empreendimento.')
    setSalvando(true)
    try {
      if (editando) {
        await engeApi.salvarEmpreendimento(editando.id, dados)
        toast.success('Empreendimento salvo')
      } else {
        const garantias = garantiasParaCriar()
        const criado = await engeApi.criarEmpreendimento({ ...dados, garantias })
        const avisos = garantias.reduce((s, g) => s + g.envios.length, 0)
        toast.success(`Empreendimento criado com ${garantias.length} garantias e ${avisos} avisos agendados`)
        onCriado?.(criado.id)
      }
      await recarregar()
      onFechar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const totalAvisos = !editando ? garantiasParaCriar().reduce((s, g) => s + g.envios.length, 0) : 0
  const reguaAtual = reguas.find((r) => r.id === reguaId)
  const ajustada = Boolean(reguaAtual) && JSON.stringify(reguaAtual!.etapas) !== JSON.stringify(etapas)
  // Exemplo da linha do tempo: o próximo vencimento que usa a régua principal.
  const proximoVenc = linhas
    .filter((l) => l.marcada && !l.reguaId && l.vencimento > hoje())
    .map((l) => l.vencimento)
    .sort()[0]

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      size={editando ? 'xl' : '2xl'}
      title={editando ? 'Editar empreendimento' : 'Novo empreendimento'}
      description={editando ? undefined : 'As garantias saem da data de entrega e os avisos, da régua de envio.'}
      footer={
        <>
          <Button variant="secondary" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" form="ee-form-emp" loading={salvando}>
            {editando ? 'Salvar' : `Criar e agendar ${totalAvisos} avisos`}
          </Button>
        </>
      }
    >
      <form id="ee-form-emp" onSubmit={salvar} className="space-y-6 text-foreground">
        <section className="space-y-3">
          {!editando && <Passo n={1} titulo="Dados do empreendimento" />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input id="ee-nome" label="Nome do empreendimento" value={dados.nome ?? ''} onChange={set('nome')} required />
            <Input id="ee-cidade" label="Cidade" value={dados.cidade ?? ''} onChange={set('cidade')} />
            <Input id="ee-sindico" label="Responsável" value={dados.sindico ?? ''} onChange={set('sindico')} />
            <Input
              id="ee-tel"
              label="WhatsApp do responsável"
              hint="Com DDD. Separe por vírgula para mandar a mais de um número"
              value={dados.telefone ?? ''}
              onChange={set('telefone')}
            />
            <div className="sm:col-span-2">
              <ListaEmails
                key={aberto ? editando?.id ?? 'novo' : 'fechado'}
                valor={dados.emails ?? ''}
                onChange={(emails) => setDados((d) => ({ ...d, emails }))}
              />
            </div>
            <Input id="ee-construtora" label="Construtora" value={dados.construtora ?? ''} onChange={set('construtora')} />
            <Input
              id="ee-entrega"
              type="date"
              label="Data de entrega"
              value={dados.entrega ?? ''}
              onChange={(e) => mudarEntrega(e.target.value)}
            />
          </div>
          <Textarea id="ee-obs" label="Observações" value={dados.observacoes ?? ''} onChange={set('observacoes')} className="min-h-[60px]" />
        </section>

        {!editando && (
          <>
            <section className="space-y-3">
              <Passo n={2} titulo="Régua de envio" detalhe="Quando sai cada aviso, com qual mensagem e por qual canal." />
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[240px] flex-1">
                  <label htmlFor="ee-regua" className="mb-1.5 block text-xs font-medium text-foreground/70">
                    Régua principal (vale para todas as garantias, menos as que tiverem outra escolhida)
                  </label>
                  <select
                    id="ee-regua"
                    value={reguaId}
                    onChange={(e) => escolherRegua(e.target.value)}
                    className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none"
                  >
                    {reguas.length === 0 && <option value="">Nenhuma régua cadastrada</option>}
                    {reguas.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nome}
                        {r.padrao ? ' (padrão)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  rightIcon={ajustar ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  onClick={() => setAjustar((a) => !a)}
                >
                  {ajustar ? 'Fechar ajustes' : 'Ajustar para este empreendimento'}
                </Button>
              </div>
              {ajustada && (
                <p className="text-xs text-accent">
                  Régua ajustada só para este empreendimento (a régua salva não muda).{' '}
                  <button type="button" className="underline" onClick={() => escolherRegua(reguaId)}>
                    Desfazer ajustes
                  </button>
                </p>
              )}
              <div className={cn('grid gap-4', ajustar && 'xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]')}>
                {ajustar && (
                  <ReguaEditor
                    idBase="ee-form-regua"
                    etapas={etapas}
                    onChange={setEtapas}
                    modelos={modelos}
                    whatsappDisponivel={whatsappDisponivel}
                  />
                )}
                <div className="rounded-lg border border-line p-3">
                  <ReguaLinhaTempo etapas={etapas} modelos={modelos} vencimento={proximoVenc} whatsappDisponivel={whatsappDisponivel} />
                </div>
              </div>
              {!whatsappDisponivel && etapas.some((e) => e.whatsapp) && (
                <p className="text-xs text-warning">
                  A conexão do WhatsApp (NX) ainda não está configurada: por enquanto os avisos vão só por e-mail.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <Passo n={3} titulo="Garantias" detalhe="Desmarque o que não se aplica. Os vencimentos saem da data de entrega." />
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-elevate/[0.02]">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-foreground/50">
                      <th className="w-8 px-3 py-2" />
                      <th className="px-3 py-2 font-medium">Garantia</th>
                      <th className="px-3 py-2 font-medium">Prazo</th>
                      <th className="px-3 py-2 font-medium">Vencimento</th>
                      <th className="px-3 py-2 font-medium">Régua</th>
                      <th className="px-3 py-2 text-right font-medium">Avisos</th>
                      <th className="w-8 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {linhas.map((l) => {
                      const qtd = enviosDaLinha(l).length
                      return (
                        <tr key={l.chave} className={cn(!l.marcada && 'opacity-50')}>
                          <td className="px-3 py-1.5">
                            <input
                              id={`ee-l-${l.chave}`}
                              type="checkbox"
                              checked={l.marcada}
                              onChange={(e) => setLinha(l.chave, { marcada: e.target.checked })}
                              aria-label={`Incluir ${l.item}`}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              id={`ee-li-${l.chave}`}
                              value={l.item}
                              onChange={(e) => setLinha(l.chave, { item: e.target.value })}
                              className="h-8 w-full min-w-[180px] rounded-md border border-transparent bg-transparent px-1.5 text-foreground hover:border-line focus:border-accent focus:outline-none"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              id={`ee-lp-${l.chave}`}
                              value={l.prazo}
                              onChange={(e) => setLinha(l.chave, { prazo: e.target.value })}
                              className="h-8 w-28 rounded-md border border-transparent bg-transparent px-1.5 text-foreground/70 hover:border-line focus:border-accent focus:outline-none"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              id={`ee-lv-${l.chave}`}
                              type="date"
                              value={l.vencimento}
                              onChange={(e) => setLinha(l.chave, { vencimento: e.target.value, meses: null })}
                              className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground"
                              aria-label={`Vencimento de ${l.item}`}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              id={`ee-lr-${l.chave}`}
                              value={l.reguaId}
                              onChange={(e) => setLinha(l.chave, { reguaId: e.target.value })}
                              className="h-8 max-w-[200px] rounded-md border border-line bg-surface px-2 text-xs text-foreground"
                              aria-label={`Régua de ${l.item}`}
                            >
                              <option value="">Régua principal</option>
                              {reguas
                                .filter((r) => r.id !== reguaId)
                                .map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.nome}
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums text-foreground/70">
                            {!l.vencimento ? '—' : qtd ? qtd : <span className="text-warning">0</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            <button
                              type="button"
                              onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}
                              className="rounded p-1 text-foreground/40 hover:text-danger"
                              aria-label={`Remover ${l.item}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() =>
                    setLinhas((ls) => [
                      ...ls,
                      { chave: `n${Date.now()}`, marcada: true, item: '', prazo: '', meses: null, vencimento: '', reguaId: '' },
                    ])
                  }
                >
                  Adicionar item
                </Button>
                {!dados.entrega ? (
                  <p className="text-xs text-warning">Informe a data de entrega para calcular os vencimentos.</p>
                ) : (
                  <p className="text-xs text-foreground/50">Garantia com 0 avisos: as datas da régua já passaram ou falta o vencimento.</p>
                )}
              </div>
            </section>
          </>
        )}
      </form>
    </Modal>
  )
}

function Passo({ n, titulo, detalhe }: { n: number; titulo: string; detalhe?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
        {n}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
        {detalhe && <p className="text-xs text-foreground/50">{detalhe}</p>}
      </div>
    </div>
  )
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * E-mails que recebem os avisos, um por linha. No banco continua uma lista separada por vírgula
 * (o envio já manda pra todos de uma vez); aqui cada e-mail ganha o próprio campo.
 */
const separarEmails = (texto: string) => texto.split(/[,;\n]/).map((e) => e.trim()).filter(Boolean)

function ListaEmails({ valor, onChange }: { valor: string; onChange: (emails: string) => void }) {
  const [linhas, setLinhas] = React.useState<string[]>(() => (separarEmails(valor).length ? separarEmails(valor) : ['']))
  // Os dados do empreendimento chegam depois que a janela abre: quando o valor muda por fora (não
  // por digitação aqui), as linhas acompanham. Sem isso, editar começava vazio e apagava os e-mails.
  React.useEffect(() => {
    const externo = separarEmails(valor)
    setLinhas((atuais) => (separarEmails(atuais.join(',')).join(', ') === externo.join(', ') ? atuais : externo.length ? externo : ['']))
  }, [valor])
  const mudar = (novas: string[]) => {
    setLinhas(novas)
    onChange(separarEmails(novas.join(',')).join(', '))
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground/70">E-mails do responsável</p>
      {linhas.map((email, i) => {
        const invalido = email.trim() !== '' && !EMAIL_OK.test(email.trim())
        return (
          <div key={i} className="flex items-start gap-2">
            <Input
              id={`ee-email-${i}`}
              type="email"
              placeholder="nome@exemplo.com.br"
              value={email}
              onChange={(e) => mudar(linhas.map((x, j) => (j === i ? e.target.value : x)))}
              error={invalido ? 'E-mail inválido' : undefined}
              aria-label={`E-mail ${i + 1}`}
            />
            {linhas.length > 1 && (
              <button
                type="button"
                onClick={() => mudar(linhas.filter((_, j) => j !== i))}
                className="mt-2.5 rounded p-1 text-foreground/40 hover:text-danger"
                aria-label={`Remover e-mail ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )
      })}
      <Button type="button" variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLinhas((l) => [...l, ''])}>
        Adicionar e-mail
      </Button>
      <p className="text-xs text-foreground/40">Todos os e-mails da lista recebem cada aviso.</p>
    </div>
  )
}
