/**
 * Cliente mínimo da API do Autentique (GraphQL v2) para o fluxo do contrato:
 *   1. sobe o PDF e cria o documento com DOIS signatários: a NX (dona do token) e o cliente;
 *   2. assina como NX (signDocument assina em nome do dono do token — por isso a NX precisa estar na lista);
 *   3. devolve o link de assinatura do cliente, pra quem usa o sistema só copiar e mandar.
 *
 * Nada é enviado ao cliente pelo Autentique: o signatário do cliente entra só com o nome (sem e-mail/telefone), que é o
 * jeito documentado de receber o link na resposta. A NX entra com o e-mail da conta do token (consulta `me`).
 * Docs: https://docs.autentique.com.br/api/mutations/criando-um-documento
 */

export const AUTENTIQUE_URL = 'https://api.autentique.com.br/v2/graphql';
const TIMEOUT_MS = 60_000;

export interface EnvioAutentique {
  documentId: string;
  /** Link (assina.ae) pro cliente assinar. */
  linkCliente: string;
  /** A NX já assinou (o documento só fica completo quando o cliente assinar). */
  nxAssinou: boolean;
  /** Se a assinatura automática da NX falhou: link pra NX assinar à mão. */
  linkNx: string | null;
  erroNx: string | null;
  nxEmail: string;
}

interface Assinatura {
  public_id: string;
  name?: string | null;
  email?: string | null;
  link?: { short_link?: string | null } | null;
  user?: { id?: string | null; email?: string | null } | null;
}

type Opcoes = { token: string; url?: string };

class ErroAutentique extends Error {}

async function lerResposta<T>(res: Response): Promise<T> {
  if (res.status === 401 || res.status === 403) throw new ErroAutentique('O Autentique recusou o token (confira o token da API nas configurações).');
  if (!res.ok) throw new ErroAutentique(`O Autentique respondeu ${res.status}.`);
  const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (json.errors?.length) throw new ErroAutentique(json.errors.map((e) => e.message).filter(Boolean).join('; ') || 'Erro do Autentique.');
  if (!json.data) throw new ErroAutentique('Resposta vazia do Autentique.');
  return json.data;
}

async function consulta<T>(o: Opcoes, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(o.url ?? AUTENTIQUE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return lerResposta<T>(res);
}

async function criarDocumento<T>(o: Opcoes, query: string, variables: Record<string, unknown>, pdf: Buffer): Promise<T> {
  // GraphQL multipart request spec: operations + map + arquivo.
  const form = new FormData();
  form.append('operations', JSON.stringify({ query, variables: { ...variables, file: null } }));
  form.append('map', JSON.stringify({ file: ['variables.file'] }));
  form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'contrato.pdf');
  const res = await fetch(o.url ?? AUTENTIQUE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.token}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return lerResposta<T>(res);
}

const igual = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export async function enviarContratoAoAutentique(p: {
  token: string;
  /** Nome do documento no Autentique. */
  nome: string;
  /** Nome do cliente (aparece no signatário). */
  clienteNome: string;
  pdf: Buffer;
  /** Documento de teste: não gasta crédito e some em alguns dias. */
  sandbox?: boolean;
  url?: string;
}): Promise<EnvioAutentique> {
  const o: Opcoes = { token: p.token, url: p.url };

  // A NX é o dono do token: pega o e-mail da conta pra entrar como signatária.
  const eu = await consulta<{ me?: { email?: string | null; name?: string | null } | null }>(o, 'query { me { id name email } }');
  const nxEmail = eu.me?.email?.trim();
  if (!nxEmail) throw new ErroAutentique('Não consegui ler o e-mail da conta do Autentique (token sem acesso ao perfil).');

  const criado = await criarDocumento<{ createDocument?: { id: string; signatures?: Assinatura[] } | null }>(
    o,
    `mutation ($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
      createDocument(document: $document, signers: $signers, file: $file${p.sandbox ? ', sandbox: true' : ''}) {
        id
        signatures { public_id name email link { short_link } user { id email } }
      }
    }`,
    {
      document: { name: p.nome },
      signers: [
        { email: nxEmail, action: 'SIGN' },
        { name: p.clienteNome, action: 'SIGN' },
      ],
    },
    p.pdf,
  );
  const doc = criado.createDocument;
  if (!doc?.id) throw new ErroAutentique('O Autentique não devolveu o documento criado.');
  const assinaturas = doc.signatures ?? [];
  const nxSig = assinaturas.find((s) => igual(s.user?.email, nxEmail) || igual(s.email, nxEmail));
  const clienteSig = assinaturas.find((s) => s !== nxSig);
  if (!clienteSig) throw new ErroAutentique('O Autentique não devolveu a assinatura do cliente.');

  const linkDe = async (s: Assinatura): Promise<string> => {
    if (s.link?.short_link) return s.link.short_link;
    const r = await consulta<{ createLinkToSignature?: { short_link?: string | null } | null }>(
      o, 'mutation ($id: UUID!) { createLinkToSignature(public_id: $id) { short_link } }', { id: s.public_id },
    );
    const link = r.createLinkToSignature?.short_link;
    if (!link) throw new ErroAutentique('O Autentique não gerou o link de assinatura.');
    return link;
  };

  // Assina como NX. Se falhar, o documento já existe: devolve o link pra NX assinar à mão.
  let nxAssinou = false;
  let linkNx: string | null = null;
  let erroNx: string | null = null;
  try {
    const r = await consulta<{ signDocument?: boolean }>(o, 'mutation ($id: UUID!) { signDocument(id: $id) }', { id: doc.id });
    nxAssinou = r.signDocument === true;
    if (!nxAssinou) erroNx = 'O Autentique não confirmou a assinatura da NX.';
  } catch (e) {
    erroNx = (e as Error).message;
  }
  if (!nxAssinou && nxSig) {
    try { linkNx = await linkDe(nxSig); } catch { /* sem link da NX: segue com o do cliente */ }
  }

  return { documentId: doc.id, linkCliente: await linkDe(clienteSig), nxAssinou, linkNx, erroNx, nxEmail };
}
