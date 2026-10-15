# API de integração (n8n — réguas de WhatsApp)

Rotas em `/api/integracao/*`, no mesmo backend (`server/`). Código: `server/src/routes/integracao.ts`.

## Chave de API

A chave fica na variável de ambiente **`INTEGRACAO_API_KEY`** do backend e vai no header `x-api-key`.
Nunca vai para o front (não existe `VITE_` para ela). **Sem a variável, todas as rotas respondem 503** — a API não fica aberta por esquecimento.

Gerar uma chave: `openssl rand -hex 32`. Para trocar, mude a variável e reinicie o backend (o n8n precisa da nova chave).

## Regras

- **Coluna** = coluna do quadro (`lead_boards`); **quadro** = a aba (`lead_pages`, ex.: CRM NX Arthur).
- Nome de coluna: sem diferenciar maiúscula, acento, pontuação ou espaços. Em cada quadro vale o nome **igual**; se não houver igual, vale **"começa com"**. Assim `DISPARO EM MASSA` acha `Disparo em massa após 7 dias` e `FOLLOW UP PROPOSTAS` acha `Followup Propostas`.
- A listagem **não traz** cards excluídos, quadros arquivados nem **cópias** (espelho do closer e aba Vendas) — senão o mesmo telefone entraria na régua duas vezes.
- `telefone` sai só com dígitos e 55 (`null` se o texto do card não der um número completo com DDD; o original vai em `telefone_original`).
- `entrou_coluna_em` é `null` nos cards que já existiam antes desta funcionalidade (sem backfill). `entrou_depois` ignora esses cards.
- **Venda e comissão nunca pela API.** Ela recusa (403) mover card para colunas de Vendas/Contrato e não chama a lógica de venda/comissão da tela.
- Mover para "Reunião agendada" no CRM do Arthur **cria o espelho no CRM do Luis (closer)**, como na tela (`espelharSeReuniaoAgendada`). Só cria/restaura a cópia; edições posteriores não são propagadas para a cópia.
- Mover por nome (`coluna`) só procura dentro do quadro do próprio card. Para outro quadro use `board_id`.
- O PATCH não cria evento na Agenda (Google Calendar) ao mudar `agendamento`.
- Marcar `optout: true` sem informar `regua_status` grava `regua_status = "optout"`.

## Histórico de coluna

Tabela `lead_board_history` (card, coluna de origem/destino com os nomes, data/hora, quem moveu), gravada por **trigger no banco** em qualquer troca de `board_id` (tela, importação, espelho, API). Pela API o autor é `automação`; pela tela é o nome do usuário; outros caminhos, `Sistema`. Cards novos têm uma linha de entrada (origem vazia).

## Exemplos (curl)

```bash
export API=https://SEU-BACKEND   # URL pública do backend (porta 3001)
export KEY=sua-chave
```

Listar cards de uma coluna (todos os quadros), com filtros opcionais `entrou_depois` (AAAA-MM-DD = 00:00 de Brasília, ou ISO), `board_id` e `limite` (padrão 1000):
```bash
curl -H "x-api-key: $KEY" "$API/api/integracao/cards?coluna=DISPARO%20EM%20MASSA&entrou_depois=2026-10-01"
```

Achar por telefone (com/sem 55, com/sem o 9):
```bash
curl -H "x-api-key: $KEY" "$API/api/integracao/cards/telefone/11987654321"
```

Atualizar (qualquer subconjunto de: `etiquetas`, `coluna` | `board_id`, `status`, `agendamento`, `retornar`, `dor_cliente` (ou `dor`), `numero_atendentes` (ou `atendentes`), `valor_mrr` (`mrr`), `valor_implementacao` (`implementacao`), `sdr`, `regua` (`disparo`|`proposta`|`""`), `regua_etapa`, `regua_ultimo_envio_em`, `regua_status` (`ativa`|`respondeu`|`encerrada`|`optout`), `optout`):
```bash
# régua enviada
curl -X PATCH -H "x-api-key: $KEY" -H "content-type: application/json" \
  "$API/api/integracao/cards/$ID" \
  -d '{"regua":"disparo","regua_etapa":"D7","regua_status":"ativa","regua_ultimo_envio_em":"2026-10-15T12:00:00Z"}'

# lead respondeu: move de coluna e encerra a régua
curl -X PATCH -H "x-api-key: $KEY" -H "content-type: application/json" \
  "$API/api/integracao/cards/$ID" -d '{"coluna":"Primeiro contato","regua_status":"respondeu"}'

# pediu para sair
curl -X PATCH -H "x-api-key: $KEY" -H "content-type: application/json" \
  "$API/api/integracao/cards/$ID" -d '{"optout":true}'
```

Anotação no log do card (texto puro; `autor` opcional, padrão "Automação"):
```bash
curl -X POST -H "x-api-key: $KEY" -H "content-type: application/json" \
  "$API/api/integracao/cards/$ID/log" -d '{"texto":"Luiza: enviou template D7"}'
```

### Colunas de etiqueta (`etiquetas`)

Toda resposta de card (listagem, por telefone e PATCH) traz `etiquetas`: `{ "<coluna como aparece no quadro>": "<etiqueta atual ou ''>" }`, com as colunas de etiqueta que a **aba** do card tem: `Tipo`, `Dia de contato`, `Lig.`, `Status`, `Follow-up`, `Disparo`, `SDR` (só aparece a coluna que tem etiquetas cadastradas naquela aba; cada aba tem as suas, `SDR` é global).

No PATCH, `"etiquetas": {"Disparo": "D7", "Follow-up": "D3"}`:
- coluna e etiqueta comparadas sem diferenciar maiúscula/acento/pontuação (`"disparo"`, `"follow up"` e `"d7"` valem); a coluna vale pelo nome da tela ou pelo nome interno (`followup`, `dia_contato`, `ligacao`);
- só aceita etiqueta que **já existe** naquela coluna (nunca cria); `""`/`null` limpa;
- coluna ou etiqueta inexistente -> `400` com a mensagem e `etiquetas_validas` (todas as colunas e suas etiquetas);
- as etiquetas valem para a aba do card **depois** do PATCH (se o mesmo PATCH move o card para outro quadro, vale a aba de destino);
- `Status` e `SDR` também têm campo próprio (`status`, `sdr`): mandar os dois no mesmo PATCH dá `400`;
- cada troca grava um evento na linha do tempo do card (autor "Automação"): `status`, `dia_contato`, `sdr`, `tipo`, `ligacao`, `followup`, `disparo`. (A tela só registra os três primeiros; os demais passam a aparecer na linha do tempo com o deploy do front.)

```bash
curl -X PATCH -H "x-api-key: $KEY" -H "content-type: application/json" \
  "$API/api/integracao/cards/$ID" -d '{"etiquetas":{"Disparo":"D7"}}'
```

Erros: `401` chave errada/ausente · `503` chave não configurada no servidor · `400` corpo/campo inválido · `403` coluna de Vendas/Contrato · `404` card/coluna/telefone não encontrado · `409` nome de coluna ambíguo (use `board_id`).

## Testar localmente

```bash
cd server && npm ci
export DATABASE_URL=postgres://usuario:senha@localhost:5432/banco   # um banco de TESTE
export JWT_SECRET=qualquer INTEGRACAO_API_KEY=chave-local PORT=3001
npm run dev            # a migração roda sozinha no boot (idempotente)
npm test               # testes unitários (telefone, nome de coluna, validação, chave)
npx tsc --noEmit       # tipos
```
Depois rode os curls acima com `API=http://localhost:3001`. Para conferir o histórico: `select * from lead_board_history order by moved_at desc limit 10;`.

## Publicar (Easypanel)

1. Revise e faça o merge da branch `automacao-reguas` (o deploy normalmente sai da `main`/branch configurada no serviço).
2. No Easypanel, serviço do **backend** → *Environment*: adicione `INTEGRACAO_API_KEY=<chave>` e salve.
3. Faça o deploy (rebuild) do backend. No primeiro boot a migração adiciona as colunas, a tabela `lead_board_history` e os triggers (`IF NOT EXISTS`; seguro repetir). O front não muda.
4. Teste em produção: `curl -i "$API/api/integracao/cards?coluna=vendido"` sem a chave deve dar `401`; com a chave, `200`.
5. No n8n, guarde a chave como credencial (Header Auth, nome `x-api-key`).

Reverter: remova a variável (a API passa a responder 503). As colunas/tabela novas podem ficar sem problema.
