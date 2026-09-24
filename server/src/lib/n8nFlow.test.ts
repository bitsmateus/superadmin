import test from 'node:test';
import assert from 'node:assert/strict';
import { buildN8nWorkflow, sanitizePrompt, slugify } from './n8nFlow.js';

const input = {
  company: 'Clínica Teste',
  agentName: 'Bia',
  systemPrompt: 'Agora são {{ $json.horaAgora }}. {{ algo.errado }} fim',
  apiBase: 'https://appapi.exemplo.com/v2/api/external/abc',
  token: 'tok123',
  sectors: [
    { key: 'comercial', name: 'Comercial', queueId: '10' },
    { key: 'suporte', name: 'Suporte', queueId: null },
  ],
  pendingQueueId: '99',
  webhookPath: 'clinica-teste-ia',
};

test('sanitizePrompt mantém só placeholders conhecidos', () => {
  const s = sanitizePrompt(input.systemPrompt);
  assert.match(s, /\{\{ \$json\.horaAgora \}\}/);
  assert.ok(!s.includes('{{ algo.errado }}'));
});

test('slugify remove acento e símbolos', () => {
  assert.equal(slugify('Clínica & Estética Ltda'), 'clinica-estetica-ltda');
});

test('workflow: nós Code compilam, conexões apontam para nós existentes', () => {
  const { json, warnings } = buildN8nWorkflow({ ...input, systemPrompt: sanitizePrompt(input.systemPrompt) });
  const nodes = json.nodes as Array<{ name: string; type: string; parameters: { jsCode?: string } }>;
  const names = new Set(nodes.map((n) => n.name));
  assert.equal(names.size, nodes.length, 'nomes de nós únicos');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const n of nodes) {
    if (n.type === 'n8n-nodes-base.code') {
      assert.doesNotThrow(() => new AsyncFunction('$', '$json', '$input', '$getWorkflowStaticData', 'Buffer', n.parameters.jsCode!), n.name);
    }
  }
  const conns = json.connections as Record<string, Record<string, Array<Array<{ node: string }>>>>;
  for (const [from, kinds] of Object.entries(conns)) {
    assert.ok(names.has(from), 'origem ' + from);
    for (const outs of Object.values(kinds)) for (const list of outs) for (const c of list) assert.ok(names.has(c.node), 'destino ' + c.node);
  }
  assert.ok(warnings.some((w) => w.includes('Suporte')), 'avisa fila sem id');
  const cfg = nodes.find((n) => n.name === 'Config')!;
  assert.ok(JSON.stringify(cfg.parameters).includes('tok123'));
});

test('Split Mensagens: marcador vira queueId e primeira mensagem ganha abertura', async () => {
  const { json } = buildN8nWorkflow(input);
  const split = (json.nodes as Array<{ name: string; parameters: { jsCode: string } }>).find((n) => n.name === 'Split Mensagens')!;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = (output: string, primeira: boolean, userMessage: string) => {
    const src = { phone: '5511', ticketId: 7, firstName: 'Ana', primeiraMensagem: primeira, userMessage, saudacaoHora: 'bom dia' };
    const fn = new AsyncFunction(
      '$',
      '$input',
      split.parameters.jsCode,
    );
    return fn(() => ({ first: () => ({ json: src }) }), { first: () => ({ json: { output } }) }) as Promise<Array<{ json: Record<string, unknown> }>>;
  };
  const a = await run('Vou te passar pra equipe\n[[FILA:comercial]]', false, 'quero comprar');
  assert.equal(a[0].json.transferQueueId, 10);
  assert.ok(String(a[0].json.msg).startsWith('*Bia:*'));
  assert.ok(!String(a[0].json.msg).includes('[['));
  const b = await run('Oi! Como posso ajudar?', true, 'oi');
  assert.match(String(b[0].json.msg), /Bom dia, Ana! Aqui é Bia, da Clínica Teste/);
  const c = await run('Já te encaminho\n[[FILA:comercial]]', true, 'oi');
  assert.equal(c[0].json.transferQueueId, 0, 'primeiro contato não transfere');
});

test('Extrair Payload: texto, audio (base64), imagem (url) e eco do bot', async () => {
  const { json } = buildN8nWorkflow(input);
  const node = (json.nodes as Array<{ name: string; parameters: { jsCode: string } }>).find((n) => n.name === 'Extrair Payload')!;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = async (body: unknown) => {
    const fn = new AsyncFunction('$', node.parameters.jsCode);
    const r = (await fn(() => ({ first: () => ({ json: { body } }) }))) as Array<{ json: Record<string, unknown> }>;
    return r[0].json;
  };
  const base = { type: 'message_n8n', contact: { number: '5511999', name: 'Ana Souza', id: 1 }, ticket: { id: 5 } };
  const t = await run({ ...base, content: { text: 'oi', type: 'chat', messageId: 'm1' } });
  assert.equal(t.rota, 'PROCESSAR');
  assert.equal(t.firstName, 'Ana');
  const a = await run({ ...base, content: { type: 'audio', media: 'A'.repeat(400), messageId: 'm2' } });
  assert.equal(a.rota, 'AUDIO');
  const i = await run({ ...base, content: { type: 'image', mediaUrl: 'https://x.com/a.jpg', text: 'olha', messageId: 'm3' } });
  assert.equal(i.rota, 'IMAGEM');
  assert.equal(i.legenda, 'olha');
  const e = await run({ ...base, ticket: { id: 5, fromMe: true }, content: { text: 'x' } });
  assert.equal(e.rota, 'IGNORAR');
});
