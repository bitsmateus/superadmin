import * as React from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useAccessStore } from '@/store/accessStore'
import { asText, deriveSupportEmail, isLikelyEmail } from '@/lib/utils'
import { copyToClipboard } from '@/lib/clipboard'
import type { Tenant } from '@/types'

const fullSchema = z.object({
  email: z.string().email('E-mail inválido'),
  masterkey: z.string().min(4, 'Informe sua masterkey'),
  remember: z.boolean(),
})
const quickSchema = z.object({
  email: z.string().email('E-mail inválido'),
})

type FullValues = z.infer<typeof fullSchema>
type QuickValues = z.infer<typeof quickSchema>

export interface AccessTenantModalProps {
  open: boolean
  onClose: () => void
  tenant: Tenant | null
  defaultEmail?: string
}

export function AccessTenantModal({
  open,
  onClose,
  tenant,
  defaultEmail,
}: AccessTenantModalProps) {
  const { masterkey, systemUrl, setMasterkey } = useAccessStore()
  const hasKey = Boolean(masterkey)
  const [showKey, setShowKey] = React.useState(false)

  const initialEmail = React.useMemo(() => {
    if (defaultEmail && isLikelyEmail(defaultEmail)) return defaultEmail
    if (tenant && isLikelyEmail(tenant.email)) return String(tenant.email)
    if (tenant?.name) return deriveSupportEmail(tenant.name)
    return ''
  }, [tenant, defaultEmail])

  const fullForm = useForm<FullValues>({
    resolver: zodResolver(fullSchema),
    mode: 'onChange',
    defaultValues: { email: initialEmail, masterkey: '', remember: true },
  })

  const quickForm = useForm<QuickValues>({
    resolver: zodResolver(quickSchema),
    mode: 'onChange',
    defaultValues: { email: initialEmail },
  })

  React.useEffect(() => {
    if (!open) return
    fullForm.reset({ email: initialEmail, masterkey: '', remember: true })
    quickForm.reset({ email: initialEmail })
    setShowKey(false)
  }, [open, initialEmail, fullForm, quickForm])

  const performAccess = async (email: string) => {
    const copied = await copyToClipboard(email)
    const newWindow = window.open(systemUrl, '_blank', 'noopener,noreferrer')
    if (!newWindow) {
      toast.error(
        'O navegador bloqueou a nova aba — libere o pop-up para chat.nxsystems.com.br.',
      )
      return
    }
    if (copied) {
      toast.success('Aba aberta! Email copiado — use sua masterkey para entrar')
    } else {
      toast.success('Aba aberta — copie manualmente o email e use sua masterkey')
    }
    onClose()
  }

  const onFullSubmit = async (values: FullValues) => {
    if (values.remember) setMasterkey(values.masterkey)
    await performAccess(values.email.trim())
  }

  const onQuickSubmit = async (values: QuickValues) => {
    await performAccess(values.email.trim())
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <ExternalLink className="h-4 w-4 text-accent" />
          Acessar tenant {tenant?.name ? `"${asText(tenant.name)}"` : ''}
        </span>
      }
      description={
        hasKey
          ? 'Sua masterkey já está salva. Confirme o e-mail para abrir o sistema.'
          : 'Preencha o e-mail e sua masterkey para abrir o sistema externo.'
      }
    >
      {hasKey ? (
        <form
          onSubmit={quickForm.handleSubmit(onQuickSubmit)}
          className="grid grid-cols-1 gap-4"
        >
          <div className="flex items-center justify-between rounded-lg border border-line bg-white/[0.02] px-3 py-2">
            <span className="flex items-center gap-2 text-xs text-white/65">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              Masterkey salva neste dispositivo
            </span>
            <Badge tone="success" dot>
              Ativa
            </Badge>
          </div>

          <Input
            label="E-mail do usuário"
            type="email"
            leftIcon={<Mail className="h-4 w-4" />}
            {...quickForm.register('email')}
            error={quickForm.formState.errors.email?.message}
            hint="Será copiado para o clipboard ao abrir o sistema."
          />

          <p className="-mt-2 text-[11px] text-white/45">
            Quer trocar a masterkey?{' '}
            <RouterLink
              to="/settings"
              onClick={onClose}
              className="text-accent hover:underline"
            >
              Atualizar em Configurações
            </RouterLink>
            .
          </p>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!quickForm.formState.isValid}
              leftIcon={<ExternalLink className="h-4 w-4" />}
            >
              Abrir sistema
            </Button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={fullForm.handleSubmit(onFullSubmit)}
          className="grid grid-cols-1 gap-4"
        >
          <Input
            label="E-mail do usuário"
            type="email"
            leftIcon={<Mail className="h-4 w-4" />}
            {...fullForm.register('email')}
            error={fullForm.formState.errors.email?.message}
            hint="Pré-preenchido com base no tenant — edite se necessário."
          />

          <Input
            label="Masterkey"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            leftIcon={<KeyRound className="h-4 w-4" />}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? 'Ocultar masterkey' : 'Mostrar masterkey'}
                className="pointer-events-auto text-white/40 hover:text-white/80"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
            {...fullForm.register('masterkey')}
            error={fullForm.formState.errors.masterkey?.message}
          />

          <label className="flex items-center gap-2.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2.5 text-sm text-white/80 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#4F8EF7]"
              {...fullForm.register('remember')}
            />
            <span>
              Lembrar masterkey neste dispositivo
              <span className="ml-1 text-[11px] text-white/45">
                (salva em localStorage)
              </span>
            </span>
          </label>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!fullForm.formState.isValid}
              leftIcon={<ExternalLink className="h-4 w-4" />}
            >
              Abrir sistema
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
