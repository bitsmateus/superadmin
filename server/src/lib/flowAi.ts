import type { FlowSpec } from './flowSpec.js';
import { validateSpec } from './flowValidator.js';

// ── Config (só no backend; a chave da Claude NUNCA vai pro front) ────────────────
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_RETRIES = Number(process.env.CHATBOT_FLOW_MAX_RETRIES ?? 2);

/**
 * Schema (JSON Schema de tool) do FlowSpec. É o input_schema da tool forçada —
 * aceita campos opcionais livremente (ao contrário do subset de structured
 * outputs). A validação de conteúdo/limites fica no flowValidator.
 */
const FLOW_SPEC_SCHEMA = {
  type: 'object',
  required: ['name', 'start', 'steps'],
  properties: {
    name: { type: 'string', description: 'Nome do fluxo.' },
    start: { type: 'string', description: 'id do primeiro passo.' },
    steps: {
      type: 'array',
      description: 'Passos do fluxo.',
      items: {
        oneOf: [
          {
            type: 'object',
            required: ['id', 'name', 'type', 'message', 'next'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string', description: 'Rótulo interno do nó (não vai pro cliente).' },
              type: { const: 'ask', description: 'Pergunta aberta (texto livre).' },
              message: { type: 'string' },
              next: { type: 'string' },
            },
          },
          {
            type: 'object',
            required: ['id', 'name', 'type', 'message', 'options'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { const: 'menu' },
              message: { type: 'string' },
              render: { enum: ['auto', 'buttons', 'list'] },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['label'],
                  properties: {
                    label: { type: 'string' },
                    desc: { type: 'string' },
                    section: { type: 'string' },
                    next: { type: 'string' },
                    transferToQueue: { type: 'string', description: 'Nome do setor que recebe (id da fila resolvido depois).' },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            required: ['id', 'name', 'type', 'message'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { const: 'end' },
              message: { type: 'string' },
              transferToQueue: { type: 'string' },
            },
          },
        ],
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `Você converte um briefing de atendimento em um roteiro de chatbot de WhatsApp para uma PME brasileira.

Você SEMPRE responde chamando a ferramenta emit_flow_spec com o roteiro (FlowSpec). Nunca escreva o JSON final do chatbot — só o roteiro.

Regras de formato (limites do WhatsApp — obrigatórias):
- Menu com até 3 opções: use render "buttons". Texto de cada botão no máximo 20 caracteres.
- Menu com 4 a 10 opções: use render "list". Título de cada item ≤ 24, descrição ≤ 72.
- Mais de 10 opções: NÃO cabe. Quebre em submenus (um passo "menu" que leva a outros passos "menu").
- Corpo de qualquer mensagem ≤ 1024 caracteres.
- Em canal API OFICIAL, PREFIRA botões: quebre menus em submenus de ≤ 3 opções em vez de usar listas, sempre que fizer sentido.

Regras de conteúdo:
- Português do Brasil, mensagens curtas e cordiais, emojis com parcimônia.
- Comece com um passo de boas-vindas que apresenta as opções principais.
- Colete o mínimo necessário (ex.: identificação, o que a pessoa quer) antes de encerrar.
- Todo caminho termina em um passo "end" (encerramento) — ou numa transferência para setor.
- Use transferToQueue (com o NOME do setor) quando o briefing indicar que aquele assunto é atendido por uma pessoa/setor.
- Cada opção de menu tem "next" OU "transferToQueue", nunca os dois.
- ids em kebab-case, únicos, curtos (ex.: "boas-vindas", "cnpj", "produto").`;

const EMIT_TOOL = {
  name: 'emit_flow_spec',
  description: 'Emite o roteiro do chatbot (FlowSpec) a partir do briefing.',
  input_schema: FLOW_SPEC_SCHEMA,
};

/** Monta um resumo enxuto e rotulado do briefing (não manda o objeto cru). */
export function buildBriefingSummary(
  briefing: Record<string, unknown> | null,
  opts: { company?: string; apiOficial?: boolean },
): string {
  const b = briefing ?? {};
  const lines: string[] = [];
  const put = (label: string, v: unknown) => {
    if (v == null) return;
    const s = Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v);
    if (s.trim()) lines.push(`${label}: ${s.trim()}`);
  };
  put('Empresa', b.razaoSocial || b.nomeFantasia || opts.company);
  lines.push(`Canal: ${opts.apiOficial ? 'API Oficial (prefira botões)' : 'API comum'}`);
  put('Setores/filas', b.departments);
  put('Saudação desejada', b.greetingMessage);
  put('Mensagem fora do horário', b.offHoursMessage);

  // Bloco estruturado do fluxo (quando o briefing público já coleta — Bloco 3).
  const cf = b.chatbotFlow as
    | { description?: string; menus?: { question?: string; options?: string[]; parentOption?: string }[]; collectFields?: string[]; transfers?: { option?: string; department?: string }[]; closingMessage?: string }
    | undefined;
  if (cf) {
    put('Como o atendimento deve funcionar', cf.description);
    if (Array.isArray(cf.menus))
      cf.menus.forEach((m, i) =>
        put(
          i === 0 ? 'Menu principal' : `Submenu ${i}`,
          `${m.parentOption ? `aberto pela opção "${m.parentOption}" — ` : ''}${m.question ?? ''} — opções: ${(m.options ?? []).join(', ')}`,
        ),
      );
    put('Dados a coletar antes de transferir', cf.collectFields);
    if (Array.isArray(cf.transfers))
      cf.transfers.forEach((t) => put('Transferência', `"${t.option}" → setor ${t.department}`));
    put('Mensagem de encerramento', cf.closingMessage);
  }

  // Campos de IA já preenchidos (reaproveita contexto).
  put('O que a empresa faz', b.aiCompanyDescription);
  put('Serviços/produtos', b.aiServices);
  put('Fluxo de atendimento (IA)', b.aiAttendanceFlow);
  put('Quando transferir para humano', b.aiTransferConditions);
  put('Perguntas frequentes', b.aiFaq);

  return lines.join('\n');
}

interface AnthropicBlock {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
}

/** Gera somente a frase curta de boas-vindas usada no menu do briefing público. */
export async function generateWelcomeMessage(input: {
  company: string;
  description: string;
  sectors: string[];
}): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 120,
      system:
        'Crie uma mensagem curta de boas-vindas para um chatbot de WhatsApp. Responda somente com a mensagem, em português do Brasil, com no máximo 2 frases. Seja cordial e direto. Não liste setores, opções ou números, pois eles serão adicionados depois. Use no máximo um emoji.',
      messages: [
        {
          role: 'user',
          content: `Empresa: ${input.company}\nResumo informado pelo cliente: ${input.description}\nSetores disponíveis: ${input.sectors.join(', ')}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: AnthropicBlock[]; stop_reason?: string };
  if (data.stop_reason === 'refusal') throw new Error('A IA recusou o pedido.');
  const message = (data.content ?? []).find((block) => block.type === 'text')?.text?.trim();
  if (!message) throw new Error('A IA não retornou uma mensagem.');
  return message.replace(/^['“”]|['“”]$/g, '').slice(0, 400);
}

async function callClaude(messages: unknown[]): Promise<FlowSpec> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [EMIT_TOOL],
      tool_choice: { type: 'tool', name: 'emit_flow_spec' },
      messages,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = (await res.json()) as { content?: AnthropicBlock[]; stop_reason?: string };
  if (data.stop_reason === 'refusal') throw new Error('A IA recusou o pedido.');
  const toolUse = (data.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'emit_flow_spec');
  if (!toolUse || !toolUse.input) throw new Error('A IA não retornou o roteiro esperado.');
  return toolUse.input as FlowSpec;
}

export interface GenerateResult {
  spec: FlowSpec;
  errors: string[];
  warnings: string[];
  attempts: number;
}

/**
 * Gera o FlowSpec a partir do briefing, com loop de correção: valida o
 * resultado e, havendo erros, reenvia a lista pedindo correção até MAX_RETRIES.
 */
export async function generateFlowSpec(
  briefing: Record<string, unknown> | null,
  opts: { company?: string; apiOficial?: boolean } = {},
): Promise<GenerateResult> {
  const summary = buildBriefingSummary(briefing, opts);
  const messages: unknown[] = [
    {
      role: 'user',
      content: `A partir do briefing abaixo, gere o roteiro do chatbot chamando emit_flow_spec.\n\n${summary}`,
    },
  ];

  let last: FlowSpec | null = null;
  let validation = { errors: ['não gerado'], warnings: [] as string[] };
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const spec = await callClaude(messages);
    last = spec;
    validation = validateSpec(spec);
    if (validation.errors.length === 0) {
      return { spec, errors: [], warnings: validation.warnings, attempts: attempt };
    }
    if (attempt > MAX_RETRIES) break;
    // Reenvia a mesma conversa com os erros, pedindo correção.
    messages.push({
      role: 'assistant',
      content: [{ type: 'tool_use', id: `retry-${attempt}`, name: 'emit_flow_spec', input: spec }],
    });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: `retry-${attempt}`,
          is_error: true,
          content:
            'O roteiro tem erros. Corrija TODOS e chame emit_flow_spec de novo:\n- ' +
            validation.errors.join('\n- '),
        },
      ],
    });
  }
  return {
    spec: last as FlowSpec,
    errors: validation.errors,
    warnings: validation.warnings,
    attempts: MAX_RETRIES + 1,
  };
}
