import { randomUUID } from 'node:crypto';

// ── Config da Claude (só backend) ────────────────────────────────────────────────
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export interface N8nSector {
  /** Chave usada no marcador [[FILA:chave]] (kebab/slug, sem acento). */
  key: string;
  name: string;
  queueId: string | null;
}

export interface N8nBuildInput {
  company: string;
  agentName: string;
  systemPrompt: string;
  /** https://.../v2/api/external/<apiId> */
  apiBase: string;
  token: string;
  sectors: N8nSector[];
  pendingQueueId: string | null;
  webhookPath: string;
}

export function slugify(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Geração do prompt com IA ─────────────────────────────────────────────────────
const ALLOWED_PLACEHOLDERS = new Set([
  '$json.horaAgora',
  '$json.hojeExtenso',
  '$json.saudacaoHora',
  '$json.firstName',
]);

/** Mantém só os placeholders do n8n que existem no fluxo; o resto vira texto puro. */
export function sanitizePrompt(prompt: string): string {
  return prompt.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (m, expr: string) =>
    ALLOWED_PLACEHOLDERS.has(expr.trim()) ? `{{ ${expr.trim()} }}` : expr.trim(),
  );
}

const AGENT_TOOL = {
  name: 'emit_agent',
  description: 'Emite o agente de atendimento: nome da persona, prompt completo e pontos a confirmar.',
  input_schema: {
    type: 'object',
    required: ['agentName', 'systemPrompt', 'warnings'],
    properties: {
      agentName: { type: 'string', description: 'Primeiro nome da persona/atendente (ex.: Bia, Eva).' },
      systemPrompt: { type: 'string', description: 'Prompt de sistema COMPLETO do agente, em português do Brasil.' },
      warnings: {
        type: 'array',
        items: { type: 'string' },
        description: 'Informações importantes que NÃO estavam no briefing e o operador deve confirmar/preencher.',
      },
    },
  },
} as const;

const GENERATOR_SYSTEM = `Você é um engenheiro de prompts sênior que cria agentes de atendimento por WhatsApp (n8n + LLM) para PMEs brasileiras. A partir do briefing do cliente você escreve o PROMPT DE SISTEMA do agente — completo, específico do negócio e pronto para produção. Responda SEMPRE chamando a ferramenta emit_agent.

## Estrutura obrigatória do prompt (siga esta ordem e estes títulos, em markdown simples com "# ")
1. Abertura: quem é o agente (nome da persona, empresa, ramo, cidade) e os dados dinâmicos do contexto, usando EXATAMENTE estes placeholders (e nenhum outro): {{ $json.horaAgora }}, {{ $json.hojeExtenso }}, {{ $json.saudacaoHora }}, {{ $json.firstName }}. Ex.: "Agora são {{ $json.horaAgora }} de {{ $json.hojeExtenso }}. A saudação correta é *{{ $json.saudacaoHora }}*. Nome de quem fala com você: {{ $json.firstName }} (se vazio, não invente nome)."
2. # QUEM É VOCÊ — personalidade e tom coerentes com o negócio e com o que o briefing pedir (formal/casual, uso de emoji, exclamação etc.). Conversa de WhatsApp real, não script de central. Reage ao que a pessoa diz antes de seguir. Entende gírias e abreviações; nunca pede pra reformular só por escrita diferente.
3. # COMO CONDUZIR A CONVERSA — direta, poucas mensagens (no máximo 2 a 3 por resposta), separadas por uma linha contendo apenas =====; termina com UMA pergunta objetiva; pede contexto quando faltar; nunca resposta vazia tipo "Legal!"; nunca repete dado já informado.
4. # A EMPRESA — tudo que o briefing traz: o que faz, público, diferenciais, endereço, horários, redes sociais, formas de pagamento, promoções, políticas. Só o que estiver no briefing.
5. # SERVIÇOS / PRODUTOS — lista fiel ao briefing (com valores APENAS se o briefing autorizar falar de preço; senão a regra é nunca informar valores e encaminhar).
6. # REGRAS DE OURO (nunca quebre) — numeradas: nunca inventar; nunca prometer o que o briefing não garante; nunca confirmar agendamento/reserva/pagamento sem a equipe; nunca citar concorrentes; nunca dizer que é IA/robô (é a persona da equipe); nunca assinar mensagens (a assinatura entra automaticamente); nunca narrar sistema/ferramentas/filas; respeitar tudo que o briefing proibir. Inclua regras específicas do ramo (saúde: sem diagnóstico; financeiro: sem promessa; etc.).
7. # FLUXO DE ATENDIMENTO — passo a passo real do negócio, derivado do briefing: primeiro contato (o sistema já manda a saudação sozinho — o agente NÃO cumprimenta no primeiro turno e entra depois), entendimento da necessidade, dados a coletar (um por vez, na ordem certa), quando e como encerrar a coleta e passar para humano, texto EXATO dos blocos fixos importantes (ex.: mensagem de confirmação/encaminhamento).
8. # MÍDIAS RECEBIDAS — o sistema converte o que o cliente manda e avisa o agente entre colchetes: áudio já chega transcrito; imagem chega com descrição objetiva ("[A pessoa enviou uma IMAGEM. Descrição: ...]"); vídeo/documento chegam como aviso "[A pessoa enviou um VÍDEO/DOCUMENTO...]". Explique como reagir a cada um no contexto do negócio, sem inventar o que não foi descrito e sem falar de "sistema" ou "análise automática".
9. # QUANDO ENCAMINHAR PRA HUMANO — para transferir, o agente termina a ÚLTIMA mensagem com um marcador sozinho na última linha: [[FILA:chave]] usando SOMENTE as chaves fornecidas (lista abaixo, no user prompt), explicando quando usar cada uma. Regras: no máximo um marcador por resposta; oferecer não é encaminhar; na primeira resposta da conversa só encaminha se a pessoa pedir humano/reclamar direto; o cliente nunca vê o marcador; se o assunto não se encaixar em nenhuma fila, usar a chave "pendente".
10. # QUANDO NÃO SOUBER — texto padrão (informação não confirmada → registrar a dúvida e encaminhar com o marcador adequado).
11. # PERGUNTAS FREQUENTES — respostas curtas baseadas no briefing (inclua as que o cliente já listou e as mais prováveis do ramo que o briefing permita responder).
12. # ANTES DE ENVIAR, CONFIRA — checklist final (10 a 12 itens) alinhado às regras acima.

## Qualidade
- O prompt deve ser MUITO bom e específico: use nomes, produtos, horários, endereços, tom e regras reais do briefing. Melhore e organize o que o cliente escreveu (corrija português, remova redundância, complete lacunas óbvias de forma prudente) — sem inventar fatos.
- Se o briefing tiver um fluxo de atendimento/menus/campos a coletar/transferências, incorpore fielmente.
- Não use nenhum outro trecho com chaves duplas {{ }} além dos 4 placeholders. Não escreva JSON. Não use o marcador [[LOCALIZACAO]].
- Tamanho: completo mas enxuto (tipicamente 1.500 a 3.500 palavras).
- Em "warnings" liste o que faltou no briefing e o operador deve confirmar. ESCREVA PARA UMA PESSOA NÃO TÉCNICA: português simples e direto, uma frase curta cada, dizendo o que falta e o que o agente fará por causa disso. PROIBIDO citar nomes de campos, chaves, código ou termos técnicos (nada de "aiAttendanceFlow", "mainFlow", "prompt", "JSON", "campo"). Exemplos bons: "Não sei o horário de atendimento da loja — o agente não vai informar horários.", "Preços não informados — o agente vai encaminhar quem perguntar valor para o Comercial.", "Não há regras de troca e garantia — o agente vai passar essas dúvidas para o Suporte." Máximo de 6 avisos, só os que realmente importam.`;

interface AnthropicBlock {
  type: string;
  name?: string;
  input?: unknown;
}

export interface GeneratedAgent {
  agentName: string;
  systemPrompt: string;
  warnings: string[];
}

function trimBriefing(b: Record<string, unknown> | null): string {
  const clean = JSON.stringify(b ?? {}, (k, v) => {
    if (k === 'mainFlow') return undefined; // campo antigo, sempre vazio nos briefings novos
    if (typeof v === 'string' && v.length > 1500) return v.slice(0, 1500) + '…';
    return v;
  });
  return clean.length > 40000 ? clean.slice(0, 40000) + '…' : clean;
}

export async function generateAgentPrompt(input: {
  company: string;
  briefing: Record<string, unknown> | null;
  sectors: N8nSector[];
  extraNotes?: string;
}): Promise<GeneratedAgent> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');

  const sectorLines = input.sectors.length
    ? input.sectors.map((s) => `- [[FILA:${s.key}]] → setor "${s.name}"`).join('\n')
    : '- (nenhum setor cadastrado)';
  const userPrompt =
    `Empresa: ${input.company}\n\n` +
    `Filas/setores disponíveis para encaminhamento (use EXATAMENTE estas chaves nos marcadores):\n${sectorLines}\n` +
    `- [[FILA:pendente]] → fila de espera geral (assuntos sem setor definido ou quando ninguém mais se aplica)\n\n` +
    (input.extraNotes ? `Observações do operador:\n${input.extraNotes}\n\n` : '') +
    `BRIEFING COMPLETO DO CLIENTE (JSON):\n${trimBriefing(input.briefing)}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: GENERATOR_SYSTEM,
      tools: [AGENT_TOOL],
      tool_choice: { type: 'tool', name: 'emit_agent' },
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = (await res.json()) as { content?: AnthropicBlock[]; stop_reason?: string };
  if (data.stop_reason === 'refusal') throw new Error('A IA recusou o pedido.');
  const tool = (data.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'emit_agent');
  const out = tool?.input as Partial<GeneratedAgent> | undefined;
  if (!out?.systemPrompt) throw new Error('A IA não retornou o prompt esperado.');
  return {
    agentName: (out.agentName || 'Atendente').trim().split(/\s+/)[0],
    systemPrompt: sanitizePrompt(String(out.systemPrompt)),
    warnings: Array.isArray(out.warnings) ? out.warnings.map(String) : [],
  };
}

// ── Código dos nós Code do n8n (String.raw: sem crases nem interpolação) ───────────
const NORMALIZE_CODE = String.raw`const raw = $('Webhook NX').first().json;
const body = raw.body || raw;

// data/hora de Sao Paulo calculadas aqui (o modelo nunca deduz sozinho)
let agora;
try { agora = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'})); }
catch(e){ agora = new Date(); }
const DIAS = ['domingo','segunda-feira','terca-feira','quarta-feira','quinta-feira','sexta-feira','sabado'];
const dd = String(agora.getDate()).padStart(2,'0');
const mm = String(agora.getMonth()+1).padStart(2,'0');
const hojeExtenso = DIAS[agora.getDay()]+', '+dd+'/'+mm+'/'+agora.getFullYear();
const h24 = agora.getHours();
const horaAgora = String(h24).padStart(2,'0')+':'+String(agora.getMinutes()).padStart(2,'0');
const saudacaoHora = h24 < 12 ? 'bom dia' : (h24 < 18 ? 'boa tarde' : 'boa noite');

const content = body.content || {};
const contact = body.contact || {};
const ticket  = body.ticket  || {};
const msg     = body.msg     || {};

const isMsg = body.type==='message_n8n' || body.method==='message' || !!body.content || !!body.msg;
if(!isMsg) return [{json:{rota:'IGNORAR'}}];

let phone = contact.number || (ticket.contact&&ticket.contact.number) || msg.chatid || msg.from || (msg.key&&msg.key.sender_pn) || msg.remoteJid || '';
phone = String(phone).replace('@s.whatsapp.net','').replace('@c.us','').replace('@lid','');

// mensagem enviada pela propria empresa / eco do bot
const fromMe = ticket.fromMe===true || content.fromMe===true || msg.fromMe===true || (msg.key&&msg.key.fromMe===true);
if(fromMe) return [{json:{rota:'IGNORAR'}}];
// ja tem atendente humano no ticket -> a IA nao atropela
if(ticket.userId && String(ticket.userId).trim()!=='') return [{json:{rota:'IGNORAR'}}];

const nomeRaw = contact.name || (ticket.contact&&ticket.contact.name) || msg.pushName || 'Cliente';
const primeiro = (nomeRaw&&nomeRaw!=='Cliente'&&/[a-zA-Z]/.test(nomeRaw)) ? nomeRaw.split(' ')[0] : '';
const ticketId  = ticket.id || msg.ticketId || null;
const contactId = contact.id || ticket.contactId || null;
const messageId = content.messageId || (msg.key&&msg.key.id) || String(Date.now());

let texto = content.text
  || (msg.content&&msg.content.text)
  || (typeof msg.text==='string'?msg.text:(msg.text&&(msg.text.text||msg.text.body)))
  || (msg.message&&msg.message.extendedTextMessage&&msg.message.extendedTextMessage.text)
  || (msg.message&&msg.message.conversation)
  || (typeof msg.body==='string'?msg.body:'')
  || '';
texto = String(texto).trim();

const tipo = String(content.type||content.mediaType||msg.type||msg.mediaType||msg.messageType||'').toLowerCase();
const ehAudio  = tipo.includes('audio') || tipo.includes('ptt') || tipo.includes('voice');
const ehImagem = tipo.includes('image') || tipo.includes('sticker') || tipo.includes('photo');
const ehVideo  = tipo.includes('video');
const ehDoc    = tipo.includes('document') || tipo.includes('file');

// midia: base64 (content.media) ou URL
const mediaB64 = (typeof content.media === 'string' && content.media.length > 200 && !/^https?:/i.test(content.media)) ? content.media.replace(/^data:[^,]+,/, '') : '';
function acharMidiaUrl(){
  const cand = content.mediaUrl || content.url || content.fileUrl
    || (msg.content&&(msg.content.mediaUrl||msg.content.url||msg.content.fileUrl))
    || msg.mediaUrl || msg.url || msg.fileUrl
    || (typeof content.media === 'string' && /^https?:/i.test(content.media) ? content.media : '');
  if(cand && /^https?:/i.test(String(cand))) return String(cand);
  const str = JSON.stringify(body||{});
  const m = str.match(/https?:\/\/[^"\\ ]+\.(?:ogg|oga|opus|mp3|m4a|amr|wav|aac|jpe?g|png|webp)[^"\\ ]*/i)
    || str.match(/"(?:mediaUrl|fileUrl|url)"\s*:\s*"(https?:[^"]+)"/i);
  return m ? (m[1]||m[0]) : '';
}
const mimeType = String(content.mimetype || content.mimeType || (msg.content&&msg.content.mimetype) || '');

const comum = { phone, contactName:nomeRaw, firstName:primeiro, messageId, ticketId, contactId, hojeExtenso, horaAgora, saudacaoHora };
if(!phone) return [{json:{rota:'IGNORAR'}}];

if(ehAudio){
  const mediaUrl = acharMidiaUrl();
  if(mediaB64 || mediaUrl) return [{json:{ rota:'AUDIO', mediaUrl, audioBase64:mediaB64, ...comum, userMessage:'' }}];
  return [{json:{ rota:'PROCESSAR', ...comum, userMessage:'[A pessoa mandou um audio, mas nao foi possivel ouvir. Peca com carinho pra ela mandar por escrito, sem falar em sistema nem em falha tecnica.]' }}];
}
if(ehImagem){
  const mediaUrl = acharMidiaUrl();
  if(mediaB64 || mediaUrl) return [{json:{ rota:'IMAGEM', mediaUrl, imageBase64:mediaB64, mimeType:(mimeType||'image/jpeg'), legenda:texto, ...comum, userMessage:'' }}];
  const extra = texto ? ('\nA pessoa escreveu junto: ' + texto) : '';
  return [{json:{ rota:'PROCESSAR', ...comum, userMessage:'[A pessoa enviou uma IMAGEM que voce nao consegue ver. Agradeca o envio, NAO descreva nem invente detalhes da imagem e siga o fluxo perguntando o que faltar.]' + extra }}];
}
if(ehVideo){
  const extra = texto ? ('\nA pessoa escreveu junto: ' + texto) : '';
  return [{json:{ rota:'PROCESSAR', ...comum, userMessage:'[A pessoa enviou um VIDEO que voce nao consegue assistir. Agradeca, NAO suponha o conteudo e pergunte brevemente do que se trata ou peca a informacao por texto.]' + extra }}];
}
if(ehDoc){
  const extra = texto ? ('\nA pessoa escreveu junto: ' + texto) : '';
  return [{json:{ rota:'PROCESSAR', ...comum, userMessage:'[A pessoa enviou um ARQUIVO/DOCUMENTO que voce nao consegue abrir. Confirme o recebimento, NAO suponha o conteudo e pergunte brevemente do que se trata. Se precisar de uma pessoa, encaminhe com o marcador de fila adequado.]' + extra }}];
}
if(!texto) return [{json:{rota:'IGNORAR'}}];
return [{json:{ rota:'PROCESSAR', ...comum, userMessage:texto }}];
`;

const PREPARE_AUDIO_CODE = String.raw`const item = $input.first().json;
let buffer;
if (item.audioBase64) {
  buffer = Buffer.from(item.audioBase64, 'base64');
} else {
  const res = await this.helpers.httpRequest({ method: 'GET', url: item.mediaUrl, encoding: 'arraybuffer', timeout: 20000 });
  buffer = Buffer.from(res);
}
const bin = await this.helpers.prepareBinaryData(buffer, 'audio.ogg', 'audio/ogg');
return [{ json: item, binary: { data: bin } }];`;

const AUDIO_TEXT_CODE = String.raw`const src = $('Extrair Payload').first().json;
let t = ($json.text || '');
t = String(t).trim();
if (t.length < 2) t = '[A pessoa mandou um audio que nao deu pra entender. Peca com carinho pra ela repetir por escrito, sem falar em sistema nem em falha tecnica.]';
return [{ json: { ...src, rota: 'PROCESSAR', userMessage: t } }];`;

const IMAGE_TEXT_CODE = String.raw`const src = $('Extrair Payload').first().json;
let d = '';
try {
  const r = $input.first().json;
  d = (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '';
} catch (e) {}
d = String(d).trim();
const extra = src.legenda ? ('\nA pessoa escreveu junto: ' + src.legenda) : '';
let msg;
if (d) {
  msg = '[A pessoa enviou uma IMAGEM. Descricao objetiva do que aparece: ' + d + ' -- Use isso para conduzir o atendimento, mas NAO invente nada alem da descricao e nunca diga que a imagem foi analisada por um sistema.]' + extra;
} else {
  msg = '[A pessoa enviou uma IMAGEM que voce nao consegue ver. Agradeca o envio, NAO descreva nem invente detalhes e siga o fluxo perguntando o que faltar.]' + extra;
}
return [{ json: { ...src, rota: 'PROCESSAR', userMessage: msg } }];`;

const MARK_LAST_CODE = String.raw`// debounce: junta mensagens em rajada e guarda a ultima
const s = $getWorkflowStaticData('global'); s.buf = s.buf || {};
const j = $json; const p = j.phone;
if (!s.buf[p]) s.buf[p] = { texts: [], last: null };
s.buf[p].texts.push(j.userMessage);
s.buf[p].last = j.messageId;
return [{ json: j }];`;

const IS_LAST_CODE = String.raw`const s = $getWorkflowStaticData('global'); const j = $json; const p = j.phone;
const e = (s.buf || {})[p];
if (!e || e.last !== j.messageId) return [{ json: { ...j, souUltima: false } }];
const merged = (e.texts && e.texts.length ? e.texts : [j.userMessage]).join('\n');
e.texts = [];
return [{ json: { ...j, userMessage: merged, souUltima: true } }];`;

const FIRST_MSG_CODE = String.raw`// Primeira mensagem DESTE atendimento (ticket). Guarda em staticData (sem tabela externa).
const j = $input.first().json;
const s = $getWorkflowStaticData('global'); s.seen = s.seen || {};
const key = String(j.ticketId || j.phone);
const primeiraMensagem = !s.seen[key];
s.seen[key] = Date.now();
const keys = Object.keys(s.seen);
if (keys.length > 5000) {
  keys.sort((a, b) => s.seen[a] - s.seen[b]).slice(0, keys.length - 4000).forEach((k) => delete s.seen[k]);
}
return [{ json: { ...j, primeiraMensagem } }];`;

const SPLIT_BODY = String.raw`let out = $input.first().json.output || '';
out = String(out).replace(/\r\n/g,'\n').replace(/\\n/g,'\n');
const src = $('Calcular Primeira Mensagem').first().json;
const phone = src.phone;
const ticketId = src.ticketId;
const firstName = src.firstName || '';
const primeiraMensagem = !!src.primeiraMensagem;
const txtCliente = String(src.userMessage || '').toLowerCase();
const erroTecnico = !!($input.first().json.error);

const MAX_MENSAGENS = CFG.maxMensagens;
const LIMITE_CHARS = CFG.limiteChars;
const PEDE_HUMANO_AGORA = /(atendente|representante|falar com (uma |um )?(pessoa|humano|algu[eé]m|respons[aá]vel|atendente)|humano|urgente|urg[eê]ncia|reclama[cç]|cancelar)/;
const podeEncaminharAgora = PEDE_HUMANO_AGORA.test(txtCliente);

// marcador [[FILA:chave]] -> queueId
let transferQueueId = 0;
let filaNome = '';
const m = out.match(/\[+\s*FILA\s*:\s*([a-z0-9_-]+)\s*\]+/i);
if (m) {
  const k = m[1].toLowerCase();
  if (CFG.filas[k]) { transferQueueId = Number(CFG.filas[k]) || 0; filaNome = k; }
}
// trava do primeiro contato: so encaminha se a pessoa pediu humano
if (primeiraMensagem && !podeEncaminharAgora) { transferQueueId = 0; filaNome = ''; }

// limpa marcadores (o cliente nunca ve)
out = out.replace(/\[+\s*FILA\s*:[^\]]*\]+/gi, '');
out = out.replace(/\[\[[^\]]*\]\]/g, '');
out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

function limpaTexto(t){
  return String(t)
    .replace(/\*{2,}/g,'*')
    .replace(/__([^_]+)__/g,'*$1*')
    .replace(/^\s*#{1,6}\s*/gm,'')
    .replace(/[ \t]{2,}/g,' ')
    .replace(/[ \t]+([,.;:?!])/g,'$1')
    .replace(/[ \t]+\n/g,'\n')
    .trim();
}
let partesIA = out.split(/\n?\s*={3,}\s*\n?/).map(limpaTexto).filter((p) => p.length > 0);

function quebraFrases(t){
  const frases = String(t).split(/(?<=[.?!…])\s+/).map((x) => x.trim()).filter(Boolean);
  if (frases.length <= 1) return [String(t).trim()];
  const saida = [];
  let atual = '';
  for (const f of frases) {
    if (!atual) { atual = f; continue; }
    if ((atual + ' ' + f).length <= LIMITE_CHARS) atual = atual + ' ' + f;
    else { saida.push(atual); atual = f; }
  }
  if (atual) saida.push(atual);
  return saida;
}
function quebraLonga(t){
  const s = String(t).trim();
  if (s.length <= LIMITE_CHARS) return [s];
  const paras = s.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  if (paras.length > 1) return paras.reduce((a, p) => a.concat(quebraLonga(p)), []);
  if (s.split(/\n/).filter((x) => x.trim()).length > 1) return [s]; // listas/blocos ficam inteiros
  return quebraFrases(s);
}
partesIA = partesIA.reduce((acc, p) => acc.concat(quebraLonga(p)), []);

const capitaliza = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const nomeSuf = firstName ? (', ' + firstName) : '';
const sh = src.saudacaoHora || 'ola';
let partes;

if (erroTecnico && partesIA.length === 0) {
  partes = ['So um instante' + nomeSuf + ', ja te retorno por aqui.'];
  if (CFG.pendente) transferQueueId = Number(CFG.pendente) || 0;
} else if (primeiraMensagem) {
  const tiraSaudacao = (p) => {
    let s = String(p);
    let antes;
    do {
      antes = s;
      s = s.replace(/^\s*(ol[aá]|oi+e*|bom dia|boa tarde|boa noite|prazer)(?![\p{L}])[\s,!.\-–—]*/iu, '');
      s = s.replace(/^\s*(tudo bem|tudo bom|como vai|tudo certo)(?![\p{L}])[^?\n]*\??\s*/iu, '');
      s = s.replace(/^\s*(eu\s+)?sou (a|o)\s*\*?\s*[^.!?\n]{0,40}[.!?]\s*/i, '');
    } while (s !== antes);
    return s.trim();
  };
  const temConteudo = (p) => p.replace(/[^\p{L}\p{N}]/gu, '').length > 0;
  const resto = partesIA.map(tiraSaudacao).filter(temConteudo);
  const abertura = capitaliza(sh) + nomeSuf + '! Aqui é ' + CFG.agente + ', da ' + CFG.empresa + '.';
  partes = [abertura].concat(resto.length ? resto : ['Como posso te ajudar hoje?']);
} else if (partesIA.length === 0) {
  partes = [firstName ? (firstName + ', me explica de outro jeito?') : 'Me explica de outro jeito?'];
} else {
  partes = partesIA;
}

if (partes.length > MAX_MENSAGENS) {
  partes = partes.slice(0, MAX_MENSAGENS - 1).concat(partes[partes.length - 1]);
}
partes = partes.filter((p) => p.replace(/[^\p{L}\p{N}]/gu, '').length > 0);

function assina(t){
  if (!CFG.assinar) return String(t).trim();
  let s = String(t).trim();
  const re = new RegExp('^\\*?\\s*' + CFG.agente.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '\\s*:?\\s*\\*?\\s*\\n?', 'i');
  s = s.replace(re, '').trim();
  return '*' + CFG.agente + ':*\n' + s;
}
const finais = partes.map(assina);
const base = { phone, ticketId, transferQueueId, filaNome };
return finais.map((p, i) => ({ json: { ...base, msg: p, ordem: i, ehSaudacao: primeiraMensagem && i === 0 } }));`;

const DELAY_EXPR =
  "={{ $('Loop Mensagens').item.json.ehSaudacao ? 3 : (Math.min(9, Math.max(2, Math.ceil((($('Loop Mensagens').item.json.msg)||'').length / 15))) + Math.round(Math.random() * 2)) }}";

// ── Montagem do workflow n8n ──────────────────────────────────────────────────────
interface N8nNode {
  parameters: Record<string, unknown>;
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  webhookId?: string;
  credentials?: Record<string, unknown>;
  onError?: string;
  alwaysOutputData?: boolean;
}

type Conn = { node: string; type: string; index: number };

export function buildN8nWorkflow(input: N8nBuildInput): { json: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const id = () => randomUUID();
  const nodes: N8nNode[] = [];
  const connections: Record<string, Record<string, Conn[][]>> = {};

  const add = (
    name: string,
    type: string,
    typeVersion: number,
    position: [number, number],
    parameters: Record<string, unknown>,
    extra: Partial<N8nNode> = {},
  ) => {
    nodes.push({ parameters, id: id(), name, type, typeVersion, position, ...extra });
  };
  /** connect(from, [[to0...], [to1...]]) — uma lista de destinos por saída. */
  const connect = (from: string, outs: string[][], kind = 'main') => {
    connections[from] = {
      [kind]: outs.map((targets) => targets.map((node) => ({ node, type: kind, index: 0 }))),
    };
  };
  const ifBool = (name: string, pos: [number, number], expr: string) =>
    add(name, 'n8n-nodes-base.if', 2, pos, {
      conditions: {
        combinator: 'and',
        conditions: [
          {
            id: id(),
            leftValue: expr,
            operator: { type: 'boolean', operation: 'true', singleValue: true },
            rightValue: true,
          },
        ],
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      },
      options: {},
    });

  // Filas: chave -> queueId (só as resolvidas).
  const filas: Record<string, string> = {};
  for (const s of input.sectors) {
    if (s.queueId) filas[s.key] = s.queueId;
    else warnings.push(`A fila "${s.name}" não foi encontrada no NX — sem ela a IA não consegue passar o atendimento para esse setor. Crie a fila no NX e clique em "Gerar novamente".`);
  }
  if (input.pendingQueueId) filas.pendente = input.pendingQueueId;
  else warnings.push('A fila "Pendente" não foi encontrada no NX — sem ela, quando a IA não souber para onde mandar (ou der algum erro), o atendimento não será movido. Crie a fila "Pendente" no NX e clique em "Gerar novamente".');

  const cfg = {
    agente: input.agentName,
    empresa: input.company,
    filas,
    pendente: input.pendingQueueId ?? '',
    maxMensagens: 3,
    limiteChars: 200,
    assinar: true,
  };

  const VISION_SYSTEM =
    'Voce descreve fotos enviadas por clientes em um atendimento por WhatsApp. Descreva de forma objetiva e curta (ate 4 frases) o que aparece: pessoas/objetos, texto visivel, documentos, produtos, cores. Se for documento, comprovante ou print, transcreva os dados principais legiveis. Nao opine nem infira alem do que se ve.';

  // Linha 1 (y=512): entrada
  add('Webhook NX', 'n8n-nodes-base.webhook', 2, [-2800, 512], {
    httpMethod: 'POST',
    path: input.webhookPath,
    responseMode: 'responseNode',
    options: {},
  }, { webhookId: id() });
  add('Responde 200 OK', 'n8n-nodes-base.respondToWebhook', 1.5, [-2592, 512], {
    respondWith: 'text',
    responseBody: 'OK',
    options: {},
  });
  add('Config', 'n8n-nodes-base.set', 3.4, [-2384, 512], {
    assignments: {
      assignments: [
        { id: id(), name: 'baseUrl', type: 'string', value: input.apiBase },
        { id: id(), name: 'token', type: 'string', value: input.token },
        { id: id(), name: 'empresa', type: 'string', value: input.company },
      ],
    },
    options: {},
  });
  add('Extrair Payload', 'n8n-nodes-base.code', 2, [-2176, 512], { jsCode: NORMALIZE_CODE });
  add('Deve processar?', 'n8n-nodes-base.if', 2, [-1968, 512], {
    conditions: {
      combinator: 'and',
      conditions: [
        {
          id: id(),
          leftValue: '={{ $json.rota }}',
          operator: { type: 'string', operation: 'notEquals' },
          rightValue: 'IGNORAR',
        },
      ],
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    },
    options: {},
  });
  ifBool('Eh audio?', [-1760, 512], "={{ $json.rota === 'AUDIO' }}");
  // Áudio
  add('Preparar Audio', 'n8n-nodes-base.code', 2, [-1552, 336], { jsCode: PREPARE_AUDIO_CODE });
  add('Transcrever (Whisper)', 'n8n-nodes-base.httpRequest', 4.4, [-1344, 336], {
    method: 'POST',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'openAiApi',
    sendBody: true,
    contentType: 'multipart-form-data',
    bodyParameters: {
      parameters: [
        { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' },
        { name: 'model', value: 'whisper-1' },
        { name: 'language', value: 'pt' },
      ],
    },
    options: { response: { response: { neverError: true } } },
  }, { onError: 'continueRegularOutput' });
  add('Texto do Audio', 'n8n-nodes-base.code', 2, [-1136, 336], { jsCode: AUDIO_TEXT_CODE });
  // Imagem
  ifBool('Eh imagem?', [-1552, 640], "={{ $json.rota === 'IMAGEM' }}");
  add('Descrever Imagem (Vision)', 'n8n-nodes-base.httpRequest', 4.4, [-1344, 560], {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'openAiApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      '={{ JSON.stringify({ model: "gpt-4o", max_tokens: 350, messages: [ { role: "system", content: ' +
      JSON.stringify(VISION_SYSTEM) +
      ' }, { role: "user", content: [ { type: "text", text: "Descreva esta imagem." }, { type: "image_url", image_url: { url: ($json.imageBase64 ? ("data:" + ($json.mimeType || "image/jpeg") + ";base64," + $json.imageBase64) : $json.mediaUrl) } } ] } ] }) }}',
    options: { response: { response: { neverError: true } } },
  }, { onError: 'continueRegularOutput' });
  add('Texto da Imagem', 'n8n-nodes-base.code', 2, [-1136, 560], { jsCode: IMAGE_TEXT_CODE });
  // Debounce
  add('Marcar Ultima', 'n8n-nodes-base.code', 2, [-928, 512], { jsCode: MARK_LAST_CODE });
  add('Aguardar 6s (debounce)', 'n8n-nodes-base.wait', 1.1, [-720, 512], { amount: 6 }, { webhookId: id() });
  add('Sou a ultima?', 'n8n-nodes-base.code', 2, [-512, 512], { jsCode: IS_LAST_CODE });
  ifBool('Eh a ultima?', [-304, 512], '={{ $json.souUltima }}');
  add('Calcular Primeira Mensagem', 'n8n-nodes-base.code', 2, [-96, 512], { jsCode: FIRST_MSG_CODE });
  // Agente
  add('Agente', '@n8n/n8n-nodes-langchain.agent', 3.1, [128, 512], {
    promptType: 'define',
    text: '={{ $json.userMessage }}',
    options: { systemMessage: '=' + input.systemPrompt },
  }, { onError: 'continueErrorOutput' });
  add('Modelo OpenAI', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.3, [96, 736], {
    model: { __rl: true, value: 'gpt-4.1', mode: 'id' },
    builtInTools: {},
    options: { frequencyPenalty: 0.3, maxTokens: 800, presencePenalty: 0.3, temperature: 0.55 },
  });
  add('Memoria Conversa', '@n8n/n8n-nodes-langchain.memoryBufferWindow', 1.3, [288, 736], {
    sessionIdType: 'customKey',
    sessionKey: '={{ $json.phone }}-{{ $json.ticketId }}',
    contextWindowLength: 20,
  });
  // Envio
  add('Split Mensagens', 'n8n-nodes-base.code', 2, [432, 512], {
    jsCode: 'const CFG = ' + JSON.stringify(cfg, null, 2) + ';\n' + SPLIT_BODY,
  });
  add('Loop Mensagens', 'n8n-nodes-base.splitInBatches', 3, [640, 512], { options: { reset: false } });
  add('Tem transferencia?', 'n8n-nodes-base.if', 2, [848, 336], {
    conditions: {
      combinator: 'and',
      conditions: [
        {
          id: id(),
          leftValue: "={{ $('Split Mensagens').first().json.transferQueueId }}",
          operator: { type: 'number', operation: 'gt' },
          rightValue: 0,
        },
        {
          id: id(),
          leftValue: "={{ $('Split Mensagens').first().json.ticketId }}",
          operator: { type: 'string', operation: 'notEmpty', singleValue: true },
          rightValue: '',
        },
      ],
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    },
    options: {},
  });
  add('Transferir Fila (updatequeue)', 'n8n-nodes-base.httpRequest', 4.2, [1056, 336], {
    method: 'POST',
    url: "={{ $('Config').first().json.baseUrl }}/updatequeue",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Authorization', value: "=Bearer {{ $('Config').first().json.token }}" }] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      "={{ { \"ticketId\": $('Split Mensagens').first().json.ticketId, \"queueId\": $('Split Mensagens').first().json.transferQueueId } }}",
    options: { response: { response: { neverError: true } }, timeout: 20000 },
  });
  add('Enviar Mensagem', 'n8n-nodes-base.httpRequest', 4.2, [848, 656], {
    method: 'POST',
    url: "={{ $('Config').first().json.baseUrl }}",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Authorization', value: "=Bearer {{ $('Config').first().json.token }}" }] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      '={{ { "body": $json.msg, "number": $json.phone, "externalKey": "ia-" + $json.phone + "-" + $now.toMillis(), "isClosed": false } }}',
    options: { response: { response: { neverError: true } }, timeout: 20000 },
  });
  add('Aguardar (delay humanizado)', 'n8n-nodes-base.wait', 1.1, [1056, 656], { amount: DELAY_EXPR }, { webhookId: id() });

  // Notas
  add('Sticky - Fluxo', 'n8n-nodes-base.stickyNote', 1, [-2832, 48], {
    content:
      `## ${input.company} — Agente ${input.agentName}\n` +
      'Webhook NX recebe a mensagem -> 200 OK -> normaliza (texto, audio, imagem, video, documento) -> debounce 6s -> detecta 1a mensagem -> Agente (OpenAI) -> quebra em mensagens (`=====`) -> envia uma a uma com delay humanizado.\n\n' +
      '**Transferencia:** a IA escreve `[[FILA:chave]]`; o `Split Mensagens` converte em queueId e chama `updatequeue`.',
    height: 300,
    width: 520,
    color: 4,
  });
  add('Sticky - Configuracao', 'n8n-nodes-base.stickyNote', 1, [-2272, 48], {
    content:
      '## Configuracao\n' +
      `Webhook: caminho \`${input.webhookPath}\` — aponte o webhook do canal no NX para a URL de producao deste no.\n` +
      'Canal: `baseUrl` e `token` ja preenchidos no no **Config**.\n\n' +
      '**Credencial OpenAI:** selecione a sua nos nos *Modelo OpenAI*, *Transcrever (Whisper)* e *Descrever Imagem (Vision)*.\n\n' +
      'Filas (chave -> queueId) ficam em `CFG.filas` no no **Split Mensagens**. Mantenha o modelo `gpt-4.1` (a familia GPT-5 nao aceita temperature/penalties).',
    height: 320,
    width: 460,
    color: 3,
  });

  // Conexões
  connect('Webhook NX', [['Responde 200 OK']]);
  connect('Responde 200 OK', [['Config']]);
  connect('Config', [['Extrair Payload']]);
  connect('Extrair Payload', [['Deve processar?']]);
  connect('Deve processar?', [['Eh audio?']]); // saída "false" (IGNORAR) termina
  connect('Eh audio?', [['Preparar Audio'], ['Eh imagem?']]);
  connect('Preparar Audio', [['Transcrever (Whisper)']]);
  connect('Transcrever (Whisper)', [['Texto do Audio']]);
  connect('Texto do Audio', [['Marcar Ultima']]);
  connect('Eh imagem?', [['Descrever Imagem (Vision)'], ['Marcar Ultima']]);
  connect('Descrever Imagem (Vision)', [['Texto da Imagem']]);
  connect('Texto da Imagem', [['Marcar Ultima']]);
  connect('Marcar Ultima', [['Aguardar 6s (debounce)']]);
  connect('Aguardar 6s (debounce)', [['Sou a ultima?']]);
  connect('Sou a ultima?', [['Eh a ultima?']]);
  connect('Eh a ultima?', [['Calcular Primeira Mensagem']]);
  connect('Calcular Primeira Mensagem', [['Agente']]);
  connect('Agente', [['Split Mensagens'], ['Split Mensagens']]);
  connect('Split Mensagens', [['Loop Mensagens']]);
  connect('Loop Mensagens', [['Tem transferencia?'], ['Enviar Mensagem']]);
  connect('Tem transferencia?', [['Transferir Fila (updatequeue)']]);
  connect('Enviar Mensagem', [['Aguardar (delay humanizado)']]);
  connect('Aguardar (delay humanizado)', [['Loop Mensagens']]);
  connect('Modelo OpenAI', [['Agente']], 'ai_languageModel');
  connect('Memoria Conversa', [['Agente']], 'ai_memory');

  const json = {
    name: `${input.company} - Agente ${input.agentName}`,
    nodes,
    pinData: {},
    connections,
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false },
    versionId: randomUUID(),
    meta: { builderVariant: 'tenanthub' },
    tags: [],
  };
  return { json, warnings };
}
