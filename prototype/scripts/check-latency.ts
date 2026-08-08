/**
 * Is this candidate server actually close to us?
 *
 * Run this against a trial box BEFORE paying anyone for a year of hosting. A
 * provider with a Lagos address and no IXPN peering routes your traffic to
 * London and back, and the only way to tell the difference is to measure it.
 *
 *   npm run check:latency -- live.example.com
 *   npm run check:latency -- 102.x.x.x:7880 another-host.com
 *
 * Reference points are always measured alongside, because a number on its own
 * means nothing: if Google is 300ms too, the problem is your line today and not
 * the candidate.
 */
import net from "net";

/** One TCP handshake, timed. Resolves to null if it fails or times out. */
function handshake(host: string, port: number, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const socket = new net.Socket();
    let settled = false;

    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(Number(process.hrtime.bigint() - started) / 1_000_000));
    socket.once("timeout", () => done(null));
    socket.once("error", () => done(null));
    socket.connect(port, host);
  });
}

type Result = { label: string; min: number; median: number; jitter: number; lost: number } | { label: string; failed: true };

async function measure(label: string, host: string, port: number, rounds = 9): Promise<Result> {
  const samples: number[] = [];
  let lost = 0;

  for (let i = 0; i < rounds; i += 1) {
    const rtt = await handshake(host, port);
    if (rtt === null) lost += 1;
    else samples.push(rtt);
    // A short gap so we sample the path over time rather than one burst, which
    // is the only way jitter shows up at all.
    await new Promise((r) => setTimeout(r, 250));
  }

  if (samples.length < 2) return { label, failed: true };

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    label,
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    jitter: sorted[sorted.length - 1] - sorted[0],
    lost,
  };
}

/** "host", "host:port" and "wss://host" all mean the same thing here. */
function parseTarget(raw: string): { host: string; port: number } {
  const cleaned = raw.replace(/^\w+:\/\//, "").replace(/\/.*$/, "");
  const [host, port] = cleaned.split(":");
  return { host, port: port ? Number(port) : 443 };
}

/**
 * What the number means for a live class. The thresholds are the ITU-T G.114
 * one-way guidance doubled into a round trip: under 150ms one-way feels like a
 * conversation, past 400ms people talk over each other.
 */
function verdict(min: number, jitter: number): string {
  if (min <= 50) return "EXCELLENT — same-city. Classes will feel like a room.";
  if (min <= 100) return "GOOD — regional. Comfortable for teaching.";
  if (min <= 180) return jitter > 300 ? "POOR — the wobble will freeze video." : "USABLE — noticeable delay.";
  return "BAD — this is a transcontinental path. Not worth paying for.";
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const current = process.env.LIVEKIT_URL ? [parseTarget(process.env.LIVEKIT_URL)] : [];

  const targets: Array<{ label: string; host: string; port: number }> = [
    ...args.map((a) => ({ label: `CANDIDATE ${a}`, ...parseTarget(a) })),
    ...current.map((t) => ({ label: "current LiveKit", ...t })),
    { label: "reference: Google", host: "www.google.com", port: 443 },
    { label: "reference: Vercel", host: "vercel.com", port: 443 },
  ];

  if (args.length === 0) {
    console.log("No candidate given — measuring the current setup and references only.");
    console.log("Usage: npm run check:latency -- live.your-host.com\n");
  }

  console.log("target                                    min      median   jitter   lost");
  console.log("-".repeat(78));

  for (const target of targets) {
    const result = await measure(target.label, target.host, target.port);
    if ("failed" in result) {
      console.log(`${target.label.padEnd(40)} unreachable`);
      continue;
    }
    console.log(
      `${result.label.padEnd(40)} ${`${result.min.toFixed(0)}ms`.padEnd(8)} ${`${result.median.toFixed(0)}ms`.padEnd(8)} ` +
        `${`${result.jitter.toFixed(0)}ms`.padEnd(8)} ${result.lost}/9`,
    );
    if (result.label.startsWith("CANDIDATE")) console.log(`${" ".repeat(41)}${verdict(result.min, result.jitter)}`);
  }

  console.log("");
  console.log("A candidate is worth paying for when its min is well under the references'");
  console.log("international numbers AND its jitter is small. Ask the provider: are you");
  console.log("peered at IXPN? Without that, a Lagos address still routes through London.");
}

main().catch((error) => {
  console.error("FAILED:", error?.message || error);
  process.exit(1);
});
