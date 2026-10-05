/**
 * HTML do relatório do cliente (módulo "Clientes NX Digital") — usado pro PDF.
 *
 * O desenho é feito a partir do SNAPSHOT, não do banco: o relatório publicado é uma foto, e o PDF
 * precisa mostrar exatamente o que o cliente vê no portal, mesmo que a métrica do mês tenha sido
 * corrigida depois.
 *
 * O snapshot é auto-descritivo (cada número traz label e unidade), então este arquivo não precisa
 * saber o que é "CPL" nem que métricas existem — ele só formata e empilha. Métrica nova aparece no
 * PDF sem mexer aqui.
 */

export interface GcNumeroSnapshot {
  chave: string;
  label: string;
  unidade: 'reais' | 'inteiro' | 'percentual' | 'decimal';
  valor: number | null;
  /** Mesmo número no período anterior, quando havia — vira a comparação "vs. mês anterior". */
  anterior?: number | null;
}

export interface GcSnapshot {
  versao: number;
  cliente: { nome_empresa: string; segmento?: string; cidade?: string; responsavel_nome?: string | null };
  periodo: { inicio: string; fim: string; rotulo: string };
  numeros: GcNumeroSnapshot[];
  metas?: { label: string; unidade: GcNumeroSnapshot['unidade']; base: number; meta: number; atual: number | null; progresso: number | null }[];
  jornada?: { nome: string; status: string }[];
  estrategias?: { nome: string; status: string; feitos: number; total: number }[];
  comentario_gestor?: string;
  proximos_passos?: string;
  publicado_em?: string;
}

function escapar(texto: unknown): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatarValor(valor: number | null | undefined, unidade: GcNumeroSnapshot['unidade']): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  switch (unidade) {
    case 'reais':
      return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    case 'inteiro':
      return Math.round(valor).toLocaleString('pt-BR');
    case 'percentual':
      return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    default:
      return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
}

/** Variação em relação ao período anterior, pronta pra imprimir. Sem base, não inventa nada. */
function variacao(n: GcNumeroSnapshot): string {
  if (n.anterior === null || n.anterior === undefined || n.anterior === 0) return '';
  if (n.valor === null || n.valor === undefined) return '';
  const pct = ((n.valor - n.anterior) / Math.abs(n.anterior)) * 100;
  const sinal = pct >= 0 ? '+' : '';
  const cor = pct >= 0 ? '#1baf7a' : '#eb6834';
  return `<span style="color:${cor};font-size:11px;display:block;margin-top:2px">${sinal}${pct.toLocaleString(
    'pt-BR',
    { maximumFractionDigits: 1 }
  )}% vs. período anterior</span>`;
}

const ROTULO_ETAPA: Record<string, string> = {
  concluida: 'concluída',
  em_andamento: 'em andamento',
  pendente: 'pendente',
};

/** Documento completo (com <html> e <style>), do jeito que renderFullHtmlToPdf espera. */
export function montarHtmlRelatorio(snapshot: GcSnapshot): string {
  const numeros = snapshot.numeros ?? [];
  const cartoes = numeros
    .map(
      (n) => `
      <div class="cartao">
        <span class="rotulo">${escapar(n.label)}</span>
        <span class="valor">${formatarValor(n.valor, n.unidade)}</span>
        ${variacao(n)}
      </div>`
    )
    .join('');

  const metas = (snapshot.metas ?? [])
    .map(
      (m) => `
      <tr>
        <td>${escapar(m.label)}</td>
        <td class="num">${formatarValor(m.base, m.unidade)}</td>
        <td class="num">${formatarValor(m.atual, m.unidade)}</td>
        <td class="num">${formatarValor(m.meta, m.unidade)}</td>
        <td class="num">${m.progresso === null ? '—' : `${m.progresso}%`}</td>
      </tr>`
    )
    .join('');

  const jornada = (snapshot.jornada ?? [])
    .map(
      (e) => `
      <li class="${e.status === 'concluida' ? 'feita' : ''}">
        ${escapar(e.nome)} <span class="estado">${ROTULO_ETAPA[e.status] ?? escapar(e.status)}</span>
      </li>`
    )
    .join('');

  const estrategias = (snapshot.estrategias ?? [])
    .map(
      (e) => `
      <li>${escapar(e.nome)} <span class="estado">${e.feitos} de ${e.total} passos · ${escapar(
        e.status
      )}</span></li>`
    )
    .join('');

  const bloco = (titulo: string, conteudo: string) =>
    conteudo.trim() ? `<section><h2>${titulo}</h2>${conteudo}</section>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Relatório — ${escapar(snapshot.cliente?.nome_empresa)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 36px; background: #fff; color: #11161d;
    font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  }
  header { border-bottom: 2px solid #11161d; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { margin: 0; font-size: 20px; }
  .sub { color: #5b6672; font-size: 12px; margin-top: 4px; }
  section { margin-bottom: 22px; page-break-inside: avoid; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #5b6672; margin: 0 0 10px; }
  .cartoes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .cartao { border: 1px solid #e3e7ec; border-radius: 8px; padding: 10px 12px; }
  .rotulo { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #7a8591; }
  .valor { display: block; font-size: 17px; font-weight: 600; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #eef1f4; text-align: left; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #7a8591; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { padding: 4px 0; border-bottom: 1px solid #f2f4f7; }
  li.feita { color: #5b6672; }
  .estado { color: #7a8591; font-size: 11px; }
  .texto { white-space: pre-wrap; }
  footer { margin-top: 28px; border-top: 1px solid #e3e7ec; padding-top: 10px; color: #7a8591; font-size: 10px; }
</style>
</head>
<body>
  <header>
    <h1>${escapar(snapshot.cliente?.nome_empresa)}</h1>
    <div class="sub">
      Relatório de ${escapar(snapshot.periodo?.rotulo)}
      ${snapshot.cliente?.responsavel_nome ? ` · responsável: ${escapar(snapshot.cliente.responsavel_nome)}` : ''}
    </div>
  </header>

  ${bloco('Números do período', `<div class="cartoes">${cartoes}</div>`)}
  ${bloco(
    'Metas',
    metas
      ? `<table><thead><tr><th>Métrica</th><th class="num">Partida</th><th class="num">Hoje</th><th class="num">Meta</th><th class="num">Andado</th></tr></thead><tbody>${metas}</tbody></table>`
      : ''
  )}
  ${bloco(
    'Comentário do gestor',
    snapshot.comentario_gestor ? `<p class="texto">${escapar(snapshot.comentario_gestor)}</p>` : ''
  )}
  ${bloco(
    'Próximos passos',
    snapshot.proximos_passos ? `<p class="texto">${escapar(snapshot.proximos_passos)}</p>` : ''
  )}
  ${bloco('Estratégias em curso', estrategias ? `<ul>${estrategias}</ul>` : '')}
  ${bloco('Jornada', jornada ? `<ul>${jornada}</ul>` : '')}

  <footer>
    Grupo NX Digital · ${
      snapshot.publicado_em
        ? `publicado em ${new Date(snapshot.publicado_em).toLocaleString('pt-BR')}`
        : 'rascunho'
    }
  </footer>
</body>
</html>`;
}
