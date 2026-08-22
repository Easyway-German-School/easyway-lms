import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from starlette.background import BackgroundTask
from fastapi.responses import FileResponse
from pydantic import BaseModel


class SpeechRequest(BaseModel):
    text: str
    language: str = "de-DE"
    format: str = "wav"


app = FastAPI(title="Easyway Voice Coach TTS")
MODEL_PATH = Path(os.environ.get("PIPER_MODEL", "/models/de_DE-thorsten-medium.onnx"))
SERVICE_TOKEN = os.environ.get("TTS_TOKEN", "").strip()


@app.post("/speak")
def speak(request: SpeechRequest, authorization: str | None = Header(default=None)):
    if SERVICE_TOKEN and authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="invalid service token")
    text = request.text.strip()
    if not text or len(text) > 500:
        raise HTTPException(status_code=400, detail="text must be between 1 and 500 characters")
    if request.format.lower() != "wav":
        raise HTTPException(status_code=400, detail="only wav output is supported")
    if not MODEL_PATH.is_file():
        raise HTTPException(status_code=503, detail="Piper German model is not installed")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as output:
        output_path = output.name
    try:
        result = subprocess.run(
            ["piper", "--model", str(MODEL_PATH), "--output_file", output_path],
            input=text,
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=502, detail="Piper could not synthesize the phrase")
        return FileResponse(
            output_path,
            media_type="audio/wav",
            filename="voice-coach.wav",
            background=BackgroundTask(os.unlink, output_path),
        )
    except subprocess.TimeoutExpired as error:
        raise HTTPException(status_code=504, detail="Piper synthesis timed out") from error
