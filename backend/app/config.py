"""Configuração lida do .env (backend/.env)."""
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent  # pasta backend/
load_dotenv(RAIZ / ".env")


@dataclass(frozen=True)
class ServidorMCP:
    nome: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)


def _ler_servidores_mcp() -> list[ServidorMCP]:
    caminho = RAIZ / os.getenv("MCP_SERVERS_FILE", "mcp_servers.json")
    if not caminho.exists():
        return []
    bruto = json.loads(caminho.read_text(encoding="utf-8"))
    return [
        ServidorMCP(
            nome=s["nome"],
            url=os.path.expandvars(s["url"]),
            headers={k: os.path.expandvars(v) for k, v in s.get("headers", {}).items()},
        )
        for s in bruto
    ]


LLM_PROVEDOR = os.getenv("LLM_PROVEDOR", "bedrock")  # bedrock | fake
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "1500"))

MAX_PASSOS = int(os.getenv("MAX_PASSOS", "12"))
LIMITE_RESULTADO_TOOL = int(os.getenv("LIMITE_RESULTADO_TOOL", "12000"))

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
DB_PATH = RAIZ / os.getenv("DB_PATH", "data/eventos.db")
PASTA_SKILLS = RAIZ / "skills"
PROMPT_BASE = RAIZ / "prompts" / "agente.md"
SERVIDORES_MCP = _ler_servidores_mcp()

# Tools que só rodam depois do toque em "Confirmar pedido" no chat (humano aprova).
FERRAMENTAS_COM_APROVACAO = {"submitOrder"}
