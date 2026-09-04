import * as React from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { publicMassCampaignApi, publicMassContactsApi } from '@/api/massCampaigns'
import type {
  ApprovedTemplate,
  MassCampaignContact,
  MassCampaignRecipient,
  MassCampaignSummary,
  VariableMappingEntry,
} from '@/types/massCampaign'

// Mesma chave sintética do backend (routes/massCampaigns.ts) — representa o telefone do próprio
// contato como se fosse mais uma "coluna" disponível pro mapeamento de variáveis do template.
const PHONE_MAPPING_KEY = '__phone__'

type View = 'loading' | 'invalid' | 'list' | 'contacts' | 'new' | 'report'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  running: 'Em andamento',
  paused: 'Pausada',
  done: 'Concluída',
}
const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  running: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  done: 'bg-blue-100 text-blue-700',
}

export function LaundryPortalPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [view, setView] = React.useState<View>('loading')
  const [clientName, setClientName] = React.useState('')
  const [campaigns, setCampaigns] = React.useState<MassCampaignSummary[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    publicMassCampaignApi
      .get(token)
      .then((d) => {
        setClientName(d.clientName)
        setCampaigns(d.campaigns)
        setView((v) => (v === 'loading' ? 'list' : v))
      })
      .catch(() => setView('invalid'))
  }, [token])

  React.useEffect(() => {
    load()
  }, [load])

  // Atualiza a lista sozinha enquanto alguma campanha estiver rodando — pra ver o progresso sem
  // precisar ficar recarregando a página manualmente.
  React.useEffect(() => {
    if (view !== 'list') return
    if (!campaigns.some((c) => c.status === 'running')) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [view, campaigns, load])

  if (view === 'loading') {
    return <Shell><p className="text-sm text-slate-500">Carregando…</p></Shell>
  }
  if (view === 'invalid') {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-slate-800">Link inválido</h1>
        <p className="mt-3 text-sm text-slate-500">Esse link não existe. Fale com a NX Digital.</p>
      </Shell>
    )
  }

  if (view === 'new') {
    return (
      <Shell wide>
        <NewCampaignWizard
          token={token}
          clientName={clientName}
          onCancel={() => setView('list')}
          onCreated={() => {
            setView('list')
            load()
          }}
        />
      </Shell>
    )
  }

  if (view === 'report' && selectedCampaignId) {
    return (
      <Shell wide>
        <ReportView token={token} campaignId={selectedCampaignId} onBack={() => setView('list')} />
      </Shell>
    )
  }

  if (view === 'contacts') {
    return (
      <Shell wide>
        <PortalTabs current="contacts" onChange={setView} />
        <ContactsView token={token} />
      </Shell>
    )
  }

  return (
    <Shell wide>
      <PortalTabs current="list" onChange={setView} />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Campanhas</h1>
          <p className="text-sm text-slate-500">Disparo em massa pelo WhatsApp — {clientName}</p>
        </div>
        <button
          type="button"
          onClick={() => setView('new')}
          className="rounded-lg bg-[#2F5BFF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2348d8]"
        >
          + Nova campanha
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center">
          <p className="text-lg font-semibold text-slate-700">Nenhuma campanha encontrada</p>
          <p className="mt-1 text-sm text-slate-500">Crie sua primeira campanha de disparo em massa.</p>
          <ol className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm text-slate-600">
            <li>1. Importe sua planilha de contatos</li>
            <li>2. Escolha o template e mapeie as variáveis</li>
            <li>3. Dispare pra todo mundo, espaçado</li>
          </ol>
          <button
            type="button"
            onClick={() => setView('new')}
            className="mt-5 rounded-lg bg-[#2F5BFF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2348d8]"
          >
            + Nova campanha
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Nome</th>
                <th className="px-4 py-2.5">Template</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Progresso</th>
                <th className="px-4 py-2.5">Criada em</th>
                <th className="px-4 py-2.5">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.template_name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[c.status]}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.sent}/{c.total} enviados{Number(c.failed) > 0 ? ` · ${c.failed} falhas` : ''}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {(c.status === 'draft' || c.status === 'paused') && (
                        <ActionButton
                          label="Iniciar"
                          onClick={async () => {
                            await publicMassCampaignApi.start(token, c.id)
                            toast.success('Campanha iniciada')
                            load()
                          }}
                        />
                      )}
                      {c.status === 'running' && (
                        <ActionButton
                          label="Pausar"
                          onClick={async () => {
                            await publicMassCampaignApi.pause(token, c.id)
                            toast.success('Campanha pausada')
                            load()
                          }}
                        />
                      )}
                      <ActionButton
                        label="Relatório"
                        onClick={() => {
                          setSelectedCampaignId(c.id)
                          setView('report')
                        }}
                      />
                      <ActionButton
                        label="Duplicar"
                        onClick={async () => {
                          const res = await publicMassCampaignApi.duplicate(token, c.id)
                          toast.success(`Campanha duplicada — ${res.total} contatos prontos.`)
                          load()
                        }}
                      />
                      {c.status !== 'running' && (
                        <ActionButton
                          label="Excluir"
                          danger
                          onClick={async () => {
                            if (!window.confirm(`Excluir a campanha "${c.name}"? Essa ação não pode ser desfeita.`)) return
                            await publicMassCampaignApi.remove(token, c.id)
                            toast.success('Campanha excluída')
                            load()
                          }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}

function PortalTabs({ current, onChange }: { current: 'list' | 'contacts'; onChange: (v: View) => void }) {
  return (
    <div className="mb-6 flex gap-1 border-b border-slate-200">
      {(
        [
          { key: 'list', label: 'Campanhas' },
          { key: 'contacts', label: 'Contatos' },
        ] as const
      ).map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
            current === t.key ? 'border-[#2F5BFF] text-[#2F5BFF]' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function ActionButton({ label, onClick, danger }: { label: string; onClick: () => void | Promise<void>; danger?: boolean }) {
  const [busy, setBusy] = React.useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await onClick()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Falha na ação')
        } finally {
          setBusy(false)
        }
      }}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
        danger
          ? 'border-red-200 text-red-600 hover:border-red-400 hover:text-red-700'
          : 'border-slate-300 text-slate-600 hover:border-[#2F5BFF] hover:text-[#2F5BFF]'
      }`}
    >
      {label}
    </button>
  )
}

// ── Relatório ────────────────────────────────────────────────────────────────

function ReportView({ token, campaignId, onBack }: { token: string; campaignId: string; onBack: () => void }) {
  const [data, setData] = React.useState<{
    campaign: MassCampaignSummary
    counts: { total: string; sent: string; failed: string; queued: string }
    recipients: MassCampaignRecipient[]
  } | null>(null)

  const load = React.useCallback(() => {
    publicMassCampaignApi.report(token, campaignId).then(setData).catch(() => {})
  }, [token, campaignId])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    if (data?.campaign.status !== 'running') return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [data?.campaign.status, load])

  if (!data) return <p className="text-sm text-slate-500">Carregando…</p>

  const { campaign, counts, recipients } = data
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 text-sm text-[#2F5BFF] hover:underline">
        ← Voltar
      </button>
      <h1 className="text-2xl font-bold text-slate-800">{campaign.name}</h1>
      <p className="text-sm text-slate-500">{campaign.template_name}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={counts.total} />
        <StatCard label="Enviados" value={counts.sent} tone="text-green-600" />
        <StatCard label="Na fila" value={counts.queued} tone="text-slate-500" />
        <StatCard label="Falhas" value={counts.failed} tone="text-red-600" />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Telefone</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Detalhe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recipients.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 text-slate-700">{r.phone}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.status === 'sent'
                        ? 'bg-green-100 text-green-700'
                        : r.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {r.status === 'sent' ? 'Enviado' : r.status === 'failed' ? 'Falha' : r.status === 'skipped' ? 'Ignorado' : 'Na fila'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{r.error_message || (r.sent_at ? new Date(r.sent_at).toLocaleString('pt-BR') : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recipients.length === 200 && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
            Mostrando os primeiros 200 — a campanha continua processando os demais.
          </p>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 text-center">
      <div className={`text-2xl font-bold ${tone ?? 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

// ── Contatos (lista persistente) ────────────────────────────────────────────

function ContactsView({ token }: { token: string }) {
  const [total, setTotal] = React.useState(0)
  const [columns, setColumns] = React.useState<string[]>([])
  const [contacts, setContacts] = React.useState<MassCampaignContact[]>([])
  const [q, setQ] = React.useState('')
  const [offset, setOffset] = React.useState(0)
  const [modal, setModal] = React.useState<'add' | 'import' | null>(null)
  const [editing, setEditing] = React.useState<MassCampaignContact | null>(null)

  const load = React.useCallback(() => {
    publicMassContactsApi
      .list(token, offset, q || undefined)
      .then((d) => {
        setTotal(d.total)
        setColumns(d.columns)
        setContacts(d.contacts)
      })
      .catch(() => {})
  }, [token, offset, q])

  React.useEffect(() => {
    load()
  }, [load])

  const shownColumns = columns.slice(0, 4)

  const remove = async (c: MassCampaignContact) => {
    if (!window.confirm(`Excluir o contato ${c.phone}?`)) return
    try {
      await publicMassContactsApi.remove(token, c.id)
      toast.success('Contato excluído')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir')
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Contatos</h1>
          <p className="text-sm text-slate-500">{total} contato(s) salvos — reaproveitados em qualquer campanha nova.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setModal('import')}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-[#2F5BFF] hover:text-[#2F5BFF]"
          >
            Importar planilha
          </button>
          <button
            type="button"
            onClick={() => setModal('add')}
            className="rounded-lg bg-[#2F5BFF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2348d8]"
          >
            + Adicionar contato
          </button>
        </div>
      </div>

      <input
        value={q}
        onChange={(e) => {
          setOffset(0)
          setQ(e.target.value)
        }}
        placeholder="Buscar por telefone ou dado…"
        className="mb-4 h-10 w-full max-w-sm rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
      />

      {contacts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center">
          <p className="text-lg font-semibold text-slate-700">Nenhum contato encontrado</p>
          <p className="mt-1 text-sm text-slate-500">Importe uma planilha ou adicione um contato manualmente.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Telefone</th>
                {shownColumns.map((c) => (
                  <th key={c} className="whitespace-nowrap px-4 py-2.5">{c}</th>
                ))}
                <th className="px-4 py-2.5">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{c.phone}</td>
                  {shownColumns.map((col) => (
                    <td key={col} className="whitespace-nowrap px-4 py-2.5 text-slate-600">{c.row_data[col] ?? ''}</td>
                  ))}
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      <ActionButton label="Editar" onClick={() => setEditing(c)} />
                      <ActionButton label="Excluir" danger onClick={() => remove(c)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > contacts.length && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <button type="button" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 200))} className="disabled:opacity-30">
            ← Anteriores
          </button>
          <span>{offset + 1}–{offset + contacts.length} de {total}</span>
          <button type="button" disabled={offset + 200 >= total} onClick={() => setOffset((o) => o + 200)} className="disabled:opacity-30">
            Próximos →
          </button>
        </div>
      )}

      {modal === 'add' && (
        <ContactFormModal token={token} contact={null} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />
      )}
      {modal === 'import' && (
        <ImportContactsModal token={token} onClose={() => setModal(null)} onImported={() => { setModal(null); load() }} />
      )}
      {editing && (
        <ContactFormModal token={token} contact={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ContactFormModal({
  token,
  contact,
  onClose,
  onSaved,
}: {
  token: string
  contact: MassCampaignContact | null
  onClose: () => void
  onSaved: () => void
}) {
  const [phone, setPhone] = React.useState(contact?.phone ?? '')
  const [fields, setFields] = React.useState<{ key: string; value: string }[]>(
    contact && Object.keys(contact.row_data).length
      ? Object.entries(contact.row_data).map(([key, value]) => ({ key, value }))
      : [{ key: 'nome', value: '' }],
  )
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) return toast.error('Telefone inválido. Digite com DDD (e DDI se for fora do Brasil).')
    const fieldsObj: Record<string, string> = {}
    for (const f of fields) if (f.key.trim()) fieldsObj[f.key.trim()] = f.value
    setSaving(true)
    try {
      if (contact) await publicMassContactsApi.update(token, contact.id, { phone: digits, fields: fieldsObj })
      else await publicMassContactsApi.add(token, { phone: digits, fields: fieldsObj })
      toast.success(contact ? 'Contato atualizado' : 'Contato adicionado')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={contact ? 'Editar contato' : 'Adicionar contato'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Telefone" required hint="Com DDD e DDI, ex.: 5511999998888">
          <Text value={phone} onChange={setPhone} placeholder="5511999998888" />
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Campos (nome, pedido, etc.)</p>
          {fields.map((f, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={f.key}
                onChange={(e) => setFields((cur) => cur.map((x, xi) => (xi === i ? { ...x, key: e.target.value } : x)))}
                placeholder="campo"
                className="h-9 w-1/3 rounded-md border border-slate-300 px-2 text-xs text-slate-700"
              />
              <input
                value={f.value}
                onChange={(e) => setFields((cur) => cur.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))}
                placeholder="valor"
                className="h-9 flex-1 rounded-md border border-slate-300 px-2 text-xs text-slate-700"
              />
              <button
                type="button"
                onClick={() => setFields((cur) => cur.filter((_, xi) => xi !== i))}
                className="px-1 text-sm text-red-500 hover:text-red-700"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setFields((cur) => [...cur, { key: '', value: '' }])}
            className="text-xs font-medium text-[#2F5BFF] hover:underline"
          >
            + campo
          </button>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
          Cancelar
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-[#2F5BFF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2348d8] disabled:opacity-60"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </Modal>
  )
}

function ImportContactsModal({ token, onClose, onImported }: { token: string; onClose: () => void; onImported: () => void }) {
  const [fileDataUrl, setFileDataUrl] = React.useState<string | null>(null)
  const [fileName, setFileName] = React.useState('')
  const [header, setHeader] = React.useState<string[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [loadingPreview, setLoadingPreview] = React.useState(false)
  const [phoneColumn, setPhoneColumn] = React.useState('')
  const [ddi, setDdi] = React.useState('55')
  const [ddd, setDdd] = React.useState('')
  const [importing, setImporting] = React.useState(false)

  const onPickFile = async (file: File) => {
    setFileName(file.name)
    setLoadingPreview(true)
    try {
      const dataUrl = await fileToDataUrl(file)
      setFileDataUrl(dataUrl)
      const res = await publicMassCampaignApi.importPreview(token, dataUrl)
      setHeader(res.header)
      setTotalRows(res.totalRows)
      const guess = res.header.find((h) => /tel|celular|whats|fone|numero|número/i.test(h))
      if (guess) setPhoneColumn(guess)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao ler o arquivo')
      setFileDataUrl(null)
    } finally {
      setLoadingPreview(false)
    }
  }

  const submit = async () => {
    if (!fileDataUrl) return toast.error('Escolha o arquivo.')
    if (!phoneColumn) return toast.error('Escolha a coluna de telefone.')
    setImporting(true)
    try {
      const res = await publicMassContactsApi.import(token, { data: fileDataUrl, phoneColumn, ddi, ddd })
      toast.success(
        `${res.created} novo(s), ${res.updated} atualizado(s)${res.skipped ? `, ${res.skipped} pulado(s) sem telefone válido` : ''}.`,
      )
      onImported()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao importar')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal title="Importar planilha" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Contatos com o mesmo telefone são atualizados (as colunas vindas nessa planilha substituem as anteriores); os
          novos são criados.
        </p>
        <Field label="Planilha" required hint="CSV, XLS ou XLSX — máximo 8MB.">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-[#2F5BFF]">
            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
            />
            <span className="text-sm font-medium text-slate-600">
              {loadingPreview ? 'Lendo arquivo…' : fileName || 'Clique pra escolher o arquivo'}
            </span>
            {totalRows > 0 && <span className="mt-1 text-xs text-slate-400">{totalRows} linha(s) encontrada(s)</span>}
          </label>
        </Field>
        {header.length > 0 && (
          <Field label="Qual coluna tem o telefone?" required>
            <Select value={phoneColumn} onChange={setPhoneColumn} options={header} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="DDI padrão" hint="Só p/ números sem DDI.">
            <Text value={ddi} onChange={setDdi} placeholder="55" />
          </Field>
          <Field label="DDD padrão" hint="Só p/ números sem DDD.">
            <Text value={ddd} onChange={setDdd} placeholder="11" />
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
          Cancelar
        </button>
        <button
          type="button"
          disabled={importing || !fileDataUrl}
          onClick={submit}
          className="rounded-lg bg-[#2F5BFF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2348d8] disabled:opacity-60"
        >
          {importing ? 'Importando…' : 'Importar'}
        </button>
      </div>
    </Modal>
  )
}

// ── Nova campanha (wizard) ──────────────────────────────────────────────────

type WizardStep = 'contatos' | 'template' | 'revisao'

function NewCampaignWizard({
  token,
  onCancel,
  onCreated,
}: {
  token: string
  clientName: string
  onCancel: () => void
  onCreated: () => void
}) {
  const [step, setStep] = React.useState<WizardStep>('contatos')
  const [name, setName] = React.useState('')

  const [totalContacts, setTotalContacts] = React.useState(0)
  const [columns, setColumns] = React.useState<string[]>([])
  const [sampleContact, setSampleContact] = React.useState<MassCampaignContact | null>(null)
  const [loadingContacts, setLoadingContacts] = React.useState(true)
  const [selectMode, setSelectMode] = React.useState<'all' | 'manual'>('all')
  const [manualContacts, setManualContacts] = React.useState<MassCampaignContact[]>([])
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [contactsQuery, setContactsQuery] = React.useState('')

  const [templates, setTemplates] = React.useState<ApprovedTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = React.useState(false)
  const [templateName, setTemplateName] = React.useState('')
  const [delaySeconds, setDelaySeconds] = React.useState(20)
  const [mapping, setMapping] = React.useState<VariableMappingEntry[]>([])

  const [submitting, setSubmitting] = React.useState(false)

  const selectedTemplate = templates.find((t) => t.name === templateName) ?? null
  const selectedCount = selectMode === 'all' ? totalContacts : selectedIds.size

  React.useEffect(() => {
    publicMassContactsApi
      .list(token, 0)
      .then((d) => {
        setTotalContacts(d.total)
        setColumns(d.columns)
        setSampleContact(d.contacts[0] ?? null)
      })
      .catch(() => {})
      .finally(() => setLoadingContacts(false))
  }, [token])

  React.useEffect(() => {
    if (selectMode !== 'manual') return
    publicMassContactsApi
      .list(token, 0, contactsQuery || undefined)
      .then((d) => setManualContacts(d.contacts))
      .catch(() => {})
  }, [token, selectMode, contactsQuery])

  const toggleContact = (id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const goToTemplateStep = async () => {
    setStep('template')
    if (templates.length || loadingTemplates) return
    setLoadingTemplates(true)
    try {
      const res = await publicMassCampaignApi.templates(token)
      setTemplates(res.templates)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao buscar os templates')
    } finally {
      setLoadingTemplates(false)
    }
  }

  const pickTemplate = (t: ApprovedTemplate) => {
    setTemplateName(t.name)
    setMapping(Array.from({ length: t.variableCount }, (_, i) => ({ position: i + 1, source: 'column' as const })))
  }

  const submit = async () => {
    if (!name.trim()) return toast.error('Dê um nome pra campanha.')
    if (selectedCount === 0) return toast.error('Selecione ao menos um contato.')
    if (!templateName) return toast.error('Escolha um template.')
    const missing = mapping.find((m) => (m.source === 'column' && !m.column) || (m.source === 'fixed' && !m.value?.trim()))
    if (missing) return toast.error(`Preencha a variável {{${missing.position}}}.`)

    setSubmitting(true)
    try {
      const res = await publicMassCampaignApi.create(token, {
        name: name.trim(),
        templateName,
        templateLanguage: selectedTemplate?.language ?? 'pt_BR',
        delaySeconds,
        contactIds: selectMode === 'manual' ? Array.from(selectedIds) : undefined,
        mapping,
      })
      toast.success(`Campanha criada — ${res.total} contatos prontos.`)
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar a campanha')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <button type="button" onClick={onCancel} className="mb-4 text-sm text-[#2F5BFF] hover:underline">
        ← Cancelar
      </button>
      <h1 className="mb-1 text-2xl font-bold text-slate-800">Nova campanha</h1>
      <Steps current={step} />

      {step === 'contatos' && (
        <div className="mt-6 space-y-5">
          <Field label="Nome da campanha" required>
            <Text value={name} onChange={setName} placeholder="Ex.: Aviso de reajuste — Março" />
          </Field>

          {loadingContacts ? (
            <p className="text-sm text-slate-500">Carregando contatos…</p>
          ) : totalContacts === 0 ? (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
              Você ainda não tem contatos salvos. Volte pra lista e importe uma planilha (ou adicione contatos) na aba{' '}
              <strong>Contatos</strong> antes de criar uma campanha.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Quem vai receber?</p>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 hover:border-[#2F5BFF]">
                <input type="radio" checked={selectMode === 'all'} onChange={() => setSelectMode('all')} className="mt-0.5" />
                <span>
                  <strong>Todos os contatos</strong> — {totalContacts} contato(s) salvos
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 hover:border-[#2F5BFF]">
                <input type="radio" checked={selectMode === 'manual'} onChange={() => setSelectMode('manual')} className="mt-0.5" />
                <span>
                  <strong>Selecionar manualmente</strong> — escolha quem recebe
                </span>
              </label>

              {selectMode === 'manual' && (
                <div className="rounded-lg border border-slate-200 p-3">
                  <input
                    value={contactsQuery}
                    onChange={(e) => setContactsQuery(e.target.value)}
                    placeholder="Buscar por telefone ou dado…"
                    className="mb-2 h-9 w-full rounded-md border border-slate-300 px-2.5 text-xs outline-none focus:border-[#2F5BFF]"
                  />
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {manualContacts.map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
                        <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleContact(c.id)} />
                        <span className="font-medium text-slate-700">{c.phone}</span>
                        <span className="text-slate-400">{Object.values(c.row_data)[0] ?? ''}</span>
                      </label>
                    ))}
                    {manualContacts.length === 0 && <p className="px-1.5 py-1 text-xs text-slate-400">Nenhum contato encontrado.</p>}
                    {manualContacts.length === 200 && (
                      <p className="px-1.5 py-1 text-xs text-slate-400">Mostrando os primeiros 200 — refine a busca pra achar outros.</p>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{selectedIds.size} selecionado(s)</p>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <NextButton disabled={!name.trim() || selectedCount === 0} onClick={goToTemplateStep} />
          </div>
        </div>
      )}

      {step === 'template' && (
        <div className="mt-6 space-y-5">
          <Field label="Delay entre mensagens (segundos)" hint="Espaço mínimo entre um envio e outro.">
            <input
              type="number"
              min={5}
              max={600}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value) || 20)}
              className="h-11 w-32 rounded-md border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
            />
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">
              Template (só aprovados aparecem) <span className="text-red-500">*</span>
            </p>
            {loadingTemplates ? (
              <p className="text-sm text-slate-500">Buscando templates aprovados…</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-amber-600">Nenhum template aprovado encontrado pra esse número.</p>
            ) : (
              <div className="space-y-2">
                {templates.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => pickTemplate(t)}
                    className={`block w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      templateName === t.name ? 'border-[#2F5BFF] bg-[#2F5BFF]/5' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-medium text-slate-800">{t.name}</span>
                    <span className="ml-2 text-xs text-slate-400">({t.language})</span>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{t.bodyText}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedTemplate && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-600">Variáveis do template</p>
                {mapping.length === 0 && <p className="text-xs text-slate-400">Esse template não tem variáveis.</p>}
                {mapping.map((m, i) => (
                  <div key={m.position} className="space-y-1">
                    <span className="font-mono text-xs text-slate-500">{`{{${m.position}}}`}</span>
                    <div className="flex gap-2">
                      <select
                        value={m.source}
                        onChange={(e) =>
                          setMapping((cur) => cur.map((x, xi) => (xi === i ? { ...x, source: e.target.value as 'column' | 'fixed' } : x)))
                        }
                        className="h-9 rounded-md border border-slate-300 bg-white px-1.5 text-xs text-slate-700"
                      >
                        <option value="column">Coluna</option>
                        <option value="fixed">Valor fixo</option>
                      </select>
                      {m.source === 'column' ? (
                        <select
                          value={m.column ?? ''}
                          onChange={(e) => setMapping((cur) => cur.map((x, xi) => (xi === i ? { ...x, column: e.target.value } : x)))}
                          className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                        >
                          <option value="">Escolha a coluna…</option>
                          <option value={PHONE_MAPPING_KEY}>Telefone do contato</option>
                          {columns.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      ) : (
                        <input
                          value={m.value ?? ''}
                          onChange={(e) => setMapping((cur) => cur.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))}
                          placeholder="Texto fixo"
                          className="h-9 flex-1 rounded-md border border-slate-300 px-2 text-xs text-slate-700"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <TemplatePreview template={selectedTemplate} mapping={mapping} sampleContact={sampleContact} />
            </div>
          )}

          <div className="flex justify-between">
            <BackButton onClick={() => setStep('contatos')} />
            <NextButton disabled={!templateName} onClick={() => setStep('revisao')} />
          </div>
        </div>
      )}

      {step === 'revisao' && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
            <p><strong>Campanha:</strong> {name}</p>
            <p><strong>Destinatários:</strong> {selectedCount} contato(s)</p>
            <p><strong>Template:</strong> {templateName}</p>
            <p><strong>Intervalo entre mensagens:</strong> {delaySeconds}s</p>
          </div>
          <p className="text-xs text-slate-400">
            A campanha nasce como rascunho — depois de criada, você inicia o disparo quando quiser na lista de campanhas.
          </p>
          <div className="flex justify-between">
            <BackButton onClick={() => setStep('template')} />
            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              className="rounded-lg bg-[#2F5BFF] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#2348d8] disabled:opacity-60"
            >
              {submitting ? 'Criando…' : 'Criar campanha'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TemplatePreview({
  template,
  mapping,
  sampleContact,
}: {
  template: ApprovedTemplate
  mapping: VariableMappingEntry[]
  sampleContact?: MassCampaignContact | null
}) {
  const rendered = React.useMemo(() => {
    let text = template.bodyText
    for (const m of mapping) {
      const columnValue = m.column === PHONE_MAPPING_KEY ? sampleContact?.phone : sampleContact?.row_data[m.column ?? '']
      const value = m.source === 'fixed' ? m.value || `valor fixo` : columnValue || `[exemplo]`
      text = text.replace(new RegExp(`\\{\\{\\s*${m.position}\\s*\\}\\}`, 'g'), value)
    }
    return text
  }, [template, mapping, sampleContact])

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-slate-600">Prévia</p>
      <div className="rounded-xl p-4" style={{ background: '#e5ddd5' }}>
        <div className="max-w-full overflow-hidden rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          <p className="whitespace-pre-wrap text-[13.5px] leading-snug text-slate-900">{rendered}</p>
        </div>
        {template.buttons.length > 0 && (
          <div className="mt-1.5 max-w-full overflow-hidden rounded-lg bg-white shadow-sm">
            {template.buttons.map((b, i) => (
              <div key={i} className="border-t border-slate-100 py-2 text-center text-[13px] font-medium text-[#00a5f4] first:border-t-0">
                {b.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Steps({ current }: { current: WizardStep }) {
  const items: { key: WizardStep; label: string }[] = [
    { key: 'contatos', label: 'Contatos' },
    { key: 'template', label: 'Template' },
    { key: 'revisao', label: 'Revisão' },
  ]
  const idx = items.findIndex((i) => i.key === current)
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      {items.map((it, i) => (
        <React.Fragment key={it.key}>
          {i > 0 && <span>›</span>}
          <span className={i <= idx ? 'font-semibold text-[#2F5BFF]' : ''}>{it.label}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

function NextButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-[#2F5BFF] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2348d8] disabled:opacity-40"
    >
      Próximo
    </button>
  )
}
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600">
      Voltar
    </button>
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

// ── Componentes genéricos (mesmo estilo das outras páginas públicas) ───────

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen w-full px-4 py-10" style={{ background: 'linear-gradient(135deg, #1E1B6B 0%, #2B2FB5 55%, #2F5BFF 100%)' }}>
      <div className={`mx-auto ${wide ? 'max-w-4xl' : 'max-w-2xl'} rounded-2xl bg-white p-8 shadow-xl`}>{children}</div>
    </div>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {hint && <span className="mb-1 block text-xs text-slate-400">{hint}</span>}
      {children}
    </label>
  )
}

function Text({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
    />
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
    >
      <option value="">Escolha…</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
