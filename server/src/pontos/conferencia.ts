import { formatarMinutos, type ResumoPeriodo } from './calculo.js';

/** Conferência com a aba resumo do relógio: só avisa; nada daqui entra no cálculo. */

/** "1:30" -> {min: 90}; "3" / "3,0" -> {n: 3}. */
function lerQuantidade(v: string): { min?: number; n?: number } | null {
  const s = v.trim();
  const hm = /^(-?\d{1,3}):(\d{2})$/.exec(s);
  if (hm) return { min: Number(hm[1]) * 60 + Math.sign(Number(hm[1]) || 1) * Number(hm[2]) };
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && s !== '' ? { n } : null;
}

/** Horas do relógio: "23.05" ou "23:05" -> 1385 min. */
function horasPontoMinutos(v: string): number | null {
  const m = /^(\d{1,4})[.:](\d{2})$/.exec(v.trim());
  return m && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Compara o que o relógio somou (aba resumo) com o nosso cálculo. Só gera aviso; o cálculo é sempre o nosso (o relógio
 * erra: conta ausência no dia em andamento e antes do início do controle, e ignora atraso quando falta batida de almoço).
 */
export function compararComResumo(campos: Record<string, string>, resumo: ResumoPeriodo, diasComAtraso: number): string[] {
  const out: string[] = [];
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const [campo, valor] of Object.entries(campos)) {
    const c = norm(campo);
    const q = lerQuantidade(valor);
    if (!q) continue;
    if (/ausen|falta|absen/.test(c)) {
      const nosso = q.min != null ? resumo.faltaMinutos : resumo.faltas;
      const relogio = q.min ?? q.n!;
      if (relogio !== nosso) {
        out.push(`"${campo}" no relógio = ${valor}; no nosso cálculo = ${q.min != null ? formatarMinutos(nosso) : `${nosso} falta(s)`} `
          + '(o relógio conta ausência antes do início do controle e no dia em andamento).');
      }
    } else if (/atras|late/.test(c)) {
      const porVezes = /vez|qtd|quant|times|count/.test(c);
      const nosso = porVezes ? diasComAtraso : resumo.atrasoMinutos;
      const relogio = q.min ?? q.n!;
      if (relogio !== nosso) {
        out.push(`"${campo}" no relógio = ${valor}; no nosso cálculo = ${porVezes ? `${nosso} dia(s)` : `${nosso} min (atraso bruto)`} `
          + '(o relógio ignora atraso quando faltam as batidas do almoço e o que fica dentro da tolerância).');
      }
    } else if (/extra|overtime/.test(c)) {
      const min = horasPontoMinutos(valor);
      if (min != null && min !== resumo.extraMinutos) {
        out.push(`"${campo}" no relógio = ${valor}; no nosso cálculo = ${formatarMinutos(resumo.extraMinutos)}.`);
      }
    } else if (/duracao|trabalh/.test(c) && /atual|real/.test(c)) {
      // "23.05" = 23h05 (o relógio usa ponto no lugar dos dois-pontos).
      const min = horasPontoMinutos(valor);
      if (min != null && min !== resumo.trabalhadoMinutos) {
        out.push(`"${campo}" no relógio = ${valor} (${formatarMinutos(min)}); no nosso cálculo = ${formatarMinutos(resumo.trabalhadoMinutos)} trabalhadas `
          + '(sem o dia em andamento e sem os dias antes do início do controle).');
      }
    }
  }
  return out;
}
