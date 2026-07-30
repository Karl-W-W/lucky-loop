"""The loop itself: a real LangGraph StateGraph.

    START → perceive → decide → act → evaluate → adapt ─┬→ END      (converged)
                          ↑                             │
                          └─────────────────────────────┘  (retry, capped)

Two rules this file exists to enforce:

  * The graph is the definition. `data/loop-def.json` is DERIVED from the
    compiled graph object (see `describe`), never hand-authored — so the
    diagram on /war and /loop cannot drift from the code that ran. A drawing
    that describes code living somewhere else is exactly what the vault
    forbids.
  * Only `converged` is success. Exhausting the iteration cap sets
    terminationReason="max_iterations", which the runner maps to a non-zero
    exit. Cap exhaustion must never read as a win.

The model is a local Ollama model reached over plain HTTP. No API key, no
network egress, no credential inside the loop — which keeps this entirely
outside the standing secrets-sprawl risk.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from redact import bucket_amount, redact

GRAPH_VERSION = "1.1.0"
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"

CATEGORIES = ["bill", "notice", "statement", "marketing", "other"]
URGENCIES = ["none", "low", "medium", "high"]
DISPOSITIONS = ["file", "pay", "reply", "ignore", "escalate"]
ISSUER_KINDS = ["cloud-provider", "utility", "telecom", "tax-authority", "bank", "other"]
DOC_TYPES = ["invoice", "vat-invoice", "reminder", "statement", "notice", "receipt", "other"]
DESTINATIONS = ["records", "finance", "tax", "archive", "none"]

# Generic admin vocabulary. Words here are allowed in the artifact even when
# they also appear in the source item — they identify nobody. Everything else
# capitalised in the source is treated as a name and refused (see
# redact.source_tokens).
GENERIC_WORDS = {
    "a", "an", "the", "and", "or", "of", "for", "to", "from", "on", "in", "at", "by", "with",
    "is", "are", "was", "were", "be", "been", "no", "not", "this", "that", "it", "its",
    "action", "actions", "amount", "amounts", "band", "before", "charge", "charges",
    "check", "consumption", "cost", "costs", "date", "dates", "detected", "due", "held",
    "iteration", "iterations", "line", "lines", "next", "nothing", "outstanding", "over",
    "paid", "pay", "payable", "payment", "period", "recommended", "requires", "review",
    "service", "services", "settled", "still", "stopping", "subscription", "under",
    "urgency", "usage", "vat", "tax", "taxes", "invoice", "invoices", "bill", "billing",
    "bills", "notice", "statement", "receipt", "reminder", "document", "item", "items",
    "file", "filing", "archive", "records", "finance", "reply", "ignore", "escalate",
    "assertion", "converged", "failing", "failed", "success", "quarter", "month",
    "monthly", "annual", "yearly", "total", "balance", "credit", "debit", "account",
}


def vocabulary() -> set[str]:
    """This loop's own words — the allow-list for the source-token gate."""
    words = set(GENERIC_WORDS)
    for enum in (
        CATEGORIES, URGENCIES, DISPOSITIONS, ISSUER_KINDS, DOC_TYPES, DESTINATIONS,
        list(ASSERTIONS), ["converged", "max_iterations", "error", "langgraph"],
    ):
        for value in enum:
            for word in re.split(r"[-_\s]+", str(value)):
                if word:
                    words.add(word.lower())
    return words


class LoopState(TypedDict, total=False):
    raw_text: str
    model: str
    max_iterations: int
    iterations: int
    perception: dict[str, Any]
    decision: dict[str, Any]
    action: dict[str, Any]
    evaluation: dict[str, Any]
    adaptation: dict[str, Any]
    feedback: str
    termination_reason: str
    trace: list[dict[str, Any]]


# --------------------------------------------------------------------------
# model access
# --------------------------------------------------------------------------


def ask(model: str, system: str, user: str) -> dict[str, Any]:
    """One JSON-mode turn against local Ollama. Raises on transport failure."""
    payload = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0},
        }
    ).encode()
    request = urllib.request.Request(
        OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        body = json.loads(response.read())
    content = body.get("message", {}).get("content", "{}")
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {}


def _pick(value: Any, allowed: list[str], fallback: str) -> str:
    """Coerce a model answer onto a fixed enum. The model never widens the
    vocabulary of anything that reaches the artifact."""
    if isinstance(value, str) and value.strip().lower() in allowed:
        return value.strip().lower()
    return fallback


def _line(value: Any, limit: int = 180) -> str:
    """Bounded, redacted one-liner. Free document text never passes through."""
    text = value if isinstance(value, str) else ""
    return redact(" ".join(text.split())[:limit])


# --------------------------------------------------------------------------
# declared assertions — Evaluate runs the assertion the pass itself declared
# --------------------------------------------------------------------------


def _assert_disposition_actionable(state: LoopState) -> tuple[bool, str]:
    disposition = state.get("action", {}).get("disposition", "")
    ok = disposition in DISPOSITIONS
    return ok, f"disposition {disposition!r} is one of {DISPOSITIONS}"


def _assert_bill_has_amount(state: LoopState) -> tuple[bool, str]:
    category = state.get("decision", {}).get("category", "")
    bucket = state.get("perception", {}).get("amountBucket", "none")
    if category != "bill":
        return True, f"category is {category!r}, not 'bill' — check vacuously holds"
    return bucket != "none", f"category 'bill' requires a detected amount; bucket={bucket!r}"


def _assert_urgency_justified(state: LoopState) -> tuple[bool, str]:
    urgency = state.get("decision", {}).get("urgency", "none")
    if urgency not in ("high", "medium"):
        return True, f"urgency {urgency!r} needs no justification"
    has_signal = bool(state.get("perception", {}).get("hasDueDate"))
    return has_signal, f"urgency {urgency!r} requires a due-date signal; found={has_signal}"


ASSERTIONS = {
    "disposition_actionable": _assert_disposition_actionable,
    "bill_has_amount": _assert_bill_has_amount,
    "urgency_justified": _assert_urgency_justified,
}


# --------------------------------------------------------------------------
# nodes
# --------------------------------------------------------------------------


def perceive(state: LoopState) -> dict[str, Any]:
    """Read the item. Structural facts are computed, not asked — only the
    classification is left to the model."""
    text = state["raw_text"]
    lowered = text.lower()
    structural = {
        "chars": len(text),
        "lines": len(text.splitlines()),
        "amountBucket": bucket_amount(text),
        "hasDueDate": any(
            token in lowered
            for token in ("due", "fällig", "faellig", "zahlbar", "payment due", "overdue")
        ),
        "language": "de" if any(t in lowered for t in ("rechnung", "betrag", "fällig")) else "en",
    }
    answer = ask(
        state["model"],
        "You classify a document for an admin triage queue. Reply as JSON with "
        f"keys: issuerKind, docType. issuerKind must be one of {ISSUER_KINDS}. "
        f"docType must be one of {DOC_TYPES}. Answer with those exact values and "
        "nothing else — never the issuer's name.",
        f"Classify this document:\n\n{text[:6000]}",
    )
    return {
        "perception": {
            **structural,
            "issuerKind": _pick(answer.get("issuerKind"), ISSUER_KINDS, "other"),
            "docType": _pick(answer.get("docType"), DOC_TYPES, "other"),
        },
        "trace": (state.get("trace") or []) + [{"node": "perceive"}],
    }


def decide(state: LoopState) -> dict[str, Any]:
    """Choose the triage category and urgency, and DECLARE the assertion that
    Evaluate will execute against this pass."""
    perception = state["perception"]
    feedback = state.get("feedback", "")
    answer = ask(
        state["model"],
        "You triage admin documents. Reply as JSON with keys: category, urgency, "
        f"assertion, rationale. category must be one of {CATEGORIES}. urgency must "
        f"be one of {URGENCIES}. assertion must be one of {list(ASSERTIONS)} and is "
        "the check your decision should be held to. rationale is at most 20 words "
        "and must contain no names, numbers or amounts.",
        json.dumps(
            {
                "signals": perception,
                "previousAttemptFeedback": feedback or None,
                "iteration": state.get("iterations", 0),
            }
        ),
    )
    assertion = answer.get("assertion")
    return {
        "decision": {
            "category": _pick(answer.get("category"), CATEGORIES, "other"),
            "urgency": _pick(answer.get("urgency"), URGENCIES, "none"),
            "assertion": assertion if assertion in ASSERTIONS else "disposition_actionable",
            "rationale": _line(answer.get("rationale")),
        },
        "trace": (state.get("trace") or []) + [{"node": "decide"}],
    }


def act(state: LoopState) -> dict[str, Any]:
    """The actual admin work: turn the decision into a disposition a human can
    execute without reopening the document."""
    perception, decision = state["perception"], state["decision"]
    answer = ask(
        state["model"],
        "You produce the final triage record for a document. Reply as JSON with "
        f"keys: disposition, destination. disposition must be one of {DISPOSITIONS}. "
        f"destination must be one of {DESTINATIONS}. Answer with those exact values "
        "and nothing else.",
        json.dumps({"perception": perception, "decision": decision}),
    )
    disposition = _pick(answer.get("disposition"), DISPOSITIONS, "file")
    destination = _pick(answer.get("destination"), DESTINATIONS, "records")

    # Composed in code from typed fields, never written by the model. A summary
    # the model authors is a summary that can name the sender; this one cannot.
    band = {
        "none": "no amount detected",
        "under-50": "amount under 50",
        "50-500": "amount in the 50-500 band",
        "500-5k": "amount in the 500-5k band",
        "over-5k": "amount over 5k",
    }[perception["amountBucket"]]
    summary = (
        f"{decision['urgency']}-urgency {decision['category']} from a "
        f"{perception['issuerKind']}, {band}; recommended action: "
        f"{disposition} to {destination}."
    )

    return {
        "action": {
            "disposition": disposition,
            "destination": destination,
            "humanSummary": summary,
        },
        "trace": (state.get("trace") or []) + [{"node": "act"}],
    }


def evaluate(state: LoopState) -> dict[str, Any]:
    """Run the pass's OWN declared assertion. This is the verdict — not a
    linter, not an exit code, not the model's opinion of its own work."""
    name = state["decision"]["assertion"]
    passed, detail = ASSERTIONS[name](state)
    return {
        "evaluation": {"assertion": name, "passed": passed, "detail": _line(detail, 200)},
        "trace": (state.get("trace") or []) + [{"node": "evaluate"}],
    }


def adapt(state: LoopState) -> dict[str, Any]:
    """Record what the pass learned and set the termination reason."""
    evaluation = state["evaluation"]
    iterations = state.get("iterations", 0) + 1
    cap = state.get("max_iterations", 3)

    if evaluation["passed"]:
        reason = "converged"
        note = f"Assertion {evaluation['assertion']!r} held on iteration {iterations}."
        feedback = ""
    elif iterations >= cap:
        reason = "max_iterations"
        note = f"Assertion {evaluation['assertion']!r} still failing after {iterations} iterations; stopping short of a false success."
        feedback = ""
    else:
        reason = "retrying"
        note = f"Assertion {evaluation['assertion']!r} failed; re-deciding with the failure detail."
        feedback = evaluation["detail"]

    return {
        "iterations": iterations,
        "termination_reason": reason,
        "feedback": feedback,
        "adaptation": {"note": _line(note, 200), "iterations": iterations, "cap": cap},
        "trace": (state.get("trace") or []) + [{"node": "adapt"}],
    }


def route_after_adapt(state: LoopState) -> str:
    """The only edge that can send the loop backwards."""
    return "decide" if state.get("termination_reason") == "retrying" else END


# --------------------------------------------------------------------------
# assembly + derivation
# --------------------------------------------------------------------------

NODE_HINTS = {
    "perceive": "read the item",
    "decide": "categorise + declare the assertion",
    "act": "produce the triage record",
    "evaluate": "run the declared assertion",
    "adapt": "record what changed; retry or converge",
}


def build() -> Any:
    graph = StateGraph(LoopState)
    graph.add_node("perceive", perceive)
    graph.add_node("decide", decide)
    graph.add_node("act", act)
    graph.add_node("evaluate", evaluate)
    graph.add_node("adapt", adapt)

    graph.add_edge(START, "perceive")
    graph.add_edge("perceive", "decide")
    graph.add_edge("decide", "act")
    graph.add_edge("act", "evaluate")
    graph.add_edge("evaluate", "adapt")
    graph.add_conditional_edges("adapt", route_after_adapt, {"decide": "decide", END: END})

    return graph.compile()


def describe(compiled: Any) -> dict[str, Any]:
    """Derive the renderable definition FROM the compiled graph.

    Everything here is read off the graph object that actually executes. If a
    node or edge is added in `build`, this output changes without anyone
    editing a diagram — which is the whole point.
    """
    drawn = compiled.get_graph()
    nodes = [
        {"id": node_id, "hint": NODE_HINTS.get(node_id, "")}
        for node_id in drawn.nodes
        if node_id not in ("__start__", "__end__")
    ]
    edges = [
        {
            "from": edge.source,
            "to": edge.target,
            "conditional": bool(getattr(edge, "conditional", False)),
        }
        for edge in drawn.edges
    ]
    return {
        "graphVersion": GRAPH_VERSION,
        "framework": "langgraph",
        "derivedFrom": "loop/graph.py — compiled StateGraph, read via get_graph()",
        "nodes": nodes,
        "edges": edges,
        "terminationReasons": ["converged", "max_iterations", "error"],
        "assertions": sorted(ASSERTIONS),
    }
