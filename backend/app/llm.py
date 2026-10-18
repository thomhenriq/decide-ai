"""Amazon Nova Pro via Bedrock Converse, em streaming."""
import asyncio
import json
import threading
from collections.abc import AsyncIterator

import boto3
from botocore.config import Config


class LLMBedrock:
    def __init__(self, model_id: str, regiao: str, max_tokens: int):
        self.model_id = model_id
        self.max_tokens = max_tokens
        self._cliente = boto3.client(
            "bedrock-runtime",
            region_name=regiao,
            config=Config(read_timeout=120, retries={"max_attempts": 3, "mode": "adaptive"}),
        )

    async def gerar(self, sistema: str, mensagens: list, ferramentas: list) -> AsyncIterator[dict]:
        """Emite {"tipo": "texto"} durante o stream e, no fim, {"tipo": "fim", "mensagem", "parada"}."""
        args = {
            "modelId": self.model_id,
            "system": [{"text": sistema}],
            "messages": mensagens,
            "inferenceConfig": {"maxTokens": self.max_tokens, "temperature": 1, "topP": 1},
            # topK 1 = decodificação gulosa, que a AWS recomenda para tool calling no Nova
            "additionalModelRequestFields": {"inferenceConfig": {"topK": 1}},
        }
        if ferramentas:
            args["toolConfig"] = {"tools": ferramentas}

        # O boto3 é síncrono: o stream roda numa thread e os eventos chegam por uma fila.
        fila: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def produzir():
            try:
                for ev in self._cliente.converse_stream(**args)["stream"]:
                    loop.call_soon_threadsafe(fila.put_nowait, ev)
            except Exception as e:  # repassa o erro para o lado async
                loop.call_soon_threadsafe(fila.put_nowait, e)
            finally:
                loop.call_soon_threadsafe(fila.put_nowait, None)

        threading.Thread(target=produzir, daemon=True).start()

        blocos: dict[int, dict] = {}
        parada = "end_turn"
        while (ev := await fila.get()) is not None:
            if isinstance(ev, Exception):
                raise ev
            if "contentBlockStart" in ev:
                inicio = ev["contentBlockStart"]
                uso = inicio["start"].get("toolUse")
                if uso:
                    blocos[inicio["contentBlockIndex"]] = {
                        "toolUse": {"toolUseId": uso["toolUseId"], "name": uso["name"]},
                        "_json": "",
                    }
            elif "contentBlockDelta" in ev:
                d = ev["contentBlockDelta"]
                delta = d["delta"]
                if "text" in delta:
                    blocos.setdefault(d["contentBlockIndex"], {"text": ""})["text"] += delta["text"]
                    yield {"tipo": "texto", "texto": delta["text"]}
                elif "toolUse" in delta:
                    blocos[d["contentBlockIndex"]]["_json"] += delta["toolUse"].get("input", "")
            elif "messageStop" in ev:
                parada = ev["messageStop"]["stopReason"]

        conteudo = []
        for i in sorted(blocos):
            b = blocos[i]
            if "toolUse" in b:
                try:
                    entrada = json.loads(b["_json"]) if b["_json"] else {}
                except json.JSONDecodeError:
                    entrada = {}
                conteudo.append({"toolUse": {**b["toolUse"], "input": entrada}})
            elif b.get("text", "").strip():  # o Bedrock recusa bloco de texto vazio no histórico
                conteudo.append({"text": b["text"]})
        if not conteudo:
            conteudo = [{"text": "..."}]
        yield {"tipo": "fim", "mensagem": {"role": "assistant", "content": conteudo}, "parada": parada}
