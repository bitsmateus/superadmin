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
  // Fora as CÓPIAS que o próprio sistema cria (mesmo nome/telefone do original, então sem esse
  // filtro o match via 2 candidatos e a regra de inequívoco desistia mesmo com o original certinho):
  //  - venda_origem_id: cópia da aba Vendas quando o lead vira "Vendido";
  //  - espelho_origem_id: cópia no CRM do closer (espelho do CRM ARTHUR, ver leadBoards.ts).
  const key = phoneKey(phone);
  if (key) {
    const byPhone = await query<{ id: string }>(
      `SELECT id FROM lead_rows
       WHERE deleted_at IS NULL AND venda_origem_id IS NULL AND espelho_origem_id IS NULL
         AND right(regexp_replace(telefone, '\\D', '', 'g'), 8) = $1`,
      [key]
    );
    if (byPhone.length === 1) return byPhone[0].id;
  }

  const needle = normalizeName(company) || normalizeName(name);
  if (!needle) return null;

  const candidates = await query<{ id: string; nome: string; empresa: string }>(
    `SELECT id, nome, empresa FROM lead_rows
     WHERE deleted_at IS NULL AND venda_origem_id IS NULL AND espelho_origem_id IS NULL
       AND (nome <> '' OR empresa <> '')`
  );
  // Nome/empresa curto ou genérico ("D", "Brasil") vira falso positivo por containment contra
  // quase qualquer texto — exige os DOIS lados com pelo menos MIN_LEN caracteres normalizados pra
  // considerar o match, senão nomes curtos empatam entre vários leads sem relação nenhuma (o que
  // já era "seguro" — vira ambíguo e não copia nada — mas escondia o match certo que existia).
  const matches = candidates.filter((c) => {
    const leadNeedle = normalizeName(c.empresa) || normalizeName(c.nome);
    if (leadNeedle.length < MIN_LEN || needle.length < MIN_LEN) return false;
    return needle.includes(leadNeedle) || leadNeedle.includes(needle);
  });
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * O caminho contrário: acha o `clients` (quem preencheu a ficha pública) de um lead do CRM — mesma
 * heurística e a mesma garantia de só aceitar match inequívoco. A ficha grava o telefone de NF como
 * `phone` do cliente e o nome da empresa como `name`/`company`, então é contra esses que compara.
 */
export async function findMatchingClientId(
  phone: string | null | undefined,
  name: string | null | undefined,
  company: string | null | undefined,
): Promise<string | null> {
  const key = phoneKey(phone);
  if (key) {
    const byPhone = await query<{ id: string }>(
      `SELECT id FROM clients WHERE right(regexp_replace(phone, '\\D', '', 'g'), 8) = $1`,
      [key]
    );
    if (byPhone.length === 1) return byPhone[0].id;
  }

  const needle = normalizeName(company) || normalizeName(name);
  if (!needle) return null;

  const candidates = await query<{ id: string; name: string; company: string }>(
    `SELECT id, name, company FROM clients WHERE name <> '' OR company <> ''`
  );
  const matches = candidates.filter((c) => {
    const clientNeedle = normalizeName(c.company) || normalizeName(c.name);
    if (clientNeedle.length < MIN_LEN || needle.length < MIN_LEN) return false;
    return needle.includes(clientNeedle) || clientNeedle.includes(needle);
  });
  return matches.length === 1 ? matches[0].id : null;
}

/** Nome/empresa curto ou genérico vira falso positivo por containment — os dois lados precisam
 * ter pelo menos isso de caracteres normalizados pra um match por nome valer. */
export const MIN_LEN = 8;

/** Só os últimos 8 dígitos — tolera diferença de DDI (55) e o "9" extra que nem todo cadastro
 * tem, sem exigir que os dois números estejam no formato exatamente igual. */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
}

/** minúsculo, sem acento, só letras/números — pra comparar "Instituto Brasil" com "INSTITUTO
 * BRASIL COSMÉTICOS..." ignorando maiúscula/acento/pontuação. */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
