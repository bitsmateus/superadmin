import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { enviarContratoAoAutentique } from './autentique.js';

/** Autentique de mentira: confere o formato das chamadas (multipart do PDF, signatários, token) e responde como a API real. */
async function subirMock(opcoes: { falhaAoAssinar?: boolean; semLinkNaCriacao?: boolean } = {}) {
  const chamadas: { auth: string | undefined; query: string; variables: Record<string, unknown>; arquivo?: { nome: string; bytes: number; tipo: string } }[] = [];
  const server = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', async () => {
      const corpo = Buffer.concat(partes);
      const tipo = String(req.headers['content-type'] ?? '');
      let query = '';
      let variables: Record<string, unknown> = {};
      let arquivo: { nome: string; bytes: number; tipo: string } | undefined;
      if (tipo.startsWith('multipart/form-data')) {
        const form = await new Response(corpo, { headers: { 'content-type': tipo } }).formData();
        const ops = JSON.parse(String(form.get('operations')));
        assert.deepEqual(JSON.parse(String(form.get('map'))), { file: ['variables.file'] });
        query = ops.query; variables = ops.variables;
        const f = form.get('file') as File;
        arquivo = { nome: f.name, bytes: f.size, tipo: f.type };
      } else {
        const j = JSON.parse(corpo.toString('utf8'));
        query = j.query; variables = j.variables ?? {};
      }
      chamadas.push({ auth: req.headers.authorization, query, variables, arquivo });
      const ok = (data: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data })); };
      if (query.includes('me {')) return ok({ me: { id: '1', name: 'NX', email: 'nx@exemplo.com' } });
      if (query.includes('createDocument')) {
        return ok({ createDocument: { id: 'doc-1', signatures: [
          { public_id: 'sig-nx', name: 'NX', email: 'nx@exemplo.com', link: null, user: { id: '1', email: 'nx@exemplo.com' } },
          { public_id: 'sig-cli', name: 'Cliente Ltda', email: null, link: opcoes.semLinkNaCriacao ? null : { short_link: 'https://assina.ae/cliente' }, user: null },
        ] } });
      }
      if (query.includes('signDocument')) {
        if (opcoes.falhaAoAssinar) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ errors: [{ message: 'signature_not_found' }] })); }
        return ok({ signDocument: true });
      }
      if (query.includes('createLinkToSignature')) {
        return ok({ createLinkToSignature: { short_link: `https://assina.ae/${(variables as { id: string }).id}` } });
      }
      res.statusCode = 400; res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`;
  return { url, chamadas, fechar: () => new Promise<void>((r) => server.close(() => r())) };
}

const PDF = Buffer.from('%PDF-1.4 teste');

test('Autentique: cria o documento com a NX e o cliente, a NX assina e volta o link do cliente', async () => {
  const m = await subirMock();
  try {
    const r = await enviarContratoAoAutentique({ token: 'tok', nome: 'Contrato — Cliente Ltda', clienteNome: 'Cliente Ltda', pdf: PDF, url: m.url });
    assert.equal(r.documentId, 'doc-1');
    assert.equal(r.linkCliente, 'https://assina.ae/cliente');
    assert.equal(r.nxAssinou, true);
    assert.equal(r.linkNx, null);
    assert.equal(r.nxEmail, 'nx@exemplo.com');
    assert.ok(m.chamadas.every((c) => c.auth === 'Bearer tok'));
    const criar = m.chamadas.find((c) => c.query.includes('createDocument'))!;
    assert.deepEqual(criar.variables.document, { name: 'Contrato — Cliente Ltda' });
    // A NX entra com o e-mail da conta; o cliente só com o nome (nada é enviado a ele pelo Autentique).
    assert.deepEqual(criar.variables.signers, [{ email: 'nx@exemplo.com', action: 'SIGN' }, { name: 'Cliente Ltda', action: 'SIGN' }]);
    assert.deepEqual(criar.arquivo, { nome: 'contrato.pdf', bytes: PDF.length, tipo: 'application/pdf' });
    assert.ok(!criar.query.includes('sandbox'));
  } finally { await m.fechar(); }
});

test('Autentique: pede o link à parte quando a criação não devolve, e usa sandbox quando pedido', async () => {
  const m = await subirMock({ semLinkNaCriacao: true });
  try {
    const r = await enviarContratoAoAutentique({ token: 'tok', nome: 'x', clienteNome: 'Cliente', pdf: PDF, url: m.url, sandbox: true });
    assert.equal(r.linkCliente, 'https://assina.ae/sig-cli');
    assert.ok(m.chamadas.find((c) => c.query.includes('createDocument'))!.query.includes('sandbox: true'));
  } finally { await m.fechar(); }
});

test('Autentique: se a assinatura automática da NX falha, o documento existe e vem o link da NX pra assinar à mão', async () => {
  const m = await subirMock({ falhaAoAssinar: true });
  try {
    const r = await enviarContratoAoAutentique({ token: 'tok', nome: 'x', clienteNome: 'Cliente', pdf: PDF, url: m.url });
    assert.equal(r.nxAssinou, false);
    assert.equal(r.erroNx, 'signature_not_found');
    assert.equal(r.linkNx, 'https://assina.ae/sig-nx');
    assert.equal(r.linkCliente, 'https://assina.ae/cliente');
  } finally { await m.fechar(); }
});

test('Autentique: token recusado vira mensagem clara', async () => {
  const server = http.createServer((_req, res) => { res.statusCode = 401; res.end('{}'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(
      enviarContratoAoAutentique({ token: 'ruim', nome: 'x', clienteNome: 'C', pdf: PDF, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/g` }),
      /recusou o token/,
    );
  } finally { await new Promise<void>((r) => server.close(() => r())); }
});
