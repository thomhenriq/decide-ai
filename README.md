# Decide AI

Agente de pedidos para o hackathon iFood + SEMCOMP/USP São Carlos. A pessoa pede por texto, áudio ou foto, o agente usa o MCP do iFood para achar opções e montar o carrinho, e o pedido só sai quando ela toca em **Confirmar pedido**. Buscas sem opção boa e motivos de recusa viram eventos anônimos de demanda.

Pastas do repositório:

- `backend/`: o agente (Python, FastAPI, Nova Pro e MCP).
- `web/`: o webchat React que conversa com esse backend.
- `chat/`: o webchat que já estava na `main`. Ele tem o gancho `onMessageSent` em `chat/src/services/agent.ts` e pode ser ligado no mesmo `POST /api/chat` (contrato abaixo).

## Como funciona

```
 Webchat React (web/)                     Backend Python (backend/)                         Fora
 ─────────────────────                    ─────────────────────────                         ────
 texto / áudio (Web Speech, pt-BR)  ──►   POST /api/chat  (multipart)
 foto ou print (reduzida p/ 1280px)       │
                                          ▼
                                          agente.py ── laço: Nova Pro decide → tools executam
 ◄── SSE: status, delta, opcoes,          │   ├── prompt = prompts/agente.md + skills/*.md (relidos a cada mensagem)
         confirmacao, erro, fim           │   ├── tools do MCP ───────────────────────────────► MCP do iFood (4 servidores)
                                          │   ├── mostrar_opcoes  → fichas no chat
 Fichas  ("Quero essa" / "Nenhuma         │   ├── registrar_evento → data/eventos.db (SQLite) ─► painel de demanda
          dessas" + motivo)               │   └── submitOrder fica PRESO até o botão
 Comanda ("Confirmar pedido")  ──────►    acao=confirmar_pedido → executa exatamente o que foi aprovado
```

Mapa com o fluxograma do time:

| Etapa | Skill do doc | Onde está no código |
|---|---|---|
| ALVO | 1. preparar_contexto | skill `.md` (tools `getUser`, `listAddresses`) |
| INPUT | 2. traduzir_desejo | imagem e áudio chegam pelo `/api/chat`; a skill define o JSON de desejo |
| DESCOBERTA | 3. descobrir_opcoes | skill `.md` + tool nossa `mostrar_opcoes` (fichas com papel) |
| VALIDAR PROPOSTA | 4. montar_proposta | skill `.md`; recusa com motivo vem dos botões "Nenhuma dessas" |
| CHECKOUT | 5. fechar_pedido | `submitOrder` só roda pelo botão (trava no `agente.py`) |
| Popular base | 8. registrar_evento | tool nossa `registrar_evento` → SQLite |

## Rodar (Windows / PowerShell)

Três terminais, todos abertos na raiz do repositório. Primeira vez:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
cd ..\web
npm install
```

Depois, sempre:

```powershell
# 1. MCP falso (só enquanto não usam o real)
cd backend; .venv\Scripts\python -m mock_ifood.server

# 2. Backend
cd backend; .venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

# 3. Webchat em modo dev (http://localhost:5173)
cd web; npm run dev
```

Testes do agente: `cd backend; .venv\Scripts\python -m pytest -q`

## Ligar no Nova Pro e no MCP real

1. **Nova Pro**: no `.env`, `LLM_PROVEDOR=bedrock`, `AWS_REGION` e credenciais (`AWS_PROFILE` ou chaves). No console da AWS, libere o acesso ao modelo **Amazon Nova Pro** no Bedrock nessa região. O ID padrão é `us.amazon.nova-pro-v1:0` (perfil de inferência dos EUA).
2. **MCP do iFood**: preencha as URLs em `backend/mcp_servers.ifood.json`, ponha `MCP_SERVERS_FILE=mcp_servers.ifood.json` e o token em `IFOOD_MCP_TOKEN`. Se o MCP de vocês usar OAuth em vez de token fixo, o ponto de troca é `HubMCP._conectar_um` em `backend/app/mcp_hub.py`.
3. Abra `http://localhost:8000/api/saude`: precisa mostrar os 4 servidores em `mcp_conectados` e cerca de 24 tools.

O modo `fake` (padrão do `.env.example`) segue um roteiro fixo em cima do MCP falso, para quem estiver no front trabalhar sem gastar AWS. Ele ignora as skills.

## Publicar para a demo

```powershell
cd web; npm run build
cd ..\backend; .venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Com `web/dist` presente, o backend serve o webchat na raiz: um processo, uma URL. Para colocar na internet, rode isso numa máquina com acesso à AWS (EC2, App Runner, Render...) com HTTPS. O microfone do navegador só funciona em `https` ou `localhost`.

## Contrato do chat (para outros canais)

`POST /api/chat` (multipart): `sessao_id`, `texto`, `origem` (`texto` | `audio`), `imagem` (arquivo, opcional), `acao` (`confirmar_pedido`, opcional). A resposta é um stream SSE com eventos JSON:

| `type` | Campos | O que a interface faz |
|---|---|---|
| `status` | `texto`, `ferramenta` | mostra "Buscando no iFood..." |
| `delta` | `texto` | escreve a resposta aos poucos |
| `opcoes` | `opcoes[]` | desenha as fichas |
| `confirmacao` | | desenha a comanda com o botão |
| `erro` | `mensagem` | mostra o erro |
| `fim` | | libera o campo de mensagem |

Um canal de WhatsApp pode usar o mesmo endpoint: junta os `delta`, manda as `opcoes` como lista interativa e a `confirmacao` como botão de resposta.

## Decisões e limites

- **Áudio**: transcrito no navegador (Web Speech API, Chrome e Edge) e enviado como `[áudio transcrito]`. O Nova Pro não recebe áudio. No WhatsApp o áudio chega como arquivo; aí vale o Amazon Transcribe no backend.
- **Humano aprova**: o modelo pode chamar `submitOrder`, mas o backend não executa; guarda a chamada e mostra a comanda. O botão executa exatamente o que foi aprovado, uma vez só. Qualquer mensagem nova invalida a comanda antiga.
- **`<thinking>`**: o Nova escreve raciocínio entre essas tags antes de chamar tools. Fica no histórico e é filtrado da tela.
- **Sessões em memória**: reiniciou o backend, zerou as conversas. Suficiente para a demo.
- **Banco de demanda**: só guarda dado anônimo (hash da sessão, desejo, motivo, bairro, hora). Como é SQLite local, dá para o painel do restaurante ler ao vivo.
