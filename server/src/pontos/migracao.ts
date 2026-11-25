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
    'perdoar_desconto', 'descontar_saldo', 'extra_banco', 'extra_pagamento', 'corrigir_batidas', 'atestado', 'descontar_horas'
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
  'perdoar_desconto', 'descontar_saldo', 'extra_banco', 'extra_pagamento', 'corrigir_batidas', 'atestado', 'descontar_horas'
));

-- Atestado (abona a falta) e desconto manual de horas (admin): quantos minutos e se sai do banco ou em R$.
ALTER TABLE ponto_ajustes ADD COLUMN IF NOT EXISTS minutos INT;
ALTER TABLE ponto_ajustes ADD COLUMN IF NOT EXISTS destino TEXT;
ALTER TABLE ponto_ajustes DROP CONSTRAINT IF EXISTS ponto_ajustes_tipo_check;
ALTER TABLE ponto_ajustes ADD CONSTRAINT ponto_ajustes_tipo_check CHECK (tipo IN (
  'abonar_manha', 'abonar_tarde', 'abonar_atraso', 'abonar_falta', 'justificar', 'folga', 'compensacao', 'feriado',
  'perdoar_desconto', 'descontar_saldo', 'extra_banco', 'extra_pagamento', 'corrigir_batidas', 'atestado', 'descontar_horas'
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

-- Dia 10/11/2026 (início do controle): os três bateram o ponto certinho (08:00-12:00 / 13:30-18:00), e o Arthur também
-- nos dias 11, 12 e 13. Vira "correção de batidas" (a original, se houver, fica guardada). Se antes tinha ficado o abono
-- de manhã/tarde desse dia (versão anterior desta migração), ele é removido. Só na primeira vez.
UPDATE ponto_ajustes SET removido_em = NOW(), removido_por_nome = 'migração'
 WHERE data = DATE '2026-11-10' AND tipo IN ('abonar_manha', 'abonar_tarde') AND autor_nome = 'migração' AND removido_em IS NULL
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_dias_certinhos');
INSERT INTO ponto_ajustes (colaborador_id, data, tipo, motivo, batidas, autor_nome)
SELECT c.id, d.data::date, 'corrigir_batidas', 'Bateu o ponto certinho (informado pela gestão; relógio entrou em uso em 10/11)',
       '["08:00","12:00","13:30","18:00"]'::jsonb, 'migração'
  FROM ponto_colaboradores c
 CROSS JOIN (VALUES ('2026-11-10'), ('2026-11-11'), ('2026-11-12'), ('2026-11-13')) AS d(data)
 WHERE ((lower(c.nome) IN ('jean', 'joão', 'joao') AND d.data = '2026-11-10') OR lower(c.nome) = 'arthur')
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_dias_certinhos');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_dias_certinhos', '{"dia10":["Jean","João","Arthur"],"arthur":["2026-11-11","2026-11-12","2026-11-13"]}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_dias_certinhos');

-- Arthur: o controle dele começa em 10/11/2026, como o do Jean e do João (os dias antes ficam fora). Mesmo horário da casa, segunda a sexta; salário e destino da hora extra ficam como estão no cadastro.
-- Só na primeira vez: depois vale o que for alterado na tela de Colaboradores.
UPDATE ponto_colaboradores SET
  dias_semana = '{1,2,3,4,5}', minutos_dia = 510, entrada_prevista = '08:00', saida_prevista = '18:00',
  intervalo_inicio = '12:00', intervalo_minutos = 90, tolerancia_minutos = 10, inicio_controle = '2026-11-10', atualizado_em = NOW()
 WHERE lower(nome) = 'arthur'
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_cadastro_arthur');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_cadastro_arthur', '{"inicio_controle":"2026-11-10","horario":"08:00-12:00/13:30-18:00","dias":"seg-sex"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_cadastro_arthur');

-- Quem já tinha rodado a versão anterior (controle do Arthur em 16/11): passa pra 10/11. Só uma vez.
UPDATE ponto_colaboradores SET inicio_controle = '2026-11-10', atualizado_em = NOW()
 WHERE lower(nome) = 'arthur' AND inicio_controle = DATE '2026-11-16'
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_arthur_inicio_10');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_arthur_inicio_10', '{"inicio_controle":"2026-11-10"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_arthur_inicio_10');

-- Arthur: salário base R$ 1.900 (+ comissão, que fica na aba Comissões) e a manhã de 16/11 (só bateu 13:30, faltou de manhã)
-- vira desconto em R$ quando o dia fechar (saldo negativo convertido). Só na primeira vez.
UPDATE ponto_colaboradores SET salario_base_centavos = 190000, atualizado_em = NOW()
 WHERE lower(nome) = 'arthur' AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_arthur_salario_dia16');
INSERT INTO ponto_ajustes (colaborador_id, data, tipo, motivo, autor_nome)
SELECT c.id, DATE '2026-11-16', 'descontar_saldo', 'Faltou de manhã (bateu só às 13:30): desconta em R$', 'migração'
  FROM ponto_colaboradores c
 WHERE lower(c.nome) = 'arthur' AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_arthur_salario_dia16');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_arthur_salario_dia16', '{"salario_base_centavos":190000,"dia16":"descontar_saldo"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_arthur_salario_dia16');

-- Arthur bateu ponto em 16/11 às 13:30 (só isso; de manhã faltou). Registrado como batida original; a importação do
-- relógio com o mesmo horário não duplica (se vier outro horário, aparece como conflito pra decidir). Só uma vez.
INSERT INTO ponto_batidas (colaborador_id, data, hora)
SELECT c.id, DATE '2026-11-16', '13:30' FROM ponto_colaboradores c
 WHERE lower(c.nome) = 'arthur' AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_arthur_batida_dia16')
ON CONFLICT DO NOTHING;
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_arthur_batida_dia16', '{"data":"2026-11-16","hora":"13:30"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_arthur_batida_dia16');

-- Arthur saiu às 17:30 em 16/11 (entrou 13:30, de manhã faltou). Só uma vez.
INSERT INTO ponto_batidas (colaborador_id, data, hora)
SELECT c.id, DATE '2026-11-16', '17:30' FROM ponto_colaboradores c
 WHERE lower(c.nome) = 'arthur' AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_arthur_saida_dia16')
ON CONFLICT DO NOTHING;
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_arthur_saida_dia16', '{"data":"2026-11-16","hora":"17:30"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_arthur_saida_dia16');

-- Início do controle (pedido de 16/11): Jean e João contam a partir de 11/11 (foram cadastrados no relógio em 10/11, os dias
-- 01 a 10 ficam de fora); Arthur a partir de 12/11. Só troca quem ainda está com a data das versões anteriores (10/11 e
-- 16/11), então o que alguém mudou na tela fica. As correções de batida lançadas pra dias que agora ficam fora do controle
-- (10/11 dos três e 11/11 do Arthur) são retiradas.
UPDATE ponto_colaboradores SET inicio_controle = '2026-11-11', atualizado_em = NOW()
 WHERE lower(nome) IN ('jean', 'joão', 'joao') AND inicio_controle = DATE '2026-11-10'
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_inicio_controle_v2');
UPDATE ponto_colaboradores SET inicio_controle = '2026-11-12', atualizado_em = NOW()
 WHERE lower(nome) = 'arthur' AND inicio_controle IN (DATE '2026-11-10', DATE '2026-11-16')
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_inicio_controle_v2');
UPDATE ponto_ajustes a SET removido_em = NOW(), removido_por_nome = 'migração'
  FROM ponto_colaboradores c
 WHERE c.id = a.colaborador_id AND a.tipo = 'corrigir_batidas' AND a.autor_nome = 'migração' AND a.removido_em IS NULL
   AND ((a.data = DATE '2026-11-10') OR (lower(c.nome) = 'arthur' AND a.data = DATE '2026-11-11'))
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_inicio_controle_v2');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_inicio_controle_v2', '{"jean_joao":"2026-11-11","arthur":"2026-11-12"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_inicio_controle_v2');

-- Novo colaborador: Luis, salário base R$ 2.500 (+ comissão, que fica na aba Comissões), controle a partir de 18/11/2026.
-- Horário da casa (seg a sex, 08:00-12:00 / 13:30-18:00, tolerância 10 min), hora extra pra folha como o Jean e o João.
-- Só na primeira vez: depois vale o que for alterado na tela de Colaboradores.
INSERT INTO ponto_colaboradores (nome) VALUES ('Luis') ON CONFLICT DO NOTHING;
UPDATE ponto_colaboradores SET
  dias_semana = '{1,2,3,4,5}', minutos_dia = 510, entrada_prevista = '08:00', saida_prevista = '18:00',
  intervalo_inicio = '12:00', intervalo_minutos = 90, tolerancia_minutos = 10, destino_extra = 'pagamento',
  salario_base_centavos = 250000, inicio_controle = '2026-11-18', atualizado_em = NOW()
 WHERE lower(nome) IN ('luis', 'luís') AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_cadastro_luis');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_cadastro_luis', '{"salario_base_centavos":250000,"inicio_controle":"2026-11-18","extra":"pagamento"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_cadastro_luis');

-- Arthur e Luis saem dos Pontos (pedido de 25/11): ficam inativos (somem da tela e da importação; os registros continuam guardados e
-- dá pra reativar na tela de Colaboradores). Só na primeira vez: se alguém reativar depois, não é desativado de novo.
UPDATE ponto_colaboradores SET ativo = false, atualizado_em = NOW()
 WHERE lower(nome) IN ('arthur', 'luis', 'luís')
   AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_remover_arthur_luis');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_remover_arthur_luis', '{"inativados":["Arthur","Luis"]}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_remover_arthur_luis');

-- Ajustes do Jean (pedido de 25/11), lançados uma vez: 25/11 atestado (falta abonada, dia inteiro); 18/11 atestado de 1h (dentista:
-- saiu 1h mais cedo, abonado); 24/11 uma hora fora, descontada direto do salário. Só na primeira vez: depois vale o que for mexido na tela.
INSERT INTO ponto_ajustes (colaborador_id, data, tipo, motivo, minutos, destino, autor_nome)
SELECT c.id, v.data::date, v.tipo, v.motivo, v.minutos, v.destino, 'migração'
  FROM ponto_colaboradores c
 CROSS JOIN (VALUES
   ('2026-11-25', 'atestado', 'Atestado: falta abonada (informado pela gestão)', NULL::int, NULL::text),
   ('2026-11-18', 'atestado', 'Atestado de 1h (dentista): saiu 1h mais cedo, abonado', 60, NULL::text),
   ('2026-11-24', 'descontar_horas', 'Ficou 1 hora fora: descontada direto do salário', 60, 'dinheiro')
 ) AS v(data, tipo, motivo, minutos, destino)
 WHERE lower(c.nome) = 'jean' AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_jean_ajustes_2511');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_jean_ajustes_2511', '{"25/11":"atestado dia","18/11":"atestado 1h","24/11":"desconto 1h salário"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_jean_ajustes_2511');

-- Ajustes do João (pedido de 25/11), lançados uma vez: segunda 23/11 não veio, com atestado (falta abonada, dia inteiro); 18/11 saiu
-- 2h mais cedo, com atestado (abonado). Só na primeira vez: depois vale o que for mexido na tela.
INSERT INTO ponto_ajustes (colaborador_id, data, tipo, motivo, minutos, destino, autor_nome)
SELECT c.id, v.data::date, v.tipo, v.motivo, v.minutos, NULL, 'migração'
  FROM ponto_colaboradores c
 CROSS JOIN (VALUES
   ('2026-11-23', 'atestado', 'Atestado: falta abonada (informado pela gestão)', NULL::int),
   ('2026-11-18', 'atestado', 'Atestado de 2h: saiu 2h mais cedo, abonado (informado pela gestão)', 120)
 ) AS v(data, tipo, motivo, minutos)
 WHERE lower(c.nome) IN ('joão', 'joao') AND NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_joao_ajustes_2511');
INSERT INTO ponto_auditoria (acao, detalhes, autor_nome)
SELECT 'migracao_joao_ajustes_2511', '{"23/11":"atestado dia","18/11":"atestado 2h"}', 'migração'
 WHERE NOT EXISTS (SELECT 1 FROM ponto_auditoria WHERE acao = 'migracao_joao_ajustes_2511');

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
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ponto_ajustes' AND column_name = 'minutos')
        AND to_regclass('public.ponto_turnos') IS NOT NULL AS ok`
  );
  return rows[0]?.ok === true;
}
