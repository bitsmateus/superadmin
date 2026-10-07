import type { Pool } from 'pg';

/**
 * Tabelas do módulo "Clientes NX Digital" (gestão de clientes de tráfego).
 *
 * Fica num arquivo só, fora do db.ts, porque o módulo é ilhado de propósito: ele tem cadastro
 * próprio de cliente e não encosta em `clients`, `contracts`, ficha nem vendas. O prefixo `gc_`
 * deixa isso visível em qualquer consulta ao banco.
 *
 * Tudo é CREATE ... IF NOT EXISTS, como o resto das migrações do projeto: roda a cada boot sem
 * fazer diferença quando já existe. A ordem importa (chaves estrangeiras), então os CREATEs saem
 * na sequência em que são declarados aqui.
 */

const TABELAS = [
  // ---------------------------------------------------------------- cadastro
  `CREATE TABLE IF NOT EXISTS gc_clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_empresa TEXT NOT NULL,
    nome_contato TEXT NOT NULL DEFAULT '',
    whatsapp_contato TEXT NOT NULL DEFAULT '',
    email_contato TEXT NOT NULL DEFAULT '',
    cnpj TEXT,
    cidade TEXT NOT NULL DEFAULT '',
    segmento TEXT NOT NULL DEFAULT '',
    logo_url TEXT,
    responsavel_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pausado','encerrado')),
    data_inicio DATE,
    observacoes_gerais TEXT NOT NULL DEFAULT '',
    -- Reservado pra Fase 2: ligação com o cadastro de clientes que já existe na plataforma.
    -- Nasce e fica NULL; nada neste módulo lê ou escreve isso hoje.
    cliente_externo_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS gc_servicos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('trafego_meta','trafego_google','central_ia','site','automacao','outro')),
    descricao_plano TEXT NOT NULL DEFAULT '',
    investimento_previsto_mensal NUMERIC(12,2),
    data_inicio DATE,
    -- Preenchida à mão nesta fase; na Fase 2 pode vir do contrato.
    data_renovacao DATE,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pausado','cancelado')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ---------------------------------------------------------------- modelos (templates)
  `CREATE TABLE IF NOT EXISTS gc_jornada_etapas_modelo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS gc_checklist_modelo_itens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    etapa_modelo_id UUID NOT NULL REFERENCES gc_jornada_etapas_modelo(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS gc_estrategias_modelo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '',
    servico_tipo TEXT,
    ativo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS gc_estrategias_modelo_itens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estrategia_modelo_id UUID NOT NULL REFERENCES gc_estrategias_modelo(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ---------------------------------------------------------------- jornada e estratégias do cliente
  `CREATE TABLE IF NOT EXISTS gc_cliente_jornada (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    etapa_id UUID REFERENCES gc_jornada_etapas_modelo(id) ON DELETE SET NULL,
    -- Nome copiado do modelo: renomear a etapa padrão depois não reescreve a história de quem já
    -- passou por ela.
    nome TEXT NOT NULL DEFAULT '',
    ordem INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida')),
    responsavel_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    prazo DATE,
    concluida_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS gc_cliente_estrategias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    estrategia_modelo_id UUID REFERENCES gc_estrategias_modelo(id) ON DELETE SET NULL,
    nome TEXT NOT NULL,
    objetivo TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada','em_execucao','concluida','pausada')),
    data_inicio DATE,
    responsavel_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS gc_checklist_itens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    gc_cliente_jornada_id UUID REFERENCES gc_cliente_jornada(id) ON DELETE CASCADE,
    gc_cliente_estrategia_id UUID REFERENCES gc_cliente_estrategias(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    concluido BOOLEAN NOT NULL DEFAULT false,
    concluido_por UUID REFERENCES profiles(id) ON DELETE SET NULL,
    concluido_em TIMESTAMPTZ,
    prazo DATE,
    responsavel_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Um item pertence a uma etapa da jornada OU a uma estratégia, nunca aos dois nem a nenhum.
    CONSTRAINT gc_checklist_dono CHECK (
      (gc_cliente_jornada_id IS NOT NULL AND gc_cliente_estrategia_id IS NULL)
      OR (gc_cliente_jornada_id IS NULL AND gc_cliente_estrategia_id IS NOT NULL)
    )
  )`,

  // ---------------------------------------------------------------- números
  `CREATE TABLE IF NOT EXISTS gc_metricas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    gc_servico_id UUID REFERENCES gc_servicos(id) ON DELETE SET NULL,
    periodo_inicio DATE NOT NULL,
    periodo_fim DATE NOT NULL,
    fonte TEXT NOT NULL DEFAULT 'manual' CHECK (fonte IN ('manual','central','meta_ads','google_ads')),
    chave TEXT NOT NULL,
    valor NUMERIC(14,2) NOT NULL DEFAULT 0,
    criado_por UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS gc_metricas_unica
     ON gc_metricas (gc_cliente_id, periodo_inicio, periodo_fim, fonte, chave)`,

  `CREATE TABLE IF NOT EXISTS gc_metas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    chave_metrica TEXT NOT NULL,
    valor_base NUMERIC(14,2) NOT NULL DEFAULT 0,
    data_base DATE,
    valor_meta NUMERIC(14,2) NOT NULL DEFAULT 0,
    prazo DATE,
    status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','atingida','expirada')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ---------------------------------------------------------------- histórico e relatórios
  `CREATE TABLE IF NOT EXISTS gc_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('nota','reuniao','ligacao','reclamacao','ajuste','evento_sistema')),
    titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    autor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    fixado BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS gc_relatorios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    periodo_inicio DATE NOT NULL,
    periodo_fim DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','publicado')),
    comentario_gestor TEXT NOT NULL DEFAULT '',
    proximos_passos TEXT NOT NULL DEFAULT '',
    publicado_em TIMESTAMPTZ,
    publicado_por UUID REFERENCES profiles(id) ON DELETE SET NULL,
    -- Foto dos números e textos no momento da publicação. O portal lê SEMPRE daqui: relatório
    -- publicado não muda depois, nem que alguém corrija a métrica do mês.
    snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS gc_relatorios_periodo
     ON gc_relatorios (gc_cliente_id, periodo_inicio, periodo_fim)`,

  // ---------------------------------------------------------------- link público
  `CREATE TABLE IF NOT EXISTS gc_links_publicos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    pin_hash TEXT,
    ativo BOOLEAN NOT NULL DEFAULT true,
    expira_em TIMESTAMPTZ,
    revogado_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Um link ativo por cliente: "gerar novo" revoga o anterior, e o banco garante isso.
  `CREATE UNIQUE INDEX IF NOT EXISTS gc_link_ativo_por_cliente
     ON gc_links_publicos (gc_cliente_id) WHERE ativo`,

  `CREATE TABLE IF NOT EXISTS gc_acessos_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id UUID NOT NULL REFERENCES gc_links_publicos(id) ON DELETE CASCADE,
    acessado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Hash, não o IP: serve pra separar visitantes e limitar tentativa de PIN, não pra identificar.
    ip_hash TEXT,
    user_agent TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS gc_acessos_link_idx ON gc_acessos_link (link_id, acessado_em DESC)`,

  // ---------------------------------------------------------------- avaliação do gestor
  // A nota que uma PESSOA dá pro resultado do mês. O semáforo automático olha números e prazos;
  // isso aqui é o julgamento de quem acompanha o cliente — e, quando os dois discordam, quem manda
  // é esta tabela (ver src/lib/gcSaude.ts).
  //
  // É por período porque resultado é do mês: dizer "esse cliente está ruim" sem dizer quando
  // apagaria a história de um cliente que estava mal em agosto e virou o jogo em outubro.
  `CREATE TABLE IF NOT EXISTS gc_avaliacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    periodo_inicio DATE NOT NULL,
    periodo_fim DATE NOT NULL,
    nivel TEXT NOT NULL CHECK (nivel IN ('otimo','bom','regular','ruim')),
    comentario TEXT NOT NULL DEFAULT '',
    autor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS gc_avaliacao_por_periodo
     ON gc_avaliacoes (gc_cliente_id, periodo_inicio, periodo_fim)`,

  // ---------------------------------------------------------------- acréscimos (colunas novas)
  // Vêm como ALTER porque as tabelas acima já existem em produção. Idempotentes, como o resto.

  // Horizonte da meta: a mesma métrica tem alvo pro mês, pro semestre e pro ano, e misturar os
  // três numa lista só não deixa ler nenhum ("100 leads" até quando?).
  `ALTER TABLE gc_metas ADD COLUMN IF NOT EXISTS horizonte TEXT NOT NULL DEFAULT 'mes'`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gc_metas_horizonte') THEN
       ALTER TABLE gc_metas ADD CONSTRAINT gc_metas_horizonte
         CHECK (horizonte IN ('mes','6_meses','12_meses'));
     END IF;
   END $$`,

  // Prioridade de atendimento, definida à mão: qual cliente a equipe olha primeiro quando o dia
  // não dá pra todos. É diferente do semáforo — um cliente pode estar verde e ainda assim ser o
  // mais importante da carteira (ou estar vermelho e ser pequeno).
  `ALTER TABLE gc_clientes ADD COLUMN IF NOT EXISTS prioridade TEXT NOT NULL DEFAULT 'media'`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gc_clientes_prioridade') THEN
       ALTER TABLE gc_clientes ADD CONSTRAINT gc_clientes_prioridade
         CHECK (prioridade IN ('alta','media','baixa'));
     END IF;
   END $$`,

  // ---------------------------------------------------------------- planejamento do cliente
  // O ponto A (situação de hoje, com números fixos de partida) e os textos dos cenários de 6 e 12
  // meses. Os NÚMEROS das metas desses cenários não ficam aqui: reaproveitam gc_metas, nos
  // horizontes '6_meses' e '12_meses', pra existir uma tabela de metas só e o que se define aqui
  // aparecer também em "Metas combinadas". Aqui moram só o que a tabela de metas não guarda: o
  // diagnóstico e os textos.
  `CREATE TABLE IF NOT EXISTS gc_planejamento (
    gc_cliente_id UUID PRIMARY KEY REFERENCES gc_clientes(id) ON DELETE CASCADE,
    -- "Situação de hoje", em texto livre. Leitura interna.
    situacao_atual TEXT NOT NULL DEFAULT '',
    -- Números fixos de partida (o ponto A). NULL = não informado, que é diferente de zero.
    leads_mes NUMERIC(14,2),
    investimento_mes NUMERIC(14,2),
    ticket_medio NUMERIC(14,2),
    -- Percentual de leads que viram venda (ex.: 8 = 8%).
    taxa_conversao NUMERIC(6,2),
    faturamento_mensal NUMERIC(14,2),
    data_diagnostico DATE,
    -- Como a meta se distribui mês a mês entre o ponto A e o horizonte.
    curva TEXT NOT NULL DEFAULT 'linear' CHECK (curva IN ('linear','composta')),
    -- Portal do cliente: o bloco "Nossa jornada" só aparece se alguém LIGAR, cliente a cliente. E os
    -- dois textos que podem ir pra lá também são opt-in; estratégia e premissas nunca vão.
    portal_ativo BOOLEAN NOT NULL DEFAULT false,
    portal_mostrar_situacao BOOLEAN NOT NULL DEFAULT false,
    portal_mostrar_objetivo BOOLEAN NOT NULL DEFAULT false,
    atualizado_por UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS gc_planejamento_cenarios (
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    horizonte TEXT NOT NULL CHECK (horizonte IN ('6_meses','12_meses')),
    onde_quer_chegar TEXT NOT NULL DEFAULT '',
    estrategia TEXT NOT NULL DEFAULT '',
    premissas TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (gc_cliente_id, horizonte)
  )`,
  // Histórico de alterações: UMA linha por salvamento, com o que mudou (campo, antes, depois).
  // Só INSERT — é registro, não cadastro.
  `CREATE TABLE IF NOT EXISTS gc_planejamento_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    alterado_por UUID REFERENCES profiles(id) ON DELETE SET NULL,
    alterado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mudancas JSONB NOT NULL DEFAULT '[]'
  )`,
  `CREATE INDEX IF NOT EXISTS gc_planejamento_historico_idx
     ON gc_planejamento_historico (gc_cliente_id, alterado_em DESC)`,

  // De onde veio cada número do ponto A: { leads_mes: { origem: 'calculado', meses: ['2026-07', ...] } }
  // ou { origem: 'informado' }. O ponto A é uma FOTO do diagnóstico, e saber se um número foi digitado
  // por alguém ou calculado da média dos meses lançados muda o quanto se confia nele.
  `ALTER TABLE gc_planejamento ADD COLUMN IF NOT EXISTS origens JSONB NOT NULL DEFAULT '{}'`,

  // Modelos de texto pros campos do planejamento (situação de hoje, onde quer chegar, estratégia,
  // premissas). Editáveis pela equipe: são ponto de partida, não verdade.
  `CREATE TABLE IF NOT EXISTS gc_planejamento_modelos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campo TEXT NOT NULL CHECK (campo IN ('situacao','objetivo','estrategia','premissas')),
    nome TEXT NOT NULL,
    texto TEXT NOT NULL DEFAULT '',
    ordem INT NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ---- "o básico bem feito": ponto A com 4 números, todos opcionais.
  // Vendas/mês entra como número digitado; ticket médio (faturamento ÷ vendas) e conversão (vendas ÷
  // leads) passam a ser CALCULADOS — as colunas antigas continuam existindo e guardam o valor derivado,
  // pra lista de clientes e o portal seguirem lendo o mesmo lugar.
  `ALTER TABLE gc_planejamento ADD COLUMN IF NOT EXISTS vendas_mes NUMERIC(14,2)`,
  `UPDATE gc_planejamento SET vendas_mes = ROUND(leads_mes * taxa_conversao / 100, 2)
     WHERE vendas_mes IS NULL AND leads_mes IS NOT NULL AND taxa_conversao IS NOT NULL`,
  // "Aguardando o cliente": o ponto A fica em branco de propósito, com um lembrete opcional que vira
  // pendência em Estratégias > Pendências enquanto o planejamento estiver nesse estado.
  `ALTER TABLE gc_planejamento ADD COLUMN IF NOT EXISTS aguardando_cliente BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE gc_planejamento ADD COLUMN IF NOT EXISTS lembrar_em DATE`,
  // Estratégia e premissas viram UM campo ("Estratégia e premissas", interno). O que já estava escrito
  // nas premissas é acrescentado ao fim da estratégia, sem perder nada; depois a coluna fica vazia.
  `UPDATE gc_planejamento_cenarios SET
       estrategia = CASE WHEN btrim(estrategia) = '' THEN premissas
                         ELSE rtrim(estrategia) || E'\\n\\nPremissas:\\n' || premissas END,
       premissas = ''
     WHERE btrim(premissas) <> ''`,
  // Modelos de "premissas" passam pra "estratégia e premissas", com o nome deixando claro de onde vêm.
  `UPDATE gc_planejamento_modelos SET campo = 'estrategia', nome = 'Premissas — ' || nome,
       ordem = ordem + 100, updated_at = NOW()
     WHERE campo = 'premissas'`,

  // "Adicionar info": informações livres do mês de um cliente — um número relevante do tráfego, uma
  // observação —, que não cabem nas métricas fixas. Opcionalmente entram no relatório do cliente.
  `CREATE TABLE IF NOT EXISTS gc_infos_mes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    periodo_inicio DATE NOT NULL,
    titulo TEXT NOT NULL,
    valor TEXT NOT NULL DEFAULT '',
    observacao TEXT NOT NULL DEFAULT '',
    no_relatorio BOOLEAN NOT NULL DEFAULT false,
    autor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS gc_infos_mes_idx ON gc_infos_mes (gc_cliente_id, periodo_inicio)`,

  // "Estratégia usada": texto livre por cliente. A estratégia quase sempre é personalizada, então em vez de
  // escolher um modelo pronto a equipe escreve o que está sendo feito.
  `ALTER TABLE gc_clientes ADD COLUMN IF NOT EXISTS estrategia_usada TEXT NOT NULL DEFAULT ''`,

  // "Cliente já em andamento": etapas que o cliente já tinha cumprido ANTES de entrar no módulo ficam
  // concluídas SEM data (concluida_em nulo) e marcadas — inventar uma data seria registrar o que ninguém
  // sabe.
  `ALTER TABLE gc_cliente_jornada ADD COLUMN IF NOT EXISTS concluida_antes BOOLEAN NOT NULL DEFAULT false`,

  // Rotina mensal: itens que nascem sozinhos todo mês (publicar o relatório, alinhar com o cliente),
  // com prazo automático. Não pertencem a etapa nem a estratégia — são do CLIENTE, no mês de
  // referência —, então a regra de "dono" do item ganha uma terceira forma.
  `ALTER TABLE gc_checklist_itens ADD COLUMN IF NOT EXISTS recorrente_chave TEXT`,
  `ALTER TABLE gc_checklist_itens ADD COLUMN IF NOT EXISTS mes_referencia DATE`,
  `ALTER TABLE gc_checklist_itens DROP CONSTRAINT IF EXISTS gc_checklist_dono`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gc_checklist_dono_v2') THEN
       ALTER TABLE gc_checklist_itens ADD CONSTRAINT gc_checklist_dono_v2 CHECK (
         (gc_cliente_jornada_id IS NOT NULL AND gc_cliente_estrategia_id IS NULL AND recorrente_chave IS NULL)
         OR (gc_cliente_jornada_id IS NULL AND gc_cliente_estrategia_id IS NOT NULL AND recorrente_chave IS NULL)
         OR (gc_cliente_jornada_id IS NULL AND gc_cliente_estrategia_id IS NULL AND recorrente_chave IS NOT NULL)
       );
     END IF;
   END $$`,
  // Registro do que JÁ FOI GERADO por cliente/rotina/mês. É ele (e não a existência do item) que
  // decide se gera: apagar um item que não faz sentido pra aquele cliente não pode fazer ele
  // ressuscitar na próxima abertura da tela.
  `CREATE TABLE IF NOT EXISTS gc_recorrentes_gerados (
    gc_cliente_id UUID NOT NULL REFERENCES gc_clientes(id) ON DELETE CASCADE,
    chave TEXT NOT NULL,
    mes_referencia DATE NOT NULL,
    gerado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (gc_cliente_id, chave, mes_referencia)
  )`,

  // Cliente de teste ou arquivado: continua existindo e aparecendo nas listas, mas fica FORA dos
  // totais (investimento, leads, risco...). É diferente de "encerrado", que é um cliente que saiu —
  // teste é cadastro que nunca foi cliente de verdade e não pode inflar a carteira.
  `ALTER TABLE gc_clientes ADD COLUMN IF NOT EXISTS fora_dos_totais BOOLEAN NOT NULL DEFAULT false`,

  // Prints e arquivos colados no registro — mesmo formato dos anexos de lead_notes:
  // [{ id, name, type, size, dataUrl }]. Fica no banco (data URL) como o resto do projeto, em vez
  // de depender de um bucket que não existe aqui.
  `ALTER TABLE gc_historico ADD COLUMN IF NOT EXISTS anexos JSONB NOT NULL DEFAULT '[]'`,

  // Índices de leitura das telas
  `CREATE INDEX IF NOT EXISTS gc_servicos_cliente_idx ON gc_servicos (gc_cliente_id)`,
  `CREATE INDEX IF NOT EXISTS gc_jornada_cliente_idx ON gc_cliente_jornada (gc_cliente_id, ordem)`,
  `CREATE INDEX IF NOT EXISTS gc_checklist_cliente_idx ON gc_checklist_itens (gc_cliente_id, concluido)`,
  `CREATE INDEX IF NOT EXISTS gc_metricas_cliente_idx ON gc_metricas (gc_cliente_id, periodo_inicio)`,
  `CREATE INDEX IF NOT EXISTS gc_historico_cliente_idx ON gc_historico (gc_cliente_id, created_at DESC)`,
];

/** As 9 etapas padrão da jornada, com o checklist inicial de cada uma. */
const ETAPAS_PADRAO: { nome: string; itens: string[] }[] = [
  { nome: 'Fechado', itens: ['Pagamento da entrada confirmado', 'Dados do decisor registrados'] },
  { nome: 'Grupo de WhatsApp criado', itens: ['Grupo criado com cliente e equipe', 'Mensagem de boas-vindas enviada'] },
  { nome: 'Ficha de cadastro recebida', itens: ['Ficha enviada ao cliente', 'Ficha preenchida e conferida'] },
  { nome: 'Contrato assinado', itens: ['Contrato enviado', 'Contrato assinado e arquivado'] },
  {
    nome: 'Implantação / configuração das campanhas',
    itens: [
      'Acesso ao Business Manager liberado',
      'Pixel / conversões configurados',
      'Públicos criados',
      'Criativos aprovados pelo cliente',
      'Campanhas no ar',
    ],
  },
  { nome: 'Go-live', itens: ['Primeiros leads chegando', 'Cliente avisado de que está no ar'] },
  { nome: 'Revisão de 30 dias', itens: ['Reunião de 30 dias realizada', 'Ajustes de campanha definidos'] },
  { nome: 'Acompanhamento mensal', itens: ['Relatório do mês publicado', 'Alinhamento mensal com o cliente'] },
  { nome: 'Renovação', itens: ['Conversa de renovação feita', 'Renovação confirmada'] },
];

/** Estratégias prontas pra aplicar num cliente — o time ajusta e cria outras pela tela. */
const ESTRATEGIAS_PADRAO: { nome: string; descricao: string; servicoTipo: string; passos: string[] }[] = [
  {
    nome: 'Campanha de leads para WhatsApp — Meta',
    descricao: 'Captação de leads levando a conversa direto pro WhatsApp do cliente.',
    servicoTipo: 'trafego_meta',
    passos: ['Definir público e região', 'Produzir 3 criativos', 'Subir campanha', 'Acompanhar CPL na primeira semana'],
  },
  {
    nome: 'Remarketing',
    descricao: 'Reimpactar quem já interagiu e não comprou.',
    servicoTipo: 'trafego_meta',
    passos: ['Criar público de engajamento', 'Criativo de prova social', 'Subir campanha', 'Medir frequência'],
  },
  {
    nome: 'Campanha de pesquisa — Google',
    descricao: 'Aparecer para quem já procura o serviço.',
    servicoTipo: 'trafego_google',
    passos: ['Levantar palavras-chave', 'Escrever anúncios', 'Configurar conversões', 'Revisar termos de pesquisa'],
  },
];

/**
 * Modelos de texto iniciais do planejamento. São ponto de partida pra a equipe ajustar — escritos
 * genéricos de propósito. As chaves entre chaves ({cliente}, {segmento}, {leads_hoje}...) são
 * trocadas pelos dados do cliente ao aplicar; o que não souber trocar fica visível pra ser
 * preenchido à mão.
 */
const MODELOS_PLANEJAMENTO_PADRAO: { campo: string; nome: string; texto: string }[] = [
  {
    campo: 'situacao', nome: 'Primeiro diagnóstico',
    texto: '{cliente} ({segmento}) hoje investe R$ {investimento_hoje}/mês em anúncios e recebe cerca de {leads_hoje} leads/mês.\n\nO que já faz:\n- \n\nO que não funciona:\n- \n\nO que o cliente espera de nós:\n- ',
  },
  {
    campo: 'situacao', nome: 'Já anunciava antes',
    texto: '{cliente} já anunciava antes de chegar até nós, [por conta própria / com outra agência].\n\nResultado até aqui: \nPrincipal dor: \nO que não quer repetir: ',
  },
  {
    campo: 'situacao', nome: 'Começando do zero',
    texto: '{cliente} ({segmento}) ainda não tem anúncios estruturados. Parte de uma base de [seguidores / contatos / clientes] e quer [objetivo inicial].\n\nCanais que já usa: \nTime comercial: ',
  },
  {
    campo: 'objetivo', nome: 'Crescer o volume de leads',
    texto: 'Chegar a {meta_leads_6m} leads por mês em 6 meses, sem perder a qualidade do atendimento, e sustentar esse volume até o fim do primeiro ano.',
  },
  {
    campo: 'objetivo', nome: 'Mais faturamento com o mesmo investimento',
    texto: 'Aumentar o faturamento vindo dos anúncios para R$ {meta_faturamento_6m}/mês mantendo o investimento perto do atual, melhorando a eficiência (CPL e conversão).',
  },
  {
    campo: 'objetivo', nome: 'Abrir uma nova frente',
    texto: 'Validar [Google / remarketing / nova unidade] como segunda fonte de leads e chegar, em 12 meses, com ela respondendo por [x]% do total.',
  },
  {
    campo: 'estrategia', nome: 'Captação via Meta Ads (WhatsApp)',
    texto: '1. Campanhas de captação levando direto pro WhatsApp.\n2. Três criativos novos por mês, com teste de público.\n3. Acompanhar CPL semanalmente e pausar o que passar do teto.\n4. Relatório mensal com leads, vendas e custo por venda.',
  },
  {
    campo: 'estrategia', nome: 'Remarketing e prova social',
    texto: '1. Público de quem interagiu e não comprou.\n2. Criativos de depoimento e resultado.\n3. Frequência controlada pra não saturar.\n4. Medir quantas vendas vêm desse público.',
  },
  {
    campo: 'estrategia', nome: 'Google + Meta',
    texto: '1. Pesquisa no Google pra quem já procura o serviço.\n2. Meta pra gerar demanda e remarketing.\n3. Orçamento dividido pelo custo por venda de cada canal, revisado todo mês.',
  },
  {
    campo: 'estrategia', nome: 'Premissas — CPL e conversão',
    texto: '- O CPL cai de R$ {cpl_hoje} pra [alvo] com criativo novo e público refinado.\n- A taxa de conversão sobe de {conversao_hoje}% pra [alvo]% com atendimento mais rápido.',
  },
  {
    campo: 'estrategia', nome: 'Premissas — Operação do cliente',
    texto: '- O cliente responde os leads em até 5 minutos no horário comercial.\n- Há equipe suficiente pra atender {meta_leads_6m} leads/mês.\n- O cliente aprova os criativos em até 48h.',
  },
  {
    campo: 'estrategia', nome: 'Premissas — Orçamento',
    texto: '- O investimento sobe de R$ {investimento_hoje} pra R$ {meta_investimento_6m}/mês no período.\n- Não há sazonalidade forte nos meses do plano (ou está descontada: [explicar]).',
  },
];

/**
 * Cria as tabelas e, só na primeira vez, as etapas/estratégias padrão. O seed checa se já existe
 * alguma linha antes de inserir — mexer nos modelos pela tela não é desfeito no próximo boot.
 */
export async function criarEstruturaGestaoClientes(pool: Pool): Promise<void> {
  for (const sql of TABELAS) await pool.query(sql);

  const { rows: etapas } = await pool.query<{ total: string }>('SELECT count(*) AS total FROM gc_jornada_etapas_modelo');
  if (Number(etapas[0]?.total ?? 0) === 0) {
    for (const [i, etapa] of ETAPAS_PADRAO.entries()) {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO gc_jornada_etapas_modelo (nome, ordem) VALUES ($1, $2) RETURNING id',
        [etapa.nome, i]
      );
      for (const [j, titulo] of etapa.itens.entries()) {
        await pool.query(
          'INSERT INTO gc_checklist_modelo_itens (etapa_modelo_id, titulo, ordem) VALUES ($1, $2, $3)',
          [rows[0].id, titulo, j]
        );
      }
    }
    console.log('[gestao-clientes] jornada padrão criada (9 etapas)');
  }

  // Modelos de texto do planejamento: só se a tabela está vazia, pra o que a equipe editou ou apagou
  // não voltar no próximo boot.
  const { rows: modelosTexto } = await pool.query<{ total: string }>('SELECT count(*) AS total FROM gc_planejamento_modelos');
  if (Number(modelosTexto[0]?.total ?? 0) === 0) {
    const ordemPorCampo: Record<string, number> = {};
    for (const m of MODELOS_PLANEJAMENTO_PADRAO) {
      const ordem = (ordemPorCampo[m.campo] = (ordemPorCampo[m.campo] ?? -1) + 1);
      await pool.query(
        'INSERT INTO gc_planejamento_modelos (campo, nome, texto, ordem) VALUES ($1, $2, $3, $4)',
        [m.campo, m.nome, m.texto, ordem]
      );
    }
    console.log('[gestao-clientes] modelos de texto do planejamento criados');
  }

  const { rows: estrategias } = await pool.query<{ total: string }>('SELECT count(*) AS total FROM gc_estrategias_modelo');
  if (Number(estrategias[0]?.total ?? 0) === 0) {
    for (const e of ESTRATEGIAS_PADRAO) {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO gc_estrategias_modelo (nome, descricao, servico_tipo) VALUES ($1, $2, $3) RETURNING id',
        [e.nome, e.descricao, e.servicoTipo]
      );
      for (const [j, titulo] of e.passos.entries()) {
        await pool.query(
          'INSERT INTO gc_estrategias_modelo_itens (estrategia_modelo_id, titulo, ordem) VALUES ($1, $2, $3)',
          [rows[0].id, titulo, j]
        );
      }
    }
    console.log('[gestao-clientes] estratégias padrão criadas');
  }
}
