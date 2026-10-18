"""MCP falso com nomes de tools do iFood, para desenvolver sem a conta real.

Rodar: python -m mock_ifood.server  (fica em http://127.0.0.1:8765/mcp)

Atenção: os NOMES seguem o MCP do iFood, mas parâmetros e respostas são inventados.
Restaurantes e pratos são fictícios. Escrevam as skills olhando o schema REAL.
"""
import itertools
import unicodedata

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("ifood-mock", host="127.0.0.1", port=8765)

ENDERECO = {
    "id": "end-1", "rotulo": "Casa", "rua": "Rua Episcopal, 1000", "bairro": "Centro",
    "cidade": "São Carlos", "uf": "SP", "latitude": -22.0154, "longitude": -47.8911,
}

RESTAURANTES = {
    "m1": "Smash Lab (mock)", "m2": "Burger do Campus (mock)", "m3": "Raiz Vegana (mock)",
    "m4": "Forno Trento (mock)", "m5": "Temaki Já (mock)",
}

ITENS = [
    {"item_id": "i1", "merchant_id": "m1", "nome": "Smash bacon cheddar", "preco": 34.9, "taxa_entrega": 4.99, "eta_min": 28,
     "descricao": "Dois smashes de 80 g, cheddar, bacon crocante e pão brioche", "tags": "hamburguer burger smash bacon cheddar lanche"},
    {"item_id": "i2", "merchant_id": "m2", "nome": "X-bacon da casa", "preco": 27.5, "taxa_entrega": 6.5, "eta_min": 35,
     "descricao": "Hambúrguer de 150 g, bacon, queijo prato, alface e tomate", "tags": "hamburguer burger x-bacon xbacon bacon lanche"},
    {"item_id": "i3", "merchant_id": "m1", "nome": "Smash duplo clássico", "preco": 29.9, "taxa_entrega": 4.99, "eta_min": 28,
     "descricao": "Dois smashes, queijo americano, picles e molho da casa", "tags": "hamburguer burger smash lanche"},
    {"item_id": "i4", "merchant_id": "m3", "nome": "Bowl de grão-de-bico", "preco": 32.0, "taxa_entrega": 3.0, "eta_min": 22,
     "descricao": "Grão-de-bico assado, quinoa, legumes e molho tahine", "tags": "vegano vegana bowl saudavel salada"},
    {"item_id": "i5", "merchant_id": "m3", "nome": "Burger de cogumelos", "preco": 36.0, "taxa_entrega": 3.0, "eta_min": 22,
     "descricao": "Hambúrguer vegano de cogumelos, maionese de castanha e rúcula", "tags": "vegano vegana hamburguer burger"},
    {"item_id": "i6", "merchant_id": "m4", "nome": "Pizza margherita média", "preco": 49.9, "taxa_entrega": 7.0, "eta_min": 45,
     "descricao": "Molho de tomate, muçarela e manjericão", "tags": "pizza margherita queijo"},
    {"item_id": "i7", "merchant_id": "m5", "nome": "Temaki salmão completo", "preco": 31.9, "taxa_entrega": 5.5, "eta_min": 40,
     "descricao": "Salmão, cream cheese e cebolinha", "tags": "japonesa temaki salmao sushi"},
    {"item_id": "i8", "merchant_id": "m4", "nome": "Pizza vegana de abobrinha", "preco": 54.0, "taxa_entrega": 7.0, "eta_min": 45,
     "descricao": "Abobrinha, tomate-cereja e queijo de castanha", "tags": "pizza vegana vegano"},
]
for _item in ITENS:
    _item["restaurante"] = RESTAURANTES[_item["merchant_id"]]

CARRINHOS: dict[str, dict] = {}
_seq = itertools.count(1)


def _normalizar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return sem_acento.lower()


def _publico(item: dict) -> dict:
    return {k: v for k, v in item.items() if k != "tags"}


@mcp.tool(name="listAddresses", description="Lista os endereços salvos do usuário. Primeiro passo de todo pedido.")
def list_addresses() -> dict:
    return {"enderecos": [ENDERECO]}


@mcp.tool(name="searchOffers", description="Busca itens por texto perto do endereço, com preço máximo opcional.")
def search_offers(query: str, maxPrice: float | None = None) -> dict:
    termos = [t for t in _normalizar(query).replace(",", " ").replace("-", " ").split() if len(t) > 2]
    achados = []
    for item in ITENS:
        alvo = _normalizar(f"{item['nome']} {item['descricao']} {item['tags']}")
        pontos = sum(1 for t in termos if t in alvo)
        if pontos and (maxPrice is None or item["preco"] <= maxPrice):
            achados.append((pontos, item))
    achados.sort(key=lambda p: (-p[0], p[1]["preco"]))
    return {"itens": [_publico(i) for _, i in achados[:5]], "total": len(achados)}


@mcp.tool(name="getItem", description="Detalhes de um item.")
def get_item(item_id: str) -> dict:
    item = next((i for i in ITENS if i["item_id"] == item_id), None)
    return _publico(item) if item else {"erro": "item não encontrado"}


@mcp.tool(name="createCart", description="Cria um carrinho vazio num restaurante.")
def create_cart(merchant_id: str) -> dict:
    cart_id = f"c{next(_seq)}"
    CARRINHOS[cart_id] = {"cartId": cart_id, "merchant_id": merchant_id, "itens": []}
    return {"cartId": cart_id}


@mcp.tool(name="addItemToCart", description="Adiciona um item ao carrinho.")
def add_item_to_cart(cartId: str, item_id: str, quantity: int = 1, observacao: str | None = None) -> dict:
    item = next(i for i in ITENS if i["item_id"] == item_id)
    CARRINHOS[cartId]["itens"].append({**_publico(item), "quantidade": quantity, "observacao": observacao})
    return {"ok": True}


@mcp.tool(name="getCart", description="Mostra o carrinho com subtotal, taxas e total final.")
def get_cart(cartId: str) -> dict:
    c = CARRINHOS[cartId]
    subtotal = sum(i["preco"] * i["quantidade"] for i in c["itens"])
    entrega = c["itens"][0]["taxa_entrega"] if c["itens"] else 0.0
    servico = 0.99
    return {
        "cartId": cartId, "restaurante": RESTAURANTES[c["merchant_id"]], "itens": c["itens"],
        "subtotal": round(subtotal, 2), "entrega": entrega, "servico": servico,
        "total": round(subtotal + entrega + servico, 2),
        "eta_min": c["itens"][0]["eta_min"] if c["itens"] else None,
    }


@mcp.tool(name="submitOrder", description="Envia o pedido. Exige userConsent=true depois de um sim explícito.")
def submit_order(cartId: str, userConsent: bool) -> dict:
    if not userConsent:
        return {"erro": "userConsent precisa ser true"}
    return {"orderId": f"pedido-{cartId}", "status": "CONFIRMED", "mensagem": "Pedido recebido pelo restaurante (mock)"}


@mcp.tool(name="trackOrder", description="Status atual do pedido.")
def track_order(orderId: str) -> dict:
    return {"orderId": orderId, "status": "PREPARING", "eta_min": 25}


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
