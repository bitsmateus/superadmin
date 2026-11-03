/**
 * Métricas do Demo Studio — definições exatas da §8.3, calculadas sobre os agregados das sessões
 * (ds_view_sessions). Puras: a rota busca as sessões do período já filtradas (sem internas) e chama
 * estas funções. O volume esperado (milhares de sessões/mês) cabe em memória sem problema.
 */

export interface SessaoMetrica {
  id: string;
  visitorId: string;
  demoId: string;
  linkId: string | null;
  linkLabel: string | null;
  leadId: string | null;
  startedAt: Date;
  lastSeenAt: Date;
  activeMs: number;
  maxStepOrder: number;
  stepsViewed: number;
  totalSteps: number;
  completed: boolean;
  ctaClicked: boolean;
  device: string | null;
  referrer: string | null;
  utmSource?: string | null;
}

export interface Resumo {
  /** nº de sessões */
  views: number;
  /** nº de visitorId distintos */
  unicos: number;
  /** sessões com complete ÷ sessões (0–1) */
  taxaConclusao: number;
  /** média de activeMs */
  tempoMedioMs: number;
  /** média de stepsViewed / totalSteps (0–1), só sessões com total conhecido */
  engajamentoMedio: number;
  /** sessões com cta_click */
  cliquesCta: number;
  /** sessões ligadas a um lead */
  sessoesComLead: number;
  /** sessões com lead ÷ sessões (0–1) */
  conversaoLead: number;
}

const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const razao = (a: number, b: number) => (b ? a / b : 0);

export function resumo(sessoes: SessaoMetrica[]): Resumo {
  const views = sessoes.length;
  const comTotal = sessoes.filter((s) => s.totalSteps > 0);
  const comLead = sessoes.filter((s) => s.leadId).length;
  return {
    views,
    unicos: new Set(sessoes.map((s) => s.visitorId)).size,
    taxaConclusao: razao(sessoes.filter((s) => s.completed).length, views),
    tempoMedioMs: Math.round(media(sessoes.map((s) => s.activeMs))),
    engajamentoMedio: media(comTotal.map((s) => Math.min(s.stepsViewed / s.totalSteps, 1))),
    cliquesCta: sessoes.filter((s) => s.ctaClicked).length,
    sessoesComLead: comLead,
    conversaoLead: razao(comLead, views),
  };
}

export interface EtapaDoFunil {
  order: number;
  title: string;
  kind: string;
}
export interface LinhaDoFunil extends EtapaDoFunil {
  /** sessões cuja maxStepOrder ≥ order */
  sessoes: number;
  /** em relação ao total de sessões (0–1) */
  pct: number;
  /** quanto caiu em relação à etapa anterior (0–1) */
  queda: number;
}

/** Funil por etapa: para cada `order`, as sessões que chegaram pelo menos até ela. */
export function funil(sessoes: SessaoMetrica[], etapas: EtapaDoFunil[]): LinhaDoFunil[] {
  const total = sessoes.length;
  let anterior = total;
  return [...etapas]
    .sort((a, b) => a.order - b.order)
    .map((e) => {
      const n = sessoes.filter((s) => s.maxStepOrder >= e.order).length;
      const linha = { ...e, sessoes: n, pct: razao(n, total), queda: anterior ? Math.max(0, (anterior - n) / anterior) : 0 };
      anterior = n;
      return linha;
    });
}

const DIA_SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Dia (yyyy-mm-dd) no fuso de São Paulo. */
export function diaEmSP(d: Date): string {
  return DIA_SP.format(d);
}

/** Views e únicos por dia, de `de` a `ate` (inclusive), dias sem sessão com zero. */
export function serieDiaria(sessoes: SessaoMetrica[], de: Date, ate: Date): { dia: string; views: number; unicos: number }[] {
  const porDia = new Map<string, { views: number; visitantes: Set<string> }>();
  for (const s of sessoes) {
    const k = diaEmSP(s.startedAt);
    const d = porDia.get(k) ?? { views: 0, visitantes: new Set<string>() };
    d.views++;
    d.visitantes.add(s.visitorId);
    porDia.set(k, d);
  }
  const dias: string[] = [];
  // Anda de 12 em 12 horas e deduplica: imune a horário de verão e a "dia" que não começa à meia-noite UTC.
  for (let t = de.getTime(); t <= ate.getTime() + 12 * 3600_000; t += 12 * 3600_000) {
    const k = diaEmSP(new Date(Math.min(t, ate.getTime())));
    if (dias[dias.length - 1] !== k) dias.push(k);
  }
  return dias.map((dia) => ({ dia, views: porDia.get(dia)?.views ?? 0, unicos: porDia.get(dia)?.visitantes.size ?? 0 }));
}

/** Contagem de sessões por uma chave (dispositivo, canal, demo), maior primeiro. */
export function contarPor(sessoes: SessaoMetrica[], chave: (s: SessaoMetrica) => string): { chave: string; views: number; concluidas: number }[] {
  const m = new Map<string, { views: number; concluidas: number }>();
  for (const s of sessoes) {
    const k = chave(s);
    const c = m.get(k) ?? { views: 0, concluidas: 0 };
    c.views++;
    if (s.completed) c.concluidas++;
    m.set(k, c);
  }
  return [...m.entries()].map(([k, v]) => ({ chave: k, ...v })).sort((a, b) => b.views - a.views);
}

/** Canal da sessão: o link nomeado, senão a utm_source, senão o domínio de origem, senão "Direto". */
export function canalDaSessao(s: SessaoMetrica): string {
  if (s.linkLabel) return s.linkLabel;
  if (s.utmSource) return s.utmSource;
  if (s.referrer) {
    try {
      return new URL(s.referrer).hostname.replace(/^www\./, '');
    } catch { /* referrer estranho: cai em Direto */ }
  }
  return 'Direto';
}

/** Sessões "ao vivo": atividade nos últimos 5 minutos. */
export function aoVivo(sessoes: SessaoMetrica[], agora = Date.now()): number {
  return sessoes.filter((s) => agora - s.lastSeenAt.getTime() <= 5 * 60_000).length;
}
