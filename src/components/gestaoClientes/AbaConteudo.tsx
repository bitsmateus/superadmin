import * as React from 'react'
import { AtSign, ExternalLink, Link2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { num, useCarregar, Estado, Painel, Vazio } from '@/components/trafego/format'
import { quandoFoi } from '@/components/gestaoClientes/AbaTrafego'
import { PainelIaConteudo } from '@/components/gestaoClientes/IaDoCliente'
import { gcIa, type GcPostInstagram } from '@/services/gcTrafego'

type Ordem = 'alcance' | 'engajamento' | 'salvos' | 'compartilhamentos' | 'recentes'
const ORDENS: { valor: Ordem; label: string }[] = [
  { valor: 'alcance', label: 'Mais alcance' },
  { valor: 'engajamento', label: 'Mais engajamento' },
  { valor: 'salvos', label: 'Mais salvos' },
  { valor: 'compartilhamentos', label: 'Mais compartilhados' },
  { valor: 'recentes', label: 'Mais recentes' },
]

function ordenar(posts: GcPostInstagram[], o: Ordem): GcPostInstagram[] {
  const v = (p: GcPostInstagram): number => {
    if (o === 'recentes') return p.publicadoEm ? Date.parse(p.publicadoEm) : 0
    if (o === 'engajamento') return p.engajamento ?? -1
    return (p[o] as number | null) ?? -1
  }
  return [...posts].sort((a, b) => v(b) - v(a))
}

const TIPO_POST: Record<string, string> = { reels: 'Reels', feed: 'Post', story: 'Story', carousel_album: 'Carrossel', video: 'Vídeo', image: 'Imagem' }

function ModalInstagram({ aberto, onFechar, clienteId, onMudou }: { aberto: boolean; onFechar: () => void; clienteId: string; onMudou: () => void }) {
  const [token, setToken] = React.useState('')
  const [igId, setIgId] = React.useState('')
  const [perfis, setPerfis] = React.useState<{ igUserId: string; username: string; pagina: string }[] | null>(null)
  const [buscando, setBuscando] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)
  const [filtro, setFiltro] = React.useState('')

  const buscar = async () => {
    setBuscando(true)
    try {
      setPerfis((await gcIa.perfisDisponiveis(token)).perfis)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }
  const vincular = async (id: string) => {
    setSalvando(true)
    try {
      const r = await gcIa.vincularInstagram(clienteId, id, token)
      toast.success(`@${r.username} vinculado. Puxando os posts…`)
      onMudou()
      onFechar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  const visiveis = (perfis ?? []).filter((p) => `${p.username} ${p.pagina}`.toLowerCase().includes(filtro.trim().toLowerCase()))

  return (
    <Modal open={aberto} onClose={onFechar} title="Vincular Instagram" description="Conta profissional (empresa ou criador) ligada a uma página do Facebook que o BM da agência administra.">
      <div className="space-y-4">
        <Input
          label="Token de acesso (opcional)"
          hint="Em branco usa o token da NX no servidor."
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Escolher entre os perfis que o token enxerga</p>
            <Button size="sm" variant="secondary" loading={buscando} leftIcon={<Search className="h-3.5 w-3.5" />} onClick={() => void buscar()}>
              Buscar perfis
            </Button>
          </div>
          {perfis && (
            <div className="mt-3 space-y-2">
              {perfis.length > 6 && <Input placeholder="Filtrar" value={filtro} onChange={(e) => setFiltro(e.target.value)} />}
              {visiveis.length === 0 ? (
                <p className="text-xs text-foreground/50">Nenhum perfil encontrado com esse token.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {visiveis.map((p) => (
                    <li key={p.igUserId}>
                      <button
                        type="button"
                        disabled={salvando}
                        onClick={() => void vincular(p.igUserId)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-elevate/[0.05]"
                      >
                        <AtSign className="h-3.5 w-3.5 text-foreground/40" />
                        <span className="font-medium">{p.username || p.igUserId}</span>
                        <span className="truncate text-xs text-foreground/45">{p.pagina}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Input label="Ou informe o ID do Instagram profissional" placeholder="ex.: 17841400000000000" value={igId} onChange={(e) => setIgId(e.target.value)} containerClassName="flex-1" />
          <Button loading={salvando} disabled={!igId.trim()} onClick={() => void vincular(igId.trim())}>Vincular</Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Aba Conteúdo do cliente: o Instagram (o que mais deu alcance/engajamento) e a IA que transforma
 * isso em roteiros de Reels e artes prontos — com botão pra mandar direto pro kanban de Social media.
 */
export function AbaConteudo({ clienteId }: { clienteId: string }) {
  const [dias, setDias] = React.useState(90)
  const { dados, erro, carregando, recarregar } = useCarregar(() => gcIa.instagram(clienteId, dias), [clienteId, dias])
  const [ordem, setOrdem] = React.useState<Ordem>('alcance')
  const [modal, setModal] = React.useState(false)
  const [sincronizando, setSincronizando] = React.useState(false)

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      const r = await gcIa.sincronizarInstagram(clienteId)
      if (r.ok) toast.success(`${r.posts} posts atualizados`)
      else toast.error(r.erro ?? 'Falha ao ler o Instagram')
      recarregar()
    } finally {
      setSincronizando(false)
    }
  }
  const desvincular = async () => {
    if (!window.confirm('Desvincular o Instagram deste cliente? Os posts já lidos continuam guardados.')) return
    await gcIa.desvincularInstagram(clienteId)
    recarregar()
  }

  const conta = dados?.conta
  const posts = dados?.posts ?? []
  const somaAlcance = posts.reduce((s, p) => s + (p.alcance ?? 0), 0)
  const engs = posts.map((p) => p.engajamento).filter((x): x is number => x != null)
  const engMedio = engs.length ? engs.reduce((a, b) => a + b, 0) / engs.length : null
  const melhorTipo = (() => {
    const por = new Map<string, { n: number; alcance: number }>()
    for (const p of posts) {
      const t = TIPO_POST[p.produto] ?? TIPO_POST[p.tipo] ?? (p.produto || p.tipo)
      const x = por.get(t) ?? { n: 0, alcance: 0 }
      por.set(t, { n: x.n + 1, alcance: x.alcance + (p.alcance ?? 0) })
    }
    return [...por.entries()].map(([t, x]) => ({ t, media: x.alcance / x.n, n: x.n })).sort((a, b) => b.media - a.media)
  })()

  return (
    <div className="space-y-4">
      <Estado carregando={carregando && !dados} erro={erro}>
        {!conta ? (
          <Painel>
            <div className="mx-auto max-w-md py-6 text-center">
              <AtSign className="mx-auto h-8 w-8 text-foreground/30" />
              <p className="mt-3 text-sm font-medium">Instagram não vinculado</p>
              <p className="mt-1 text-sm text-foreground/55">
                Vincule o Instagram profissional do cliente pra ver quais posts dão mais alcance e engajamento, e gerar roteiros e artes
                em cima do que funciona. Dá pra gerar ideias mesmo sem vincular (a IA usa o briefing e os anúncios).
              </p>
              <Button className="mt-4" leftIcon={<Link2 className="h-4 w-4" />} onClick={() => setModal(true)}>Vincular Instagram</Button>
            </div>
          </Painel>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-lg bg-elevate/[0.04] px-3 py-1.5 text-sm font-medium">
                <AtSign className="h-4 w-4 text-accent" /> {conta.username || conta.ig_user_id}
                {conta.seguidores != null && <span className="font-normal text-foreground/50">· {num(conta.seguidores)} seguidores</span>}
              </span>
              <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="h-8 rounded-md border border-line bg-surface px-2 text-xs">
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
                <option value={180}>Últimos 180 dias</option>
              </select>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-foreground/45">atualizado {quandoFoi(conta.ultimo_sync_em)}</span>
                <Button size="sm" variant="secondary" loading={sincronizando} leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void sincronizar()}>Atualizar</Button>
                <Button size="sm" variant="ghost" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void desvincular()}>Desvincular</Button>
              </div>
            </div>
            {conta.ultimo_erro && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">Erro ao ler o Instagram: {conta.ultimo_erro}</p>}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-line bg-card px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">Posts no período</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{posts.length}</p>
              </div>
              <div className="rounded-xl border border-line bg-card px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">Alcance médio por post</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{posts.length ? num(somaAlcance / posts.length) : '—'}</p>
              </div>
              <div className="rounded-xl border border-line bg-card px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">Engajamento médio</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{engMedio == null ? '—' : `${engMedio.toFixed(1).replace('.', ',')}%`}</p>
                <p className="text-xs text-foreground/45">interações ÷ alcance</p>
              </div>
              <div className="rounded-xl border border-line bg-card px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">Formato que mais alcança</p>
                <p className="mt-1 text-xl font-semibold">{melhorTipo[0]?.t ?? '—'}</p>
                {melhorTipo[0] && <p className="text-xs text-foreground/45">{num(melhorTipo[0].media)} de alcance médio ({melhorTipo[0].n} posts)</p>}
              </div>
            </div>

            <Painel
              title="Conteúdos"
              action={
                <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className="h-8 rounded-md border border-line bg-surface px-2 text-xs">
                  {ORDENS.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                </select>
              }
            >
              {posts.length === 0 ? (
                <Vazio>Nenhum post no período (ou o Instagram ainda está sendo lido).</Vazio>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  {ordenar(posts, ordem).slice(0, 20).map((p, i) => (
                    <article key={p.id} className="overflow-hidden rounded-lg border border-line">
                      <a href={p.permalink} target="_blank" rel="noreferrer" className="relative block aspect-[4/5] bg-elevate/[0.04]">
                        {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" /> : (
                          <div className="flex h-full items-center justify-center text-xs text-foreground/35">sem prévia</div>
                        )}
                        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                          {TIPO_POST[p.produto] ?? TIPO_POST[p.tipo] ?? p.tipo}
                        </span>
                        {i < 3 && ordem !== 'recentes' && (
                          <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">top {i + 1}</span>
                        )}
                        <ExternalLink className="absolute bottom-2 right-2 h-3.5 w-3.5 text-white drop-shadow" />
                      </a>
                      <div className="space-y-1 p-2.5">
                        <p className="line-clamp-2 text-xs text-foreground/75" title={p.legenda}>{p.legenda || 'sem legenda'}</p>
                        <dl className="grid grid-cols-2 gap-x-2 text-[11px]">
                          <dt className="text-foreground/45">Alcance</dt><dd className="text-right tabular-nums">{num(p.alcance)}</dd>
                          {p.visualizacoes != null && <><dt className="text-foreground/45">Views</dt><dd className="text-right tabular-nums">{num(p.visualizacoes)}</dd></>}
                          <dt className="text-foreground/45">Engaj.</dt>
                          <dd className={cn('text-right tabular-nums', engMedio != null && p.engajamento != null && p.engajamento > engMedio * 1.3 && 'font-semibold text-emerald-600 dark:text-emerald-400')}>
                            {p.engajamento == null ? '—' : `${p.engajamento.toFixed(1).replace('.', ',')}%`}
                          </dd>
                          <dt className="text-foreground/45">Salvos</dt><dd className="text-right tabular-nums">{num(p.salvos)}</dd>
                          <dt className="text-foreground/45">Compart.</dt><dd className="text-right tabular-nums">{num(p.compartilhamentos)}</dd>
                        </dl>
                        <p className="text-[10px] text-foreground/40">{p.publicadoEm ? new Date(p.publicadoEm).toLocaleDateString('pt-BR') : ''}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Painel>
          </>
        )}
      </Estado>

      <PainelIaConteudo clienteId={clienteId} />

      <ModalInstagram aberto={modal} onFechar={() => setModal(false)} clienteId={clienteId} onMudou={recarregar} />
    </div>
  )
}
