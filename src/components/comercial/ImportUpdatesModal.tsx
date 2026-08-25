import * as React from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Upload } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { leadNotesService } from '@/services/leadNotes'
import { normalizeText, parseImportedDate, fixMojibake, escapeHtml } from '@/lib/importDates'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

interface ImportedUpdate {
  authorName: string
  content: string
  createdAt: string | null
}

/** Junta linha "órfã" (poucas colunas, sem cara de registro novo) na última coluna do registro
 * anterior — é o que sobra quando o Texto de uma atualização tem quebra de linha de verdade dentro
 * dele: o arquivo tab-separado não escapa isso, então a quebra vira uma "linha" solta no meio. */
function splitLogicalRows(rawLines: string[], expectedCols: number): string[][] {
  const rows: string[][] = []
  let current: string[] | null = null
  for (const rawLine of rawLines) {
    if (rawLine.trim() === '') continue
    const cols = rawLine.split('\t')
    const looksLikeNewRow = cols.length >= expectedCols && cols[0].trim() !== ''
    if (looksLikeNewRow || !current) {
      if (current) rows.push(current)
      current = cols
    } else {
      current[current.length - 1] = `${current[current.length - 1]}\n${rawLine}`
    }
  }
  if (current) rows.push(current)
  return rows
}

/** Uma linha por atualização: "Nº, Nome, Empresa, Telefone, Data, Autor, Texto" (é o formato que
 * o Monday exporta pra atualizações, uma linha por evento, mesmo nome repetido). Detecta as
 * colunas pelo cabeçalho em vez de fixar posição, pra aguentar pequenas variações de planilha. */
function parseUpdatesTsv(text: string): { byName: Map<string, ImportedUpdate[]>; headerFound: boolean } {
  const rawLines = text.split(/\r?\n/)
  const byName = new Map<string, ImportedUpdate[]>()
  const firstNonBlankIdx = rawLines.findIndex((l) => l.trim().length > 0)
  if (firstNonBlankIdx === -1) return { byName, headerFound: false }

  const headerCols = rawLines[firstNonBlankIdx].split('\t').map((h) => normalizeText(h))
  const idx = {
    nome: headerCols.findIndex((h) => h.includes('nome')),
    data: headerCols.findIndex((h) => h === 'data' || h.includes('data')),
    autor: headerCols.findIndex((h) => h.includes('autor')),
    texto: headerCols.findIndex((h) => h.includes('texto') || h.includes('conteudo') || h.includes('atualizacao') || h.includes('mensagem')),
  }
  const headerFound = idx.nome !== -1 && idx.data !== -1 && idx.texto !== -1
  // Sem cabeçalho reconhecido, chuta a ordem do exemplo (Nº, Nome, Empresa, Telefone, Data, Autor, Texto).
  const cols = headerFound ? idx : { nome: 1, data: 4, autor: 5, texto: 6 }
  const expectedCols = headerFound ? headerCols.length : Math.max(cols.nome, cols.data, cols.autor, cols.texto) + 1
  const dataRawLines = headerFound ? rawLines.slice(firstNonBlankIdx + 1) : rawLines

  for (const parts of splitLogicalRows(dataRawLines, expectedCols)) {
    const nome = fixMojibake((parts[cols.nome] ?? '').trim())
    const data = (parts[cols.data] ?? '').trim()
    const autor = fixMojibake((parts[cols.autor] ?? '').trim())
    // escapeHtml por último — a anotação é exibida via dangerouslySetInnerHTML, então "<", ">" e
    // "&" digitados de propósito no texto precisam virar entidade, senão viram HTML de verdade.
    // Quebra de linha (\n) não precisa de tratamento: o CSS já usa white-space:pre-wrap.
    const texto = escapeHtml(fixMojibake((parts[cols.texto] ?? '').trim()))
    if (!nome || !texto) continue
    const entry: ImportedUpdate = { authorName: autor || 'Importado', content: texto, createdAt: parseImportedDate(data) }
    const list = byName.get(nome) ?? []
    list.push(entry)
    byName.set(nome, list)
  }
  return { byName, headerFound }
}

export interface ImportUpdatesModalProps {
  open: boolean
  onClose: () => void
  boards: LeadBoard[]
  allRows: LeadRow[]
}

/** Cola/sobe um txt/tsv com atualizações de leads que JÁ EXISTEM no quadro (ex.: exportado do
 * Monday) e credita cada uma na lead certa, casando pelo nome — diferente do "Importar" (que cria
 * leads novas), aqui nenhuma lead é criada, só as anotações são acrescentadas nas que já estão lá. */
export function ImportUpdatesModal({ open, onClose, boards, allRows }: ImportUpdatesModalProps) {
  const [boardId, setBoardId] = React.useState('')
  const [text, setText] = React.useState('')
  const [checked, setChecked] = React.useState<{
    matched: { row: LeadRow; updates: ImportedUpdate[] }[]
    unmatched: string[]
    totalUpdates: number
  } | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [result, setResult] = React.useState<{ leads: number; updates: number } | null>(null)

  React.useEffect(() => {
    if (!open) return
    setBoardId(boards[0]?.id ?? '')
    setText('')
    setChecked(null)
    setImporting(false)
    setResult(null)
  }, [open, boards])

  const boardRows = React.useMemo(() => allRows.filter((r) => r.boardId === boardId), [allRows, boardId])

  const handleFile = async (file: File) => {
    setText(await file.text())
    setChecked(null)
  }

  const check = () => {
    const { byName, headerFound } = parseUpdatesTsv(text)
    if (!headerFound) {
      toast.error('Não encontrei as colunas "Nome", "Data" e "Texto" no cabeçalho — confira o arquivo.')
    }
    const rowByName = new Map(boardRows.map((r) => [normalizeText(r.nome), r]))
    const matched: { row: LeadRow; updates: ImportedUpdate[] }[] = []
    const unmatched: string[] = []
    let totalUpdates = 0
    for (const [nome, updates] of byName) {
      const row = rowByName.get(normalizeText(nome))
      if (row) { matched.push({ row, updates }); totalUpdates += updates.length }
      else unmatched.push(nome)
    }
    setChecked({ matched, unmatched, totalUpdates })
  }

  const runImport = async () => {
    if (!checked) return
    setImporting(true)
    let updates = 0
    for (const { row, updates: entries } of checked.matched) {
      await Promise.all(entries.map((e) => leadNotesService.importNote(row.id, e.content, e.authorName, e.createdAt)))
      updates += entries.length
    }
    setResult({ leads: checked.matched.length, updates })
    setImporting(false)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar atualizações"
      description='Cola ou sobe um txt/tsv com "Nome, Data, Autor, Texto" — credita cada atualização na lead que JÁ EXISTE no quadro (casando pelo nome), sem criar nenhuma lead nova.'
      size="lg"
      footer={
        result ? (
          <Button onClick={onClose}>Fechar</Button>
        ) : checked ? (
          <>
            <Button variant="secondary" onClick={() => setChecked(null)} disabled={importing}>Voltar</Button>
            <Button onClick={runImport} loading={importing} disabled={checked.matched.length === 0}>
              {importing ? 'Importando…' : `Importar ${checked.totalUpdates} atualização(ões)`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={check} disabled={!text.trim() || !boardId}>Conferir</Button>
          </>
        )
      }
    >
      {result ? (
        <div className="grid place-items-center py-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-success" />
          <p className="mt-3 text-sm text-foreground">Importação concluída</p>
          <p className="mt-1 text-xs text-foreground/55">
            {result.updates} atualização{result.updates === 1 ? '' : 'ões'} em {result.leads} lead{result.leads === 1 ? '' : 's'}
          </p>
        </div>
      ) : checked ? (
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1 rounded-lg border border-line bg-elevate/[0.02] p-3 text-center">
              <p className="text-lg font-semibold text-foreground">{checked.matched.length}</p>
              <p className="text-[11px] text-foreground/50">lead(s) encontrada(s)</p>
            </div>
            <div className="flex-1 rounded-lg border border-line bg-elevate/[0.02] p-3 text-center">
              <p className="text-lg font-semibold text-foreground">{checked.totalUpdates}</p>
              <p className="text-[11px] text-foreground/50">atualização(ões) no total</p>
            </div>
            <div className="flex-1 rounded-lg border border-danger/30 bg-danger/5 p-3 text-center">
              <p className="text-lg font-semibold text-danger">{checked.unmatched.length}</p>
              <p className="text-[11px] text-foreground/50">nome(s) não encontrado(s)</p>
            </div>
          </div>
          {checked.unmatched.length > 0 && (
            <div className="rounded-lg border border-line p-2">
              <p className="mb-1.5 text-[11px] font-medium text-foreground/60">Não encontrados neste quadro (confira o nome):</p>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-foreground/70">
                {checked.unmatched.map((n) => <li key={n}>• {n}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Select
            label="Quadro"
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            options={boards.map((b) => ({ value: b.id, label: b.name }))}
          />
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-foreground/70">Conteúdo do arquivo</label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-accent hover:underline">
                <Upload className="h-3.5 w-3.5" />
                Subir arquivo
                <input
                  type="file"
                  accept=".txt,.tsv,.csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
                />
              </label>
            </div>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setChecked(null) }}
              placeholder={'Nome\tData\tAutor\tTexto\nMaria Teresa Baracho\t17/08/2026 13:11\tArthur\tcaixa postal'}
              className="h-56 w-full resize-none rounded-lg border border-line bg-surface p-3 font-mono text-xs text-foreground outline-none focus:border-accent"
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
