"""Sanitization as code, not intent.

The launch mission's SANITIZE rule: loop artifacts committed to the repo carry
no raw mail/bill content, sender names, or amounts. Redact BEFORE commit, never
after — git history is permanent and /loop renders committed artifacts on the
public site immediately.

Two layers, because one is a promise and two is a mechanism:

  1. redact()       — rewrites a string, replacing PII with typed placeholders.
  2. verify_clean() — walks the finished artifact and reports anything that
                      still looks like PII. The runner treats any finding as a
                      hard failure and writes nothing.

Layer 2 is the one that matters. Layer 1 can have a gap; layer 2 is what stops
a gap from reaching git. There is also a third, structural layer in graph.py:
the artifact carries typed enums and bounded model-authored one-liners, never
raw document text. Free text is never passed through.
"""

from __future__ import annotations

import re
from typing import Any

# Personal identifiers for this vault's owner. Extend rather than replace —
# a name that is not listed here is not redacted by name, only by pattern.
NAME_TOKENS = [
    "karl",
    "wuerfel",
    "würfel",
    "wilhelm",
    "pool music",
    "poolmusic",
]

# Ordered: the most specific pattern must win, so EMAIL runs before DIGITS.
PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("email", re.compile(r"[\w.+-]+@[\w-]+\.[\w.]{2,}"), "[email]"),
    ("iban", re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b"), "[iban]"),
    ("vat-id", re.compile(r"\b(?:VAT|USt|UID)[-\s]?(?:ID)?[-\s:]*[A-Z]{2}[A-Z0-9]{6,14}\b", re.I), "[vat-id]"),
    ("card", re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[card]"),
    ("phone", re.compile(r"(?:\+\d{1,3}[\s./-]?)?(?:\(\d{1,4}\)[\s./-]?)?\d{3,5}[\s./-]\d{3,}"), "[phone]"),
    # Currency in either order: "EUR 1.234,56" and "1.234,56 EUR" / "€12.00".
    ("amount", re.compile(r"(?:EUR|USD|GBP|CHF|[€$£])\s?-?[\d][\d.,\s]*\d|\b-?\d[\d.,]*\s?(?:EUR|USD|GBP|CHF|[€$£])"), "[amount]"),
    # Invoice/account/customer identifiers: 6+ digit runs, and mixed-case
    # reference codes like EUINDE25 559480.
    ("ref", re.compile(r"\b[A-Z]{2,}[A-Z0-9]*\d{4,}\b"), "[ref]"),
    ("digits", re.compile(r"\b\d{6,}\b"), "[number]"),
    # Postal address lines: "80331 München", "12345 Berlin".
    ("postcode", re.compile(r"\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöüß]+\b"), "[locality]"),
]

NAME_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(n) for n in NAME_TOKENS) + r")\b",
    re.IGNORECASE,
)

# Fields whose values are machine-generated and provably not PII. Excluded from
# verify_clean's digit-run check so a hex run id cannot trip its own alarm.
SAFE_KEYS = {
    "runId",
    "idempotencyKey",
    "startedAt",
    "finishedAt",
    "graphVersion",
    "sha",
    "id",
}


def redact(text: str) -> str:
    """Replace every PII-shaped span in `text` with a typed placeholder."""
    if not text:
        return text
    out = text
    for _label, pattern, replacement in PATTERNS:
        out = pattern.sub(replacement, out)
    out = NAME_RE.sub("[name]", out)
    return out


def find_violations(text: str) -> list[str]:
    """PII-shaped spans still present in `text`. Empty list means clean."""
    hits: list[str] = []
    for label, pattern, _replacement in PATTERNS:
        if pattern.search(text):
            hits.append(label)
    if NAME_RE.search(text):
        hits.append("name")
    return hits


def verify_clean(obj: Any, path: str = "$") -> list[str]:
    """Walk a finished artifact; return a list of `path: kind` violations.

    This is the mechanical pre-commit check. The runner refuses to write any
    artifact for which this returns a non-empty list.
    """
    findings: list[str] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in SAFE_KEYS:
                continue
            findings.extend(verify_clean(value, f"{path}.{key}"))
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            findings.extend(verify_clean(value, f"{path}[{i}]"))
    elif isinstance(obj, str):
        for kind in find_violations(obj):
            findings.append(f"{path}: {kind}")
    return findings


def source_tokens(raw: str, allowed: set[str]) -> set[str]:
    """Proper-noun-shaped tokens lifted from the source document.

    Names are unenumerable — a vendor list is incomplete the day it is written.
    So instead of guessing which words are sensitive, treat the source document
    itself as the deny-list: any capitalised token in the raw item is forbidden
    in the artifact unless it is part of this loop's own vocabulary.
    """
    tokens = set()
    for match in re.finditer(r"\b[A-Z][A-Za-z0-9&.\-]{2,}\b", raw):
        token = match.group(0).lower().strip(".")
        if token and token not in allowed:
            tokens.add(token)
    return tokens


def verify_no_source_tokens(obj: Any, forbidden: set[str], path: str = "$") -> list[str]:
    """Second gate: nothing lifted verbatim from the item reaches the artifact.

    This is what stops the ISSUER's name — the sender — from being published,
    which `redact()` alone cannot do without an exhaustive vendor list.
    """
    findings: list[str] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in SAFE_KEYS:
                continue
            findings.extend(verify_no_source_tokens(value, forbidden, f"{path}.{key}"))
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            findings.extend(verify_no_source_tokens(value, forbidden, f"{path}[{i}]"))
    elif isinstance(obj, str):
        for word in re.findall(r"[A-Za-z][A-Za-z0-9&.\-]*", obj):
            if word.lower().strip(".") in forbidden:
                findings.append(f"{path}: source token {word!r}")
    return findings


def bucket_amount(text: str) -> str:
    """Coarse magnitude of the largest amount, so /loop can say something true
    about the document without ever publishing a number."""
    values: list[float] = []
    for raw in re.findall(r"(?:EUR|USD|GBP|CHF|[€$£])\s?(-?[\d][\d.,\s]*\d)", text):
        cleaned = raw.replace(" ", "")
        # European "1.234,56" vs US "1,234.56": last separator wins as decimal.
        if "," in cleaned and "." in cleaned:
            if cleaned.rfind(",") > cleaned.rfind("."):
                cleaned = cleaned.replace(".", "").replace(",", ".")
            else:
                cleaned = cleaned.replace(",", "")
        elif "," in cleaned:
            cleaned = cleaned.replace(",", ".")
        try:
            values.append(abs(float(cleaned)))
        except ValueError:
            continue
    if not values:
        return "none"
    top = max(values)
    if top < 50:
        return "under-50"
    if top < 500:
        return "50-500"
    if top < 5000:
        return "500-5k"
    return "over-5k"
