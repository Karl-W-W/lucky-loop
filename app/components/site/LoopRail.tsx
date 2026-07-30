import { feedbackEdges, getLoopDef, orderedNodes } from "@/app/loop/data";

/* The five nodes of the loop, as a hairline rail.
 *
 * These used to be a hardcoded array whose hints ("execute tools", "update
 * memory") described capabilities the graph does not have, and whose closing
 * line said "Adapt feeds back into Perceive" — the wrong edge. The real
 * conditional edge is adapt -> decide, and /loop said so one click away, so the
 * homepage contradicted the product it was introducing.
 *
 * Now derived from data/loop-def.json, the same file /war's Flow panel and
 * /loop render, which loop/run.py regenerates from the compiled graph on every
 * run. The homepage can no longer describe a loop that isn't the one that ran.
 */

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function LoopRail() {
  const nodes = orderedNodes();
  const back = feedbackEdges()[0];
  const def = getLoopDef();

  return (
    <div className="ll-rail-wrap">
      <ol className="ll-rail">
        {nodes.map((node, i) => (
          <li key={node.id} className="ll-rail-node">
            <span className="ll-rail-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="ll-rail-name">{cap(node.id)}</span>
            <span className="ll-rail-hint">{node.hint}</span>
          </li>
        ))}
      </ol>
      <p className="ll-rail-return">
        <span className="ll-brass-tick" aria-hidden />
        {back
          ? `${cap(back.from)} feeds back into ${cap(back.to)} when the pass fails its own check. That is the loop.`
          : `${def.nodes.length} nodes, run in order.`}
      </p>
    </div>
  );
}
