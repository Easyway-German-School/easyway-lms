import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Generate once, read forever.
 *
 * The reason this exists rather than calling a model where the answer is
 * needed: doing it per student per page view is roughly 1,300 model calls a
 * day for this school. Doing it once per input is about twenty. That is the
 * difference between needing a rented GPU server and running comfortably
 * inside a free tier — or on the office machine overnight.
 *
 * The key is a hash of the task plus the exact input, so editing a material
 * naturally misses and regenerates, while a thousand students opening the same
 * material share one generation.
 */

export type CacheTask =
  | "material_summary"
  | "material_quests"
  | "cohort_missions";

function keyFor(task: CacheTask, input: string): string {
  return crypto.createHash("sha256").update(`${task}:${input}`).digest("hex");
}

/**
 * Read a cached value, or produce and store one.
 *
 * `generate` is only called on a miss. It returns null when the model could
 * not be reached or its answer was unusable — in that case NOTHING is cached,
 * so the next run tries again rather than serving a failure forever. That is
 * deliberate: caching a failure is how a temporary outage becomes permanent.
 */
export async function cached<T>(
  task: CacheTask,
  input: string,
  generate: () => Promise<T | null>,
  options: { model?: string } = {},
): Promise<T | null> {
  const key = keyFor(task, input);

  const hit = await prisma.aiCache.findUnique({ where: { key } });
  if (hit && hit.status === "ready") return hit.value as T;

  const value = await generate();

  if (value === null || value === undefined) {
    // Record the failure so it is visible in the admin view, but leave the
    // status as `failed` so the next pass retries instead of reading it back.
    await prisma.aiCache
      .upsert({
        where: { key },
        create: { key, task, value: {}, status: "failed", model: options.model ?? null, error: "model returned nothing usable" },
        update: { status: "failed", error: "model returned nothing usable", model: options.model ?? null },
      })
      .catch(() => {});
    return null;
  }

  await prisma.aiCache
    .upsert({
      where: { key },
      create: { key, task, value: value as object, status: "ready", model: options.model ?? null },
      update: { value: value as object, status: "ready", error: null, model: options.model ?? null },
    })
    .catch((error) => {
      // A cache write failing must not lose the answer we already paid for.
      console.warn("[ai-cache] could not store", task, error);
    });

  return value;
}

/** Clear one task's cache, e.g. after changing a prompt. */
export async function invalidateTask(task: CacheTask): Promise<number> {
  const { count } = await prisma.aiCache.deleteMany({ where: { task } });
  return count;
}

/** What the admin security/AI view shows: how much has been generated, and how it went. */
export async function cacheStats(): Promise<
  Array<{ task: string; ready: number; failed: number }>
> {
  const rows = await prisma.aiCache.groupBy({
    by: ["task", "status"],
    _count: { _all: true },
  });

  const byTask = new Map<string, { task: string; ready: number; failed: number }>();
  for (const row of rows) {
    const entry = byTask.get(row.task) ?? { task: row.task, ready: 0, failed: 0 };
    if (row.status === "ready") entry.ready += row._count._all;
    else entry.failed += row._count._all;
    byTask.set(row.task, entry);
  }

  return [...byTask.values()].sort((a, b) => a.task.localeCompare(b.task));
}
