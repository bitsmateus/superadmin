/**
 * Aplica a migração do módulo Pontos (só cria tabelas novas `ponto_*`; pode rodar de novo sem problema).
 *   produção:        node dist/pontos/migrar.js        (no console do serviço, com DATABASE_URL já configurado)
 *   desenvolvimento: npx tsx src/pontos/migrar.ts
 */
import { pool } from '../db.js';
import { migrarPontos } from './migracao.js';

migrarPontos(pool)
  .then(() => { console.log('[pontos] migração aplicada (tabelas ponto_*).'); return pool.end(); })
  .catch((err) => { console.error('[pontos] falha na migração', err); process.exitCode = 1; return pool.end(); });
