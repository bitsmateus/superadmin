import { query, queryOne } from '../db.js';
import { advanceClientToBriefing } from '../lib/briefingHandoff.js';
import { propagarContratoAssinado } from '../lib/contractSignal.js';

/**
 * "Assinou no Autentique -> marca como assinado aqui", sem depender de webhook.
 *
 * O webhook (ver routes/webhooks.ts) continua valendo e é instantâneo quando está cadastrado
 * direito no painel do Autentique. O problema é que não dá pra CONFERIR esse cadastro de fora — e,
 * na prática, os contratos assinados vinham sendo marcados à mão (o registro mostrava de 19 a 95
 * minutos de atraso entre a assinatura lá e a marcação aqui, ou seja, o webhook nunca chegou).
 *
 * Então aqui o sentido é invertido: de tempos em tempos o servidor PERGUNTA ao Autentique se os
 * contratos que têm ID colado e ainda estão pendentes já foram assinados por todo mundo. Quem
 * marca e avança o cliente pra Briefing é o mesmo caminho de sempre (advanceClientToBriefing), e
 * repetir não faz mal: contrato já assinado sai da busca, e o avanço de etapa só acontece se o
 * cliente ainda estiver exatamente em "Contrato".
 */

const API_URL = 'https://api.autentique.com.br/v2/graphql';
const INTERVALO_MS = 10 * 60_000;
const PRIMEIRA_CHECAGEM_MS = 30_000;

/** Token da API do Autentique: variável de ambiente ganha da configuração salva no banco
 * (settings.autentique_api_token, mesmo lugar onde já moram a chave do Asaas e a senha do SMTP) —
 * assim dá pra trocar o token sem precisar mexer no deploy. */
async function obterToken(): Promise<string | null> {
  const doAmbiente = process.env.AUTENTIQUE_API_TOKEN?.trim();
  if (doAmbiente) return doAmbiente;
  const row = await queryOne<{ autentique_api_token: string | null }>(
    'SELECT autentique_api_token FROM settings WHERE id = true'
  );
  return row?.autentique_api_token?.trim() || null;
}

type Assinatura = { signed: { created_at: string } | null };

/** null = não deu pra saber (erro de rede/API/token) — de propósito diferente de "ainda não
 * assinado", pra nunca marcar nada por causa de uma falha de consulta. */
export async function consultarDocumento(
  token: string,
  documentId: string
): Promise<{ finalizado: boolean; assinadoEm: string | null } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query ($id: UUID!) { document(id: $id) { id signatures { signed { created_at } } } }',
        variables: { id: documentId },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn('[autentique-sync] API respondeu', res.status, 'pro documento', documentId);
      return null;
    }
    const json = (await res.json()) as {
      data?: { document?: { signatures?: Assinatura[] } | null };
      errors?: unknown;
    };
    const doc = json.data?.document;
    if (!doc) {
      // Documento apagado no Autentique ou ID colado errado — não é erro de consulta, mas também
      // não autoriza marcar nada.
      console.warn('[autentique-sync] documento não encontrado no Autentique:', documentId);
      return null;
    }
    const assinaturas = doc.signatures ?? [];
    const assinadas = assinaturas.filter((s) => s.signed);
    const finalizado = assinaturas.length > 0 && assinadas.length === assinaturas.length;
    const assinadoEm = assinadas
      .map((s) => s.signed!.created_at)
      .sort()
      .pop() ?? null;
    return { finalizado, assinadoEm };
  } catch (err) {
    console.warn('[autentique-sync] falha ao consultar', documentId, (err as Error).message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Uma passada: confere todos os contratos pendentes que têm ID do Autentique colado.
 * `dryRun` só informa o que faria, sem gravar nada (usado pra testar com dado real). */
export async function verificarContratosPendentes(opts: { dryRun?: boolean } = {}): Promise<void> {
  const token = await obterToken();
  if (!token) return;

  const contratos = await query<{ id: string; client_id: string | null; autentique_document_id: string }>(
    `SELECT id, client_id, autentique_document_id FROM contracts
     WHERE autentique_document_id IS NOT NULL AND status <> 'assinado'`
  );
  if (!contratos.length) return;
  if (opts.dryRun) console.log('[autentique-sync] (simulação) token ok,', contratos.length, 'contrato(s) pendente(s) com ID pra conferir');

  for (const c of contratos) {
    const info = await consultarDocumento(token, c.autentique_document_id);
    if (!info || !info.finalizado) continue;

    if (opts.dryRun) {
      console.log('[autentique-sync] (simulação) marcaria como assinado:', c.autentique_document_id, info.assinadoEm);
      continue;
    }

    await query(
      `UPDATE contracts SET status = 'assinado', signed_at = COALESCE($2::timestamptz, NOW()), updated_at = NOW()
       WHERE id = $1`,
      [c.id, info.assinadoEm]
    );
    if (c.client_id) await advanceClientToBriefing(c.client_id);
    await propagarContratoAssinado(c.id, true);
    console.log('[autentique-sync] contrato marcado como assinado:', c.id, '(documento', c.autentique_document_id + ')');
  }
}

let rodando = false;

/** Liga a checagem periódica (a cada 10 min, mais uma logo depois de subir o servidor). */
export function startAutentiqueSync(): void {
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await verificarContratosPendentes();
    } catch (err) {
      console.error('[autentique-sync] erro', err);
    } finally {
      rodando = false;
    }
  };

  setTimeout(tick, PRIMEIRA_CHECAGEM_MS);
  setInterval(tick, INTERVALO_MS);
  console.log('[autentique-sync] checagem de assinatura ativa (a cada 10 min)');
}
