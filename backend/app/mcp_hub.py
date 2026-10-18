"""Conecta nos servidores MCP (iFood real ou mock), lista as tools e roteia as chamadas."""
import json
import logging
from contextlib import AsyncExitStack

import anyio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from .config import ServidorMCP

log = logging.getLogger(__name__)


class HubMCP:
    def __init__(self):
        self._pilha = AsyncExitStack()
        self._sessoes: dict[str, ClientSession] = {}  # nome da tool -> sessão do servidor dono
        self._schemas: dict[str, dict] = {}
        self.ferramentas: list[dict] = []  # já no formato toolSpec do Bedrock
        self.servidores_ok: list[str] = []
        self.servidores_falha: dict[str, str] = {}

    async def conectar(self, servidores: list[ServidorMCP]) -> None:
        for s in servidores:
            try:
                await self._conectar_um(s)
                self.servidores_ok.append(s.nome)
            except BaseException as e:  # anyio pode levantar ExceptionGroup
                if isinstance(e, (KeyboardInterrupt, SystemExit)):
                    raise
                log.error("MCP %s indisponível: %r", s.nome, e)
                self.servidores_falha[s.nome] = repr(e)[:300]

    async def _conectar_um(self, s: ServidorMCP) -> None:
        pilha = AsyncExitStack()
        try:
            leitura, escrita, _ = await pilha.enter_async_context(
                streamablehttp_client(s.url, headers=s.headers or None)
            )
            sessao = await pilha.enter_async_context(ClientSession(leitura, escrita))
            # o timeout fica só nas chamadas: em volta do enter_async_context ele quebra o cancel scope do anyio
            with anyio.fail_after(20):
                await sessao.initialize()
                tools, cursor = [], None
                while True:
                    pagina = await sessao.list_tools(cursor=cursor) if cursor else await sessao.list_tools()
                    tools += pagina.tools
                    cursor = pagina.nextCursor
                    if not cursor:
                        break
        except BaseException:
            try:
                await pilha.aclose()
            except BaseException:
                pass
            raise
        await self._pilha.enter_async_context(pilha)

        for t in tools:
            if t.name in self._sessoes:
                log.warning("Tool %s repetida em %s; mantendo a primeira", t.name, s.nome)
                continue
            schema = dict(t.inputSchema or {})
            schema.pop("$schema", None)
            schema.setdefault("type", "object")
            schema.setdefault("properties", {})
            self._sessoes[t.name] = sessao
            self._schemas[t.name] = schema
            self.ferramentas.append(
                {"toolSpec": {"name": t.name, "description": t.description or t.name, "inputSchema": {"json": schema}}}
            )
        log.info("MCP %s: %d tools", s.nome, len(tools))

    def propriedades(self, nome: str) -> dict:
        return self._schemas.get(nome, {}).get("properties", {})

    async def chamar(self, nome: str, argumentos: dict) -> tuple[str, bool]:
        """Devolve (texto para o modelo, deu_erro)."""
        sessao = self._sessoes.get(nome)
        if sessao is None:
            return f"Ferramenta desconhecida: {nome}", True
        resultado = await sessao.call_tool(nome, argumentos)
        if resultado.structuredContent is not None:
            texto = json.dumps(resultado.structuredContent, ensure_ascii=False)
        else:
            texto = "\n".join(c.text for c in resultado.content if getattr(c, "type", "") == "text")
        return texto or "(resposta vazia)", bool(resultado.isError)

    async def fechar(self) -> None:
        try:
            await self._pilha.aclose()
        except BaseException as e:
            log.warning("Erro ao fechar conexões MCP: %r", e)
