"""Office — the incubator grid (office.json) and the box's board (board.html), served as they are.

Mounted under ``/api/plugins/fleet/`` by ``plugin_api.py`` (which includes this router),
so the Desktop reaches it through the same namespace-scoped ``ctx.rest`` as Today.

Routes, all GET, all read-only:

* ``/office``             office.json, every key passed through unchanged (``sampled_at``
                          is the aggregator's own sample time, never the request time),
                          plus one added key, ``served``: when this process read the file,
                          the file's mtime and size, the sample's age, and ``stale`` when that
                          age is past ``stale_after_s``.
* ``/office/board``       board.html wrapped in JSON (``html``), because the Desktop's REST door
                          refuses a text/html body; ``sampled_at`` is the file's mtime, the
                          moment the consolidator rendered it.
* ``/office/board.html``  the same file as text/html, for curl or a browser on the tunnel.

Who writes the two files (not this module): ``loop/mission/office.py`` (office.json, schema
"office v1") and ``loop/mission/render_board.py`` (board.html), both inside the 15-minute
``mission-consolidator`` tick, in the loop-factory repo. This module never re-derives a
value and never writes anything. Rules, the same ones Today is built to:

* Every response carries a sample time. A missing or unreadable file is an explicit
  state (``error`` + ``sampled_at: null``) with HTTP 200, so the page can say "no file
  yet" instead of a transport error; only the raw ``.html`` route answers 404.
* Nothing is hand-typed and nothing is named here: projects, agents and disciplines
  arrive at request time from the file. This repo is public; the data is not.
* ``stale_after_s`` is 1800 because ``office.py --check`` fails a file older than 30 min.

Selftest (needs FastAPI importable): ``uv run --with fastapi python office_api.py --selftest``.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

HOME = Path.home()
OFFICE_FILE = HOME / ".local" / "state" / "lucky-loop" / "office.json"
BOARD_FILE = HOME / ".local" / "state" / "mission-control" / "board.html"
STALE_AFTER_S = 1800            # office.py --check fails a file older than 30 min
BOARD_MAX_BYTES = 2_000_000     # a board this big is a runaway render, not a board
OFFICE_SCHEMA = "office v1"

# The raw board route carries the board's own style and font links and nothing that runs.
BOARD_CSP = ("default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; "
             "font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'")


def _z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _now_z() -> str:
    return _z(datetime.now(timezone.utc))


def _parse(iso: Any) -> Optional[datetime]:
    if not isinstance(iso, str) or not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _tilde(p: Path) -> str:
    s = str(p)
    h = str(HOME)
    return "~" + s[len(h):] if s.startswith(h + os.sep) else s


def _age_s(dt: Optional[datetime]) -> Optional[int]:
    if dt is None:
        return None
    return max(0, int((datetime.now(timezone.utc) - dt).total_seconds()))


def _file_meta(p: Path) -> Dict[str, Any]:
    try:
        st = p.stat()
    except OSError:
        return {"file_mtime": None, "file_bytes": None}
    return {"file_mtime": _z(datetime.fromtimestamp(st.st_mtime, timezone.utc)), "file_bytes": st.st_size}


def office_payload(path: Path = OFFICE_FILE) -> Dict[str, Any]:
    """office.json as written, plus ``served``. Never raises."""
    served: Dict[str, Any] = {"served_at": _now_z(), "path": _tilde(path), **_file_meta(path),
                              "age_s": None, "stale_after_s": STALE_AFTER_S, "stale": True,
                              "schema_note": None}

    def failed(msg: str) -> Dict[str, Any]:
        return {"schema": None, "sampled_at": None, "error": msg, "served": served}

    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return failed(f"no office.json at {_tilde(path)} yet: the mission-consolidator tick writes it "
                      "every 15 min (loop/mission/office.py in loop-factory)")
    except OSError as e:
        return failed(f"office.json unreadable: {type(e).__name__}: {e}")
    try:
        d = json.loads(raw)
    except ValueError as e:
        return failed(f"office.json is not valid JSON: {e}")
    if not isinstance(d, dict):
        return failed(f"office.json is a {type(d).__name__}, not an object")
    if d.get("schema") != OFFICE_SCHEMA:
        served["schema_note"] = f"expected schema {OFFICE_SCHEMA!r}, the file says {d.get('schema')!r}"
    age = _age_s(_parse(d.get("sampled_at")))
    served["age_s"] = age
    served["stale"] = age is None or age > STALE_AFTER_S
    d["served"] = served                     # the one added key; every other key is the file's
    return d


def _read_board(path: Path):
    """(text, error). Never raises."""
    try:
        size = path.stat().st_size
    except FileNotFoundError:
        return None, (f"no board.html at {_tilde(path)} yet: the mission-consolidator tick renders it "
                      "every 15 min (loop/mission/render_board.py in loop-factory)")
    except OSError as e:
        return None, f"board.html unreadable: {type(e).__name__}: {e}"
    if size > BOARD_MAX_BYTES:
        return None, f"board.html is {size} bytes, over the {BOARD_MAX_BYTES}-byte cap; not served"
    try:
        return path.read_text(encoding="utf-8"), None
    except (OSError, UnicodeDecodeError) as e:
        return None, f"board.html unreadable: {type(e).__name__}: {e}"


def board_payload(path: Path = BOARD_FILE) -> Dict[str, Any]:
    """board.html in a JSON envelope; ``sampled_at`` = when it was rendered (mtime). Never raises."""
    meta = _file_meta(path)
    text, err = _read_board(path)
    rendered = meta["file_mtime"] if text is not None else None
    age = _age_s(_parse(rendered))
    return {"sampled_at": rendered, "rendered_at": rendered, "served_at": _now_z(), "path": _tilde(path),
            "bytes": meta["file_bytes"] if text is not None else None, "age_s": age,
            "stale_after_s": STALE_AFTER_S, "stale": age is None or age > STALE_AFTER_S,
            "html": text, "error": err}


@router.get("/office")
def office() -> Dict[str, Any]:
    return office_payload()


@router.get("/office/board")
def office_board() -> Dict[str, Any]:
    return board_payload()


@router.get("/office/board.html", response_class=HTMLResponse)
def office_board_html() -> HTMLResponse:
    text, err = _read_board(BOARD_FILE)
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
               "Content-Security-Policy": BOARD_CSP}
    if text is None:
        body = ("<!doctype html><meta charset='utf-8'><title>No board</title><p>" +
                (err or "no board").replace("&", "&amp;").replace("<", "&lt;") + "</p>")
        return HTMLResponse(body, status_code=404, headers=headers)
    return HTMLResponse(text, headers=headers)


# --------------------------------------------------------------------------- #
# selftest — fictional data only (this repo is public)
# --------------------------------------------------------------------------- #
def _selftest() -> int:
    import tempfile
    from datetime import timedelta

    fails = []

    def ok(cond: bool, name: str) -> None:
        print(("  ok   " if cond else "  FAIL ") + name)
        if not cond:
            fails.append(name)

    with tempfile.TemporaryDirectory() as td:
        t = Path(td)
        missing = office_payload(t / "nope.json")
        ok(missing["sampled_at"] is None and missing["schema"] is None and "no office.json" in missing["error"]
           and missing["served"]["stale"] is True, "office: a missing file is an explicit state, not a 500")

        fresh_at = _z(datetime.now(timezone.utc) - timedelta(minutes=3))
        doc = {"schema": OFFICE_SCHEMA, "writer": "test", "sampled_at": fresh_at,
               "disciplines": ["product", "ops"],
               "projects": [{"slug": "alpha", "display_name": "Project Alpha", "counts": {"active": 1, "stale": 0, "none": 1},
                             "disciplines": {"product": {"state": "active", "note": "last output today"},
                                             "ops": {"state": "none", "note": "no agent"}}}]}
        (t / "office.json").write_text(json.dumps(doc))
        got = office_payload(t / "office.json")
        ok(got["sampled_at"] == fresh_at, "office: sampled_at is the file's, passed through unchanged")
        ok({k: v for k, v in got.items() if k != "served"} == doc, "office: every other key is the file's, unchanged")
        ok(got["served"]["stale"] is False and 150 <= got["served"]["age_s"] <= 260
           and got["served"]["schema_note"] is None and got["served"]["file_bytes"] > 0,
           "office: served carries age, size and stale=false for a 3-minute-old sample")

        old = dict(doc, sampled_at=_z(datetime.now(timezone.utc) - timedelta(hours=2)))
        (t / "old.json").write_text(json.dumps(old))
        ok(office_payload(t / "old.json")["served"]["stale"] is True, "office: a 2-hour-old sample is stale")

        (t / "odd.json").write_text(json.dumps(dict(doc, schema="office v9")))
        ok("office v9" in (office_payload(t / "odd.json")["served"]["schema_note"] or ""),
           "office: an unknown schema is flagged, not refused")
        (t / "bad.json").write_text("{not json")
        ok("not valid JSON" in office_payload(t / "bad.json")["error"], "office: invalid JSON is an error string")
        (t / "list.json").write_text("[]")
        ok("not an object" in office_payload(t / "list.json")["error"], "office: a non-object is an error string")
        (t / "nots.json").write_text(json.dumps(dict(doc, sampled_at=None)))
        ok(office_payload(t / "nots.json")["served"]["stale"] is True, "office: no sampled_at reads as stale, never fresh")

        bm = board_payload(t / "nope.html")
        ok(bm["html"] is None and bm["sampled_at"] is None and "no board.html" in bm["error"],
           "board: a missing file is an explicit state")
        (t / "board.html").write_text("<!doctype html><title>b</title><p>board</p>")
        b = board_payload(t / "board.html")
        ok(b["html"].endswith("<p>board</p>") and b["error"] is None and b["sampled_at"] == b["rendered_at"]
           and b["stale"] is False and b["bytes"] > 0, "board: html wrapped, sampled_at = rendered_at = mtime")
        big = t / "big.html"
        big.write_bytes(b"x" * (BOARD_MAX_BYTES + 1))
        ok(board_payload(big)["html"] is None and "cap" in board_payload(big)["error"], "board: an oversized file is refused")

        global BOARD_FILE
        keep = BOARD_FILE
        try:
            BOARD_FILE = t / "board.html"
            r = office_board_html()
            ok(r.status_code == 200 and b"<p>board</p>" in r.body and "script-src" not in r.headers["content-security-policy"]
               and "default-src 'none'" in r.headers["content-security-policy"], "board.html: 200, the file, a no-script CSP")
            BOARD_FILE = t / "nope.html"
            r = office_board_html()
            ok(r.status_code == 404 and b"no board.html" in r.body, "board.html: 404 with the reason when missing")
        finally:
            BOARD_FILE = keep

    print(f"selftest: {'PASS' if not fails else 'FAIL'} — {len(fails)} failure(s)")
    return 0 if not fails else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(_selftest())
