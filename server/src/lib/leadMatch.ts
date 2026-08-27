import { query } from '../db.js';

/**
 * Acha o lead_row (card do CRM) que provavelmente é o mesmo prospect de um `clients` — não existe
 * vínculo direto entre as duas tabelas (cadastros separados do mesmo prospect), então o match é
 * heurístico. Usado por advanceClientToBriefing (cópia de Atualizações pro Briefing) e por
 * GET /api/clients/:id/crm-lead (painel de dados do SDR na aba Contrato).
 *
 * Ordem: telefone primeiro (mais confiável quando preenchido); se não achar exatamente 1 (0 ou
 * ambíguo), cai pro nome/empresa — muitos leads do CRM não têm telefone preenchido (o SDR marca
 * status sem digitar o número), então telefone sozinho deixa isso sem achar nada. Em QUALQUER
 * critério, só devolve resultado se achar exatamente 1 candidato — 0 ou 2+ = null, silencioso mas
 * seguro (nunca expõe/copia dado de gente errada por causa de um match ambíguo).
 */
export async function findMatchingLeadRowId(
  phone: string | null | undefined,
  name: string | null | undefined,
  company: string | null | undefined,
): Promise<string | null> {
  const key = phoneKey(phone);
  if (key) {
    const byPhone = await query<{ id: string }>(
      `SELECT id FROM lead_rows WHERE deleted_at IS NULL AND right(regexp_replace(telefone, '\\D', '', 'g'), 8) = $1`,
      [key]
    );
    if (byPhone.length === 1) return byPhone[0].id;
  }

  const needle = normalizeName(company) || normalizeName(name);
  if (!needle) return null;

  const candidates = await query<{ id: string; nome: string; empresa: string }>(
    `SELECT id, nome, empresa FROM lead_rows WHERE deleted_at IS NULL AND (nome <> '' OR empresa <> '')`
  );
  // Nome/empresa curto ou genérico ("D", "Brasil") vira falso positivo por containment contra
  // quase qualquer texto — exige os DOIS lados com pelo menos MIN_LEN caracteres normalizados pra
  // considerar o match, senão nomes curtos empatam entre vários leads sem relação nenhuma (o que
  // já era "seguro" — vira ambíguo e não copia nada — mas escondia o match certo que existia).
  const MIN_LEN = 8;
  const matches = candidates.filter((c) => {
    const leadNeedle = normalizeName(c.empresa) || normalizeName(c.nome);
    if (leadNeedle.length < MIN_LEN || needle.length < MIN_LEN) return false;
    return needle.includes(leadNeedle) || leadNeedle.includes(needle);
  });
  return matches.length === 1 ? matches[0].id : null;
}

/** Só os últimos 8 dígitos — tolera diferença de DDI (55) e o "9" extra que nem todo cadastro
 * tem, sem exigir que os dois números estejam no formato exatamente igual. */
function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
}

/** minúsculo, sem acento, só letras/números — pra comparar "Instituto Brasil" com "INSTITUTO
 * BRASIL COSMÉTICOS..." ignorando maiúscula/acento/pontuação. */
function normalizeName(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
