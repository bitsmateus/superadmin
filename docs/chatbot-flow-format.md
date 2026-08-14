# Formato do JSON de fluxo do chatbot (NX)

Contrato do arquivo que a ferramenta do chatbot importa/exporta. O builder
determinístico (`server/src/lib/flowBuilder.ts`) emite exatamente este formato a
partir de um **FlowSpec** (`src/types/chatbotFlow.ts`). A IA nunca gera este JSON
direto — só o FlowSpec.

## Estrutura raiz

```jsonc
{
  "name": "Nome do fluxo",
  "nodeList": [ /* nós */ ],
  "lineList": [ /* setas do canvas */ ]
}
```

## Nós obrigatórios

Todo fluxo começa com dois nós fixos: `start` e `configurations`.

```jsonc
{ "id": "start", "name": "Início", "type": "start", "left": "26px", "top": "100px",
  "ico": "mdi-play", "viewOnly": true, "status": "success", "style": {} }
```

```jsonc
{ "id": "configurations", "name": "Configurações", "type": "configurations",
  "left": "340px", "top": "100px", "viewOnly": true, "ico": "mdi-alert-circle-outline",
  "configurations": {
    "notOptionsSelectMessage": { "message": "", "stepReturn": "A" },
    "notResponseMessage": { "time": 10, "type": 1, "destiny": "", "message": "" },
    "welcomeMessage": { "message": "" },
    "farewellMessage": { "message": "" },
    "maxRetryBotMessage": { "number": 3, "type": 1, "destiny": "" },
    "outOpenHours": { "type": 1, "destiny": null },
    "firstInteraction": { "type": 1, "destiny": null },
    "keyword": { "message": "", "messages": [] }
  } }
```

O primeiro nó de conversa tem, por convenção, `id: "nodeC"` e é o alvo da linha
`start → nodeC`.

## Nó de passo (`type: "node"`)

```jsonc
{ "id": "node-...", "name": "Rótulo no canvas (não vai pro cliente)", "type": "node",
  "left": "1620px", "top": "-200px", "ico": "mdi-robot-outline",
  "interactions": [ /* exatamente 1 item */ ],
  "conditions": [ /* saídas do nó */ ], "actions": [] }
```

## Tipos de interação

**`MessageField`** — mensagem simples / pergunta aberta:
```jsonc
{ "id": "int-...", "type": "MessageField", "data": { "message": "Digite o CNPJ/CPF:" } }
```

**`ButtonField`** — até 3 botões (`button3` opcional; `footerText` opcional):
```jsonc
{ "id": "int-...", "type": "ButtonField",
  "data": { "message": "Selecione:", "button1": "Nova compra", "button2": "Já realizada" } }
```

**`ListField`** — lista (usar quando houver mais de 3 opções):
```jsonc
{ "id": "int-...", "type": "ListField",
  "data": { "message": "Selecione na lista:",
    "sections": [ { "title": "Ímãs", "rows": [ { "title": "Neodímio", "desc": "Terras raras" } ] } ],
    "choices": [] } }
```

## Condições (saídas do nó)

Resposta esperada (botão/linha da lista):
```jsonc
{ "id": "cond-...", "action": 0, "nextStepId": "node-...", "type": "R",
  "comparisonType": "equals", "condition": ["Neodímio"], "value": "Neodímio" }
```
Quando várias opções vão para o mesmo destino, agrupa-se numa condição:
`"condition": ["Sim","Não"], "value": "Sim,Não"`.

Texto livre (qualquer resposta segue adiante):
```jsonc
{ "id": "cond-...", "action": 0, "nextStepId": "node-...", "type": "US",
  "comparisonType": "", "condition": [], "value": "" }
```

Transferir para fila/setor:
```jsonc
{ "id": "cond-...", "action": 1, "nextStepId": "", "queueId": "312", "type": "R",
  "comparisonType": "equals", "condition": ["Falar com atendente"], "value": "Falar com atendente" }
```

Nó final (encerramento): `"conditions": []`.

## Linhas (`lineList`)

Uma entrada por par origem→destino; valores concatenados por vírgula no `label`.
A linha `start → nodeC` não tem `label`.
```jsonc
{ "from": "node-A", "to": "node-B", "label": "Neodímio,Ferrite",
  "paintStyle": { "strokeWidth": 3, "stroke": "#5c67f2" } }
```

## Limites do WhatsApp (validados sempre)

| Elemento | Limite |
|---|---|
| Botões por mensagem | 3 |
| Texto do botão | 20 |
| Linhas por lista (total) | 10 |
| Título da seção | 24 |
| Título da linha | 24 |
| Descrição da linha | 72 |
| Corpo da mensagem | 1024 |

Regra prática: **≤ 3 opções → `ButtonField`; 4 a 10 → `ListField`; mais de 10 →
quebrar em submenus.** **Em canal API Oficial, preferir botões** (quebrar em
submenus de ≤3 quando fizer sentido, em vez de lista).

## Endpoint de importação no tenant

Ainda **não mapeado** neste repositório. O publish usa a env
`CHATBOT_FLOW_IMPORT_PATH` (ex.: `/v2/api/external/{apiId}/importFlow`); sem ela,
o endpoint responde 501 e o download segue funcionando.

## Arquivos de referência

`docs/examples/` — colocar os fluxos reais completos em **UTF-8** (koimas,
Padrão, Heliton). Usados como few-shot da IA e referência de forma. Ver o
README da pasta.
