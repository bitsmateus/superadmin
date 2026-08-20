import * as React from 'react'
import { toast } from 'sonner'
import { CheckCircle2, UploadCloud } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { leadBoardsService } from '@/services/leadBoards'
import { parseCsv } from '@/lib/csv'
import { sanitizeCurrencyRaw, prettifyCurrencyRaw } from '@/lib/currency'
import type { LeadBoard, LeadBoardPage, LeadRowField } from '@/types/leadBoard'

const IMPORT_FIELDS: { key: LeadRowField; label: string; aliases: string[] }[] = [
  { key: 'nome', label: 'Nome', aliases: ['nome', 'name', 'lead', 'cliente', 'contato'] },
  { key: 'empresa', label: 'Empresa', aliases: ['empresa', 'company', 'negocio'] },
  { key: 'telefone', label: 'Telefone', aliases: ['telefone', 'celular', 'fone', 'whatsapp', 'phone', 'numero'] },
  { key: 'tipo', label: 'Tipo', aliases: ['tipo', 'type'] },
  { key: 'diaContato', label: 'Dia de contato', aliases: ['dia de contato', 'dia contato', 'diacontato'] },
  { key: 'ligacao', label: 'Ligação', aliases: ['ligacao', 'ligação', 'call'] },
  { key: 'status', label: 'Status', aliases: ['status', 'etapa', 'estagio', 'estágio'] },
  { key: 'retornar', label: 'Retornar', aliases: ['retornar', 'follow up', 'followup', 'proximo contato', 'próximo contato'] },
  { key: 'sdr', label: 'SDR', aliases: ['sdr', 'responsavel', 'responsável', 'vendedor', 'owner'] },
  { key: 'dorCliente', label: 'Dor do cliente', aliases: ['dor do cliente', 'dor', 'observacao', 'observação', 'obs', 'nota'] },
  { key: 'numeroAtendentes', label: 'Número de atendentes', aliases: ['numero de atendentes', 'número de atendentes', 'atendentes', 'nº atendentes'] },
  { key: 'valorMrr', label: 'Valor MRR', aliases: ['valor mrr', 'mrr'] },
  {
    key: 'valorImplementacao', label: 'Valor de Implementação',
    aliases: ['valor de implementacao', 'valor de implementação', 'implementacao', 'implementação', 'implantacao', 'implantação'],
  },
]

const CURRENCY_FIELDS = new Set<LeadRowField>(['valorMrr', 'valorImplementacao'])
const NEW_BOARD = '__new__'

function normalize(s: string): string {
  const noAccents = s
    .normalize('NFD')
    .split('')
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code < 0x0300 || code > 0x036f
    })
    .join('')
  return noAccents.toLowerCase().trim()
}

function guessField(header: string): LeadRowField | '' {
  const norm = normalize(header)
  if (!norm) return ''
  const exact = IMPORT_FIELDS.find((f) => f.aliases.some((a) => normalize(a) === norm))
  if (exact) return exact.key
  const partial = IMPORT_FIELDS.find((f) => f.aliases.some((a) => norm.includes(normalize(a))))
  return partial?.key ?? ''
}

export interface LeadImportModalProps {
  open: boolean
  onClose: () => void
  page: LeadBoardPage
  boards: LeadBoard[]
}

/** Importa leads de um CSV: sobe o arquivo, mapeia cada coluna pro campo certo do quadro
 * (com um chute automático pelo nome da coluna) e cria uma linha por linha do arquivo. */
export function LeadImportModal({ open, onClose, page, boards }: LeadImportModalProps) {
  const [headers, setHeaders] = React.useState<string[]>([])
  const [dataRows, setDataRows] = React.useState<string[][]>([])
  const [mapping, setMapping] = React.useState<Record<number, LeadRowField | ''>>({})
  const [targetBoardId, setTargetBoardId] = React.useState<string>('')
  const [newBoardName, setNewBoardName] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const [result, setResult] = React.useState<{ created: number; skipped: number } | null>(null)

  React.useEffect(() => {
    if (!open) return
    setHeaders([])
    setDataRows([])
    setMapping({})
    setResult(null)
    setImporting(false)
    setTargetBoardId(boards[0]?.id ?? NEW_BOARD)
    setNewBoardName('')
  }, [open, boards])

  const handleFile = async (file: File) => {
    try {
      const text = await file.text()
      const allRows = parseCsv(text)
      if (allRows.length < 1) { toast.error('Não consegui ler nenhuma linha desse arquivo.'); return }
      const [headerRow, ...rest] = allRows
      setHeaders(headerRow)
      setDataRows(rest)
      const guessed: Record<number, LeadRowField | ''> = {}
      headerRow.forEach((h, i) => { guessed[i] = guessField(h) })
      setMapping(guessed)
    } catch (err) {
      toast.error('Falha ao ler o arquivo: ' + (err as Error).message)
    }
  }

  const mappedFieldCount = Object.values(mapping).filter(Boolean).length

  const runImport = () => {
    if (!mappedFieldCount) { toast.error('Mapeie pelo menos uma coluna.'); return }
    let boardId = targetBoardId
    if (boardId === NEW_BOARD) {
      const trimmed = newBoardName.trim()
      if (!trimmed) { toast.error('Dê um nome pro quadro novo.'); return }
      boardId = leadBoardsService.createBoard(trimmed, '#4F8EF7', page).id
    }

    setImporting(true)
    let created = 0
    let skipped = 0
    for (const dataRow of dataRows) {
      const patch: Partial<Record<LeadRowField, string>> = {}
      for (const [idxStr, field] of Object.entries(mapping)) {
        if (!field) continue
        const idx = Number(idxStr)
        let raw = (dataRow[idx] ?? '').trim()
        if (!raw) continue
        if (CURRENCY_FIELDS.has(field)) raw = prettifyCurrencyRaw(sanitizeCurrencyRaw(raw))
        patch[field] = raw
      }
      if (Object.keys(patch).length === 0) { skipped += 1; continue }
      leadBoardsService.createRow(boardId, patch)
      created += 1
    }
    setResult({ created, skipped })
    setImporting(false)
  }

  const firstDataRow = dataRows[0]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar leads de um CSV"
      description="Envie a planilha, confira o mapeamento das colunas e importe direto pro quadro certo."
      size="xl"
      footer={
        result ? (
          <Button onClick={onClose}>Fechar</Button>
        ) : headers.length === 0 ? (
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={importing}>Cancelar</Button>
            <Button onClick={runImport} loading={importing} disabled={!mappedFieldCount}>
              {importing ? 'Importando…' : `Importar ${dataRows.length} linha${dataRows.length === 1 ? '' : 's'}`}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="grid place-items-center py-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-success" />
          <p className="mt-3 text-sm text-foreground">Import concluído</p>
          <p className="mt-1 text-xs text-foreground/55">
            {result.created} lead{result.created === 1 ? '' : 's'} importado{result.created === 1 ? '' : 's'}
            {result.skipped > 0 && <> · {result.skipped} linha{result.skipped === 1 ? '' : 's'} vazia{result.skipped === 1 ? '' : 's'} ignorada{result.skipped === 1 ? '' : 's'}</>}
          </p>
        </div>
      ) : headers.length === 0 ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-6 py-14 text-center transition-colors hover:border-accent/50 hover:bg-accent/[0.03]">
          <UploadCloud className="h-8 w-8 text-foreground/30" />
          <p className="text-sm font-medium text-foreground">Clique para escolher um arquivo CSV</p>
          <p className="text-xs text-foreground/45">Aceita separador "," ou ";" — exporta certinho do Excel/Google Sheets.</p>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Quadro de destino"
              value={targetBoardId}
              onChange={(e) => setTargetBoardId(e.target.value)}
              options={[
                ...boards.map((b) => ({ value: b.id, label: b.name })),
                { value: NEW_BOARD, label: '+ Criar novo quadro' },
              ]}
            />
            {targetBoardId === NEW_BOARD && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground/70">Nome do novo quadro</label>
                <input
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  placeholder="Ex.: Leads importados"
                  className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground outline-none focus:border-accent"
                />
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-[1fr_1fr] gap-3 border-b border-line bg-elevate/[0.02] px-3 py-2 text-[10px] uppercase tracking-wider text-foreground/45">
              <span>Coluna do CSV (exemplo)</span>
              <span>Mapear para</span>
            </div>
            <ul className="max-h-[30vh] divide-y divide-white/[0.04] overflow-y-auto">
              {headers.map((h, i) => (
                <li key={i} className="grid grid-cols-[1fr_1fr] items-center gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">{h || `Coluna ${i + 1}`}</div>
                    <div className="truncate text-[11px] text-foreground/45">
                      {firstDataRow?.[i] ? firstDataRow[i] : <span className="italic">vazio</span>}
                    </div>
                  </div>
                  <Select
                    value={mapping[i] ?? ''}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [i]: e.target.value as LeadRowField | '' }))}
                    options={[
                      { value: '', label: 'Ignorar coluna' },
                      ...IMPORT_FIELDS.map((f) => ({ value: f.key, label: f.label })),
                    ]}
                    className="!h-9 !text-xs"
                  />
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-foreground/45">
            {dataRows.length} linha{dataRows.length === 1 ? '' : 's'} de dado no arquivo — linhas totalmente vazias nas colunas mapeadas são puladas automaticamente.
          </p>
        </div>
      )}
    </Modal>
  )
}
