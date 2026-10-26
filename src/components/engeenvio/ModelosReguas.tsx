import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Mail, MessageCircle, Plus, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { engeApi, type EngeModelo, type EngeRegua, type EtapaRegua, type ModeloDados } from '@/api/engeEnvio'
import { cn } from '@/lib/utils'
import { descreverEtapa, novaEtapa } from '@/lib/engeEnvio'
import { Cartao, useEngeConfig, useModelos, useReguas } from './shared'
import { ReguaEditor, ReguaLinhaTempo } from './ReguaEditor'

const VARIAVEIS = ['{sindico}', '{empreendimento}', '{item}', '{prazo}', '{vencimento}', '{dias}', '{construtora}', '{link}']

/**
 * Aba "Modelos e réguas": os textos de cada tipo de aviso (e-mail + WhatsApp) e as réguas de
 * envio (quando sai cada aviso, com qual modelo, por quais canais, se repete) que o cadastro do
 * empreendimento usa pra agendar tudo de uma vez.
 */
export function ModelosReguas() {
  const [secao, setSecao] = React.useState<'modelos' | 'reguas'>('modelos')
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-line bg-card p-1">
        {(
          [
            ['modelos', 'Modelos de mensagem'],
            ['reguas', 'Réguas de envio'],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSecao(id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              secao === id ? 'bg-accent/15 text-accent' : 'text-foreground/60 hover:text-foreground',
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {secao === 'modelos' ? <Modelos /> : <Reguas />}
    </div>
  )
}

function Variaveis() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {VARIAVEIS.map((v) => (
        <code key={v} className="rounded border border-line bg-elevate/[0.04] px-1.5 py-0.5 text-xs text-foreground/80">
          {v}
        </code>
      ))}
    </div>
  )
}

/** Lista à esquerda (com "Padrão" marcado) + editor à direita. */
function Lista<T extends { id: string; nome: string; padrao: boolean }>({
  itens,
  selecionado,
  onSelecionar,
  onNovo,
  rotuloNovo,
  detalhe,
}: {
  itens: T[]
  selecionado: string | null
  onSelecionar: (id: string) => void
  onNovo: () => void
  rotuloNovo: string
  detalhe: (item: T) => string
}) {
  return (
    <Cartao titulo={`${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`} acao={<Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={onNovo}>{rotuloNovo}</Button>}>
      <ul className="divide-y divide-line">
        {itens.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onSelecionar(it.id)}
              className={cn(
                'flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors',
                selecionado === it.id ? 'bg-accent/[0.08]' : 'hover:bg-elevate/[0.03]',
              )}
            >
              <span className="flex items-center gap-2">
                <span className={cn('text-sm font-medium', selecionado === it.id ? 'text-accent' : 'text-foreground')}>{it.nome}</span>
                {it.padrao && <Badge tone="info">Padrão</Badge>}
              </span>
              <span className="line-clamp-2 text-xs text-foreground/50">{detalhe(it)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Cartao>
  )
}

function Acoes({
  ehNovo,
  padrao,
  salvando,
  onSalvar,
  onPadrao,
  onDuplicar,
  onApagar,
}: {
  ehNovo: boolean
  padrao: boolean
  salvando: boolean
  onSalvar: () => void
  onPadrao: () => void
  onDuplicar: () => void
  onApagar: () => void
}) {
  const [confirmar, setConfirmar] = React.useState(false)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap gap-1">
        {!ehNovo && !padrao && (
          <Button size="sm" variant="ghost" leftIcon={<Star className="h-3.5 w-3.5" />} onClick={onPadrao}>
            Tornar padrão
          </Button>
        )}
        {!ehNovo && (
          <Button size="sm" variant="ghost" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={onDuplicar}>
            Duplicar
          </Button>
        )}
        {!ehNovo &&
          (confirmar ? (
            <>
              <Button size="sm" variant="danger" onClick={onApagar}>
                Confirmar exclusão
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmar(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmar(true)}>
              Apagar
            </Button>
          ))}
      </div>
      <Button loading={salvando} onClick={onSalvar}>
        {ehNovo ? 'Criar' : 'Salvar'}
      </Button>
    </div>
  )
}

// ── Modelos ──────────────────────────────────────────────────────────────────────

const modeloVazio: ModeloDados = {
  nome: '',
  assunto: 'Aviso de garantia: {item} vence em {vencimento}',
  corpo: 'Prezado(a) {sindico},\n\n\n\nAtenciosamente,\nEnge Services',
  whatsappTexto: 'Olá, {sindico}! Aqui é da Enge Services.\n\n\n\nConfirme o recebimento: {link}',
  whatsappTemplate: null,
  whatsappIdioma: null,
  whatsappParametros: [],
}

function Modelos() {
  const qc = useQueryClient()
  const { data: modelos = [], isLoading } = useModelos()
  const { data: cfg } = useEngeConfig()
  const oficial = cfg?.nx.modo === 'template'
  const [sel, setSel] = React.useState<string | null>(null)
  const [rascunho, setRascunho] = React.useState<ModeloDados>(modeloVazio)
  const [parametros, setParametros] = React.useState('')
  const [previa, setPrevia] = React.useState<{ assunto: string; html: string; whatsapp: string } | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const atual = sel && sel !== 'novo' ? modelos.find((m) => m.id === sel) : undefined

  // Abre o primeiro modelo quando a lista chega.
  React.useEffect(() => {
    if (!sel && modelos.length) setSel(modelos[0].id)
  }, [modelos, sel])

  React.useEffect(() => {
    if (sel === 'novo') {
      setRascunho(modeloVazio)
      setParametros('')
    } else if (atual) {
      const { id: _id, padrao: _p, ...dados } = atual
      setRascunho(dados)
      setParametros((atual.whatsappParametros ?? []).join('\n'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, atual?.id])

  React.useEffect(() => {
    const t = setTimeout(() => {
      engeApi
        .previa({ assunto: rascunho.assunto, corpo: rascunho.corpo, whatsappTexto: rascunho.whatsappTexto })
        .then(setPrevia)
        .catch(() => undefined)
    }, 400)
    return () => clearTimeout(t)
  }, [rascunho.assunto, rascunho.corpo, rascunho.whatsappTexto])

  const recarregar = () => qc.invalidateQueries({ queryKey: ['engeenvio', 'modelos'] })
  const set = (k: keyof ModeloDados) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setRascunho((r) => ({ ...r, [k]: e.target.value }))

  const salvar = async () => {
    setSalvando(true)
    const dados = { ...rascunho, whatsappParametros: parametros.split('\n').map((p) => p.trim()).filter(Boolean) }
    try {
      if (atual) {
        await engeApi.salvarModelo(atual.id, dados)
        toast.success('Modelo salvo')
      } else {
        const novo = await engeApi.criarModelo(dados)
        toast.success('Modelo criado')
        setSel(novo.id)
      }
      await recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const agir = async (fn: () => Promise<unknown>, ok: string, depois?: () => void) => {
    try {
      await fn()
      toast.success(ok)
      depois?.()
      await recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (isLoading) return <p className="py-8 text-center text-sm text-foreground/50">Carregando…</p>

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Lista
        itens={modelos}
        selecionado={sel}
        onSelecionar={setSel}
        onNovo={() => setSel('novo')}
        rotuloNovo="Novo modelo"
        detalhe={(m) => m.assunto}
      />
      {sel && (
        <Cartao titulo={atual ? atual.nome : 'Novo modelo'}>
          <div className="space-y-5 p-4">
            <Input
              id="ee-mod-nome"
              label="Nome do modelo"
              placeholder="ex.: Última chamada"
              value={rascunho.nome}
              onChange={set('nome')}
            />
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground/70">Variáveis (trocadas pelos dados de cada garantia)</p>
              <Variaveis />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <section className="min-w-0 space-y-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Mail className="h-4 w-4 text-accent" /> E-mail
                </h3>
                <Input id="ee-mod-ass" label="Assunto" value={rascunho.assunto} onChange={set('assunto')} />
                <Textarea id="ee-mod-corpo" label="Mensagem" value={rascunho.corpo} onChange={set('corpo')} className="min-h-[220px]" />
                <p className="text-xs text-foreground/40">O botão “Estou ciente deste aviso” entra sozinho no fim do e-mail.</p>
                {previa && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-foreground/70">Como chega (dados de exemplo)</p>
                    <p className="text-sm font-medium text-foreground">{previa.assunto}</p>
                    <div className="rounded-lg border border-line bg-white p-4" dangerouslySetInnerHTML={{ __html: previa.html }} />
                  </div>
                )}
              </section>

              <section className="min-w-0 space-y-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <MessageCircle className="h-4 w-4 text-success" /> WhatsApp
                </h3>
                {oficial ? (
                  <>
                    <p className="rounded-lg border border-line bg-elevate/[0.03] px-3 py-2 text-xs text-foreground/60">
                      O WhatsApp da Enge é oficial (API da Meta): o texto é o do template aprovado na Meta. Aqui você diz qual
                      template usar e o que vai em cada variável dele.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        id="ee-mod-tpl"
                        label="Nome do template"
                        placeholder="aviso_garantia"
                        value={rascunho.whatsappTemplate ?? ''}
                        onChange={set('whatsappTemplate')}
                      />
                      <Input
                        id="ee-mod-lang"
                        label="Idioma"
                        placeholder="pt_BR"
                        value={rascunho.whatsappIdioma ?? ''}
                        onChange={set('whatsappIdioma')}
                      />
                    </div>
                    <Textarea
                      id="ee-mod-params"
                      label="Variáveis do template, uma por linha, na ordem {{1}}, {{2}}…"
                      placeholder={'{sindico}\n{item}\n{vencimento}\n{link}'}
                      value={parametros}
                      onChange={(e) => setParametros(e.target.value)}
                      className="min-h-[120px] font-mono text-xs"
                    />
                  </>
                ) : (
                  <>
                    <Textarea
                      id="ee-mod-wa"
                      label="Mensagem"
                      value={rascunho.whatsappTexto}
                      onChange={set('whatsappTexto')}
                      className="min-h-[220px]"
                    />
                    <p className="text-xs text-foreground/40">*texto* sai em negrito. {'{link}'} é o link de confirmação.</p>
                    {previa && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-foreground/70">Como chega (dados de exemplo)</p>
                        <p className="whitespace-pre-wrap rounded-lg border border-line bg-success/[0.06] p-3 text-sm text-foreground/85">
                          {previa.whatsapp}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>

            <Acoes
              ehNovo={!atual}
              padrao={Boolean(atual?.padrao)}
              salvando={salvando}
              onSalvar={salvar}
              onPadrao={() => atual && agir(() => engeApi.tornarModeloPadrao(atual.id), 'Agora este é o modelo padrão')}
              onDuplicar={() =>
                atual &&
                agir(
                  async () => {
                    const { id: _id, padrao: _p, ...dados } = atual
                    const copia = await engeApi.criarModelo({ ...dados, nome: `${atual.nome} (cópia)` })
                    setSel(copia.id)
                  },
                  'Modelo duplicado',
                )
              }
              onApagar={() => atual && agir(() => engeApi.removerModelo(atual.id), 'Modelo apagado', () => setSel(null))}
            />
          </div>
        </Cartao>
      )}
    </div>
  )
}

// ── Réguas ───────────────────────────────────────────────────────────────────────

function Reguas() {
  const qc = useQueryClient()
  const { data: reguas = [], isLoading } = useReguas()
  const { data: modelos = [] } = useModelos()
  const { data: cfg } = useEngeConfig()
  const whatsappDisponivel = Boolean(cfg?.nxOk)
  const [sel, setSel] = React.useState<string | null>(null)
  const [nome, setNome] = React.useState('')
  const [etapas, setEtapas] = React.useState<EtapaRegua[]>([])
  const [salvando, setSalvando] = React.useState(false)

  const atual: EngeRegua | undefined = sel && sel !== 'novo' ? reguas.find((r) => r.id === sel) : undefined

  React.useEffect(() => {
    if (!sel && reguas.length) setSel(reguas[0].id)
  }, [reguas, sel])

  React.useEffect(() => {
    if (sel === 'novo') {
      setNome('')
      setEtapas([novaEtapa(whatsappDisponivel)])
    } else if (atual) {
      setNome(atual.nome)
      setEtapas(atual.etapas)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, atual?.id])

  const recarregar = () => qc.invalidateQueries({ queryKey: ['engeenvio', 'reguas'] })

  const salvar = async () => {
    setSalvando(true)
    try {
      if (atual) {
        await engeApi.salvarRegua(atual.id, nome, etapas)
        toast.success('Régua salva')
      } else {
        const nova = await engeApi.criarRegua(nome, etapas)
        toast.success('Régua criada')
        setSel(nova.id)
      }
      await recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const agir = async (fn: () => Promise<unknown>, ok: string, depois?: () => void) => {
    try {
      await fn()
      toast.success(ok)
      depois?.()
      await recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (isLoading) return <p className="py-8 text-center text-sm text-foreground/50">Carregando…</p>

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Lista
        itens={reguas}
        selecionado={sel}
        onSelecionar={setSel}
        onNovo={() => setSel('novo')}
        rotuloNovo="Nova régua"
        detalhe={(r) => r.etapas.map(descreverEtapa).join(' → ') || 'Sem etapas'}
      />
      {sel && (
        <Cartao titulo={atual ? atual.nome : 'Nova régua'}>
          <div className="space-y-4 p-4">
            <Input id="ee-reg-nome" label="Nome da régua" placeholder="ex.: Itens de 5 anos" value={nome} onChange={(e) => setNome(e.target.value)} />
            <p className="text-xs text-foreground/50">
              Cada etapa é um envio. A régua só agenda os avisos quando é aplicada a um empreendimento ou garantia: mudar a régua depois não
              mexe no que já foi agendado.
            </p>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <ReguaEditor
                idBase="ee-reg"
                etapas={etapas}
                onChange={setEtapas}
                modelos={modelos}
                whatsappDisponivel={whatsappDisponivel}
              />
              <div className="rounded-lg border border-line p-3">
                <p className="mb-2 text-xs font-medium text-foreground/70">Linha do tempo</p>
                <ReguaLinhaTempo etapas={etapas} modelos={modelos} whatsappDisponivel={whatsappDisponivel} />
              </div>
            </div>
            <Acoes
              ehNovo={!atual}
              padrao={Boolean(atual?.padrao)}
              salvando={salvando}
              onSalvar={salvar}
              onPadrao={() => atual && agir(() => engeApi.tornarReguaPadrao(atual.id), 'Agora esta é a régua padrão')}
              onDuplicar={() =>
                atual &&
                agir(
                  async () => {
                    const copia = await engeApi.criarRegua(`${atual.nome} (cópia)`, atual.etapas)
                    setSel(copia.id)
                  },
                  'Régua duplicada',
                )
              }
              onApagar={() => atual && agir(() => engeApi.removerRegua(atual.id), 'Régua apagada', () => setSel(null))}
            />
          </div>
        </Cartao>
      )}
    </div>
  )
}
