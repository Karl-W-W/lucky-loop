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

# Gate 1's by-name deny-list. A name not listed here is not redacted BY NAME,
# only by pattern (and, in the artifact, by the source-token gate below).
#
# PUBLIC-REPO SPLIT (2026-08-11). The real tokens used to be checked in, which
# made this list a self-declared inventory of exactly the PII it hides. `git
# grep` proved this file was the SOLE public source of the owner's middle name
# and the umlaut spelling of the surname. The real list now lives in
# loop/name_tokens_local.py, which is gitignored.
#
# The default below is deliberately FICTIONAL. It exists so a fresh clone can
# still run loop/test_redaction.py and prove the MECHANISM works, without the
# repo disclosing whose name the mechanism protects.
DEFAULT_NAME_TOKENS = [
    "testperson",
    "mustermann",
    "example media",
    "examplemedia",
]

# FAIL-CLOSED, and this is the load-bearing part. When the local file is absent
# the real names are NOT redacted by name — so silently falling back to the
# fictional list would be fail-OPEN, the exact failure this module exists to
# prevent. run.py reads LOCAL_TOKENS_LOADED and refuses to process anything but
# an explicitly-synthetic item when it is False.
try:  # pragma: no cover — presence is environment-dependent by design
    from name_tokens_local import NAME_TOKENS as _LOCAL_NAME_TOKENS

    LOCAL_TOKENS_LOADED = True
except ImportError:
    _LOCAL_NAME_TOKENS = []
    LOCAL_TOKENS_LOADED = False

NAME_TOKENS = [*DEFAULT_NAME_TOKENS, *_LOCAL_NAME_TOKENS]

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
    # reference codes like NLSV2026 410772 (see fixtures/synthetic-bill.txt —
    # illustrative comments use the SYNTHETIC reference, never a live one).
    ("ref", re.compile(r"\b[A-Z]{2,}[A-Z0-9]*\d{4,}\b"), "[ref]"),
    ("digits", re.compile(r"\b\d{6,}\b"), "[number]"),
    # Postal address lines: "80331 München", "12345 Berlin".
    ("postcode", re.compile(r"\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöüß]+\b"), "[locality]"),
]

NAME_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(n) for n in NAME_TOKENS) + r")\b",
    re.IGNORECASE,
)

# Fields whose SCALAR values are machine-generated and provably not PII, so a
# hex run id or a duration cannot trip its own alarm.
#
# READ THE WALKER BEFORE ADDING TO THIS SET. A name here exempts that key's own
# scalar value and nothing else — it can no longer skip a nested object or list.
SAFE_KEYS = {
    "runId",
    "idempotencyKey",
    "startedAt",
    "finishedAt",
    "graphVersion",
    "sha",
    "id",
    # Structural magnitudes computed from the document, never lifted from it.
    # Present so the numeric check added in 2026-08-11 cannot false-positive a
    # long duration or a large character count into a permanent write refusal.
    "chars",
    "lines",
    "durationMs",
    "iterations",
    "cap",
    "t",
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


def _walk(obj: Any, path: str, check) -> list[str]:
    """Shared traversal for both gates. `check(text, path) -> list[str]`.

    Three holes were closed here on 2026-08-11 after an adversarial pass proved
    each one live by execution. Both gates share this walker so a fix can never
    again land in one and miss the other.

      1. SAFE_KEYS used to `continue` BEFORE recursing, so a safe key skipped
         its ENTIRE SUBTREE. Proven: verify_clean({'id': {'deep': {'x': <full
         leak>}}}) returned []. A safe name now exempts its own scalar only.
      2. Only `str` was inspected, so any value stored as a JSON NUMBER was
         completely ungated. Proven: {'account': 572113790075} -> [] while the
         same digits as a string -> ['digits'].
      3. Dict KEYS were never inspected, only values. Proven: a leak used as a
         key name passed both gates untouched.
    """
    findings: list[str] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            # Hole 3: the key is content too.
            findings.extend(check(str(key), f"{path}.<key {key!r}>"))
            # Hole 1: containers are ALWAYS traversed, whatever the key is
            # called. SAFE_KEYS may only exempt a leaf.
            if isinstance(value, (dict, list)):
                findings.extend(_walk(value, f"{path}.{key}", check))
            elif key not in SAFE_KEYS:
                findings.extend(_walk(value, f"{path}.{key}", check))
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            findings.extend(_walk(value, f"{path}[{i}]", check))
    elif isinstance(obj, str):
        findings.extend(check(obj, path))
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        # Hole 2. bool is an int subclass in Python, hence the explicit guard.
        findings.extend(check(str(obj), path))
    return findings


def verify_clean(obj: Any, path: str = "$") -> list[str]:
    """Walk a finished artifact; return a list of `path: kind` violations.

    This is the mechanical pre-write check. The runner refuses to write any
    artifact for which this returns a non-empty list, and loop/check_artifacts.py
    re-runs it at the COMMIT boundary, where git actually happens.
    """
    return _walk(obj, path, lambda text, at: [f"{at}: {kind}" for kind in find_violations(text)])


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

    NOTE ITS DEPENDENCY: `forbidden` is built from the raw source document, and
    loop/inbox/ is gitignored. On any machine without the item this gate
    degrades to an empty deny-list and becomes a silent no-op. That is why it
    is the RUN-time gate and verify_clean is the one re-run at commit time.
    """

    def check(text: str, at: str) -> list[str]:
        return [
            f"{at}: source token {word!r}"
            for word in re.findall(r"[A-Za-z][A-Za-z0-9&.\-]*", text)
            if word.lower().strip(".") in forbidden
        ]

    return _walk(obj, path, check)


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
