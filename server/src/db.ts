import { Pool, PoolClient } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle pg client', err);
});

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// LISTEN/NOTIFY listener for SSE realtime
let listenerClient: PoolClient | null = null;
type NotifyHandler = (table: string, type: string, data: Record<string, unknown>) => void;
const handlers: NotifyHandler[] = [];

export function onDbChange(handler: NotifyHandler) {
  handlers.push(handler);
}

/** Idempotent schema migrations — safe to run on every startup. */
export async function runMigrations() {
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS servers JSONB`);
  console.log('[db] migrations applied');
}

export async function startRealtimeListener() {
  listenerClient = await pool.connect();
  listenerClient.on('notification', (msg) => {
    if (!msg.payload) return;
    try {
      const payload = JSON.parse(msg.payload) as {
        table: string;
        type: string;
        data: Record<string, unknown>;
      };
      handlers.forEach((h) => h(payload.table, payload.type, payload.data));
    } catch {
      // ignore malformed payloads
    }
  });
  await listenerClient.query('LISTEN db_changes');
  console.log('PostgreSQL LISTEN started on channel db_changes');
}
