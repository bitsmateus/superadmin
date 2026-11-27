import * as React from 'react'
import { AlertTriangle, Archive, ArchiveRestore, Copy, Download, Loader2, Play } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { api } from '@/services/api'
import { leadPagesService } from '@/services/leadPages'
import { toast } from 'sonner'

interface Simulacao { geradoEm: string; texto: string; assinatura: string; plano: { problemas: string[] }; referencias: unknown }

/**
 * Simulação da consolidação dos CRMs (CRM LUIS e CRM LUIS CLOSER -> CRM LUIS ATUALIZADO), só admin —
 * /admin/consolidar-crm. A simulação só lê. A execução só aparece com a simulação sem nada em "O que impede a execução",
 * pede a palavra CONSOLIDAR e manda a assinatura do plano simulado: se os dados mudaram desde então, o servidor recusa.
 */
export function ConsolidacaoCrmPage() {
  const [d, setD] = React.useState<Simulacao | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [rodando, setRodando] = React.useState(false)
  const [estado, setEstado] = React.useState<{ executada: boolean; texto?: string } | null>(null)
  const [confirmacao, setConfirmacao] = React.useState('')
  const [executando, setExecutando] = React.useState(false)

  React.useEffect(() => {
    api.get<{ executada: boolean; texto?: string }>('/api/admin/consolidacao-crm/estado').then(setEstado).catch(() => setEstado(null))
  }, [])

  const executar = async () => {
    if (!d) return
    if (!window.confirm('Executar a consolidação agora? É uma transação só: se qualquer conferência falhar, nada é gravado.')) return
    setExecutando(true)
    setErro(null)
    try {
      const r = await api.post<{ texto: string }>('/api/admin/consolidacao-crm/executar', { assinatura: d.assinatura, confirmacao })
      setEstado({ executada: true, texto: r.texto })
      toast.success('Consolidação executada')
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setExecutando(false)
    }
  }

  const rodar = async () => {
    setRodando(true)
    setErro(null)
    try {
      setD(await api.get<Simulacao>('/api/admin/consolidacao-crm/simulacao'))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setRodando(false)
    }
  }

  const baixar = () => {
    if (!d) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `simulacao-crm-${d.geradoEm.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <TopBar title="Consolidar CRMs" subtitle={estado?.executada ? 'Executada' : 'Simulação só lê; a execução pede confirmação'} />
      <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void rodar()} disabled={rodando}>
            {rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Rodar simulação
          </Button>
          {d && (
            <>
              <Button variant="outline" onClick={() => void navigator.clipboard.writeText(d.texto).then(() => toast.success('Relatório copiado'))}>
                <Copy className="h-4 w-4" /> Copiar relatório
              </Button>
              <Button variant="outline" onClick={baixar}><Download className="h-4 w-4" /> Baixar detalhes</Button>
            </>
          )}
        </div>
        {erro && <p className="text-sm text-danger">{erro}</p>}
        {estado?.executada && <AbasAntigasPainel />}
        {estado?.executada && estado.texto && (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-success/10 p-4 text-xs leading-relaxed text-foreground">{estado.texto}</pre>
        )}
        {d && !estado?.executada && d.plano.problemas.length === 0 && (
          <div className="space-y-3 rounded-2xl border border-warning/40 bg-warning/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <AlertTriangle className="h-4 w-4 text-warning" /> Executar a consolidação (assinatura {d.assinatura})
            </p>
            <p className="text-xs text-foreground/60">
              Antes: pause o NX Réguas e ajuste a Luiza no n8n. Faz backup, executa tudo numa transação e confere; se algo não bater,
              nada é gravado. Digite CONSOLIDAR pra liberar o botão.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder="CONSOLIDAR"
                className="h-9 rounded-lg border border-line bg-card px-3 text-sm text-foreground"
              />
              <Button variant="danger" onClick={() => void executar()} disabled={confirmacao !== 'CONSOLIDAR' || executando}>
                {executando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Executar consolidação
              </Button>
            </div>
          </div>
        )}
        {d && (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-card p-4 text-xs leading-relaxed text-foreground shadow-sm">{d.texto}</pre>
        )}
      </div>
    </>
  )
}

interface AbaAntiga {
  id: string; nome: string; existe: boolean; arquivada: boolean
  ativos: number; arquivadosNaConsolidacao: number; naLixeira: number; quadros: number
}
interface SituacaoAbasAntigas { abas: AbaAntiga[]; bloqueios: string[] }

/** CRM LUIS e CRM LUIS CLOSER depois da consolidação: arquivar (some da barra lateral, tudo fica no banco) e desarquivar. */
function AbasAntigasPainel() {
  const [s, setS] = React.useState<SituacaoAbasAntigas | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [mexendo, setMexendo] = React.useState(false)
  const URL_BASE = '/api/admin/consolidacao-crm/abas-antigas'

  React.useEffect(() => {
    api.get<SituacaoAbasAntigas>(URL_BASE).then(setS).catch((e: Error) => setErro(e.message))
  }, [])

  const acao = async (qual: 'arquivar' | 'desarquivar') => {
    const pergunta = qual === 'arquivar'
      ? 'Arquivar CRM LUIS e CRM LUIS CLOSER? Somem da barra lateral; cards, lixeira, quadros e histórico continuam no banco.'
      : 'Desarquivar CRM LUIS e CRM LUIS CLOSER? Voltam pra barra lateral como estão.'
    if (!window.confirm(pergunta)) return
    setMexendo(true)
    setErro(null)
    try {
      setS(await api.post<SituacaoAbasAntigas>(`${URL_BASE}/${qual}`, {}))
      await leadPagesService.recarregar()
      toast.success(qual === 'arquivar' ? 'Abas arquivadas' : 'Abas desarquivadas')
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setMexendo(false)
    }
  }

  const todasArquivadas = !!s && s.abas.every((a) => a.arquivada)
  const algumaArquivada = !!s && s.abas.some((a) => a.arquivada)
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-card p-4 shadow-sm">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground"><Archive className="h-4 w-4" /> Abas antigas</p>
      {!s && !erro && <Loader2 className="h-4 w-4 animate-spin text-foreground/50" />}
      {s && (
        <ul className="space-y-1 text-xs text-foreground/80">
          {s.abas.map((a) => (
            <li key={a.id}>
              <span className="font-medium text-foreground">{a.nome}</span> ({a.id}): {a.arquivada ? 'arquivada' : 'na barra lateral'} ·{' '}
              {a.ativos} ativo(s) · {a.arquivadosNaConsolidacao} arquivado(s) na consolidação · {a.naLixeira} na lixeira · {a.quadros} quadro(s)
            </li>
          ))}
        </ul>
      )}
      {s && s.bloqueios.length > 0 && !todasArquivadas && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-danger">{s.bloqueios.map((b) => <li key={b}>{b}</li>)}</ul>
      )}
      {erro && <p className="text-xs text-danger">{erro}</p>}
      {s && (
        <div className="flex flex-wrap gap-2">
          {!todasArquivadas && (
            <Button variant="danger" onClick={() => void acao('arquivar')} disabled={mexendo || s.bloqueios.length > 0}>
              {mexendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} Arquivar as duas
            </Button>
          )}
          {algumaArquivada && (
            <Button variant="outline" onClick={() => void acao('desarquivar')} disabled={mexendo}>
              <ArchiveRestore className="h-4 w-4" /> Desarquivar
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-foreground/60">
        Arquivar só esconde: nada é apagado e nenhum número muda. Quem abrir o endereço antigo vai pro CRM LUIS ATUALIZADO.
        Também dá pra restaurar uma a uma em "Abas arquivadas", na barra lateral.
      </p>
    </div>
  )
}
