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
