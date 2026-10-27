import { queryOne } from '../db.js';
import { sendPushToUsers } from '../lib/webPush.js';
import { agoraLocal, blocosComecando, ehDiaDeRotina, textoDoAviso } from '../lib/rotina.js';
import { donoDaPagina } from '../routes/notificacoes.js';
import { PAGINAS_COM_ROTINA, diaDaRotina, folgasNoPeriodo } from '../routes/rotina.js';

/**
 * Push no celular do dono da aba quando começa um bloco da rotina (ver routes/rotina.ts). Bloco de reunião avisa a
 * reunião do horário — ou, sem reunião, o que fazer no lugar. Junto vai o que ficou sem marcar antes. Cada bloco avisa
 * uma vez por dia (rotina_avisos), mesmo reiniciando. Fim de semana e folga não avisam.
 */
const INTERVALO_MS = 30_000;

async function avisarBlocos() {
  const agora = agoraLocal();
  if (!ehDiaDeRotina(agora.data)) return;
  for (const pagina of PAGINAS_COM_ROTINA) {
    if ((await folgasNoPeriodo(pagina, agora.data, agora.data)).has(agora.data)) continue;
    const dia = await diaDaRotina(pagina, agora.data, agora);
    const comecando = blocosComecando(dia.blocos, agora.hora);
    if (!comecando.length) continue;
    const dono = await donoDaPagina(pagina);
    if (!dono) continue;
    for (const b of comecando) {
      const novo = await queryOne(
        `INSERT INTO rotina_avisos (bloco_id, data) VALUES ($1, $2::date) ON CONFLICT DO NOTHING RETURNING bloco_id`,
        [b.id, agora.data]
      );
      if (!novo) continue;
      const faltaMarcar = dia.blocos.filter((x) => x.fim <= b.inicio && (x.estado === 'pendente' || x.estado === 'sem_resposta'));
      await sendPushToUsers([dono.id], {
        ...textoDoAviso(b, b.reunioes, faltaMarcar.slice(-3)),
        url: `/comercial/${pagina}?rotina=1`,
        tag: `rotina-${pagina}`,
      });
    }
  }
}

export function startRotinaAvisos() {
  const tick = () => { avisarBlocos().catch((err) => console.error('[rotina] erro ao avisar o início do bloco:', err)); };
  setTimeout(tick, 25_000);
  setInterval(tick, INTERVALO_MS);
  console.log('[rotina] push no início de cada bloco da rotina (a cada 30s)');
}
