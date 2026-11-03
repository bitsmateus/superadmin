import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, Flame, Loader2, MessageCircle, RefreshCw, Send, Trash2, UserCheck } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Textarea } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { PainelDeLinks } from '@/components/demoStudio/links/PainelDeLinks'
import { Painel } from '@/components/demoStudio/analytics/Analytics'
import { downloadCsv } from '@/lib/csv'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { dataHora, duracao, pct } from '@/lib/demoStudio/format'
import { formatarTelefone, linkWhatsapp } from '@/lib/demoStudio/variables'
import {
  ROTULO_STATUS,
  crm,
  demoStudio,
  type ConfigWorkspace,
  type DemoResumo,
  type EntregaWebhook,
  type Lead,
  type LeadDetalhe,
  type MeuAcesso,
  type StatusLead,
  type UsuarioDoModulo,
  type Webhook,
} from '@/services/demoStudio'

const selectCls = 'h-9 rounded-lg border border-line bg-transparent px-2 text-sm'
const TOM_STATUS: Record<StatusLead, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  NOVO: 'info', EM_CONTATO: 'warning', QUALIFICADO: 'info', GANHO: 'success', PERDIDO: 'danger',
}

function SeloQuente({ score }: { score: number }) {
  return score >= 70 ? (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-orange-500" title={`Pontuação ${score}/100`}>
      <Flame className="h-3 w-3" /> {score}
    </span>
  ) : (
    <span className="text-xs tabular-nums text-foreground/45" title="Pontuação de engajamento (0–100)">{score}</span>
  )
}

/* ------------------------------------------------------------------ /demo-studio/links e /demo-studio/demos/:id/links */

export function DemoLinksPage() {
  const { id } = useParams()
  const [nome, setNome] = React.useState('')
  React.useEffect(() => {
    if (id) demoStudio.obter(id).then((d) => setNome(d.name)).catch(() => undefined)
  }, [id])
  return (
    <>
      <TopBar compacto title="Links" subtitle={id ? nome : 'Demo Studio'}
        breadcrumbs={id
          ? [{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Demos', to: '/demo-studio/demos' }, { label: nome || 'Demo', to: `/demo-studio/demos/${id}` }, { label: 'Links' }]
          : [{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Links' }]} />
      <div className="px-4 pb-10 lg:px-6"><PainelDeLinks demoId={id} /></div>
    </>
  )
}

/* ------------------------------------------------------------------ /demo-studio/leads */

export function DemoLeadsPage() {
  const navigate = useNavigate()
  const [leads, setLeads] = React.useState<Lead[] | null>(null)
  const [demos, setDemos] = React.useState<DemoResumo[]>([])
  const [pessoas, setPessoas] = React.useState<{ id: string; name: string | null }[]>([])
  const [f, setF] = React.useState<{ status?: string; ownerId?: string; demoId?: string; q?: string; quentes?: '1' }>({})
  const [busca, setBusca] = React.useState('')

  React.useEffect(() => {
    demoStudio.listar().then(setDemos).catch(() => undefined)
    crm.pessoas().then(setPessoas).catch(() => undefined)
  }, [])
  React.useEffect(() => {
    const t = setTimeout(() => setF((v) => ({ ...v, q: busca || undefined })), 300)
    return () => clearTimeout(t)
  }, [busca])
  React.useEffect(() => {
    setLeads(null)
    crm.leads(f).then(setLeads).catch((e: Error) => { toast.error(e.message); setLeads([]) })
  }, [f])

  const mudarStatus = async (l: Lead, status: StatusLead) => {
    setLeads((ls) => ls?.map((x) => (x.id === l.id ? { ...x, status } : x)) ?? null)
    try {
      await crm.editarLead(l.id, { status })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const exportar = () => {
    if (!leads?.length) return
    downloadCsv(
      `leads-demo-studio-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Nome', 'Empresa', 'WhatsApp', 'E-mail', 'Status', 'Pontuação', 'Responsável', 'Demo', 'Link', 'Primeira visita', 'Última visita', 'Sessões', 'Maior % concluído', 'Clicou no CTA'],
      leads.map((l) => [
        l.name ?? '', l.company ?? '', l.phone ?? '', l.email ?? '', ROTULO_STATUS[l.status], l.score, l.owner?.name ?? '',
        l.source.demoName ?? '', l.source.linkLabel ?? l.source.channel ?? '', dataHora(l.firstSeenAt), dataHora(l.lastSeenAt),
        l.sessions, pct(l.maxPct), l.ctaClicked ? 'Sim' : 'Não',
      ]),
    )
  }

  return (
    <>
      <TopBar compacto title="Leads" subtitle="Demo Studio" breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Leads' }]}
        rightSlot={<Button size="sm" variant="outline" leftIcon={<Download className="h-4 w-4" />} disabled={!leads?.length} onClick={exportar}>Exportar CSV</Button>} />
      <div className="px-4 pb-10 lg:px-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input className={cn(selectCls, 'w-56 px-3')} placeholder="Buscar nome, empresa, WhatsApp…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select className={selectCls} value={f.status ?? ''} onChange={(e) => setF({ ...f, status: e.target.value || undefined })} aria-label="Status">
            <option value="">Todos os status</option>
            {(Object.keys(ROTULO_STATUS) as StatusLead[]).map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
          </select>
          <select className={selectCls} value={f.ownerId ?? ''} onChange={(e) => setF({ ...f, ownerId: e.target.value || undefined })} aria-label="Responsável">
            <option value="">Todos os responsáveis</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.name ?? 'Sem nome'}</option>)}
          </select>
          <select className={selectCls} value={f.demoId ?? ''} onChange={(e) => setF({ ...f, demoId: e.target.value || undefined })} aria-label="Demo">
            <option value="">Todas as demos</option>
            {demos.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-foreground/70">
            <input type="checkbox" checked={!!f.quentes} onChange={(e) => setF({ ...f, quentes: e.target.checked ? '1' : undefined })} />
            <Flame className="h-3.5 w-3.5 text-orange-500" /> Só quentes
          </label>
        </div>
        {leads === null ? (
          <div className="grid h-40 place-items-center text-foreground/45"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : leads.length === 0 ? (
          <EmptyState icon={<UserCheck className="h-5 w-5" />} title="Nenhum lead ainda"
            description="Os leads aparecem quando alguém preenche o formulário da demo, deixa nome e empresa no cartão final ou recebe um link personalizado." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-xs text-foreground/45">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">WhatsApp</th>
                  <th className="px-3 py-2 font-medium">Origem</th>
                  <th className="px-3 py-2 font-medium">Visitas</th>
                  <th className="px-3 py-2 text-right font-medium">Sessões</th>
                  <th className="px-3 py-2 text-right font-medium">Maior %</th>
                  <th className="px-3 py-2 text-right font-medium">Pontos</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Responsável</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="cursor-pointer border-b border-line/60 hover:bg-elevate/[0.03]" onClick={() => navigate(`/demo-studio/leads/${l.id}`)}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">{l.name || 'Sem nome'}</div>
                      <div className="text-xs text-foreground/50">{l.company || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">{l.phone ? formatarTelefone(l.phone) : l.email ?? '—'}</td>
                    <td className="max-w-[12rem] px-3 py-2 text-xs">
                      <div className="truncate">{l.source.demoName ?? '—'}</div>
                      <div className="truncate text-foreground/45">{l.source.linkLabel ?? l.source.channel ?? ''}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-foreground/60">
                      <div>{dataHora(l.firstSeenAt)}</div>
                      <div className="text-foreground/40">últ. {dataHora(l.lastSeenAt)}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.sessions}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(l.maxPct)}</td>
                    <td className="px-3 py-2 text-right"><SeloQuente score={l.score} /></td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <select className={cn(selectCls, 'h-8 text-xs')} value={l.status} onChange={(e) => mudarStatus(l, e.target.value as StatusLead)} aria-label="Status do lead">
                        {(Object.keys(ROTULO_STATUS) as StatusLead[]).map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs text-foreground/60">{l.owner?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ /demo-studio/leads/:id */

export function DemoLeadPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [lead, setLead] = React.useState<LeadDetalhe | null>(null)
  const [erro, setErro] = React.useState('')
  const [pessoas, setPessoas] = React.useState<{ id: string; name: string | null }[]>([])
  const [acesso, setAcesso] = React.useState<MeuAcesso | null>(null)
  const [form, setForm] = React.useState({ name: '', company: '', phone: '', email: '', role: '', notes: '' })
  const [salvando, setSalvando] = React.useState(false)

  const carregar = React.useCallback(() => {
    crm.lead(id).then((l) => {
      setLead(l)
      setForm({ name: l.name ?? '', company: l.company ?? '', phone: l.phone ?? '', email: l.email ?? '', role: l.role ?? '', notes: l.notes ?? '' })
    }).catch((e: Error) => setErro(e.message))
  }, [id])
  React.useEffect(() => {
    carregar()
    crm.pessoas().then(setPessoas).catch(() => undefined)
    demoStudio.eu().then(setAcesso).catch(() => undefined)
  }, [carregar])

  if (erro) return <div className="p-6"><EmptyState title="Lead não encontrado" description={erro} /></div>
  if (!lead) return <div className="grid h-40 place-items-center text-foreground/45"><Loader2 className="h-5 w-5 animate-spin" /></div>

  const salvar = async (dados: Parameters<typeof crm.editarLead>[1]) => {
    setSalvando(true)
    try {
      await crm.editarLead(lead.id, dados)
      toast.success('Lead salvo')
      carregar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  const apagar = async () => {
    if (!window.confirm('Apagar este lead e todas as sessões dele? (direito de exclusão — não dá pra desfazer)')) return
    try {
      await crm.apagarLead(lead.id)
      toast.success('Lead apagado')
      navigate('/demo-studio/leads')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const msgWhats = `Oi${lead.name ? ` ${lead.name.split(' ')[0]}` : ''}, tudo bem? Vi que você conheceu o ${lead.source.demoName ?? 'nosso tour'}. Posso te mostrar como ficaria na ${lead.company ?? 'sua empresa'}?`
  const vendedor = acesso?.role === 'SELLER'

  return (
    <>
      <TopBar compacto title={lead.name || 'Lead'} subtitle={lead.company ?? 'Demo Studio'}
        breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Leads', to: '/demo-studio/leads' }, { label: lead.name || 'Lead' }]}
        titleAddon={<SeloQuente score={lead.score} />} />
      <div className="grid gap-4 px-4 pb-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-6">
        <div className="space-y-4">
          <Painel titulo="Sessões">
            {lead.sessionsList.length === 0 ? <p className="text-xs text-foreground/45">Ainda não abriu a demo.</p> : (
              <ul className="divide-y divide-line">
                {lead.sessionsList.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <Link to={`/demo-studio/sessoes/${s.id}`} className="tabular-nums text-accent hover:underline">{dataHora(s.startedAt)}</Link>
                    <span className="text-foreground/70">{s.demoName}</span>
                    {s.linkLabel && <span className="text-xs text-foreground/45">via {s.linkLabel}</span>}
                    <span className="ml-auto text-xs tabular-nums text-foreground/60">
                      {duracao(s.activeMs)} · {s.stepsViewed}/{s.totalSteps || '?'} etapas{s.completed ? ' · concluiu' : ''}{s.ctaClicked ? ' · CTA' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Painel>
          <Painel titulo="Dados">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label="Empresa" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <Input label="WhatsApp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <Input label="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <Input label="Cargo" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
              {lead.cnpj && <Input label="CNPJ" value={lead.cnpj} readOnly />}
              <div className="sm:col-span-2">
                <Textarea label="Notas" rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" loading={salvando} onClick={() => salvar({
                name: form.name || null, company: form.company || null, phone: form.phone || null,
                email: form.email || null, role: form.role || null, notes: form.notes || null,
              })}>Salvar dados</Button>
            </div>
          </Painel>
          {lead.links.length > 0 && (
            <Painel titulo="Links personalizados">
              <ul className="space-y-1 text-sm">
                {lead.links.map((l) => (
                  <li key={l.id} className="flex items-center gap-2">
                    <span>{l.label}</span>
                    <span className="text-xs text-foreground/45">/l/{l.code} · {l.views} views</span>
                    {!l.active && <Badge>Desativado</Badge>}
                  </li>
                ))}
              </ul>
            </Painel>
          )}
        </div>
        <aside className="space-y-4">
          <Painel titulo="Funil comercial">
            <div className="space-y-3">
              <label className="block text-xs font-medium text-foreground/70">
                Status
                <select className={cn(selectCls, 'mt-1.5 w-full')} value={lead.status} onChange={(e) => salvar({ status: e.target.value as StatusLead })}>
                  {(Object.keys(ROTULO_STATUS) as StatusLead[]).map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-foreground/70">
                Responsável
                <select className={cn(selectCls, 'mt-1.5 w-full')} value={lead.owner?.id ?? ''} disabled={vendedor}
                  onChange={(e) => salvar({ ownerId: e.target.value || null })}>
                  <option value="">Ninguém</option>
                  {pessoas.map((p) => <option key={p.id} value={p.id}>{p.name ?? 'Sem nome'}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-2 text-xs text-foreground/55">
                <Badge tone={TOM_STATUS[lead.status]}>{ROTULO_STATUS[lead.status]}</Badge>
                <span>{lead.sessions} sessão(ões) · maior {pct(lead.maxPct)}</span>
              </div>
            </div>
          </Painel>
          <Painel titulo="Contato">
            <div className="space-y-2 text-sm">
              {lead.phone ? (
                <>
                  <p className="tabular-nums">{formatarTelefone(lead.phone)}</p>
                  <a href={linkWhatsapp(lead.phone, msgWhats)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1fa855] px-3 py-2 text-sm font-semibold text-white hover:opacity-90">
                    <MessageCircle className="h-4 w-4" /> Chamar no WhatsApp
                  </a>
                </>
              ) : <p className="text-xs text-foreground/45">Sem WhatsApp cadastrado.</p>}
              {lead.email && <p className="text-foreground/70">{lead.email}</p>}
              <p className="text-xs text-foreground/45">
                Origem: {lead.source.demoName ?? '—'}{lead.source.linkLabel ? ` · ${lead.source.linkLabel}` : lead.source.channel ? ` · ${lead.source.channel}` : ''}
                <br />Primeira visita {dataHora(lead.firstSeenAt)} · última {dataHora(lead.lastSeenAt)}
              </p>
            </div>
          </Painel>
          {acesso?.role === 'ADMIN' && (
            <Button variant="ghost" size="sm" className="text-red-500" leftIcon={<Trash2 className="h-4 w-4" />} onClick={apagar}>
              Apagar lead e sessões (LGPD)
            </Button>
          )}
        </aside>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ /demo-studio/configuracoes */

const ROTULO_EVENTO: Record<string, string> = {
  'lead.created': 'Lead criado',
  'lead.updated': 'Lead atualizado',
  'session.started': 'Sessão iniciada (lead conhecido)',
  'session.completed': 'Demo concluída',
  'cta.clicked': 'Clique no CTA',
}

export function DemoSettingsPage() {
  const [acesso, setAcesso] = React.useState<MeuAcesso | null>(null)
  React.useEffect(() => { demoStudio.eu().then(setAcesso).catch(() => undefined) }, [])
  return (
    <>
      <TopBar compacto title="Configurações" subtitle="Demo Studio" breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Configurações' }]} />
      <div className="space-y-4 px-4 pb-10 lg:px-6">
        {acesso && acesso.role !== 'ADMIN' ? (
          <EmptyState title="Só o administrador mexe aqui" description="Usuários, webhooks e o CTA padrão do Demo Studio são configurados por um administrador." />
        ) : acesso ? (
          <>
            <ConfigUsuarios />
            <ConfigCta />
            <ConfigWebhooks />
            <Painel titulo="Extensão e anonimização">
              <p className="text-sm text-foreground/55">O token da extensão de captura e as regras de anonimização chegam no M4.</p>
            </Painel>
          </>
        ) : null}
      </div>
    </>
  )
}

function ConfigUsuarios() {
  const [users, setUsers] = React.useState<UsuarioDoModulo[] | null>(null)
  const carregar = React.useCallback(() => { crm.usuarios().then(setUsers).catch((e: Error) => toast.error(e.message)) }, [])
  React.useEffect(() => { carregar() }, [carregar])
  const mudar = async (u: UsuarioDoModulo, dados: { hasAccess?: boolean; dsRole?: 'EDITOR' | 'SELLER' }) => {
    try {
      await crm.editarUsuario(u.id, dados)
      carregar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <Painel titulo="Usuários" acao={<span className="text-[11px] text-foreground/45">Editor cria e publica demos; vendedor só cria links personalizados e vê os próprios leads.</span>}>
      {!users ? <Loader2 className="h-4 w-4 animate-spin text-foreground/40" /> : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-foreground/45">
            <tr className="border-b border-line"><th className="py-2 font-medium">Pessoa</th><th className="py-2 font-medium">Acesso</th><th className="py-2 font-medium">Papel</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line/60">
                <td className="py-2"><div>{u.name ?? '—'}</div><div className="text-xs text-foreground/45">{u.email}</div></td>
                <td className="py-2">
                  {u.dsRole === 'ADMIN' ? <span className="text-xs text-foreground/50">Administrador</span> : (
                    <label className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={u.hasAccess} onChange={(e) => mudar(u, { hasAccess: e.target.checked })} /> Demo Studio
                    </label>
                  )}
                </td>
                <td className="py-2">
                  {u.dsRole === 'ADMIN' ? <span className="text-xs text-foreground/50">Admin</span> : (
                    <select className={cn(selectCls, 'h-8 text-xs')} value={u.dsRole} disabled={!u.hasAccess} onChange={(e) => mudar(u, { dsRole: e.target.value as 'EDITOR' | 'SELLER' })}>
                      <option value="EDITOR">Editor</option>
                      <option value="SELLER">Vendedor</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Painel>
  )
}

function ConfigCta() {
  const [c, setC] = React.useState<ConfigWorkspace | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  React.useEffect(() => { crm.config().then(setC).catch((e: Error) => toast.error(e.message)) }, [])
  if (!c) return null
  const salvar = async () => {
    setSalvando(true)
    try {
      await crm.salvarConfig({ ctaDefault: c.ctaDefault, privacyUrl: c.privacyUrl ?? '', consentText: c.consentText ?? '' })
      toast.success('Configurações salvas')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  return (
    <Painel titulo="CTA padrão e consentimento">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="WhatsApp padrão (demos novas)" value={c.ctaDefault?.phone ?? ''} placeholder="5548936181649"
          onChange={(e) => setC({ ...c, ctaDefault: { ...c.ctaDefault, phone: e.target.value.replace(/\D/g, '') } })} />
        <Input label="Mensagem padrão do botão do topo" value={c.ctaDefault?.message ?? ''}
          onChange={(e) => setC({ ...c, ctaDefault: { ...c.ctaDefault, message: e.target.value } })} />
        <Input label="Política de privacidade (URL)" value={c.privacyUrl ?? ''} placeholder="https://…"
          onChange={(e) => setC({ ...c, privacyUrl: e.target.value })} />
        <Input label="Texto de consentimento do formulário" value={c.consentText ?? ''} placeholder="Ao enviar, você concorda em ser contatado pela NX Digital…"
          onChange={(e) => setC({ ...c, consentText: e.target.value })} />
      </div>
      <div className="mt-3 flex justify-end"><Button size="sm" loading={salvando} onClick={salvar}>Salvar</Button></div>
    </Painel>
  )
}

function ConfigWebhooks() {
  const [lista, setLista] = React.useState<Webhook[] | null>(null)
  const [url, setUrl] = React.useState('')
  const [eventos, setEventos] = React.useState<string[]>(['lead.created', 'session.completed', 'cta.clicked'])
  const [log, setLog] = React.useState<{ id: string; entregas: EntregaWebhook[] } | null>(null)
  const [testando, setTestando] = React.useState('')
  const carregar = React.useCallback(() => { crm.webhooks().then(setLista).catch((e: Error) => toast.error(e.message)) }, [])
  React.useEffect(() => { carregar() }, [carregar])

  const criar = async () => {
    try {
      await crm.criarWebhook({ url, events: eventos })
      setUrl('')
      carregar()
      toast.success('Webhook criado')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const testar = async (w: Webhook) => {
    setTestando(w.id)
    try {
      const r = await crm.testarWebhook(w.id)
      if (r.ok) toast.success(`Teste entregue (HTTP ${r.status})`)
      else toast.error(`Teste falhou${r.status ? ` (HTTP ${r.status})` : ''}: ${r.body.slice(0, 120)}`)
      verLog(w.id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTestando('')
    }
  }
  const verLog = async (id: string) => {
    try {
      setLog({ id, entregas: await crm.entregas(id) })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const editar = async (w: Webhook, dados: Parameters<typeof crm.editarWebhook>[1]) => {
    try {
      await crm.editarWebhook(w.id, dados)
      carregar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Painel titulo="Webhooks (n8n)" acao={<span className="text-[11px] text-foreground/45">Assinatura: header X-NXDemo-Signature = sha256=HMAC(segredo, corpo)</span>}>
      <div className="space-y-3">
        {lista?.map((w) => (
          <div key={w.id} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{w.url}</span>
              {!w.active && <Badge>Pausado</Badge>}
              {w.failed > 0 && <Badge tone="danger">{w.failed} falha(s)</Badge>}
              <Button size="sm" variant="outline" loading={testando === w.id} leftIcon={<Send className="h-3.5 w-3.5" />} onClick={() => testar(w)}>Enviar teste</Button>
              <Button size="sm" variant="ghost" onClick={() => (log?.id === w.id ? setLog(null) : verLog(w.id))}>Log</Button>
              <Button size="sm" variant="ghost" onClick={() => editar(w, { active: !w.active })}>{w.active ? 'Pausar' : 'Ativar'}</Button>
              <button type="button" aria-label="Apagar webhook" className="p-1 text-foreground/40 hover:text-red-500"
                onClick={async () => { if (window.confirm('Apagar este webhook?')) { await crm.apagarWebhook(w.id); carregar() } }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {Object.keys(ROTULO_EVENTO).map((ev) => (
                <label key={ev} className="flex items-center gap-1">
                  <input type="checkbox" checked={w.events.includes(ev)}
                    onChange={(e) => editar(w, { events: e.target.checked ? [...w.events, ev] : w.events.filter((x) => x !== ev) })} />
                  {ROTULO_EVENTO[ev]}
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-foreground/55">
              Segredo: <code className="rounded bg-elevate/[0.05] px-1.5 py-0.5">{w.secret}</code>
              <button type="button" className="text-accent hover:underline" onClick={async () => { await copyToClipboard(w.secret); toast.success('Segredo copiado') }}>copiar</button>
              <button type="button" className="inline-flex items-center gap-0.5 hover:text-foreground"
                onClick={() => window.confirm('Gerar um segredo novo? O n8n precisa ser atualizado.') && editar(w, { regenerateSecret: true })}>
                <RefreshCw className="h-3 w-3" /> gerar outro
              </button>
            </div>
            {log?.id === w.id && (
              <div className="mt-3 max-h-64 overflow-auto rounded border border-line">
                {log.entregas.length === 0 ? <p className="p-2 text-xs text-foreground/45">Nenhuma entrega ainda.</p> : (
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {log.entregas.map((d) => (
                        <tr key={d.id} className="border-b border-line/60 align-top">
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums">{dataHora(d.createdAt)}</td>
                          <td className="px-2 py-1">{d.event}</td>
                          <td className="px-2 py-1">
                            <Badge tone={d.status === 'SUCCESS' ? 'success' : d.status === 'FAILED' ? 'danger' : 'warning'}>
                              {d.status === 'SUCCESS' ? 'Entregue' : d.status === 'FAILED' ? 'Falhou' : `Tentando (${d.attempts})`}
                            </Badge>
                          </td>
                          <td className="px-2 py-1 tabular-nums">{d.responseCode ?? '—'}</td>
                          <td className="max-w-[18rem] truncate px-2 py-1 text-foreground/50" title={d.responseBody ?? ''}>{d.responseBody}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
        <div className="rounded-lg border border-dashed border-line p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <Input label="URL do webhook (gatilho Webhook do n8n)" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://n8n…/webhook/demo-studio" />
            </div>
            <Button size="sm" disabled={!url || !eventos.length} onClick={criar}>Adicionar</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            {Object.keys(ROTULO_EVENTO).map((ev) => (
              <label key={ev} className="flex items-center gap-1">
                <input type="checkbox" checked={eventos.includes(ev)} onChange={(e) => setEventos(e.target.checked ? [...eventos, ev] : eventos.filter((x) => x !== ev))} />
                {ROTULO_EVENTO[ev]}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Painel>
  )
}
