import * as React from 'react'
import { Pin, PinOff, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import {
  TIPOS_HISTORICO, gestaoClientes,
  type GcRegistroHistorico, type GcTipoHistorico,
} from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

const TOM: Partial<Record<GcTipoHistorico, 'info' | 'warning' | 'danger' | 'neutral'>> = {
  reuniao: 'info',
  ligacao: 'info',
  reclamacao: 'danger',
  ajuste: 'warning',
}

function rotuloTipo(tipo: GcTipoHistorico): string {
  if (tipo === 'evento_sistema') return 'Sistema'
  return TIPOS_HISTORICO.find((t) => t.valor === tipo)?.label ?? tipo
}

function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Histórico do cliente — notas do time e eventos automáticos (etapa concluída, status trocado) na
 * mesma linha do tempo. É aqui que fica a resposta pra "o que aconteceu com esse cliente?" sem
 * depender de alguém lembrar da conversa no WhatsApp.
 *
 * Os eventos do sistema não podem ser editados pela tela: o que o sistema registrou aconteceu.
 */
export function AbaHistorico({
  historico,
  clienteId,
  onMudou,
}: {
  historico: GcRegistroHistorico[]
  clienteId: string
  onMudou: () => Promise<void> | void
}) {
  const [tipo, setTipo] = React.useState<GcTipoHistorico>('nota')
  const [texto, setTexto] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!texto.trim()) return
    setSalvando(true)
    try {
      await gestaoClientes.registrar(clienteId, { tipo, descricao: texto.trim() })
      setTexto('')
      await onMudou()
    } catch (err) {
      toast.error('Falha ao registrar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={registrar} className="rounded-xl border border-line p-3">
        <Textarea
          rows={3}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="O que aconteceu? (reunião, ligação, ajuste de campanha, reclamação…)"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <Select
            options={TIPOS_HISTORICO.map((t) => ({ value: t.valor, label: t.label }))}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as GcTipoHistorico)}
            className="w-44"
          />
          <Button type="submit" loading={salvando} disabled={!texto.trim()}>
            Registrar
          </Button>
        </div>
      </form>

      {historico.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground/50">
          Nada registrado ainda. O que for escrito aqui fica no histórico do cliente.
        </p>
      ) : (
        <ol className="space-y-2">
          {historico.map((r) => (
            <li
              key={r.id}
              className={cn(
                'group rounded-xl border border-line px-4 py-3',
                r.fixado && 'border-accent/30 bg-accent/[0.03]',
              )}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TOM[r.tipo] ?? 'neutral'}>{rotuloTipo(r.tipo)}</Badge>
                    {r.titulo && <span className="font-medium text-foreground">{r.titulo}</span>}
                    <span className="text-xs text-foreground/45">
                      {quando(r.created_at)}
                      {r.autor_nome ? ` · ${r.autor_nome}` : ''}
                    </span>
                  </div>
                  {r.descricao && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{r.descricao}</p>
                  )}
                </div>
                {r.tipo !== 'evento_sistema' && (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() =>
                        void agir(() => gestaoClientes.atualizarRegistro(r.id, { fixado: !r.fixado }))
                      }
                      className="text-foreground/30 hover:text-accent"
                      aria-label={r.fixado ? 'Desafixar' : 'Fixar no topo'}
                    >
                      {r.fixado ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void agir(() => gestaoClientes.excluirRegistro(r.id))}
                      className="text-foreground/30 hover:text-danger"
                      aria-label="Excluir registro"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
