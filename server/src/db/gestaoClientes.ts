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
