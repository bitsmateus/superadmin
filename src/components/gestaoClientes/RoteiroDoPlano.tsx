import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { gestaoClientes } from '@/services/gestaoClientes'
import { useAvisoAoSair } from '@/hooks/useAvisoAoSair'

export const AVISO_DO_ROTEIRO =
  'Este é o planejamento inicial combinado ao fechar. Ele pode variar conforme as análises e a estratégia da equipe ao longo dos meses.'

const MINIMO = 6
const MAXIMO = 12

const vazio = (n: number) => Array.from({ length: n }, () => '')

/**
 * O roteiro mês a mês: o que será trabalhado em cada um dos primeiros meses. É o planejamento que o cliente
 * vê no portal ao fechar, com o aviso de que pode variar. Salva por conta própria (botão aqui), sem mexer no resto do plano.
 */
export function RoteiroDoPlano({ clienteId }: { clienteId: string }) {
  const [meses, setMeses] = React.useState<string[]>(vazio(MINIMO))
  const [gravado, setGravado] = React.useState<string[]>(vazio(MINIMO))
  const [salvando, setSalvando] = React.useState(false)

  const aplicar = React.useCallback((lista: { mes: number; texto: string }[]) => {
    const tamanho = Math.max(MINIMO, ...lista.map((l) => l.mes))
    const base = vazio(tamanho)
    for (const l of lista) base[l.mes - 1] = l.texto
    setMeses(base)
    setGravado(base)
  }, [])

  React.useEffect(() => {
    gestaoClientes
      .roteiro(clienteId)
      .then((r) => aplicar(r.meses))
      .catch(() => undefined)
  }, [clienteId, aplicar])

  const aparar = (l: string[]) => {
    const copia = [...l]
    while (copia.length > MINIMO && !copia[copia.length - 1].trim()) copia.pop()
    return copia.map((t) => t.trim()).join('\u0001')
  }
  const sujo = aparar(meses) !== aparar(gravado)
  useAvisoAoSair(sujo)

  const salvar = async () => {
    setSalvando(true)
    try {
      const r = await gestaoClientes.salvarRoteiro(
        clienteId,
        meses.map((texto, i) => ({ mes: i + 1, texto })).filter((m) => m.texto.trim()),
      )
      aplicar(r.meses)
      toast.success('Roteiro salvo')
    } catch (err) {
      toast.error('Falha ao salvar o roteiro: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-3">
      <p className="text-sm font-semibold text-foreground">O que vamos trabalhar em cada mês</p>
      <p className="mb-3 text-xs text-foreground/50">
        Escreva pelo menos os 6 primeiros meses. <strong>O cliente vê isso no portal</strong>, com o aviso: “{AVISO_DO_ROTEIRO}”
      </p>
      <div className="space-y-2">
        {meses.map((texto, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs font-semibold text-foreground/60">Mês {i + 1}</span>
            <Input
              value={texto}
              onChange={(e) => setMeses((l) => l.map((t, j) => (j === i ? e.target.value : t)))}
              placeholder={
                ['Estruturação do perfil e subida das campanhas', 'Implementação comercial', 'Google Ads: primeiras campanhas'][i] ??
                'O que será trabalhado'
              }
            />
            {i >= MINIMO && (
              <button
                type="button"
                onClick={() => setMeses((l) => l.filter((_, j) => j !== i))}
                className="text-foreground/30 hover:text-danger"
                aria-label={`Remover mês ${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {meses.length < MAXIMO ? (
          <Button variant="ghost" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setMeses((l) => [...l, ''])}>
            Adicionar mês
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {sujo && <span className="text-xs text-warning">alterações não salvas</span>}
          <Button size="sm" loading={salvando} disabled={!sujo} onClick={() => void salvar()}>
            Salvar roteiro
          </Button>
        </div>
      </div>
    </div>
  )
}
