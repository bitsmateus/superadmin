import * as React from 'react'
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Phone,
  Save,
  Star,
  Trophy,
  Upload,
  UserCircle2,
  Volume2,
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
      <GoalsBlock />
      <NotificationsBlock />
      <NpsBlock />
      <AsaasBlock />
      <CredentialsBlock />
      <FollowUpBlock />
      <BackupBlock />
    </div>
  )
}

function GoalsBlock() {
  const settings = useSettings()
  const [enabled, setEnabled] = React.useState(settings.goalsEnabled ?? false)
  const [newClients, setNewClients] = React.useState(
    settings.goalNewClientsMonthly?.toString() ?? '',
  )
  const [mrr, setMrr] = React.useState(
    settings.goalMrrMonthly?.toString() ?? '',
  )
  const [nps, setNps] = React.useState(
    settings.goalNpsMonthly?.toString() ?? '',
  )

  React.useEffect(() => {
    setEnabled(settings.goalsEnabled ?? false)
    setNewClients(settings.goalNewClientsMonthly?.toString() ?? '')
    setMrr(settings.goalMrrMonthly?.toString() ?? '')
    setNps(settings.goalNpsMonthly?.toString() ?? '')
  }, [settings.goalsEnabled, settings.goalNewClientsMonthly, settings.goalMrrMonthly, settings.goalNpsMonthly])

  const save = () => {
    const nNew = newClients.trim() === '' ? undefined : Math.max(0, parseInt(newClients, 10))
    const nMrr = mrr.trim() === '' ? undefined : Math.max(0, parseFloat(mrr.replace(',', '.')))
    const nNps = nps.trim() === '' ? undefined : Math.max(-100, Math.min(100, parseInt(nps, 10)))
    if (newClients.trim() && Number.isNaN(nNew!)) {
      toast.error('Meta de novos clientes inválida.')
      return
    }
    if (mrr.trim() && Number.isNaN(nMrr!)) {
      toast.error('Meta de MRR inválida.')
      return
    }
    if (nps.trim() && Number.isNaN(nNps!)) {
      toast.error('Meta de NPS inválida.')
      return
    }
    db.saveSettings({
      goalsEnabled: enabled,
      goalNewClientsMonthly: nNew,
      goalMrrMonthly: nMrr,
      goalNpsMonthly: nNps,
    })
    toast.success('Metas salvas')
  }

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-success/10 text-success ring-1 ring-success/20">
          <Trophy className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-foreground">Metas do mês</h2>
          <p className="text-xs text-foreground/45">
            Aparecem no Dashboard e no Centro de Comando. Deixe em branco pra
            esconder uma meta específica.
          </p>
        </div>
      </header>
      <div className="space-y-3 rounded-xl border border-line bg-card p-4">
        <label className="inline-flex items-center gap-2 text-sm text-foreground/85 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#4F8EF7]"
          />
          Exibir metas
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Novos clientes / mês"
            type="number"
            min={0}
            value={newClients}
            onChange={(e) => setNewClients(e.target.value)}
            placeholder="Ex.: 8"
          />
          <Input
            label="MRR alvo (R$)"
            type="number"
            min={0}
            step="0.01"
            value={mrr}
            onChange={(e) => setMrr(e.target.value)}
            placeholder="Ex.: 15000"
          />
          <Input
            label="NPS alvo (0-100)"
            type="number"
            min={-100}
            max={100}
            value={nps}
            onChange={(e) => setNps(e.target.value)}
            placeholder="Ex.: 70"
          />
        </div>
        <div className="flex justify-end">
          <Button
            onClick={save}
            size="sm"
            leftIcon={<Save className="h-3.5 w-3.5" />}
          >
            Salvar metas
          </Button>
        </div>
      </div>
    </section>
  )
}

function BackupBlock() {
  const settings = useSettings()
  const [restoring, setRestoring] = React.useState(false)
  const [confirmRestore, setConfirmRestore] = React.useState<{
    file: File
    payload: import('@/lib/backup').BackupPayload
  } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const lastBackupDays = React.useMemo(() => {
    if (!settings.lastBackupAt) return null
    const ms = Date.now() - new Date(settings.lastBackupAt).getTime()
    return Math.floor(ms / (24 * 60 * 60 * 1000))
  }, [settings.lastBackupAt])

  const stale =
    lastBackupDays === null ||
    lastBackupDays >= (settings.backupRemindDays ?? 7)

  const onExport = async () => {
    const { downloadBackupFile } = await import('@/lib/backup')
    await downloadBackupFile()
    toast.success('Backup gerado')
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { readBackupFile } = await import('@/lib/backup')
      const payload = await readBackupFile(file)
      setConfirmRestore({ file, payload })
    } catch (err) {
      toast.error('Falha ao ler arquivo: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const doRestore = async (overwriteSettings: boolean) => {
    if (!confirmRestore) return
    setRestoring(true)
    try {
      const { restoreBackup } = await import('@/lib/backup')
      const result = await restoreBackup(confirmRestore.payload, { overwriteSettings })
      toast.success(
        `Restauração: ${result.clientsInserted} novos, ${result.clientsUpdated} atualizados${
          result.errors.length > 0 ? `, ${result.errors.length} erro(s)` : ''
        }`,
      )
      setConfirmRestore(null)
    } catch (err) {
      toast.error('Falha: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
          <Download className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-foreground">Backup</h2>
          <p className="text-xs text-foreground/45">
            Baixa snapshot JSON com clientes + configurações. Guarde em local
            seguro.
          </p>
        </div>
      </header>
      <div className="space-y-3 rounded-xl border border-line bg-card p-4">
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
            stale
              ? 'border-warning/30 bg-warning/[0.06] text-warning'
              : 'border-success/30 bg-success/[0.06] text-success',
          )}
        >
          {stale ? <AlertCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {lastBackupDays === null
            ? 'Nenhum backup feito ainda.'
            : `Último backup há ${lastBackupDays} dia(s).`}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onExport}
            size="sm"
            leftIcon={<Download className="h-3.5 w-3.5" />}
          >
            Exportar backup agora
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onFile}
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            size="sm"
            variant="secondary"
            leftIcon={<Upload className="h-3.5 w-3.5" />}
          >
            Restaurar de arquivo…
          </Button>
        </div>
        <p className="text-[11px] text-foreground/45">
          Restauração faz <strong>upsert por id</strong>: clientes existentes
          são sobrescritos, novos são inseridos. Settings não são restauradas
          por padrão.
        </p>
      </div>

      {confirmRestore && (
        <RestoreConfirmModal
          payload={confirmRestore.payload}
          restoring={restoring}
          onCancel={() => setConfirmRestore(null)}
          onConfirm={doRestore}
        />
      )}
    </section>
  )
}

function RestoreConfirmModal({
  payload,
  restoring,
  onCancel,
  onConfirm,
}: {
  payload: import('@/lib/backup').BackupPayload
  restoring: boolean
  onCancel: () => void
  onConfirm: (overwriteSettings: boolean) => void
}) {
  const [overwriteSettings, setOverwriteSettings] = React.useState(false)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-xl">
        <header className="mb-3 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-warning" />
          <h3 className="text-base font-semibold text-foreground">Confirmar restauração</h3>
        </header>
        <div className="space-y-3 text-sm text-foreground/80">
          <p>
            Vai restaurar <strong className="text-foreground">{payload.clients.length}</strong>{' '}
            cliente(s) do backup criado em{' '}
            <strong className="text-foreground">
              {new Date(payload.createdAt).toLocaleString('pt-BR')}
            </strong>
            .
          </p>
          <p className="text-xs text-foreground/55">
            Clientes existentes (mesmo id) serão sobrescritos. Esta ação é
            registrada em auditoria.
          </p>
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={overwriteSettings}
              onChange={(e) => setOverwriteSettings(e.target.checked)}
              className="h-4 w-4 accent-[#4F8EF7]"
            />
            Também sobrescrever Configurações (avançado)
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={restoring}>
            Cancelar
          </Button>
          <Button
            size="sm"
            loading={restoring}
            onClick={() => onConfirm(overwriteSettings)}
          >
            Restaurar
          </Button>
        </div>
      </div>
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
          <h2 className="text-sm font-medium text-foreground">Meu nome</h2>
          <p className="text-xs text-foreground/45">
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

function NotificationsBlock() {
  const settings = useSettings()
  const [edgeUrl, setEdgeUrl] = React.useState(
    settings.notifyEdgeFunctionUrl ?? '',
  )
  const [enabled, setEnabled] = React.useState<boolean>(
    settings.notifyEnabled ?? false,
  )
  const [browserNotif, setBrowserNotif] = React.useState<boolean>(false)
  const [permission, setPermission] = React.useState<string>('default')

  React.useEffect(() => {
    setEdgeUrl(settings.notifyEdgeFunctionUrl ?? '')
    setEnabled(settings.notifyEnabled ?? false)
  }, [settings.notifyEdgeFunctionUrl, settings.notifyEnabled])

  React.useEffect(() => {
    // Importa dinamicamente pra não acoplar com SSR
    import('@/hooks/useTicketNotifications').then((m) => {
      setBrowserNotif(m.readNotificationPref())
    })
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission)
    }
  }, [])

  const save = () => {
    db.saveSettings({
      ...db.getSettings(),
      notifyEdgeFunctionUrl: edgeUrl.trim() || undefined,
      notifyEnabled: enabled,
    })
    toast.success('Notificações salvas')
  }

  const toggleBrowser = async (checked: boolean) => {
    setBrowserNotif(checked)
    const mod = await import('@/hooks/useTicketNotifications')
    mod.setNotificationPref(checked)
    if (checked) {
      const granted = await mod.requestNotificationPermission()
      setPermission(granted ? 'granted' : 'denied')
      if (!granted) {
        toast.error(
          'Permissão de notificação negada pelo navegador. Você pode reverter nas configurações do site.',
        )
      } else {
        toast.success('Notificações no navegador ativadas')
      }
    }
  }

  const dirtyEdge =
    edgeUrl.trim() !== (settings.notifyEdgeFunctionUrl ?? '') ||
    enabled !== (settings.notifyEnabled ?? false)

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
          <Bell className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Notificações de tickets
          </h2>
          <p className="text-xs text-foreground/45">
            Som + notificação no navegador (local) e e-mail pro responsável
            (precisa Edge Function + Resend configurado).
          </p>
        </div>
      </header>

      <div className="space-y-4 rounded-xl border border-line bg-card p-5">
        {/* Local: som + browser notification */}
        <div className="space-y-2 rounded-lg border border-line bg-elevate/[0.02] p-3">
          <div className="text-[11px] uppercase tracking-wider text-foreground/45">
            Neste navegador
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground/85 cursor-pointer">
            <input
              type="checkbox"
              checked={browserNotif}
              onChange={(e) => toggleBrowser(e.target.checked)}
              className="h-4 w-4 accent-[#4F8EF7]"
            />
            <Volume2 className="h-3.5 w-3.5" />
            Tocar som + mostrar notificação no navegador quando entra ticket
          </label>
          {browserNotif && (
            <div className="text-[11px] text-foreground/45">
              Permissão do navegador:{' '}
              <strong className={
                permission === 'granted'
                  ? 'text-success'
                  : permission === 'denied'
                    ? 'text-danger'
                    : 'text-warning'
              }>
                {permission === 'granted' ? 'concedida' : permission === 'denied' ? 'negada' : 'pendente'}
              </strong>
              {permission === 'denied' && (
                <span className="text-foreground/45"> · Reabilite nas permissões do site.</span>
              )}
            </div>
          )}
        </div>

        {/* E-mail via Edge Function */}
        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-foreground/45">
            E-mail pro responsável
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground/85 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-[#4F8EF7]"
            />
            <Mail className="h-3.5 w-3.5" />
            Disparar e-mail quando ticket é criado ou atribuído
          </label>
          <Input
            label="URL da Edge Function notify-ticket"
            placeholder="https://<projeto>.supabase.co/functions/v1/notify-ticket"
            value={edgeUrl}
            onChange={(e) => setEdgeUrl(e.target.value)}
            hint="Deploy a função em supabase/functions/notify-ticket e cole a URL pública aqui. Veja README."
          />
          <p className="rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-[11px] text-foreground/55">
            <strong className="text-foreground/80">Pra ativar:</strong>{' '}
            (1) crie conta em resend.com e gere uma API key,{' '}
            (2) deploy a função: <code className="text-accent">supabase functions deploy notify-ticket --no-verify-jwt</code>,{' '}
            (3) configure as env vars (Settings → Edge Functions): <code className="text-accent">RESEND_API_KEY</code>, <code className="text-accent">RESEND_FROM_EMAIL</code>, <code className="text-accent">PUBLIC_PANEL_URL</code>, <code className="text-accent">FALLBACK_TO_EMAIL</code>.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={save}
            disabled={!dirtyEdge}
            leftIcon={<Save className="h-4 w-4" />}
          >
            Salvar notificações
          </Button>
        </div>
      </div>
    </section>
  )
}

function NpsBlock() {
  const settings = useSettings()
  const [enabled, setEnabled] = React.useState<boolean>(settings.npsEnabled ?? true)
  const [delayDays, setDelayDays] = React.useState(String(settings.npsDelayDays ?? 7))

  React.useEffect(() => {
    setEnabled(settings.npsEnabled ?? true)
    setDelayDays(String(settings.npsDelayDays ?? 7))
  }, [settings.npsEnabled, settings.npsDelayDays])

  const dirty =
    enabled !== (settings.npsEnabled ?? true) ||
    Number(delayDays) !== (settings.npsDelayDays ?? 7)

  const save = () => {
    db.saveSettings({
      ...db.getSettings(),
      npsEnabled: enabled,
      npsDelayDays: Math.max(0, Number(delayDays) || 7),
    })
    toast.success('NPS salvo')
  }

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
          <Star className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-foreground">Pesquisa NPS</h2>
          <p className="text-xs text-foreground/45">
            Cria automaticamente uma pesquisa pendente N dias após a entrega
            ser concluída. O link aparece em <em>/nps</em> pra você enviar.
          </p>
        </div>
      </header>

      <div className="space-y-4 rounded-xl border border-line bg-card p-5">
        <label className="flex items-center gap-2 text-sm text-foreground/85 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#4F8EF7]"
          />
          Criar pesquisa NPS automaticamente após entrega concluída
        </label>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <Input
              label="Dias após entrega"
              type="number"
              min={0}
              max={90}
              value={delayDays}
              onChange={(e) => setDelayDays(e.target.value)}
              hint="0 cria pronta pra enviar imediatamente."
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty} leftIcon={<Save className="h-4 w-4" />}>
            Salvar NPS
          </Button>
        </div>
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
  const [syncInterval, setSyncInterval] = React.useState<string>(
    String(settings.asaasSyncIntervalMin ?? 15),
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
    setSyncInterval(String(settings.asaasSyncIntervalMin ?? 15))
  }, [settings.asaasApiKey, settings.asaasEnvironment, settings.asaasSyncIntervalMin])

  const save = () => {
    const minutes = Number(syncInterval)
    db.saveSettings({
      ...db.getSettings(),
      asaasApiKey: apiKey.trim() || undefined,
      asaasEnvironment: env,
      asaasSyncIntervalMin: Number.isFinite(minutes) && minutes >= 0 ? minutes : 15,
    })
    toast.success('Asaas salvo')
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    // Não persistimos antes do teste — uma chave inválida sobrescreveria a
    // anterior. asaasApi.me() suporta override transitório via parâmetro
    // (ver asaas.ts). Se passar, o usuário clica em "Salvar Asaas".
    try {
      const me = await asaasApi.me({ apiKeyOverride: apiKey.trim(), envOverride: env })
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
          <h2 className="text-sm font-medium text-foreground">Asaas (cobrança)</h2>
          <p className="text-xs text-foreground/45">
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
                  className="pointer-events-auto text-foreground/40 hover:text-foreground/80"
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Input
              label="Auto-sync (minutos)"
              type="number"
              min={0}
              max={1440}
              value={syncInterval}
              onChange={(e) => setSyncInterval(e.target.value)}
              hint="0 desliga o auto-sync. Default 15 min."
            />
          </div>
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

function CredentialsBlock() {
  const settings = useSettings()
  const [tenantPassword, setTenantPassword] = React.useState(
    settings.defaultTenantPassword ?? '',
  )
  const [accessPassword, setAccessPassword] = React.useState(
    settings.defaultAccessPassword ?? '',
  )
  const [supportPhone, setSupportPhone] = React.useState(
    settings.supportPhone ?? '',
  )
  const [showTenant, setShowTenant] = React.useState(false)
  const [showAccess, setShowAccess] = React.useState(false)

  React.useEffect(() => {
    setTenantPassword(settings.defaultTenantPassword ?? '')
    setAccessPassword(settings.defaultAccessPassword ?? '')
    setSupportPhone(settings.supportPhone ?? '')
  }, [
    settings.defaultTenantPassword,
    settings.defaultAccessPassword,
    settings.supportPhone,
  ])

  const dirty =
    tenantPassword.trim() !== (settings.defaultTenantPassword ?? '') ||
    accessPassword.trim() !== (settings.defaultAccessPassword ?? '') ||
    supportPhone.trim() !== (settings.supportPhone ?? '')

  const save = () => {
    db.saveSettings({
      ...db.getSettings(),
      defaultTenantPassword: tenantPassword.trim() || undefined,
      defaultAccessPassword: accessPassword.trim() || undefined,
      supportPhone: supportPhone.trim() || undefined,
    })
    toast.success('Credenciais salvas')
  }

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
          <KeyRound className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Senhas e contato de suporte
          </h2>
          <p className="text-xs text-foreground/45">
            Antes ficavam fixos no código. Configure aqui pra usar nos
            modais de criação de tenant e na folha de acessos do cliente.
          </p>
        </div>
      </header>

      <div className="space-y-4 rounded-xl border border-line bg-card p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Senha padrão (criação de tenant/usuários)"
            type={showTenant ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="Ex.: Nxim01@!"
            value={tenantPassword}
            onChange={(e) => setTenantPassword(e.target.value)}
            leftIcon={<KeyRound className="h-4 w-4" />}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowTenant((s) => !s)}
                className="pointer-events-auto text-foreground/40 hover:text-foreground/80"
                aria-label={showTenant ? 'Ocultar' : 'Mostrar'}
              >
                {showTenant ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            }
            hint="Usada quando criar tenant ou usuários novos via painel."
          />
          <Input
            label="Senha padrão (folha de acessos do cliente)"
            type={showAccess ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="Ex.: 12345678"
            value={accessPassword}
            onChange={(e) => setAccessPassword(e.target.value)}
            leftIcon={<KeyRound className="h-4 w-4" />}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowAccess((s) => !s)}
                className="pointer-events-auto text-foreground/40 hover:text-foreground/80"
                aria-label={showAccess ? 'Ocultar' : 'Mostrar'}
              >
                {showAccess ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            }
            hint="Aparece no PDF de handoff impresso pra entrega ao cliente."
          />
        </div>

        <Input
          label="Telefone de suporte (folha de acessos)"
          placeholder="48 93618-0186"
          value={supportPhone}
          onChange={(e) => setSupportPhone(e.target.value)}
          leftIcon={<Phone className="h-4 w-4" />}
          hint="Impresso no PDF de acessos como contato oficial."
        />

        <div className="flex justify-end">
          <Button
            onClick={save}
            disabled={!dirty}
            leftIcon={<Save className="h-4 w-4" />}
          >
            Salvar credenciais
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
          <h2 className="text-sm font-medium text-foreground">
            Follow-up automático
          </h2>
          <p className="text-xs text-foreground/45">
            Os alertas aparecem no Dashboard nos dias 3, 7, 15 e 30. Variáveis:{' '}
            <code className="text-foreground/70">{'{nome}'}</code>{' '}
            <code className="text-foreground/70">{'{empresa}'}</code>{' '}
            <code className="text-foreground/70">{'{dia}'}</code>.
          </p>
        </div>
      </header>

      <div className="space-y-4 rounded-xl border border-line bg-card p-5">
        <label className="flex items-center gap-2 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2.5 text-sm text-foreground/85">
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
