import type { Pool } from 'pg';

/**
 * Migração do módulo Pontos (Financeiro > Pontos). SÓ ADITIVA: cria tabelas novas com prefixo `ponto_` e o cadastro
 * inicial (Jean, João, Arthur). Não toca em nenhuma tabela existente.
 *
 * Roda na subida do servidor (server/src/index.ts, desde 16/11, fora do runMigrations: falha aqui não afeta o resto).
 * Também dá pra rodar à mão:
 *   node dist/pontos/migrar.js            (produção, depois do build)
 *   npx tsx src/pontos/migrar.ts          (desenvolvimento)
 * Pode rodar mais de uma vez: tudo é IF NOT EXISTS / ON CONFLICT DO NOTHING, e o cadastro inicial só uma vez.
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
  minutos_dia INT NOT NULL DEFAULT 510,
  minutos_sabado INT NOT NULL DEFAULT 240,
  minutos_domingo INT NOT NULL DEFAULT 0,
  entrada_prevista TEXT NOT NULL DEFAULT '08:00',
  saida_prevista TEXT NOT NULL DEFAULT '18:00',
  -- Almoço: começa em intervalo_inicio e dura intervalo_minutos (padrão 12:00-13:30). Divide o dia em manhã e tarde.
  intervalo_minutos INT NOT NULL DEFAULT 90,
  intervalo_inicio TEXT DEFAULT '12:00',
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
  tipo TEXT NOT NULL CONSTRAINT ponto_ajustes_tipo_check CHECK (tipo IN (
    'abonar_manha', 'abonar_tarde', 'abonar_atraso', 'abonar_falta', 'justificar', 'folga', 'compensacao', 'feriado',
    'perdoar_desconto', 'descontar_saldo', 'extra_banco', 'extra_pagamento', 'corrigir_batidas'
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

-- Turno de cada dia vindo da aba "Turnos" do relógio: dia com turno, sem turno, ou ausência justificada
-- (25 = licença, 26 = viagem, férias). Sem linha aqui, vale o cadastro do colaborador (dias da semana).
CREATE TABLE IF NOT EXISTS ponto_turnos (
  colaborador_id UUID NOT NULL REFERENCES ponto_colaboradores(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('turno', 'sem_turno', 'justificada')),
  codigo TEXT,
  importacao_id UUID REFERENCES ponto_importacoes(id) ON DELETE CASCADE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (colaborador_id, data)
);
CREATE INDEX IF NOT EXISTS ponto_turnos_importacao_idx ON ponto_turnos (importacao_id);

-- Colunas novas (aditivas) pra quem já tinha rodado uma versão anterior desta migração.
ALTER TABLE ponto_colaboradores ADD COLUMN IF NOT EXISTS intervalo_inicio TEXT DEFAULT '12:00';
-- Início do controle de ponto: antes dessa data nada conta (nem falta, nem previsto, nem saldo).
ALTER TABLE ponto_colaboradores ADD COLUMN IF NOT EXISTS inicio_controle DATE;
-- Tipos de ajuste novos (abonar manhã/tarde, converter saldo negativo em desconto).
ALTER TABLE ponto_ajustes DROP CONSTRAINT IF EXISTS ponto_ajustes_tipo_check;
ALTER TABLE ponto_ajustes ADD CONSTRAINT ponto_ajustes_tipo_check CHECK (tipo IN (
  'abonar_manha', 'abonar_tarde', 'abonar_atraso', 'abonar_falta', 'justificar', 'folga', 'compensacao', 'feriado',
  'perdoar_desconto', 'descontar_saldo', 'extra_banco', 'extra_pagamento', 'corrigir_batidas'
));

-- Cadastro inicial (idempotente). Horário da casa: 08:00-12:00 e 13:30-18:00 (8h30), 10 min de tolerância.
INSERT INTO ponto_colaboradores (nome) VALUES ('Jean'), ('João'), ('Arthur') ON CONFLICT DO NOTHING;
-- Como aparecem na planilha do relógio.
UPDATE ponto_colaboradores SET apelidos = array_append(apelidos, 'joao vitor')
 WHERE lower(nome) IN ('joão', 'joao') AND NOT ('joao vitor' = ANY(apelidos));
UPDATE ponto_colaboradores SET apelidos = array_append(apelidos, 'jean may')
 WHERE lower(nome) = 'jean' AND NOT ('jean may' = ANY(apelidos));
-- Início do controle do João e do Jean (10/11/2026): só na primeira vez (se depois mudarem na tela, fica o da tela).
UPDATE ponto_colaboradores SET inicio_controle = '2026-11-10'
 WHERE lower(nome) IN ('joão', 'joao', 'jean') AND inicio_controle IS NULL
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_inicio_controle');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_inicio_controle', '{"data":"2026-11-10","colaboradores":["João","Jean"]}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_inicio_controle');

-- Cadastro do Jean e do João (pedido de 16/11): segunda a sexta, 08:00-12:00 / 13:30-18:00 (8h30), 10 min de
-- tolerância, hora extra pra folha (pagamento). Salário base: Jean R$ 2.500, João R$ 2.100 (+ comissão, que fica na aba
-- Comissões, fora do ponto). Só na primeira vez: depois vale o que for alterado na tela de Colaboradores.
UPDATE ponto_colaboradores SET
  dias_semana = '{1,2,3,4,5}', minutos_dia = 510, entrada_prevista = '08:00', saida_prevista = '18:00',
  intervalo_inicio = '12:00', intervalo_minutos = 90, tolerancia_minutos = 10, destino_extra = 'pagamento',
  salario_base_centavos = CASE WHEN lower(nome) = 'jean' THEN 250000 ELSE 210000 END, atualizado_em = NOW()
 WHERE lower(nome) IN ('jean', 'joão', 'joao')
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_cadastro_jean_joao');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_cadastro_jean_joao', '{"horario":"08:00-12:00/13:30-18:00","extra":"pagamento","dias":"seg-sex"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_cadastro_jean_joao');

-- Dia 10/11/2026 foi o teste do relógio (antes não havia ponto; bateram à tarde só pra testar): manhã e tarde abonadas
-- pra Jean e João, o dia fica zerado. Só na primeira vez; se alguém remover o abono na tela, ele não volta.
INSERT INTO ponto_ajustes (colaborador_id, data, tipo, motivo, autor_nome)
SELECT c.id, DATE '2026-11-10', t.tipo, 'Dia de teste do relógio de ponto (antes não havia controle)', 'migração'
  FROM ponto_colaboradores c CROSS JOIN (VALUES ('abonar_manha'), ('abonar_tarde')) AS t(tipo)
 WHERE lower(c.nome) IN ('jean', 'joão', 'joao')
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_abono_dia_10');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_abono_dia_10', '{"data":"2026-11-10","tipos":["abonar_manha","abonar_tarde"],"colaboradores":["Jean","João"]}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_abono_dia_10');

-- Arthur (pedido de 16/11): o controle dele começa em 16/11/2026 (os dias do início do mês ficam fora, como se tivesse
-- vindo certinho). Mesmo horário da casa, segunda a sexta; salário e destino da hora extra ficam como estão no cadastro.
-- Só na primeira vez: depois vale o que for alterado na tela de Colaboradores.
UPDATE ponto_colaboradores SET
  dias_semana = '{1,2,3,4,5}', minutos_dia = 510, entrada_prevista = '08:00', saida_prevista = '18:00',
  intervalo_inicio = '12:00', intervalo_minutos = 90, tolerancia_minutos = 10, inicio_controle = '2026-11-16', atualizado_em = NOW()
 WHERE lower(nome) = 'arthur'
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_cadastro_arthur');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_cadastro_arthur', '{"inicio_controle":"2026-11-16","horario":"08:00-12:00/13:30-18:00","dias":"seg-sex"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_cadastro_arthur');

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
  // Confere a coluna mais nova: quem rodou uma versão anterior da migração precisa rodar de novo.
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ponto_colaboradores' AND column_name = 'inicio_controle')
        AND to_regclass('public.ponto_turnos') IS NOT NULL AS ok`
  );
  return rows[0]?.ok === true;
}
