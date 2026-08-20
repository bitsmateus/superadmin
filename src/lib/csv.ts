/** Detecta se o CSV usa "," ou ";" como separador, olhando a primeira linha. */
function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r\n|\n|\r/)[0] ?? ''
  const semi = (firstLine.match(/;/g) ?? []).length
  const comma = (firstLine.match(/,/g) ?? []).length
  return semi >= comma ? ';' : ','
}

/** Parser de CSV simples com suporte a campos entre aspas (com delimitador/quebra de linha
 * dentro) e aspas duplas escapadas (""). Detecta "," ou ";" sozinho e ignora BOM do Excel. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(clean)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < clean.length) {
    const char = clean[i]
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }
    if (char === '"') { inQuotes = true; i += 1; continue }
    if (char === delimiter) { row.push(field); field = ''; i += 1; continue }
    if (char === '\r') { i += 1; continue }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue }
    field += char
    i += 1
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }

  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}
