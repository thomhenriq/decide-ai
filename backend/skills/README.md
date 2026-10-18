# Skills do agente

Cada skill é um arquivo `.md` nesta pasta. O backend relê a pasta a cada mensagem: salvou, a próxima mensagem do chat já usa a versão nova (não precisa reiniciar).

## Regras da pasta

- Um arquivo por skill, com nome `NN_nome.md` (ex.: `01_preparar_contexto.md`).
- Arquivos que começam com `_` são ignorados (ex.: `_modelo.md`).
- Para desligar uma skill sem apagar, use `ativa: false` no cabeçalho.
- As skills entram no prompt de sistema na ordem do campo `ordem`, depois das regras gerais de `prompts/agente.md`.

## Cabeçalho (frontmatter)

```
---
nome: descobrir_opcoes
etapa: Descoberta
ordem: 3
ativa: true
tools: searchOffers, browseOffers, getRecommendations, getMerchant, getItem, mostrar_opcoes
---
```

## Fluxo de revisão

1. Copie `_modelo.md` para `NN_nome.md` e escreva.
2. Teste no chat com `LLM_PROVEDOR=bedrock` (o modo `fake` ignora as skills).
3. Confira o histórico e o banco (`data/eventos.db`).
4. Revisou? Próxima skill.

Escreva as skills olhando o schema **real** das tools do iFood (aparece em `/api/saude` como contagem e nos logs do backend). O MCP falso (`mock_ifood`) tem parâmetros inventados.
