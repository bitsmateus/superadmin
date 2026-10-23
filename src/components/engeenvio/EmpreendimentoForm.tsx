import * as React from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { engeApi, type EmpreendimentoDados, type EngeCanais, type EngeEmpreendimento } from '@/api/engeEnvio'
import { cn } from '@/lib/utils'
import {
  ANTECEDENCIAS,
  ANTECEDENCIAS_PADRAO,
  MODELO_GARANTIAS,
  dataBr,
  prazoTexto,
  somarMeses,
  sugerirEnvios,
} from '@/lib/engeEnvio'
import { CanaisToggle, useCanaisPadrao, useRecarregar } from './shared'

interface LinhaGarantia {
  chave: string
  marcada: boolean
  item: string
  prazo: string
  meses: number | null
  vencimento: string
}

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
 * Cadastro/edição de empreendimento. Ao CRIAR, já monta as garantias a partir da data de entrega
 * (modelo padrão + CVCB) e os avisos de cada uma — os dias exatos podem ser trocados depois, item
 * por item, na tela do empreendimento.
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
  const [dados, setDados] = React.useState<EmpreendimentoDados>(vazio)
  const [linhas, setLinhas] = React.useState<LinhaGarantia[]>([])
  const [cvcb, setCvcb] = React.useState('')
  const [antecedencias, setAntecedencias] = React.useState<number[]>(ANTECEDENCIAS_PADRAO)
  const [hora, setHora] = React.useState('09:00')
  const canaisPadrao = useCanaisPadrao()
  const [canais, setCanais] = React.useState<EngeCanais>(canaisPadrao)
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!aberto) return
    setDados(editando ? { ...vazio, ...editando } : vazio)
    setLinhas(
      MODELO_GARANTIAS.map((m, i) => ({
        chave: `m${i}`,
        marcada: true,
        item: m.item,
        prazo: prazoTexto(m.meses),
        meses: m.meses,
        vencimento: '',
      })),
    )
    setCvcb('')
    setAntecedencias(ANTECEDENCIAS_PADRAO)
    setHora('09:00')
    setCanais(canaisPadrao)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, editando])

  // Trocar a entrega recalcula o vencimento das garantias que vêm do modelo.
  const mudarEntrega = (entrega: string) => {
    setDados((d) => ({ ...d, entrega }))
    if (entrega) {
      setLinhas((ls) => ls.map((l) => (l.meses ? { ...l, vencimento: somarMeses(entrega, l.meses) } : l)))
    }
  }

  const set = (campo: keyof EmpreendimentoDados) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDados((d) => ({ ...d, [campo]: e.target.value }))
  const setLinha = (chave: string, patch: Partial<LinhaGarantia>) =>
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...patch } : l)))

  const garantiasParaCriar = () => {
    const lista = linhas
      .filter((l) => l.marcada && l.item.trim() && l.vencimento)
      .map((l) => ({ item: l.item.trim(), prazo: l.prazo, vencimento: l.vencimento }))
    if (cvcb) lista.push({ item: 'CVCB – Certificado de Vistoria do Corpo de Bombeiros', prazo: 'Renovação anual', vencimento: cvcb })
    return lista.map((g) => ({ ...g, envios: sugerirEnvios(g.vencimento, antecedencias, hora) }))
  }

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
        const criado = await engeApi.criarEmpreendimento({ ...dados, garantias, canais })
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

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      size="xl"
      title={editando ? 'Editar empreendimento' : 'Novo empreendimento'}
      description={editando ? undefined : 'As garantias e os avisos são gerados a partir da data de entrega.'}
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
      <form id="ee-form-emp" onSubmit={salvar} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="ee-nome" label="Nome do empreendimento" value={dados.nome ?? ''} onChange={set('nome')} required />
          <Input id="ee-cidade" label="Cidade" value={dados.cidade ?? ''} onChange={set('cidade')} />
          <Input id="ee-sindico" label="Síndico" value={dados.sindico ?? ''} onChange={set('sindico')} />
          <Input
            id="ee-emails"
            label="E-mail(s) do síndico"
            hint="Separe por vírgula para mandar a mais de uma pessoa"
            value={dados.emails ?? ''}
            onChange={set('emails')}
          />
          <Input
            id="ee-tel"
            label="WhatsApp do síndico"
            hint="Com DDD. Separe por vírgula para mandar a mais de um número"
            value={dados.telefone ?? ''}
            onChange={set('telefone')}
          />
          <Input id="ee-construtora" label="Construtora" value={dados.construtora ?? ''} onChange={set('construtora')} />
          <Input
            id="ee-entrega"
            type="date"
            label="Data de entrega"
            value={dados.entrega ?? ''}
            onChange={(e) => mudarEntrega(e.target.value)}
          />
          {!editando && (
            <Input id="ee-cvcb" type="date" label="Validade do CVCB" value={cvcb} onChange={(e) => setCvcb(e.target.value)} />
          )}
        </div>
        <Textarea id="ee-obs" label="Observações" value={dados.observacoes ?? ''} onChange={set('observacoes')} className="min-h-[60px]" />

        {!editando && (
          <>
            <div className="space-y-2 rounded-lg border border-line p-3">
              <p className="text-xs font-medium text-foreground/70">Avisos sugeridos (quantos dias antes de cada vencimento)</p>
              <div className="flex flex-wrap items-center gap-2">
                {ANTECEDENCIAS.map((n) => {
                  const on = antecedencias.includes(n)
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAntecedencias((a) => (on ? a.filter((x) => x !== n) : [...a, n]))}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                        on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-foreground/60 hover:text-foreground',
                      )}
                    >
                      {n} {n === 1 ? 'dia' : 'dias'}
                    </button>
                  )
                })}
                <span className="ml-1 text-xs text-foreground/50">às</span>
                <input
                  id="ee-hora"
                  type="time"
                  value={hora}
                  onChange={(e) => setHora(e.target.value || '09:00')}
                  className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-foreground/50">Enviar por</span>
                <CanaisToggle idBase="ee-form-canais" valor={canais} onChange={setCanais} />
              </div>
              <p className="text-xs text-foreground/40">
                Depois de criar, dá para trocar o dia e os canais de cada aviso, item por item. Datas que já passaram não entram.
              </p>
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-elevate/[0.02]">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-foreground/50">
                    <th className="w-8 px-3 py-2" />
                    <th className="px-3 py-2 font-medium">Garantia</th>
                    <th className="px-3 py-2 font-medium">Prazo</th>
                    <th className="px-3 py-2 font-medium">Vencimento</th>
                    <th className="w-8 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {linhas.map((l) => (
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
                          className="h-8 w-24 rounded-md border border-transparent bg-transparent px-1.5 text-foreground/70 hover:border-line focus:border-accent focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          id={`ee-lv-${l.chave}`}
                          type="date"
                          value={l.vencimento}
                          onChange={(e) => setLinha(l.chave, { vencimento: e.target.value, meses: null })}
                          className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground"
                        />
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
                  ))}
                  {cvcb && (
                    <tr>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2">CVCB – Certificado de Vistoria do Corpo de Bombeiros</td>
                      <td className="px-3 py-2 text-foreground/70">Renovação anual</td>
                      <td className="px-3 py-2 text-xs tabular-nums">{dataBr(cvcb)}</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() =>
                setLinhas((ls) => [
                  ...ls,
                  { chave: `n${Date.now()}`, marcada: true, item: '', prazo: '', meses: null, vencimento: '' },
                ])
              }
            >
              Adicionar garantia
            </Button>
            {!dados.entrega && (
              <p className="text-xs text-warning">Informe a data de entrega para calcular os vencimentos.</p>
            )}
          </>
        )}
      </form>
    </Modal>
  )
}
