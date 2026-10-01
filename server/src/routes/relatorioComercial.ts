import { randomInt } from 'crypto';
import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { montarRelatorioDoMes, mesesDisponiveis } from '../lib/relatorioComercial.js';

/**
 * Link público do relatório comercial — o mesmo painel do mês que a equipe vê, só que de fora e
 * só pra ler.
 *
 * O endereço carrega um token aleatório guardado em settings.relatorio_token: quem tem o link vê,
 * quem não tem recebe 404. É o mesmo arranjo da ficha de cadastro e do briefing. Trocar o token
 * (botão "gerar link novo") derruba todos os links antigos de uma vez — é a forma de revogar
 * quando um link circulou além da conta.
 *
 * A rota pública devolve SÓ números agregados: nenhum nome de lead, telefone ou valor por cliente.
 */
/** Alfabeto sem 0/O/1/l/I: o link é lido em voz alta e digitado à mão, e esses pares são a
 * fonte clássica de "não abre aqui". 8 caracteres dão 35^8 combinações — adivinhar é inviável. */
const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789';

function tokenCurto(): string {
  let saida = '';
  for (let i = 0; i < 8; i++) saida += ALFABETO[randomInt(ALFABETO.length)];
  return saida;
}

export async function relatorioComercialRoutes(app: FastifyInstance) {
  // ---------------- interno (precisa de login) ----------------

  /** O link de hoje. Cria o token na primeira vez que alguém abre a tela. */
  app.get('/api/relatorio-comercial/link', { onRequest: [app.authenticate] }, async () => {
    const atual = await queryOne<{ relatorio_token: string | null }>(
      'SELECT relatorio_token FROM settings WHERE id = true'
    );
    // Token comprido de versão anterior (UUID) vira curto na primeira visita — o endereço com
    // 36 caracteres não cabia na barra do navegador nem numa mensagem. Nome escolhido à mão
    // (sempre com letra) fica como está, por maior que seja.
    const guardado = atual?.relatorio_token;
    const ehUuidAntigo = !!guardado && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(guardado);
    if (guardado && !ehUuidAntigo) return { token: guardado };
    const token = tokenCurto();
    await query('UPDATE settings SET relatorio_token = $1 WHERE id = true', [token]);
    return { token };
  });

  /**
   * Troca o endereço. Sem `nome`, sorteia um código; com `nome`, usa o que a pessoa escolheu
   * (ex.: "internomes" -> /relatorio/internomes), que é mais fácil de ditar e de reconhecer numa
   * conversa. Nos dois casos o anterior para de funcionar na hora.
   *
   * Nome escolhido é, por natureza, adivinhável — quem souber o padrão chega no relatório. Vale a
   * troca enquanto o que sai dali é número agregado do mês; se um dia o link mostrar dado de
   * cliente, volta a fazer sentido exigir código sorteado.
   */
  app.post<{ Body: { nome?: string } }>(
    '/api/relatorio-comercial/link',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const pedido = (req.body?.nome ?? '').trim().toLowerCase();
      let token: string;
      if (pedido) {
        // Só o que sobrevive numa URL sem confundir ninguém: letras, números e hífen.
        const limpo = pedido.replace(/[^a-z0-9-]/g, '');
        if (limpo.length < 4 || limpo.length > 40) {
          return reply.status(400).send({ message: 'Use de 4 a 40 letras, números ou hífen.' });
        }
        token = limpo;
      } else {
        token = tokenCurto();
      }
      await query('UPDATE settings SET relatorio_token = $1 WHERE id = true', [token]);
      return { token };
    }
  );

  // ---------------- público (sem login) ----------------

  app.get<{ Params: { token: string }; Querystring: { mes?: string } }>(
    '/api/public/relatorio-comercial/:token',
    async (req, reply) => {
      const linha = await queryOne<{ relatorio_token: string | null }>(
        'SELECT relatorio_token FROM settings WHERE id = true'
      );
      const token = linha?.relatorio_token;
      if (!token || req.params.token !== token) {
        return reply.status(404).send({ message: 'Relatório não encontrado ou link expirado.' });
      }

      const meses = await mesesDisponiveis();
      if (!meses.length) return reply.status(404).send({ message: 'Nenhum mês cadastrado ainda.' });

      const pedido = (req.query.mes ?? '').trim();
      const mes = meses.includes(pedido) ? pedido : meses[0];
      const relatorio = await montarRelatorioDoMes(mes);
      if (!relatorio) return reply.status(404).send({ message: 'Mês inválido.' });
      return { ...relatorio, meses };
    }
  );
}
