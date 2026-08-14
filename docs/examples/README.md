# Fluxos de referência (few-shot da IA)

Coloque aqui os fluxos reais **em UTF-8**, exportados da ferramenta do chatbot:

- `koimas-flow.json` — fluxo completo (boas-vindas com botões, menu em lista com
  seções, ramificações, coleta de texto e encerramento). É o *golden* de forma.
- `padrao-flow.json` — fluxo mínimo com transferência para fila (`action: 1`).
- `heliton-flow.json` — botões com `button3` + `footerText`, condições mistas.

> ⚠️ **Encoding:** os arquivos enviados no chat vieram com encoding corrompido
> (mojibake: "Ã­" em vez de "í", emojis viram "ð"). **Salve os originais em
> UTF-8** — a camada de IA (Bloco 2) usa estes arquivos como few-shot, e exemplos
> com encoding quebrado ensinariam o modelo a produzir texto corrompido.

Os testes do builder/validador **não** dependem destes arquivos (usam uma
fixture em código), então nada fica bloqueado até você colocá-los.
