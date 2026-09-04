import * as XLSX from 'xlsx';

// O corpo da requisição já vem em base64 dentro de um JSON (~33% maior que o arquivo real) — fica
// bem abaixo do bodyLimit de 20MB do Fastify (ver server/src/index.ts) mesmo nesse pior caso.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB decodificado
const MAX_ROWS = 50_000;

/** Lê a planilha (CSV/XLS/XLSX) mandada como data URL (`data:...;base64,xxxx`, formato que
 *  `FileReader.readAsDataURL` gera no navegador) e devolve o cabeçalho + as linhas como objetos
 *  simples (coluna → texto). Sempre a PRIMEIRA aba — é um disparo em massa simples, não uma
 *  planilha com múltiplas abas de dados. */
export function parseSpreadsheet(dataUrl: string): { header: string[]; rows: Record<string, string>[] } {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error('Arquivo muito grande (máximo 15MB).');

  const wb = XLSX.read(buf, { type: 'buffer', codepage: 65001 });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Planilha vazia ou em formato não reconhecido.');
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (!json.length) return { header: [], rows: [] };

  const header = Object.keys(json[0]);
  if (json.length > MAX_ROWS) throw new Error(`A planilha passa de ${MAX_ROWS.toLocaleString('pt-BR')} linhas.`);
  const rows = json.map((r) => {
    const out: Record<string, string> = {};
    for (const k of header) out[k] = String(r[k] ?? '').trim();
    return out;
  });
  return { header, rows };
}

/** Junta DDI/DDD padrão a um telefone só com o que faltar — mesma regra já validada em produção
 *  no Recorrai (import.service.ts#montarTelefone): número já completo não é mexido; número sem
 *  DDD (8-9 dígitos) recebe o DDD padrão; ainda sem DDI (10-11 dígitos) recebe o DDI padrão. */
export function normalizePhone(raw: string, ddi?: string, ddd?: string): string | null {
  let d = (raw || '').replace(/\D/g, '');
  if (!d) return null;
  const ddiN = (ddi || '').replace(/\D/g, '');
  const dddN = (ddd || '').replace(/\D/g, '');
  if (d.length <= 9 && dddN) d = dddN + d;
  if (ddiN && d.length <= 11) d = ddiN + d;
  return d.length >= 10 ? d : null;
}
