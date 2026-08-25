/** Minúsculo, sem acento — usado pra comparar nomes de coluna/campo/mês sem se importar com
 * maiúscula ou acentuação (planilha exportada às vezes vem com grafia levemente diferente). */
export function normalizeText(s: string): string {
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

const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, abr: 3, may: 4, mai: 4, jun: 5, jul: 6,
  aug: 7, ago: 7, sep: 8, set: 8, oct: 9, out: 9, nov: 10, dec: 11, dez: 11,
}

/** Aceita "dd/mm/aaaa", "dd/mm/aa", "aaaa-mm-dd" (com hora opcional hh:mm[:ss]) e o formato que o
 * Monday.com exporta ("Aug 15, 2026 2:32 PM") — os formatos mais comuns de planilha exportada do
 * Excel/Sheets/CRM antigo. Sem match reconhecido, cai pro Date nativo do JS como último recurso;
 * se nem assim der, null (quem chama decide o que fazer — normalmente cair na data/hora atual). */
export function parseImportedDate(raw: string): string | null {
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
    const month = MONTH_NAMES[normalizeText(monthRaw).slice(0, 3)]
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

/** "Ã"/"Â" sozinho é raro de sobrar em português real, mas só isso daria falso positivo em texto
 * já correto — exige o padrão completo (a letra + o byte de continuação UTF-8 típico logo depois)
 * antes de considerar mojibake. Ex.: "Ã¡" (bytes 0xC3 0xA1) é literalmente os 2 bytes UTF-8 de "á"
 * relidos como Latin-1; comparação por código numérico evita qualquer problema de caractere de
 * controle "invisível" escondido dentro de uma regex. */
function looksLikeMojibake(s: string): boolean {
  for (let i = 0; i < s.length - 1; i++) {
    const c1 = s.charCodeAt(i)
    if (c1 !== 0xc3 && c1 !== 0xc2) continue
    const c2 = s.charCodeAt(i + 1)
    if (c2 >= 0x80 && c2 <= 0xbf) return true
  }
  return false
}

/** Corrige o mojibake clássico de um arquivo UTF-8 salvo/lido como Latin-1 (ex.: "FÃ¡veri" em vez
 * de "Fáveri", "nÃ£o" em vez de "não") — comum em planilha exportada de fora e colada/salva sem o
 * encoding certo. Só mexe se detectar o padrão específico de mojibake, e desiste por completo
 * (devolve o texto original, sem tocar em nada) se achar QUALQUER caractere fora do Latin-1 —
 * emoji e afins não são mojibake, e forçar a conversão neles corromperia o texto. */
export function fixMojibake(s: string): string {
  if (!s || !looksLikeMojibake(s)) return s
  const codePoints = Array.from(s).map((ch) => ch.codePointAt(0) ?? 0)
  if (codePoints.some((code) => code > 0xff)) return s
  try {
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(codePoints))
    return fixed || s
  } catch {
    return s
  }
}

/** Escapa &, < e > antes de guardar texto solto num campo que é renderizado como HTML (ex.:
 * conteúdo de anotação, que passa por dangerouslySetInnerHTML) — sem isso, um "<" ou "&" digitado
 * de propósito vira início de tag/entidade em vez de aparecer como texto. Quebra de linha (\n)
 * NÃO precisa virar `<br>`: o CSS que exibe a anotação já usa white-space:pre-wrap, então a quebra
 * literal já renderiza certinho sozinha. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
