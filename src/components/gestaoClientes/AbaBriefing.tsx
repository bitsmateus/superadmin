import * as React from 'react'
import { Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2, MessageCircleQuestion, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { BarraSalvar } from '@/components/gestaoClientes/BarraSalvar'
import { LogoDoCliente } from '@/components/gestaoClientes/LogoDoCliente'
import { useAvisoAoSair } from '@/hooks/useAvisoAoSair'
import { gestaoClientes, type GcBriefing, type GcClienteLista } from '@/services/gestaoClientes'

type Rascunho = GcBriefing

const comoLink = (v: string) => (/^https?:\/\//i.test(v.trim()) ? v.trim() : `https://${v.trim()}`)

/**
 * BRIEFING do cliente: os dados dele (logo, site, número, Instagram e quantos campos extras quiser) e as
 * perguntas e respostas do briefing, preenchidas à medida que o cliente responde. O número é o WhatsApp do
 * cadastro, então muda nos dois lugares.
 */
/** Campo de senha: escondido por padrão, com o olho pra mostrar e um botão pra copiar. */
function CampoSenha({ rotulo, valor, onChange }: { rotulo: string; valor: string; onChange: (v: string) => void }) {
  const [visivel, setVisivel] = React.useState(false)
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor)
      toast.success('Senha copiada')
    } catch {
      toast.error('Não consegui copiar')
    }
  }
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground/70">{rotulo}</span>
      <span className="relative block">
        <input
          type={visivel ? 'text' : 'password'}
          autoComplete="new-password"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-lg border border-line bg-surface pl-3 pr-[4.5rem] text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
        />
        <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          <button type="button" onClick={() => setVisivel((v) => !v)} className="rounded-md p-1.5 text-foreground/40 hover:text-foreground" aria-label={visivel ? 'Esconder a senha' : 'Mostrar a senha'}>
            {visivel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button type="button" disabled={!valor} onClick={() => void copiar()} className="rounded-md p-1.5 text-foreground/40 hover:text-foreground disabled:opacity-30" aria-label="Copiar a senha">
            <Copy className="h-4 w-4" />
          </button>
        </span>
      </span>
    </label>
  )
}

export function AbaBriefing({ cliente, onMudou }: { cliente: GcClienteLista; onMudou: () => Promise<void> | void }) {
  const [gravado, setGravado] = React.useState<GcBriefing | null>(null)
  const [r, setR] = React.useState<Rascunho | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const aplicar = React.useCallback((b: GcBriefing) => {
    setGravado(b)
    setR(b)
  }, [])

  React.useEffect(() => {
    gestaoClientes
      .briefing(cliente.id)
      .then(aplicar)
      .catch((err: Error) => toast.error('Falha ao carregar o briefing: ' + err.message))
  }, [cliente.id, aplicar])

  const limpo = (x: Rascunho) =>
    JSON.stringify({
      ...x,
      extras: x.extras.filter((e) => e.rotulo.trim() || e.valor.trim()),
      perguntas: x.perguntas.filter((p) => p.pergunta.trim() || p.resposta.trim()),
    })
  const sujo =
    !!r && !!gravado &&
    limpo(r) !== limpo(gravado)
  useAvisoAoSair(sujo)

  const salvar = async () => {
    if (!r) return
    setSalvando(true)
    try {
      const salvo = await gestaoClientes.salvarBriefing(cliente.id, r)
      setGravado(salvo)
      setR(salvo)
      toast.success('Briefing salvo')
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  if (!r) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando briefing…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ dados do cliente */}
      <section className="rounded-2xl border border-line p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Dados do cliente</h2>
        <LogoDoCliente clienteId={cliente.id} nome={cliente.nome_empresa} logoUrl={cliente.logo_url} onMudou={onMudou} />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <Input label="Site" value={r.site} onChange={(e) => setR({ ...r, site: e.target.value })} placeholder="www.empresa.com.br" />
            {r.site.trim() && (
              <a href={comoLink(r.site)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                abrir o site <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <Input label="WhatsApp pra receber os leads" value={r.whatsapp_leads} onChange={(e) => setR({ ...r, whatsapp_leads: e.target.value })} placeholder="(84) 99999-9999" inputMode="tel" />
        </div>

        <p className="mb-1.5 mt-5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground/45">
          <KeyRound className="h-3.5 w-3.5" /> Acessos <span className="normal-case text-foreground/35">· só a equipe vê</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Instagram" value={r.instagram} onChange={(e) => setR({ ...r, instagram: e.target.value })} placeholder="@empresa" />
          <CampoSenha rotulo="Senha do Instagram" valor={r.instagram_senha} onChange={(v) => setR({ ...r, instagram_senha: v })} />
          <Input label="Facebook (login ou página)" value={r.facebook} onChange={(e) => setR({ ...r, facebook: e.target.value })} placeholder="login ou link da página" />
          <CampoSenha rotulo="Senha do Facebook" valor={r.facebook_senha} onChange={(v) => setR({ ...r, facebook_senha: v })} />
        </div>

        <p className="mb-1.5 mt-5 text-xs font-medium uppercase tracking-wide text-foreground/45">CRM utilizado</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="CRM" value={r.crm} onChange={(e) => setR({ ...r, crm: e.target.value })} placeholder="Ex.: RD Station, Kommo, Bitrix…" />
          <Input label="E-mail do CRM" value={r.crm_email} onChange={(e) => setR({ ...r, crm_email: e.target.value })} placeholder="login@empresa.com" inputMode="email" />
          <CampoSenha rotulo="Senha do CRM" valor={r.crm_senha} onChange={(v) => setR({ ...r, crm_senha: v })} />
        </div>

        <p className="mb-1.5 mt-5 text-xs font-medium uppercase tracking-wide text-foreground/45">Outras informações</p>
        <div className="space-y-2">
          {r.extras.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <Input
                aria-label="Nome do campo"
                value={e.rotulo}
                onChange={(ev) => setR({ ...r, extras: r.extras.map((x, j) => (j === i ? { ...x, rotulo: ev.target.value } : x)) })}
                placeholder="Ex.: Horário de atendimento"
              />
              <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                <Input
                  aria-label="Valor"
                  value={e.valor}
                  onChange={(ev) => setR({ ...r, extras: r.extras.map((x, j) => (j === i ? { ...x, valor: ev.target.value } : x)) })}
                  placeholder="Valor"
                />
              </div>
              <button
                type="button"
                onClick={() => setR({ ...r, extras: r.extras.filter((_, j) => j !== i) })}
                className="col-start-2 row-start-1 self-center p-1 text-foreground/30 hover:text-danger sm:col-start-auto sm:row-start-auto"
                aria-label="Remover campo"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button variant="ghost" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setR({ ...r, extras: [...r.extras, { rotulo: '', valor: '' }] })}>
            Adicionar campo
          </Button>
        </div>
      </section>

      {/* ------------------------------------------------------------ perguntas e respostas */}
      <section className="rounded-2xl border border-line p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageCircleQuestion className="h-4 w-4 text-accent" /> Perguntas e respostas
          </h2>
          <Button size="sm" variant="secondary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setR({ ...r, perguntas: [...r.perguntas, { pergunta: '', resposta: '' }] })}>
            Adicionar pergunta
          </Button>
        </div>
        {r.perguntas.length === 0 ? (
          <p className="py-4 text-center text-sm text-foreground/45">
            Nenhuma pergunta ainda. Adicione as perguntas do briefing e vá preenchendo as respostas do cliente.
          </p>
        ) : (
          <ol className="space-y-3">
            {r.perguntas.map((p, i) => (
              <li key={i} className="rounded-xl border border-line p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/12 text-xs font-bold text-accent">{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      aria-label="Pergunta"
                      value={p.pergunta}
                      onChange={(ev) => setR({ ...r, perguntas: r.perguntas.map((x, j) => (j === i ? { ...x, pergunta: ev.target.value } : x)) })}
                      placeholder="Pergunta (ex.: Qual o diferencial da empresa?)"
                    />
                    <Textarea
                      aria-label="Resposta"
                      rows={2}
                      value={p.resposta}
                      onChange={(ev) => setR({ ...r, perguntas: r.perguntas.map((x, j) => (j === i ? { ...x, resposta: ev.target.value } : x)) })}
                      placeholder="Resposta do cliente"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setR({ ...r, perguntas: r.perguntas.filter((_, j) => j !== i) })}
                    className="mt-2 p-1 text-foreground/30 hover:text-danger"
                    aria-label="Remover pergunta"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <BarraSalvar
        visivel={sujo}
        salvando={salvando}
        rotulo="Salvar briefing"
        onSalvar={() => void salvar()}
        onDescartar={() => gravado && aplicar(gravado)}
      />
    </div>
  )
}
