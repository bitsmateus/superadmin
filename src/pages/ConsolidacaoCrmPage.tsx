import * as React from 'react'
import { AlertTriangle, Copy, Download, Loader2, Play } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { api } from '@/services/api'
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
