import * as React from 'react'
import { Copy, ExternalLink, Pencil, Plus, Send, Trash2, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/hooks/useAuth'
import { canManageUsers } from '@/services/supabase'
import { extractErrorMessage } from '@/api/client'
import { copyToClipboard } from '@/lib/clipboard'
import { cn, formatDateShort, formatDateTimeShort } from '@/lib/utils'
import {
  comunicadosApi,
  linkNovidades,
  TIPO_LABEL,
  type ComunicadoPost,
  type ContatoComunicado,
  type DisparoComunicado,
  type ItemDisparo,
  type OrigemContato,
  type TemplateComunicado,
  type TipoComunicado,
} from '@/api/comunicados'

/**
 * Comunicados aos clientes: as atualizações da plataforma (o changelog que o cliente vê em /novidades),
 * a base de contatos (notificador de Canais + telefone da Visão Geral, sem duplicado) e o disparo pelo
 * número da API Oficial do Suporte — que só manda template aprovado na Meta.
 */
export function ComunicadosPage() {
  const [aba, setAba] = React.useState('atualizacoes')
  const copiarLink = async () => {
    const ok = await copyToClipboard(linkNovidades())
    if (ok) toast.success('Link da página pública copiado')
    else toast.error('Falha ao copiar')
  }

  return (
    <>
      <TopBar
        title="Comunicados"
        subtitle="Atualizações da plataforma e avisos aos clientes"
        rightSlot={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={copiarLink}>
              Copiar link público
            </Button>
            <a href="/novidades" target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>
                Abrir
              </Button>
            </a>
          </div>
        }
      />
      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8 space-y-5">
        <Tabs
          value={aba}
          onChange={setAba}
          items={[
            { value: 'atualizacoes', label: 'Atualizações' },
            { value: 'contatos', label: 'Contatos' },
            { value: 'disparos', label: 'Disparos' },
          ]}
        />
        {aba === 'atualizacoes' && <AbaAtualizacoes />}
        {aba === 'contatos' && <AbaContatos />}
        {aba === 'disparos' && <AbaDisparos />}
      </div>
    </>
  )
}

/** Carrega uma lista da API e devolve [dados, recarregar]. */
function useCarregar<T>(fn: () => Promise<T>, inicial: T): [T, () => void, boolean] {
  const [dados, setDados] = React.useState<T>(inicial)
  const [carregando, setCarregando] = React.useState(true)
  const recarregar = React.useCallback(() => {
    fn()
      .then(setDados)
      .catch((e) => toast.error(extractErrorMessage(e, 'Falha ao carregar')))
      .finally(() => setCarregando(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useEffect(recarregar, [recarregar])
  return [dados, recarregar, carregando]
}

const TIPO_TONE: Record<TipoComunicado, 'success' | 'info' | 'warning' | 'neutral'> = {
  novidade: 'success',
  melhoria: 'info',
  correcao: 'neutral',
  aviso: 'warning',
}

// ── Atualizações ──────────────────────────────────────────────────────────────

function AbaAtualizacoes() {
  const [posts, recarregar, carregando] = useCarregar(comunicadosApi.posts, [] as ComunicadoPost[])
  const [editando, setEditando] = React.useState<ComunicadoPost | 'novo' | null>(null)

  const alternarPublicado = async (p: ComunicadoPost) => {
    try {
      await comunicadosApi.editarPost(p.id, { publicado: !p.publicado_em })
      toast.success(p.publicado_em ? 'Voltou pra rascunho' : 'Publicado na página pública')
      recarregar()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Falha ao salvar'))
    }
  }

  const excluir = async (p: ComunicadoPost) => {
    if (!window.confirm(`Excluir "${p.titulo}"?`)) return
    try {
      await comunicadosApi.excluirPost(p.id)
      recarregar()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Falha ao excluir'))
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground/60">
          O que estiver publicado aparece em <span className="font-medium text-foreground">/novidades</span>, sem login.
        </p>
        <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditando('novo')}>
          Nova atualização
        </Button>
      </div>

      {!carregando && posts.length === 0 ? (
        <EmptyState title="Nenhuma atualização ainda" description="Cadastre o que mudou na plataforma e publique." />
      ) : (
        <ul className="space-y-2">
          {posts.map((p) => (
            <li key={p.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TIPO_TONE[p.tipo] ?? 'neutral'}>{TIPO_LABEL[p.tipo] ?? p.tipo}</Badge>
                    {p.publicado_em ? (
                      <Badge tone="success" dot>Publicado {formatDateShort(p.publicado_em)}</Badge>
                    ) : (
                      <Badge tone="neutral">Rascunho</Badge>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-foreground">{p.titulo}</h3>
                  {p.corpo && <p className="whitespace-pre-wrap text-sm text-foreground/70">{p.corpo}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant={p.publicado_em ? 'outline' : 'primary'} onClick={() => alternarPublicado(p)}>
                    {p.publicado_em ? 'Despublicar' : 'Publicar'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditando(p)} aria-label="Editar">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => excluir(p)} aria-label="Excluir">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editando && (
        <EditorPost
          post={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            recarregar()
          }}
        />
      )}
    </section>
  )
}

function EditorPost({ post, onClose, onSalvo }: { post: ComunicadoPost | null; onClose: () => void; onSalvo: () => void }) {
  const [titulo, setTitulo] = React.useState(post?.titulo ?? '')
  const [corpo, setCorpo] = React.useState(post?.corpo ?? '')
  const [tipo, setTipo] = React.useState<TipoComunicado>(post?.tipo ?? 'novidade')
  const [salvando, setSalvando] = React.useState(false)

  const salvar = async (publicar: boolean) => {
    if (!titulo.trim()) {
      toast.error('Informe o título')
      return
    }
    setSalvando(true)
    try {
      if (post) await comunicadosApi.editarPost(post.id, { titulo, corpo, tipo, ...(publicar ? { publicado: true } : {}) })
      else await comunicadosApi.criarPost({ titulo, corpo, tipo, publicar })
      toast.success(publicar ? 'Publicado' : 'Salvo')
      onSalvo()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Falha ao salvar'))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={post ? 'Editar atualização' : 'Nova atualização'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="outline" loading={salvando} onClick={() => salvar(false)}>Salvar</Button>
          {!post?.publicado_em && (
            <Button loading={salvando} onClick={() => salvar(true)}>Salvar e publicar</Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Novo filtro por etiqueta no Kanban" />
        <Select
          label="Tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoComunicado)}
          options={Object.entries(TIPO_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Textarea label="O que mudou" rows={7} value={corpo} onChange={(e) => setCorpo(e.target.value)} placeholder="Explique em linguagem de cliente o que mudou e como usar." />
      </div>
    </Modal>
  )
}

// ── Contatos ──────────────────────────────────────────────────────────────────

const ORIGEM_LABEL: Record<OrigemContato, string> = {
  canais: 'Notificador Canais',
  visao_geral: 'Visão Geral',
  manual: 'Avulso',
}

function AbaContatos() {
  const [contatos, recarregar, carregando] = useCarregar(comunicadosApi.contatos, [] as ContatoComunicado[])
  const [busca, setBusca] = React.useState('')
  const [filtro, setFiltro] = React.useState<'todos' | 'incluidos' | 'fora' | OrigemContato>('todos')
  const [novoAberto, setNovoAberto] = React.useState(false)

  const visiveis = React.useMemo(() => {
    const b = busca.trim().toLowerCase()
    return contatos.filter((c) => {
      if (filtro === 'incluidos' && !c.incluido) return false
      if (filtro === 'fora' && c.incluido) return false
      if ((filtro === 'canais' || filtro === 'visao_geral' || filtro === 'manual') && !c.origens.includes(filtro)) return false
      if (!b) return true
      return (
        c.numero.includes(b.replace(/\D/g, '') || '¬') ||
        c.nome.toLowerCase().includes(b) ||
        c.clientes.some((x) => x.nome.toLowerCase().includes(b))
      )
    })
  }, [contatos, busca, filtro])

  const incluidos = contatos.filter((c) => c.incluido).length

  const marcar = async (c: ContatoComunicado, incluido: boolean) => {
    try {
      await comunicadosApi.marcarContato(c.numero, incluido)
      recarregar()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Falha ao salvar'))
    }
  }

  const remover = async (c: ContatoComunicado) => {
    try {
      await comunicadosApi.removerContato(c.numero)
      recarregar()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Falha ao remover'))
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input containerClassName="max-w-xs" placeholder="Buscar cliente, nome ou número" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Select
          className="w-48"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as typeof filtro)}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'incluidos', label: 'Incluídos no disparo' },
            { value: 'fora', label: 'Fora do disparo' },
            { value: 'canais', label: 'Origem: Notificador Canais' },
            { value: 'visao_geral', label: 'Origem: Visão Geral' },
            { value: 'manual', label: 'Origem: Avulso' },
          ]}
        />
        <span className="text-sm text-foreground/60">
          {incluidos} de {contatos.length} recebem o disparo
        </span>
        <Button className="ml-auto" size="sm" variant="outline" leftIcon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setNovoAberto(true)}>
          Contato avulso
        </Button>
      </div>

      {!carregando && visiveis.length === 0 ? (
        <EmptyState title="Nenhum contato" description="Os números vêm do notificador da tela de Canais e da Visão Geral de cada cliente." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-foreground/50">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Nome no envio</th>
                <th className="px-3 py-2 font-medium">Número</th>
                <th className="px-3 py-2 font-medium">Origem</th>
                <th className="px-3 py-2 font-medium text-right">Recebe disparo</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => (
                <tr key={c.numero} className={cn('border-b border-line last:border-0', !c.incluido && 'opacity-60')}>
                  <td className="px-3 py-2 text-foreground">
                    {c.clientes.length ? c.clientes.map((x) => x.nome).join(', ') : <span className="text-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-2 text-foreground/80">{c.nome || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-foreground/80">
                    {c.numero}
                    {c.invalido && <Badge tone="danger" className="ml-2">número inválido</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.origens.map((o) => (
                        <Badge key={o} tone={o === 'canais' ? 'info' : o === 'manual' ? 'warning' : 'neutral'}>
                          {ORIGEM_LABEL[o]}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <label className={cn('inline-flex items-center gap-1.5', c.invalido ? 'cursor-not-allowed' : 'cursor-pointer')}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-line accent-accent"
                          checked={c.incluido}
                          disabled={c.invalido}
                          onChange={(e) => marcar(c, e.target.checked)}
                        />
                        <span className="text-xs text-foreground/70">{c.incluido ? 'Sim' : 'Não'}</span>
                      </label>
                      {c.manual && c.origens.length === 1 && (
                        <button type="button" title="Remover contato avulso" onClick={() => remover(c)} className="text-foreground/40 hover:text-danger">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {novoAberto && (
        <NovoContato
          onClose={() => setNovoAberto(false)}
          onSalvo={() => {
            setNovoAberto(false)
            recarregar()
          }}
        />
      )}
    </section>
  )
}

function NovoContato({ onClose, onSalvo }: { onClose: () => void; onSalvo: () => void }) {
  const [nome, setNome] = React.useState('')
  const [numero, setNumero] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const salvar = async () => {
    setSalvando(true)
    try {
      await comunicadosApi.adicionarContato(numero, nome)
      onSalvo()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Falha ao salvar'))
    } finally {
      setSalvando(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Contato avulso"
      description="Pra quem não está no cadastro de clientes mas deve receber os comunicados."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={salvando} onClick={salvar}>Adicionar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Nome (vai no {{1}} do template)" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Input label="WhatsApp (DDD + número)" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="48 99999-9999" />
      </div>
    </Modal>
  )
}

// ── Disparos ──────────────────────────────────────────────────────────────────

const STATUS_DISPARO: Record<DisparoComunicado['status'], { label: string; tone: 'info' | 'success' | 'neutral' }> = {
  enviando: { label: 'Enviando', tone: 'info' },
  concluido: { label: 'Concluído', tone: 'success' },
  cancelado: { label: 'Cancelado', tone: 'neutral' },
}

function previa(t: TemplateComunicado, valores: { nome: string; link: string; texto: string }): string {
  return t.variaveis.reduce((s, v, i) => s.split(`{{${i + 1}}}`).join(valores[v] || `[${v}]`), t.corpo)
}

function AbaDisparos() {
  const { profile } = useAuth()
  const isAdmin = canManageUsers(profile?.role)
  const [templates] = useCarregar(comunicadosApi.templates, [] as TemplateComunicado[])
  const [contatos] = useCarregar(comunicadosApi.contatos, [] as ContatoComunicado[])
  const [disparos, recarregarDisparos] = useCarregar(comunicadosApi.disparos, [] as DisparoComunicado[])
  const [templateId, setTemplateId] = React.useState('atualizacoes_semana')
  const [link, setLink] = React.useState(linkNovidades())
  const [texto, setTexto] = React.useState('')
  const [numeroTeste, setNumeroTeste] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const [aberto, setAberto] = React.useState<string | null>(null)

  const t = templates.find((x) => x.id === templateId)
  const alvo = contatos.filter((c) => c.incluido && !c.invalido).length
  const emAndamento = disparos.some((d) => d.status === 'enviando')

  // Enquanto tem disparo saindo, atualiza o progresso sozinho.
  React.useEffect(() => {
    if (!emAndamento) return
    const id = window.setInterval(recarregarDisparos, 5000)
    return () => window.clearInterval(id)
  }, [emAndamento, recarregarDisparos])

  const extras = () => ({
    ...(t?.variaveis.includes('link') ? { link } : {}),
    ...(t?.variaveis.includes('texto') ? { texto } : {}),
  })

  const testar = async () => {
    if (!t) return
    setEnviando(true)
    try {
      await comunicadosApi.teste({ numero: numeroTeste, template: t.id, ...extras() })
      toast.success('Teste enviado — confira o WhatsApp')
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Falha no teste'))
    } finally {
      setEnviando(false)
    }
  }

  const disparar = async () => {
    if (!t) return
    if (!window.confirm(`Enviar "${t.titulo}" pra ${alvo} contato(s)?`)) return
    setEnviando(true)
    try {
      const r = await comunicadosApi.disparar({ template: t.id, ...extras() })
      toast.success(`Disparo iniciado pra ${r.total} contato(s)`)
      recarregarDisparos()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Falha ao disparar'))
    } finally {
      setEnviando(false)
    }
  }

  const cancelar = async (d: DisparoComunicado) => {
    try {
      await comunicadosApi.cancelar(d.id)
      recarregarDisparos()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Falha ao cancelar'))
    }
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3 rounded-xl border border-line bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Novo disparo</h3>
        <Select
          label="Template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          options={templates.map((x) => ({ value: x.id, label: `${x.titulo} (${x.nome})` }))}
        />
        {t?.variaveis.includes('link') && <Input label="Link (variável {{2}})" value={link} onChange={(e) => setLink(e.target.value)} />}
        {t?.variaveis.includes('texto') && (
          <Textarea
            label="Texto do aviso (variável {{2}})"
            hint="A Meta não aceita quebra de linha dentro da variável — vira espaço no envio."
            rows={4}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        )}
        {t && (
          <div className="rounded-lg border border-line bg-elevate/[0.03] p-3">
            <p className="mb-1 text-xs font-medium text-foreground/50">Prévia (com o nome do primeiro contato)</p>
            <p className="whitespace-pre-wrap text-sm text-foreground/80">
              {previa(t, { nome: contatos.find((c) => c.incluido)?.nome ?? '', link, texto })}
            </p>
          </div>
        )}
        <p className="text-xs text-foreground/50">
          Sai pelo número da API Oficial do Suporte. O template precisa estar aprovado na Meta com o nome exato entre parênteses.
        </p>

        {isAdmin ? (
          <>
            <div className="flex items-end gap-2">
              <Input label="Enviar teste para" placeholder="48 99999-9999" value={numeroTeste} onChange={(e) => setNumeroTeste(e.target.value)} />
              <Button variant="outline" loading={enviando} onClick={testar} disabled={!numeroTeste.trim()}>
                Testar
              </Button>
            </div>
            <Button
              className="w-full"
              leftIcon={<Send className="h-4 w-4" />}
              loading={enviando}
              disabled={!t || alvo === 0 || emAndamento}
              onClick={disparar}
            >
              {emAndamento ? 'Tem um disparo em andamento' : `Disparar pra ${alvo} contato(s)`}
            </Button>
          </>
        ) : (
          <p className="text-sm text-foreground/60">Só administrador pode disparar.</p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Histórico</h3>
        {disparos.length === 0 ? (
          <EmptyState title="Nenhum disparo ainda" />
        ) : (
          disparos.map((d) => {
            const s = STATUS_DISPARO[d.status] ?? STATUS_DISPARO.concluido
            return (
              <div key={d.id} className="rounded-xl border border-line bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {templates.find((x) => x.id === d.template)?.titulo ?? d.template}
                      </span>
                      <Badge tone={s.tone} dot={d.status === 'enviando'}>{s.label}</Badge>
                    </div>
                    <p className="text-xs text-foreground/50">
                      {formatDateTimeShort(d.created_at)} · {d.criado_por || '—'} · {d.enviados}/{d.total} enviados
                      {d.falhas > 0 && <span className="text-danger"> · {d.falhas} falha(s)</span>}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {isAdmin && d.status === 'enviando' && (
                      <Button size="sm" variant="danger" onClick={() => cancelar(d)}>Cancelar</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setAberto(aberto === d.id ? null : d.id)}>
                      {aberto === d.id ? 'Fechar' : 'Detalhes'}
                    </Button>
                  </div>
                </div>
                {aberto === d.id && <ItensDisparo disparo={d} />}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

const STATUS_ITEM: Record<ItemDisparo['status'], { label: string; tone: 'success' | 'danger' | 'neutral' | 'info' }> = {
  pendente: { label: 'Na fila', tone: 'info' },
  enviado: { label: 'Enviado', tone: 'success' },
  falhou: { label: 'Falhou', tone: 'danger' },
  cancelado: { label: 'Cancelado', tone: 'neutral' },
}

function ItensDisparo({ disparo }: { disparo: DisparoComunicado }) {
  const [itens, setItens] = React.useState<ItemDisparo[]>([])
  // Recarrega quando o progresso do disparo muda (o histórico se atualiza sozinho enquanto envia).
  React.useEffect(() => {
    comunicadosApi.itens(disparo.id).then(setItens).catch(() => undefined)
  }, [disparo.id, disparo.enviados, disparo.falhas, disparo.status])
  return (
    <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto border-t border-line pt-2">
      {itens.map((i) => {
        const s = STATUS_ITEM[i.status] ?? STATUS_ITEM.pendente
        return (
          <li key={i.id} className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={s.tone}>{s.label}</Badge>
            <span className="text-foreground/80">{i.nome || '—'}</span>
            <span className="font-mono text-foreground/50">{i.numero}</span>
            {i.detalhe && <span className="w-full text-danger/80">{i.detalhe}</span>}
          </li>
        )
      })}
    </ul>
  )
}
