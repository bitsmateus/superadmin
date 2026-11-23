import * as React from 'react'
import { Check, Pencil, StickyNote, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Section } from '../ClientDrawer'
import { Button } from '@/components/ui/Button'
import { useCurrentUser } from '@/hooks/useClients'
import { db } from '@/services/db'
import { asText, cn } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type { Client } from '@/types/client'

/**
 * Notas internas do cliente: o espaço do time de suporte pra registrar pontos de atendimento, pendências, combinados e o que
 * mais precisar lembrar. Só o time vê. Fica separado das outras notas do cliente: aqui só aparece o que foi escrito nesta aba.
 */
export function NotasInternasTab({ client }: { client: Client }) {
  const [user] = useCurrentUser()
  const [texto, setTexto] = React.useState('')
  const [editandoId, setEditandoId] = React.useState<string | null>(null)
  const [textoEdicao, setTextoEdicao] = React.useState('')

  const notas = React.useMemo(
    () => (client.notes ?? []).filter((n) => n.origem === 'notas_internas').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [client.notes],
  )

  const registrar = () => {
    const t = texto.trim()
    if (!t) return
    if (!user) {
      toast.error('Defina seu nome em Configurações antes de registrar notas.')
      return
    }
    db.addInternalNote(client.id, t, user)
    db.addLog(client.id, 'Nota interna registrada')
    setTexto('')
    toast.success('Nota registrada')
  }

  return (
    <div className="space-y-5">
      <Section
        title={
          <span className="flex items-center gap-2">
            <StickyNote className="h-3.5 w-3.5 text-accent" />
            Notas internas do cliente
          </span>
        }
      >
        <p className="mb-3 text-xs text-foreground/50">
          Só o time vê. Use pra anotar pontos de atendimento, pendências, combinados e tudo que o próximo a atender precisa saber.
        </p>
        <div className="space-y-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') registrar()
            }}
            placeholder="Ex.: Pendente: cliente vai mandar o número novo. Atendimento: configurado o chatbot, falta testar o horário…"
            rows={4}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-foreground/40">Ctrl + Enter também registra</span>
            <Button size="sm" onClick={registrar} disabled={!texto.trim()} leftIcon={<StickyNote className="h-3.5 w-3.5" />}>
              Registrar nota
            </Button>
          </div>
        </div>

        <div className="mt-5">
          {notas.length === 0 ? (
            <p className="text-xs text-foreground/40">Nenhuma nota interna ainda.</p>
          ) : (
            <ul className="space-y-2.5">
              {notas.map((n) => (
                <li key={n.id} className={cn('rounded-lg border border-warning/30 bg-warning/[0.06] p-3')}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{asText(n.author, '—')}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-[10px] text-foreground/45" title={new Date(n.createdAt).toLocaleString('pt-BR')}>
                        {timeAgo(n.createdAt)}
                      </span>
                      {editandoId !== n.id && (
                        <>
                          <button
                            type="button"
                            title="Editar nota"
                            onClick={() => {
                              setEditandoId(n.id)
                              setTextoEdicao(n.text)
                            }}
                            className="ml-1 grid h-5 w-5 place-items-center rounded text-foreground/35 transition-colors hover:text-accent"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            title="Excluir nota"
                            onClick={() => {
                              if (!window.confirm('Excluir esta nota interna?')) return
                              db.deleteNote(client.id, n.id)
                              db.addLog(client.id, 'Nota interna excluída')
                              toast.success('Nota excluída')
                            }}
                            className="grid h-5 w-5 place-items-center rounded text-foreground/35 transition-colors hover:text-danger"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editandoId === n.id ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={textoEdicao}
                        onChange={(e) => setTextoEdicao(e.target.value)}
                        rows={4}
                        autoFocus
                        className="w-full resize-y rounded-lg border border-accent/40 bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => setEditandoId(null)} className="px-2 py-1 text-xs text-foreground/50 transition-colors hover:text-foreground">
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={!textoEdicao.trim()}
                          onClick={() => {
                            const t = textoEdicao.trim()
                            if (!t) return
                            db.updateNote(client.id, n.id, t)
                            db.addLog(client.id, 'Nota interna editada')
                            toast.success('Nota atualizada')
                            setEditandoId(null)
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
                        >
                          <Check className="h-3 w-3" />
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-foreground/85">{asText(n.text)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  )
}
