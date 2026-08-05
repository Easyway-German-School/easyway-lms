import { NextResponse } from "next/server";
import { requireAiUser } from "@/lib/ai-guard";

export async function POST(req: Request) {
  /**
   * Behind the same gate as every other model route.
   *
   * Without it this forwards any prompt from any stranger to a hosted model
   * using the school's key. There is no data to steal through it, which is
   * why it reads as harmless — the loss is the bill, and an open relay to a
   * paid model is something people actively scan for. It happens to be inert
   * today because OLLAMA_API_URL is unset, and that is luck rather than
   * design: setting that variable one afternoon would arm it silently.
   */
  const gate = await requireAiUser();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.prompt) {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    const OLLAMA_API_URL = process.env.OLLAMA_API_URL;
    const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

    if (!OLLAMA_API_URL || !OLLAMA_API_KEY) {
      return NextResponse.json({ error: 'Ollama API not configured on server (set OLLAMA_API_URL and OLLAMA_API_KEY)' }, { status: 500 });
    }

    const resp = await fetch(OLLAMA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OLLAMA_API_KEY}`,
      },
      body: JSON.stringify({ prompt: body.prompt, options: body.options || {} }),
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      return NextResponse.json({ error: 'Model request failed', details: data }, { status: resp.status });
    }

    return NextResponse.json({ result: data });
  } catch (err) {
    console.error('Ollama proxy error:', err);
    return NextResponse.json({ error: 'Ollama proxy error' }, { status: 500 });
  }
}
