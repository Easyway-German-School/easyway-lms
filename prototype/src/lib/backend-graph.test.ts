import { describe, expect, it } from "vitest";
import { buildGraph, layoutGraph, libIdFromFile, neighborhood, parseSource, routeIdFromFile, stripComments } from "./backend-graph";

describe("parseSource", () => {
  it("finds library imports, static and dynamic, and normalises index", () => {
    const parsed = parseSource(`
      import { a } from "@/lib/student-access";
      import b from '@/lib/finance/ledger';
      const c = await import("@/lib/incidents");
      import x from "@/lib/tenant/index";
      import y from "react";
    `);
    expect(parsed.imports).toEqual(["finance/ledger", "incidents", "student-access", "tenant"]);
  });

  it("classifies table access as read or write, and write wins", () => {
    const parsed = parseSource(`
      await prisma.student.findUnique({});
      await prisma.payment.count({});
      await prisma.student.update({});
      await guardedPrisma.incident.upsert({});
      await tx.tuitionCharge.deleteMany({});
    `);
    expect(parsed.tables).toEqual([
      { table: "incident", mode: "write" },
      { table: "payment", mode: "read" },
      { table: "student", mode: "write" },
      { table: "tuitionCharge", mode: "write" },
    ]);
  });

  it("finds the HTTP methods a route exports", () => {
    expect(parseSource(`export async function GET() {}\nexport const POST = withX(async () => {});`).methods).toEqual([
      "GET",
      "POST",
    ]);
  });

  it("ignores things only mentioned in comments", () => {
    const parsed = parseSource(`
      // await prisma.student.delete({}) — never do this
      /* import x from "@/lib/secret"; prisma.payment.update() */
      await prisma.lead.findMany({});
    `);
    expect(parsed.imports).toEqual([]);
    expect(parsed.tables).toEqual([{ table: "lead", mode: "read" }]);
  });

  it("does not treat a prisma method that is not a model call as a table", () => {
    expect(parseSource(`await prisma.$transaction([]); await prisma.$queryRaw\`select 1\`;`).tables).toEqual([]);
  });
});

describe("stripComments", () => {
  it("leaves a URL inside a string alone", () => {
    expect(stripComments(`const u = "https://example.com/x";`)).toContain("https://example.com/x");
  });
});

describe("naming", () => {
  it("names a route the way Next reports routePath", () => {
    expect(routeIdFromFile("src/app/api/student/access/route.ts")).toBe("/api/student/access");
    expect(routeIdFromFile("prototype/src/app/api/admin/students/[id]/remote/route.ts")).toBe(
      "/api/admin/students/[id]/remote",
    );
    expect(routeIdFromFile("src/app/api/(group)/thing/route.ts")).toBe("/api/thing");
    expect(routeIdFromFile("src/app/admin/page.tsx")).toBeNull();
  });

  it("names a library and skips tests", () => {
    expect(libIdFromFile("src/lib/finance/ledger.ts")).toBe("finance/ledger");
    expect(libIdFromFile("src/lib/tenant/index.ts")).toBe("tenant");
    expect(libIdFromFile("src/lib/incidents.test.ts")).toBeNull();
    expect(libIdFromFile("src/components/X.tsx")).toBeNull();
  });
});

const FILES = [
  {
    path: "src/app/api/student/access/route.ts",
    source: `import { getStudentAccess } from "@/lib/student-access"; export async function GET() { await prisma.student.findUnique({}); }`,
  },
  {
    path: "src/app/api/pay/route.ts",
    source: `import { record } from "@/lib/payment"; export async function POST() {}`,
  },
  {
    path: "src/lib/student-access.ts",
    source: `import { x } from "@/lib/payment"; import { y } from "@/lib/does-not-exist"; await prisma.payment.findMany({}); await prisma.tuitionCharge.findMany({});`,
  },
  { path: "src/lib/payment.ts", source: `await prisma.payment.create({});` },
  { path: "src/lib/unused.ts", source: `export const a = 1;` },
  { path: "src/lib/student-access.test.ts", source: `await prisma.lead.delete({});` },
];
const MODELS = ["Student", "Payment", "TuitionCharge", "Lead", "Orphan"];

describe("buildGraph", () => {
  const graph = buildGraph(FILES, MODELS);

  it("links routes to libraries and libraries to tables", () => {
    const has = (from: string, to: string, mode?: string) =>
      graph.edges.some((e) => e.from === from && e.to === to && (!mode || e.mode === mode));
    expect(has("route:/api/student/access", "lib:student-access", "import")).toBe(true);
    expect(has("route:/api/student/access", "model:Student", "read")).toBe(true);
    expect(has("lib:student-access", "lib:payment", "import")).toBe(true);
    expect(has("lib:payment", "model:Payment", "write")).toBe(true);
    expect(has("lib:student-access", "model:Payment", "read")).toBe(true);
  });

  it("skips imports of libraries that are not real files, and test files", () => {
    expect(graph.nodes.some((n) => n.id === "lib:does-not-exist")).toBe(false);
    expect(graph.nodes.some((n) => n.id === "model:Lead")).toBe(false);
  });

  it("omits nodes that connect to nothing, and reports untouched tables", () => {
    expect(graph.nodes.some((n) => n.id === "lib:unused")).toBe(false);
    expect(graph.stats.untouchedModels).toEqual(["Lead", "Orphan"]);
  });

  it("records methods on route nodes", () => {
    expect(graph.nodes.find((n) => n.id === "route:/api/student/access")?.methods).toEqual(["GET"]);
  });

  it("is deterministic regardless of input order", () => {
    const reversed = buildGraph([...FILES].reverse(), [...MODELS].reverse());
    expect(reversed).toEqual(graph);
  });
});

describe("neighborhood", () => {
  const graph = buildGraph(FILES, MODELS);

  it("returns the node and what is within reach", () => {
    const near = neighborhood(graph, "model:Payment", 1);
    expect(near.has("lib:payment")).toBe(true);
    expect(near.has("lib:student-access")).toBe(true);
    expect(near.has("route:/api/student/access")).toBe(false);
    expect(neighborhood(graph, "model:Payment", 2).has("route:/api/student/access")).toBe(true);
  });

  it("caps the size so a hub cannot pull in the whole system", () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `route:/r${i}`, kind: "route" as const, label: `/r${i}` }));
    const edges = nodes.map((n) => ({ from: n.id, to: "model:Hub", mode: "read" as const }));
    expect(neighborhood({ nodes, edges }, "model:Hub", 1, 50).size).toBeLessThanOrEqual(50);
  });
});

describe("layoutGraph", () => {
  const graph = buildGraph(FILES, MODELS);
  const placed = layoutGraph(graph.nodes, graph.edges);

  it("puts tables, libraries and routes in three ordered columns", () => {
    const x = (id: string) => placed.find((p) => p.id === id)!.x;
    expect(x("model:Payment")).toBeLessThan(x("lib:payment"));
    expect(x("lib:payment")).toBeLessThan(x("route:/api/student/access"));
  });

  it("gives every node its own slot — no two boxes overlap", () => {
    const slots = placed.map((p) => `${p.x},${p.y}`);
    expect(new Set(slots).size).toBe(slots.length);
    expect(placed).toHaveLength(graph.nodes.length);
  });

  it("is deterministic", () => {
    expect(layoutGraph(graph.nodes, graph.edges)).toEqual(placed);
  });
});
