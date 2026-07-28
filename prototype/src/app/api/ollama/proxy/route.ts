import { NextResponse } from "next/server";

export async function POST(req: Request) {
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
