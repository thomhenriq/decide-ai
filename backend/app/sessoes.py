"""Sessões de conversa em memória (suficiente para o hackathon: reiniciou o backend, zerou)."""
import asyncio
import re
from dataclasses import dataclass, field

_ID_VALIDO = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


@dataclass
class Sessao:
    id: str
    mensagens: list = field(default_factory=list)  # histórico no formato do Bedrock Converse
    trava: asyncio.Lock = field(default_factory=asyncio.Lock)
    pendente: dict | None = None  # tool aguardando o toque em "Confirmar pedido"
    ultima_origem: str = "texto"  # texto | audio | imagem


_SESSOES: dict[str, Sessao] = {}


def id_valido(sessao_id: str) -> bool:
    return bool(_ID_VALIDO.match(sessao_id))


def obter(sessao_id: str) -> Sessao:
    if sessao_id not in _SESSOES:
        _SESSOES[sessao_id] = Sessao(id=sessao_id)
    return _SESSOES[sessao_id]


def apagar(sessao_id: str) -> None:
    _SESSOES.pop(sessao_id, None)
