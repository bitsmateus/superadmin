import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** **negrito** e `código` dentro de uma linha. */
function emLinha(texto: string): React.ReactNode[] {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return partes.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="rounded bg-elevate/[0.08] px-1 text-[0.9em]">{p.slice(1, -1)}</code>
    return <React.Fragment key={i}>{p}</React.Fragment>
  })
}

/**
 * Markdown simples da IA (títulos, listas, negrito, tabelas com |) sem biblioteca: o que a IA
 * devolve é sempre esse subconjunto, e o texto nunca vira HTML cru (nada de innerHTML).
 */
export function TextoIa({ texto, className }: { texto: string; className?: string }) {
  const linhas = texto.replace(/\r/g, '').split('\n')
  const blocos: React.ReactNode[] = []
  let i = 0
  while (i < linhas.length) {
    const l = linhas[i]
    const t = l.trim()
    if (!t) { i++; continue }
    if (/^\|.*\|$/.test(t)) {
      const tabela: string[][] = []
      while (i < linhas.length && /^\|.*\|$/.test(linhas[i].trim())) {
        const cel = linhas[i].trim().slice(1, -1).split('|').map((c) => c.trim())
        if (!cel.every((c) => /^:?-{2,}:?$/.test(c))) tabela.push(cel)
        i++
      }
      blocos.push(
        <div key={blocos.length} className="overflow-x-auto">
          <table className="my-1 w-full text-xs">
            <tbody>
              {tabela.map((r, ri) => (
                <tr key={ri} className={cn('border-b border-line/60', ri === 0 && 'font-semibold')}>
                  {r.map((c, ci) => <td key={ci} className="px-2 py-1">{emLinha(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t)
    if (h) {
      blocos.push(<p key={blocos.length} className={cn('mt-2 font-semibold text-foreground', h[1].length <= 2 ? 'text-base' : 'text-sm')}>{emLinha(h[2])}</p>)
      i++
      continue
    }
    if (/^([-*•]|\d+[.)])\s+/.test(t)) {
      const itens: string[] = []
      const numerada = /^\d+[.)]/.test(t)
      while (i < linhas.length && /^([-*•]|\d+[.)])\s+/.test(linhas[i].trim())) {
        itens.push(linhas[i].trim().replace(/^([-*•]|\d+[.)])\s+/, ''))
        i++
      }
      const Lista = numerada ? 'ol' : 'ul'
      blocos.push(
        <Lista key={blocos.length} className={cn('space-y-0.5 pl-5', numerada ? 'list-decimal' : 'list-disc')}>
          {itens.map((it, k) => <li key={k}>{emLinha(it)}</li>)}
        </Lista>,
      )
      continue
    }
    blocos.push(<p key={blocos.length}>{emLinha(t)}</p>)
    i++
  }
  return <div className={cn('space-y-1.5 text-sm leading-relaxed text-foreground/85', className)}>{blocos}</div>
}

export function BotaoCopiar({ texto, rotulo = 'Copiar', className }: { texto: string; rotulo?: string; className?: string }) {
  const [ok, setOk] = React.useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(texto).then(
          () => { setOk(true); window.setTimeout(() => setOk(false), 1500) },
          () => toast.error('Não consegui copiar'),
        )
      }}
      className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-foreground/55 hover:bg-elevate/[0.06] hover:text-foreground', className)}
    >
      {ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {ok ? 'Copiado' : rotulo}
    </button>
  )
}
