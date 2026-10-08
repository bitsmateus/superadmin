import * as React from 'react'
import { cn } from '@/lib/utils'
import { Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2, MessageCircleQuestion, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { BarraSalvar } from '@/components/gestaoClientes/BarraSalvar'
import { ArquivosDoCliente } from '@/components/gestaoClientes/ArquivosDoCliente'
import { LogoDoCliente } from '@/components/gestaoClientes/LogoDoCliente'
import { BRIEFING_MODELO, comModeloDoBriefing } from '@/lib/gcBriefingModelo'
import { useAvisoAoSair } from '@/hooks/useAvisoAoSair'
import { gestaoClientes, type GcBriefing, type GcClienteLista } from '@/services/gestaoClientes'

type Rascunho = GcBriefing

const comoLink = (v: string) => (/^https?:\/\//i.test(v.trim()) ? v.trim() : `https://${v.trim()}`)

/**
 * BRIEFING do cliente: os dados dele (logo, site, número, Instagram e quantos campos extras quiser) e as
 * perguntas e respostas do briefing, preenchidas à medida que o cliente responde. O número é o WhatsApp do
 * cadastro, então muda nos dois lugares.
 */
const RESPOSTAS: { valor: string; rotulo: string; cor: string }[] = [
  { valor: 'sim', rotulo: 'Sim', cor: 'border-success/50 bg-success/10 text-success' },
  { valor: 'nao', rotulo: 'Não', cor: 'border-danger/50 bg-danger/10 text-danger' },
  { valor: 'nao_sei', rotulo: 'Não sei', cor: 'border-warning/50 bg-warning/10 text-warning' },
]

/** Uma pergunta do checklist de entrada: Sim / Não / Não sei, e uma observação (ID da conta, quem tem acesso…). */
function ItemDoChecklist({
  pergunta, valor, obs, onValor, onObs, dica,
}: {
  pergunta: string
  valor: string
  obs: string
  onValor: (v: string) => void
  onObs: (v: string) => void
  dica: string
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-sm font-medium text-foreground">{pergunta}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label={pergunta}>
          {RESPOSTAS.map((x) => (
            <button
              key={x.valor}
              type="button"
              aria-pressed={valor === x.valor}
              onClick={() => onValor(valor === x.valor ? '' : x.valor)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                valor === x.valor ? x.cor : 'border-line text-foreground/55 hover:text-foreground',
              )}
            >
              {x.rotulo}
            </button>
          ))}
        </div>
        <input
          value={obs}
          onChange={(e) => onObs(e.target.value)}
          placeholder={dica}
          aria-label={`Observação: ${pergunta}`}
          className="h-9 min-w-[10rem] flex-1 rounded-lg border border-line bg-surface px-2.5 text-sm text-foreground outline-none placeholder:text-foreground/30 focus:border-accent"
        />
      </div>
    </div>
  )
}

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

  // As 27 perguntas do modelo sempre aparecem; o que já foi respondido (e as perguntas acrescentadas) vem junto.
  const aplicar = React.useCallback((b: GcBriefing) => {
    const comModelo = { ...b, perguntas: comModeloDoBriefing(b.perguntas) }
    setGravado(comModelo)
    setR(comModelo)
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
      aplicar(salvo)
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

      {/* ------------------------------------------------------------ checklist de entrada */}
      <section className="rounded-2xl border border-line p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Contas e pagamento</h2>
        <p className="mb-3 text-xs text-foreground/50">Marque o que o cliente já tem e anote o que for preciso (ID da conta, e-mail com acesso…).</p>
        <div className="space-y-2.5">
          <ItemDoChecklist
            pergunta="Forma de pagamento válida na conta de anúncios?"
            valor={r.pagamento_anuncios}
            obs={r.pagamento_obs}
            onValor={(v) => setR({ ...r, pagamento_anuncios: v })}
            onObs={(v) => setR({ ...r, pagamento_obs: v })}
            dica="Ex.: cartão final 1234, boleto, pix…"
          />
          <ItemDoChecklist
            pergunta="Google Ads"
            valor={r.google_ads}
            obs={r.google_ads_obs}
            onValor={(v) => setR({ ...r, google_ads: v })}
            onObs={(v) => setR({ ...r, google_ads_obs: v })}
            dica="ID da conta, e-mail com acesso…"
          />
          <ItemDoChecklist
            pergunta="Google Analytics"
            valor={r.analytics}
            obs={r.analytics_obs}
            onValor={(v) => setR({ ...r, analytics: v })}
            onObs={(v) => setR({ ...r, analytics_obs: v })}
            dica="ID da propriedade, e-mail com acesso…"
          />
          <ItemDoChecklist
            pergunta="Google Tag Manager"
            valor={r.tag_manager}
            obs={r.tag_manager_obs}
            onValor={(v) => setR({ ...r, tag_manager: v })}
            onObs={(v) => setR({ ...r, tag_manager_obs: v })}
            dica="ID do contêiner (GTM-…), e-mail com acesso…"
          />
          <ItemDoChecklist
            pergunta="Google Meu Negócio"
            valor={r.meu_negocio}
            obs={r.meu_negocio_obs}
            onValor={(v) => setR({ ...r, meu_negocio: v })}
            onObs={(v) => setR({ ...r, meu_negocio_obs: v })}
            dica="Link do perfil, e-mail com acesso…"
          />
        </div>
      </section>

      {/* ------------------------------------------------------------ fotos, vídeos e arquivos */}
      <section className="rounded-2xl border border-line p-4 sm:p-5">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Fotos, vídeos e arquivos</h2>
        <ArquivosDoCliente clienteId={cliente.id} />
      </section>

      {/* ------------------------------------------------------------ perguntas e respostas */}
      <section className="rounded-2xl border border-line p-4 sm:p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageCircleQuestion className="h-4 w-4 text-accent" /> Perguntas e respostas
          </h2>
          <span className="text-xs tabular-nums text-foreground/50">
            {r.perguntas.filter((p) => p.resposta.trim()).length} de {r.perguntas.length} respondidas
          </span>
        </div>
        <p className="mb-4 text-xs text-foreground/50">
          Onde houver <strong className="text-warning">indicador</strong>, a resposta precisa de número (R$, %, quantidade ou prazo). Se o cliente não souber, marque “Não sabe”: isso já é um diagnóstico.
        </p>

        {r.perguntas.map((p, i) => {
          const modelo = i < BRIEFING_MODELO.length && BRIEFING_MODELO[i].pergunta === p.pergunta ? BRIEFING_MODELO[i] : null
          const novoBloco = modelo && (i === 0 || BRIEFING_MODELO[i - 1].bloco !== modelo.bloco)
          const mudar = (campo: 'pergunta' | 'resposta', valor: string) =>
            setR({ ...r, perguntas: r.perguntas.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)) })
          return (
            <React.Fragment key={i}>
              {novoBloco && <h3 className="mb-2 mt-5 border-b border-line pb-1 text-sm font-semibold text-foreground first:mt-0">{modelo.bloco}</h3>}
              {!modelo && i === BRIEFING_MODELO.length && (
                <h3 className="mb-2 mt-5 border-b border-line pb-1 text-sm font-semibold text-foreground">Outras perguntas</h3>
              )}
              <div className="mb-3 rounded-xl border border-line p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/12 text-xs font-bold text-accent">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    {modelo ? (
                      <>
                        <p className="text-sm font-medium text-foreground">{p.pergunta}</p>
                        <p className="mt-0.5 text-xs text-foreground/45">Por que importa: {modelo.porque}</p>
                        {modelo.indicador && (
                          <p className="mt-0.5 text-xs">
                            <span className="font-semibold text-warning">Indicador:</span> <span className="text-foreground/65">{modelo.indicador}</span>
                          </p>
                        )}
                      </>
                    ) : (
                      <Input aria-label="Pergunta" value={p.pergunta} onChange={(ev) => mudar('pergunta', ev.target.value)} placeholder="Pergunta" />
                    )}
                    <Textarea
                      aria-label={`Resposta da pergunta ${i + 1}`}
                      rows={2}
                      className="mt-2"
                      value={p.resposta}
                      onChange={(ev) => mudar('resposta', ev.target.value)}
                      placeholder="Resposta do cliente"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => mudar('resposta', 'Não sabe')}
                        className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-foreground/55 hover:border-warning/50 hover:text-warning"
                      >
                        Não sabe
                      </button>
                      {!modelo && (
                        <button
                          type="button"
                          onClick={() => setR({ ...r, perguntas: r.perguntas.filter((_, j) => j !== i) })}
                          className="p-1 text-foreground/30 hover:text-danger"
                          aria-label="Remover pergunta"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </React.Fragment>
          )
        })}

        <Button size="sm" variant="secondary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setR({ ...r, perguntas: [...r.perguntas, { pergunta: '', resposta: '' }] })}>
          Adicionar outra pergunta
        </Button>
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
