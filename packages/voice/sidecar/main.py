"""
LuxTTS Sidecar — FastAPI server wrapping LuxTTS inference.

Spawned by Adam's VoiceClient on demand.
Listens on localhost:18799 only.
"""

import os
import time
import tempfile
from pathlib import Path
from typing import Optional

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Adam LuxTTS Sidecar", version="0.1.0")

_lux_tts = None
_model_id = os.environ.get("LUXTTS_MODEL", "YatharthS/LuxTTS")
_device = os.environ.get("LUXTTS_DEVICE", "cpu")
_output_dir = Path(os.environ.get("ADAM_VOICE_OUTPUT_DIR", tempfile.gettempdir())) / "adam-voice"
_output_dir.mkdir(parents=True, exist_ok=True)


def get_model():
    global _lux_tts
    if _lux_tts is None:
        from zipvoice.luxvoice import LuxTTS

        threads = int(os.environ.get("LUXTTS_THREADS", "2"))
        if _device == "cpu":
            _lux_tts = LuxTTS(_model_id, device="cpu", threads=threads)
        else:
            _lux_tts = LuxTTS(_model_id, device=_device)
    return _lux_tts


class SamplingParams(BaseModel):
    rms: float = Field(default=0.01, ge=0, le=1)
    t_shift: float = Field(default=0.9, ge=0, le=1)
    num_steps: int = Field(default=4, ge=1, le=20)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    return_smooth: bool = False
    ref_duration: int = Field(default=5, ge=1, le=1000)


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    reference_audio_path: str
    params: SamplingParams = SamplingParams()
    output_path: Optional[str] = None


class SynthesisResponse(BaseModel):
    audio_path: str
    duration_ms: int
    sample_rate: int = 48000


@app.get("/ping")
def ping():
    return {"status": "ok", "model_loaded": _lux_tts is not None}


@app.post("/synthesize", response_model=SynthesisResponse)
def synthesize(request: SynthesisRequest):
    ref_path = Path(request.reference_audio_path)
    if not ref_path.exists():
        raise HTTPException(status_code=400, detail=f"Reference audio not found: {ref_path}")

    model = get_model()

    try:
        encoded_prompt = model.encode_prompt(
            str(ref_path),
            duration=request.params.ref_duration,
            rms=request.params.rms,
        )

        start = time.time()
        wav = model.generate_speech(
            request.text,
            encoded_prompt,
            num_steps=request.params.num_steps,
            t_shift=request.params.t_shift,
            speed=request.params.speed,
            return_smooth=request.params.return_smooth,
        )
        elapsed_ms = int((time.time() - start) * 1000)

        audio_data = wav.numpy().squeeze()

        if request.output_path:
            out_path = Path(request.output_path)
            out_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            filename = f"adam-voice-{int(time.time() * 1000)}.wav"
            out_path = _output_dir / filename

        sf.write(str(out_path), audio_data, 48000)

        duration_ms = int(len(audio_data) / 48000 * 1000)

        return SynthesisResponse(
            audio_path=str(out_path),
            duration_ms=duration_ms,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}") from e


@app.get("/voices/test")
def test_synthesis_params():
    """Returns the current model ID and device for diagnostics."""
    return {
        "model_id": _model_id,
        "device": _device,
        "output_dir": str(_output_dir),
        "model_loaded": _lux_tts is not None,
    }
