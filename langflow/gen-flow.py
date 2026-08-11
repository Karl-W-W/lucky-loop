#!/usr/bin/env python3
"""Paint the Lucky Loop backend into ONE Langflow flow — derived, not drawn.

WHY THIS EXISTS
---------------
`/war` already refuses hand-authored diagrams: `data/loop-def.json` is derived
from the compiled LangGraph via `get_graph()`, so the Flow panel cannot drift
from the code that ran. This script applies the same rule one level up: the
Langflow canvas is generated FROM the repository, so the architecture picture
cannot drift from the architecture.

Every node embeds a real excerpt, read at generation time from the file it
names. If the code moves, the excerpt moves. If a file disappears, generation
fails loudly rather than shipping a picture of something that is gone.

WHAT IT EMITS
-------------
`langflow/lucky-loop-architecture.json` — a Langflow 1.9.2 flow. Import it in
Langflow Desktop (Projects -> upload icon) or POST it with `push-flow.sh`.

The canvas reads left to right, one column per layer:

    ingest -> runners -> the graph -> gates -> data -> render -> gaps

VISUAL VOCABULARY (uses Langflow's own badges, so nothing needs a key)
    plain node      ships today and is exercised by a real pass
    "Beta" badge    exists but has never been proven end to end
    "Legacy" badge  a GAP — documented or specified, but not implemented

This is an OBSERVATION SURFACE, not a runnable pipeline. The nodes are real
Langflow components and the graph is well formed, but pressing Play runs a
mirror of the architecture, not the architecture. The loop that does real work
is `loop/graph.py` on the local runner.

Usage:
    python3 langflow/gen-flow.py                     # write the JSON
    python3 langflow/gen-flow.py --check             # fail if excerpts are stale
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "langflow" / "lucky-loop-architecture.json"

FLOW_ID = "1ucky100-a4ch-4d0c-9b1e-0000000000ff"
LF_VERSION = "1.9.2"

# Column x-positions. Node width is 320, so 460 leaves a 140px gutter.
#
# Langflow puts the input handle on a card's LEFT edge and the output handle on
# its RIGHT edge, so a sequential chain MUST advance along x. An earlier version
# of this file stacked the five loop stages in one column; every edge then left
# the right edge and doubled back to the left edge of the card below, which drew
# five ugly loops and read as a cycle where there is none. One column per stage.
#
# Two horizontal bands share the canvas:
#   rows 0-7   the loop pipeline    (inbox -> runner -> graph -> gates -> data)
#   rows 8-10  the web pipeline     (git/Vercel -> build scripts -> data)
# They converge on the same data column, which is exactly what happens in the
# repo: committed JSON is the only thing both halves have in common.
X = {
    "inbox": 0,
    "run": 460,
    "prep": 920,
    "compile": 1380,
    "n1": 1840,
    "n2": 2300,
    "n3": 2760,
    "n4": 3220,
    "n5": 3680,
    "route": 4140,
    "gate1": 4600,
    "gate2": 5060,
    "exit": 5520,
    "data": 5980,
    "access": 6440,
    "pages": 6900,
}
ROW = 340  # vertical pitch


# ---------------------------------------------------------------------------
# excerpt extraction — the part that makes this a mirror rather than a drawing
# ---------------------------------------------------------------------------


def excerpt(relpath: str, anchor: str | None = None, limit: int = 42) -> str:
    """Read `limit` lines from `relpath`, starting at the line matching `anchor`.

    `anchor` is a regex. A missing file or an anchor that no longer matches is a
    hard error: a stale excerpt is exactly the drift this script exists to
    prevent, so it must break the build rather than ship a lie.
    """
    path = REPO / relpath
    if not path.exists():
        raise SystemExit(f"gen-flow: {relpath} does not exist — the architecture moved.")
    lines = path.read_text(encoding="utf-8").splitlines()

    start = 0
    if anchor:
        pattern = re.compile(anchor)
        for i, line in enumerate(lines):
            if pattern.search(line):
                start = i
                break
        else:
            raise SystemExit(
                f"gen-flow: anchor {anchor!r} no longer matches in {relpath}. "
                "The code moved — update the node definition, do not loosen the anchor."
            )

    chunk = lines[start : start + limit]
    # Trim trailing blank lines so the code panel does not open on whitespace.
    while chunk and not chunk[-1].strip():
        chunk.pop()
    return "\n".join(chunk)


def component_code(node: dict) -> str:
    """A valid Langflow component that carries the real source as comments.

    The excerpt is embedded as `#` comments, never a docstring: the mirrored
    files contain triple quotes of their own, and a quoting collision here would
    produce a component that fails to parse in the code panel.
    """
    body = node.get("source", "")
    commented = "\n".join(("    # " + ln).rstrip() for ln in body.splitlines()) or "    # (none)"
    origin = node.get("origin", "—")
    cls = "LL" + re.sub(r"[^A-Za-z0-9]", "", node["key"].title())

    return f'''from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output
from lfx.schema.message import Message


class {cls}(Component):
    """Lucky Loop architecture mirror — {node["title"]}.

    Generated by langflow/gen-flow.py from the repository. Do not edit here;
    edit the source file and regenerate, or the picture stops being true.
    """

    display_name = {node["title"]!r}
    description = {node["blurb"]!r}
    icon = {node["icon"]!r}
    name = {cls!r}

    # ======================================================================
    # ROLE
    # {node["role"]}
    #
    # STATUS: {node["status"].upper()}
    # SOURCE: {origin}
    # ======================================================================
    #
    # ---- verbatim excerpt, read at generation time ----------------------
{commented}
    # ---------------------------------------------------------------------

    SOURCE_OF_TRUTH = {origin!r}

    inputs = [
        MessageTextInput(
            name="input_value",
            display_name="Upstream",
            info="What flows into this stage.",
            value="",
        ),
    ]

    outputs = [
        Output(display_name="Downstream", name="output", method="build_output"),
    ]

    def build_output(self) -> Message:
        return Message(text=f"{{self.display_name}} <- {{self.SOURCE_OF_TRUTH}}")
'''


# ---------------------------------------------------------------------------
# Langflow 1.9.2 wire format
# ---------------------------------------------------------------------------

Q = "œ"  # Langflow escapes `"` as `œ` inside handle strings


def scaped(pairs: list[tuple[str, object]]) -> str:
    """Langflow's `scapedJSONStringfy`: compact JSON with `"` replaced by `œ`."""
    out = []
    for key, value in pairs:
        if isinstance(value, list):
            inner = ",".join(f"{Q}{v}{Q}" for v in value)
            out.append(f"{Q}{key}{Q}:[{inner}]")
        else:
            out.append(f"{Q}{key}{Q}:{Q}{value}{Q}")
    return "{" + ",".join(out) + "}"


def make_node(spec: dict) -> dict:
    nid = spec["id"]
    code = component_code(spec)
    return {
        "id": nid,
        "type": "genericNode",
        "position": {"x": spec["x"], "y": spec["y"]},
        "measured": {"width": 320, "height": 260},
        "width": 320,
        "height": 260,
        "selected": False,
        "dragging": False,
        "data": {
            "id": nid,
            "type": "CustomComponent",
            "display_name": spec["title"],
            "description": spec["blurb"],
            "node": {
                "base_classes": ["Message"],
                "beta": spec["status"] == "unverified",
                "conditional_paths": [],
                "custom_fields": {},
                "description": spec["blurb"],
                "display_name": spec["title"],
                "documentation": "",
                "edited": True,
                "field_order": ["input_value"],
                "frozen": False,
                "icon": spec["icon"],
                "legacy": spec["status"] == "gap",
                "lf_version": LF_VERSION,
                "metadata": {},
                "minimized": False,
                "output_types": [],
                "outputs": [
                    {
                        "allows_loop": False,
                        "cache": True,
                        "display_name": "Downstream",
                        "group_outputs": False,
                        "method": "build_output",
                        "name": "output",
                        "selected": "Message",
                        "tool_mode": False,
                        "types": ["Message"],
                        "value": "__UNDEFINED__",
                    }
                ],
                "pinned": False,
                "template": {
                    "_type": "Component",
                    "code": {
                        "advanced": True,
                        "dynamic": True,
                        "fileTypes": [],
                        "file_path": "",
                        "info": "",
                        "list": False,
                        "load_from_db": False,
                        "multiline": True,
                        "name": "code",
                        "password": False,
                        "placeholder": "",
                        "required": True,
                        "show": True,
                        "title_case": False,
                        "type": "code",
                        "value": code,
                    },
                    "input_value": {
                        "_input_type": "MessageTextInput",
                        "advanced": False,
                        "display_name": "Upstream",
                        "dynamic": False,
                        "info": "What flows into this stage.",
                        "input_types": ["Message"],
                        "list": False,
                        "list_add_label": "Add More",
                        "load_from_db": False,
                        "name": "input_value",
                        "placeholder": "",
                        "required": False,
                        "show": True,
                        "title_case": False,
                        "tool_mode": False,
                        "trace_as_input": True,
                        "trace_as_metadata": True,
                        "type": "str",
                        "value": spec["role"],
                    },
                },
                "tool_mode": False,
            },
        },
    }


def make_edge(src: str, dst: str, label: str = "", dashed: bool = False) -> dict:
    src_handle = scaped(
        [("dataType", "CustomComponent"), ("id", src), ("name", "output"), ("output_types", ["Message"])]
    )
    dst_handle = scaped(
        [("fieldName", "input_value"), ("id", dst), ("inputTypes", ["Message"]), ("type", "str")]
    )
    edge = {
        "id": f"reactflow__edge-{src}{src_handle}-{dst}{dst_handle}",
        "source": src,
        "target": dst,
        "sourceHandle": src_handle,
        "targetHandle": dst_handle,
        "animated": dashed,
        "className": "",
        "selected": False,
        "data": {
            "sourceHandle": {
                "dataType": "CustomComponent",
                "id": src,
                "name": "output",
                "output_types": ["Message"],
            },
            "targetHandle": {
                "fieldName": "input_value",
                "id": dst,
                "inputTypes": ["Message"],
                "type": "str",
            },
        },
    }
    if label:
        edge["label"] = label
    return edge


# ---------------------------------------------------------------------------
# THE ARCHITECTURE
#
# status: "live"       ships today, exercised by a real pass
#         "unverified" exists, never proven end to end  -> Beta badge
#         "gap"        specified or documented, not implemented -> Legacy badge
# ---------------------------------------------------------------------------

NODES: list[dict] = [
    # ---------------- INGEST ----------------
    dict(
        key="inbox", col="inbox", row=0, icon="inbox", status="live",
        title="loop/inbox/ — the only real input",
        blurb="One exported admin item. Gitignored: raw documents never reach git.",
        role="A real mail/bill item is dropped here by hand. Exactly one item per pass.",
        origin="loop/run.py :: pick_item + .gitignore",
        src=("loop/run.py", r"^def pick_item", 12),
    ),
    dict(
        key="gitlog", col="gate1", row=5, icon="git-commit", status="live",
        title="git log — commit history",
        blurb="The Growth Ledger's upstream. Read at build time, never at request time.",
        role="Commit history is the raw material for the ledger rendered on /war.",
        origin="scripts/gen-ledger.mjs :: deriveFromGit",
        src=("scripts/gen-ledger.mjs", r"^function deriveFromGit", 24),
    ),
    dict(
        key="vercelenv", col="gate1", row=6, icon="cloud", status="live",
        title="Vercel platform — env + API",
        blurb="VERCEL_* system env during a build; api.vercel.com/v6 for the local reconcile.",
        role="The two ways the repo can learn what Vercel actually deployed.",
        origin="scripts/capture-deploy.mjs :: currentDeployFromEnv",
        src=("scripts/capture-deploy.mjs", r"^function currentDeployFromEnv", 26),
    ),

    # ---------------- RUNNERS ----------------
    dict(
        key="runpy", col="run", row=0, icon="play", status="live",
        title="loop/run.py — the runner",
        blurb="Picks one item, derives the definition, invokes the graph, gates, writes.",
        role="The orchestrator. Everything the loop emits passes through this main().",
        origin="loop/run.py :: main",
        src=("loop/run.py", r"^def main\(\)", 30),
    ),
    dict(
        key="idem", col="prep", row=0, icon="fingerprint", status="live",
        title="Idempotency key",
        blurb="sha256(raw + graphVersion + model)[:16]. Same inputs can never record twice.",
        role="Re-running the same item on the same graph and model exits 2 and writes nothing.",
        origin="loop/run.py :: main (idempotency block)",
        src=("loop/run.py", r"# Idempotency: same bytes", 12),
    ),
    dict(
        key="genledger", col="gate2", row=5, icon="hammer", status="live",
        title="scripts/gen-ledger.mjs — npm prebuild",
        blurb="git log -> data/ledger.json, with a shallow-checkout guard that refuses to truncate.",
        role="Runs inside every Vercel build. Never fails the build; warns loudly instead.",
        origin="scripts/gen-ledger.mjs",
        src=("scripts/gen-ledger.mjs", r"^const committed = readCommittedLedger", 30),
    ),
    dict(
        key="capturedeploy", col="gate2", row=6, icon="cloud-upload", status="live",
        title="scripts/capture-deploy.mjs",
        blurb="Each production build records itself into data/deploys.json + the build cache.",
        role="Closes the gap that a Vercel build cannot commit back to git.",
        origin="scripts/capture-deploy.mjs :: captureCurrentDeploy",
        src=("scripts/capture-deploy.mjs", r"^export function captureCurrentDeploy", 24),
    ),
    dict(
        key="syncdeploys", col="gate2", row=7, icon="refresh-cw", status="unverified",
        title="scripts/sync-deploys.mjs — NEVER RUN LIVE",
        blurb="Reconciles deploys.json against the Vercel API. The HTTP round trip is unproven.",
        role="Response mapping is verified against a captured payload; the socket call is not. No VERCEL_TOKEN has ever been issued.",
        origin="scripts/sync-deploys.mjs :: fetchProductionDeploys",
        src=("scripts/sync-deploys.mjs", r"^async function fetchProductionDeploys", 22),
    ),

    # ---------------- THE GRAPH ----------------
    dict(
        key="build", col="compile", row=0, icon="workflow", status="live",
        title="graph.py :: build() — StateGraph",
        blurb="The real LangGraph. Five nodes, one conditional back-edge, compiled per run.",
        role="This object IS the definition. data/loop-def.json is read off it, never hand-written.",
        origin="loop/graph.py :: build",
        src=("loop/graph.py", r"^def build\(\)", 18),
    ),
    dict(
        key="perceive", col="n1", row=0, icon="eye", status="live",
        title="1 · Perceive",
        blurb="Structural facts computed in code; only the classification is asked of the model.",
        role="chars, lines, amountBucket, hasDueDate, language are computed. issuerKind + docType come from the model, coerced onto enums.",
        origin="loop/graph.py :: perceive",
        src=("loop/graph.py", r"^def perceive", 30),
    ),
    dict(
        key="decide", col="n2", row=0, icon="git-branch", status="live",
        title="2 · Decide",
        blurb="Chooses category + urgency AND declares the assertion it will be held to.",
        role="The pass names its own test before it is tested. Retries re-enter here with the failure detail.",
        origin="loop/graph.py :: decide",
        src=("loop/graph.py", r"^def decide", 30),
    ),
    dict(
        key="act", col="n3", row=0, icon="file-check", status="live",
        title="3 · Act",
        blurb="Produces the triage record. humanSummary is composed IN CODE, never by the model.",
        role="A summary the model authors is a summary that can name the sender; this one is built from typed fields.",
        origin="loop/graph.py :: act",
        src=("loop/graph.py", r"^def act", 34),
    ),
    dict(
        key="evaluate", col="n4", row=0, icon="scale", status="live",
        title="4 · Evaluate",
        blurb="Runs the assertion THIS pass declared. Not a linter, not the model's self-opinion.",
        role="The verdict. Only a passing assertion can lead to convergence.",
        origin="loop/graph.py :: evaluate",
        src=("loop/graph.py", r"^def evaluate", 12),
    ),
    dict(
        key="adapt", col="n5", row=0, icon="repeat", status="live",
        title="5 · Adapt",
        blurb="Sets terminationReason: converged | max_iterations | retrying.",
        role="Cap exhaustion sets max_iterations, which the runner maps to a non-zero exit. It must never read as a win.",
        origin="loop/graph.py :: adapt",
        src=("loop/graph.py", r"^def adapt", 28),
    ),

    # ---------------- GRAPH SIDECAR ----------------
    dict(
        key="ollama", col="compile", row=1, icon="brain", status="live",
        title="Ollama llama3.2:3b — loopback only",
        blurb="Plain HTTP on 127.0.0.1:11434. No API key, no egress, no credential in the loop.",
        role="JSON mode, temperature 0. Raises on transport failure — there is no retry or backoff.",
        origin="loop/graph.py :: ask",
        src=("loop/graph.py", r"^def ask\(", 26),
    ),
    dict(
        key="assertions", col="n3", row=1, icon="list-checks", status="live",
        title="ASSERTIONS registry",
        blurb="disposition_actionable · bill_has_amount · urgency_justified",
        role="The declarable checks. Two of the three can hold vacuously by design, and say so in their detail string.",
        origin="loop/graph.py :: ASSERTIONS",
        src=("loop/graph.py", r"^def _assert_disposition_actionable", 26),
    ),
    dict(
        key="route", col="route", row=0, icon="corner-up-left", status="live",
        title="route_after_adapt — the back-edge",
        blurb="The only edge that sends the loop backwards. This is what makes it a loop.",
        role="terminationReason == 'retrying' routes to decide; anything else ends the pass.",
        origin="loop/graph.py :: route_after_adapt",
        src=("loop/graph.py", r"^def route_after_adapt", 6),
    ),

    # ---------------- GATES ----------------
    dict(
        key="gate1", col="gate1", row=0, icon="shield", status="live",
        title="Gate 1 · verify_clean (pattern)",
        blurb="email · iban · vat-id · card · phone · amount · ref · digits · postcode · known names.",
        role="Walks the finished artifact for PII-shaped spans. Any finding is a hard failure.",
        origin="loop/redact.py :: verify_clean",
        src=("loop/redact.py", r"^def verify_clean", 22),
    ),
    dict(
        key="gate2", col="gate2", row=0, icon="shield-check", status="live",
        title="Gate 2 · verify_no_source_tokens",
        blurb="Every capitalised token in the source becomes a deny-list entry. Keeps the SENDER out.",
        role="Names are unenumerable, so the source document itself is the deny-list — minus the loop's own vocabulary.",
        origin="loop/redact.py :: verify_no_source_tokens",
        src=("loop/redact.py", r"^def verify_no_source_tokens", 20),
    ),
    dict(
        key="exit", col="exit", row=0, icon="door-open", status="live",
        title="Exit contract — 0 / 2 / 3",
        blurb="0 converged · 2 idempotent no-op · 3 error, redaction violation, OR cap exhaustion.",
        role="Nothing but 'converged' earns a zero. Cap exhaustion is a stop, not a win.",
        origin="loop/run.py :: THE GATE + exit mapping",
        src=("loop/run.py", r"# THE GATE — two independent checks", 20),
    ),
    dict(
        key="redtest", col="route", row=2, icon="bug", status="live",
        title="test_redaction.py — adversarial",
        blurb="Seven leak classes thrown at both gates, plus a clean-check on the real artifact.",
        role="A redaction step nobody has attacked is a promise. This file attacks it.",
        origin="loop/test_redaction.py :: LEAKS",
        src=("loop/test_redaction.py", r"^LEAKS = \{", 14),
    ),

    # ---------------- DATA ----------------
    dict(
        key="loopdef", col="data", row=6, icon="file-json", status="live",
        title="data/loop-def.json",
        blurb="DERIVED from the compiled graph via get_graph() on every run. Never hand-authored.",
        role="This is why the Flow panel cannot drift: add a node in graph.py and the diagram follows.",
        origin="loop/graph.py :: describe",
        src=("loop/graph.py", r"^def describe", 30),
    ),
    dict(
        key="loopruns", col="data", row=0, icon="history", status="live",
        title="data/loop-runs.json — 1 pass",
        blurb="One converged pass on a real item. Idempotency means that item can never run again.",
        role="The evidence artifact. Written only after both gates return empty.",
        origin="loop/run.py :: record",
        src=("loop/run.py", r"^    record = \{", 26),
    ),
    dict(
        key="ledger", col="data", row=1, icon="scroll", status="live",
        title="data/ledger.json",
        blurb="Commits derived at build. `shallow: true` makes /war render history as a FLOOR.",
        role="Committed so a file-based deploy still has a ledger when git is unavailable.",
        origin="scripts/gen-ledger.mjs (writeFileSync)",
        src=("scripts/gen-ledger.mjs", r"^writeFileSync\(", 6),
    ),
    dict(
        key="deploys", col="data", row=2, icon="server", status="live",
        title="data/deploys.json",
        blurb="Production deploys only. Previews are invisible to /war by construction.",
        role="Merged from three sources: the committed floor, the build cache, and this build.",
        origin="scripts/capture-deploy.mjs :: mergeDeploys",
        src=("scripts/capture-deploy.mjs", r"^function mergeDeploys", 10),
    ),
    dict(
        key="okrs", col="data", row=3, icon="target", status="live",
        title="data/okrs.json",
        blurb="O1 + KR1/KR2. KR2 carries a 5-criterion rubric written BEFORE the work it scores.",
        role="The rubric exists in the JSON and is the bar KR2's 100% is claimed against. Nothing renders it — see the rubric gap node.",
        origin="data/okrs.json",
        src=("data/okrs.json", r'"rubric"', 12),
    ),
    dict(
        key="links", col="data", row=4, icon="link", status="gap",
        title="data/links.json — 2 of 6 specified",
        blurb="CLAUDE.md specifies GitHub, Vercel, Supabase, Phoenix, Langflow, GBrain. Only 2 exist.",
        role="GAP: Vercel, Supabase, Phoenix, Langflow and GBrain rows were never added. The rail silently renders short.",
        origin="data/links.json vs CLAUDE.md links-rail spec",
        src=("data/links.json", r"^\[", 14),
    ),

    # ---------------- RENDER ----------------
    dict(
        key="loopdata", col="access", row=0, icon="code", status="live",
        title="app/loop/data.ts",
        blurb="Typed accessors over the two committed loop files. isConverged is the success rule.",
        role="orderedNodes() walks the graph's own forward edges; feedbackEdges() finds the back-edge.",
        origin="app/loop/data.ts :: orderedNodes",
        src=("app/loop/data.ts", r"export function orderedNodes", 22),
    ),
    dict(
        key="wardata", col="access", row=1, icon="code", status="live",
        title="app/war/data.ts",
        blurb="Accessors + the REPO_PUBLIC one-edit switch + a 5-minute render anchor.",
        role="currentAnchor() keeps server render and hydration identical. getLedger() merges commits + prod deploys.",
        origin="app/war/data.ts :: getLedger",
        src=("app/war/data.ts", r"export function getLedger", 30),
    ),
    dict(
        key="repopublic", col="data", row=5, icon="lock", status="unverified",
        title="REPO_PUBLIC = false — ruling contested",
        blurb="Currently false, which correctly hides the GitHub row and every per-commit link.",
        role="UNRESOLVED: the comment above this flag records a 2026-07-28 ruling that the repo goes PUBLIC at launch, but a later 2026-07-30 ruling says it stays PRIVATE. The flag is right either way today; the launch-day step is not. Reconcile before Jul 31.",
        origin="app/war/data.ts :: REPO_PUBLIC (comment) vs the 2026-07-30 ruling",
        src=("app/war/data.ts", r"export const REPO_PUBLIC", 3),
    ),
    dict(
        key="looppage", col="pages", row=0, icon="layout-dashboard", status="live",
        title="/loop — the pass, rendered",
        blurb="Server-renders the committed artifact. No client fetch, no request-time data source.",
        role="Renders the definition the runner actually executed, plus the latest pass.",
        origin="app/loop/page.tsx",
        src=("app/loop/page.tsx", r"export default", 18),
    ),
    dict(
        key="warpage", col="pages", row=1, icon="monitor", status="live",
        title="/war — the War Room",
        blurb="OKRs, Growth Ledger, Flow panel, Architecture panel, links rail. Real data only.",
        role="Every number derives from versioned JSON in /data. No mock telemetry anywhere.",
        origin="app/war/Dashboard.tsx",
        src=("app/war/Dashboard.tsx", r"export default", 22),
    ),

    # ---------------- GAPS ----------------
    dict(
        key="vault", col="route", row=1, icon="git-commit-vertical", status="live",
        title="writeback.py :: emit — decision + outcome",
        blurb="Steps 6-7 of the architecture pin. Business-keyed on the idempotency key, gated again on the way out.",
        role="Built 2026-08-11, after being drawn but unimplemented since the pin was written. decision_id is loop:{idempotencyKey}, NOT the date-prefixed runId — a date-keyed id would miss brain-log's dedupe and append a second permanent line to an append-only log. Everything leaving as argv is re-checked by gate 1: safe inside a JSON file is not safe as a CLI argument that becomes a log line, a filename and a commit message. Takes an exclusive flock because brain-log.py has no locking and its add+commit is two subprocesses.",
        origin="loop/writeback.py :: emit",
        src=("loop/writeback.py", r"^def emit\(", 34),
    ),
    dict(
        key="sched", col="inbox", row=1, icon="clock", status="gap",
        title="GAP · nothing schedules the loop",
        blurb="rsync -> ssh -> run -> rsync back -> git commit. Five manual steps, zero automation.",
        role="GAP: no cron, no CI job, no webhook. A pass happens only because a human ran it, and nothing triggers a rebuild afterwards.",
        origin="loop/README.md :: 'Where it runs' runbook",
        src=("loop/README.md", r"rsync -az loop/", 5),
    ),
    dict(
        key="obs", col="prep", row=1, icon="activity", status="gap",
        title="GAP · no observability on the loop",
        blurb="Phoenix is named in CLAUDE.md's links rail. It is wired nowhere.",
        role="GAP: the LangGraph run emits no traces or spans. The only record of a pass is the artifact it commits — there is no way to see a pass that failed before the write.",
        origin="CLAUDE.md links-rail spec (Phoenix) vs zero code references",
        src=("CLAUDE.md", r"Links rail", 3),
    ),
    dict(
        key="nodb", col="access", row=4, icon="database", status="gap",
        title="GAP · no datastore, no API route",
        blurb="Supabase is specified in CLAUDE.md. There is no app/api, no middleware, no server runtime.",
        role="Committed JSON is the entire database. Every value on the site is frozen at build time — a pass is invisible until someone commits and redeploys.",
        origin="app/ (no api directory) vs CLAUDE.md links-rail spec (Supabase)",
        src=("next.config.ts", r"^import type", 8),
    ),
    dict(
        key="generalise", col="access", row=2, icon="flask-conical", status="gap",
        title="GAP · generalisation is still thin",
        blurb="The queue and the write-back now exist. The evidence base is still one document type.",
        role="GAP, narrowed 2026-08-11: the key now only counts CONVERGED passes, so a document the loop FAILED on can be retried — before, a cap-exhausted pass was written before the failure exit and then blocked its own retry forever. consume_item() moves each processed file to .done/, so a backlog drains instead of re-picking item one every tick. What is still unproven is breadth: the corpus is a cloud VAT invoice plus a synthetic utility bill written to exercise the gates, not a spread of real admin.",
        origin="data/loop-runs.json + loop/run.py :: the converged-only idempotency check",
        src=("loop/run.py", r"^    runs_path = out_dir", 14),
    ),
    dict(
        key="rubric", col="access", row=3, icon="eye-off", status="gap",
        title="GAP · the KR2 rubric is never rendered",
        blurb="data/okrs.json carries 5 criteria. OkrPanel reads title, note and progress — never kr.rubric.",
        role="GAP: app/war/data.ts calls the rubric 'Rendered on /war so the bar is public, not private'. It is not. The only 100% KR ships as a self-awarded number with its certifying bar invisible — the exact failure the rubric was written to prevent.",
        origin="app/war/components/OkrPanel.tsx (kr.rubric unread) vs app/war/data.ts:47",
        src=("app/war/components/OkrPanel.tsx", r"keyResults", 20),
    ),
    dict(
        key="drift", col="prep", row=2, icon="compass", status="gap",
        title="GAP · product framing vs shipped runtime",
        blurb="CLAUDE.md defines Lucky Loop as an agent harness FOR CLAUDE CODE. The loop ships LangGraph + local Ollama.",
        role="GAP: same five-node shape, different runtime. Nothing in this repo harnesses Claude Code. Either the framing or the build has to move before the story is told publicly.",
        origin="CLAUDE.md :: Product line vs loop/graph.py + loop/requirements.txt",
        src=("CLAUDE.md", r"\*\*Product:\*\*", 5),
    ),
    dict(
        key="silent", col="compile", row=2, icon="volume-x", status="gap",
        title="GAP · model failure degrades silently",
        blurb="_pick() coerces any unusable answer to a default. A dead model still yields a valid artifact.",
        role="GAP: ask() returns {} on a JSON decode error and _pick falls back to 'other'/'none'/'file'. The pass can converge on defaults with no signal that the model contributed nothing.",
        origin="loop/graph.py :: _pick + ask",
        src=("loop/graph.py", r"^def _pick", 8),
    ),
]

EDGES: list[tuple] = [
    # ingest -> runners
    ("inbox", "runpy", "one item"),
    ("gitlog", "genledger", ""),
    ("vercelenv", "capturedeploy", ""),
    ("vercelenv", "syncdeploys", "unproven"),
    # runner -> graph
    ("runpy", "idem", ""),
    ("idem", "build", "new key only"),
    ("build", "perceive", ""),
    # the loop
    ("perceive", "decide", ""),
    ("decide", "act", ""),
    ("act", "evaluate", ""),
    ("evaluate", "adapt", ""),
    ("adapt", "route", ""),
    ("route", "decide", "retry"),
    # sidecars
    ("ollama", "perceive", ""),
    ("ollama", "decide", ""),
    ("ollama", "act", ""),
    ("assertions", "evaluate", "declared check"),
    # graph -> gates
    ("route", "gate1", "terminal"),
    ("gate1", "gate2", ""),
    ("gate2", "exit", ""),
    ("redtest", "gate1", "attacks"),
    ("redtest", "gate2", "attacks"),
    # gates/build -> data
    ("exit", "loopruns", "only if clean"),
    ("build", "loopdef", "get_graph()"),
    ("genledger", "ledger", ""),
    ("capturedeploy", "deploys", ""),
    ("syncdeploys", "deploys", ""),
    # data -> render
    ("loopdef", "loopdata", ""),
    ("loopruns", "loopdata", ""),
    ("ledger", "wardata", ""),
    ("deploys", "wardata", ""),
    ("okrs", "wardata", ""),
    ("links", "wardata", ""),
    ("repopublic", "wardata", "hides links"),
    ("loopdata", "looppage", ""),
    ("wardata", "warpage", ""),
    ("loopdef", "warpage", "Flow panel"),
    # gaps
    ("adapt", "vault", "SHOULD emit"),
    ("sched", "runpy", "MISSING trigger"),
    ("obs", "build", "MISSING tracing"),
    ("nodb", "warpage", "no live data"),
    ("silent", "decide", "silent default"),
    ("loopruns", "generalise", "n = 1"),
    ("okrs", "rubric", "5 criteria, unread"),
    ("rubric", "warpage", "bar invisible"),
    ("drift", "build", "framing vs runtime"),
]

DASHED = {"vault", "sched", "obs", "nodb", "silent", "syncdeploys", "rubric", "drift",
          "repopublic", "generalise"}


def build_flow() -> dict:
    by_key: dict[str, dict] = {}
    specs = []
    for n in NODES:
        relpath, anchor, limit = n["src"]
        spec = dict(n)
        spec["id"] = f"CustomComponent-{n['key']}"
        spec["x"] = X[n["col"]]
        spec["y"] = n["row"] * ROW
        spec["source"] = excerpt(relpath, anchor, limit)
        spec["origin"] = n["origin"]
        by_key[n["key"]] = spec
        specs.append(spec)

    nodes = [make_node(s) for s in specs]

    edges = []
    for src, dst, label in EDGES:
        if src not in by_key or dst not in by_key:
            raise SystemExit(f"gen-flow: edge {src} -> {dst} names an unknown node.")
        edges.append(
            make_edge(by_key[src]["id"], by_key[dst]["id"], label, dashed=src in DASHED or dst in DASHED)
        )

    live = sum(1 for s in specs if s["status"] == "live")
    unver = sum(1 for s in specs if s["status"] == "unverified")
    gaps = sum(1 for s in specs if s["status"] == "gap")

    description = (
        f"The Lucky Loop backend, generated FROM the repository by langflow/gen-flow.py — "
        f"not drawn by hand. {len(specs)} nodes / {len(edges)} edges: {live} shipping, "
        f"{unver} unverified (Beta badge), {gaps} gaps (Legacy badge). "
        "Reads left to right: ingest -> runners -> the graph -> gates -> data -> render -> gaps. "
        "Open any node's code panel to read the real source excerpt it mirrors. "
        "This is an observation surface, not a runnable pipeline."
    )

    return {
        "id": FLOW_ID,
        "name": "Lucky Loop — Backend Architecture",
        "description": description,
        "icon": "workflow",
        "icon_bg_color": "#7C3AED",
        "gradient": "2",
        "is_component": False,
        "endpoint_name": None,
        "webhook": False,
        "locked": False,
        "mcp_enabled": False,
        "tags": [],
        "data": {"nodes": nodes, "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 0.4}},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify excerpts resolve; write nothing")
    parser.add_argument(
        "--check-drift",
        action="store_true",
        help="ALSO verify the committed canvas matches what this script would generate",
    )
    args = parser.parse_args()

    flow = build_flow()

    # --check-drift is the gate --check was mistaken for. --check proves 40
    # file+regex ANCHORS still resolve; it never compares the result to the
    # committed canvas, so the canvas can be arbitrarily stale while it exits 0.
    # That was not hypothetical: on 2026-08-11 the committed canvas embedded
    # `export const REPO_PUBLIC = false;` while app/war/data.ts had read `true`
    # since 2026-08-05, and --check was green the whole time.
    if args.check_drift:
        rendered = json.dumps(flow, indent=2, ensure_ascii=False) + "\n"
        if not OUT.exists():
            print(f"gen-flow: DRIFT — {OUT.relative_to(REPO)} does not exist", file=sys.stderr)
            return 1
        committed = OUT.read_text(encoding="utf-8")
        if committed == rendered:
            print(f"gen-flow: no drift — committed canvas matches {len(flow['data']['nodes'])} generated nodes.")
            return 0
        # Report WHICH NODES drifted, not a raw text diff. Every node embeds a
        # whole source excerpt on ONE json line, so a unified diff prints
        # thousands of unreadable columns and names nothing you can act on.
        def by_id(payload: dict) -> dict:
            return {n.get("id", f"?{i}"): n for i, n in enumerate(payload["data"]["nodes"])}

        try:
            old_nodes = by_id(json.loads(committed))
        except (json.JSONDecodeError, KeyError, TypeError):
            print("gen-flow: DRIFT — committed canvas is unparseable or has no nodes", file=sys.stderr)
            return 1
        new_nodes = by_id(flow)

        added = sorted(set(new_nodes) - set(old_nodes))
        removed = sorted(set(old_nodes) - set(new_nodes))
        changed = sorted(
            nid for nid in set(old_nodes) & set(new_nodes)
            if json.dumps(old_nodes[nid], sort_keys=True) != json.dumps(new_nodes[nid], sort_keys=True)
        )

        def label(nid: str, pool: dict) -> str:
            node = pool.get(nid, {})
            disp = (node.get("data", {}).get("node", {}) or {}).get("display_name")
            return f"{nid}  ({disp})" if disp else nid

        print(
            "gen-flow: DRIFT — the committed canvas is NOT what this repo generates.\n"
            "  Regenerate and commit:  python3 langflow/gen-flow.py",
            file=sys.stderr,
        )
        for title, ids, pool in (
            ("changed", changed, new_nodes),
            ("added", added, new_nodes),
            ("removed", removed, old_nodes),
        ):
            for nid in ids:
                print(f"  {title:8} {label(nid, pool)}", file=sys.stderr)
        if not (changed or added or removed):
            # Node sets match, so the difference is in the envelope (name,
            # description, viewport, edges). Say so rather than printing nothing.
            print("  envelope-only drift (edges/metadata/viewport, no node changed)", file=sys.stderr)
        return 1

    if args.check:
        print(
            f"gen-flow: OK — {len(flow['data']['nodes'])} nodes, "
            f"{len(flow['data']['edges'])} edges, every excerpt resolved. "
            f"(ANCHORS only — this does NOT prove the committed canvas is current; "
            f"use --check-drift for that.)"
        )
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(flow, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    size = OUT.stat().st_size
    print(
        f"gen-flow: wrote {OUT.relative_to(REPO)} — "
        f"{len(flow['data']['nodes'])} nodes, {len(flow['data']['edges'])} edges, {size // 1024} KB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
