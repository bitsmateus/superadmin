import * as React from 'react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { CheckCircle2, UploadCloud } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { leadBoardsService } from '@/services/leadBoards'
import { parseCsv } from '@/lib/csv'
import { sanitizeCurrencyRaw, prettifyCurrencyRaw } from '@/lib/currency'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadBoardPage, LeadRowField } from '@/types/leadBoard'

/** CSV lê como texto puro; .xlsx/.xls usa o SheetJS (só a primeira planilha do arquivo). */
async function readSpreadsheet(file: File): Promise<string[][]> {
  const isExcel = /\.xlsx?$/i.test(file.name)
    || file.type === 'application/vnd.ms-excel'
    || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (isExcel) {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
    return rows
      .map((r) => r.map((c) => String(c ?? '').trim()))
      .filter((r) => r.some((c) => c !== ''))
  }
  return parseCsv(await file.text())
}

/** `createdAt` não é um LeadRowField normal (é controlado pelo sistema, não uma coluna do
 * quadro) — mas na importação a pessoa pode ter uma data de criação antiga na planilha e quer
 * que o "Log de criação" do lead nasça com ela, em vez da data/hora do import. */
type ImportField = LeadRowField | 'createdAt'

const IMPORT_FIELDS: { key: ImportField; label: string; aliases: string[] }[] = [
  { key: 'nome', label: 'Nome', aliases: ['nome', 'name', 'lead', 'cliente', 'contato'] },
  { key: 'empresa', label: 'Empresa', aliases: ['empresa', 'company', 'negocio'] },
  { key: 'telefone', label: 'Telefone', aliases: ['telefone', 'celular', 'fone', 'whatsapp', 'phone', 'numero'] },
  { key: 'tipo', label: 'Tipo', aliases: ['tipo', 'type'] },
  { key: 'diaContato', label: 'Dia de contato', aliases: ['dia de contato', 'dia contato', 'diacontato'] },
  { key: 'ligacao', label: 'Ligação', aliases: ['ligacao', 'ligação', 'call'] },
  { key: 'status', label: 'Status', aliases: ['status', 'etapa', 'estagio', 'estágio'] },
  { key: 'agendamento', label: 'Agendamento', aliases: ['agendamento', 'data agendamento', 'dia agendado', 'agendado'] },
  { key: 'retornar', label: 'Retornar', aliases: ['retornar', 'follow up', 'followup', 'proximo contato', 'próximo contato'] },
  { key: 'sdr', label: 'SDR', aliases: ['sdr', 'responsavel', 'responsável', 'vendedor', 'owner'] },
  { key: 'dorCliente', label: 'Dor do cliente', aliases: ['dor do cliente', 'dor', 'observacao', 'observação', 'obs', 'nota'] },
  { key: 'numeroAtendentes', label: 'Número de atendentes', aliases: ['numero de atendentes', 'número de atendentes', 'atendentes', 'nº atendentes'] },
  { key: 'valorMrr', label: 'Valor MRR', aliases: ['valor mrr', 'mrr'] },
  {
    key: 'valorImplementacao', label: 'Valor de Implementação',
    aliases: ['valor de implementacao', 'valor de implementação', 'implementacao', 'implementação', 'implantacao', 'implantação'],
  },
  {
    key: 'createdAt', label: 'Log de criação (data de criação)',
    aliases: ['log de criacao', 'log de criação', 'data de criacao', 'data de criação', 'criado em', 'data de cadastro', 'data cadastro'],
  },
]

const CURRENCY_FIELDS = new Set<LeadRowField>(['valorMrr', 'valorImplementacao'])
const NEW_BOARD = '__new__'

const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, abr: 3, may: 4, mai: 4, jun: 5, jul: 6,
  aug: 7, ago: 7, sep: 8, set: 8, oct: 9, out: 9, nov: 10, dec: 11, dez: 11,
}

/** Aceita "dd/mm/aaaa", "dd/mm/aa", "aaaa-mm-dd" (com hora opcional hh:mm[:ss]) e o formato que o
 * Monday.com exporta pro "Log de criação" ("Aug 15, 2026 2:32 PM") — os formatos mais comuns de
 * planilha exportada do Excel/Sheets/CRM antigo. Sem match reconhecido, cai pro Date nativo do JS
 * como último recurso; se nem assim der, null = a linha nasce com a data/hora do import mesmo. */
function parseImportedDate(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (br) {
    const [, dd, mm, yy, hh, min, sec] = br
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy)
    const d = new Date(year, Number(mm) - 1, Number(dd), Number(hh ?? 0), Number(min ?? 0), Number(sec ?? 0))
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (iso) {
    const [, yyyy, mm, dd, hh, min, sec] = iso
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh ?? 0), Number(min ?? 0), Number(sec ?? 0))
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  // "Aug 15, 2026 2:32 PM" / "15 Aug 2026 14:32" — Monday.com e afins.
  const named = s.match(/^([A-Za-zçãéíóú]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?)?$/)
    ?? s.match(/^(\d{1,2})\s+([A-Za-zçãéíóú]{3,9})\.?\s+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?)?$/)
  if (named) {
    const isDayFirst = /^\d/.test(named[1])
    const dd = isDayFirst ? named[1] : named[2]
    const monthRaw = isDayFirst ? named[2] : named[1]
    const yyyy = named[3]
    const [, , , , hh, min, ampm] = named
    const month = MONTH_NAMES[normalize(monthRaw).slice(0, 3)]
    if (month !== undefined) {
      let hour = hh ? Number(hh) : 0
      if (ampm) {
        const isPm = ampm.toLowerCase() === 'pm'
        if (isPm && hour !== 12) hour += 12
        if (!isPm && hour === 12) hour = 0
      }
      const d = new Date(Number(yyyy), month, Number(dd), hour, Number(min ?? 0))
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
  }

  const fallback = new Date(s)
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString()

  return null
}

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

function guessField(header: string): ImportField | '' {
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
  const [mapping, setMapping] = React.useState<Record<number, ImportField | ''>>({})
  const [targetBoardId, setTargetBoardId] = React.useState<string>('')
  const [newBoardName, setNewBoardName] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const [result, setResult] = React.useState<{ created: number; skipped: number } | null>(null)
  const [dragOver, setDragOver] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setHeaders([])
    setDataRows([])
    setMapping({})
    setResult(null)
    setImporting(false)
    setDragOver(false)
    setTargetBoardId(boards[0]?.id ?? NEW_BOARD)
    setNewBoardName('')
  }, [open, boards])

  const handleFile = async (file: File) => {
    try {
      const allRows = await readSpreadsheet(file)
      if (allRows.length < 1) { toast.error('Não consegui ler nenhuma linha desse arquivo.'); return }
      const [headerRow, ...rest] = allRows
      setHeaders(headerRow)
      setDataRows(rest)
      const guessed: Record<number, ImportField | ''> = {}
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
      let createdAt: string | null = null
      for (const [idxStr, field] of Object.entries(mapping)) {
        if (!field) continue
        const idx = Number(idxStr)
        const raw = (dataRow[idx] ?? '').trim()
        if (!raw) continue
        if (field === 'createdAt') { createdAt = parseImportedDate(raw); continue }
        patch[field] = CURRENCY_FIELDS.has(field) ? prettifyCurrencyRaw(sanitizeCurrencyRaw(raw)) : raw
      }
      if (Object.keys(patch).length === 0 && !createdAt) { skipped += 1; continue }
      leadBoardsService.createRow(boardId, createdAt ? { ...patch, createdAt } : patch)
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
      title="Importar leads de uma planilha"
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
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void handleFile(f)
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
            dragOver ? 'border-accent bg-accent/[0.06]' : 'border-line hover:border-accent/50 hover:bg-accent/[0.03]',
          )}
        >
          <UploadCloud className="h-8 w-8 text-foreground/30" />
          <p className="text-sm font-medium text-foreground">
            {dragOver ? 'Solte o arquivo aqui' : 'Arraste ou clique para escolher um arquivo CSV ou Excel'}
          </p>
          <p className="text-xs text-foreground/45">Aceita .csv (separador "," ou ";") e .xlsx/.xls — exporta certinho do Excel/Google Sheets.</p>
          <input
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
                    onChange={(e) => setMapping((prev) => ({ ...prev, [i]: e.target.value as ImportField | '' }))}
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
