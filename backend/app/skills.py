"""Carrega as skills (backend/skills/*.md) e monta o prompt de sistema.

Os arquivos são relidos a cada mensagem: editou uma skill, a próxima mensagem já usa a versão nova.
"""
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from . import config
from .banco import FUSO

DIAS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]


@dataclass
class Skill:
    nome: str
    etapa: str
    ordem: int
    tools: str
    corpo: str


def _separar_frontmatter(texto: str) -> tuple[dict, str]:
    if texto.startswith("---"):
        fim = texto.find("\n---", 3)
        if fim != -1:
            meta = {}
            for linha in texto[3:fim].strip().splitlines():
                if ":" in linha:
                    chave, valor = linha.split(":", 1)
                    meta[chave.strip()] = valor.strip().strip("\"'")
            return meta, texto[fim + 4 :].lstrip("\n")
    return {}, texto


def carregar(pasta: Path = config.PASTA_SKILLS) -> list[Skill]:
    skills = []
    for arquivo in sorted(pasta.glob("*.md")):
        if arquivo.name.startswith("_") or arquivo.name.lower() == "readme.md":
            continue
        meta, corpo = _separar_frontmatter(arquivo.read_text(encoding="utf-8-sig"))
        if meta.get("ativa", "true").lower() == "false":
            continue
        skills.append(
            Skill(
                nome=meta.get("nome", arquivo.stem),
                etapa=meta.get("etapa", ""),
                ordem=int(meta.get("ordem", 99)),
                tools=meta.get("tools", ""),
                corpo=corpo.strip(),
            )
        )
    return sorted(skills, key=lambda s: (s.ordem, s.nome))


def montar_prompt_sistema() -> str:
    agora = datetime.now(FUSO)
    partes = [
        config.PROMPT_BASE.read_text(encoding="utf-8-sig").strip(),
        f"# Agora\n{DIAS[agora.weekday()]}, {agora:%d/%m/%Y %H:%M} (horário de Brasília).",
    ]
    skills = carregar()
    if skills:
        partes.append("# Skills\nSiga a skill da etapa em que a conversa está.")
        for s in skills:
            cabecalho = f"## Skill {s.ordem}. {s.nome}" + (f" (etapa: {s.etapa})" if s.etapa else "")
            if s.tools:
                cabecalho += f"\nTools desta skill: {s.tools}"
            partes.append(f"{cabecalho}\n\n{s.corpo}")
    else:
        partes.append("# Skills\nNenhuma skill carregada ainda: siga só as regras acima.")
    return "\n\n".join(partes)
