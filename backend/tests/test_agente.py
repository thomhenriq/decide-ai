"""Testes do laço do agente sem rede: LLM de roteiro + funções do MCP falso chamadas direto.

Rodar na pasta backend: .venv\\Scripts\\python -m pytest -q
"""
import asyncio
import json
import sqlite3

from app import banco, config, sessoes
from app.agente import Agente, FiltroPensamento
from app.llm_fake import LLMFake
from mock_ifood import server as mock


class HubLocal:
    """Faz o papel do HubMCP chamando as funções do mock direto."""

    ferramentas: list = []
    _funcoes = {
        "searchOffers": mock.search_offers,
        "createCart": mock.create_cart,
        "addItemToCart": mock.add_item_to_cart,
        "getCart": mock.get_cart,
        "submitOrder": mock.submit_order,
    }

    def __init__(self):
        self.chamadas: list[str] = []
        self.args: dict[str, dict] = {}

    def propriedades(self, nome):
        return {"cartId": {}, "userConsent": {}} if nome == "submitOrder" else {}

    async def chamar(self, nome, args):
        self.chamadas.append(nome)
        self.args[nome] = args
        return json.dumps(self._funcoes[nome](**args), ensure_ascii=False), False


class LLMQuebrado:
    async def gerar(self, *_):
        raise RuntimeError("bedrock fora do ar")
        yield  # pragma: no cover


async def _coletar(gerador):
    return [e async for e in gerador]


def _texto(eventos):
    return "".join(e["texto"] for e in eventos if e["type"] == "delta")


def _alterna(mensagens):
    papeis = [m["role"] for m in mensagens]
    return all(a != b for a, b in zip(papeis, papeis[1:]))


def test_filtro_pensamento_em_pedacos():
    filtro = FiltroPensamento()
    texto = "<thinking>plano interno</thinking>Oi! Achei <b>3</b> opções <thin"
    saida = "".join(filtro.filtrar(texto[i : i + 3]) for i in range(0, len(texto), 3)) + filtro.finalizar()
    assert saida == "Oi! Achei <b>3</b> opções <thin"


def test_fluxo_busca_carrinho_e_confirmacao(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eventos.db")
    banco.iniciar()
    hub = HubLocal()
    agente = Agente(LLMFake(), hub)
    sessao = sessoes.Sessao(id="teste-fluxo-1")

    async def rodar():
        ev1 = await _coletar(agente.responder(sessao, [{"text": "quero um smash com bacon"}]))
        opcoes = next(e for e in ev1 if e["type"] == "opcoes")["opcoes"]
        assert [o["papel"] for o in opcoes] == ["mais_parecida", "mais_barata", "mais_rapida"]
        assert opcoes[0]["nome"] == "Smash bacon cheddar"

        escolha = f"Quero essa: {opcoes[0]['nome']} ({opcoes[0]['restaurante']})"
        ev2 = await _coletar(agente.responder(sessao, [{"text": escolha}]))
        assert ev2[-2] == {"type": "confirmacao"}  # o botão aparece no fim do turno
        assert "submitOrder" not in hub.chamadas  # nada sai sem o toque no botão
        assert "Total R$" in _texto(ev2)

        ev3 = await _coletar(agente.responder(sessao, None, confirmar=True))
        assert hub.chamadas.count("submitOrder") == 1
        assert hub.args["submitOrder"]["userConsent"] is True
        assert "enviado" in _texto(ev3)

        ev4 = await _coletar(agente.responder(sessao, None, confirmar=True))
        assert ev4[0]["type"] == "erro"  # aprovação vale uma vez só
        assert hub.chamadas.count("submitOrder") == 1

        for e in ev1 + ev2 + ev3:
            if e["type"] == "delta":
                assert "thinking" not in e["texto"]
        assert _alterna(sessao.mensagens)

    asyncio.run(rodar())


def test_mensagem_nova_invalida_confirmacao_antiga(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eventos.db")
    banco.iniciar()
    hub = HubLocal()
    agente = Agente(LLMFake(), hub)
    sessao = sessoes.Sessao(id="teste-fluxo-2")

    async def rodar():
        await _coletar(agente.responder(sessao, [{"text": "quero pizza"}]))
        await _coletar(agente.responder(sessao, [{"text": "Quero essa: Pizza margherita média"}]))
        assert sessao.pendente is not None
        await _coletar(agente.responder(sessao, [{"text": "quero temaki"}]))
        ev = await _coletar(agente.responder(sessao, None, confirmar=True))
        assert ev[0]["type"] == "erro"
        assert "submitOrder" not in hub.chamadas

    asyncio.run(rodar())


def test_sem_resultado_vira_evento_de_demanda(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eventos.db")
    banco.iniciar()
    agente = Agente(LLMFake(), HubLocal())
    sessao = sessoes.Sessao(id="teste-demanda")

    eventos = asyncio.run(_coletar(agente.responder(sessao, [{"text": "quero acarajé"}])))
    assert "demanda" in _texto(eventos)
    with sqlite3.connect(config.DB_PATH) as con:
        tipo, desejo, sessao_salva = con.execute("SELECT tipo, desejo_json, sessao FROM eventos").fetchone()
    assert tipo == "demanda_nao_atendida"
    assert "acaraj" in desejo
    assert sessao_salva != "teste-demanda"  # só o hash, nunca o id


def test_erro_do_llm_desfaz_o_turno():
    agente = Agente(LLMQuebrado(), HubLocal())
    sessao = sessoes.Sessao(id="teste-erro-1")
    eventos = asyncio.run(_coletar(agente.responder(sessao, [{"text": "oi"}])))
    assert [e["type"] for e in eventos] == ["erro", "fim"]
    assert sessao.mensagens == []
