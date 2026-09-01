import { query, queryOne } from '../db.js';

/**
 * Geração automática de lançamentos de comissão (aba Gestão Interna) a partir de eventos que já
 * acontecem no sistema — venda marcada no funil/avulsa, entrega concluída. Cada gatilho grava
 * `source_type`/`source_id` no lançamento gerado, então rodar o gatilho de novo (ex.: reabrir e
 * fechar a venda outra vez) atualiza o lançamento já existente em vez de duplicar. Nunca lança:
 * comissão é um efeito colateral de uma ação do usuário, falhar aqui não pode derrubar o PATCH
 * que a pessoa acabou de fazer.
 */

type CommissionTypeRow = {
  id: string;
  role: 'sdr' | 'suporte';
  label: string;
  kind: 'fixed' | 'percent';
  rate_cents: number | null;
  rate_percent: string | null;
};

/** "R$ 1.234,56" (ou qualquer string com dígitos) -> 123456 centavos. */
export function parseBRLCentsServer(value: string | null | undefined): number {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function currentMonthId(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function getCommissionType(role: 'sdr' | 'suporte', label: string): Promise<CommissionTypeRow | null> {
  return queryOne<CommissionTypeRow>(
    'SELECT * FROM commission_types WHERE role = $1 AND label = $2',
    [role, label]
  );
}

function amountForType(type: CommissionTypeRow, baseValueCents: number): number {
  if (type.kind === 'fixed') return type.rate_cents ?? 0;
  const percent = type.rate_percent !== null ? Number(type.rate_percent) : 0;
  return Math.round((baseValueCents * percent) / 100);
}

/**
 * Lançamento automático "único por venda" (SDR fixo ao marcar Vendido, Suporte % ao marcar tipo
 * de venda avulsa) — só existe UM lançamento auto por (source_type, source_id): trocar a
 * classificação (ex.: Sistema -> Tráfego) substitui o lançamento anterior em vez de somar outro.
 */
export async function upsertSingleSourceCommission(params: {
  sourceType: string;
  sourceId: string;
  role: 'sdr' | 'suporte';
  typeLabel: string;
  person: string;
  reference: string;
  baseValueCents?: number | null;
  month?: string;
}): Promise<void> {
  try {
    if (!params.person?.trim()) return;
    const type = await getCommissionType(params.role, params.typeLabel);
    if (!type) return;
    const baseValueCents = params.baseValueCents ?? 0;
    const amountCents = amountForType(type, baseValueCents);
    if (amountCents <= 0) return;

    await query('DELETE FROM commission_entries WHERE source_type = $1 AND source_id = $2', [
      params.sourceType,
      params.sourceId,
    ]);
    await query(
      `INSERT INTO commission_entries
        (person, role, type_id, type_label, reference, base_value_cents, amount_cents, month, source_type, source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        params.person.trim(),
        params.role,
        type.id,
        type.label,
        params.reference,
        type.kind === 'percent' ? baseValueCents : null,
        amountCents,
        params.month ?? currentMonthId(),
        params.sourceType,
        params.sourceId,
      ]
    );
  } catch (err) {
    console.error('[commissions] falha ao gerar lançamento automático', params.sourceType, params.sourceId, err);
  }
}

/**
 * Lançamento automático "um por tipo aplicável" (entrega concluída pode acionar mais de um tipo
 * ao mesmo tempo — ex.: API Oficial + IA Avançada no mesmo cliente). Cada (source_type, source_id,
 * type_id) só entra uma vez (UNIQUE em commission_entries) — reprocessar o mesmo evento não duplica.
 */
export async function upsertMultiSourceCommissions(params: {
  sourceType: string;
  sourceId: string;
  role: 'sdr' | 'suporte';
  typeLabels: string[];
  person: string;
  reference: string;
  month?: string;
}): Promise<void> {
  try {
    if (!params.person?.trim() || !params.typeLabels.length) return;
    for (const label of params.typeLabels) {
      const type = await getCommissionType(params.role, label);
      if (!type) continue;
      const amountCents = amountForType(type, 0);
      if (amountCents <= 0) continue;
      await query(
        `INSERT INTO commission_entries
          (person, role, type_id, type_label, reference, base_value_cents, amount_cents, month, source_type, source_id)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9)
         ON CONFLICT (source_type, source_id, type_id) DO NOTHING`,
        [
          params.person.trim(),
          params.role,
          type.id,
          type.label,
          params.reference,
          amountCents,
          params.month ?? currentMonthId(),
          params.sourceType,
          params.sourceId,
        ]
      );
    }
  } catch (err) {
    console.error('[commissions] falha ao gerar lançamentos automáticos', params.sourceType, params.sourceId, err);
  }
}
