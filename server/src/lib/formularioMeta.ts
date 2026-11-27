/**
 * Prazo ("quando você quer colocar isso pra rodar?") e Instagram/site do formulário do Meta Lead Ads, como chegam no webhook.
 * Primeiro o topo do payload ("prazo" ou "prioridade", e "site_empresa"); sem eles, procura no `raw` pela pergunta (a chave é o
 * nome da pergunta no Meta). A resposta é guardada como veio — sem virar nível alta/média/baixa. Só a exibição é formatada.
 * Não depende de campanha nem de formulário: vale pra qualquer lead que traga a resposta.
 */

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Texto de um campo do payload: aceita texto, número ou lista (o primeiro). Qualquer outra coisa é ignorada. */
function texto(v: unknown): string {
  if (Array.isArray(v)) return texto(v[0]);
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim().slice(0, 300);
  return '';
}

/** A primeira resposta preenchida cuja pergunta contém um dos termos, na ordem dos termos (o mais específico primeiro). */
function doRaw(raw: unknown, termos: string[]): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const respostas = Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({ chave: semAcento(k), valor: texto(v) }));
  for (const termo of termos) {
    const achado = respostas.find((r) => r.chave.includes(termo) && r.valor);
    if (achado) return achado.valor;
  }
  return '';
}

/** Empresa: a do formulário (`raw.company_name`); quando o raw não tem, o campo "empresa" do topo do payload. */
export function lerEmpresa(corpo: Record<string, unknown>): string {
  const raw = corpo.raw && typeof corpo.raw === 'object' ? (corpo.raw as Record<string, unknown>) : {};
  return texto(raw.company_name) || texto(corpo.empresa);
}

export function lerPrazoESite(corpo: Record<string, unknown>): { prioridade: string | null; siteEmpresa: string | null } {
  const prioridade = texto(corpo.prazo) || texto(corpo.prioridade) || doRaw(corpo.raw, ['rodar', 'quando']);
  const siteEmpresa = texto(corpo.site_empresa) || doRaw(corpo.raw, ['instagram', 'site']);
  return { prioridade: prioridade || null, siteEmpresa: siteEmpresa || null };
}
