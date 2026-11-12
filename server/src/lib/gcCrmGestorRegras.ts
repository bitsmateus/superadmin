/**
 * Cards automáticos no CRM do gestor de tráfego (ex.: /demandas/crm-mateus) — as REGRAS, puras
 * (sem banco nem rede), cobertas por gcCrmGestorRegras.test.ts. Quem grava é jobs/gcCrmGestor.ts.
 *
 *  - Segunda e quinta: um card "A fazer" por cliente de tráfego do gestor (monitorar campanhas e relatório).
 *  - Saldo pré-pago chegou a 30% do que tinha depois da última recarga, ou zerou: card "cobrar pagamento".
 */

/** Qual CRM é de qual gestor: id da aba (lead_pages.id, o que aparece na URL) + primeiro nome do gestor. */
export const CRMS_DE_GESTOR: { pagina: string; gestor: string }[] = [{ pagina: 'crm-mateus', gestor: 'mateus' }];

/** Percentual do saldo de referência abaixo do qual vira cobrança. */
export const LIMITE_COBRANCA = 0.3;

/** Dia da semana (0 = domingo) em que nasce o card de gestão, e o rótulo do card. */
export const DIAS_DE_GESTAO: Record<number, string> = {
  1: 'Monitorar campanhas e relatório',
  4: 'Gerenciar campanhas',
};

export const normalizar = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
export const primeiroNome = (s: string | null | undefined) => normalizar(s).split(/\s+/)[0] ?? '';

/**
 * Saldo de referência = o saldo logo depois da última recarga. Recarga = o saldo SUBIU desde a última leitura.
 * Primeira leitura: o próprio saldo vira a referência.
 */
export function novaReferencia(
  antes: { ultimo: number | null; referencia: number | null },
  saldo: number,
): { referencia: number; recarga: boolean } {
  if (antes.referencia === null || antes.ultimo === null) return { referencia: saldo, recarga: true };
  if (saldo > antes.ultimo + 0.5) return { referencia: saldo, recarga: true };
  return { referencia: Math.max(antes.referencia, 0), recarga: false };
}

/** Hora de cobrar: zerou, ou sobrou 30% ou menos do saldo de referência. */
export function precisaCobrar(saldo: number | null, referencia: number | null): boolean {
  if (saldo === null) return false;
  if (saldo <= 0) return true;
  return referencia !== null && referencia > 0 && saldo <= referencia * LIMITE_COBRANCA;
}

const brl = (v: number) => `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface ResumoSemana {
  metaGasto: number;
  metaResultados: number;
  metaCusto: number | null;
  googleGasto: number;
  googleConversoes: number;
  saldo: number | null;
  alertas: string[];
}

/** Nota do card de gestão (HTML simples, como as notas do CRM). */
export function notaDeGestao(cliente: string, rotulo: string, r: ResumoSemana, link: string): string {
  const linhas: string[] = [`<p><strong>${esc(rotulo)} — ${esc(cliente)}</strong></p>`];
  const numeros: string[] = [];
  if (r.metaGasto > 0 || r.metaResultados > 0) {
    numeros.push(`Meta (7 dias): ${brl(r.metaGasto)} · ${r.metaResultados} resultado(s)${r.metaCusto ? ` · ${brl(r.metaCusto)}/resultado` : ''}`);
  }
  if (r.googleGasto > 0 || r.googleConversoes > 0) {
    numeros.push(`Google Ads (7 dias): ${brl(r.googleGasto)} · ${Math.round(r.googleConversoes)} conversão(ões)`);
  }
  if (r.saldo !== null) numeros.push(`Saldo pré-pago: ${brl(r.saldo)}`);
  if (numeros.length) linhas.push(`<ul>${numeros.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`);
  if (r.alertas.length) linhas.push(`<p>Alertas abertos:</p><ul>${r.alertas.slice(0, 6).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`);
  linhas.push(
    '<p>A fazer:</p><ul>' +
      ['Conferir campanhas e anúncios (pausar o que não converte, escalar o que funciona)', 'Conferir saldo e forma de pagamento',
        'Registrar a "Última edição" no Tráfego do cliente', 'Mandar a atualização/relatório para o cliente']
        .map((t) => `<li>${esc(t)}</li>`).join('') +
      '</ul>',
  );
  linhas.push(`<p><a href="${esc(link)}">Abrir o Tráfego do cliente</a></p>`);
  return linhas.join('');
}

export function notaDeCobranca(cliente: string, conta: string, saldo: number, referencia: number | null, gastoDia: number, link: string): string {
  const pct = referencia && referencia > 0 ? Math.max(0, Math.round((saldo / referencia) * 100)) : null;
  const linhas = [
    `<p><strong>Cobrar pagamento — ${esc(cliente)}</strong></p>`,
    `<p>${saldo <= 0 ? 'O saldo pré-pago zerou: os anúncios param.' : `Restam ${brl(saldo)}${pct !== null ? ` (${pct}% do saldo depois da última recarga, ${brl(referencia!)})` : ''}.`}</p>`,
  ];
  if (gastoDia > 0 && saldo > 0) linhas.push(`<p>No ritmo atual (${brl(gastoDia)}/dia) dá para ~${Math.max(0, Math.floor(saldo / gastoDia))} dia(s).</p>`);
  if (conta) linhas.push(`<p>Conta: ${esc(conta)}</p>`);
  linhas.push('<p>Pedir ao cliente para adicionar saldo (boleto/Pix) no Gerenciador de Anúncios.</p>');
  linhas.push(`<p><a href="${esc(link)}">Abrir o Tráfego do cliente</a></p>`);
  return linhas.join('');
}

/** Data/hora local de São Paulo "YYYY-MM-DDTHH:MM" de hoje às `hora` (campo "Finalizar até" do card). */
export function hojeAs(hoje: string, hora = '18:00'): string {
  return `${hoje}T${hora}`;
}
