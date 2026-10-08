import {
  metaAdsConfig, sincronizarCatalogoMeta, sincronizarInsightsMeta, temInsights,
} from '../lib/metaInsights.js';

/**
 * Coleta diária de gasto do Meta (Inteligência de Tráfego, fase 1B).
 * - Catálogo (campanhas/conjuntos/anúncios/criativos): 06h.
 * - Insights: 06h e a cada 3h até 21h, regravando os últimos 7 dias (o Meta ajusta números depois).
 * - Primeira vez (tabela vazia): puxa 90 dias de histórico.
 * Sem META_ADS_TOKEN / META_AD_ACCOUNT_ID, fica inerte.
 */

const TZ = 'America/Sao_Paulo';
const HORAS_INSIGHTS = [6, 9, 12, 15, 18, 21];
const JANELA_MIN = 9; // tick de 1 min, dispara nos primeiros minutos da hora
const DIAS_REGRAVAR = 7;
const DIAS_HISTORICO = 90;

function spAgora(): { dia: string; hora: number; minuto: number } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  return { dia: `${g('year')}-${g('month')}-${g('day')}`, hora: Number(g('hour')) % 24, minuto: Number(g('minute')) };
}

let rodando = false;

async function rodar(catalogo: boolean): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    if (catalogo) {
      const c = await sincronizarCatalogoMeta();
      if (c) console.log(`[meta-sync] catálogo: ${c.campanhas} campanhas, ${c.conjuntos} conjuntos, ${c.anuncios} anúncios`);
    }
    const dias = (await temInsights()) ? DIAS_REGRAVAR : DIAS_HISTORICO;
    const r = await sincronizarInsightsMeta(dias);
    if (r) console.log(`[meta-sync] insights: ${r.linhas} linhas (${r.desde} → ${r.ate})`);
  } catch (err) {
    console.error('[meta-sync] erro', err instanceof Error ? err.message : err);
  } finally {
    rodando = false;
  }
}

export function startMetaInsightsSync(): void {
  if (!metaAdsConfig()) {
    console.log('[meta-sync] META_ADS_TOKEN/META_AD_ACCOUNT_ID não configurados — coleta de gasto desligada');
    return;
  }

  // Ao subir o servidor: já traz os dados (e o histórico, se ainda não houver nada).
  setTimeout(() => void rodar(true), 45_000);

  let ultimoSlot = '';
  setInterval(() => {
    const { dia, hora, minuto } = spAgora();
    if (!HORAS_INSIGHTS.includes(hora) || minuto >= JANELA_MIN) return;
    const slot = `${dia}-${hora}`;
    if (slot === ultimoSlot) return;
    ultimoSlot = slot;
    void rodar(hora === 6);
  }, 60_000);

  console.log('[meta-sync] coleta de gasto do Meta ativa (06h–21h, a cada 3h)');
}
