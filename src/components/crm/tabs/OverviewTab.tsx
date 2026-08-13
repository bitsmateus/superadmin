import * as React from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Globe,
  KeyRound,
  ListChecks,
  Mail,
  MessageSquare,
  Monitor,
  Pencil,
  Phone,
  PlusCircle,
  Send,
  Server as ServerIcon,
  Smartphone,
  Sparkles,
  StickyNote,
  Trash2,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section, FieldLabel } from '../ClientDrawer'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useCurrentUser } from '@/hooks/useClients'
import { useTeamProfiles, profileOptions } from '@/hooks/useTeamProfiles'
import type { TeamArea } from '@/services/supabase'
import { db } from '@/services/db'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { copyToClipboard } from '@/lib/clipboard'
import { buildPendingMessage, computeReadiness } from '@/constants/readiness'
import { asText, cn, formatDate, initials, normalizeWhatsappNumber } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type { Client, ClientAccess } from '@/types/client'
import {
  API_CONFIG_STEPS,
  IA_CONFIG_STEPS,
  META_VERIFICATION_LABELS,
  PARTNER_ACCESS_LABELS,
  type ConfigStepDef,
} from '@/constants/configProgress'

// Default accesses always shown when the client has none
const DEFAULT_ACCESS_NAMES = ['Facebook', 'Instagram']

// Senha padrão do acesso de suporte do tenant (quando o cliente ainda não tem
// uma senha própria salva).
const DEFAULT_SUPPORT_PASSWORD = 'Nxim01@!'

function getAccesses(client: Client): ClientAccess[] {
  if (client.accesses && client.accesses.length > 0) return client.accesses
  return DEFAULT_ACCESS_NAMES.map((name, i) => ({
    id: `default-${i}`,
    name,
  }))
}

export function OverviewTab({ client }: { client: Client }) {
  const [user] = useCurrentUser()
  const [noteText, setNoteText] = React.useState('')
  const [noteInternal, setNoteInternal] = React.useState(false)
  const [editingNoteId, setEditingNoteId] = React.useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = React.useState('')

  const addNote = () => {
    const trimmed = noteText.trim()
    if (!trimmed) return
    if (!user) {
      toast.error('Defina seu nome em Configurações antes de registrar notas.')
      return
    }
    db.addNote(client.id, trimmed, user, noteInternal)
    db.addLog(client.id, noteInternal ? 'Nota interna registrada' : 'Nota registrada')
    setNoteText('')
    setNoteInternal(false)
    toast.success('Nota registrada')
  }

  // Radio: selecting a platform deselects the others
  const setPlatform = (flag: 'platformApp' | 'platformWeb' | 'platformChat') => {
    db.updateClient(client.id, {
      platformApp: flag === 'platformApp',
      platformWeb: flag === 'platformWeb',
      platformChat: flag === 'platformChat',
    })
  }

  return (
    <div className="space-y-5">
      {/* Dados do cliente */}
      <Section title="Dados do cliente">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InlineField
            label="Nome (título)"
            value={client.name}
            onSave={(v) => {
              const t = v.trim()
              if (!t) {
                toast.error('O nome não pode ficar vazio.')
                return
              }
              db.updateClient(client.id, { name: t })
              db.addLog(client.id, 'Nome atualizado')
            }}
          />
          <InlineField
            label="E-mail"
            value={client.email}
            onSave={(v) =>
              db.updateClient(client.id, { email: v }) &&
              db.addLog(client.id, 'E-mail atualizado')
            }
          />
          <InlineField
            label="Telefone"
            value={client.phone}
            onSave={(v) =>
              db.updateClient(client.id, { phone: v }) &&
              db.addLog(client.id, 'Telefone atualizado')
            }
          />
          <InlineField
            label="Empresa"
            value={client.company}
            onSave={(v) =>
              db.updateClient(client.id, { company: v }) &&
              db.addLog(client.id, 'Empresa atualizada')
            }
          />
          <ResponsavelSelect
            label="Responsável comercial"
            area="comercial"
            value={client.responsavelComercial ?? client.responsavel ?? ''}
            onChange={(v) => {
              db.updateClient(client.id, { responsavelComercial: v || undefined })
              db.addLog(client.id, 'Responsável comercial atualizado')
            }}
          />
          <ResponsavelSelect
            label="Responsável de entrega"
            area="entrega"
            value={client.responsavelEntrega ?? ''}
            onChange={(v) => {
              db.updateClient(client.id, { responsavelEntrega: v || undefined })
              db.addLog(client.id, 'Responsável de entrega atualizado')
            }}
          />

          {/* E-mail de suporte — clicar copia; lápis edita */}
          <div className="sm:col-span-2">
            <CopyEditField
              label="E-mail de suporte"
              value={client.supportEmail ?? ''}
              placeholder="Sem informação"
              onSave={(v) =>
                db.updateClient(client.id, { supportEmail: v.trim() || undefined }) &&
                db.addLog(client.id, 'E-mail de suporte atualizado')
              }
            />
          </div>

          {/* Senha de suporte — mascarada, só copiar */}
          <div className="sm:col-span-2">
            <FieldLabel>Senha de suporte</FieldLabel>
            <div className="mt-1 flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
              <span className="select-none text-sm tracking-[0.3em] text-foreground/70">
                ••••••••
              </span>
              <button
                type="button"
                onClick={async () => {
                  const pwd = client.supportPassword || DEFAULT_SUPPORT_PASSWORD
                  const ok = await copyToClipboard(pwd)
                  if (ok) toast.success('Senha copiada')
                  else toast.error('Não foi possível copiar')
                }}
                className="rounded-md p-1 text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
                aria-label="Copiar senha de suporte"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Plataformas */}
          <div className="sm:col-span-2">
            <FieldLabel>Criado em</FieldLabel>
            <div className="mt-1.5 flex items-center gap-2">
              {([
                { flag: 'platformApp', label: 'App', icon: <Smartphone className="h-3 w-3" /> },
                { flag: 'platformWeb', label: 'Web', icon: <Monitor className="h-3 w-3" /> },
                { flag: 'platformChat', label: 'Chat', icon: <MessageSquare className="h-3 w-3" /> },
              ] as const).map(({ flag, label, icon }) => (
                <button
                  key={flag}
                  type="button"
                  onClick={() => setPlatform(flag)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all',
                    client[flag]
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-line bg-surface text-foreground/40 hover:border-accent/20 hover:text-foreground/65',
                  )}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2">
            <FieldLabel>Entrada</FieldLabel>
            <p className="mt-1 text-sm text-foreground/85">
              {formatDate(client.createdAt)}{' '}
              <span className="text-foreground/40">({timeAgo(client.createdAt)})</span>
            </p>
          </div>
        </div>
      </Section>

      {/* Acessos */}
      <AccessesSection client={client} />

      {/* Tenant vinculado — editável (permite vincular clientes antigos à mão) */}
      <TenantLinkSection client={client} />

      {/* Pendências do cliente — trava a entrada na fila de configuração */}
      <ReadinessSection client={client} />

      {/* Progresso da config de API Oficial e de IA */}
      <ConfigProgressSection client={client} />

      {/* Notas */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <StickyNote className="h-3.5 w-3.5 text-accent" />
            Mensagens registradas
          </span>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Registre aqui mensagens trocadas, observações ou qualquer informação relevante…"
              className="min-h-[80px] flex-1 resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-foreground/65 cursor-pointer">
              <input
                type="checkbox"
                checked={noteInternal}
                onChange={(e) => setNoteInternal(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#4F8EF7]"
              />
              <StickyNote className="h-3.5 w-3.5" />
              Nota interna (só o time vê)
            </label>
            <Button
              size="sm"
              onClick={addNote}
              disabled={!noteText.trim()}
              leftIcon={<MessageSquare className="h-3.5 w-3.5" />}
            >
              {noteInternal ? 'Registrar nota interna' : 'Registrar mensagem'}
            </Button>
          </div>

          {(client.notes ?? []).length === 0 ? (
            <p className="text-xs text-foreground/40">Nenhuma mensagem ainda.</p>
          ) : (
            <ul className="space-y-2">
              {(client.notes ?? []).map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    'rounded-lg border p-3',
                    n.internal
                      ? 'border-warning/30 bg-warning/[0.06]'
                      : 'border-line bg-elevate/[0.02]',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.04] text-[10px] font-medium text-foreground/85 ring-1 ring-line">
                      {initials(n.author) || (
                        <UserCircle2 className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                          {asText(n.author, '—')}
                          {n.internal && (
                            <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                              <StickyNote className="h-3 w-3" />
                              interna
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-foreground/40">
                            {timeAgo(n.createdAt)}
                          </span>
                          {editingNoteId !== n.id && (
                            <>
                              <button
                                type="button"
                                title="Editar nota"
                                onClick={() => {
                                  setEditingNoteId(n.id)
                                  setEditingNoteText(n.text)
                                }}
                                className="ml-1 grid h-5 w-5 place-items-center rounded text-foreground/35 hover:text-accent transition-colors"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                title="Excluir nota"
                                onClick={() => {
                                  db.deleteNote(client.id, n.id)
                                  db.addLog(client.id, 'Nota excluída')
                                  toast.success('Nota excluída')
                                }}
                                className="grid h-5 w-5 place-items-center rounded text-foreground/35 hover:text-danger transition-colors"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {editingNoteId === n.id ? (
                        <div className="mt-2 space-y-2">
                          <textarea
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value)}
                            rows={3}
                            className="w-full resize-y rounded-lg border border-accent/40 bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                            autoFocus
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingNoteId(null)}
                              className="px-2 py-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              disabled={!editingNoteText.trim()}
                              onClick={() => {
                                const t = editingNoteText.trim()
                                if (!t) return
                                db.updateNote(client.id, n.id, t)
                                db.addLog(client.id, 'Nota editada')
                                toast.success('Nota atualizada')
                                setEditingNoteId(null)
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-40"
                            >
                              <Check className="h-3 w-3" />
                              Salvar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/85">
                          {asText(n.text)}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* Timeline */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Timeline de atividades
          </span>
        }
      >
        {(client.logs ?? []).length === 0 ? (
          <p className="text-xs text-foreground/40">Sem atividade ainda.</p>
        ) : (
          <ol className="space-y-2.5">
            {(client.logs ?? []).map((log) => (
              <li key={log.id} className="flex items-start gap-3">
                <span className="mt-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-elevate/[0.04] text-foreground/55 ring-1 ring-line">
                  {iconForAction(log.action)}
                </span>
                <div className="min-w-0 flex-1 rounded-md border border-line bg-elevate/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground/90">
                      {asText(log.action)}
                    </span>
                    <span className="text-[10px] text-foreground/40">
                      {timeAgo(log.createdAt)}
                    </span>
                  </div>
                  {log.detail && (
                    <p className="mt-0.5 text-xs text-foreground/55">
                      {asText(log.detail)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}

// ─── Progresso de configuração (API Oficial + IA) ─────────────────────────────

/**
 * Prontidão para configurar: o que ainda falta o cliente enviar. Enquanto
 * houver bloqueio, o cliente aparece como "Bloqueado" na fila do pipeline —
 * a ideia é cobrar aqui em vez de descobrir a falta com o AnyDesk aberto.
 */
function ReadinessSection({ client }: { client: Client }) {
  const [chargeOpen, setChargeOpen] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [sending, setSending] = React.useState(false)

  const readiness = React.useMemo(() => computeReadiness(client), [client])

  // Antes do briefing existir, cobrar pendência não faz sentido — o próprio
  // briefing é a cobrança.
  if (!client.briefingConfig) return null

  // Portal onde o cliente completa só o que falta (destrava o card sozinho).
  const pendingLink = client.briefingToken
    ? `${window.location.origin}/pendencias/${client.briefingToken}`
    : null
  const target = client.briefingNumber || client.phone

  const openCharge = () => {
    setMessage(buildPendingMessage(client, readiness.blockers, pendingLink))
    setChargeOpen(true)
  }

  const copyLink = async () => {
    if (!pendingLink) return
    const ok = await copyToClipboard(pendingLink)
    if (ok) toast.success('Link de pendências copiado')
    else toast.error('Não foi possível copiar')
  }

  const send = async () => {
    const number = normalizeWhatsappNumber(target)
    if (!number) {
      toast.error('Cliente sem número de WhatsApp cadastrado.')
      return
    }
    setSending(true)
    try {
      await api.post('/api/whatsapp/send', { number, text: message })
      db.addLog(
        client.id,
        'Pendências cobradas no WhatsApp',
        readiness.items.map((i) => i.label).join(' · '),
      )
      toast.success('Cobrança enviada')
      setChargeOpen(false)
    } catch (err) {
      toast.error(
        'Falha ao enviar: ' + (err instanceof Error ? err.message : 'erro'),
      )
    } finally {
      setSending(false)
    }
  }

  const copy = async () => {
    const ok = await copyToClipboard(message)
    if (ok) toast.success('Mensagem copiada')
    else toast.error('Não foi possível copiar')
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <ListChecks className="h-3.5 w-3.5 text-accent" />
          Prontidão para configurar
        </span>
      }
      action={
        readiness.ready ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
            <Check className="h-3 w-3" />
            Pronto
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
            {readiness.blockers.length} pendência
            {readiness.blockers.length === 1 ? '' : 's'}
          </span>
        )
      }
    >
      {readiness.items.length === 0 ? (
        <p className="text-xs text-foreground/50">
          Tudo o que precisamos do cliente já foi recebido — pode entrar na fila
          de configuração.
        </p>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {readiness.items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs',
                  item.severity === 'blocker'
                    ? 'border-warning/25 bg-warning/[0.07]'
                    : 'border-line bg-elevate/[0.02]',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    item.severity === 'blocker' ? 'bg-warning' : 'bg-foreground/30',
                  )}
                />
                <div className="min-w-0">
                  <div
                    className={cn(
                      'font-medium',
                      item.severity === 'blocker' ? 'text-warning' : 'text-foreground/70',
                    )}
                  >
                    {item.label}
                  </div>
                  <div className="text-foreground/50">{item.ask}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            {pendingLink && (
              <Button
                size="sm"
                variant="secondary"
                onClick={copyLink}
                leftIcon={<Copy className="h-3.5 w-3.5" />}
              >
                Copiar link
              </Button>
            )}
            <Button
              size="sm"
              onClick={openCharge}
              leftIcon={<Send className="h-3.5 w-3.5" />}
            >
              Cobrar pendências
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={chargeOpen}
        onClose={() => setChargeOpen(false)}
        title="Cobrar pendências"
        description={
          target
            ? `Enviaremos para ${target}. Revise o texto antes de enviar.`
            : 'Cliente sem número cadastrado — copie a mensagem e envie manualmente.'
        }
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={copy}>
              Copiar
            </Button>
            <Button onClick={send} loading={sending} disabled={!target}>
              Enviar no WhatsApp
            </Button>
          </>
        }
      >
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={14}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        />
      </Modal>
    </Section>
  )
}

function ConfigProgressSection({ client }: { client: Client }) {
  const cfg = client.briefingConfig
  const isApiOficial =
    Boolean(client.hasApiOficial) || Boolean(cfg?.connectionTypes.includes('api_oficial'))
  const isIa =
    Boolean(client.hasIa) ||
    Boolean(cfg?.automationTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada'))

  // Nada a mostrar se o cliente não tem API Oficial nem IA.
  if (!isApiOficial && !isIa) return null

  const oa = client.briefingData?.officialApi

  const toggleStep = (area: 'api' | 'ia', step: ConfigStepDef) => {
    const cp = client.configProgress ?? {}
    const areaObj = { ...(cp[area] ?? {}) }
    const done = !(areaObj[step.key]?.done ?? false)
    areaObj[step.key] = { done, at: done ? new Date().toISOString() : null }
    db.updateClient(client.id, { configProgress: { ...cp, [area]: areaObj } })
    db.addLog(
      client.id,
      `Config ${area === 'api' ? 'API Oficial' : 'IA'}: ${step.label} ${done ? 'concluído' : 'reaberto'}`,
    )
  }

  const Steps = ({ area, steps }: { area: 'api' | 'ia'; steps: ConfigStepDef[] }) => {
    const state = client.configProgress?.[area] ?? {}
    const doneCount = steps.filter((s) => state[s.key]?.done).length
    return (
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-xs font-medium text-foreground/70">
            {area === 'api' ? 'Config API Oficial' : 'Config IA'}
          </span>
          <span className="text-[10px] text-foreground/45">
            {doneCount}/{steps.length}
          </span>
        </div>
        <div className="space-y-1">
          {steps.map((s) => {
            const st = state[s.key]
            const done = Boolean(st?.done)
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleStep(area, s)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-elevate/[0.04]"
              >
                <span
                  className={cn(
                    'grid h-4 w-4 shrink-0 place-items-center rounded border',
                    done ? 'border-success bg-success/20 text-success' : 'border-line text-transparent',
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span className={cn(done ? 'text-foreground/60 line-through' : 'text-foreground/85')}>
                  {s.label}
                </span>
                {done && st?.at && (
                  <span className="ml-auto text-[10px] text-foreground/40">{formatDate(st.at)}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <ListChecks className="h-3.5 w-3.5 text-accent" />
          Progresso da configuração
        </span>
      }
    >
      <div className="space-y-4">
        {isApiOficial && (
          <>
            {/* Acesso da API Oficial coletado no briefing */}
            {oa ? (
              <div className="rounded-lg border border-line bg-elevate/[0.02] p-3 text-xs">
                <div className="mb-2 font-medium text-foreground/70">Acesso API Oficial (Meta)</div>
                <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <OaRow label="Portfólio empresarial" value={oa.businessPortfolioName} />
                  <OaRow label="Número dedicado" value={oa.numeroDedicado} />
                  <OaRow label="Nome no WhatsApp (display)" value={oa.displayNamePretendido} />
                  <OaRow
                    label="Verificação do negócio"
                    value={oa.verificacaoNegocioStatus ? META_VERIFICATION_LABELS[oa.verificacaoNegocioStatus] : undefined}
                  />
                  <OaRow
                    label="Partner access"
                    value={oa.partnerAccessStatus ? PARTNER_ACCESS_LABELS[oa.partnerAccessStatus] : undefined}
                  />
                </dl>
              </div>
            ) : (
              <p className="text-xs text-foreground/45">
                Dados de acesso da API Oficial ainda não coletados no briefing.
              </p>
            )}
            <Steps area="api" steps={API_CONFIG_STEPS} />
          </>
        )}
        {isIa && <Steps area="ia" steps={IA_CONFIG_STEPS} />}
      </div>
    </Section>
  )
}

function OaRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <dt className="text-foreground/45">{label}</dt>
      <dd className={cn('font-medium', value ? 'text-foreground/85' : 'text-foreground/35')}>
        {value || '—'}
      </dd>
    </div>
  )
}

// ─── Tenant vinculado (editável) ──────────────────────────────────────────────

function TenantLinkSection({ client }: { client: Client }) {
  const servers = useAuthStore((s) => s.servers)
  const serverName = servers.find((sv) => sv.id === client.tenantServerId)?.name

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <ServerIcon className="h-3.5 w-3.5 text-accent" />
          Tenant vinculado
        </span>
      }
      action={
        serverName ? (
          <span className="rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent ring-1 ring-accent/20">
            {serverName}
          </span>
        ) : null
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel>Servidor</FieldLabel>
          <select
            value={client.tenantServerId ?? ''}
            onChange={(e) => {
              db.updateClient(client.id, { tenantServerId: e.target.value || undefined })
              db.addLog(client.id, 'Servidor do tenant atualizado')
            }}
            className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          >
            <option value="">— Selecione —</option>
            {servers.map((sv) => (
              <option key={sv.id} value={sv.id}>
                {sv.name}
              </option>
            ))}
          </select>
        </div>
        <InlineField
          label="Nome do tenant"
          value={client.tenantName ?? ''}
          placeholder="Sem informação"
          onSave={(v) =>
            db.updateClient(client.id, { tenantName: v.trim() || undefined }) &&
            db.addLog(client.id, 'Nome do tenant atualizado')
          }
        />
        <InlineField
          label="Tenant ID"
          value={client.tenantId ?? ''}
          placeholder="Sem informação"
          onSave={(v) =>
            db.updateClient(client.id, { tenantId: v.trim() || undefined }) &&
            db.addLog(client.id, 'Tenant ID atualizado')
          }
        />
        <InlineField
          label="API ID"
          value={client.tenantApiId ?? ''}
          placeholder="apiId do tenant"
          onSave={(v) =>
            db.updateClient(client.id, { tenantApiId: v.trim() || undefined }) &&
            db.addLog(client.id, 'API ID do tenant atualizado')
          }
        />
        <div className="sm:col-span-2">
          <InlineField
            label="API Token (do tenant)"
            value={client.tenantApiToken ?? ''}
            placeholder="Cole o token da API do tenant"
            onSave={(v) =>
              db.updateClient(client.id, { tenantApiToken: v.trim() || undefined }) &&
              db.addLog(client.id, 'API Token do tenant atualizado')
            }
          />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-foreground/45">
        Necessário para listar os canais e reconciliar o status. Clientes antigos podem não ter o
        token — cole aqui o <strong>API Token do tenant</strong> para vincular.
      </p>
    </Section>
  )
}

// ─── Acessos ────────────────────────────────────────────────────────────────

function AccessesSection({ client }: { client: Client }) {
  const [addOpen, setAddOpen] = React.useState(false)
  const accesses = getAccesses(client)

  const saveAccess = (entry: Omit<ClientAccess, 'id'>) => {
    const current = client.accesses && client.accesses.length > 0
      ? client.accesses
      : DEFAULT_ACCESS_NAMES.map((name, i) => ({ id: `default-${i}`, name }))
    const next = [...current, { ...entry, id: db.newId() }]
    db.updateClient(client.id, { accesses: next })
  }

  const removeAccess = (id: string) => {
    const current = client.accesses && client.accesses.length > 0
      ? client.accesses
      : DEFAULT_ACCESS_NAMES.map((name, i) => ({ id: `default-${i}`, name }))
    db.updateClient(client.id, { accesses: current.filter((a) => a.id !== id) })
  }

  const updateAccess = (id: string, patch: Partial<ClientAccess>) => {
    const current = client.accesses && client.accesses.length > 0
      ? client.accesses
      : DEFAULT_ACCESS_NAMES.map((name, i) => ({ id: `default-${i}`, name }))
    db.updateClient(client.id, {
      accesses: current.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-accent" />
          Acessos
        </span>
      }
      action={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setAddOpen(true)}
          leftIcon={<PlusCircle className="h-3.5 w-3.5" />}
        >
          Adicionar acesso
        </Button>
      }
    >
      <ul className="space-y-2">
        {accesses.map((a) => (
          <AccessRow
            key={a.id}
            access={a}
            onRemove={() => removeAccess(a.id)}
            onUpdate={(patch) => updateAccess(a.id, patch)}
          />
        ))}
      </ul>

      <AddAccessModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={saveAccess}
      />
    </Section>
  )
}

function AccessRow({
  access,
  onRemove,
  onUpdate,
}: {
  access: ClientAccess
  onRemove: () => void
  onUpdate: (patch: Partial<ClientAccess>) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [showPass, setShowPass] = React.useState(false)
  const hasDetails = Boolean(access.emailOrPhone || access.password || access.url)

  return (
    <li className="overflow-hidden rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-elevate/[0.03]"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
        )}
        <span className="flex-1 text-sm font-medium text-foreground">{access.name}</span>
        {!hasDetails && (
          <span className="text-[11px] text-foreground/35">Sem informação</span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="rounded-md p-1 text-foreground/30 opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100 transition-opacity"
          aria-label="Remover acesso"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-3 space-y-2.5">
          <AccessDetailRow
            icon={<Mail className="h-3.5 w-3.5" />}
            label="E-mail / Telefone"
            value={access.emailOrPhone}
            placeholder="Sem informação"
            onSave={(v) => onUpdate({ emailOrPhone: v })}
            copyable
          />
          <AccessDetailRow
            icon={<KeyRound className="h-3.5 w-3.5" />}
            label="Senha"
            value={access.password}
            placeholder="Sem informação"
            onSave={(v) => onUpdate({ password: v })}
            secret
            showSecret={showPass}
            onToggleSecret={() => setShowPass((s) => !s)}
            copyable
          />
          <AccessDetailRow
            icon={<Globe className="h-3.5 w-3.5" />}
            label="Link"
            value={access.url}
            placeholder="Sem informação"
            onSave={(v) => onUpdate({ url: v })}
            href={access.url}
          />
        </div>
      )}
    </li>
  )
}

function AccessDetailRow({
  icon,
  label,
  value,
  placeholder,
  onSave,
  copyable,
  secret,
  showSecret,
  onToggleSecret,
  href,
}: {
  icon: React.ReactNode
  label: string
  value?: string
  placeholder?: string
  onSave: (v: string) => void
  copyable?: boolean
  secret?: boolean
  showSecret?: boolean
  onToggleSecret?: () => void
  href?: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')

  React.useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [value, editing])

  const commit = () => {
    onSave(draft.trim())
    setEditing(false)
  }

  const display = secret && !showSecret && value
    ? '••••••••'
    : (value || <span className="text-foreground/35">{placeholder}</span>)

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-foreground/40">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-foreground/35 mb-0.5">{label}</div>
        {editing ? (
          <input
            autoFocus
            type={secret && !showSecret ? 'password' : 'text'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
            }}
            className="w-full rounded-md border border-accent/40 bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="group flex items-center gap-1 text-left text-sm text-foreground/85 hover:text-foreground transition-colors"
          >
            {display}
            <Pencil className="h-3 w-3 shrink-0 text-foreground/25 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {secret && value && onToggleSecret && (
          <button
            type="button"
            onClick={onToggleSecret}
            className="rounded-md p-1 text-foreground/35 hover:bg-elevate/[0.06] hover:text-foreground"
            aria-label={showSecret ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
        {copyable && value && (
          <button
            type="button"
            onClick={async () => {
              const ok = await copyToClipboard(value)
              if (ok) toast.success(`${label} copiado`)
            }}
            className="rounded-md p-1 text-foreground/35 hover:bg-elevate/[0.06] hover:text-foreground"
            aria-label={`Copiar ${label}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1 text-foreground/35 hover:bg-elevate/[0.06] hover:text-foreground"
            aria-label="Abrir link"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  )
}

function AddAccessModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (entry: Omit<ClientAccess, 'id'>) => void
}) {
  const [name, setName] = React.useState('')
  const [emailOrPhone, setEmailOrPhone] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [url, setUrl] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setName('')
    setEmailOrPhone('')
    setPassword('')
    setUrl('')
  }, [open])

  const submit = () => {
    if (!name.trim()) {
      toast.error('Informe o nome do acesso.')
      return
    }
    onSave({
      name: name.trim(),
      emailOrPhone: emailOrPhone.trim() || undefined,
      password: password.trim() || undefined,
      url: url.trim() || undefined,
    })
    onClose()
    toast.success('Acesso adicionado')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar acesso"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit}>Adicionar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Nome *"
          placeholder="Ex: Instagram, Painel Admin…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          leftIcon={<KeyRound className="h-4 w-4" />}
        />
        <Input
          label="E-mail / Telefone"
          placeholder="usuario@email.com ou (11) 99999-9999"
          value={emailOrPhone}
          onChange={(e) => setEmailOrPhone(e.target.value)}
          leftIcon={<Phone className="h-4 w-4" />}
        />
        <Input
          label="Senha"
          type="text"
          placeholder="Senha de acesso"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          leftIcon={<KeyRound className="h-4 w-4" />}
        />
        <Input
          label="Link"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          leftIcon={<Globe className="h-4 w-4" />}
        />
      </div>
    </Modal>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function iconForAction(action: string): React.ReactNode {
  const a = action.toLowerCase()
  if (a.includes('contrato')) return <FileText className="h-3 w-3" />
  if (a.includes('briefing')) return <MessageSquare className="h-3 w-3" />
  if (a.includes('cobrança') || a.includes('pagamento') || a.includes('asaas'))
    return <ArrowRight className="h-3 w-3" />
  if (a.includes('checklist') || a.includes('entrega'))
    return <ListChecks className="h-3 w-3" />
  if (a.includes('follow-up') || a.includes('mensagem'))
    return <Send className="h-3 w-3" />
  if (a.includes('etapa')) return <ArrowRight className="h-3 w-3" />
  if (a.includes('nota')) return <StickyNote className="h-3 w-3" />
  return <Check className="h-3 w-3" />
}

function ResponsavelSelect({
  label,
  value,
  area,
  onChange,
}: {
  label: string
  value: string
  /** Só lista quem atua nessa área (ou nas duas). */
  area: TeamArea
  onChange: (v: string) => void
}) {
  const { data: profiles } = useTeamProfiles()
  const options = profileOptions(profiles, area)
  // Garante que um valor antigo (texto livre) que não está na lista ainda apareça.
  const hasValue = value && options.some((o) => o.value === value)
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
      >
        <option value="">— Sem responsável —</option>
        {!hasValue && value && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function InlineField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {editing ? (
        <div className="mt-1">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(value)
                setEditing(false)
              }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            'group mt-1 flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm transition-colors',
            'hover:border-line hover:bg-elevate/[0.02]',
          )}
        >
          <span className={value ? 'text-foreground/90' : 'text-foreground/40'}>
            {value || placeholder || '—'}
          </span>
          <Pencil className="h-3 w-3 text-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  )
}

/**
 * Campo em que clicar no valor COPIA (útil para e-mail), com um botão de lápis
 * ao lado para editar.
 */
function CopyEditField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  const copy = async () => {
    if (!value) return
    const ok = await copyToClipboard(value)
    if (ok) toast.success('E-mail copiado')
    else toast.error('Não foi possível copiar')
  }

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {editing ? (
        <div className="mt-1">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(value)
                setEditing(false)
              }
            }}
          />
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={copy}
            title="Clique para copiar"
            className="group flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm transition-colors hover:border-line hover:bg-elevate/[0.02]"
          >
            <span className={cn('truncate', value ? 'text-foreground/90' : 'text-foreground/40')}>
              {value || placeholder || '—'}
            </span>
            <Copy className="h-3 w-3 shrink-0 text-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Editar"
            className="shrink-0 rounded-md border border-transparent p-1.5 text-foreground/40 transition-colors hover:border-line hover:bg-elevate/[0.04] hover:text-foreground/80"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
