"""Tools que são nossas (não vêm do MCP do iFood): cartões no chat e banco de demanda."""
from . import banco

MOSTRAR_OPCOES = {
    "toolSpec": {
        "name": "mostrar_opcoes",
        "description": (
            "Mostra até 3 opções de pedido como cartões no chat, cada uma com um papel. "
            "Use sempre que for apresentar opções. Os dados têm de vir das tools do iFood."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "opcoes": {
                        "type": "array",
                        "maxItems": 3,
                        "items": {
                            "type": "object",
                            "properties": {
                                "papel": {
                                    "type": "string",
                                    "enum": ["mais_parecida", "mais_barata", "mais_rapida", "outra"],
                                },
                                "item_id": {"type": "string"},
                                "merchant_id": {"type": "string"},
                                "nome": {"type": "string", "description": "Nome do prato"},
                                "restaurante": {"type": "string"},
                                "preco": {"type": "number", "description": "Preço do item em reais"},
                                "taxa_entrega": {"type": "number"},
                                "eta_min": {"type": "integer", "description": "Tempo estimado de entrega em minutos"},
                                "foto_url": {"type": "string"},
                                "nota_semelhanca": {
                                    "type": "number",
                                    "description": "0 a 100. Só quando o pedido veio de foto ou descrição detalhada",
                                },
                                "observacao": {"type": "string", "description": "Uma frase curta: por que esta opção"},
                            },
                            "required": ["nome", "restaurante", "preco"],
                        },
                    }
                },
                "required": ["opcoes"],
            }
        },
    }
}

REGISTRAR_EVENTO = {
    "toolSpec": {
        "name": "registrar_evento",
        "description": (
            "Grava no nosso banco um sinal de demanda anônimo: desejo não atendido, recusa (com motivo) "
            "ou aceite. Nunca inclua nome, telefone ou endereço completo."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "tipo": {"type": "string", "enum": ["demanda_nao_atendida", "recusa", "aceite"]},
                    "desejo": {
                        "type": "object",
                        "description": "O JSON de desejo da skill traduzir_desejo (prato, atributos, preço máximo...)",
                    },
                    "categoria_id": {"type": "string", "description": "ID do listItemTaxonomy, se houver"},
                    "match_score": {"type": "number", "description": "0 a 100"},
                    "motivo": {
                        "type": "string",
                        "description": (
                            "Código do motivo. Ex.: preco.item, preco.taxa_entrega, tempo.entrega, "
                            "gosto.diferente, loja.fechada, sem_resultado"
                        ),
                    },
                    "item_escolhido": {"type": "string"},
                    "cidade": {"type": "string"},
                    "bairro": {"type": "string"},
                },
                "required": ["tipo", "desejo"],
            }
        },
    }
}

ESPECS = [MOSTRAR_OPCOES, REGISTRAR_EVENTO]
NOMES = {e["toolSpec"]["name"] for e in ESPECS}


def executar(nome: str, args: dict, sessao) -> tuple[str, list[dict], bool]:
    """Devolve (texto para o modelo, eventos para a interface, deu_erro)."""
    if nome == "mostrar_opcoes":
        opcoes = [o for o in (args.get("opcoes") or []) if isinstance(o, dict)][:3]
        if not opcoes:
            return "Nenhuma opção válida recebida.", [], True
        return (
            "Cartões exibidos no chat. Escreva só uma frase curta agora; não repita a lista.",
            [{"type": "opcoes", "opcoes": opcoes}],
            False,
        )

    if nome == "registrar_evento":
        evento_id = banco.registrar(sessao.id, sessao.ultima_origem, args)
        return f"Evento {evento_id} registrado.", [], False

    return f"Ferramenta local desconhecida: {nome}", [], True
