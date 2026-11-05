import { query } from '../db.js';
import { publicarAgendamento } from '../lib/gcSocialPublicar.js';

/**
 * Publica as postagens agendadas do Social media (gc_social_agendamentos) quando chega a hora.
 * Roda a cada minuto. Pega a vez com UPDATE ... FOR UPDATE SKIP LOCKED: dois servidores (ou dois ticks)
 * nunca publicam o mesmo post duas vezes. O que ficou em 'publicando' por mais de 20 min (servidor caiu
 * no meio) vira erro, pra a equipe ver e decidir se publica de novo — repetir sozinho poderia duplicar.
 */

let rodando = false;

async function rodada(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    await query(
      `UPDATE gc_social_agendamentos
       SET status = 'erro', erro = 'A publicação foi interrompida (servidor reiniciou). Confira no Instagram/Facebook antes de publicar de novo.',
           updated_at = NOW()
       WHERE status = 'publicando' AND updated_at < NOW() - INTERVAL '20 minutes'`,
    );
    const vez = await query<{ id: string }>(
      `UPDATE gc_social_agendamentos SET status = 'publicando', updated_at = NOW()
       WHERE id IN (
         SELECT id FROM gc_social_agendamentos
         WHERE status = 'agendado' AND agendado_para <= NOW()
         ORDER BY agendado_para LIMIT 5 FOR UPDATE SKIP LOCKED
       ) RETURNING id`,
    );
    for (const { id } of vez) await publicarAgendamento(id);
    if (vez.length) console.log(`[social] ${vez.length} postagem(ns) agendada(s) processada(s)`);
  } catch (err) {
    console.error('[social] erro nas postagens agendadas', err instanceof Error ? err.message : err);
  } finally {
    rodando = false;
  }
}

export function startGcSocialAgendamentos(): void {
  setTimeout(() => void rodada(), 30_000);
  setInterval(() => void rodada(), 60_000);
  console.log('[social] postagens agendadas do Social media: conferindo a cada minuto');
}
