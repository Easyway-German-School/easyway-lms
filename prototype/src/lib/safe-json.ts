/**
 * Read JSON out of what a language model actually returns.
 *
 * `JSON.parse` on raw model output is the single most expensive bug in this
 * codebase's AI layer, and it fails invisibly. A small model asked for JSON
 * answers with:
 *
 *     ```json
 *     [ { "title": "..." } ]
 *     ```
 *
 * — which is correct JSON wearing a markdown jacket. `JSON.parse` sees a
 * backtick, throws, and the caller quietly falls back to a canned response.
 * Everything keeps working, nobody sees an error, and the feature has simply
 * never run. Daily missions shipped like that: the model was called, answered
 * well, and was thrown away every time.
 *
 * So: strip the fence, and if that still fails, take the outermost {...} or
 * [...] in the text, because models also like to introduce themselves before
 * answering ("Sure! Here are three missions:").
 *
 * Returns null when there is genuinely nothing parseable — callers should log
 * that rather than swallow it.
 */
export function parseModelJson<T = unknown>(raw: string | null | undefined): T | null {
  if (!raw) return null;

  const text = String(raw).trim();
  if (!text) return null;

  const attempts: string[] = [text];

  // ```json … ``` or plain ``` … ```
  const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  // The outermost array or object, for prose wrapped around the answer.
  // Array first: an array of objects would otherwise match the inner object.
  for (const [open, close] of [["[", "]"], ["{", "}"]] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) attempts.push(text.slice(start, end + 1));
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as T;
    } catch {
      // Try the next shape.
    }
  }

  return null;
}

export async function safeJson<T = any>(response: Response): Promise<T | null> {
  if (!response) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  return response.json().catch(() => null);
}
