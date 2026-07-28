// The five nodes of the loop, as a hairline rail.
// Names and hints match the flow rendered in the War Room.
const NODES = [
  { name: "Perceive", hint: "read state" },
  { name: "Decide", hint: "plan the next move" },
  { name: "Act", hint: "execute tools" },
  { name: "Evaluate", hint: "score the outcome" },
  { name: "Adapt", hint: "update memory" },
];

export default function LoopRail() {
  return (
    <div className="ll-rail-wrap">
      <ol className="ll-rail">
        {NODES.map((node, i) => (
          <li key={node.name} className="ll-rail-node">
            <span className="ll-rail-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="ll-rail-name">{node.name}</span>
            <span className="ll-rail-hint">{node.hint}</span>
          </li>
        ))}
      </ol>
      <p className="ll-rail-return">
        <span className="ll-brass-tick" aria-hidden />
        Adapt feeds back into Perceive. That is the loop.
      </p>
    </div>
  );
}
