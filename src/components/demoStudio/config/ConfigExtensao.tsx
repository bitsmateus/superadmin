import * as React from 'react'
import { toast } from 'sonner'
import { Copy, Download, KeyRound, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Painel } from '@/components/demoStudio/analytics/Analytics'
import { copyToClipboard } from '@/lib/clipboard'
import { dataHora } from '@/lib/demoStudio/format'
import { AUTOMATICA_PADRAO, criarAnonimizador, type AnonimizacaoAutomatica } from '@/lib/demoStudio/anonimizar'
import { URL_DA_API, crm, extensao, type RegraAnonimizacao, type TokenDaExtensao } from '@/services/demoStudio'

/** Configurações → Extensão (§4.7): token pessoal, download do zip e como instalar. */
export function ConfigExtensao() {
  const [tokens, setTokens] = React.useState<TokenDaExtensao[] | null>(null)
  const [novo, setNovo] = React.useState<string | null>(null)
  const [nome, setNome] = React.useState('Meu Chrome')
  const carregar = React.useCallback(() => { extensao.tokens().then(setTokens).catch((e: Error) => toast.error(e.message)) }, [])
  React.useEffect(() => { carregar() }, [carregar])

  const gerar = async () => {
    try {
      const r = await extensao.gerarToken(nome || 'Extensão')
      setNovo(r.token)
      carregar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const revogar = async (t: TokenDaExtensao) => {
    if (!window.confirm(`Revogar o token "${t.name}"? A extensão que usa ele para de funcionar.`)) return
    await extensao.revogarToken(t.id).catch((e: Error) => toast.error(e.message))
    carregar()
  }
  const ativos = (tokens ?? []).filter((t) => !t.revokedAt)

  return (
    <Painel titulo="Extensão de captura">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3 text-sm">
          <a href="/nx-demo-capture.zip" download className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 font-semibold text-white hover:opacity-90">
            <Download className="h-4 w-4" /> Baixar extensão (.zip)
          </a>
          <ol className="list-decimal space-y-1 pl-5 text-foreground/75">
            <li>Descompacte o zip numa pasta que não vai apagar.</li>
            <li>No Chrome, abra <code className="rounded bg-elevate/[0.05] px-1">chrome://extensions</code> e ligue o <b>Modo do desenvolvedor</b>.</li>
            <li>Clique em <b>Carregar sem compactação</b> e escolha a pasta.</li>
            <li>No ícone da extensão, aba <b>Conta</b>: cole o endereço da API e o token gerado aqui ao lado.</li>
            <li>Abra o sistema já logado, clique em <b>Iniciar captura</b> e navegue: cada clique vira uma tela com o destaque no lugar. <kbd className="rounded border border-line px-1 text-xs">Alt+Shift+S</kbd> captura sem clicar.</li>
          </ol>
          <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
            <span className="text-foreground/55">Endereço da API:</span>
            <code className="min-w-0 flex-1 truncate">{URL_DA_API}</code>
            <button type="button" className="text-accent hover:underline" onClick={async () => { await copyToClipboard(URL_DA_API); toast.success('Endereço copiado') }}>copiar</button>
          </div>
        </div>
        <div className="space-y-3">
          {novo ? (
            <div className="space-y-2 rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm">
              <p className="font-semibold">Copie agora: o token não aparece de novo.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1 text-xs">{novo}</code>
                <Button size="sm" variant="outline" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={async () => { await copyToClipboard(novo); toast.success('Token copiado') }}>Copiar</Button>
              </div>
              <button type="button" className="text-xs text-foreground/55 hover:text-foreground" onClick={() => setNovo(null)}>Já copiei</button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-1"><Input label="Nome do token" value={nome} onChange={(e) => setNome(e.target.value)} /></div>
              <Button size="sm" leftIcon={<KeyRound className="h-4 w-4" />} onClick={gerar}>Gerar token</Button>
            </div>
          )}
          <ul className="divide-y divide-line text-sm">
            {ativos.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2">
                <KeyRound className="h-3.5 w-3.5 text-foreground/40" />
                <span className="flex-1">{t.name}</span>
                <span className="text-xs text-foreground/45">criado {dataHora(t.createdAt)}{t.lastUsedAt ? ` · usado ${dataHora(t.lastUsedAt)}` : ' · nunca usado'}</span>
                <button type="button" aria-label="Revogar token" className="p-1 text-foreground/40 hover:text-red-500" onClick={() => revogar(t)}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
            {tokens && !ativos.length && <li className="py-2 text-xs text-foreground/45">Nenhum token ativo.</li>}
          </ul>
        </div>
      </div>
    </Painel>
  )
}

const ROTULO_AUTO: Record<keyof AnonimizacaoAutomatica, string> = {
  phone: 'Telefones', email: 'E-mails', cpf: 'CPF', cnpj: 'CNPJ', avatars: 'Fotos de perfil',
}

/** Configurações → Anonimização (§4.7): regras "procurar → substituir", automáticas e pré-visualização. */
export function ConfigAnonimizacao() {
  const [regras, setRegras] = React.useState<RegraAnonimizacao[]>([])
  const [auto, setAuto] = React.useState<AnonimizacaoAutomatica>(AUTOMATICA_PADRAO)
  const [nova, setNova] = React.useState({ find: '', replace: '', isRegex: false })
  const [teste, setTeste] = React.useState('Atendimento de Marcos Vieira · (11) 98765-4321 · marcos@lojareal.com.br · CPF 123.456.789-09')
  const carregar = React.useCallback(() => {
    extensao.regras().then(setRegras).catch((e: Error) => toast.error(e.message))
    crm.config().then((c) => setAuto({ ...AUTOMATICA_PADRAO, ...(c.anonymizeAuto ?? {}) })).catch(() => undefined)
  }, [])
  React.useEffect(() => { carregar() }, [carregar])

  const previa = React.useMemo(() => criarAnonimizador(regras, auto).texto(teste), [regras, auto, teste])

  const adicionar = async () => {
    try {
      await extensao.criarRegra(nova)
      setNova({ find: '', replace: '', isRegex: false })
      carregar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const mudarAuto = async (k: keyof AnonimizacaoAutomatica, v: boolean) => {
    const prox = { ...auto, [k]: v }
    setAuto(prox)
    await crm.salvarConfig({ anonymizeAuto: prox }).catch((e: Error) => toast.error(e.message))
  }

  return (
    <Painel titulo="Anonimização" acao={<span className="text-[11px] text-foreground/45">Vale na extensão, ao vivo, antes do print. Obrigatória para quem não é admin.</span>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-sm">
            {(Object.keys(ROTULO_AUTO) as (keyof AnonimizacaoAutomatica)[]).map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={auto[k]} onChange={(e) => mudarAuto(k, e.target.checked)} /> {ROTULO_AUTO[k]}
              </label>
            ))}
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {regras.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                <code className="min-w-0 flex-1 truncate">{r.find}</code>
                <span className="text-foreground/40">→</span>
                <span className="min-w-0 flex-1 truncate">{r.replace}</span>
                {r.isRegex && <span className="rounded bg-elevate/[0.06] px-1.5 text-[10px] text-foreground/60">regex</span>}
                <button type="button" aria-label="Apagar regra" className="p-1 text-foreground/40 hover:text-red-500"
                  onClick={async () => { await extensao.apagarRegra(r.id); carregar() }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {!regras.length && <li className="px-3 py-2 text-xs text-foreground/45">Nenhuma regra. Ex.: o nome real de um cliente → "Pedal Bikes".</li>}
          </ul>
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Input label="Procurar" value={nova.find} onChange={(e) => setNova({ ...nova, find: e.target.value })} placeholder="Bike Center Floripa" />
            <Input label="Trocar por" value={nova.replace} onChange={(e) => setNova({ ...nova, replace: e.target.value })} placeholder="Pedal Bikes" />
            <Button size="sm" disabled={!nova.find} onClick={adicionar}>Adicionar</Button>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-foreground/60">
            <input type="checkbox" checked={nova.isRegex} onChange={(e) => setNova({ ...nova, isRegex: e.target.checked })} /> É expressão regular
          </label>
        </div>
        <div className="space-y-2">
          <Textarea label="Teste um texto" rows={4} value={teste} onChange={(e) => setTeste(e.target.value)} />
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground/70">Como sai na captura</p>
            <p className="min-h-[90px] whitespace-pre-wrap rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-sm">{previa}</p>
          </div>
        </div>
      </div>
    </Painel>
  )
}
