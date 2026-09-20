"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LAYOUT,
  isPlumbing,
  layoutGraph,
  neighborhood,
  type BackendGraph,
  type GraphEdge,
  type GraphNode,
  type GraphNodeKind,
} from "@/lib/backend-graph";

type Overlay = Record<string, { incidents: number; occurrences: number; worst: string; drift: boolean }>;
type Transform = { x: number; y: number; k: number };

const KIND: Record<GraphNodeKind, { fill: string; stroke: string; text: string; name: string }> = {
  model: { fill: "#0f766e", stroke: "#2dd4bf", text: "#ccfbf1", name: "Tables" },
  lib: { fill: "#1e40af", stroke: "#60a5fa", text: "#dbeafe", name: "Libraries" },
  route: { fill: "#b45309", stroke: "#fbbf24", text: "#fef3c7", name: "API routes" },
};
const EDGE = { import: "#64748b", read: "#2dd4bf", write: "#f59e0b" } as const;
const SEVERITY_COLOR: Record<string, string> = { critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#94a3b8" };

/**
 * Where the map opens, and one-click starting points for the areas that matter
 * most. The whole system is ~730 boxes and 10,000px tall — fitted to a screen it
 * is an unreadable sliver — so the map opens on one area at a time. Ids that are
 * not in the current graph are simply not offered.
 */
const DEFAULT_FOCUS = "lib:student-access";
const STARTS: Array<{ label: string; id: string; depth: number }> = [
  { label: "Access gate", id: "lib:student-access", depth: 1 },
  { label: "Payments", id: "lib:payment", depth: 1 },
  { label: "Tutor assignment", id: "lib:lecturer-assignment", depth: 1 },
  { label: "Live classes", id: "lib:live-classroom", depth: 1 },
  { label: "Notifications", id: "lib:notify", depth: 1 },
  { label: "Incident register", id: "lib:incidents", depth: 2 },
];

const MIN_K = 0.04;
const MAX_K = 3;
const LABELS_FROM_K = 0.5;

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const w = LAYOUT.nodeWidth;
  const h = LAYOUT.nodeHeight / 2;
  if (a.x === b.x) {
    // Same column (a library calling a library): loop out to the right and back.
    const x = a.x + w;
    const bow = 60 + Math.min(Math.abs(a.y - b.y) / 6, 90);
    return `M${x},${a.y + h} C${x + bow},${a.y + h} ${x + bow},${b.y + h} ${x},${b.y + h}`;
  }
  const [left, right] = a.x < b.x ? [a, b] : [b, a];
  const x1 = left.x + w;
  const y1 = left.y + h;
  const x2 = right.x;
  const y2 = right.y + h;
  const dx = (x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

const shortLabel = (node: GraphNode) => {
  const text = node.kind === "route" ? node.label.replace(/^\/api\//, "") : node.label;
  return text.length > 30 ? `${text.slice(0, 29)}…` : text;
};

export default function BackendMap() {
  const [graph, setGraph] = useState<BackendGraph | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({});
  const [error, setError] = useState<string | null>(null);
  const [showPlumbing, setShowPlumbing] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(DEFAULT_FOCUS);
  const [depth, setDepth] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [t, setT] = useState<Transform>({ x: 20, y: 20, k: 0.2 });

  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  /* ---- data ---------------------------------------------------------- */
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/developer/graph")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((g: BackendGraph) => alive && setGraph(g))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/admin/developer/graph?part=overlay")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setOverlay(d.overlay ?? {}))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /* ---- what is on screen -------------------------------------------- */
  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);

  // A focus that is not in this graph (renamed library, older build) falls back to everything.
  const focus = focusId && byId.has(focusId) ? focusId : null;

  const shown = useMemo(() => {
    if (!graph) return null;
    const keep = (id: string) => showPlumbing || !isPlumbing(id) || id === focus;
    const nodes0 = graph.nodes.filter((n) => keep(n.id));
    const edges0 = graph.edges.filter((e) => keep(e.from) && keep(e.to));
    const ids = focus ? neighborhood({ nodes: nodes0, edges: edges0 }, focus, depth) : null;
    const nodes = ids ? nodes0.filter((n) => ids.has(n.id)) : nodes0;
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = edges0.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
    const placed = layoutGraph(nodes, edges);
    return { nodes, edges, pos: new Map(placed.map((p) => [p.id, p])) };
  }, [graph, showPlumbing, focus, depth]);

  // `whole` fits everything on screen; otherwise open at a READABLE zoom from the top,
  // so a tall map is a list you scroll rather than a sliver you squint at.
  const fit = useCallback((whole = false) => {
    const box = boxRef.current;
    if (!box || !shown || shown.nodes.length === 0) return;
    let maxX = 0;
    let maxY = 0;
    shown.pos.forEach((p) => {
      maxX = Math.max(maxX, p.x + LAYOUT.nodeWidth);
      maxY = Math.max(maxY, p.y + LAYOUT.nodeHeight);
    });
    const pad = 24;
    const widthK = (box.clientWidth - pad * 2) / maxX;
    const bothK = Math.min(widthK, (box.clientHeight - pad * 2) / maxY, 1);
    const k = whole ? bothK : Math.max(bothK, Math.min(widthK, 0.6));
    const kk = Math.max(Math.min(k, MAX_K), MIN_K);
    setT({ k: kk, x: (box.clientWidth - maxX * kk) / 2, y: pad });
  }, [shown]);

  useEffect(() => {
    fit();
  }, [fit]);
  // A focus is chosen from outside the canvas (search, chips, the details panel): show it from the top.

  /* ---- pan and zoom -------------------------------------------------- */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setT((cur) => {
        const k = Math.min(Math.max(cur.k * Math.exp(-event.deltaY * 0.0015), MIN_K), MAX_K);
        const ratio = k / cur.k;
        return { k, x: px - (px - cur.x) * ratio, y: py - (py - cur.y) * ratio };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [graph]);

  const zoomBy = (factor: number) => {
    const box = boxRef.current;
    if (!box) return;
    const px = box.clientWidth / 2;
    const py = box.clientHeight / 2;
    setT((cur) => {
      const k = Math.min(Math.max(cur.k * factor, MIN_K), MAX_K);
      const ratio = k / cur.k;
      return { k, x: px - (px - cur.x) * ratio, y: py - (py - cur.y) * ratio };
    });
  };

  /* ---- highlighting -------------------------------------------------- */
  const activeId = hoverId ?? selectedId;
  const linked = useMemo(() => {
    if (!activeId || !shown) return null;
    const ids = new Set<string>([activeId]);
    for (const e of shown.edges) {
      if (e.from === activeId) ids.add(e.to);
      if (e.to === activeId) ids.add(e.from);
    }
    return ids;
  }, [activeId, shown]);

  // Drawn once per layout; hovering only re-renders the small highlight layer.
  const baseEdges = useMemo(() => {
    if (!shown) return null;
    return shown.edges.map((e) => {
      const a = shown.pos.get(e.from);
      const b = shown.pos.get(e.to);
      if (!a || !b) return null;
      return <path key={`${e.from}>${e.to}`} d={edgePath(a, b)} stroke={EDGE[e.mode]} strokeWidth={1} fill="none" />;
    });
  }, [shown]);

  const hotEdges = useMemo(() => {
    if (!shown || !activeId) return null;
    return shown.edges
      .filter((e) => e.from === activeId || e.to === activeId)
      .map((e) => {
        const a = shown.pos.get(e.from);
        const b = shown.pos.get(e.to);
        if (!a || !b) return null;
        return <path key={`${e.from}>${e.to}`} d={edgePath(a, b)} stroke={EDGE[e.mode]} strokeWidth={2.2} fill="none" />;
      });
  }, [shown, activeId]);

  /* ---- search & details --------------------------------------------- */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !graph) return [];
    return graph.nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
  }, [query, graph]);

  const hot = useMemo(
    () =>
      Object.entries(overlay)
        .filter(([route]) => byId.has(`route:${route}`))
        .sort((a, b) => b[1].occurrences - a[1].occurrences)
        .slice(0, 6),
    [overlay, byId],
  );

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const relations = useMemo(() => {
    if (!selected || !graph) return null;
    const outgoing = graph.edges.filter((e) => e.from === selected.id);
    const incoming = graph.edges.filter((e) => e.to === selected.id);
    return { outgoing, incoming };
  }, [selected, graph]);

  const focusOn = (id: string) => {
    setFocusId(id);
    setSelectedId(id);
    setQuery("");
  };

  if (error) return <p className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-300">Could not load the map: {error}</p>;
  if (!graph || !shown) return <p className="p-6 text-sm text-[var(--muted)]">Reading the backend…</p>;

  const showLabels = t.k >= LABELS_FROM_K;
  const dim = (id: string) => (linked ? !linked.has(id) : false);

  const listEdges = (edges: GraphEdge[], side: "from" | "to", limit = 14) => (
    <ul className="mt-1 space-y-1">
      {edges.slice(0, limit).map((e) => {
        const otherId = side === "from" ? e.to : e.from;
        const other = byId.get(otherId);
        if (!other) return null;
        return (
          <li key={otherId}>
            <button
              type="button"
              onClick={() => setSelectedId(otherId)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-[11px] hover:bg-white/10"
            >
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: KIND[other.kind].stroke }} />
              <span className="min-w-0 flex-1 truncate">{other.label}</span>
              {e.mode !== "import" && (
                <span className="shrink-0 text-[9px] uppercase tracking-wide" style={{ color: EDGE[e.mode] }}>
                  {e.mode}
                </span>
              )}
            </button>
          </li>
        );
      })}
      {edges.length > limit && <li className="px-1.5 text-[10px] text-white/40">+ {edges.length - limit} more</li>}
    </ul>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a table, library or route…"
            className="w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
              {matches.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => focusOn(n.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-2,rgba(128,128,128,.12))]"
                  >
                    <span className="h-2 w-2 rounded-sm" style={{ background: KIND[n.kind].stroke }} />
                    <span className="truncate">{n.label}</span>
                    <span className="ml-auto text-[10px] text-[var(--muted)]">{KIND[n.kind].name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {focus ? (
          <>
            <button type="button" onClick={() => { setFocusId(null); setSelectedId(null); }} className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold">
              Show everything ({graph.nodes.length})
            </button>
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              Reach
              <select value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1">
                <option value={1}>1 hop</option>
                <option value={2}>2 hops</option>
                <option value={3}>3 hops</option>
              </select>
            </label>
          </>
        ) : null}

        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={showPlumbing} onChange={(e) => setShowPlumbing(e.target.checked)} />
          Show plumbing (database client, sign-in, permissions)
        </label>

        <span className="ml-auto text-[11px] text-[var(--muted)]">
          {shown.nodes.length} of {graph.nodes.length} nodes · {shown.edges.length} links · read from the source at build time
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-[var(--muted)]">Start from:</span>
        {STARTS.filter((start) => byId.has(start.id)).map((start) => (
          <button
            key={start.id}
            type="button"
            onClick={() => {
              setDepth(start.depth);
              focusOn(start.id);
            }}
            className={`rounded-full border px-3 py-1 font-semibold ${
              focus === start.id ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)] hover:bg-black/5"
            }`}
          >
            {start.label}
          </button>
        ))}
      </div>

      {hot.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-red-400">On fire now:</span>
          {hot.map(([route, info]) => (
            <button
              key={route}
              type="button"
              onClick={() => focusOn(`route:${route}`)}
              className="rounded-full border px-2.5 py-1 hover:bg-white/5"
              style={{ borderColor: SEVERITY_COLOR[info.worst], color: SEVERITY_COLOR[info.worst] }}
            >
              {route.replace(/^\/api\//, "")} · {info.incidents}
              {info.drift ? " · drift" : ""}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <div
          ref={boxRef}
          className="relative h-[660px] min-w-0 flex-1 overflow-hidden rounded-3xl border border-white/10"
          style={{ background: "radial-gradient(1200px 600px at 20% 0%, #14213d 0%, #0b1220 60%)" }}
        >
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            className="cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={(e) => {
              // No capture yet: capturing here would retarget the coming click to the
              // svg and a plain click on a node would never select it.
              drag.current = { x: e.clientX, y: e.clientY, ox: t.x, oy: t.y, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const dx = e.clientX - d.x;
              const dy = e.clientY - d.y;
              if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) {
                d.moved = true;
                // A real drag: keep receiving moves even if the cursor leaves the canvas.
                (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
                setHoverId(null);
              }
              if (d.moved) setT((cur) => ({ ...cur, x: d.ox + dx, y: d.oy + dy }));
            }}
            onPointerUp={(e) => {
              const moved = drag.current?.moved;
              drag.current = null;
              const svgEl = e.currentTarget as SVGSVGElement;
              if (svgEl.hasPointerCapture(e.pointerId)) svgEl.releasePointerCapture(e.pointerId);
              // A click on empty canvas clears the selection; a drag does not.
              if (!moved && (e.target as Element).tagName === "svg") setSelectedId(null);
            }}
          >
            <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
              <g opacity={linked ? 0.07 : 0.22}>{baseEdges}</g>
              <g opacity={0.95}>{hotEdges}</g>

              {shown.nodes.map((n) => {
                const p = shown.pos.get(n.id)!;
                const style = KIND[n.kind];
                const hotInfo = n.kind === "route" ? overlay[n.label] : undefined;
                const isSelected = n.id === selectedId;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x},${p.y})`}
                    opacity={dim(n.id) ? 0.18 : 1}
                    className="cursor-pointer"
                    onPointerEnter={() => setHoverId(n.id)}
                    onPointerLeave={() => setHoverId(null)}
                    onClick={() => !drag.current?.moved && setSelectedId(n.id)}
                    onDoubleClick={() => focusOn(n.id)}
                  >
                    <rect
                      width={LAYOUT.nodeWidth}
                      height={LAYOUT.nodeHeight}
                      rx={5}
                      fill={style.fill}
                      stroke={hotInfo ? SEVERITY_COLOR[hotInfo.worst] : isSelected ? "#fff" : style.stroke}
                      strokeWidth={hotInfo || isSelected ? 2.4 : 1}
                    />
                    {showLabels && (
                      <text x={8} y={LAYOUT.nodeHeight / 2 + 4} fontSize={11} fill={style.text} style={{ pointerEvents: "none" }}>
                        {shortLabel(n)}
                      </text>
                    )}
                    {hotInfo && (
                      <g>
                        <circle cx={LAYOUT.nodeWidth} cy={0} r={8} fill={SEVERITY_COLOR[hotInfo.worst]} />
                        <text x={LAYOUT.nodeWidth} y={3.5} fontSize={9} fontWeight={700} fill="#fff" textAnchor="middle" style={{ pointerEvents: "none" }}>
                          {hotInfo.incidents}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          <div className="pointer-events-none absolute left-3 top-3 flex gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            {(Object.keys(KIND) as GraphNodeKind[]).map((k) => (
              <span key={k} className="rounded-full px-2 py-0.5" style={{ background: KIND[k].fill, color: KIND[k].text }}>
                {KIND[k].name}
              </span>
            ))}
          </div>
          <div className="absolute bottom-3 left-3 flex gap-1.5">
            <button type="button" onClick={() => zoomBy(1.3)} className="h-8 w-8 rounded-lg bg-white/10 text-white hover:bg-white/20" aria-label="Zoom in">+</button>
            <button type="button" onClick={() => zoomBy(1 / 1.3)} className="h-8 w-8 rounded-lg bg-white/10 text-white hover:bg-white/20" aria-label="Zoom out">−</button>
            <button type="button" onClick={() => fit(true)} className="h-8 rounded-lg bg-white/10 px-3 text-xs text-white hover:bg-white/20">Fit all</button>
          </div>
          <p className="pointer-events-none absolute bottom-3 right-3 text-[10px] text-white/40">
            drag to pan · scroll to zoom · click a box for detail · double-click to focus
          </p>
        </div>

        {selected && relations && (
          <aside className="hidden h-[660px] w-72 shrink-0 overflow-y-auto rounded-3xl border border-white/10 bg-[#0b1220] p-4 text-white lg:block">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded" style={{ background: KIND[selected.kind].stroke }} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">{KIND[selected.kind].name.replace(/s$/, "")}</span>
            </div>
            <h3 className="mt-1 break-all text-sm font-bold">{selected.label}</h3>
            {selected.file && <p className="mt-1 break-all text-[10px] text-white/40">{selected.file}</p>}
            {selected.methods && selected.methods.length > 0 && (
              <p className="mt-2 flex gap-1">
                {selected.methods.map((m) => (
                  <span key={m} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold">{m}</span>
                ))}
              </p>
            )}

            {selected.kind === "route" && overlay[selected.label] && (
              <div className="mt-3 rounded-xl border p-2.5 text-xs" style={{ borderColor: SEVERITY_COLOR[overlay[selected.label].worst] }}>
                <p className="font-bold" style={{ color: SEVERITY_COLOR[overlay[selected.label].worst] }}>
                  {overlay[selected.label].incidents} open incident{overlay[selected.label].incidents === 1 ? "" : "s"}
                </p>
                <p className="text-white/60">{overlay[selected.label].occurrences} occurrences · worst: {overlay[selected.label].worst}</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => focusOn(selected.id)}
              className="mt-3 w-full rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20"
            >
              Focus on this
            </button>

            {relations.outgoing.length > 0 && (
              <section className="mt-4">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/50">Uses ({relations.outgoing.length})</h4>
                {listEdges(relations.outgoing, "from")}
              </section>
            )}
            {relations.incoming.length > 0 && (
              <section className="mt-4">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                  {selected.kind === "model" ? "Touched by" : "Used by"} ({relations.incoming.length})
                </h4>
                {listEdges(relations.incoming, "to")}
              </section>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
