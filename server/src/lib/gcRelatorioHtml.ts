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
 *
 * A primeira página responde, em letra grande, as duas perguntas que o cliente faz: quanto eu
 * investi e quanto isso virou em venda. O resto do detalhamento vem depois.
 */

import { LOGO_NX_DATA_URL } from './gcLogoNx.js';

export interface GcNumeroSnapshot {
  chave: string;
  label: string;
  unidade: 'reais' | 'inteiro' | 'percentual' | 'decimal';
  valor: number | null;
  /** Mesmo número no período anterior, quando havia — vira a comparação "vs. mês anterior". */
  anterior?: number | null;
  /** Subir é bom? Em CPL e CAC é o contrário, e a cor da variação tem que saber disso. */
  subirEhBom?: boolean;
}

export interface GcMetaSnapshot {
  label: string;
  unidade: GcNumeroSnapshot['unidade'];
  base: number;
  meta: number;
  atual: number | null;
  progresso: number | null;
  /** 'mes' | '6_meses' | '12_meses' — agrupa as metas em blocos legíveis. */
  horizonte?: string;
  prazo?: string | null;
}

export interface GcSnapshot {
  versao: number;
  cliente: { nome_empresa: string; logo_url?: string | null; segmento?: string; cidade?: string; responsavel_nome?: string | null };
  periodo: { inicio: string; fim: string; rotulo: string };
  numeros: GcNumeroSnapshot[];
  /** O essencial, já escolhido pela tela — evita este arquivo ter que saber quais chaves importam. */
  resumo?: {
    investimento: number | null;
    vendas: number | null;
    receita: number | null;
    /** Receita ÷ investimento: quantos reais voltaram por real investido. */
    retorno: number | null;
  };
  metas?: GcMetaSnapshot[];
  jornada?: { nome: string; status: string }[];
  estrategias?: { nome: string; status: string; feitos: number; total: number }[];
  /** Informações livres do mês que a equipe marcou pra mostrar ao cliente. */
  infos?: { titulo: string; valor: string; observacao: string }[];
  comentario_gestor?: string;
  proximos_passos?: string;
  publicado_em?: string;
}

const COR = {
  tinta: '#101620',
  tintaFraca: '#5b6672',
  tintaMaisFraca: '#8a939e',
  linha: '#e4e8ee',
  fundo: '#f6f8fa',
  azul: '#2a78d6',
  verde: '#1baf7a',
  laranja: '#eb6834',
};

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

/**
 * Variação contra o período anterior. A cor segue o que é BOM, não o que é maior: CPL caindo é
 * verde, mesmo sendo número menor.
 */
function variacao(n: GcNumeroSnapshot): string {
  if (n.anterior === null || n.anterior === undefined || n.anterior === 0) return '';
  if (n.valor === null || n.valor === undefined) return '';
  const pct = ((n.valor - n.anterior) / Math.abs(n.anterior)) * 100;
  if (Math.abs(pct) < 0.5) return `<span class="var neutra">estável</span>`;
  const subirEhBom = n.subirEhBom !== false;
  const bom = pct > 0 === subirEhBom;
  const seta = pct > 0 ? '▲' : '▼';
  return `<span class="var" style="color:${bom ? COR.verde : COR.laranja}">${seta} ${Math.abs(
    pct
  ).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>`;
}

const ROTULO_HORIZONTE: Record<string, string> = {
  mes: 'Meta do mês',
  '6_meses': 'Meta de 6 meses',
  '12_meses': 'Meta de 12 meses',
};

/** Pega do resumo, ou cai pra procurar a chave entre os números (snapshot antigo não tem resumo). */
function doResumo(snapshot: GcSnapshot, campo: 'investimento' | 'vendas' | 'receita' | 'retorno'): number | null {
  const direto = snapshot.resumo?.[campo];
  if (direto !== undefined) return direto;
  const chave = campo === 'retorno' ? 'roas' : campo;
  return snapshot.numeros?.find((n) => n.chave === chave)?.valor ?? null;
}

function blocoMetas(metas: GcMetaSnapshot[]): string {
  const grupos = ['mes', '6_meses', '12_meses'].filter((h) =>
    metas.some((m) => (m.horizonte ?? 'mes') === h)
  );
  if (!grupos.length) return '';
  return grupos
    .map((h) => {
      const linhas = metas
        .filter((m) => (m.horizonte ?? 'mes') === h)
        .map((m) => {
          const pct = m.progresso === null || m.progresso === undefined ? 0 : m.progresso;
          const cor = pct >= 100 ? COR.verde : pct >= 50 ? COR.azul : COR.laranja;
          return `
          <div class="meta">
            <div class="meta-topo">
              <span class="meta-nome">${escapar(m.label)}</span>
              <span class="meta-num">
                ${formatarValor(m.atual, m.unidade)}
                <span class="meta-alvo">de ${formatarValor(m.meta, m.unidade)}</span>
              </span>
            </div>
            <div class="barra"><span style="width:${Math.min(100, Math.max(0, pct))}%;background:${cor}"></span></div>
            <div class="meta-pe">
              partida ${formatarValor(m.base, m.unidade)}
              ${m.prazo ? ` · prazo ${escapar(String(m.prazo).slice(0, 10).split('-').reverse().join('/'))}` : ''}
              <span class="meta-pct" style="color:${cor}">${
                m.progresso === null || m.progresso === undefined ? '—' : `${m.progresso}% do caminho`
              }</span>
            </div>
          </div>`;
        })
        .join('');
      return `<div class="grupo-meta"><h3>${ROTULO_HORIZONTE[h] ?? 'Meta'}</h3>${linhas}</div>`;
    })
    .join('');
}

/** "07/10/2026 às 14:30", em Brasília. Vazio se não houver data válida. */
function dataEHora(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return `${data} às ${hora}`;
}

/** Documento completo (com <html> e <style>), do jeito que renderFullHtmlToPdf espera. */
export function montarHtmlRelatorio(snapshot: GcSnapshot): string {
  const investimento = doResumo(snapshot, 'investimento');
  const vendas = doResumo(snapshot, 'vendas');
  const receita = doResumo(snapshot, 'receita');
  const retorno = doResumo(snapshot, 'retorno');

  // Os quatro do destaque não repetem na grade de baixo — lá fica o detalhamento.
  const detalhados = (snapshot.numeros ?? []).filter(
    (n) => !['investimento', 'vendas', 'receita', 'roas'].includes(n.chave) && n.valor !== null
  );

  const cartoes = detalhados
    .map(
      (n) => `
      <div class="cartao">
        <span class="rotulo">${escapar(n.label)}</span>
        <span class="valor">${formatarValor(n.valor, n.unidade)}</span>
        ${variacao(n)}
      </div>`
    )
    .join('');

  const frase =
    retorno !== null && retorno > 0
      ? `Cada R$ 1,00 investido voltou como <strong>${formatarValor(retorno, 'reais')}</strong> de receita.`
      : investimento !== null && investimento > 0
        ? 'A receita deste período ainda não foi informada pelo cliente.'
        : '';

  const estrategias = (snapshot.estrategias ?? [])
    .map((e) => {
      const pct = e.total ? Math.round((e.feitos / e.total) * 100) : 0;
      return `
      <div class="linha-estrategia">
        <span class="nome">${escapar(e.nome)}</span>
        <span class="barra fina"><span style="width:${pct}%;background:${COR.azul}"></span></span>
        <span class="passos">${e.feitos}/${e.total}</span>
      </div>`;
    })
    .join('');

  const atualizadoEm = dataEHora(snapshot.publicado_em);
  // Só imagem embutida ou http(s): o valor vai pra dentro de um atributo HTML.
  const logo = snapshot.cliente?.logo_url ?? '';
  const logoDoCliente = /^(data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s"'<>]+)$/.test(logo)
    ? `<img class="logo-cliente" src="${logo}" alt="">`
    : '';
  const secao = (titulo: string, conteudo: string, classe = '') =>
    conteudo.trim() ? `<section class="${classe}"><h2>${titulo}</h2>${conteudo}</section>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Relatório — ${escapar(snapshot.cliente?.nome_empresa)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  body {
    margin: 0; padding: 0; background: #fff; color: ${COR.tinta};
    font: 13px/1.5 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-print-color-adjust: exact;
  }
  .folha { padding: 34px 38px 28px; }

  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .marca { display: flex; align-items: center; gap: 8px; font-size: 10px; letter-spacing: .14em;
    text-transform: uppercase; color: ${COR.azul}; font-weight: 700; }
  .logo-cliente { height: 40px; max-width: 120px; object-fit: contain; vertical-align: middle; margin-right: 10px; }
  .logo { height: 24px; width: 24px; border-radius: 6px; object-fit: cover; }
  h1 { margin: 4px 0 0; font-size: 25px; letter-spacing: -.01em; }
  .sub { color: ${COR.tintaFraca}; font-size: 12px; margin-top: 3px; }
  .periodo {
    text-align: right; font-size: 11px; color: ${COR.tintaFraca};
    border: 1px solid ${COR.linha}; border-radius: 10px; padding: 8px 12px; white-space: nowrap;
  }
  .periodo strong { display: block; font-size: 14px; color: ${COR.tinta}; }
  .regua { height: 3px; border-radius: 3px; margin: 18px 0 22px;
    background: linear-gradient(90deg, ${COR.azul} 0%, ${COR.verde} 60%, ${COR.laranja} 100%); }

  .destaque { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .destaque > div { border: 1px solid ${COR.linha}; border-radius: 14px; padding: 14px 16px; background: ${COR.fundo}; }
  .destaque .rotulo { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: ${COR.tintaFraca}; }
  .destaque .valor { display: block; font-size: 26px; font-weight: 700; letter-spacing: -.02em; margin-top: 4px; }
  .destaque .ajuda { display: block; font-size: 10.5px; color: ${COR.tintaMaisFraca}; margin-top: 2px; }
  .frase {
    margin-top: 12px; border-left: 3px solid ${COR.verde}; background: ${COR.fundo};
    border-radius: 0 10px 10px 0; padding: 11px 14px; font-size: 13.5px;
  }

  section { margin-top: 24px; page-break-inside: avoid; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: ${COR.tintaFraca};
       margin: 0 0 11px; padding-bottom: 6px; border-bottom: 1px solid ${COR.linha}; }
  h3 { font-size: 11.5px; color: ${COR.tinta}; margin: 0 0 8px; }

  .cartoes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .cartao { border: 1px solid ${COR.linha}; border-radius: 11px; padding: 10px 12px; }
  .cartao .rotulo { display: block; font-size: 9.5px; text-transform: uppercase; letter-spacing: .07em; color: ${COR.tintaFraca}; }
  .cartao .valor { display: block; font-size: 17px; font-weight: 650; margin-top: 3px; }
  .var { display: block; font-size: 10.5px; margin-top: 2px; font-weight: 600; }
  .var.neutra { color: ${COR.tintaMaisFraca}; font-weight: 500; }

  .grupo-meta { margin-bottom: 14px; }
  .meta { border: 1px solid ${COR.linha}; border-radius: 11px; padding: 10px 12px; margin-bottom: 7px; }
  .meta-topo { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .meta-nome { font-weight: 600; }
  .meta-num { font-size: 15px; font-weight: 700; }
  .meta-alvo { font-size: 11px; font-weight: 500; color: ${COR.tintaFraca}; }
  .barra { display: block; height: 7px; border-radius: 99px; background: #e9edf2; overflow: hidden; margin: 7px 0 5px; }
  .barra > span { display: block; height: 100%; border-radius: 99px; }
  .barra.fina { height: 5px; margin: 0; flex: 1; }
  .meta-pe { font-size: 10.5px; color: ${COR.tintaFraca}; display: flex; justify-content: space-between; gap: 10px; }
  .meta-pct { font-weight: 600; }

  .texto-card { border: 1px solid ${COR.linha}; border-left: 3px solid ${COR.azul}; border-radius: 0 11px 11px 0;
    padding: 12px 14px; white-space: pre-wrap; }

  .linha-estrategia { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #f1f4f7; }
  .linha-estrategia .nome { width: 42%; }
  .linha-estrategia .passos { font-size: 11px; color: ${COR.tintaFraca}; width: 44px; text-align: right; }


  .observacao {
    margin-top: 22px; border: 1px solid ${COR.linha}; border-left: 3px solid ${COR.azul}; border-radius: 0 11px 11px 0;
    background: ${COR.fundo}; padding: 11px 14px; font-size: 11.5px; color: ${COR.tintaFraca}; page-break-inside: avoid;
  }
  .observacao strong { color: ${COR.tinta}; }

  footer { margin-top: 26px; border-top: 1px solid ${COR.linha}; padding-top: 9px;
    color: ${COR.tintaMaisFraca}; font-size: 9.5px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
<div class="folha">
  <header>
    <div>
      <div class="marca"><img class="logo" src="${LOGO_NX_DATA_URL}" alt="">Grupo NX Digital</div>
      <h1>${logoDoCliente}${escapar(snapshot.cliente?.nome_empresa)}</h1>
      <div class="sub">
        ${[snapshot.cliente?.segmento, snapshot.cliente?.cidade].filter(Boolean).map(escapar).join(' · ')}
        ${snapshot.cliente?.responsavel_nome ? ` · responsável: ${escapar(snapshot.cliente.responsavel_nome)}` : ''}
      </div>
    </div>
    <div class="periodo">
      relatório de
      <strong>${escapar(snapshot.periodo?.rotulo)}</strong>
      ${atualizadoEm ? `<span style="display:block;margin-top:4px;font-size:10px">última atualização<br><b style="color:${COR.tinta}">${escapar(atualizadoEm)}</b></span>` : ''}
    </div>
  </header>
  <div class="regua"></div>

  <div class="destaque">
    <div>
      <span class="rotulo">Investimento</span>
      <span class="valor">${formatarValor(investimento, 'reais')}</span>
      <span class="ajuda">verba aplicada em anúncios no período</span>
    </div>
    <div>
      <span class="rotulo">Vendas</span>
      <span class="valor">${formatarValor(vendas, 'inteiro')}</span>
      <span class="ajuda">negócios fechados no período</span>
      <span class="ajuda" style="font-style:italic;margin-top:3px">Conforme informações recebidas e analisadas pela NX.</span>
    </div>
    <div>
      <span class="rotulo">Receita</span>
      <span class="valor">${formatarValor(receita, 'reais')}</span>
      <span class="ajuda">faturamento vindo das campanhas</span>
    </div>
  </div>
  ${frase ? `<div class="frase">${frase}</div>` : ''}

  ${secao('Detalhamento do período', cartoes ? `<div class="cartoes">${cartoes}</div>` : '')}
  ${secao('Metas', blocoMetas(snapshot.metas ?? []))}
  ${secao(
    'Informações do período',
    (snapshot.infos ?? []).length
      ? `<div class="cartoes" style="grid-template-columns:repeat(2,1fr)">${(snapshot.infos ?? [])
          .map(
            (i) => `<div class="cartao"><span class="rotulo">${escapar(i.titulo)}</span>${
              i.valor ? `<span class="valor">${escapar(i.valor)}</span>` : ''
            }${i.observacao ? `<span class="var neutra" style="font-weight:400">${escapar(i.observacao)}</span>` : ''}</div>`
          )
          .join('')}</div>`
      : ''
  )}
  ${secao(
    'Leitura do gestor',
    snapshot.comentario_gestor ? `<div class="texto-card">${escapar(snapshot.comentario_gestor)}</div>` : ''
  )}
  ${secao(
    'Próximos passos',
    snapshot.proximos_passos ? `<div class="texto-card">${escapar(snapshot.proximos_passos)}</div>` : ''
  )}
  ${secao('Estratégias em curso', estrategias)}

  <div class="observacao">
    <strong>Sobre as informações deste relatório.</strong> Elas refletem a última atualização feita pela equipe da NX${
      atualizadoEm ? ` (${escapar(atualizadoEm)})` : ''
    }. A NX pode estar executando ações que ainda não foram registradas aqui — em caso de dúvida, confirme com os seus gestores.
  </div>

  <footer>
    <span style="display:flex;align-items:center;gap:6px"><img class="logo" style="height:14px;width:14px;border-radius:4px" src="${LOGO_NX_DATA_URL}" alt="">Grupo NX Digital · relatório de performance</span>
    <span>${
      snapshot.publicado_em
        ? `publicado em ${atualizadoEm}`
        : 'rascunho — não publicado'
    }</span>
  </footer>
</div>
</body>
</html>`;
}
