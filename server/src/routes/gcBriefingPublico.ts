import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

/**
 * Briefing do cliente NX DIGITAL preenchido PELO CLIENTE, num link público (sem login).
 *
 * O token mora em gc_briefing.link_token (gerado/revogado pela equipe na aba Briefing). Quem tem o link
 * lê e grava só o briefing daquele cliente — nada além disso:
 *  - as SENHAS nunca voltam pro navegador: a leitura devolve só "tem senha salva"; campo de senha em branco
 *    no envio significa "manter a que já está";
 *  - "Outras informações" e as perguntas que a equipe acrescentou são preservadas: o cliente só altera as
 *    respostas das perguntas que recebeu e o link de materiais;
 *  - arquivos: só enxerga e apaga os que ELE enviou por aqui (enviado_pelo_cliente), nunca os da equipe.
 */

/** Campos de texto simples do briefing. */
const CAMPOS_TEXTO = ['site', 'whatsapp_leads', 'instagram', 'facebook', 'crm', 'crm_email'] as const;
const CAMPOS_SENHA = ['instagram_senha', 'facebook_senha', 'crm_senha'] as const;
const CAMPOS_CHECKLIST = [
  'pagamento_anuncios', 'pagamento_obs', 'google_ads', 'google_ads_obs', 'analytics', 'analytics_obs',
  'tag_manager', 'tag_manager_obs', 'meu_negocio', 'meu_negocio_obs',
] as const;
const TODOS = [...CAMPOS_TEXTO, ...CAMPOS_SENHA, ...CAMPOS_CHECKLIST] as const;

const ROTULO_LINK_MATERIAIS = 'Link de materiais (Drive)';
const MAX_ARQUIVO_BYTES = 5 * 1024 * 1024;
const MAX_ARQUIVOS = 60;
const TIPOS_ACEITOS = /^(image\/|video\/|application\/pdf$|application\/zip$|application\/x-zip|application\/msword$|application\/vnd\.)/;

type Par = { rotulo: string; valor: string };
type Pergunta = { pergunta: string; resposta: string };

const texto = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function lista<T extends Record<string, string>>(bruto: unknown, campos: (keyof T & string)[]): T[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((x) =>
    Object.fromEntries(campos.map((c) => [c, String((x as Record<string, unknown>)?.[c] ?? '').slice(0, 4000)])) as T
  );
}

async function briefingDoToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  return queryOne<Record<string, unknown> & { gc_cliente_id: string }>(
    `SELECT b.gc_cliente_id, ${TODOS.map((c) => `b.${c}`).join(', ')}, b.extras, b.perguntas,
            b.enviado_em, c.nome_empresa, c.logo_url
     FROM gc_briefing b JOIN gc_clientes c ON c.id = b.gc_cliente_id
     WHERE b.link_token = $1`,
    [token]
  );
}

async function arquivosDoCliente(clienteId: string) {
  return query<{ id: string; titulo: string; tipo: string | null; tamanho: number | null }>(
    `SELECT id, titulo, anexo->>'type' AS tipo, (anexo->>'size')::bigint AS tamanho
     FROM gc_social_materiais
     WHERE gc_cliente_id = $1 AND tipo = 'arquivo' AND enviado_pelo_cliente
     ORDER BY created_at`,
    [clienteId]
  );
}

export async function gcBriefingPublicoRoutes(app: FastifyInstance) {
  // GET — o que o cliente vê ao abrir o link.
  app.get<{ Params: { token: string } }>('/api/public/briefing-nx/:token', async (req, reply) => {
    const b = await briefingDoToken(req.params.token);
    if (!b) return reply.status(404).send({ message: 'Link inválido ou revogado' });
    const extras = lista<Par>(b.extras, ['rotulo', 'valor']);
    return {
      cliente: { nome_empresa: b.nome_empresa, logo_url: b.logo_url ?? null },
      campos: Object.fromEntries([...CAMPOS_TEXTO, ...CAMPOS_CHECKLIST].map((c) => [c, String(b[c] ?? '')])),
      // Senha nunca volta: só se já existe uma salva.
      tem_senha: Object.fromEntries(CAMPOS_SENHA.map((c) => [c, String(b[c] ?? '') !== ''])),
      perguntas: lista<Pergunta>(b.perguntas, ['pergunta', 'resposta']).filter((p) => p.pergunta.trim()),
      link_materiais: extras.find((e) => e.rotulo === ROTULO_LINK_MATERIAIS)?.valor ?? '',
      arquivos: await arquivosDoCliente(b.gc_cliente_id),
      enviado_em: b.enviado_em ?? null,
    };
  });

  // PUT — salva o que veio (cada etapa salva ao avançar). Só mexe nas chaves presentes no corpo.
  app.put<{ Params: { token: string }; Body: Record<string, unknown> }>(
    '/api/public/briefing-nx/:token',
    async (req, reply) => {
      const b = await briefingDoToken(req.params.token);
      if (!b) return reply.status(404).send({ message: 'Link inválido ou revogado' });
      const corpo = req.body ?? {};
      const campos = (corpo.campos && typeof corpo.campos === 'object' ? corpo.campos : {}) as Record<string, unknown>;

      const sets: string[] = [];
      const params: unknown[] = [];
      const por = (coluna: string, valor: unknown, cast = '') => {
        params.push(valor);
        sets.push(`${coluna} = $${params.length}${cast}`);
      };
      for (const c of [...CAMPOS_TEXTO, ...CAMPOS_CHECKLIST]) {
        if (c in campos) por(c, texto(campos[c]));
      }
      // Senha em branco = manter a que já está salva.
      for (const c of CAMPOS_SENHA) {
        const v = texto(campos[c]);
        if (v) por(c, v);
      }

      if (Array.isArray(corpo.perguntas)) {
        const novas = lista<Pergunta>(corpo.perguntas, ['pergunta', 'resposta']).filter((p) => p.pergunta.trim());
        const atuais = lista<Pergunta>(b.perguntas, ['pergunta', 'resposta']).filter((p) => p.pergunta.trim());
        const porTexto = new Map(novas.map((p) => [p.pergunta, p.resposta]));
        // Atualiza a resposta das que vieram, acrescenta as que faltavam e mantém o resto como está.
        const juntas = atuais.map((p) => (porTexto.has(p.pergunta) ? { ...p, resposta: porTexto.get(p.pergunta)! } : p));
        const jaTem = new Set(atuais.map((p) => p.pergunta));
        for (const p of novas) if (!jaTem.has(p.pergunta)) juntas.push(p);
        por('perguntas', JSON.stringify(juntas.slice(0, 200)), '::jsonb');
      }

      if (typeof corpo.link_materiais === 'string') {
        const link = texto(corpo.link_materiais, 1000);
        const extras = lista<Par>(b.extras, ['rotulo', 'valor']).filter((e) => e.rotulo !== ROTULO_LINK_MATERIAIS);
        if (link) extras.push({ rotulo: ROTULO_LINK_MATERIAIS, valor: link });
        por('extras', JSON.stringify(extras), '::jsonb');
      }

      if (sets.length) {
        params.push(b.gc_cliente_id);
        await query(`UPDATE gc_briefing SET ${sets.join(', ')}, updated_at = NOW() WHERE gc_cliente_id = $${params.length}`, params);
      }
      return { ok: true };
    }
  );

  // POST /enviar — o cliente terminou. Marca a data e avisa a equipe no histórico do cliente.
  app.post<{ Params: { token: string } }>('/api/public/briefing-nx/:token/enviar', async (req, reply) => {
    const b = await briefingDoToken(req.params.token);
    if (!b) return reply.status(404).send({ message: 'Link inválido ou revogado' });
    const jaTinha = Boolean(b.enviado_em);
    await query('UPDATE gc_briefing SET enviado_em = NOW(), updated_at = NOW() WHERE gc_cliente_id = $1', [b.gc_cliente_id]);
    await query(
      `INSERT INTO gc_historico (gc_cliente_id, tipo, titulo, descricao) VALUES ($1, 'evento_sistema', $2, $3)`,
      [
        b.gc_cliente_id,
        jaTinha ? 'Briefing atualizado pelo cliente' : 'Briefing preenchido pelo cliente',
        'Enviado pelo link público. Confira na aba Briefing.',
      ]
    );
    return { ok: true };
  });

  // POST /arquivo — logo (vira a logo do cliente) ou foto/vídeo/documento (vai pra biblioteca de materiais).
  app.post<{ Params: { token: string }; Body: { anexo?: Record<string, unknown>; logo?: boolean } }>(
    '/api/public/briefing-nx/:token/arquivo',
    async (req, reply) => {
      const b = await briefingDoToken(req.params.token);
      if (!b) return reply.status(404).send({ message: 'Link inválido ou revogado' });
      const a = req.body?.anexo ?? {};
      const dataUrl = typeof a.dataUrl === 'string' ? a.dataUrl : '';
      const m = /^data:([a-z0-9.+/-]+);base64,/i.exec(dataUrl);
      if (!m) return reply.status(400).send({ message: 'Arquivo inválido' });
      const tipo = m[1].toLowerCase();
      const bytes = Math.floor(((dataUrl.length - m[0].length) * 3) / 4);
      if (bytes > MAX_ARQUIVO_BYTES) return reply.status(400).send({ message: 'O arquivo passa de 5MB — mande pelo link do Drive.' });

      if (req.body?.logo) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(tipo)) return reply.status(400).send({ message: 'A logo precisa ser uma imagem (PNG ou JPG).' });
        await query('UPDATE gc_clientes SET logo_url = $2, updated_at = NOW() WHERE id = $1', [b.gc_cliente_id, dataUrl]);
        return { ok: true, logo_url: dataUrl };
      }

      if (!TIPOS_ACEITOS.test(tipo)) return reply.status(400).send({ message: 'Tipo de arquivo não aceito.' });
      const ja = await arquivosDoCliente(b.gc_cliente_id);
      if (ja.length >= MAX_ARQUIVOS) return reply.status(400).send({ message: 'Limite de arquivos atingido — mande o restante pelo link do Drive.' });
      const nome = texto(a.name, 200) || 'arquivo';
      const criado = await queryOne<{ id: string }>(
        `INSERT INTO gc_social_materiais (gc_cliente_id, tipo, titulo, url, anexo, enviado_pelo_cliente)
         VALUES ($1, 'arquivo', $2, '', $3::jsonb, true) RETURNING id`,
        [b.gc_cliente_id, nome, JSON.stringify({ id: String(a.id ?? ''), name: nome, type: tipo, size: bytes, dataUrl })]
      );
      return reply.status(201).send({ id: criado!.id, titulo: nome, tipo, tamanho: bytes });
    }
  );

  // DELETE /arquivo/:id — só o que o próprio cliente enviou por aqui.
  app.delete<{ Params: { token: string; id: string } }>('/api/public/briefing-nx/:token/arquivo/:id', async (req, reply) => {
    const b = await briefingDoToken(req.params.token);
    if (!b) return reply.status(404).send({ message: 'Link inválido ou revogado' });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.status(400).send({ message: 'Arquivo inválido' });
    await query(
      `DELETE FROM gc_social_materiais WHERE id = $1 AND gc_cliente_id = $2 AND tipo = 'arquivo' AND enviado_pelo_cliente`,
      [req.params.id, b.gc_cliente_id]
    );
    return reply.status(204).send();
  });
}
