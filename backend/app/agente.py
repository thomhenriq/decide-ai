"""O laço do agente: Nova Pro decide, as tools (MCP do iFood + nossas) executam, o chat recebe eventos."""
import json
import logging
from collections.abc import AsyncIterator

from botocore.exceptions import ClientError, NoCredentialsError

from . import config, ferramentas_locais, skills
from .sessoes import Sessao

log = logging.getLogger(__name__)

ROTULOS = {
    "getUser": "Carregando seu perfil",
    "listAddresses": "Conferindo seu endereço",
    "createAddress": "Salvando o endereço",
    "searchOffers": "Buscando no iFood",
    "browseOffers": "Vendo o que tem perto de você",
    "listItemTaxonomy": "Entendendo a categoria",
    "getRecommendations": "Vendo seus favoritos",
    "getMerchant": "Olhando o restaurante",
    "getItem": "Vendo os detalhes do prato",
    "createCart": "Montando o carrinho",
    "addItemToCart": "Colocando no carrinho",
    "updateCartItem": "Ajustando o item",
    "removeItemFromCart": "Tirando do carrinho",
    "getCart": "Calculando o total",
    "listVouchers": "Procurando cupons",
    "setVoucher": "Aplicando o cupom",
    "getCartDeliveryMethods": "Vendo as formas de entrega",
    "setCartDelivery": "Definindo a entrega",
    "listPaymentMethods": "Vendo as formas de pagamento",
    "setCartPayment": "Definindo o pagamento",
    "submitOrder": "Preparando a confirmação",
    "trackOrder": "Acompanhando o pedido",
    "getOrder": "Consultando o pedido",
    "mostrar_opcoes": "Separando as opções",
}
SILENCIOSAS = {"registrar_evento"}

AVISO_APROVACAO = (
    "AGUARDANDO APROVAÇÃO: o pedido ainda NÃO foi enviado. O chat mostrou o botão \"Confirmar pedido\" "
    "para a pessoa. Se ainda não escreveu, escreva agora o resumo final (itens, total, entrega, pagamento) "
    "e peça para ela tocar no botão. Não chame esta tool de novo; o sistema envia quando ela confirmar."
)


class FiltroPensamento:
    """O Nova escreve <thinking>...</thinking> antes de chamar tools. Isso fica no histórico, não na tela."""

    ABRE, FECHA = "<thinking>", "</thinking>"

    def __init__(self):
        self._buf = ""
        self._dentro = False

    def filtrar(self, pedaco: str) -> str:
        self._buf += pedaco
        saida = []
        while True:
            if self._dentro:
                i = self._buf.find(self.FECHA)
                if i == -1:
                    self._buf = self._buf[-(len(self.FECHA) - 1) :]
                    break
                self._buf = self._buf[i + len(self.FECHA) :]
                self._dentro = False
            else:
                i = self._buf.find(self.ABRE)
                if i == -1:
                    guardar = _prefixo_parcial(self._buf, self.ABRE)
                    saida.append(self._buf[: len(self._buf) - guardar])
                    self._buf = self._buf[len(self._buf) - guardar :]
                    break
                saida.append(self._buf[:i])
                self._buf = self._buf[i + len(self.ABRE) :]
                self._dentro = True
        return "".join(saida)

    def finalizar(self) -> str:
        resto = "" if self._dentro else self._buf
        self._buf = ""
        return resto


def _prefixo_parcial(texto: str, tag: str) -> int:
    """Quantos caracteres do fim de `texto` podem ser o começo de `tag` (ex.: '<thin')."""
    for n in range(min(len(tag) - 1, len(texto)), 0, -1):
        if texto.endswith(tag[:n]):
            return n
    return 0


def mensagem_amigavel(erro: Exception) -> str:
    if isinstance(erro, NoCredentialsError):
        return "O backend está sem credenciais da AWS. Configure AWS_PROFILE ou as chaves no .env."
    if isinstance(erro, ClientError):
        codigo = erro.response.get("Error", {}).get("Code", "")
        if codigo == "AccessDeniedException":
            return "A conta AWS não tem acesso ao Nova Pro no Bedrock (libere o modelo no console)."
        if codigo == "ThrottlingException":
            return "Muitas mensagens ao mesmo tempo. Tente de novo em alguns segundos."
        return f"Erro no Bedrock: {codigo}"
    return "Tive um problema aqui. Pode tentar de novo?"


class Agente:
    def __init__(self, llm, hub):
        self.llm = llm
        self.hub = hub

    def ferramentas(self) -> list[dict]:
        return self.hub.ferramentas + ferramentas_locais.ESPECS

    async def responder(self, sessao: Sessao, conteudo: list[dict] | None, *, confirmar: bool = False) -> AsyncIterator[dict]:
        """Um turno da conversa. Emite eventos para o chat: status, delta, opcoes, confirmacao, erro, fim."""
        async with sessao.trava:
            marco = len(sessao.mensagens)
            registro_envio = None  # se um pedido saiu de verdade, isso não pode sumir do histórico
            ok = False
            try:
                if confirmar:
                    pendente, sessao.pendente = sessao.pendente, None
                    if pendente is None:
                        yield {"type": "erro", "mensagem": "Esse resumo não vale mais. Peça a confirmação de novo."}
                        ok = True
                        yield {"type": "fim"}
                        return
                    yield {"type": "status", "texto": "Enviando o pedido ao iFood", "ferramenta": pendente["nome"]}
                    conteudo = registro_envio = await self._executar_aprovado(pendente)
                else:
                    sessao.pendente = None  # mensagem nova invalida um resumo antigo
                sessao.mensagens.append({"role": "user", "content": conteudo})
                async for ev in self._rodar(sessao):
                    yield ev
                ok = True
            except Exception as e:
                log.exception("Falha no turno da sessão %s", sessao.id)
                yield {"type": "erro", "mensagem": mensagem_amigavel(e)}
            finally:
                if not ok:
                    del sessao.mensagens[marco:]
                    if registro_envio:
                        sessao.mensagens += [
                            {"role": "user", "content": registro_envio},
                            {"role": "assistant", "content": [{"text": "Pedido enviado (a resposta falhou depois do envio)."}]},
                        ]
            yield {"type": "fim"}

    async def _executar_aprovado(self, pendente: dict) -> list[dict]:
        """Executa exatamente o que a pessoa aprovou no botão, sem passar pelo modelo."""
        nome, args = pendente["nome"], dict(pendente["argumentos"])
        if "userConsent" in self.hub.propriedades(nome):
            args["userConsent"] = True
        try:
            texto, erro = await self.hub.chamar(nome, args)
        except Exception as e:
            log.exception("Falha ao executar %s aprovado", nome)
            texto, erro = str(e), True
        situacao = "FALHOU" if erro else "foi executado"
        return [{
            "text": (
                f'[Confirmação pelo botão do chat] A pessoa tocou em "Confirmar pedido". '
                f"{nome} {situacao} com {json.dumps(args, ensure_ascii=False)}. "
                f"Resultado: {_cortar(texto)}\nAvise a pessoa do resultado em poucas palavras."
            )
        }]

    async def _rodar(self, sessao: Sessao) -> AsyncIterator[dict]:
        sistema = skills.montar_prompt_sistema()
        ferramentas = self.ferramentas()
        ja_escreveu = False
        pediu_confirmacao = False

        for _ in range(config.MAX_PASSOS):
            filtro = FiltroPensamento()
            final = None
            separar = ja_escreveu
            async for ev in self.llm.gerar(sistema, sessao.mensagens, ferramentas):
                if ev["tipo"] == "texto":
                    texto = filtro.filtrar(ev["texto"])
                    if not ja_escreveu or separar:
                        texto = texto.lstrip()
                    if texto:
                        if separar:
                            texto, separar = "\n\n" + texto, False
                        ja_escreveu = True
                        yield {"type": "delta", "texto": texto}
                else:
                    final = ev
            if resto := filtro.finalizar().rstrip():
                ja_escreveu = True
                yield {"type": "delta", "texto": resto}

            sessao.mensagens.append(final["mensagem"])
            usos = [b["toolUse"] for b in final["mensagem"]["content"] if "toolUse" in b]
            if final["parada"] != "tool_use" or not usos:
                break

            resultados = []
            for uso in usos:
                nome, args = uso["name"], uso.get("input") or {}
                if nome not in SILENCIOSAS:
                    yield {"type": "status", "texto": ROTULOS.get(nome, "Consultando o iFood"), "ferramenta": nome}
                texto, eventos, erro = await self._executar(sessao, nome, args)
                if nome in config.FERRAMENTAS_COM_APROVACAO:
                    pediu_confirmacao = True
                for e in eventos:
                    yield e
                resultados.append({
                    "toolResult": {
                        "toolUseId": uso["toolUseId"],
                        "content": [{"text": ("ERRO: " if erro else "") + texto}],
                    }
                })
            sessao.mensagens.append({"role": "user", "content": resultados})
        else:
            aviso = "Parei aqui para não ficar rodando em círculos. Pode me dizer de novo o que você quer?"
            sessao.mensagens.append({"role": "assistant", "content": [{"text": aviso}]})
            yield {"type": "delta", "texto": ("\n\n" if ja_escreveu else "") + aviso}

        if pediu_confirmacao and sessao.pendente:
            yield {"type": "confirmacao"}

    async def _executar(self, sessao: Sessao, nome: str, args: dict) -> tuple[str, list[dict], bool]:
        if nome in ferramentas_locais.NOMES:
            return ferramentas_locais.executar(nome, args, sessao)
        if nome in config.FERRAMENTAS_COM_APROVACAO:
            sessao.pendente = {"nome": nome, "argumentos": args}
            return AVISO_APROVACAO, [], False
        try:
            texto, erro = await self.hub.chamar(nome, args)
        except Exception as e:
            log.exception("Falha na tool %s", nome)
            texto, erro = f"Falha ao chamar {nome}: {e}", True
        return _cortar(texto), [], erro


def _cortar(texto: str) -> str:
    limite = config.LIMITE_RESULTADO_TOOL
    return texto if len(texto) <= limite else texto[:limite] + "\n...(resultado cortado)"
