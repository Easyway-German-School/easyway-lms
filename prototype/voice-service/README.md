# Self-hosted German Voice Coach

This service runs the free, open-source Piper German voice locally. It accepts
the request shape used by the LMS voice route and returns WAV audio.

```powershell
docker build -t easyway-voice-coach ./voice-service
docker run --rm -p 8001:8000 -e TTS_TOKEN="change-this" easyway-voice-coach
```

Set this in `prototype/.env.local`:

```env
VOICE_COACH_TTS_URL="http://127.0.0.1:8001/speak"
VOICE_COACH_TTS_TOKEN="change-this"
```

For a deployed app, run the container on a small server with HTTPS and set the
same variable to its public `/speak` URL. The Next.js route keeps the provider
secret and forwards only short text; if the service is unavailable, the coach
uses the device's German browser voice automatically.
