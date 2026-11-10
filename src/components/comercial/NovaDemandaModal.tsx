import * as React from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { AgendamentoField } from '@/components/comercial/AgendamentoField'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { mesmoStatus } from '@/lib/regraDoStatus'
import { leadBoardsService } from '@/services/leadBoards'
import { leadLabelsService } from '@/services/leadLabels'
import type { LeadBoard } from '@/types/leadBoard'

/** Telefone com DDD (10+ dígitos) ou "grupo" — quando a demanda chegou pelo grupo do WhatsApp, não por um número. */
export function telefoneDaDemandaOk(v: string): boolean {
  const t = v.trim()
  return /^grupo$/i.test(t) || t.replace(/\D/g, '').length >= 10
}

/**
 * Card novo no CRM do Jean/João (aba de Demandas dentro do Pipeline). Em vez da linha vazia na tabela, um formulário
 * curto que só cria com Telefone, Tipo e "Finalizar até" preenchidos — vale pros cards novos; os que já existem
 * continuam como estão (e aparecem em "Sem info" se faltar algo).
 */
export function NovaDemandaModal({ board, onClose, onCriada }: {
  board: LeadBoard
  onClose: () => void
  onCriada: (id: string) => void
}) {
  // As etiquetas só carregam quando alguém pede (os quadros fechados ainda não pediram).
  React.useEffect(() => { void leadLabelsService.ensureLoaded() }, [])
  const tipos = useLeadLabels('tipo', board.page)
  const status = useLeadLabels('status', board.page)
  const [nome, setNome] = React.useState('')
  const [empresa, setEmpresa] = React.useState('')
  const [telefone, setTelefone] = React.useState('')
  const [tipo, setTipo] = React.useState('')
  const [finalizar, setFinalizar] = React.useState('')
  const [tentou, setTentou] = React.useState(false)

  const falta = !nome.trim() ? 'Escreva o nome.'
    : !telefoneDaDemandaOk(telefone) ? 'Telefone: o número com DDD, ou "grupo" se a demanda veio pelo grupo.'
    : !tipo ? 'Escolha o tipo.'
    : !/^\d{4}-\d{2}-\d{2}/.test(finalizar) ? 'Escolha a data de "Finalizar até".'
    : ''

  const criar = () => {
    setTentou(true)
    if (falta) return
    const row = leadBoardsService.createRow(board.id, {
      nome: nome.trim(),
      empresa: empresa.trim(),
      telefone: /^grupo$/i.test(telefone.trim()) ? 'grupo' : telefone.trim(),
      tipo,
      agendamento: finalizar,
      // O Status acompanha o quadro em que o card nasce (é por ele que o card muda de quadro depois).
      status: status.find((l) => mesmoStatus(l.name, board.name))?.name ?? '',
    })
    onCriada(row.id)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Nova demanda — ${board.name}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={criar}>Criar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Nome *" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        <Input label="Empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
        <Input
          label="Telefone *"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          placeholder='Número com DDD, ou "grupo"'
        />
        <Select
          label="Tipo *"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          options={[{ value: '', label: 'Escolha o tipo…' }, ...tipos.map((t) => ({ value: t.name, label: t.name }))]}
        />
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground/70">Finalizar até *</p>
          <div className="rounded-lg border border-line">
            <AgendamentoField value={finalizar} onChange={setFinalizar} className="w-full px-2.5 py-2 text-sm" />
          </div>
        </div>
        {tentou && falta && <p className="text-xs text-danger">{falta}</p>}
      </div>
    </Modal>
  )
}
