import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { AgendamentoField } from '@/components/comercial/AgendamentoField'
import { useAuth } from '@/hooks/useAuth'
import { useLeadBoards } from '@/hooks/useLeadBoards'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { useLeadPages } from '@/hooks/useLeadPages'
import { mesmoStatus } from '@/lib/regraDoStatus'
import { cn } from '@/lib/utils'
import { leadBoardsService } from '@/services/leadBoards'
import { leadLabelsService } from '@/services/leadLabels'
import { leadNotesService } from '@/services/leadNotes'
import type { Client } from '@/types/client'
import type { LeadBoard } from '@/types/leadBoard'

/** Telefone com DDD (10+ dígitos) ou "grupo" — quando a demanda chegou pelo grupo do WhatsApp, não por um número. */
export function telefoneDaDemandaOk(v: string): boolean {
  const t = v.trim()
  return /^grupo$/i.test(t) || t.replace(/\D/g, '').length >= 10
}

const escaparHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Os CRMs do time do suporte (Jean, João): abas de Demandas que vivem dentro do Pipeline. */
export function useCrmsDoSuporte() {
  const pages = useLeadPages()
  return React.useMemo(() => pages.filter((p) => p.section === 'demandas' && p.noPipeline), [pages])
}

/**
 * Card novo no CRM do Jean/João (aba de Demandas dentro do Pipeline). Em vez da linha vazia na tabela, um formulário
 * curto que só cria com Telefone, Tipo e "Finalizar até" preenchidos — vale pros cards novos; os que já existem
 * continuam como estão (e aparecem em "Sem info" se faltar algo).
 *
 * Sem `board` (botão "Nova tarefa" do Pipeline): a pessoa escolhe o responsável (o CRM do Jean ou do João) e o card
 * nasce no primeiro quadro dele ("Demandas pendentes"). Aí dá pra puxar o cliente do Pipeline (nome, empresa e
 * telefone). "O que fazer" vira a primeira Atualização do card.
 */
export function NovaDemandaModal({ board: quadroFixo, onClose, onCriada, clientes }: {
  board: LeadBoard | null
  onClose: () => void
  onCriada?: (id: string, board: LeadBoard) => void
  clientes?: Client[]
}) {
  // As etiquetas só carregam quando alguém pede (os quadros fechados ainda não pediram).
  React.useEffect(() => { void leadLabelsService.ensureLoaded() }, [])
  const { profile } = useAuth()
  const crms = useCrmsDoSuporte()
  const todosQuadros = useLeadBoards()
  const [crmId, setCrmId] = React.useState('')
  const board = quadroFixo ?? (crmId
    ? todosQuadros.filter((b) => b.page === crmId && !b.isVendas && !b.isContrato).sort((a, b) => a.position - b.position)[0] ?? null
    : null)
  const pagina = board?.page ?? crmId
  const tipos = useLeadLabels('tipo', pagina)
  const status = useLeadLabels('status', pagina)
  const [clienteId, setClienteId] = React.useState('')
  const [nome, setNome] = React.useState('')
  const [empresa, setEmpresa] = React.useState('')
  const [telefone, setTelefone] = React.useState('')
  // O cliente chamou num número ou no grupo do WhatsApp: um dos dois.
  const [peloGrupo, setPeloGrupo] = React.useState(false)
  const [tipo, setTipo] = React.useState('')
  const [finalizar, setFinalizar] = React.useState('')
  const [demanda, setDemanda] = React.useState('')
  const [tentou, setTentou] = React.useState(false)
  const [criando, setCriando] = React.useState(false)

  // Trocou de responsável: o Tipo é de cada CRM, então escolhe de novo se ele não existir no outro.
  React.useEffect(() => {
    if (tipo && tipos.length && !tipos.some((t) => t.name === tipo)) setTipo('')
  }, [tipos, tipo])

  const escolherCliente = (id: string) => {
    setClienteId(id)
    const c = clientes?.find((x) => x.id === id)
    if (!c) return
    setNome(c.name ?? '')
    setEmpresa(c.company ?? '')
    if (c.phone?.trim()) { setTelefone(c.phone); setPeloGrupo(false) }
  }

  const falta = !quadroFixo && !crmId ? 'Escolha o responsável.'
    : !board ? 'O CRM escolhido não tem quadro pra receber a demanda.'
    : !nome.trim() ? 'Escreva o nome.'
    : !peloGrupo && !telefoneDaDemandaOk(telefone) ? 'Telefone: o número com DDD, ou marque "Grupo" se a demanda veio pelo grupo.'
    : !tipo ? 'Escolha o tipo.'
    : !/^\d{4}-\d{2}-\d{2}/.test(finalizar) ? 'Escolha a data de "Finalizar até".'
    : ''

  const criar = async () => {
    setTentou(true)
    if (falta || !board || criando) return
    setCriando(true)
    const dados = {
      nome: nome.trim(),
      empresa: empresa.trim(),
      telefone: peloGrupo || /^grupo$/i.test(telefone.trim()) ? 'grupo' : telefone.trim(),
      tipo,
      agendamento: finalizar,
      // O Status acompanha o quadro em que o card nasce (é por ele que o card muda de quadro depois).
      status: status.find((l) => mesmoStatus(l.name, board.name))?.name ?? '',
    }
    const texto = demanda.trim()
    try {
      // Com "O que fazer", espera o card existir no banco pra a Atualização poder se ligar a ele.
      const row = texto
        ? await leadBoardsService.createRowAwaited(board.id, dados)
        : leadBoardsService.createRow(board.id, dados)
      if (texto) {
        const html = texto.split(/\n+/).map((l) => `<p>${escaparHtml(l)}</p>`).join('')
        await leadNotesService.addNote(row.id, html, profile?.name || profile?.email || 'Alguém')
      }
      onCriada?.(row.id, board)
      onClose()
    } catch (err) {
      toast.error('Falha ao criar a demanda: ' + (err as Error).message)
      setCriando(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={quadroFixo ? `Nova demanda — ${quadroFixo.name}` : 'Nova tarefa'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void criar()} disabled={criando}>{criando ? 'Criando…' : 'Criar'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {!quadroFixo && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground/70">Responsável *</p>
            <div className="flex flex-wrap gap-1.5">
              {crms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setCrmId(p.id)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    crmId === p.id ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-foreground/60 hover:bg-elevate/[0.04]',
                  )}
                >
                  {p.name}
                </button>
              ))}
              {!crms.length && <p className="text-xs text-foreground/50">Nenhum CRM do suporte disponível.</p>}
            </div>
            {board && <p className="mt-1 text-xs text-foreground/45">Entra no CRM dele, em “{board.name}”.</p>}
          </div>
        )}
        {!quadroFixo && !!clientes?.length && (
          <Select
            label="Cliente do Pipeline"
            value={clienteId}
            onChange={(e) => escolherCliente(e.target.value)}
            options={[
              { value: '', label: 'Nenhum (preencher à mão)' },
              ...[...clientes]
                .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                .map((c) => ({
                  value: c.id,
                  label: c.company?.trim() && c.company.trim() !== c.name ? `${c.name} — ${c.company}` : c.name,
                })),
            ]}
          />
        )}
        <Input label="Nome *" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus={!!quadroFixo} />
        <Input label="Empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground/70">Telefone *</p>
          <div className="mb-2 inline-flex overflow-hidden rounded-lg border border-line text-xs font-medium">
            {([['numero', 'Número'], ['grupo', 'Grupo']] as const).map(([v, r]) => (
              <button
                key={v}
                type="button"
                onClick={() => setPeloGrupo(v === 'grupo')}
                className={(v === 'grupo') === peloGrupo ? 'bg-accent/10 px-3 py-1.5 text-accent' : 'px-3 py-1.5 text-foreground/55 hover:bg-elevate/[0.04]'}
              >
                {r}
              </button>
            ))}
          </div>
          {!peloGrupo && (
            <Input aria-label="Telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Número com DDD" />
          )}
          {peloGrupo && <p className="text-xs text-foreground/50">A demanda veio pelo grupo do WhatsApp.</p>}
        </div>
        <Select
          label="Tipo *"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          disabled={!pagina}
          options={[{ value: '', label: pagina ? 'Escolha o tipo…' : 'Escolha o responsável antes' }, ...tipos.map((t) => ({ value: t.name, label: t.name }))]}
        />
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground/70">Finalizar até *</p>
          <div className="rounded-lg border border-line">
            <AgendamentoField value={finalizar} onChange={setFinalizar} className="w-full px-2.5 py-2 text-sm" />
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground/70">O que fazer</p>
          <textarea
            aria-label="O que fazer"
            value={demanda}
            onChange={(e) => setDemanda(e.target.value)}
            rows={3}
            placeholder="A demanda, do jeito que o cliente pediu. Vira a primeira Atualização do card."
            className="w-full resize-y rounded-lg border border-line bg-transparent px-2.5 py-2 text-sm outline-none focus:border-accent/50"
          />
        </div>
        {tentou && falta && <p className="text-xs text-danger">{falta}</p>}
      </div>
    </Modal>
  )
}
