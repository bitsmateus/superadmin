/**
 * Planejamento da importação (puro): dadas as batidas lidas da planilha e as que já existem no banco, decide o que
 * entra, o que é ignorado e quais dias têm conflito. As rotas só executam o plano (testes: importacao.test.ts).
 *
 * Regras:
 *  - chave da batida = colaborador + data + horário: a mesma batida nunca entra duas vezes;
 *  - modo "período": só entram datas dentro de de/até; o resto vira "fora do período" (ignorado);
 *  - dia sem nada no banco: entra tudo (novos);
 *  - dia que só ganha batidas a mais (o relógio exportou mais): entram só as que faltam (atualizados);
 *  - dia com batida DIFERENTE (o banco tem horário que a planilha não tem): conflito. Sem decisão, mantém o que está;
 *    "substituir" troca as batidas daquele dia (as de importação; ajuste manual fica em outra tabela e nunca é tocado);
 *  - desfazer uma importação: tira só as batidas que ELA trouxe e devolve as que ela tinha substituído.
 */

export interface BatidaLida { colaboradorId: string; data: string; hora: string }
export interface BatidaExistente extends BatidaLida { id: string; importacaoId: string | null }
export type Decisao = 'manter' | 'substituir';

export interface Conflito { colaboradorId: string; data: string; atuais: string[]; novas: string[] }

export interface PlanoDeImportacao {
  inserir: BatidaLida[];
  /** Batidas existentes que saem por "substituir" (guardadas na importação pra poder desfazer). */
  remover: BatidaExistente[];
  conflitos: Conflito[];
  novos: number;
  atualizados: number;
  ignorados: number;
  foraDoPeriodo: number;
  duplicadasNoArquivo: number;
}

const chaveDia = (b: { colaboradorId: string; data: string }) => `${b.colaboradorId}|${b.data}`;

export function planejarImportacao(p: {
  lidas: BatidaLida[];
  existentes: BatidaExistente[];
  periodo: { inicio: string; fim: string };
  decisoes?: Record<string, Decisao>;
}): PlanoDeImportacao {
  const plano: PlanoDeImportacao = {
    inserir: [], remover: [], conflitos: [], novos: 0, atualizados: 0, ignorados: 0, foraDoPeriodo: 0, duplicadasNoArquivo: 0,
  };
  // Lidas por dia (sem repetir a mesma batida no próprio arquivo).
  const porDia = new Map<string, Set<string>>();
  for (const b of p.lidas) {
    if (b.data < p.periodo.inicio || b.data > p.periodo.fim) { plano.foraDoPeriodo += 1; plano.ignorados += 1; continue; }
    const k = chaveDia(b);
    const set = porDia.get(k) ?? new Set<string>();
    if (set.has(b.hora)) { plano.duplicadasNoArquivo += 1; plano.ignorados += 1; continue; }
    set.add(b.hora);
    porDia.set(k, set);
  }
  const existentesPorDia = new Map<string, BatidaExistente[]>();
  for (const e of p.existentes) {
    const k = chaveDia(e);
    existentesPorDia.set(k, [...(existentesPorDia.get(k) ?? []), e]);
  }

  for (const [k, horas] of porDia) {
    const [colaboradorId, data] = k.split('|');
    const atuais = existentesPorDia.get(k) ?? [];
    const atuaisHoras = new Set(atuais.map((e) => e.hora));
    const novas = [...horas].sort();
    if (!atuais.length) {
      for (const hora of novas) plano.inserir.push({ colaboradorId, data, hora });
      plano.novos += novas.length;
      continue;
    }
    const faltando = novas.filter((h) => !atuaisHoras.has(h));
    const sobrando = atuais.filter((e) => !horas.has(e.hora));
    if (!faltando.length) { plano.ignorados += novas.length; continue; } // nada novo nesse dia
    if (!sobrando.length) {
      // Só completa o dia.
      for (const hora of faltando) plano.inserir.push({ colaboradorId, data, hora });
      plano.atualizados += faltando.length;
      plano.ignorados += novas.length - faltando.length;
      continue;
    }
    // Conflito: o banco tem horário que a planilha não tem.
    plano.conflitos.push({ colaboradorId, data, atuais: [...atuaisHoras].sort(), novas });
    if (p.decisoes?.[k] === 'substituir') {
      for (const e of sobrando) plano.remover.push(e);
      for (const hora of faltando) plano.inserir.push({ colaboradorId, data, hora });
      plano.atualizados += faltando.length;
      plano.ignorados += novas.length - faltando.length;
    } else {
      plano.ignorados += novas.length;
    }
  }
  return plano;
}

export { chaveDia };

// ───────────────────────────── memória (testes e conferência) ─────────────────────────────

/** Aplica um plano numa lista em memória (mesma regra do banco: chave colaborador+data+hora). */
export function aplicarPlano(banco: BatidaExistente[], plano: PlanoDeImportacao, importacaoId: string): BatidaExistente[] {
  const tirar = new Set(plano.remover.map((r) => r.id));
  const out = banco.filter((b) => !tirar.has(b.id));
  const existe = new Set(out.map((b) => `${chaveDia(b)}|${b.hora}`));
  let n = 0;
  for (const b of plano.inserir) {
    const k = `${chaveDia(b)}|${b.hora}`;
    if (existe.has(k)) continue;
    existe.add(k);
    out.push({ ...b, id: `${importacaoId}-${n++}`, importacaoId });
  }
  return out;
}

/** Desfaz uma importação em memória: tira o que ela trouxe e devolve o que ela substituiu. */
export function desfazerEmMemoria(banco: BatidaExistente[], importacaoId: string, substituidas: BatidaExistente[]): BatidaExistente[] {
  const out = banco.filter((b) => b.importacaoId !== importacaoId);
  const existe = new Set(out.map((b) => `${chaveDia(b)}|${b.hora}`));
  for (const s of substituidas) {
    const k = `${chaveDia(s)}|${s.hora}`;
    if (!existe.has(k)) { out.push(s); existe.add(k); }
  }
  return out;
}
