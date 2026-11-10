import { Users, X } from 'lucide-react'
import { EditableField } from '@/components/comercial/EditableField'
import { TelefoneAcoes } from '@/components/comercial/TelefoneAcoes'
import { cn } from '@/lib/utils'

/** O telefone guardado é "grupo": a demanda chegou pelo grupo do WhatsApp, não por um número. */
export const ehGrupo = (v: string) => /^grupo$/i.test(v.trim())

/**
 * Telefone do CRM do Jean/João: o cliente chamou num número OU no grupo — um dos dois é obrigatório. Campo do número
 * com um botão "Grupo" do lado; marcado o grupo, vira um selo "Grupo" (o X volta pro número). Vazio fica marcado
 * em vermelho, como os outros obrigatórios.
 */
export function TelefoneOuGrupo({ value, onSave, className, campoClassName }: {
  value: string
  onSave: (next: string) => void
  className?: string
  /** Classe do campo do número (a tabela e a ficha têm estilos diferentes). */
  campoClassName?: string
}) {
  if (ehGrupo(value)) {
    return (
      <div className={cn('flex items-center gap-1 px-2 py-1', className)}>
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
          <Users className="h-3 w-3" />
          Grupo
        </span>
        <button
          type="button"
          onClick={() => onSave('')}
          title="Trocar pelo número"
          className="rounded p-0.5 text-foreground/35 hover:bg-elevate/[0.06] hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }
  const vazio = !value.trim()
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <EditableField
        value={value}
        placeholder="Número"
        onSave={onSave}
        className={cn(
          'min-w-0 flex-1 text-sm text-foreground',
          campoClassName,
          vazio ? 'bg-danger/10 ring-1 ring-inset ring-danger/30' : 'bg-transparent',
        )}
      />
      <TelefoneAcoes telefone={value} />
      {vazio && (
        <button
          type="button"
          onClick={() => onSave('grupo')}
          title="A demanda veio pelo grupo, não por um número"
          className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-foreground/60 hover:border-accent/50 hover:text-accent"
        >
          Grupo
        </button>
      )}
    </div>
  )
}
