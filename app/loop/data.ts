import defJson from "@/data/loop-def.json";
import runsJson from "@/data/loop-runs.json";

/* Same contract as /war: the page server-renders committed JSON and nothing
 * else. The difference is provenance — these two files are written by
 * `loop/run.py`, which derives the definition from the compiled LangGraph and
 * emits each pass only after the redaction gates pass. Neither file is
 * hand-authored. See loop/README.md. */

export type LoopNodeDef = { id: string; hint: string };
export type LoopEdgeDef = { from: string; to: string; conditional: boolean };

export type LoopDef = {
  graphVersion: string;
  framework: string;
  derivedFrom: string;
  nodes: LoopNodeDef[];
  edges: LoopEdgeDef[];
  terminationReasons: string[];
  assertions: string[];
  generatedAt: string;
};

export type NodeOutput = Record<string, string | number | boolean>;
export type NodeStep = { node: string; output: NodeOutput };

export type LoopRun = {
  runId: string;
  idempotencyKey: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  model: string;
  graphVersion: string;
  terminationReason: string;
  iterations: number;
  /** "schedule" when systemd fired it, "manual" when a human did. Absent on
   *  every run written before 2026-08-11, which is why readers must treat
   *  undefined as "unknown", never as "manual". */
  trigger?: "schedule" | "manual";
  /** Links the pass to the decision+outcome events it wrote to the vault.
   *  Absent on runs written before the write-back existed. */
  vault?: { decisionId: string; source: string };
  item: NodeOutput;
  nodes: NodeStep[];
};

/* Each node emits a different shape, so TS widens the imported `nodes` array to
 * a union in which every key is optionally undefined — structurally
 * incompatible with NodeOutput's index signature. The JSON is written by
 * loop/run.py and gated before it lands, so the double assertion is the honest
 * boundary: the file's shape is enforced upstream, not by the compiler. */
const def = defJson as unknown as LoopDef;
const runs = (runsJson as unknown as { runs: LoopRun[] }).runs;

export function getLoopDef(): LoopDef {
  return def;
}

export function getRuns(): LoopRun[] {
  return runs;
}

export function getLatestRun(): LoopRun | null {
  return runs[0] ?? null;
}

/* The one place the success rule lives on the web side. `converged` is the only
 * terminationReason that counts as a pass — cap exhaustion is a stop, not a
 * win, and must never render as one. Mirrors loop/run.py's exit contract. */
export function isConverged(run: LoopRun): boolean {
  return run.terminationReason === "converged";
}

/** Node ids in execution order, following the graph's own forward edges. */
export function orderedNodes(): LoopNodeDef[] {
  const forward = new Map<string, string>();
  for (const e of def.edges) {
    if (!e.conditional && e.from !== "__start__" && e.to !== "__end__") {
      forward.set(e.from, e.to);
    }
  }
  const start = def.edges.find((e) => e.from === "__start__")?.to;
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const out: LoopNodeDef[] = [];
  let cursor = start;
  while (cursor && byId.has(cursor) && out.length <= def.nodes.length) {
    out.push(byId.get(cursor)!);
    cursor = forward.get(cursor);
  }
  /* Fall back to declaration order if the walk did not cover every node — a
   * partial diagram would misrepresent the graph. */
  return out.length === def.nodes.length ? out : def.nodes;
}

/** Edges that send the loop backwards — what makes this a loop, not a pipeline. */
export function feedbackEdges(): LoopEdgeDef[] {
  return def.edges.filter((e) => e.conditional && e.to !== "__end__");
}

export function fmtUtc(iso: string): string {
  return iso.replace("T", " ").replace("Z", " UTC");
}
