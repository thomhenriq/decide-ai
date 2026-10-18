"""Transcrição local. Recebe áudio binário por stdin e responde JSON por stdout."""
import io
import json
import os
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")
if MODEL_NAME not in {"tiny", "base", "small", "medium"}:
    print(json.dumps({"error": "Modelo local inválido. Use tiny, base, small ou medium.", "status": 503}))
    sys.exit(1)
MODEL_DIR = ROOT / ".models" / f"whisper-{MODEL_NAME}"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"


def transcribe():
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio

    if "--download" in sys.argv:
        from faster_whisper.utils import download_model
        download_model(MODEL_NAME, output_dir=str(MODEL_DIR))
        # Confirma que o modelo e as bibliotecas nativas realmente carregam.
        WhisperModel(str(MODEL_DIR), device="cpu", compute_type="int8", local_files_only=True)
        print(json.dumps({"ready": True, "model": MODEL_NAME}))
        return

    if not (MODEL_DIR / "model.bin").is_file():
        print(json.dumps({"error": "O modelo de transcrição ainda não foi instalado. Execute npm run setup:audio no servidor.", "status": 503}))
        return

    # Em uso normal, o modelo só pode ser lido do disco: nenhuma conexão externa.
    os.environ["HF_HUB_OFFLINE"] = "1"
    data = sys.stdin.buffer.read(20 * 1024 * 1024 + 1)
    if not data or len(data) > 20 * 1024 * 1024:
        print(json.dumps({"error": "Envie um áudio de até 20 MB.", "status": 400}))
        return
    try:
        audio = decode_audio(io.BytesIO(data), sampling_rate=16000)
    except Exception:
        print(json.dumps({"error": "Não foi possível ler este áudio. Grave novamente ou envie outro arquivo.", "status": 422}))
        return
    if len(audio) > 120 * 16000:
        print(json.dumps({"error": "Envie um áudio de até 2 minutos.", "status": 413}))
        return
    if not len(audio):
        print(json.dumps({"error": "O áudio está vazio.", "status": 422}))
        return
    model = WhisperModel(str(MODEL_DIR), device="cpu", compute_type="int8",
                         cpu_threads=min(4, os.cpu_count() or 1), local_files_only=True)
    segments, _ = model.transcribe(audio, language="pt", beam_size=3,
                                   vad_filter=True, condition_on_previous_text=False)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    print(json.dumps({"text": text}, ensure_ascii=False))


try:
    transcribe()
except ImportError:
    print(json.dumps({"error": "A transcrição local precisa ser instalada. Execute npm run setup:audio no servidor.", "status": 503}))
    sys.exit(1)
except Exception as error:
    print(f"[audio:local] {type(error).__name__}: {error}", file=sys.stderr)
    print(json.dumps({"error": "Não foi possível executar a transcrição local. Verifique o terminal do servidor.", "status": 502}))
    sys.exit(1)
