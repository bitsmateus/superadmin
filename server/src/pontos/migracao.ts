import type { Pool } from 'pg';

/**
 * Migração do módulo Pontos (Financeiro > Pontos). SÓ ADITIVA: cria tabelas novas com prefixo `ponto_` e o cadastro
 * inicial (Jean, João, Arthur). Não toca em nenhuma tabela existente.
 *
 * NÃO roda sozinha na subida do servidor (fica fora do runMigrations de propósito). Pra aplicar:
 *   node dist/pontos/migrar.js            (produção, depois do build)
 *   npx tsx src/pontos/migrar.ts          (desenvolvimento)
 * Pode rodar mais de uma vez: tudo é IF NOT EXISTS / ON CONFLICT DO NOTHING.
 */
export const SQL_PONTOS = `
CREATE TABLE IF NOT EXISTS ponto_colaboradores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  -- Outros nomes com que aparece na planilha (associação manual na importação fica guardada aqui).
  apelidos TEXT[] NOT NULL DEFAULT '{}',
  ativo BOOLEAN NOT NULL DEFAULT true,
  -- Dias trabalhados (0 = domingo … 6 = sábado) e jornada em minutos.
  dias_semana INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  minutos_dia INT NOT NULL DEFAULT 480,
  minutos_sabado INT NOT NULL DEFAULT 240,
  minutos_domingo INT NOT NULL DEFAULT 0,
  entrada_prevista TEXT NOT NULL DEFAULT '08:00',
  saida_prevista TEXT NOT NULL DEFAULT '18:00',
  intervalo_minutos INT NOT NULL DEFAULT 120,
  tolerancia_minutos INT NOT NULL DEFAULT 10,
  salario_base_centavos BIGINT NOT NULL DEFAULT 0,
  divisor_mensal INT NOT NULL DEFAULT 220,
  -- Valor/hora informado direto (centavos). Vazio = salário ÷ divisor.
  valor_hora_centavos BIGINT,
  pct_extra_util NUMERIC(6,2) NOT NULL DEFAULT 50,
  pct_extra_domingo_feriado NUMERIC(6,2) NOT NULL DEFAULT 100,
  -- Pra onde vai a hora extra por padrão: 'banco' (banco de horas) ou 'pagamento' (folha).
  destino_extra TEXT NOT NULL DEFAULT 'banco' CHECK (destino_extra IN ('banco', 'pagamento')),
  -- Banco de horas: saldo inicial (minutos) e a partir de quando conta.
  banco_saldo_inicial_minutos INT NOT NULL DEFAULT 0,
  banco_inicio DATE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ponto_colaboradores_nome_uidx ON ponto_colaboradores (lower(nome));

CREATE TABLE IF NOT EXISTS ponto_importacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_nome TEXT NOT NULL,
  modo TEXT NOT NULL CHECK (modo IN ('mes', 'periodo')),
  -- "Período lido": no modo mês, as datas que vieram no arquivo (dentro do mês); no modo período, o intervalo escolhido.
  -- É o que conta como "coberto": dia previsto sem batida dentro dele é falta (só pros colaboradores desta importação).
  periodo_inicio DATE NOT NULL,
  periodo_fim DATE NOT NULL,
  colaboradores UUID[] NOT NULL DEFAULT '{}',
  novos INT NOT NULL DEFAULT 0,
  atualizados INT NOT NULL DEFAULT 0,
  ignorados INT NOT NULL DEFAULT 0,
  -- O que foi lido do arquivo (não guardamos o arquivo: o projeto não tem storage de arquivos).
  conteudo JSONB NOT NULL DEFAULT '[]',
  -- Batidas de outras importações que esta substituiu (pra "Desfazer" devolver).
  substituidas JSONB NOT NULL DEFAULT '[]',
  avisos JSONB NOT NULL DEFAULT '[]',
  importado_por UUID,
  importado_por_nome TEXT NOT NULL DEFAULT '',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  desfeita_em TIMESTAMPTZ,
  desfeita_por_nome TEXT
);

-- Batida ORIGINAL, como veio da planilha. Ajuste manual nunca mexe aqui (fica em ponto_ajustes).
CREATE TABLE IF NOT EXISTS ponto_batidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id UUID NOT NULL REFERENCES ponto_colaboradores(id) ON DELETE CASCADE,
  -- Dia de trabalho (a batida de saída depois da meia-noite pertence ao dia anterior: ver calculo.ts).
  data DATE NOT NULL,
  hora TEXT NOT NULL CHECK (hora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  importacao_id UUID REFERENCES ponto_importacoes(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (colaborador_id, data, hora)
);
CREATE INDEX IF NOT EXISTS ponto_batidas_colab_data_idx ON ponto_batidas (colaborador_id, data);
CREATE INDEX IF NOT EXISTS ponto_batidas_importacao_idx ON ponto_batidas (importacao_id);

-- Ajuste manual de um dia (abono, folga, feriado, correção de batida…). Só se acrescenta; remover = marcar removido.
CREATE TABLE IF NOT EXISTS ponto_ajustes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id UUID NOT NULL REFERENCES ponto_colaboradores(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'abonar_atraso', 'abonar_falta', 'justificar', 'folga', 'compensacao', 'feriado',
    'perdoar_desconto', 'extra_banco', 'extra_pagamento', 'corrigir_batidas'
  )),
  motivo TEXT NOT NULL CHECK (length(btrim(motivo)) > 0),
  -- corrigir_batidas: os horários que valem no lugar das batidas originais do dia (["08:00","12:00",…]).
  batidas JSONB,
  autor_id UUID,
  autor_nome TEXT NOT NULL DEFAULT '',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removido_em TIMESTAMPTZ,
  removido_por_nome TEXT
);
CREATE INDEX IF NOT EXISTS ponto_ajustes_colab_data_idx ON ponto_ajustes (colaborador_id, data);

CREATE TABLE IF NOT EXISTS ponto_feriados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL,
  nome TEXT NOT NULL,
  abrangencia TEXT NOT NULL DEFAULT 'nacional' CHECK (abrangencia IN ('nacional', 'estadual', 'municipal')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (data, nome)
);

-- Mapeamento de colunas da planilha, salvo na primeira importação (chave = assinatura dos cabeçalhos).
CREATE TABLE IF NOT EXISTS ponto_mapeamentos (
  assinatura TEXT PRIMARY KEY,
  mapeamento JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log de auditoria do módulo (quem fez o quê, quando).
CREATE TABLE IF NOT EXISTS ponto_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acao TEXT NOT NULL,
  detalhes JSONB NOT NULL DEFAULT '{}',
  autor_id UUID,
  autor_nome TEXT NOT NULL DEFAULT '',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cadastro inicial (idempotente).
INSERT INTO ponto_colaboradores (nome) VALUES ('Jean'), ('João'), ('Arthur') ON CONFLICT DO NOTHING;

-- Feriados nacionais de 2026 e 2027 (fixos e móveis). Estaduais (SC) e municipais (Tubarão) se cadastram na tela.
INSERT INTO ponto_feriados (data, nome, abrangencia) VALUES
  ('2026-01-01', 'Confraternização Universal', 'nacional'),
  ('2026-04-03', 'Sexta-feira Santa', 'nacional'),
  ('2026-04-21', 'Tiradentes', 'nacional'),
  ('2026-05-01', 'Dia do Trabalho', 'nacional'),
  ('2026-09-07', 'Independência do Brasil', 'nacional'),
  ('2026-10-12', 'Nossa Senhora Aparecida', 'nacional'),
  ('2026-11-02', 'Finados', 'nacional'),
  ('2026-11-15', 'Proclamação da República', 'nacional'),
  ('2026-11-20', 'Dia da Consciência Negra', 'nacional'),
  ('2026-12-25', 'Natal', 'nacional'),
  ('2027-01-01', 'Confraternização Universal', 'nacional'),
  ('2027-03-26', 'Sexta-feira Santa', 'nacional'),
  ('2027-04-21', 'Tiradentes', 'nacional'),
  ('2027-05-01', 'Dia do Trabalho', 'nacional'),
  ('2027-09-07', 'Independência do Brasil', 'nacional'),
  ('2027-10-12', 'Nossa Senhora Aparecida', 'nacional'),
  ('2027-11-02', 'Finados', 'nacional'),
  ('2027-11-15', 'Proclamação da República', 'nacional'),
  ('2027-11-20', 'Dia da Consciência Negra', 'nacional'),
  ('2027-12-25', 'Natal', 'nacional')
ON CONFLICT DO NOTHING;
`;

export async function migrarPontos(pool: Pool): Promise<void> {
  await pool.query(SQL_PONTOS);
}

/** As tabelas do módulo já existem? (Sem a migração, as rotas respondem 503 com a instrução.) */
export async function pontosMigrado(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(`SELECT to_regclass('public.ponto_auditoria') IS NOT NULL AS ok`);
  return rows[0]?.ok === true;
}
