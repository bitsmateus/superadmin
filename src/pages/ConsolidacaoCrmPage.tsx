import * as React from 'react'
import { Copy, Download, Loader2, Play } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { api } from '@/services/api'
import { toast } from 'sonner'

interface Simulacao { geradoEm: string; texto: string; plano: unknown; referencias: unknown }

/**
 * Simulação da consolidação dos CRMs (CRM LUIS e CRM LUIS CLOSER -> CRM LUIS ATUALIZADO), só admin —
 * /admin/consolidar-crm. SÓ LEITURA: mostra o que seria feito. Não existe botão de executar aqui.
 */
export function ConsolidacaoCrmPage() {
  const [d, setD] = React.useState<Simulacao | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [rodando, setRodando] = React.useState(false)

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
      <TopBar title="Consolidar CRMs" subtitle="Simulação · só leitura, nada aqui muda nenhum lead" />
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
        {d && (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-card p-4 text-xs leading-relaxed text-foreground shadow-sm">{d.texto}</pre>
        )}
      </div>
    </>
  )
}
