/**
 * One request where several components would each have made their own.
 *
 * The student shell and the floating community button both ask
 * `/api/community/unread` for the same number, each on its own timer. Every
 * call is a billed serverless invocation, so two asking within a few seconds of
 * each other is pure waste. This hands the second caller the first caller's
 * answer (or its still-flying request) instead of sending another.
 *
 * `force` is for "something just changed" events (a room was opened, so the
 * badge must clear NOW) — it always goes to the network.
 */
type Entry = { at: number; promise: Promise<unknown> };

const entries = new Map<string, Entry>();

export async function fetchJsonShared<T = unknown>(
  url: string,
  options: { ttlMs?: number; force?: boolean } = {},
): Promise<T> {
  const { ttlMs = 10_000, force = false } = options;
  const held = entries.get(url);
  if (!force && held && Date.now() - held.at < ttlMs) return held.promise as Promise<T>;

  const promise = fetch(url, { cache: "no-store" }).then(async (res) => {
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return (await res.json()) as unknown;
  });
  const entry: Entry = { at: Date.now(), promise };
  entries.set(url, entry);
  // A failed answer must not be served again for the next ten seconds.
  promise.catch(() => {
    if (entries.get(url) === entry) entries.delete(url);
  });
  return promise as Promise<T>;
}
