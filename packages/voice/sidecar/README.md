# LuxTTS Sidecar

Python FastAPI server wrapping [LuxTTS](https://github.com/ysharma3501/LuxTTS) inference.
Spawned automatically by Adam's `VoiceClient`. Listens on `localhost:18799`.

## Setup

```bash
cd packages/voice/sidecar
python -m venv .venv
.venv/Scripts/activate   # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

## Run manually (for debugging)

```bash
uvicorn main:app --host 127.0.0.1 --port 18799
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `LUXTTS_MODEL` | `YatharthS/LuxTTS` | HuggingFace model repo |
| `LUXTTS_DEVICE` | `cpu` | `cpu`, `cuda`, or `mps` |
| `LUXTTS_THREADS` | `2` | CPU thread count (CPU mode only) |
| `ADAM_VOICE_OUTPUT_DIR` | system temp | Where WAV files are written |

## Endpoints

- `GET /ping` — health check, returns `{ status, model_loaded }`
- `POST /synthesize` — synthesize speech, returns `{ audio_path, duration_ms, sample_rate }`
- `GET /voices/test` — diagnostics
