import * as React from 'react'
import { UserCircle2 } from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { useLeadNotes } from '@/hooks/useLeadNotes'
import { leadNotesService } from '@/services/leadNotes'
import { initials, cn } from '@/lib/utils'
import { timeAgo } from '@/lib/time'

export interface LeadNotesDrawerProps {
  leadRowId: string | null
  leadName: string
  onClose: () => void
}

export function LeadNotesDrawer({ leadRowId, leadName, onClose }: LeadNotesDrawerProps) {
  const { profile } = useAuth()
  const notes = useLeadNotes(leadRowId)
  const [text, setText] = React.useState('')
  const [sending, setSending] = React.useState(false)

  React.useEffect(() => {
    if (leadRowId) void leadNotesService.loadNotes(leadRowId)
  }, [leadRowId])

  const submit = async () => {
    if (!leadRowId || !text.trim()) return
    setSending(true)
    const authorName = profile?.name || profile?.email || 'Alguém'
    const note = await leadNotesService.addNote(leadRowId, text, authorName)
    setSending(false)
    if (note) setText('')
  }

  return (
    <Drawer open={!!leadRowId} onClose={onClose} width={420} title={leadName || 'Lead'}>
      <div className="flex h-full flex-col">
        <div className="border-b border-line p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
            }}
            placeholder="Escreva uma atualização e mencione outros com @"
            className="min-h-[70px] w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={submit} disabled={!text.trim() || sending} loading={sending}>
              Enviar atualização
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {notes.length === 0 ? (
            <p className="text-xs text-foreground/40">Nenhuma atualização ainda.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-line bg-elevate/[0.02] p-3">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.04]',
                      'text-[10px] font-medium text-foreground/85 ring-1 ring-line',
                    )}>
                      {initials(n.authorName) || <UserCircle2 className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">{n.authorName}</span>
                        <span className="text-[10px] text-foreground/40">{timeAgo(n.createdAt)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/85">{n.content}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  )
}
