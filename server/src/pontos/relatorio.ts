import { formatarMinutos, type DiaCalculado, type ResumoPeriodo } from './calculo.js';

/** Relatório do colaborador no período, pro fechamento da folha (CSV e HTML pro PDF). */

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const STATUS: Record<string, string> = {
  normal: 'Normal', falta: 'Falta', atraso: 'Atraso', extra: 'Extra', folga: 'Folga', abonado: 'Abonado',
  feriado: 'Feriado', incompleto: 'Sem saída', sem_registro: 'Sem registro',
};
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (d: string) => d.split('-').reverse().join('/');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface DadosDoRelatorio {
  colaborador: string;
  inicio: string;
  fim: string;
  dias: DiaCalculado[];
  resumo: ResumoPeriodo;
  bancoAcumuladoMinutos: number;
  valorHoraCentavos: number;
}

/** CSV com ; (abre direto no Excel em português) e BOM UTF-8. */
export function relatorioCsv(r: DadosDoRelatorio): string {
  const cel = (v: string | number) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas: (string | number)[][] = [
    ['Colaborador', r.colaborador],
    ['Período', `${dataBr(r.inicio)} a ${dataBr(r.fim)}`],
    [],
    ['Data', 'Dia', 'Batidas', 'Trabalhadas', 'Previstas', 'Atraso', 'Saída antecipada', 'Falta', 'Hora extra', 'Destino extra', 'Saldo do dia', 'Desconto (R$)', 'Extra (R$)', 'Status', 'Ajustes'],
    ...r.dias.map((d) => [
      dataBr(d.data), DIAS[d.diaSemana], d.batidas.join(' '), formatarMinutos(d.trabalhadoMinutos), formatarMinutos(d.previstoMinutos),
      formatarMinutos(d.atrasoMinutos), formatarMinutos(d.saidaAntecipadaMinutos), formatarMinutos(d.faltaMinutos),
      formatarMinutos(d.extraMinutos), d.extraMinutos ? (d.extraDestino === 'banco' ? 'Banco de horas' : 'Pagamento') : '',
      formatarMinutos(d.saldoMinutos), (d.descontoCentavos / 100).toFixed(2).replace('.', ','),
      (d.valorExtraCentavos / 100).toFixed(2).replace('.', ','), STATUS[d.status] ?? d.status, d.ajustes.join(', '),
    ]),
    [],
    ['Total trabalhado', formatarMinutos(r.resumo.trabalhadoMinutos)],
    ['Horas extras', formatarMinutos(r.resumo.extraMinutos)],
    ['  para banco de horas', formatarMinutos(r.resumo.extraBancoMinutos)],
    ['  para pagamento', formatarMinutos(r.resumo.extraPagamentoMinutos)],
    ['Atrasos + saídas antecipadas', formatarMinutos(r.resumo.atrasoMinutos + r.resumo.saidaAntecipadaMinutos)],
    ['Faltas (dia inteiro)', r.resumo.faltas],
    ['Faltas de meio período', r.resumo.meiasFaltas],
    ['Saldo do período', formatarMinutos(r.resumo.saldoMinutos)],
    ['Banco de horas acumulado', formatarMinutos(r.bancoAcumuladoMinutos)],
    ['Valor/hora', brl(r.valorHoraCentavos)],
    ['Desconto', brl(r.resumo.descontoCentavos)],
    ['Horas extras a pagar', brl(r.resumo.valorExtraCentavos)],
  ];
  return '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
}

/** HTML completo (A4) pro PDF do fechamento. */
export function relatorioHtml(r: DadosDoRelatorio): string {
  const linhas = r.dias.map((d) => `
    <tr class="${d.status}">
      <td>${dataBr(d.data)}</td><td>${DIAS[d.diaSemana]}</td><td>${esc(d.batidas.join(' '))}</td>
      <td>${formatarMinutos(d.trabalhadoMinutos)}</td><td>${formatarMinutos(d.previstoMinutos)}</td>
      <td>${d.atrasoMinutos + d.saidaAntecipadaMinutos + d.faltaMinutos ? formatarMinutos(d.atrasoMinutos + d.saidaAntecipadaMinutos + d.faltaMinutos) : '—'}</td>
      <td>${d.extraMinutos ? formatarMinutos(d.extraMinutos) + (d.extraDestino === 'banco' ? ' (banco)' : ' (pag.)') : '—'}</td>
      <td>${formatarMinutos(d.saldoMinutos)}</td><td>${d.descontoCentavos ? brl(d.descontoCentavos) : '—'}</td>
      <td>${STATUS[d.status] ?? d.status}${d.faltaPeriodo ? (d.faltaPeriodo === 'manha' ? ' (manhã)' : ' (tarde)') : ''}</td>
    </tr>`).join('');
  const card = (t: string, v: string) => `<div class="card"><span>${t}</span><b>${v}</b></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ponto ${esc(r.colaborador)}</title>
<style>
  @page { size: A4; margin: 14mm 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px; }
  h1 { font-size: 16px; margin: 0; } p.sub { color: #555; margin: 2px 0 10px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
  .card { border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; } .card span { display: block; color: #666; font-size: 9px; }
  .card b { font-size: 12px; }
  table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #e5e5e5; padding: 3px 4px; text-align: left; }
  th { background: #f4f6fa; font-size: 9px; text-transform: uppercase; color: #555; }
  tr.falta td { color: #b91c1c; } tr.atraso td { color: #b45309; } tr.folga td, tr.feriado td { color: #888; }
  .assin { margin-top: 28px; display: flex; gap: 40px; } .assin div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; }
</style></head><body>
<h1>Espelho de ponto — ${esc(r.colaborador)}</h1>
<p class="sub">${dataBr(r.inicio)} a ${dataBr(r.fim)} · Grupo NX Digital</p>
<div class="cards">
  ${card('Trabalhadas', formatarMinutos(r.resumo.trabalhadoMinutos))}
  ${card('Horas extras', formatarMinutos(r.resumo.extraMinutos))}
  ${card('Atrasos + saídas', formatarMinutos(r.resumo.atrasoMinutos + r.resumo.saidaAntecipadaMinutos))}
  ${card('Faltas', String(r.resumo.faltas) + (r.resumo.meiasFaltas ? ` + ${r.resumo.meiasFaltas} meio período` : ''))}
  ${card('Saldo do período', formatarMinutos(r.resumo.saldoMinutos))}
  ${card('Banco acumulado', formatarMinutos(r.bancoAcumuladoMinutos))}
  ${card('Desconto', brl(r.resumo.descontoCentavos))}
  ${card('Extras a pagar', brl(r.resumo.valorExtraCentavos))}
</div>
<table><thead><tr><th>Data</th><th>Dia</th><th>Batidas</th><th>Trab.</th><th>Prev.</th><th>Atraso/saída/falta</th><th>Extra</th><th>Saldo</th><th>Desconto</th><th>Status</th></tr></thead>
<tbody>${linhas}</tbody></table>
<div class="assin"><div>Colaborador</div><div>Empresa</div></div>
</body></html>`;
}
