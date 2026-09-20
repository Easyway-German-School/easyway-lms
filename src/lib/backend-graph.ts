/**
 * THE BACKEND MAP — how the code and the database are actually wired.
 *
 * Read straight out of the source, not drawn by hand, so it cannot drift from
 * what the system does: every API route, every shared library, every table, and
 * the lines between them ("this route calls this library", "this library writes
 * this table"). `scripts/build-backend-graph.ts` walks the tree and feeds files
 * through `buildGraph`; the developer console lays the result out with
 * `layoutGraph` and draws it.
 *
 * It is a static reading, and honest about that: it sees `prisma.student.update`
 * and `import "@/lib/access"`, not a table reached through a dynamic string or a
 * nested relation write. It answers "what touches this?" reliably for the direct
 * cases and is silent, not wrong, for the rest.
 *
 * Pure — no fs, no Prisma — so the same functions run in the generator, in the
 * browser, and in tests.
 */

export type GraphNodeKind = "model" | "lib" | "route";

export type GraphNode = {
  /** `model:Student`, `lib:student-access`, `route:/api/student/access`. */
  id: string;
  kind: GraphNodeKind;
  /** What to print on the box. */
  label: string;
  /** Repo-relative source file, for lib and route nodes. */
  file?: string;
  /** HTTP methods a route handles. */
  methods?: string[];
};

export type GraphEdge = {
  from: string;
  to: string;
  /** import: code calls code. read/write: code touches a table. */
  mode: "import" | "read" | "write";
};

export type BackendGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { routes: number; libs: number; models: number; edges: number; untouchedModels: string[] };
};

// ---------------------------------------------------------------------------
// Reading one source file
// ---------------------------------------------------------------------------

const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const WRITE_OPS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

const CLIENT_NAMES = "prisma|guardedPrisma|unguardedPrisma|tx|db";
const MODEL_CALL = new RegExp(
  `\\b(?:${CLIENT_NAMES})\\.([a-z][A-Za-z0-9]*)\\.(${[...READ_OPS, ...WRITE_OPS].join("|")})\\b`,
  "g",
);
const LIB_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)["']@\/lib\/([^"']+)["']/g;
const METHOD_EXPORT = /\bexport\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/g;

/** Comments talk about tables and libraries they do not use; only count real code. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
}

export type ParsedSource = {
  /** Library module paths this file imports, e.g. "student-access", "finance/ledger". */
  imports: string[];
  /** Tables this file reads or writes, as lowerCamel client names, e.g. "student". */
  tables: Array<{ table: string; mode: "read" | "write" }>;
  methods: string[];
};

export function parseSource(source: string): ParsedSource {
  const code = stripComments(source);
  const imports = new Set<string>();
  for (const match of code.matchAll(LIB_IMPORT)) {
    imports.add(match[1].replace(/\/index$/, ""));
  }

  const modes = new Map<string, "read" | "write">();
  for (const match of code.matchAll(MODEL_CALL)) {
    const [, table, op] = match;
    const mode = WRITE_OPS.has(op) ? "write" : "read";
    // A file that both reads and writes a table is drawn as a write.
    if (modes.get(table) !== "write") modes.set(table, mode);
  }

  const methods = new Set<string>();
  for (const match of code.matchAll(METHOD_EXPORT)) methods.add(match[1]);

  return {
    imports: [...imports].sort(),
    tables: [...modes.entries()].map(([table, mode]) => ({ table, mode })).sort((a, b) => a.table.localeCompare(b.table)),
    methods: [...methods].sort(),
  };
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** `src/app/api/student/access/route.ts` -> `/api/student/access`. Same shape Next reports as `routePath`. */
export function routeIdFromFile(file: string): string | null {
  const match = file.replace(/\\/g, "/").match(/(?:^|\/)src\/app(\/api\/.*)\/route\.tsx?$/);
  if (!match) return null;
  // Route groups like (admin) do not appear in the URL.
  return match[1].replace(/\/\([^/]+\)/g, "");
}

/** `src/lib/finance/ledger.ts` -> `finance/ledger`; tests and non-lib files -> null. */
export function libIdFromFile(file: string): string | null {
  const normal = file.replace(/\\/g, "/");
  if (/\.(test|spec)\.tsx?$/.test(normal)) return null;
  const match = normal.match(/(?:^|\/)src\/lib\/(.+)\.tsx?$/);
  if (!match) return null;
  return match[1].replace(/\/index$/, "");
}

const lowerFirst = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

// ---------------------------------------------------------------------------
// Building the graph
// ---------------------------------------------------------------------------

export function buildGraph(files: Array<{ path: string; source: string }>, modelNames: string[]): BackendGraph {
  const modelByClientName = new Map(modelNames.map((name) => [lowerFirst(name), name]));
  const libIds = new Set<string>();
  const parsedFiles: Array<{ nodeId: string; kind: "route" | "lib"; file: string; parsed: ParsedSource }> = [];

  for (const file of files) {
    const path = file.path.replace(/\\/g, "/");
    const route = routeIdFromFile(path);
    if (route) {
      parsedFiles.push({ nodeId: `route:${route}`, kind: "route", file: path, parsed: parseSource(file.source) });
      continue;
    }
    const lib = libIdFromFile(path);
    if (lib) {
      libIds.add(lib);
      parsedFiles.push({ nodeId: `lib:${lib}`, kind: "lib", file: path, parsed: parseSource(file.source) });
    }
  }

  const edges = new Map<string, GraphEdge>();
  const touchedModels = new Set<string>();
  const used = new Set<string>();

  const addEdge = (edge: GraphEdge) => {
    const key = `${edge.from}>${edge.to}`;
    const existing = edges.get(key);
    if (!existing || (existing.mode !== "write" && edge.mode === "write")) edges.set(key, edge);
    used.add(edge.from);
    used.add(edge.to);
  };

  for (const { nodeId, parsed } of parsedFiles) {
    for (const lib of parsed.imports) {
      // Only a real library file is a node; an alias to something else is skipped.
      if (libIds.has(lib) && `lib:${lib}` !== nodeId) addEdge({ from: nodeId, to: `lib:${lib}`, mode: "import" });
    }
    for (const { table, mode } of parsed.tables) {
      const model = modelByClientName.get(table);
      if (!model) continue;
      touchedModels.add(model);
      addEdge({ from: nodeId, to: `model:${model}`, mode });
    }
  }

  const nodes: GraphNode[] = [];
  for (const { nodeId, kind, file, parsed } of parsedFiles) {
    if (!used.has(nodeId)) continue;
    nodes.push(
      kind === "route"
        ? { id: nodeId, kind, label: nodeId.slice("route:".length), file, methods: parsed.methods }
        : { id: nodeId, kind, label: nodeId.slice("lib:".length), file },
    );
  }
  for (const model of touchedModels) nodes.push({ id: `model:${model}`, kind: "model", label: model });

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges.values()].sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`));

  return {
    nodes,
    edges: sortedEdges,
    stats: {
      routes: nodes.filter((n) => n.kind === "route").length,
      libs: nodes.filter((n) => n.kind === "lib").length,
      models: nodes.filter((n) => n.kind === "model").length,
      edges: sortedEdges.length,
      untouchedModels: modelNames.filter((name) => !touchedModels.has(name)).sort(),
    },
  };
}

// ---------------------------------------------------------------------------
// Focus: the part of the map around one node
// ---------------------------------------------------------------------------

/**
 * The nodes within `depth` hops of `id`, either direction, capped so a hub like
 * `lib:prisma` or `model:Student` cannot drag in the entire system. Closest
 * first; ties broken by how connected a node is.
 */
export function neighborhood(graph: Pick<BackendGraph, "nodes" | "edges">, id: string, depth = 2, cap = 140): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    (adjacency.get(edge.from) ?? adjacency.set(edge.from, []).get(edge.from)!).push(edge.to);
    (adjacency.get(edge.to) ?? adjacency.set(edge.to, []).get(edge.to)!).push(edge.from);
  }
  const seen = new Set<string>([id]);
  let frontier = [id];
  for (let hop = 0; hop < depth && seen.size < cap; hop++) {
    const next: string[] = [];
    for (const current of frontier) {
      const neighbours = [...(adjacency.get(current) ?? [])].sort(
        (a, b) => (adjacency.get(b)?.length ?? 0) - (adjacency.get(a)?.length ?? 0),
      );
      for (const neighbour of neighbours) {
        if (seen.size >= cap) break;
        if (!seen.has(neighbour)) {
          seen.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Layout — three columns, like the reference: tables | libraries | routes
// ---------------------------------------------------------------------------

export type Placed = { id: string; x: number; y: number };

export const LAYOUT = { columnWidth: 300, rowHeight: 30, nodeWidth: 210, nodeHeight: 22 } as const;

const COLUMN_OF: Record<GraphNodeKind, number> = { model: 0, lib: 1, route: 2 };

/**
 * Column per kind, then a few barycentre sweeps so connected nodes end up at
 * similar heights and the curves between columns stay short and mostly uncrossed.
 * Deterministic: same graph in, same picture out.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], sweeps = 4): Placed[] {
  const columns: GraphNode[][] = [[], [], []];
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) columns[COLUMN_OF[node.kind]].push(node);

  const ids = new Set(nodes.map((n) => n.id));
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    (neighbours.get(edge.from) ?? neighbours.set(edge.from, []).get(edge.from)!).push(edge.to);
    (neighbours.get(edge.to) ?? neighbours.set(edge.to, []).get(edge.to)!).push(edge.from);
  }

  const position = new Map<string, number>();
  const reindex = () => columns.forEach((column) => column.forEach((node, index) => position.set(node.id, index / Math.max(column.length, 1))));
  reindex();

  const order = [1, 2, 0, 1];
  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (const columnIndex of order) {
      const column = columns[columnIndex];
      const score = (node: GraphNode) => {
        const near = neighbours.get(node.id);
        if (!near?.length) return position.get(node.id) ?? 0;
        return near.reduce((sum, other) => sum + (position.get(other) ?? 0), 0) / near.length;
      };
      const scored = column.map((node) => ({ node, score: score(node) }));
      scored.sort((a, b) => a.score - b.score || a.node.id.localeCompare(b.node.id));
      columns[columnIndex] = scored.map((entry) => entry.node);
      reindex();
    }
  }

  const placed: Placed[] = [];
  columns.forEach((column, columnIndex) => {
    column.forEach((node, index) => {
      placed.push({ id: node.id, x: columnIndex * LAYOUT.columnWidth, y: index * LAYOUT.rowHeight });
    });
  });
  return placed;
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

/**
 * Libraries nearly everything imports — the database client, sign-in, the
 * permission gate, the tenant scope. True, and useless on a map: they turn a
 * picture of how the system is wired into a hairball with four hubs in it.
 * Hidden by default; the console can show them.
 */
export const PLUMBING_LIBS = new Set(["lib:prisma", "lib:auth", "lib:admin-roles", "lib:tenant/context"]);

export const isPlumbing = (id: string) => PLUMBING_LIBS.has(id);
