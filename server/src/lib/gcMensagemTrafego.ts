import { queryOne } from '../db.js';
import { chamarClaude } from './gcIa.js';

/**
 * "Mensagem para o cliente" da aba Tráfego: a partir do que o gestor registrou em "Última edição",
 * a IA escreve um recado curto de WhatsApp avisando o cliente da atualização. O gestor revisa,
 * edita se quiser e copia; nada é enviado sozinho.
 */

export const SISTEMA_MENSAGEM = `Você escreve, em nome da NX Digital (agência de marketing), uma mensagem de WhatsApp para o cliente
avisando que a equipe fez uma atualização no tráfego pago (anúncios no Meta: Facebook e Instagram).

Regras:
- Português do Brasil, tom cordial, próximo e profissional. Pode usar 1 ou 2 emojis, sem exagero.
- Comece cumprimentando pelo primeiro nome do contato, se ele vier; senão, "Olá, tudo bem?".
- Conte o que foi feito em linguagem simples, sem jargão (troque "CTR", "CPM", "conjunto", "público lookalike" por
  explicações curtas) e, quando der, diga o motivo de cada mudança em uma frase.
- Use SÓ o que está nas anotações. Não invente números, resultados, prazos nem promessas de resultado.
- Ignore comentários internos que não são para o cliente (opinião sobre o cliente, cobrança, problemas internos).
- Valores de orçamento podem aparecer, se estiverem nas anotações.
- Curta: de 3 a 8 linhas. Se forem várias mudanças, use uma lista com "•".
- Termine dizendo que a equipe segue acompanhando os resultados e fica à disposição.
- Não assine com nome de pessoa. Responda SÓ com o texto da mensagem, sem aspas e sem comentários.`;

/** O pedido que vai para a IA (puro, coberto por teste). */
export function pedidoDaMensagem(d: { empresa: string; contato: string; texto: string }): string {
  const primeiroNome = d.contato.trim().split(/\s+/)[0] ?? '';
  return [
    `Cliente: ${d.empresa.trim() || '(sem nome)'}`,
    `Contato: ${primeiroNome || '(não informado)'}`,
    '',
    'Anotações do gestor sobre o que foi alterado no tráfego:',
    d.texto.trim(),
  ].join('\n');
}

/** Limpa a resposta: sem aspas em volta e sem espaço sobrando. */
export function limparMensagem(t: string): string {
  return t.trim().replace(/^["“](.*)["”]$/s, '$1').trim().slice(0, 4000);
}

export async function gerarMensagemParaCliente(clienteId: string, texto: string): Promise<string> {
  const c = await queryOne<{ nome_empresa: string; nome_contato: string }>(
    'SELECT nome_empresa, nome_contato FROM gc_clientes WHERE id = $1',
    [clienteId],
  );
  const resposta = await chamarClaude(
    SISTEMA_MENSAGEM,
    [{ role: 'user', content: pedidoDaMensagem({ empresa: c?.nome_empresa ?? '', contato: c?.nome_contato ?? '', texto }) }],
    1200,
  );
  return limparMensagem(resposta);
}
