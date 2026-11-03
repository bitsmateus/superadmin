import * as React from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { Copy, Link2, MessageCircle, Plus, QrCode, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { dataHora } from '@/lib/demoStudio/format'
import { crm, demoStudio, urlDoLink, type DemoResumo, type LinkDemo, type MeuAcesso, type NovoLink } from '@/services/demoStudio'

/**
 * Links da demo (§4.4): por canal ("Site", "Bio Instagram") e personalizados por lead. Usado em
 * /demo-studio/links (todas as demos) e /demo-studio/demos/:id/links (uma demo só).
 */

/** Mensagem pronta para o WhatsApp do lead (§4.4). */
export function mensagemDoLink(l: LinkDemo, url: string, marca = 'NX Systems'): string {
  const nome = l.variables.nome?.trim()
  const empresa = l.variables.empresa?.trim()
  if (l.kind === 'PERSONAL') {
    return `Oi${nome ? ` ${nome}` : ''}, preparei um tour rápido do ${marca}${empresa ? ` para a ${empresa}` : ''}: ${url}`
  }
  return `Veja um tour rápido do ${marca}: ${url}`
}

export function PainelDeLinks({ demoId }: { demoId?: string }) {
  const [links, setLinks] = React.useState<LinkDemo[] | null>(null)
  const [acesso, setAcesso] = React.useState<MeuAcesso | null>(null)
  const [escopo, setEscopo] = React.useState<'all' | 'mine'>('all')
  const [novoAberto, setNovoAberto] = React.useState(false)
  const [qr, setQr] = React.useState<LinkDemo | null>(null)
  const vendedor = acesso?.role === 'SELLER'

  const carregar = React.useCallback(() => {
    crm.links({ demoId, scope: escopo }).then(setLinks).catch((e: Error) => { toast.error(e.message); setLinks([]) })
  }, [demoId, escopo])
  React.useEffect(() => { carregar() }, [carregar])
  React.useEffect(() => { demoStudio.eu().then(setAcesso).catch(() => undefined) }, [])

  const url = (l: LinkDemo) => urlDoLink(l.code, acesso?.publicBaseUrl)
  const copiar = async (texto: string, ok: string) => {
    await copyToClipboard(texto)
    toast.success(ok)
  }
  const alternar = async (l: LinkDemo) => {
    try {
      await crm.editarLink(l.id, { active: !l.active })
      carregar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!vendedor && (
          <div className="flex rounded-lg border border-line p-0.5">
            {([['all', 'Todos'], ['mine', 'Meus']] as const).map(([k, r]) => (
              <button key={k} type="button" onClick={() => setEscopo(k)}
                className={cn('rounded-md px-3 py-1.5 text-xs', escopo === k ? 'bg-elevate/[0.08] text-foreground' : 'text-foreground/55')}>
                {r}
              </button>
            ))}
          </div>
        )}
        <Button size="sm" className="ml-auto" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNovoAberto(true)}>Novo link</Button>
      </div>

      {links === null ? null : links.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-5 w-5" />}
          title="Nenhum link criado"
          description="Crie um link por canal (site, Instagram) ou um link personalizado para um lead: o nome e a empresa aparecem no tour e todo acesso fica atribuído a ele."
          action={<Button size="sm" onClick={() => setNovoAberto(true)}>Novo link</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs text-foreground/45">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Link</th>
                {!demoId && <th className="px-3 py-2 font-medium">Demo</th>}
                <th className="px-3 py-2 font-medium">Criado por</th>
                <th className="px-3 py-2 text-right font-medium">Views</th>
                <th className="px-3 py-2 text-right font-medium">Leads</th>
                <th className="px-3 py-2 text-right font-medium">Concluíram</th>
                <th className="px-3 py-2 font-medium">Última visita</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} className={cn('border-b border-line/60', !l.active && 'opacity-50')}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {l.kind === 'PERSONAL' ? <UserRound className="h-3.5 w-3.5 text-accent" /> : <Link2 className="h-3.5 w-3.5 text-foreground/45" />}
                      <span className="font-medium">{l.label}</span>
                      {!l.active && <Badge>Desativado</Badge>}
                    </div>
                    <div className="text-xs text-foreground/45">
                      /l/{l.code}
                      {l.lead && <> · <Link className="text-accent hover:underline" to={`/demo-studio/leads/${l.lead.id}`}>ver lead</Link></>}
                      {l.expiresAt && ` · expira ${dataHora(l.expiresAt)}`}
                    </div>
                  </td>
                  {!demoId && <td className="max-w-[12rem] truncate px-3 py-2 text-xs">{l.demo.name}</td>}
                  <td className="px-3 py-2 text-xs text-foreground/60">{l.createdBy?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.views}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.leads}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.completed}</td>
                  <td className="px-3 py-2 text-xs text-foreground/55">{l.lastSeenAt ? dataHora(l.lastSeenAt) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-0.5">
                      <button type="button" title="Copiar link" className="rounded p-1.5 text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground" onClick={() => copiar(url(l), 'Link copiado')}>
                        <Copy className="h-4 w-4" />
                      </button>
                      <button type="button" title="Copiar mensagem para WhatsApp" className="rounded p-1.5 text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground"
                        onClick={() => copiar(mensagemDoLink(l, url(l)), 'Mensagem copiada — é só colar no WhatsApp')}>
                        <MessageCircle className="h-4 w-4" />
                      </button>
                      <button type="button" title="QR Code" className="rounded p-1.5 text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground" onClick={() => setQr(l)}>
                        <QrCode className="h-4 w-4" />
                      </button>
                      <Button size="sm" variant="ghost" onClick={() => alternar(l)}>{l.active ? 'Desativar' : 'Ativar'}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NovoLinkModal aberto={novoAberto} demoId={demoId} vendedor={vendedor} baseUrl={acesso?.publicBaseUrl}
        onFechar={() => setNovoAberto(false)} onCriado={() => { setNovoAberto(false); carregar() }} />
      <QrModal link={qr} url={qr ? url(qr) : ''} onFechar={() => setQr(null)} />
    </>
  )
}

function NovoLinkModal({ aberto, demoId, vendedor, baseUrl, onFechar, onCriado }: {
  aberto: boolean
  demoId?: string
  vendedor: boolean
  baseUrl?: string | null
  onFechar: () => void
  onCriado: () => void
}) {
  const [tipo, setTipo] = React.useState<'PERSONAL' | 'CHANNEL'>('PERSONAL')
  const [demos, setDemos] = React.useState<DemoResumo[]>([])
  const [demo, setDemo] = React.useState(demoId ?? '')
  const [f, setF] = React.useState({ nome: '', empresa: '', whatsapp: '', label: '', source: '', medium: '', campaign: '' })
  const [salvando, setSalvando] = React.useState(false)
  const [criado, setCriado] = React.useState<LinkDemo | null>(null)

  React.useEffect(() => {
    if (!aberto) return
    setF({ nome: '', empresa: '', whatsapp: '', label: '', source: '', medium: '', campaign: '' })
    setTipo('PERSONAL')
    setCriado(null)
    setDemo(demoId ?? '')
    if (!demoId) demoStudio.listar().then((d) => setDemos(d.filter((x) => x.status === 'PUBLISHED'))).catch(() => undefined)
  }, [aberto, demoId])

  const criar = async () => {
    if (!demo) return toast.error('Escolha a demo')
    const dados: NovoLink = tipo === 'PERSONAL'
      ? { kind: 'PERSONAL', nome: f.nome, empresa: f.empresa, whatsapp: f.whatsapp, label: f.label || undefined }
      : { kind: 'CHANNEL', label: f.label, utm: { source: f.source, medium: f.medium, campaign: f.campaign } }
    setSalvando(true)
    try {
      setCriado(await crm.criarLink(demo, dados))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const set = (a: Partial<typeof f>) => setF((v) => ({ ...v, ...a }))
  const url = criado ? urlDoLink(criado.code, baseUrl) : ''

  return (
    <Modal open={aberto} onClose={criado ? onCriado : onFechar} title={criado ? 'Link pronto' : 'Novo link'}
      footer={criado ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" leftIcon={<Copy className="h-4 w-4" />} onClick={async () => { await copyToClipboard(url); toast.success('Link copiado') }}>Copiar link</Button>
          <Button leftIcon={<MessageCircle className="h-4 w-4" />} onClick={async () => { await copyToClipboard(mensagemDoLink(criado, url)); toast.success('Mensagem copiada'); onCriado() }}>
            Copiar mensagem para WhatsApp
          </Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button loading={salvando} onClick={criar}>Criar link</Button>
        </div>
      )}>
      {criado ? (
        <div className="space-y-3 text-sm">
          <p className="break-all rounded-lg border border-line px-3 py-2 font-mono text-xs text-foreground">{url}</p>
          <p className="rounded-lg border border-line px-3 py-2 text-foreground/80">{mensagemDoLink(criado, url)}</p>
          {criado.kind === 'PERSONAL' && <p className="text-xs text-foreground/50">O lead já foi cadastrado com você como responsável. Toda visita por este link fica atribuída a ele.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {!vendedor && (
            <div className="flex rounded-lg border border-line p-0.5">
              {([['PERSONAL', 'Personalizado para um lead'], ['CHANNEL', 'Por canal']] as const).map(([k, r]) => (
                <button key={k} type="button" onClick={() => setTipo(k)}
                  className={cn('flex-1 rounded-md px-3 py-1.5 text-sm', tipo === k ? 'bg-elevate/[0.08] text-foreground' : 'text-foreground/55')}>
                  {r}
                </button>
              ))}
            </div>
          )}
          {!demoId && (
            <label className="block text-xs font-medium text-foreground/70">
              Demo
              <select className="mt-1.5 h-9 w-full rounded-lg border border-line bg-transparent px-2 text-sm" value={demo} onChange={(e) => setDemo(e.target.value)}>
                <option value="">Escolha…</option>
                {demos.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
          {tipo === 'PERSONAL' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Nome do lead" value={f.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="Ana" autoFocus />
              <Input label="Empresa" value={f.empresa} onChange={(e) => set({ empresa: e.target.value })} placeholder="Pedal Bikes" />
              <Input label="WhatsApp" value={f.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="(48) 99999-0000" />
              <Input label="Nome do link (opcional)" value={f.label} onChange={(e) => set({ label: e.target.value })} placeholder="Lead · Ana / Pedal Bikes" />
              <p className="text-xs text-foreground/45 sm:col-span-2">O tour mostra "Preparamos este tour para a {f.empresa || '{empresa}'}" e os textos com {'{{nome}}'}/{'{{empresa}}'} saem preenchidos.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <Input label="Nome do link" value={f.label} onChange={(e) => set({ label: e.target.value })} placeholder="Site, Bio Instagram, Campanha Black" autoFocus />
              </div>
              <Input label="utm_source" value={f.source} onChange={(e) => set({ source: e.target.value })} placeholder="instagram" />
              <Input label="utm_medium" value={f.medium} onChange={(e) => set({ medium: e.target.value })} placeholder="bio" />
              <Input label="utm_campaign" value={f.campaign} onChange={(e) => set({ campaign: e.target.value })} placeholder="black-friday" />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/** QR Code gerado no navegador (§4.4: sem serviço externo). */
function QrModal({ link, url, onFechar }: { link: LinkDemo | null; url: string; onFechar: () => void }) {
  const [dataUrl, setDataUrl] = React.useState('')
  React.useEffect(() => {
    if (!link) return
    QRCode.toDataURL(url, { width: 512, margin: 2, color: { dark: '#0f1b2d', light: '#ffffff' } }).then(setDataUrl).catch(() => setDataUrl(''))
  }, [link, url])
  return (
    <Modal open={!!link} onClose={onFechar} size="sm" title={link?.label ?? 'QR Code'}>
      <div className="flex flex-col items-center gap-3">
        {dataUrl && <img src={dataUrl} alt={`QR Code de ${url}`} className="h-64 w-64 rounded-lg border border-line bg-white p-2" />}
        <p className="break-all text-center font-mono text-xs text-foreground/55">{url}</p>
        {dataUrl && (
          <a href={dataUrl} download={`qr-${link?.code}.png`} className="text-sm text-accent hover:underline">Baixar PNG</a>
        )}
      </div>
    </Modal>
  )
}
