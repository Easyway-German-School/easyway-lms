import fs from "fs";
import path from "path";

let redis: any = null;
const REDIS_URL = process.env.REDIS_URL;
if (REDIS_URL) {
  try {
    // lazy require to avoid startup errors when not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IORedis = require("ioredis");
    redis = new IORedis(REDIS_URL);
  } catch (e) {
    // if ioredis isn't installed, we'll fall back to in-memory
    redis = null;
  }

}

const attempts: Map<string, number[]> = new Map();

export async function isRateLimited(id: string, windowMs: number, max: number) {
  if (redis) {
    try {
      const count = await redis.incr(id);
      if (count === 1) {
        await redis.pexpire(id, windowMs);
      }
      return count > max;
    } catch (e) {
      // on redis error, fall back to in-memory
    }
  }

  const now = Date.now();
  const list = attempts.get(id) ?? [];
  list.push(now);
  const cutoff = now - windowMs;
  while (list.length > 0 && list[0] < cutoff) list.shift();
  attempts.set(id, list);
  return list.length > max;
}

export function recordLog(line: string) {
  try {
    const logDir = path.join(process.cwd(), "tenant-portal", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "invalid_api.log"), line + "\n");
  } catch (e) {
    // ignore logging errors
  }
}
