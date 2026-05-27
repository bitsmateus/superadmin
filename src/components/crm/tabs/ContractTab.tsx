import * as React from 'react'
import {
  CheckCircle2,
  Download,
  FileSignature,
  Link as LinkIcon,
  Paperclip,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section, FieldLabel } from '../ClientDrawer'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { db } from '@/services/db'
import { formatDate } from '@/lib/utils'
import type { Client } from '@/types/client'

const MAX_FILE_BYTES = 8 * 1024 * 1024 // 8 MB

export function ContractTab({ client }: { client: Client }) {
  const [contractUrl, setContractUrl] = React.useState(client.contractUrl ?? '')
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = React.useState(false)

  React.useEffect(() => {
    setContractUrl(client.contractUrl ?? '')
  }, [client.id])

  const saveUrl = () => {
    const url = contractUrl.trim()
    if (url === (client.contractUrl ?? '')) return
    db.updateClient(client.id, { contractUrl: url || undefined })
    db.addLog(client.id, 'Link do contrato atualizado')
  }

  const markSent = () => {
    db.updateClient(client.id, { contractSentAt: new Date().toISOString() })
    db.addLog(client.id, 'Contrato marcado como enviado')
    toast.success('Contrato marcado como enviado')
  }

  const markSigned = () => {
    const signedAt = new Date().toISOString()
    const patch: Partial<Client> = { contractSignedAt: signedAt }
    // Avança pra briefing se a cobrança já foi criada
    if (client.stage === 'contract' && client.asaasPaymentId) {
      patch.stage = 'briefing'
    }
    db.updateClient(client.id, patch)
    db.addLog(client.id, 'Contrato assinado')
    if (patch.stage === 'briefing') {
      toast.success('Contrato assinado · etapa avançada para Briefing')
    } else {
      toast.success('Contrato assinado')
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      toast.error('Arquivo muito grande (máx. 8 MB). Compacte o PDF antes de anexar.')
      return
    }
    setUploading(true)
    try {
      const dataUrl = await fileToDataUrl(file)
      db.updateClient(client.id, {
        contractFile: dataUrl,
        contractFileName: file.name,
      })
      db.addLog(client.id, 'Arquivo do contrato anexado', file.name)
      toast.success('Contrato anexado')
    } catch {
      toast.error('Falha ao ler o arquivo.')
    } finally {
      setUploading(false)
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeFile = () => {
    db.updateClient(client.id, { contractFile: undefined, contractFileName: undefined })
    db.addLog(client.id, 'Arquivo do contrato removido')
    toast.success('Arquivo removido')
  }

  const downloadFile = () => {
    if (!client.contractFile || !client.contractFileName) return
    const a = document.createElement('a')
    a.href = client.contractFile
    a.download = client.contractFileName
    a.click()
  }

  const contractStatus: 'Não enviado' | 'Enviado' | 'Assinado' = client.contractSignedAt
    ? 'Assinado'
    : client.contractSentAt
      ? 'Enviado'
      : 'Não enviado'

  const contractTone =
    contractStatus === 'Assinado' ? 'success'
    : contractStatus === 'Enviado' ? 'info'
    : 'neutral'

  return (
    <div className="space-y-5">
      <Section
        title={
          <span className="flex items-center gap-2">
            <FileSignature className="h-3.5 w-3.5 text-accent" />
            Contrato
          </span>
        }
        action={<Badge tone={contractTone}>{contractStatus}</Badge>}
      >
        <div className="space-y-3">
          <Input
            label="Link do contrato (Autentique)"
            leftIcon={<LinkIcon className="h-4 w-4" />}
            placeholder="https://app.autentique.com.br/…"
            value={contractUrl}
            onChange={(e) => setContractUrl(e.target.value)}
            onBlur={saveUrl}
          />

          {/* Arquivo anexado */}
          <div>
            <FieldLabel>Arquivo do contrato</FieldLabel>
            {client.contractFile && client.contractFileName ? (
              <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2">
                <Paperclip className="h-4 w-4 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">
                  {client.contractFileName}
                </span>
                <button
                  type="button"
                  onClick={downloadFile}
                  className="rounded-md p-1.5 text-foreground/50 hover:bg-accent/10 hover:text-accent"
                  aria-label="Baixar arquivo"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={removeFile}
                  className="rounded-md p-1.5 text-foreground/40 hover:bg-danger/10 hover:text-danger"
                  aria-label="Remover arquivo"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="mt-1.5 flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-sm text-foreground/45 transition-colors hover:border-accent/40 hover:bg-accent/[0.03] hover:text-accent disabled:opacity-50"
              >
                <Paperclip className="h-4 w-4 shrink-0" />
                {uploading ? 'Carregando…' : 'Anexar arquivo do contrato (PDF, até 8 MB)'}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-foreground/55">
            <div>
              <FieldLabel>Enviado em</FieldLabel>
              <p className="mt-1 text-foreground/85">
                {client.contractSentAt ? formatDate(client.contractSentAt) : '—'}
              </p>
            </div>
            <div>
              <FieldLabel>Assinado em</FieldLabel>
              <p className="mt-1 text-foreground/85">
                {client.contractSignedAt ? formatDate(client.contractSignedAt) : '—'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={markSent}
              disabled={Boolean(client.contractSentAt)}
            >
              Marcar como enviado
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={markSigned}
              disabled={Boolean(client.contractSignedAt)}
              leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
            >
              Marcar como assinado
            </Button>
          </div>
        </div>
      </Section>
    </div>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
