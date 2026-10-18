"""API do Decide AI: o webchat React conversa com o agente por aqui (SSE)."""
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import banco, config, sessoes, skills
from .agente import Agente
from .mcp_hub import HubMCP

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

FORMATOS_IMAGEM = {"image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
LIMITE_IMAGEM = 5 * 1024 * 1024


def _criar_llm():
    if config.LLM_PROVEDOR == "fake":
        from .llm_fake import LLMFake
        return LLMFake()
    from .llm import LLMBedrock
    return LLMBedrock(config.BEDROCK_MODEL_ID, config.AWS_REGION, config.MAX_TOKENS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    banco.iniciar()
    hub = HubMCP()
    await hub.conectar(config.SERVIDORES_MCP)
    app.state.agente = Agente(_criar_llm(), hub)
    yield
    await hub.fechar()


app = FastAPI(title="Decide AI", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.get("/api/saude")
async def saude(request: Request):
    hub = request.app.state.agente.hub
    return {
        "ok": True,
        "llm": config.LLM_PROVEDOR,
        "modelo": config.BEDROCK_MODEL_ID if config.LLM_PROVEDOR == "bedrock" else "roteiro fixo",
        "mcp_conectados": hub.servidores_ok,
        "mcp_falhas": hub.servidores_falha,
        "tools_mcp": len(hub.ferramentas),
        "skills": [s.nome for s in skills.carregar()],
    }


@app.post("/api/chat")
async def chat(
    request: Request,
    sessao_id: str = Form(...),
    texto: str = Form(""),
    origem: str = Form("texto"),
    acao: str = Form(""),
    imagem: UploadFile | None = File(None),
):
    if not sessoes.id_valido(sessao_id):
        raise HTTPException(400, "sessao_id inválido")
    sessao = sessoes.obter(sessao_id)
    confirmar = acao == "confirmar_pedido"

    conteudo: list[dict] = []
    if not confirmar:
        if imagem is not None:
            formato = FORMATOS_IMAGEM.get(imagem.content_type or "")
            if not formato:
                raise HTTPException(415, "Envie a imagem em JPG, PNG, WEBP ou GIF")
            dados = await imagem.read()
            if len(dados) > LIMITE_IMAGEM:
                raise HTTPException(413, "Imagem muito grande (máx. 5 MB)")
            conteudo.append({"image": {"format": formato, "source": {"bytes": dados}}})
        texto = texto.strip()[:2000]
        if origem == "audio" and texto:
            texto = f"[áudio transcrito] {texto}"
        if not texto and imagem is not None:
            texto = "Quero pedir algo parecido com esta imagem."
        if not texto:
            raise HTTPException(400, "Mensagem vazia")
        conteudo.append({"text": texto})
        sessao.ultima_origem = "imagem" if imagem is not None else ("audio" if origem == "audio" else "texto")

    agente: Agente = request.app.state.agente

    async def fluxo():
        async for ev in agente.responder(sessao, conteudo, confirmar=confirmar):
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        fluxo(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.delete("/api/sessoes/{sessao_id}")
async def apagar_sessao(sessao_id: str):
    sessoes.apagar(sessao_id)
    return {"ok": True}


# Depois de `npm run build`, o próprio backend serve o webchat: um processo, uma URL para a demo.
# Fica no fim do arquivo para as rotas /api terem prioridade.
_WEB_DIST = config.RAIZ.parent / "web" / "dist"
if _WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=_WEB_DIST, html=True), name="web")
