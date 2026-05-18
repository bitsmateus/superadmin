import * as React from 'react'
import {
  Bell,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Save,
  UserCircle2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { db } from '@/services/db'
import {
  DEFAULT_FOLLOWUP_TEMPLATES,
  FOLLOWUP_DAYS,
} from '@/constants/followup'
import { asaasApi } from '@/services/asaas'
import { useCurrentUser, useSettings } from '@/hooks/useClients'
import { extractErrorMessage } from '@/api/client'
import { cn } from '@/lib/utils'

export function CrmSettingsSection() {
  return (
    <div className="space-y-6">
      <UserNameBlock />
      <AsaasBlock />
      <FollowUpBlock />
    </div>
  )
}

function UserNameBlock() {
  const [user, setUser] = useCurrentUser()
  const [draft, setDraft] = React.useState(user)
  React.useEffect(() => setDraft(user), [user])

  const save = () => {
    setUser(draft.trim())
    toast.success('Nome salvo')
  }

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
          <UserCircle2 className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-white">Meu nome</h2>
          <p className="text-xs text-white/45">
            Usado nos logs, checklists e mensagens registradas.
          </p>
        </div>
      </header>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Seu nome"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ex.: Mateus"
          />
        </div>
        <Button
          onClick={save}
          disabled={!draft.trim() || draft === user}
          leftIcon={<Save className="h-4 w-4" />}
        >
          Salvar
        </Button>
      </div>
    </section>
  )
}

function AsaasBlock() {
  const settings = useSettings()
  const [apiKey, setApiKey] = React.useState(settings.asaasApiKey ?? '')
  const [env, setEnv] = React.useState<'sandbox' | 'production'>(
    settings.asaasEnvironment ?? 'sandbox',
  )
  const [show, setShow] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<
    | { ok: true; name?: string }
    | { ok: false; message: string }
    | null
  >(null)

  React.useEffect(() => {
    setApiKey(settings.asaasApiKey ?? '')
    setEnv(settings.asaasEnvironment ?? 'sandbox')
  }, [settings.asaasApiKey, settings.asaasEnvironment])

  const save = () => {
    db.saveSettings({
      ...db.getSettings(),
      asaasApiKey: apiKey.trim() || undefined,
      asaasEnvironment: env,
    })
    toast.success('Asaas salvo')
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    // persist temporarily so asaasApi reads the values
    db.saveSettings({
      ...db.getSettings(),
      asaasApiKey: apiKey.trim() || undefined,
      asaasEnvironment: env,
    })
    try {
      const me = await asaasApi.me()
      setTestResult({ ok: true, name: me.name ?? me.company })
      toast.success(`Asaas OK${me.name ? ` · ${me.name}` : ''}`)
    } catch (err) {
      const message = extractErrorMessage(err, 'Falha ao conectar')
      setTestResult({ ok: false, message })
      toast.error(message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
          <CreditCard className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-white">Asaas (cobrança)</h2>
          <p className="text-xs text-white/45">
            Chave usada para criar clientes, cobranças e assinaturas.
          </p>
        </div>
      </header>
      <div className="space-y-4 rounded-xl border border-line bg-card p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Input
              label="API Key do Asaas"
              type={show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="pointer-events-auto text-white/40 hover:text-white/80"
                  aria-label={show ? 'Ocultar' : 'Mostrar'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />
          </div>
          <Select
            label="Ambiente"
            value={env}
            onChange={(e) =>
              setEnv(e.target.value as 'sandbox' | 'production')
            }
            options={[
              { value: 'sandbox', label: 'Sandbox' },
              { value: 'production', label: 'Produção' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={test}
              loading={testing}
            >
              Testar conexão
            </Button>
            {testResult && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs',
                  testResult.ok ? 'text-success' : 'text-danger',
                )}
              >
                {testResult.ok ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> OK
                    {testResult.name ? ` — ${testResult.name}` : ''}
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5" /> {testResult.message}
                  </>
                )}
              </span>
            )}
            {settings.asaasApiKey && (
              <Badge tone="success" dot>
                Configurado
              </Badge>
            )}
          </div>
          <Button onClick={save} leftIcon={<Save className="h-4 w-4" />}>
            Salvar Asaas
          </Button>
        </div>
      </div>
    </section>
  )
}

function FollowUpBlock() {
  const settings = useSettings()
  const tmpl = {
    ...DEFAULT_FOLLOWUP_TEMPLATES,
    ...(settings.followUpTemplates ?? {}),
  }
  const [enabled, setEnabled] = React.useState<boolean>(
    settings.followUpsEnabled ?? true,
  )
  const [drafts, setDrafts] = React.useState({
    day3: tmpl.day3,
    day7: tmpl.day7,
    day15: tmpl.day15,
    day30: tmpl.day30,
  })

  React.useEffect(() => {
    setEnabled(settings.followUpsEnabled ?? true)
    setDrafts({
      day3: tmpl.day3,
      day7: tmpl.day7,
      day15: tmpl.day15,
      day30: tmpl.day30,
    })
  }, [
    settings.followUpsEnabled,
    settings.followUpTemplates?.day3,
    settings.followUpTemplates?.day7,
    settings.followUpTemplates?.day15,
    settings.followUpTemplates?.day30,
  ])

  const save = () => {
    db.saveSettings({
      ...db.getSettings(),
      followUpsEnabled: enabled,
      followUpTemplates: drafts,
    })
    toast.success('Templates salvos')
  }

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
          <Bell className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-white">
            Follow-up automático
          </h2>
          <p className="text-xs text-white/45">
            Os alertas aparecem no Dashboard nos dias 3, 7, 15 e 30. Variáveis:{' '}
            <code className="text-white/70">{'{nome}'}</code>{' '}
            <code className="text-white/70">{'{empresa}'}</code>{' '}
            <code className="text-white/70">{'{dia}'}</code>.
          </p>
        </div>
      </header>

      <div className="space-y-4 rounded-xl border border-line bg-card p-5">
        <label className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2.5 text-sm text-white/85">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#4F8EF7]"
          />
          Ativar alertas de follow-up no dashboard
        </label>

        <div className="grid grid-cols-1 gap-4">
          {FOLLOWUP_DAYS.map((day) => {
            const key = `day${day}` as keyof typeof drafts
            return (
              <Textarea
                key={day}
                label={`Mensagem do dia ${day}`}
                value={drafts[key]}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [key]: e.target.value }))
                }
                rows={3}
              />
            )
          })}
        </div>

        <div className="flex justify-end">
          <Button onClick={save} leftIcon={<Save className="h-4 w-4" />}>
            Salvar follow-up
          </Button>
        </div>
      </div>
    </section>
  )
}
