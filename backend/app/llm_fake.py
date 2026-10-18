"""LLM de roteiro fixo, só para desenvolver o chat sem AWS (LLM_PROVEDOR=fake).

Não é inteligente: segue um roteiro em cima do MCP falso (mock_ifood) para exercitar
o fluxo inteiro — status, cartões, recusa com motivo, carrinho e botão de confirmação.
"""
import asyncio
import json
import uuid
from collections.abc import AsyncIterator


def _textos(msg: dict) -> str:
    return " ".join(b.get("text", "") for b in msg["content"] if "text" in b)


def _usos(msg: dict) -> list[dict]:
    return [b["toolUse"] for b in msg["content"] if "toolUse" in b]


def _resultado(msg: dict) -> dict:
    for b in msg["content"]:
        if "toolResult" in b:
            texto = b["toolResult"]["content"][0]["text"]
            try:
                return json.loads(texto.removeprefix("ERRO: "))
            except json.JSONDecodeError:
                return {"texto": texto}
    return {}


def _papeis(itens: list[dict]) -> list[dict]:
    restantes = list(itens)
    escolhidas = []
    for papel, chave in (("mais_parecida", None), ("mais_barata", "preco"), ("mais_rapida", "eta_min")):
        if not restantes:
            break
        item = restantes[0] if chave is None else min(restantes, key=lambda i: i[chave])
        restantes.remove(item)
        escolhidas.append({
            "papel": papel, "item_id": item["item_id"], "merchant_id": item["merchant_id"],
            "nome": item["nome"], "restaurante": item["restaurante"], "preco": item["preco"],
            "taxa_entrega": item["taxa_entrega"], "eta_min": item["eta_min"],
            "observacao": item["descricao"],
        })
    return escolhidas


class LLMFake:
    async def gerar(self, sistema: str, mensagens: list, ferramentas: list) -> AsyncIterator[dict]:
        texto, uso = self._decidir(mensagens)
        conteudo = []
        if texto:
            conteudo.append({"text": texto})
            for i in range(0, len(texto), 12):
                await asyncio.sleep(0.02)
                yield {"tipo": "texto", "texto": texto[i : i + 12]}
        if uso:
            await asyncio.sleep(0.3)
            conteudo.append({"toolUse": {"toolUseId": uuid.uuid4().hex[:12], **uso}})
        yield {
            "tipo": "fim",
            "mensagem": {"role": "assistant", "content": conteudo or [{"text": "..."}]},
            "parada": "tool_use" if uso else "end_turn",
        }

    def _decidir(self, mensagens: list) -> tuple[str, dict | None]:
        ultima = mensagens[-1]
        if any("toolResult" in b for b in ultima["content"]):
            anterior = _usos(mensagens[-2])[0]
            return self._depois_da_tool(anterior, _resultado(ultima), mensagens)

        pedido = _textos(ultima).replace("[áudio transcrito]", "").strip()
        if pedido.startswith("[Confirmação pelo botão"):
            return "Pedido enviado! ✅ Te aviso quando sair para entrega.", None
        if pedido.startswith("Quero essa:"):
            opcao = self._opcao_escolhida(pedido, mensagens)
            if opcao:
                return "<thinking>montar carrinho</thinking>Boa escolha! Vou montar o carrinho.", {
                    "name": "createCart", "input": {"merchant_id": opcao["merchant_id"]}}
        if pedido.startswith("Nenhuma dessas"):
            motivo = pedido.split(":", 1)[-1].strip() or "outro"
            return "", {"name": "registrar_evento", "input": {
                "tipo": "recusa", "desejo": {"texto": self._ultimo_desejo(mensagens)}, "motivo": motivo}}
        if any("image" in b for b in ultima["content"]):
            pedido = "smash bacon cheddar"
            return "(modo fake: vou fingir que a foto é um smash burger) ", {
                "name": "searchOffers", "input": {"query": pedido}}
        return "<thinking>buscar no catálogo</thinking>", {"name": "searchOffers", "input": {"query": pedido}}

    def _depois_da_tool(self, uso: dict, resultado: dict, mensagens: list) -> tuple[str, dict | None]:
        nome = uso["name"]
        if nome == "searchOffers":
            itens = resultado.get("itens", [])
            if itens:
                return "", {"name": "mostrar_opcoes", "input": {"opcoes": _papeis(itens)}}
            return "", {"name": "registrar_evento", "input": {
                "tipo": "demanda_nao_atendida", "desejo": {"texto": uso["input"].get("query")},
                "motivo": "sem_resultado", "cidade": "São Carlos"}}
        if nome == "mostrar_opcoes":
            n = len(uso["input"]["opcoes"])
            return ("Separei essas opções pra você. Qual vai ser?" if n > 1 else "Achei essa. Bora?"), None
        if nome == "registrar_evento":
            if uso["input"]["tipo"] == "recusa":
                return "Entendi, anotei o motivo. Me diz o que mudar que eu busco de novo.", None
            return ("Não achei nada parecido entregando aqui agora. Anotei esse desejo: ele vira "
                    "sinal de demanda para os restaurantes da região. Quer tentar outra coisa?"), None
        if nome == "createCart":
            opcao = self._opcao_escolhida(_textos(self._ultima_fala(mensagens)), mensagens)
            return "", {"name": "addItemToCart", "input": {
                "cartId": resultado["cartId"], "item_id": opcao["item_id"], "quantity": 1}}
        if nome == "addItemToCart":
            return "", {"name": "getCart", "input": {"cartId": uso["input"]["cartId"]}}
        if nome == "getCart":
            c = resultado
            resumo = (f"Resumo do pedido:\n- {c['itens'][0]['nome']} ({c['restaurante']})\n"
                      f"- Subtotal R$ {c['subtotal']:.2f} + entrega R$ {c['entrega']:.2f} + serviço R$ {c['servico']:.2f}\n"
                      f"- **Total R$ {c['total']:.2f}** · Pix · chega em ~{c['eta_min']} min")
            return resumo, {"name": "submitOrder", "input": {"cartId": c["cartId"], "userConsent": True}}
        if nome == "submitOrder":
            return "Se estiver tudo certo, toque em **Confirmar pedido**.", None
        return "Pronto.", None

    @staticmethod
    def _ultima_fala(mensagens: list) -> dict:
        for m in reversed(mensagens):
            if m["role"] == "user" and any("text" in b for b in m["content"]):
                return m
        return mensagens[-1]

    @staticmethod
    def _ultimo_desejo(mensagens: list) -> str:
        for m in reversed(mensagens):
            for u in _usos(m) if m["role"] == "assistant" else []:
                if u["name"] == "searchOffers":
                    return u["input"].get("query", "")
        return ""

    @staticmethod
    def _opcao_escolhida(pedido: str, mensagens: list) -> dict | None:
        for m in reversed(mensagens):
            for u in _usos(m) if m["role"] == "assistant" else []:
                if u["name"] == "mostrar_opcoes":
                    for o in u["input"]["opcoes"]:
                        if o["nome"] in pedido:
                            return o
                    return u["input"]["opcoes"][0]
        return None
