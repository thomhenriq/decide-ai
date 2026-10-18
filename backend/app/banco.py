"""Banco de eventos de demanda (SQLite). É o que alimenta o painel dos restaurantes.

Só guarda dado anônimo: nada de nome, telefone ou endereço completo (LGPD).
"""
import hashlib
import json
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

from . import config

FUSO = ZoneInfo("America/Sao_Paulo")

_ESQUEMA = """
CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    criado_em TEXT NOT NULL,
    dia_semana INTEGER NOT NULL,
    hora INTEGER NOT NULL,
    sessao TEXT NOT NULL,
    tipo TEXT NOT NULL,
    origem TEXT,
    categoria_id TEXT,
    match_score REAL,
    motivo TEXT,
    item_escolhido TEXT,
    cidade TEXT,
    bairro TEXT,
    desejo_json TEXT NOT NULL
)
"""


def _conectar() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(config.DB_PATH)


def iniciar() -> None:
    with _conectar() as con:
        con.execute(_ESQUEMA)


def registrar(sessao_id: str, origem: str, dados: dict) -> int:
    agora = datetime.now(FUSO)
    with _conectar() as con:
        cur = con.execute(
            "INSERT INTO eventos (criado_em, dia_semana, hora, sessao, tipo, origem, categoria_id, match_score,"
            " motivo, item_escolhido, cidade, bairro, desejo_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                agora.isoformat(timespec="seconds"),
                agora.weekday(),
                agora.hour,
                hashlib.sha256(sessao_id.encode()).hexdigest()[:16],
                dados.get("tipo", "desconhecido"),
                origem,
                dados.get("categoria_id"),
                dados.get("match_score"),
                dados.get("motivo"),
                dados.get("item_escolhido"),
                dados.get("cidade"),
                dados.get("bairro"),
                json.dumps(dados.get("desejo", {}), ensure_ascii=False),
            ),
        )
        return cur.lastrowid
