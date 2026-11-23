import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { AgendamentoField } from '@/components/comercial/AgendamentoField'
import { useAuth } from '@/hooks/useAuth'
import { useClients } from '@/hooks/useClients'
import { useLeadBoards } from '@/hooks/useLeadBoards'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { useLeadPages } from '@/hooks/useLeadPages'
import { mesmoStatus } from '@/lib/regraDoStatus'
import { cn } from '@/lib/utils'
import { leadBoardsService } from '@/services/leadBoards'
import { leadLabelsService } from '@/services/leadLabels'
import { leadNotesService } from '@/services/leadNotes'
import { db } from '@/services/db'
import { CATEGORIAS_DA_DEMANDA, buscarClientes, descricaoDeOutroOk, ehCategoriaDeConfiguracao, ehTipoSuporte, textoDaNotaDeDemanda } from '@/lib/demandaDoCliente'
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
  // A demanda é de um cliente que já existe (escolhido por busca) ou de "Outro" (descrito à mão).
  const todosClientes = useClients()
  const listaDeClientes = clientes ?? todosClientes
  const [clienteId, setClienteId] = React.useState('')
  const [modoCliente, setModoCliente] = React.useState<'cliente' | 'outro'>('cliente')
  const [busca, setBusca] = React.useState('')
  const [outro, setOutro] = React.useState('')
  const clienteEscolhido = listaDeClientes.find((x) => x.id === clienteId)
  const achados = React.useMemo(
    () => (clienteEscolhido ? [] : buscarClientes(listaDeClientes, busca)),
    [listaDeClientes, busca, clienteEscolhido],
  )
  const motivoOutro = modoCliente === 'outro' ? descricaoDeOutroOk(outro) : ''
  const [nome, setNome] = React.useState('')
  const [empresa, setEmpresa] = React.useState('')
  const [telefone, setTelefone] = React.useState('')
  // O cliente chamou num número ou no grupo do WhatsApp: um dos dois.
  const [peloGrupo, setPeloGrupo] = React.useState(false)
  // Tipo em dois níveis: a categoria (SUPORTE, CONFIGURAÇÃO NOVA ou CONFIGURAÇÃO NOVO CLIENTE) e, só nas de configuração, o Tipo de
  // sempre (API OFICIAL, IA BÁSICA…). SUPORTE fica só como SUPORTE.
  const [categoria, setCategoria] = React.useState('')
  const [tipoDeConfig, setTipoDeConfig] = React.useState('')
  const ehConfig = ehCategoriaDeConfiguracao(categoria)
  const tiposDeConfig = React.useMemo(() => tipos.filter((t) => !ehTipoSuporte(t.name)), [tipos])
  const tipo = categoria === 'SUPORTE' ? 'SUPORTE' : ehConfig ? tipoDeConfig : ''
  const [finalizar, setFinalizar] = React.useState('')
  const [demanda, setDemanda] = React.useState('')
  const [tentou, setTentou] = React.useState(false)
  const [criando, setCriando] = React.useState(false)

  // Trocou de responsável: o Tipo é de cada CRM, então escolhe de novo se ele não existir no outro.
  React.useEffect(() => {
    if (tipoDeConfig && tipos.length && !tipos.some((t) => t.name === tipoDeConfig)) setTipoDeConfig('')
  }, [tipos, tipoDeConfig])

  const escolherCliente = (id: string) => {
    setClienteId(id)
    setBusca('')
    const c = listaDeClientes.find((x) => x.id === id)
    if (!c) return
    setNome(c.name ?? '')
    setEmpresa(c.company ?? '')
    if (c.phone?.trim()) { setTelefone(c.phone); setPeloGrupo(false) }
  }

  const falta = !quadroFixo && !crmId ? 'Escolha o responsável.'
    : !board ? 'O CRM escolhido não tem quadro pra receber a demanda.'
    : modoCliente === 'cliente' && !clienteEscolhido ? 'Escolha o cliente pela busca, ou marque "Outro" e descreva.'
    : modoCliente === 'outro' && motivoOutro ? motivoOutro
    : !nome.trim() ? 'Escreva o nome.'
    : !peloGrupo && !telefoneDaDemandaOk(telefone) ? 'Telefone: o número com DDD, ou marque "Grupo" se a demanda veio pelo grupo.'
    : !categoria ? 'Escolha o tipo: Suporte, Configuração nova ou Configuração novo cliente.'
    : ehConfig && !tipoDeConfig ? 'Escolha o tipo da configuração (API OFICIAL, IA BÁSICA…).'
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
      categoria,
      agendamento: finalizar,
      // O Status acompanha o quadro em que o card nasce (é por ele que o card muda de quadro depois).
      status: status.find((l) => mesmoStatus(l.name, board.name))?.name ?? '',
    }
    const texto = demanda.trim()
    const quem = profile?.name || profile?.email || 'Alguém'
    // "Outro": a descrição vai na primeira Atualização do card, pra ficar registrado de quem/o que é.
    const linhas = [
      ...(modoCliente === 'outro' ? [`Cliente: Outro — ${outro.trim().replace(/\s+/g, ' ')}`] : []),
      ...(texto ? texto.split(/\n+/) : []),
    ]
    try {
      // Com Atualização pra escrever, espera o card existir no banco pra ela poder se ligar a ele.
      const row = linhas.length
        ? await leadBoardsService.createRowAwaited(board.id, dados)
        : leadBoardsService.createRow(board.id, dados)
      if (linhas.length) {
        const html = linhas.map((l) => `<p>${escaparHtml(l)}</p>`).join('')
        await leadNotesService.addNote(row.id, html, quem)
      }
      // Cliente que já existe: a demanda criada também aparece em "Notas internas" dele (quem criou, número ou grupo, tipo, prazo e o que fazer).
      if (modoCliente === 'cliente' && clienteEscolhido) {
        db.addInternalNote(clienteEscolhido.id, textoDaNotaDeDemanda({
          criador: quem, telefone: dados.telefone, pelaGrupo: dados.telefone === 'grupo', categoria, tipo, finalizar, demanda: texto,
        }), quem)
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
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground/70">Cliente *</p>
          <div className="mb-2 inline-flex overflow-hidden rounded-lg border border-line text-xs font-medium">
            {([['cliente', 'Cliente'], ['outro', 'Outro']] as const).map(([v, r]) => (
              <button
                key={v}
                type="button"
                onClick={() => setModoCliente(v)}
                className={v === modoCliente ? 'bg-accent/10 px-3 py-1.5 text-accent' : 'px-3 py-1.5 text-foreground/55 hover:bg-elevate/[0.04]'}
              >
                {r}
              </button>
            ))}
          </div>
          {modoCliente === 'cliente' ? (
            clienteEscolhido ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium text-foreground">
                  {clienteEscolhido.name}
                  {clienteEscolhido.company?.trim() && clienteEscolhido.company.trim() !== clienteEscolhido.name && (
                    <span className="font-normal text-foreground/55"> — {clienteEscolhido.company}</span>
                  )}
                </span>
                <button type="button" onClick={() => setClienteId('')} className="shrink-0 text-xs text-foreground/50 hover:text-danger">Trocar</button>
              </div>
            ) : (
              <div>
                <Input
                  aria-label="Buscar cliente"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome, empresa, CNPJ ou telefone…"
                  autoComplete="off"
                />
                {busca.trim().length >= 2 && (
                  achados.length ? (
                    <ul className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-line bg-card">
                      {achados.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => escolherCliente(c.id)}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-elevate/[0.05]"
                          >
                            <span className="block truncate font-medium text-foreground">{c.name}</span>
                            <span className="block truncate text-xs text-foreground/50">
                              {[c.company?.trim() && c.company.trim() !== c.name ? c.company : '', c.phone, c.cnpj || c.fichaCadastro?.cnpj].filter(Boolean).join(' · ')}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-xs text-foreground/50">Nenhum cliente encontrado. Se não for cliente, marque “Outro”.</p>
                  )
                )}
              </div>
            )
          ) : (
            <div>
              <Input
                aria-label="Descreva o que é"
                value={outro}
                onChange={(e) => setOutro(e.target.value)}
                placeholder="Descreva quem ou o que é (ex.: parceiro, lead novo)…"
                autoComplete="off"
              />
              <p className={cn('mt-1 text-xs', outro.trim() && motivoOutro ? 'text-danger' : 'text-foreground/45')}>
                {outro.trim() && motivoOutro ? motivoOutro : 'Mínimo de 3 letras, com palavras de verdade.'}
              </p>
            </div>
          )}
        </div>
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
          value={categoria}
          onChange={(e) => { setCategoria(e.target.value); setTipoDeConfig('') }}
          disabled={!pagina}
          options={[{ value: '', label: pagina ? 'Escolha o tipo…' : 'Escolha o responsável antes' }, ...CATEGORIAS_DA_DEMANDA.map((c) => ({ value: c, label: c }))]}
        />
        {ehConfig && (
          <Select
            label="Tipo da configuração *"
            value={tipoDeConfig}
            onChange={(e) => setTipoDeConfig(e.target.value)}
            options={[{ value: '', label: 'Escolha o tipo da configuração…' }, ...tiposDeConfig.map((t) => ({ value: t.name, label: t.name }))]}
          />
        )}
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
