/**
 * Today — the one page. Four blocks, in the order a person needs them:
 *
 *   1. NEEDS YOU        what waits on a human hand (the only block with actions)
 *   2. WHAT THE AGENTS DID   newest first, one row each, expand for the text
 *   3. GOALS            the OKRs from the repo, derived where a file allows it
 *   4. THE BOX          one line; details fold out (the former Fleet page)
 *   5. THE BOARD        queue/tasks.json as it is: what the agents are on, who holds it, the verdict
 *   6. AGENTS NOW       one roster: the Mac's herdr panes (60 s snapshot) + this box's units
 *
 * Built for two readers: Karl at a glance, and an agent that wants the whole
 * state in one call — the "Copy for an agent" button copies the same digest the
 * backend serves at /today.txt.
 *
 * LIVE (/live) is the call: the open cards in batches of five around one tray,
 * grouped by the agent that acts on Karl's word, with the `decide` line to copy.
 * Its order, batches, receipts (with the word and who gave it) and session number
 * come from the server's `live` block when it has one; an un-restarted server
 * without it gets the same view computed here. The same parked-aware count
 * ("N need you") is computed here, once, and shown on Today, on /live, in the
 * status bar and in the ⌘K palette.
 *
 * VERB (a), OFF. With ANSWER_ON_PAGE below false (the default) the page writes
 * nothing — `decide` in a terminal is the one answer place. See ANSWER_ON_PAGE.
 *
 * MONITOR (/monitor) is B's board with lanes by room, behind a flag that is ON
 * (MONITOR_ON); its rooms are the box gateway's, read live by today_api.py.
 *
 * Pure SDK-consumer work, same shape as before: a `/fleet` route + a sidebar row,
 * data from the Fleet plugin's REST router through `ctx.rest`. Plain ESM, no
 * build step, hot-reloaded from `~/.hermes/desktop-plugins/fleet/plugin.js`.
 *
 * READ-ONLY BY DESIGN, EXCEPT `answer`. It reports; it does not control. Every
 * action is a copy-pasteable command a human runs — Hermes is interface and chat
 * runtime, never orchestration. The one exception is verb (a), shipped off.
 *
 * Honesty rules, unchanged and still paid for:
 *   - every sampled value renders its sample time beside it;
 *   - a refresh that fails after a good sample shows a loud STALE state, never a
 *     current-looking number (the day-after rule);
 *   - "declared" and "derived" numbers are labelled as such;
 *   - what this box cannot see (Slack cloud agents) is said, not omitted.
 */

import * as SDK from '@hermes/plugin-sdk'
import React, { useEffect, useState } from 'react'

// Read off the namespace, not named-imported: a named import this Desktop build
// does not export fails the whole plugin at link time, so the optional surfaces
// (status bar, palette, navigate) are feature-detected and simply skipped.
const { ROUTES_AREA, SIDEBAR_NAV_AREA } = SDK
const STATUSBAR_RIGHT = SDK.STATUSBAR_AREAS ? SDK.STATUSBAR_AREAS.right : null
const PALETTE_AREA = SDK.PALETTE_AREA || null
const TITLEBAR_RIGHT = SDK.TITLEBAR_AREAS ? SDK.TITLEBAR_AREAS.right : null
const TITLEBAR_LEFT = SDK.TITLEBAR_AREAS ? SDK.TITLEBAR_AREAS.left : null
const STATUSBAR_LEFT = SDK.STATUSBAR_AREAS ? SDK.STATUSBAR_AREAS.left : null
const BOTS_PANE_AREA = SDK.BOTS_PANE_AREA || null // the Lucky Loop Hermes fork's area; stock Desktops skip the sidebar sections
const THEMES_AREA = SDK.THEMES_AREA || null
function navigate(path) {
  try { if (SDK.host && typeof SDK.host.navigate === 'function') SDK.host.navigate(path) } catch { /* no-op */ }
}

const h = React.createElement
const POLL_MS = 15000
const IDLE_POLL_MS = 60000 // when only the status bar is listening
const BATCH = 5
/* VERB (a) — answer on the page. ON since slice 3 (2026-09-27): the page's channel exists.
 * The Desktop's main process attaches X-Fleet-Answer-Key, a secret held only on the Mac (its
 * remote-connection headers), to every request to the box; the box keeps only its sha256, so a
 * box process holding the session token cannot answer (see answer_api.py). On only when all three are on:
 *   here:        ANSWER_ON_PAGE = true, then install this file (atomically) on the Mac;
 *   on the box:  echo on > ~/.config/lucky-loop/fleet-answer-verb  (read per request);
 *   both sides:  the page key, set by hermes/tools/answer-channel-rotate (run on the Mac).
 * Page flag off: no send button. Box flag off: POST /answer is 404. No page key: 403.
 * Only Karl's click on that card's own button sends an answer: one card per click, and
 * a tier-3 word only after a second click that shows the card's title and the word.
 * The route takes an open card id and one word from that card's options, or `later`,
 * and nothing else. It logs time, card and word; the verifier reads that log at
 * clock-out. No key sends: the keys still only pick a word and copy its decide line. */
const ANSWER_ON_PAGE = true
let answerInFlight = false // one answer at a time, across every view: a click while one is out is dropped
/* The page key's state as the box saw THIS Desktop's request: match | missing | wrong | no-verifier.
 * Asked at most every 10 min (and again after a refused send); Send is drawn only on match. */
let pageKey = null
let pageKeyAt = 0
function probePageKey() {
  if (!restFn || Date.now() - pageKeyAt < 600000) return
  pageKeyAt = Date.now()
  restFn('/answer/channel')
    .then(r => { pageKey = (r && r.page_key) || 'unknown' })
    .catch(() => { pageKey = 'unreachable'; pageKeyAt = Date.now() - 540000 })
}
function pageKeyNote() {
  return ANSWER_ON_PAGE && pageKey && pageKey !== 'match'
    ? '; Send is off — the box says page key ' + pageKey + ' (hermes/tools/answer-channel-rotate --check)'
    : '; this page writes nothing'
}
/* The one POST this page can make. Null when another answer is still out (the click is dropped). */
function postAnswer(body) {
  if (answerInFlight || !restFn) return null
  answerInFlight = true
  return restFn('/answer', { method: 'POST', body })
    .catch(err => { pageKeyAt = 0; throw err }) // a refusal re-asks the key's state on the next render
    .finally(() => { answerInFlight = false; sample() })
}
const STYLE_ID = 'fleet-plugin-style'

const CSS = `
.tdy-root{padding:22px 28px 64px;max-width:1040px;font-size:14px;line-height:1.45}
.tdy-root h1{font-size:30px;font-weight:650;margin:0 0 4px;letter-spacing:-.015em}
.tdy-stamp{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11.5px;opacity:.55;
  font-variant-numeric:tabular-nums;margin-bottom:14px}
.tdy-verdict{font-size:22px;font-weight:600;margin:6px 0 2px}
.tdy-verdict.tdy-calm{opacity:.85}
.tdy-verdict.tdy-hot{color:#e26d5c}
.tdy-oneline{font-size:13.5px;opacity:.72;margin:0 0 6px}
.tdy-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}
.tdy-btn{font:inherit;font-size:12px;padding:5px 10px;border-radius:6px;cursor:pointer;
  border:1px solid rgba(128,128,128,.35);background:rgba(128,128,128,.08);color:inherit}
.tdy-btn:hover{background:rgba(128,128,128,.16)}
.tdy-btn.tdy-small{font-size:11px;padding:2px 7px}
.tdy-section{margin-top:30px}
.tdy-shead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
  border-bottom:1px solid rgba(128,128,128,.25);padding-bottom:7px;margin-bottom:12px}
.tdy-shead h2{font-size:17px;font-weight:650;margin:0;letter-spacing:-.005em}
.tdy-count{display:inline-block;min-width:22px;text-align:center;padding:0 7px;border-radius:999px;
  font-size:12px;font-weight:600;background:rgba(128,128,128,.18)}
.tdy-count.tdy-hot{background:#e26d5c;color:#fff}
.tdy-count.tdy-zero{opacity:.5}
.tdy-meta{font-size:11.5px;opacity:.55;font-variant-numeric:tabular-nums;margin-left:auto}
.tdy-empty{opacity:.6;font-size:13.5px;padding:6px 0}
.tdy-card{border:1px solid rgba(128,128,128,.26);border-radius:9px;padding:11px 14px;margin-bottom:8px;
  background:rgba(128,128,128,.05);display:grid;grid-template-columns:30px 1fr;gap:4px 12px}
.tdy-card.tdy-derived{border-style:dashed}
.tdy-num{font-size:18px;font-weight:650;opacity:.6;font-variant-numeric:tabular-nums;line-height:1.2}
.tdy-title{font-size:15px;font-weight:600}
.tdy-why{font-size:12.5px;opacity:.72;margin-top:2px;max-width:80ch}
.tdy-cmdrow{display:flex;align-items:flex-start;gap:8px;margin-top:7px}
.tdy-cmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;opacity:.85;
  white-space:pre-wrap;overflow-wrap:anywhere;flex:1;padding:6px 8px;border-radius:6px;
  background:rgba(128,128,128,.1)}
.tdy-since{font-size:11px;opacity:.5;margin-top:5px;font-variant-numeric:tabular-nums}
.tdy-steps{display:flex;gap:8px;align-items:flex-start;margin-top:7px;font-size:12.5px;opacity:.85;
  white-space:pre-wrap;max-width:88ch}
.tdy-lbl{flex:none;display:inline-block;min-width:44px;font-size:10px;text-transform:uppercase;
  letter-spacing:.08em;opacity:.55;margin-top:6px}
.tdy-check{opacity:.7}
.tdy-tag{display:inline-block;margin-left:8px;padding:0 6px;border-radius:4px;font-size:9.5px;
  text-transform:uppercase;letter-spacing:.06em;background:rgba(128,128,128,.18);opacity:.85;vertical-align:middle}
.tdy-rows{display:grid;gap:4px}
.tdy-row{display:grid;grid-template-columns:52px 84px 1fr auto;gap:6px 12px;align-items:baseline;
  padding:7px 10px;border:1px solid rgba(128,128,128,.2);border-radius:7px;font-size:13px}
.tdy-row.tdy-open{cursor:pointer}
.tdy-row.tdy-open:hover{background:rgba(128,128,128,.07)}
.tdy-row.tdy-bad{border-color:rgba(226,109,92,.55);background:rgba(226,109,92,.08)}
.tdy-when{font-variant-numeric:tabular-nums;opacity:.6;font-size:12px}
.tdy-agent{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;opacity:.85}
.tdy-job{min-width:0}
.tdy-jobname{font-weight:600}
.tdy-sum{opacity:.72;font-size:12.5px;margin-top:1px;overflow-wrap:anywhere}
.tdy-pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:10.5px;
  text-transform:uppercase;letter-spacing:.05em;border:1px solid currentColor;white-space:nowrap}
.tdy-p-ok{color:#4caf6d}.tdy-p-idle{color:rgba(128,128,128,.9)}.tdy-p-quiet{color:rgba(128,128,128,.9)}
.tdy-p-blocked{color:#d9a441}.tdy-p-failed{color:#e26d5c}.tdy-p-stopped{color:#e26d5c}.tdy-p-unknown{color:rgba(128,128,128,.9)}
.tdy-text{grid-column:1 / -1;font-size:12.5px;white-space:pre-wrap;overflow-wrap:anywhere;opacity:.85;
  padding:8px 10px;border-radius:6px;background:rgba(128,128,128,.08);margin-top:4px;max-height:420px;overflow:auto}
.tdy-note{font-size:12px;opacity:.55;margin:10px 0 0;max-width:80ch;line-height:1.5}
.tdy-obj{border:1px solid rgba(128,128,128,.24);border-radius:9px;padding:10px 14px;margin-bottom:8px}
.tdy-objhead{display:grid;grid-template-columns:40px 1fr auto;gap:12px;align-items:center;cursor:pointer}
.tdy-objid{font-weight:650;opacity:.6}
.tdy-objtitle{font-weight:600;font-size:14.5px}
.tdy-objmeta{font-size:11.5px;opacity:.6;font-variant-numeric:tabular-nums;white-space:nowrap}
.tdy-bar{height:8px;border-radius:999px;background:rgba(128,128,128,.18);margin:8px 0 2px;overflow:hidden}
.tdy-bar>div{height:100%;border-radius:999px;background:#4c8fd6}
.tdy-obj.tdy-met .tdy-bar>div{background:#4caf6d}
.tdy-obj.tdy-overdue .tdy-bar>div{background:#e26d5c}
.tdy-krs{margin:10px 0 2px;display:grid;gap:6px}
.tdy-kr{display:grid;grid-template-columns:42px 1fr;gap:10px;font-size:12.5px;align-items:baseline}
.tdy-krpct{font-variant-numeric:tabular-nums;font-weight:600;opacity:.75;text-align:right}
.tdy-krlive{font-size:11.5px;opacity:.6;margin-top:1px;font-variant-numeric:tabular-nums}
.tdy-boxline{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px;align-items:baseline}
.tdy-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#4caf6d;margin-right:8px;vertical-align:middle}
.tdy-dot.tdy-bad{background:#e26d5c}
.tdy-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.tdy-err{border:1px solid rgba(226,109,92,.5);background:rgba(226,109,92,.09);padding:9px 12px;border-radius:6px;font-size:12.5px}
.tdy-stalebar{border:2px solid #e26d5c;background:rgba(226,109,92,.16);color:inherit;
  padding:12px 14px;border-radius:8px;font-size:14px;font-weight:600;margin:0 0 14px}
.tdy-stalebar small{display:block;font-weight:400;font-size:12px;opacity:.8;margin-top:4px}
.tdy-stale .tdy-body{opacity:.42;filter:grayscale(1);pointer-events:none}
.tdy-details{margin-top:14px;padding-top:6px;border-top:1px dashed rgba(128,128,128,.3)}
/* --- the former Fleet sections, kept for the details fold --- */
.flt-section{margin-top:26px}
.flt-shead{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;
  border-bottom:1px solid rgba(128,128,128,.25);padding-bottom:7px;margin-bottom:14px}
.flt-shead h2{font-size:15px;font-weight:600;margin:0}
.flt-meta{font-size:11.5px;opacity:.55;font-variant-numeric:tabular-nums}
.flt-stats{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.flt-stat{border:1px solid rgba(128,128,128,.26);border-radius:8px;padding:11px 13px;background:rgba(128,128,128,.05)}
.flt-stat-l{font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;opacity:.58;margin-bottom:5px}
.flt-stat-v{font-size:23px;font-weight:600;line-height:1.05;font-variant-numeric:tabular-nums}
.flt-unit{font-size:13px;font-weight:500;opacity:.6;margin-left:2px}
.flt-stat-s{font-size:11.5px;opacity:.58;margin-top:4px;font-variant-numeric:tabular-nums}
.flt-warn .flt-stat-v{color:#d9a441}.flt-crit .flt-stat-v{color:#e26d5c}
.flt-caveat{font-size:12px;opacity:.58;margin:12px 0 0;max-width:78ch;line-height:1.5}
.flt-section h3{font-size:12.5px;font-weight:600;margin:16px 0 8px;text-transform:uppercase;letter-spacing:.07em;opacity:.62}
.flt-checks{display:grid;gap:5px}
.flt-check{display:flex;align-items:center;gap:10px;padding:6px 10px;border:1px solid rgba(128,128,128,.22);border-radius:6px;font-size:12.5px}
.flt-dot{width:7px;height:7px;border-radius:50%;flex:none;background:#4caf6d}
.flt-bad .flt-dot{background:#e26d5c}
.flt-bad{border-color:rgba(226,109,92,.5);background:rgba(226,109,92,.08)}
.flt-ck{flex:0 0 240px}.flt-cg{opacity:.8}.flt-cn{opacity:.5;font-size:11.5px;margin-left:auto;text-align:right}
.flt-scroll{overflow-x:auto}
.flt-table{width:100%;border-collapse:collapse;font-size:12.5px}
.flt-table th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.09em;opacity:.55;font-weight:600;
  padding:6px 10px;border-bottom:1px solid rgba(128,128,128,.3);white-space:nowrap}
.flt-table td{padding:7px 10px;border-bottom:1px solid rgba(128,128,128,.14);vertical-align:top}
.flt-r{text-align:right;font-variant-numeric:tabular-nums}
.flt-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.flt-dim{opacity:.55}.flt-desc{opacity:.68;max-width:44ch}.flt-detail{font-size:11px;opacity:.55;margin-top:3px}
.flt-raw{max-width:52ch;overflow-wrap:anywhere;opacity:.7}
.flt-rowbad{background:rgba(226,109,92,.09)}
.flt-pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:10.5px;text-transform:uppercase;
  letter-spacing:.05em;border:1px solid currentColor;white-space:nowrap}
.flt-p-ok{color:#4caf6d}.flt-p-idle{color:rgba(128,128,128,.9)}.flt-p-masked{color:#d9a441}.flt-p-bad{color:#e26d5c}
.flt-tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:4px;font-size:9.5px;text-transform:uppercase;
  letter-spacing:.06em;background:rgba(128,128,128,.18);opacity:.8}
.flt-warnbar{border:1px solid rgba(217,164,65,.55);background:rgba(217,164,65,.1);padding:9px 12px;border-radius:6px;font-size:12.5px;margin-bottom:12px}
.flt-err{border:1px solid rgba(226,109,92,.5);background:rgba(226,109,92,.09);padding:9px 12px;border-radius:6px;font-size:12.5px}
/* --- needs you: agent · kind · ask, and the decide lines --- */
.tdy-agenthead{display:flex;align-items:baseline;gap:10px;margin:16px 0 6px;font-size:12px;
  text-transform:uppercase;letter-spacing:.08em;opacity:.7;font-weight:600}
.tdy-ask{font-size:15px;font-weight:600}
.tdy-kind{display:inline-block;margin-right:8px;padding:0 6px;border-radius:4px;font-size:10px;font-weight:650;
  letter-spacing:.06em;border:1px solid rgba(128,128,128,.45);vertical-align:middle}
.tdy-sub{font-size:12px;opacity:.6;margin-top:2px}
.tdy-decide{display:flex;align-items:center;gap:8px;margin-top:5px}
.tdy-decide .tdy-cmd{flex:0 1 auto}
.tdy-hold{opacity:.6;font-size:12px;margin-top:6px}
.tdy-parked{display:grid;gap:4px;margin-top:8px}
.tdy-parkrow{font-size:12.5px;opacity:.6;padding:5px 10px;border:1px dashed rgba(128,128,128,.3);border-radius:6px}
.tdy-warn{color:#d9a441}
.tdy-chip{font:inherit;font-size:11px;padding:0 8px;border-radius:999px;cursor:pointer;white-space:nowrap;
  border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;opacity:.8}
.tdy-chip.tdy-hot{background:#d95926;border-color:#d95926;color:#fff;opacity:1}
/* --- live: the call as plan C draws it (c-stage.html). Its own dark tokens, so it looks the same under any app theme --- */
.lv-stage,.mn-stage{--surface:#161615;--surface-3:#292927;--stage:#0a0a0a;--chrome:#121211;--ink:#f4f3ee;--ink-2:#c3c2b7;--ink-3:#898781;
  --ink-4:#63625d;--grid:#2c2c2a;--line:rgba(255,255,255,.09);--line-2:rgba(255,255,255,.15);--blue:#3987e5;--orange:#d95926;
  --good:#3fbf3f;--danger:#e66767;--warn:#d9a441;--sans:ui-sans-serif,system-ui,-apple-system,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;--e:cubic-bezier(.2,.7,.2,1)}
.lv-stage{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:calc(100vh - 72px);min-height:560px;
  background:var(--stage);color:var(--ink);font:14px/1.45 var(--sans);text-align:left;color-scheme:dark;
  container-type:inline-size;-webkit-font-smoothing:antialiased}
.lv-stage *,.lv-stage *::before,.lv-stage *::after{box-sizing:border-box}
:where(.lv-stage) button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:inherit}
:where(.lv-stage) kbd{display:inline-grid;place-items:center;min-width:19px;height:19px;padding:0 4px;border-radius:5px;
  background:var(--surface-3);border:1px solid var(--line-2);font:500 10.5px/1 var(--mono);color:var(--ink-2)}
.lv-mono{font-family:var(--mono)}
.lv-dim{color:var(--ink-3)}
.lv-warn{color:var(--warn)}
.lv-c-failed{color:var(--danger)}
.lv-c-working{color:var(--blue)}
.lv-c-done{color:var(--good)}
.lv-msg{padding:22px 16px;color:var(--ink-2)}
.lv-cb{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 16px;min-width:0;
  border-bottom:1px solid var(--line);background:var(--chrome)}
.lv-cb-l{display:flex;align-items:center;gap:12px;min-width:0}
.lv-live{display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:600;flex:none}
.lv-live i{width:7px;height:7px;border-radius:50%;background:var(--ink)}
.lv-sum{font-size:13px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.lv-sum b{color:var(--ink);font-weight:600}
.lv-pp{color:var(--ink-3)}
.lv-pp0{color:var(--ink-2)}
.lv-cb-r{display:flex;align-items:center;gap:12px;flex:none}
.lv-stamp{font:11px/1 var(--mono);color:var(--ink-3);white-space:nowrap}
.lv-cbtn{height:28px;padding:0 11px;border-radius:8px;border:1px solid var(--line-2);font-size:12.5px;color:var(--ink-2);
  display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.02);white-space:nowrap}
.lv-cbtn:hover{color:var(--ink);border-color:rgba(255,255,255,.28)}
.lv-cbtn.lv-leave{color:var(--ink);border-color:rgba(255,255,255,.26)}
.lv-cbtn svg{width:15px;height:15px;flex:none}
.lv-st{min-height:0;overflow:auto;padding:14px 16px}
.lv-grid{height:100%;min-height:0;display:grid;gap:12px;grid-template-columns:repeat(5,minmax(0,1fr));grid-auto-rows:minmax(150px,1fr)}
.lv-quiet .lv-tile{background:#131312}
.lv-tile{position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;padding:11px 14px 12px;border-radius:14px;
  border:1px solid var(--line);overflow:hidden;cursor:pointer;color:var(--ink);transition:border-color .2s var(--e);
  background:radial-gradient(85% 65% at 50% 36%,hsl(var(--h,220) 42% 52% / .12),transparent 72%),#161615}
.lv-tile:hover{border-color:rgba(255,255,255,.2)}
.lv-tile.lv-speaking{border-color:rgba(244,243,238,.72)}
.lv-away .lv-face svg{filter:saturate(.8) drop-shadow(0 8px 16px rgba(0,0,0,.5));opacity:.5}
.lv-tile[data-s=parked]{background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.028) 0 6px,transparent 6px 12px)}
.lv-where{font:10.5px/16px var(--mono);color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:46px}
.lv-face{flex:1 1 0;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:36px}
.lv-face svg{display:block;height:100%;width:auto;max-height:76px;filter:drop-shadow(0 8px 16px rgba(0,0,0,.5))}
.lv-name{display:flex;align-items:center;gap:7px;font-size:15.5px;font-weight:600;letter-spacing:-.01em;line-height:1.3;min-width:0}
.lv-name span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-kg{width:14px;height:14px;color:var(--ink-3);flex:none}
.lv-cap{margin-top:3px;font-size:13px;line-height:1.42;color:var(--ink-2);min-height:37px;overflow:hidden;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lv-cap b{color:var(--ink);font-weight:500}
.lv-tst{margin-top:7px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-3);white-space:nowrap;overflow:hidden}
.lv-sl{display:inline-flex;align-items:center;gap:6px;font-weight:500}
.lv-sl.lv-nd{color:var(--ink-2)}
.lv-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.lv-dot.lv-parkdot{background:none;border:1.5px dashed var(--ink-3)}
.lv-fold{margin-top:3px;font-size:11.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-hand{position:absolute;top:9px;right:10px;z-index:2;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px 0 8px;
  border-radius:999px;background:var(--orange);color:var(--ink);font-size:13px;font-weight:600;line-height:1;
  font-variant-numeric:tabular-nums;box-shadow:0 6px 18px -5px rgba(217,89,38,.6)}
.lv-hand svg{width:15px;height:15px;flex:none}
.lv-host{grid-column:span 2;cursor:default;background:linear-gradient(180deg,#171716,#131312)}
.lv-host:hover{border-color:var(--line)}
.lv-host.lv-wide{grid-column:span 3}
.lv-host.lv-alone{align-self:start}
.lv-hhd{display:flex;align-items:center;gap:8px;white-space:nowrap;min-width:0}
.lv-hname{font-size:15.5px;font-weight:600}
.lv-tag{font:500 9.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);border:1px solid var(--line-2);
  border-radius:4px;padding:3px 5px}
.lv-ok{margin-left:auto;font:11px/1.2 var(--mono);color:var(--ink-3);overflow:hidden;text-overflow:ellipsis}
.lv-hgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px;margin-top:12px;flex:none}
.lv-hsub{font:500 10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin:0 0 5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-gpu{display:flex;align-items:center;gap:10px;margin-top:8px}
.lv-big{font:500 30px/1 var(--mono);letter-spacing:-.04em;flex:none}
.lv-big small{font-size:15px;color:var(--ink-3)}
.lv-bar{height:6px;border-radius:3px;background:var(--grid);margin:12px 0 5px;overflow:hidden}
.lv-bar i{display:block;height:100%;background:var(--ink-2);border-radius:3px}
.lv-hl{font-size:11.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-hl .lv-mono{color:var(--ink-2)}
.lv-fl{font-size:11.5px;line-height:1.55;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-fl .lv-mono{color:var(--ink-3);margin-right:4px}
.lv-tmr{margin-top:auto;padding-top:10px;font-size:11.5px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-tmr .lv-hsub{display:inline;margin-right:8px}
.lv-tmr i{font-style:normal;color:var(--ink-4);margin:0 5px}
.lv-tray{border-top:1px solid var(--line);background:var(--chrome);padding:14px 18px 15px;display:grid;
  grid-template-columns:minmax(0,1fr) minmax(0,330px) 236px;gap:22px;align-items:start}
.lv-trq{display:flex;gap:14px;min-width:0}
.lv-tface{width:44px;height:44px;flex:none;margin-top:3px}
.lv-tface svg{display:block;width:44px;height:44px}
.lv-trmeta{font-size:12px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-trmeta b{color:var(--ink-2);font-weight:500}
.lv-trtitle{margin-top:2px;font-size:20px;font-weight:600;letter-spacing:-.018em;line-height:1.28;color:var(--ink);overflow:hidden;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lv-trask{margin-top:4px;font-size:14px;line-height:1.45;color:var(--ink-2);max-width:72ch;overflow:hidden;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lv-trdef{margin-top:7px;font-size:12.5px;color:var(--ink-3);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lv-trdef b{color:var(--ink-2);font-weight:500}
.lv-picks{display:flex;flex-wrap:wrap;gap:6px}
.lv-pk{height:34px;display:inline-flex;align-items:center;gap:8px;padding:0 13px 0 7px;border-radius:9px;border:1px solid var(--line-2);
  background:var(--surface);font-size:13.5px;font-weight:500;color:var(--ink);white-space:nowrap}
.lv-pk:hover{border-color:rgba(255,255,255,.3)}
.lv-pk.lv-on{border-color:var(--ink);background:var(--surface-3)}
.lv-pk.lv-on kbd{background:var(--ink);border-color:var(--ink);color:#121211}
.lv-echo{margin-top:9px;font-size:12.5px;color:var(--ink-2);min-height:37px}
.lv-echo b{color:var(--ink);font-weight:600}
.lv-never{margin-top:8px;display:flex;gap:7px;font-size:12px;line-height:1.45;color:var(--ink-3)}
.lv-never svg{width:13px;height:13px;flex:none;margin-top:2px}
.lv-latr{margin-top:8px;font-size:11.5px;color:var(--ink-4)}
.lv-lat{font:500 12px/1.2 var(--mono);color:var(--ink-3);border-bottom:1px dashed var(--ink-4);margin-right:7px}
.lv-lat:hover,.lv-lat.lv-on{color:var(--ink)}
.lv-conf{display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap}
.lv-confirm{height:34px;padding:0 9px 0 14px;border-radius:9px;background:var(--ink);color:#121211;font-size:13.5px;font-weight:600;
  display:inline-flex;align-items:center;gap:8px;flex:none}
.lv-confirm kbd{background:rgba(0,0,0,.07);border-color:rgba(0,0,0,.18);color:#121211}
.lv-confirm:disabled{background:var(--surface-3);color:var(--ink-4);cursor:default}
.lv-confirm:disabled kbd{background:transparent;border-color:var(--line-2);color:var(--ink-4)}
.lv-ow{font-size:12px;color:var(--ink-3);min-width:0;flex:1 1 100%;min-height:35px}
.lv-send{height:34px;padding:0 14px;border-radius:9px;border:1px solid var(--orange);color:var(--ink);font-size:13.5px;font-weight:600;flex:none}
.lv-send.lv-arm{background:var(--orange);color:#121211}
.lv-send:disabled{border-color:var(--line-2);color:var(--ink-4);background:none;cursor:default}
.lv-sent{font-size:12px;color:var(--ink-2)}
.lv-sent.lv-bad{color:var(--danger)}
.lv-dl{font-family:var(--mono);color:var(--ink-2);overflow-wrap:anywhere}
.lv-tb{border-left:1px solid var(--line);padding-left:18px;font-size:12px;color:var(--ink-3);line-height:1.45;min-width:0}
.lv-tbh{font-size:13px;color:var(--ink);font-weight:500}
.lv-pips{display:flex;gap:4px;margin:9px 0}
.lv-pip{flex:1;height:5px;border-radius:3px;background:var(--grid)}
.lv-pip.lv-cur{background:var(--ink)}
.lv-dim2{color:var(--ink-4);margin-top:3px}
.lv-navs{display:flex;gap:6px;margin-top:8px}
.lv-nav{height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--line-2);font-size:12px;color:var(--ink-2)}
.lv-nav:hover{color:var(--ink);border-color:rgba(255,255,255,.28)}
.lv-tbk{margin-top:9px;display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:11.5px}
.lv-zero{grid-column:1/-1;display:flex;align-items:center;gap:16px;min-height:62px}
.lv-handoff{width:34px;height:34px;border-radius:50%;border:1px solid var(--line-2);display:grid;place-items:center;color:var(--ink-3);flex:none}
.lv-handoff svg{width:16px;height:16px}
.lv-tzt{font-size:22px;font-weight:600}
.lv-tzs{font-size:13px;color:var(--ink-3)}
@container (max-width:1100px){.lv-tray{grid-template-columns:minmax(0,1fr) minmax(0,280px) 200px;gap:18px}}
@container (max-width:880px){.lv-grid{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:minmax(200px,1fr)}
  .lv-tray{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.lv-trq{grid-column:1/-1}}
.tdy-chip.tdy-title{font-size:12px;padding:1px 10px;font-weight:600}
/* --- monitor: B's board with lanes by room (b-board.html). Only needs-you is loud; the rest is ink --- */
.mn-stage{--mcols:208px minmax(0,1.7fr) minmax(0,1.25fr) minmax(0,.8fr);min-height:calc(100vh - 72px);
  background:var(--stage);color:var(--ink);font:14px/1.45 var(--sans);text-align:left;color-scheme:dark;
  container-type:inline-size;-webkit-font-smoothing:antialiased}
.mn-stage *,.mn-stage *::before,.mn-stage *::after{box-sizing:border-box}
:where(.mn-stage) button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:inherit}
.mn-tag{font:500 9.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);border:1px dashed var(--line-2);
  border-radius:4px;padding:3px 5px;white-space:nowrap}
.mn-bh,.mn-lane{display:grid;grid-template-columns:var(--mcols)}
.mn-bh{position:sticky;top:0;z-index:2;background:var(--chrome);border-bottom:1px solid var(--grid)}
.mn-bh>div{padding:9px 12px 8px;display:flex;flex-direction:column;justify-content:flex-end;gap:3px;min-width:0}
.mn-eb{font:500 10.5px/1.3 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.mn-n{font:600 20px/1 var(--mono);letter-spacing:-.03em;color:var(--ink-2)}
.mn-nyh{box-shadow:inset 1px 0 0 var(--grid)}
.mn-nyh.mn-hot{box-shadow:inset 1px 0 0 rgba(217,89,38,.34);background:rgba(217,89,38,.04)}
.mn-nyh.mn-hot .mn-eb{color:#e8906b}
.mn-nyh.mn-hot .mn-n{font-size:30px;color:var(--orange)}
.mn-pkh,.mn-pkc{border-left:1px solid var(--grid)}
.mn-lane{border-bottom:1px solid var(--grid);min-height:72px}
.mn-lane.mn-none .mn-lh .mn-rn{color:var(--ink-2)}
.mn-lh{padding:10px 10px 10px 14px;border-right:1px solid var(--grid);display:flex;flex-direction:column;gap:4px;min-width:0}
.mn-rn{display:flex;align-items:center;gap:7px;font-size:13.5px;font-weight:600;letter-spacing:-.01em;line-height:1.25}
.mn-rn .mn-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-bdg{flex:none;min-width:20px;height:18px;padding:0 6px;border-radius:999px;background:var(--orange);color:var(--ink);
  font:600 11px/18px var(--mono);text-align:center}
.mn-me{font:400 10.5px/1.3 var(--mono);color:var(--ink-3)}
.mn-cell{padding:8px 10px;display:flex;flex-direction:column;gap:4px;min-width:0}
.mn-nyc{box-shadow:inset 1px 0 0 var(--grid);padding-left:13px}
.mn-nyc.mn-hot{box-shadow:inset 1px 0 0 rgba(217,89,38,.34);background:rgba(217,89,38,.03)}
.mn-e{font-size:12px;color:var(--ink-4);padding:2px 0}
.mn-mem{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:0 8px;align-items:center;min-width:0}
.mn-face{width:22px;height:22px;grid-row:span 2}
.mn-face svg{display:block;width:22px;height:22px}
.mn-mn{font-size:12.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mn-ml{font-size:11px;line-height:1.3;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;grid-column:2}
.mn-st{display:inline-flex;align-items:center;gap:5px;color:var(--ink-2)}
.mn-dot{width:6px;height:6px;border-radius:50%;background:var(--ink-4);flex:none}
.mn-dot[data-s=working]{background:var(--ink-2)}
.mn-dot[data-s=blocked]{background:none;border:1.5px solid var(--ink-3)}
.mn-dot[data-s=failed]{background:none;border:1.5px solid var(--ink-2);border-radius:1px}
.mn-cp{grid-row:span 2;font:500 10.5px/1 var(--mono);color:var(--ink-3);border:1px solid var(--line-2);border-radius:5px;padding:4px 6px}
.mn-cp:hover{color:var(--ink);border-color:rgba(255,255,255,.28)}
.mn-chip{position:relative;display:flex;align-items:center;gap:7px;min-height:22px;padding:2px 7px;border-radius:5px;font-size:12px;
  line-height:1.35;color:var(--ink);background:rgba(217,89,38,.1);border:1px solid rgba(217,89,38,.22);min-width:0;width:100%}
.mn-chip::before{content:'';position:absolute;left:-13px;top:2px;bottom:2px;width:2px;border-radius:1px;background:var(--orange)}
.mn-chip:hover{border-color:rgba(217,89,38,.5)}
.mn-chip .mn-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-chip .mn-x{flex:none;font:500 10px/1 var(--mono);color:#e8906b}
.mn-pk{font-size:11.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mn-pk .lv-mono{color:var(--ink-4);margin-right:5px}
.mn-empty{padding:26px 16px;color:var(--ink-2);font-size:13.5px;max-width:72ch}
.mn-note{padding:12px 16px 28px;font-size:11.5px;line-height:1.5;color:var(--ink-3);max-width:96ch}
.mn-note code{font-family:var(--mono);color:var(--ink-2)}
@container (max-width:860px){.mn-bh{display:none}
  .mn-lane{display:block;margin:10px 12px 0;border:1px solid var(--grid);border-radius:11px;overflow:hidden;min-height:0;background:#121211}
  .mn-lh{border-right:0;border-bottom:1px solid var(--grid)}
  .mn-pkc{border-left:0}
  .mn-cell[data-l]::before{content:attr(data-l);font:500 10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-4)}}
`

function injectStyle() {
  const old = document.getElementById(STYLE_ID)
  if (old && old.textContent === CSS) return
  if (old) old.remove()
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

const cls = (...a) => a.filter(Boolean).join(' ')
const fmt = (n, d = 1) =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(d)
const pct = p => Math.round((Number(p) || 0) * 100) + '%'

function ago(iso) {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 90) return s + 's ago'
  if (s < 5400) return Math.round(s / 60) + 'm ago'
  if (s < 172800) return Math.round(s / 3600) + 'h ago'
  return Math.round(s / 86400) + 'd ago'
}
function clock(iso) {
  try { return new Date(iso).toLocaleTimeString() } catch { return iso || '—' }
}
function when(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const today = new Date()
    const same = d.toDateString() === today.toDateString()
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return same ? t : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t
  } catch { return iso }
}

/* ------------------------------------------------------------------------ */
/* One sampler for every surface. Today and Live poll at 15 s while open; the  */
/* status bar alone polls at 60 s. Timers live only inside mounted components, */
/* so a hot reload that unmounts the contributions stops them.                 */
/* ------------------------------------------------------------------------ */
let restFn = null
const store = { data: null, err: null, lastOkAt: null, errAt: null, loading: true, tickKey: 0, receipts: [], since: null }
const seenOpen = new Map() // id -> card, every open card a sample has returned since the plugin loaded
let snap = { ...store } // the immutable snapshot React reads
const listeners = new Set() // useSyncExternalStore subscribers
const pollers = new Map() // token -> wants the fast cadence?
let timer = null
let timerFast = null

function emit() {
  snap = { ...store }
  listeners.forEach(l => { try { l() } catch { /* isolated */ } })
}
function subscribe(l) { listeners.add(l); return () => listeners.delete(l) }
const getSnap = () => snap
function sample() {
  if (!restFn) return
  restFn('/today')
    .then(d => {
      const ny = d && d.needs_you
      if (ny && !ny.error && Array.isArray(ny.items)) {
        const open = new Set(ny.items.map(i => i.id))
        const at = new Date().toISOString()
        seenOpen.forEach((card, id) => {
          if (!open.has(id)) { store.receipts = store.receipts.concat({ ...card, seenGoneAt: at }); seenOpen.delete(id) }
        })
        ny.items.forEach(i => seenOpen.set(i.id, i))
        if (!store.since) store.since = at
      }
      Object.assign(store, { data: d, err: null, lastOkAt: Date.now(), loading: false, tickKey: store.tickKey + 1 })
      emit()
    })
    .catch(e => { Object.assign(store, { err: String(e), errAt: Date.now(), loading: false }); emit() })
}
function reschedule() {
  const fast = [...pollers.values()].some(Boolean)
  if (!pollers.size) { if (timer) clearInterval(timer); timer = null; timerFast = null; return }
  if (timer && timerFast === fast) return
  if (timer) clearInterval(timer)
  timerFast = fast
  timer = setInterval(sample, fast ? POLL_MS : IDLE_POLL_MS)
}
function useToday(fast) {
  const s = React.useSyncExternalStore(subscribe, getSnap)
  useEffect(() => {
    const token = {}
    pollers.set(token, Boolean(fast))
    const age = store.lastOkAt ? Date.now() - store.lastOkAt : Infinity
    if (age > (fast ? POLL_MS : IDLE_POLL_MS)) sample()
    reschedule()
    return () => { pollers.delete(token); reschedule() }
  }, [fast])
  return s
}

/* The one N. The server's verdict counts parked cards, so it is recounted here:
 * a card parked until today or later is not waiting on Karl today. Same rule as
 * `decide`'s listing (local date, parked.until >= today). Derived items (a red
 * infra check, a lapsed credential) count too — nobody typed them, but they
 * still wait on a human hand. */
function localDay(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function isParked(i, today) {
  const p = i.parked || {}
  return Boolean(p.until) && String(p.until) >= today
}
function splitNeeds(ny) {
  const today = localDay()
  const items = (ny && ny.items) || []
  return {
    today,
    live: items.filter(i => !isParked(i, today)),
    parked: items.filter(i => isParked(i, today)),
    derived: (ny && ny.derived) || []
  }
}
function needCount(data) {
  if (!data || !data.needs_you || data.needs_you.error) return null
  const s = splitNeeds(data.needs_you)
  return s.live.length + s.derived.length
}
function needLine(n, parked) {
  const head = n === null ? 'The queue could not be read.'
    : n ? (n === 1 ? '1 thing needs you.' : n + ' things need you.') : 'Nothing needs you.'
  return head + (parked ? ' ' + parked + ' parked until later.' : '')
}
const byAgent = (a, b) =>
  String(a.agent || '~').localeCompare(String(b.agent || '~')) ||
  String(a.group || '').localeCompare(String(b.group || '')) ||
  (a.priority ?? 99) - (b.priority ?? 99) || String(a.since || '').localeCompare(String(b.since || ''))
/* The queue's own order, as the mockup sorts it: priority, then expiry, then
 * age. The tray asks in this order, five to a batch. */
const byQueue = (a, b) =>
  (a.priority ?? 99) - (b.priority ?? 99) ||
  String(a.expiry || '9999').localeCompare(String(b.expiry || '9999')) ||
  String(a.since || '').localeCompare(String(b.since || '')) || String(a.id).localeCompare(String(b.id))

/* A render error in one page shows here instead of blanking the Desktop pane. */
class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { try { console.error('[fleet] ' + (this.props.name || 'page') + ' failed to render', error) } catch { /* no-op */ } }
  render() {
    if (!this.state.error) return this.props.children
    const e = this.state.error
    return h('div', { className: 'tdy-root' },
      h('div', { className: 'tdy-err' },
        (this.props.name || 'This page') + ' failed to render: ' + String((e && e.message) || e).replace(/\.+$/, '') +
        '. Nothing was written anywhere; the queue is unchanged. `decide` in a terminal still works.'),
      h('div', { className: 'tdy-actions' },
        h('button', { className: 'tdy-btn', onClick: () => this.setState({ error: null }) }, 'Try again')))
  }
}

/* Status bar, right: the same N, one click to the call. */
function NeedChip({ title }) {
  const s = useToday(false)
  const n = needCount(s.data)
  const parked = s.data && s.data.needs_you ? splitNeeds(s.data.needs_you).parked.length : 0
  const label = n === null ? (s.loading ? 'needs you …' : 'needs you ?') : n + ' need you'
  return h('button', {
    type: 'button',
    className: cls('tdy-chip', n > 0 && 'tdy-hot', title && 'tdy-title'),
    title: needLine(n, parked) + (s.err ? ' Last refresh failed — this count is STALE.' : '') + ' Click: open Live.',
    onClick: () => navigate('/live')
  }, label + (s.err && s.data ? ' · stale' : ''))
}
function copy(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text)
  } catch { /* fall through */ }
  return Promise.resolve()
}

const Err = p => h('div', { className: 'tdy-err' }, 'Could not sample: ' + p.msg)

const Section = p =>
  h('section', { className: 'tdy-section' },
    h('div', { className: 'tdy-shead' },
      h('h2', null, p.title),
      p.count !== undefined
        ? h('span', { className: cls('tdy-count', p.hot && 'tdy-hot', !p.count && 'tdy-zero') }, String(p.count))
        : null,
      p.meta ? h('span', { className: 'tdy-meta' }, p.meta) : null),
    p.children)

/* ------------------------------------------------------------------------ */
/* 1. needs you                                                              */
/* ------------------------------------------------------------------------ */
function CopyBtn({ text, small }) {
  const [done, setDone] = useState(false)
  return h('button', {
    className: cls('tdy-btn', small && 'tdy-small'),
    onClick: () => copy(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) })
  }, done ? 'Copied' : 'Copy')
}

/* The lines Karl copies. The options render in the card's own order — on a
 * tier-3 card the first is the no-op word — and nothing here answers more than
 * one card or picks a word for him (A2). `later` parks through decide v2. */
function DecideLines({ i }) {
  const opts = i.options || []
  return h('div', null,
    opts.length
      ? opts.map(o => {
          const line = 'decide ' + i.id + ' ' + o
          return h('div', { key: o, className: 'tdy-decide' },
            h('pre', { className: 'tdy-cmd' }, line), h(CopyBtn, { text: line, small: true }))
        })
      : h('div', { className: 'tdy-hold tdy-warn' }, 'No options yet — nothing can answer this card; the chair adds them.'),
    h('div', { className: 'tdy-decide' },
      h('pre', { className: 'tdy-cmd tdy-check' }, 'decide ' + i.id + ' later'),
      h(CopyBtn, { text: 'decide ' + i.id + ' later', small: true })))
}

function AskHead({ i }) {
  return h('div', null,
    h('div', { className: 'tdy-ask' },
      h('span', { className: 'tdy-kind' }, i.ask_kind || '?'),
      i.ask || i.title,
      i.tier === 3 ? h('span', { className: 'tdy-tag' }, 'tier 3 · closes by your word') : null,
      i.agent_shipped === false ? h('span', { className: 'tdy-tag tdy-warn' }, 'agent not shipped') : null),
    i.ask && i.title && i.ask !== i.title ? h('div', { className: 'tdy-sub' }, i.title) : null)
}

function NeedsYou({ data: d }) {
  if (!d) return h(Err, { msg: 'no data' })
  const { live, parked, derived } = splitNeeds(d)
  const items = live.slice().sort(byAgent)
  let agent
  return h('div', null,
    d.error ? h('div', { className: 'tdy-err' }, d.error) : null,
    h('div', { className: 'tdy-why', style: { marginBottom: 10 } },
      'In any terminal: ', h('code', null, 'decide'), ' lists these; copy one ',
      h('code', null, 'decide <id> <word>'), ' line per card. This page writes nothing. ',
      'The Live page (sidebar) shows the same cards five at a time.'),
    !items.length && !derived.length && !d.error
      ? h('p', { className: 'tdy-empty' }, 'Nothing is waiting on you.')
      : null,
    items.map((i, idx) => {
      const head = i.agent !== agent
        ? h('div', { key: 'a' + idx, className: 'tdy-agenthead' }, i.agent || 'no agent yet',
            h('span', { className: 'tdy-count' }, String(items.filter(x => x.agent === i.agent).length)))
        : null
      agent = i.agent
      return [head,
        h('div', { key: i.id || idx, className: 'tdy-card' },
          h('div', { className: 'tdy-num' }, String(idx + 1)),
          h('div', null,
            h(AskHead, { i }),
            i.why ? h('div', { className: 'tdy-why' }, i.why) : null,
            // Three distinct things, never mixed on one line: STEPS a person follows
            // (not shell), COMMAND that is exactly what to paste (no comments, no
            // placeholders), CHECK that proves it took (placeholders allowed, marked).
            i.steps ? h('div', { className: 'tdy-steps' },
              h('span', { className: 'tdy-lbl' }, 'Do'), i.steps) : null,
            i.command ? h('div', { className: 'tdy-cmdrow' },
              h('span', { className: 'tdy-lbl' }, 'Paste'),
              h('pre', { className: 'tdy-cmd' }, i.command),
              h(CopyBtn, { text: i.command, small: true })) : null,
            i.check ? h('div', { className: 'tdy-cmdrow' },
              h('span', { className: 'tdy-lbl' }, 'Check'),
              h('pre', { className: 'tdy-cmd tdy-check' }, i.check),
              h(CopyBtn, { text: i.check, small: true })) : null,
            h('div', { className: 'tdy-cmdrow' },
              h('span', { className: 'tdy-lbl' }, 'Answer'),
              h('div', { style: { flex: 1 } }, h(DecideLines, { i }))),
            h('div', { className: 'tdy-since' },
              'waiting since ' + (i.since || '?') +
              (i.age_days !== null && i.age_days !== undefined ? ' · ' + i.age_days + ' days' : '') +
              (i.group ? ' · ' + i.group : '') +
              (i.source ? ' · ' + i.source : ''))))]
    }),
    derived.map((i, idx) =>
      h('div', { key: 'd' + idx, className: 'tdy-card tdy-derived' },
        h('div', { className: 'tdy-num' }, '•'),
        h('div', null,
          h('div', { className: 'tdy-title' }, i.title, h('span', { className: 'tdy-tag' }, 'derived')),
          i.why ? h('div', { className: 'tdy-why' }, i.why) : null,
          i.command ? h('div', { className: 'tdy-cmdrow' },
            h('pre', { className: 'tdy-cmd' }, i.command),
            h(CopyBtn, { text: i.command, small: true })) : null))),
    parked.length ? h('div', { className: 'tdy-parked' },
      h('div', { className: 'tdy-agenthead' }, 'Parked', h('span', { className: 'tdy-count tdy-zero' }, String(parked.length))),
      parked.map(i => h('div', { key: i.id, className: 'tdy-parkrow' },
        (i.agent ? i.agent + ' · ' : '') + (i.ask || i.title) + ' — until ' + i.parked.until +
        (i.parked.reason ? ' (' + i.parked.reason + ')' : '')))) : null,
    h('p', { className: 'tdy-note' },
      'Only you close a card, with decide. Agents add; they never close.' +
      (d.updated_at ? ' Queue last updated ' + ago(d.updated_at) + '.' : '')))
}

/* ------------------------------------------------------------------------ */
/* 2. what the agents did                                                    */
/* ------------------------------------------------------------------------ */
function AgentRow({ it }) {
  const [open, setOpen] = useState(false)
  const canOpen = Boolean(it.text)
  const bad = it.status === 'failed' || it.status === 'stopped'
  return h('div', {
    className: cls('tdy-row', canOpen && 'tdy-open', bad && 'tdy-bad'),
    onClick: canOpen ? () => setOpen(o => !o) : undefined,
    title: canOpen ? (open ? 'Hide the full text' : 'Show the full text') : undefined
  },
    h('span', { className: 'tdy-when' }, when(it.t)),
    h('span', { className: 'tdy-agent' }, it.agent || '—'),
    h('span', { className: 'tdy-job' },
      h('span', { className: 'tdy-jobname' }, it.job),
      it.kind ? h('span', { className: 'tdy-tag' }, it.kind) : null,
      it.summary || it.reason
        ? h('div', { className: 'tdy-sum' }, it.summary || it.reason, canOpen ? (open ? '  ▾' : '  ▸') : null)
        : null),
    h('span', null,
      h('span', { className: cls('tdy-pill', 'tdy-p-' + (it.status || 'unknown')) }, it.status || '?'),
      it.duration_s !== null && it.duration_s !== undefined
        ? h('span', { className: 'tdy-when', style: { marginLeft: 8 } }, it.duration_s + 's') : null),
    open ? h('div', { className: 'tdy-text' }, it.text) : null)
}

function Agents({ data: d }) {
  if (!d || d.error) return h(Err, { msg: (d && d.error) || 'no data' })
  const items = d.items || []
  return h('div', null,
    items.length
      ? h('div', { className: 'tdy-rows' }, items.map((it, i) => h(AgentRow, { key: (it.kind || '') + i, it })))
      : h('p', { className: 'tdy-empty' }, 'No agent output found on this box.'),
    d.not_here ? h('p', { className: 'tdy-note' }, d.not_here) : null)
}

/* ------------------------------------------------------------------------ */
/* 3. goals                                                                  */
/* ------------------------------------------------------------------------ */
function Objective({ o }) {
  const [open, setOpen] = useState(o.state !== 'met')
  const dueText = o.state === 'met'
    ? 'met' + (o.metOn ? ' ' + o.metOn : '')
    : o.state === 'overdue' ? Math.abs(o.days_left) + ' days overdue'
    : o.state === 'due-today' ? 'due today'
    : (o.days_left + ' days left · due ' + o.due)
  return h('div', { className: cls('tdy-obj', 'tdy-' + o.state) },
    h('div', { className: 'tdy-objhead', onClick: () => setOpen(v => !v) },
      h('span', { className: 'tdy-objid' }, o.id),
      h('span', { className: 'tdy-objtitle' }, o.title),
      h('span', { className: 'tdy-objmeta' }, pct(o.progress) + ' · ' + dueText + (open ? '  ▾' : '  ▸'))),
    h('div', { className: 'tdy-bar' }, h('div', { style: { width: pct(o.progress) } })),
    open ? h('div', { className: 'tdy-krs' }, (o.keyResults || []).map(k =>
      h('div', { key: k.id, className: 'tdy-kr' },
        h('span', { className: 'tdy-krpct' }, pct(k.progress)),
        h('span', null, k.title,
          h('span', { className: 'tdy-tag' }, k.derived ? 'derived' : 'declared'),
          k.live ? h('div', { className: 'tdy-krlive' }, k.live) : null,
          !k.derived && k.note ? h('div', { className: 'tdy-krlive' }, k.note) : null)))) : null)
}

function Goals({ data: d }) {
  if (!d || d.error) return h(Err, { msg: (d && d.error) || 'no data' })
  const lv = d.live || {}
  return h('div', null,
    (d.objectives || []).map(o => h(Objective, { key: o.id, o })),
    h('p', { className: 'tdy-note' },
      'Live from the loop host: ' + (lv.passes ?? '—') + ' passes · doc types ' +
      ((lv.doc_types || []).join(', ') || 'none') + ' · queue ' + (lv.queue_depth ?? '—') +
      ' · last pass ' + (lv.last_pass_at ? ago(lv.last_pass_at) : '—') +
      '. "declared" is the number in ' + (d.source || 'okrs.json') +
      (d.head ? ' @ ' + d.head : '') + '; "derived" is computed here from a file or the ledger.'))
}

/* ------------------------------------------------------------------------ */
/* 5. the board — queue/tasks.json: what the agents are on (Karl, 2026-09-15) */
/* ------------------------------------------------------------------------ */
const BOARD_DONE = ['verified', 'done', 'converged', 'dropped']
function BoardRow({ r }) {
  return h('div', { className: cls('tdy-row', r.status === 'blocked' && 'tdy-bad') },
    h('span', { className: 'tdy-lbl' }, r.status),
    h('span', { className: 'tdy-mono' }, 'P' + (r.priority ?? '?') + ' · ' + (r.host || '?')),
    h('span', null,
      h('span', { className: 'tdy-mono' }, r.id),
      h('div', { className: 'tdy-krlive' }, r.verdict || r.title)),
    h('span', { className: 'tdy-when' },
      r.owner ? r.owner + (r.claimed_at ? ' · ' + ago(r.claimed_at) : '') : (r.since ? 'since ' + r.since : '')))
}

function Board({ data: d }) {
  const [showDone, setShowDone] = useState(false)
  if (!d || d.error) return h(Err, { msg: (d && d.error) || 'no data' })
  const items = d.items || []
  const live = items.filter(r => !BOARD_DONE.includes(r.status))
  const done = items.filter(r => BOARD_DONE.includes(r.status))
  return h('div', null,
    !items.length ? h('p', { className: 'tdy-empty' }, 'The board is empty.') : null,
    live.length ? h('div', { className: 'tdy-rows' }, live.map(r => h(BoardRow, { key: r.id, r }))) : null,
    !live.length && items.length ? h('p', { className: 'tdy-empty' }, 'Nothing in flight; every task on the board is verified.') : null,
    done.length ? h('div', { style: { marginTop: 8 } },
      h('button', { className: 'tdy-btn tdy-small', onClick: () => setShowDone(v => !v) },
        (showDone ? 'Hide ' : 'Show ') + done.length + ' verified'),
      showDone ? h('div', { className: 'tdy-rows', style: { marginTop: 6 } }, done.map(r => h(BoardRow, { key: r.id, r }))) : null) : null,
    h('p', { className: 'tdy-note' }, d.note))
}

/* ------------------------------------------------------------------------ */
/* 6. agents now — one roster: Mac herdr panes + this box's units            */
/*    (Karl's plan 2026-09-16, L3). Mac rows come from a 60 s snapshot the   */
/*    Mac writes onto the box, shape only; stale past 3 min is said loudly.  */
/* ------------------------------------------------------------------------ */
const NOW_TONE = { working: 'ok', active: 'ok', blocked: 'blocked', failed: 'failed', masked: 'blocked',
  idle: 'idle', done: 'idle', inactive: 'idle', unknown: 'unknown' }
const NOW_BAD = ['blocked', 'failed', 'masked']
function NowRow({ r }) {
  const copyText = r.attach || r.status
  return h('div', { className: cls('tdy-row', NOW_BAD.includes(r.state) && 'tdy-bad') },
    h('span', { className: cls('tdy-pill', 'tdy-p-' + (NOW_TONE[r.state] || 'unknown')) }, r.state),
    h('span', { className: 'tdy-mono' }, r.host + (r.where ? ' · ' + r.where : '')),
    h('span', { className: 'tdy-job' },
      h('span', { className: 'tdy-jobname' }, r.name),
      r.detail ? h('div', { className: 'tdy-krlive' }, r.detail) : null,
      copyText ? h('div', { className: 'tdy-cmdrow' },
        h('code', { className: 'tdy-cmd' }, copyText),
        h('button', { className: 'tdy-btn tdy-small', onClick: () => copy(copyText) }, 'copy')) : null),
    h('span', { className: 'tdy-when' },
      r.last_output ? 'output ' + ago(r.last_output)
        : r.since ? 'since ' + ago(r.since)
          : r.next ? 'next ' + when(r.next) : '—'))
}

function AgentsNow({ data: d }) {
  if (!d || d.error) return h(Err, { msg: (d && d.error) || 'no data' })
  const mac = d.mac || {}
  const rows = d.rows || []
  return h('div', null,
    mac.stale ? h('div', { className: 'flt-warnbar' },
      mac.error ? mac.error
        : 'The Mac snapshot is ' + ago(mac.synced_at) + ' old — past ' + Math.round((mac.stale_after_s || 180) / 60) +
          ' min, so the Mac rows below are NOT current (the Mac may be asleep).') : null,
    mac.note ? h('p', { className: 'tdy-empty' }, 'Mac: ' + mac.note + (mac.synced_at ? ' (as of ' + ago(mac.synced_at) + ')' : '')) : null,
    d.box && d.box.error ? h(Err, { msg: d.box.error }) : null,
    d.box && d.box.other_note ? h('p', { className: 'tdy-empty' }, d.box.other_note) : null,
    !rows.length ? h('p', { className: 'tdy-empty' }, 'No agent is running anywhere this page can see.')
      : h('div', { className: 'tdy-rows' }, rows.map(r => h(NowRow, { key: r.host + ':' + r.name, r }))),
    h('p', { className: 'tdy-note' }, d.note))
}

/* ------------------------------------------------------------------------ */
/* 4. the box (+ the former Fleet sections as details)                       */
/* ------------------------------------------------------------------------ */
const Stat = p =>
  h('div', { className: cls('flt-stat', p.tone && 'flt-' + p.tone) },
    h('div', { className: 'flt-stat-l' }, p.label),
    h('div', { className: 'flt-stat-v' }, p.value,
      p.unit ? h('span', { className: 'flt-unit' }, p.unit) : null),
    p.sub ? h('div', { className: 'flt-stat-s' }, p.sub) : null)

const FSection = p =>
  h('section', { className: 'flt-section' },
    h('div', { className: 'flt-shead' },
      h('h2', null, p.title),
      p.meta ? h('span', { className: 'flt-meta' }, p.meta) : null),
    p.children)

const FErr = p => h('div', { className: 'flt-err' }, 'Could not sample: ' + p.msg)

function Health({ data: d }) {
  if (!d || d.error) return h(FErr, { msg: (d && d.error) || 'no data' })
  const all = (d.cpu && d.cpu.all) || {}
  const cores = (d.cpu && d.cpu.cores) || []
  const hottest = (d.thermal || []).reduce((a, z) => (!a || z.celsius > a.celsius ? z : a), null)
  const busiest = cores.reduce((a, c) => (!a || c.busy_pct > a.busy_pct ? c : a), null)
  const g = d.gpu || {}
  return h('div', null,
    h('div', { className: 'flt-stats' },
      h(Stat, { label: 'Load (1m)', value: d.load ? fmt(d.load[0], 2) : '—',
        sub: d.load ? fmt(d.load[1], 2) + ' / ' + fmt(d.load[2], 2) + ' (5m / 15m)' : null }),
      h(Stat, { label: 'CPU busy', value: fmt(all.busy_pct), unit: '%',
        sub: d.cores + ' cores · user ' + fmt(all.user_pct) + '%', tone: all.busy_pct > 60 ? 'warn' : null }),
      h(Stat, { label: 'Busiest core', value: busiest ? fmt(busiest.busy_pct) : '—', unit: '%',
        sub: busiest ? 'cpu' + busiest.core : null, tone: busiest && busiest.busy_pct > 85 ? 'crit' : null }),
      h(Stat, { label: 'GPU', value: fmt(g.util_pct, 0), unit: '%',
        sub: fmt(g.temp_c, 0) + ' °C · ' + fmt(g.power_w, 1) + ' W' }),
      h(Stat, { label: 'Hottest zone', value: hottest ? fmt(hottest.celsius) : '—', unit: '°C',
        sub: hottest ? hottest.zone : null, tone: hottest && hottest.celsius > 80 ? 'warn' : null }),
      h(Stat, { label: 'Memory used',
        value: d.memory && d.memory.total_mb ? fmt((d.memory.total_mb - d.memory.available_mb) / 1024, 1) : '—',
        unit: ' GiB', sub: d.memory ? fmt(d.memory.available_mb / 1024, 1) + ' GiB available' : null })),
    hottest && hottest.note ? h('p', { className: 'flt-caveat' }, hottest.zone + ': ' + hottest.note) : null,
    h('p', { className: 'flt-caveat' },
      'Not instrumented on this box: fan speed (firmware stub) and total system power (no BMC). ' +
      'Only the GPU power rail is a real measurement.'),
    (g.processes || []).length
      ? h('div', null, h('h3', null, 'GPU memory holders'),
          h('table', { className: 'flt-table' }, h('tbody', null, g.processes.map(a =>
            h('tr', { key: a.pid },
              h('td', { className: 'flt-mono' }, a.comm),
              h('td', { className: 'flt-mono flt-r' }, a.pid),
              h('td', { className: 'flt-mono flt-r' }, fmt(a.mib, 0) + ' MiB'))))))
      : null)
}

function Checks({ data: d }) {
  if (!d || d.error) return h(FErr, { msg: (d && d.error) || 'no data' })
  const stale = d.state === 'stale' || d.state === 'late'
  return h('div', null,
    stale ? h('div', { className: 'flt-warnbar' },
      'This snapshot is ' + d.state + ' — last written ' + ago(d.checked_at) +
      '. infra-watch writes every 15 minutes; treat these as historical.') : null,
    h('div', { className: 'flt-checks' }, (d.checks || []).map(c =>
      h('div', { key: c.key, className: cls('flt-check', c.ok ? null : 'flt-bad') },
        h('span', { className: 'flt-dot' }),
        h('span', { className: 'flt-ck flt-mono' }, c.key),
        h('span', { className: 'flt-cg flt-mono' }, String(c.got)),
        c.note ? h('span', { className: 'flt-cn' }, c.note) : null))))
}

function Units({ data: d }) {
  if (!d || d.error) return h(FErr, { msg: (d && d.error) || 'no data' })
  const rows = (d.units || []).filter(u => u.cpu_hours !== null || u.active === 'active' || u.file_state === 'masked')
  return h('div', null,
    !d.rate_available
      ? h('p', { className: 'flt-caveat' }, 'Live rate needs a second poll — it appears in about ' +
          Math.round(POLL_MS / 1000) + 's. Empty is not a failure.') : null,
    h('div', { className: 'flt-scroll' }, h('table', { className: 'flt-table' },
      h('thead', null, h('tr', null,
        h('th', null, 'Unit'), h('th', null, 'State'), h('th', { className: 'flt-r' }, 'Cores now'),
        h('th', { className: 'flt-r' }, 'CPU hours'), h('th', { className: 'flt-r' }, 'Memory'),
        h('th', { className: 'flt-r' }, 'Restarts'))),
      h('tbody', null, rows.map(u =>
        h('tr', { key: u.scope + u.unit, className: u.cores_now !== null && u.cores_now >= 0.5 ? 'flt-rowbad' : null },
          h('td', { className: 'flt-mono' }, u.unit.replace('.service', ''),
            u.scope === 'system' ? h('span', { className: 'flt-tag' }, 'system') : null),
          h('td', null, h('span', { className: cls('flt-pill',
            u.file_state === 'masked' ? 'flt-p-masked' : u.active === 'active' ? 'flt-p-ok' : 'flt-p-idle') },
            u.file_state === 'masked' ? 'masked' : u.active)),
          h('td', { className: 'flt-mono flt-r' }, u.cores_now === null ? '—' : fmt(u.cores_now, 2)),
          h('td', { className: 'flt-mono flt-r' }, fmt(u.cpu_hours, 2)),
          h('td', { className: 'flt-mono flt-r' }, u.mem_mb ? u.mem_mb + ' MB' : '—'),
          h('td', { className: 'flt-mono flt-r' }, u.restarts)))))),
    h('p', { className: 'flt-caveat' },
      'Cores now is a rate between polls, not a lifetime average. Rows at or above 0.50 cores are marked.'))
}

function Roster({ data: d }) {
  if (!d || d.error) return h(FErr, { msg: (d && d.error) || 'no data' })
  const shown = (d.agents || []).filter(a => a.state !== 'inactive' || a.cpu_hours)
  return h('div', null,
    h('div', { className: 'flt-scroll' }, h('table', { className: 'flt-table' },
      h('thead', null, h('tr', null,
        h('th', null, 'Agent / unit'), h('th', null, 'State'), h('th', null, 'What it is'), h('th', null, 'To change it'))),
      h('tbody', null, shown.map(a =>
        h('tr', { key: a.scope + a.name },
          h('td', { className: 'flt-mono' }, a.name),
          h('td', null, h('span', { className: cls('flt-pill',
            a.state === 'masked' ? 'flt-p-masked' : a.state === 'active' ? 'flt-p-ok' : 'flt-p-idle') }, a.state),
            a.detail ? h('div', { className: 'flt-detail' }, a.detail) : null),
          h('td', { className: 'flt-desc' }, a.description || '—'),
          h('td', { className: 'flt-mono flt-raw' }, a.control,
            a.control_needs_root ? h('span', { className: 'flt-tag' }, 'needs root') : null)))))),
    h('p', { className: 'flt-caveat' }, 'This view does not stop or start anything. Commands are shown so you run them and can see what you ran.'))
}

function Jobs({ data: d }) {
  if (!d || d.error) return h(FErr, { msg: (d && d.error) || 'no data' })
  return h('div', null,
    h('h3', null, 'Timers'),
    h('div', { className: 'flt-scroll' }, h('table', { className: 'flt-table' }, h('tbody', null, (d.timers || []).map((t, i) =>
      h('tr', { key: i },
        h('td', { className: 'flt-mono' }, t.name),
        h('td', { className: 'flt-mono flt-dim' }, t.scope),
        h('td', { className: 'flt-mono flt-dim flt-raw' }, t.raw)))))),
    h('h3', null, 'Cron'),
    h('div', { className: 'flt-scroll' }, h('table', { className: 'flt-table' }, h('tbody', null, (d.cron || []).map((c, i) =>
      h('tr', { key: i, className: c.flag ? 'flt-rowbad' : null },
        h('td', { className: 'flt-mono' }, c.schedule || c.name),
        h('td', { className: 'flt-mono flt-raw' }, c.command || ''),
        h('td', null, c.flag ? h('span', { className: 'flt-pill flt-p-bad' }, c.flag)
          : c.state === 'disabled' ? h('span', { className: 'flt-pill flt-p-idle' }, 'disabled') : null)))))))
}

function BoxDetails({ rest, tickKey }) {
  const [ov, setOv] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let dead = false
    rest('/overview')
      .then(d => { if (!dead) { setOv(d); setErr(null) } })
      .catch(e => { if (!dead) setErr(String(e)) })
    return () => { dead = true }
  }, [tickKey])
  if (err && !ov) return h(FErr, { msg: err })
  if (!ov) return h('p', { className: 'flt-caveat' }, 'Sampling the box…')
  return h('div', { className: 'tdy-details' },
    h(FSection, { title: 'Health', meta: ov.health ? 'sampled ' + clock(ov.health.sampled_at) : null,
      children: h(Health, { data: ov.health }) }),
    h(FSection, { title: 'Checks',
      meta: ov.checks ? (ov.checks.status || '?') + ' · ' +
        ((ov.checks.total || 0) - (ov.checks.failing || []).length) + '/' + (ov.checks.total || 0) +
        ' passing · written ' + ago(ov.checks.checked_at) : null,
      children: h(Checks, { data: ov.checks }) }),
    h(FSection, { title: 'Unit CPU budgets',
      meta: ov.units && ov.units.interval_s ? 'rate over ' + ov.units.interval_s + 's' : 'first poll',
      children: h(Units, { data: ov.units }) }),
    h(FSection, { title: 'Agent roster', meta: ov.roster ? (ov.roster.agents || []).length + ' units' : null,
      children: h(Roster, { data: ov.roster }) }),
    h(FSection, { title: 'Scheduled jobs',
      meta: ov.jobs ? (ov.jobs.timers || []).length + ' timers · ' + (ov.jobs.cron || []).length + ' cron' : null,
      children: h(Jobs, { data: ov.jobs }) }))
}

function Box({ data: d, rest, tickKey }) {
  const [open, setOpen] = useState(false)
  if (!d || d.error) return h(Err, { msg: (d && d.error) || 'no data' })
  const ck = d.checks || {}
  const passing = (ck.total || 0) - ((ck.failing || []).length)
  return h('div', null,
    h('div', { className: 'tdy-boxline' },
      h('span', null, h('span', { className: cls('tdy-dot', !d.ok && 'tdy-bad') }),
        h('b', null, d.ok ? 'OK' : 'Look'), ' · ', d.host || 'the box'),
      h('span', null, passing + '/' + (ck.total || 0) + ' checks',
        ck.state && ck.state !== 'fresh' ? h('span', { className: 'tdy-tag' }, ck.state) : null,
        h('span', { className: 'tdy-when' }, ' written ' + ago(ck.checked_at))),
      h('span', null, 'load ' + fmt(d.load1, 2)),
      h('span', null, 'hottest ' + fmt(d.hottest_c, 1) + ' °C'),
      h('span', null, 'GPU ' + fmt(d.gpu_util_pct, 0) + ' %'),
      h('span', null, (d.failed_units || []).length + ' failed unit' + ((d.failed_units || []).length === 1 ? '' : 's'),
        (d.failed_units || []).length ? h('span', { className: 'tdy-mono', style: { opacity: .6 } },
          ' (' + d.failed_units.map(u => u.replace('.service', '')).join(', ') + ')') : null),
      h('span', null, (d.timers ?? '—') + ' timers'),
      h('button', { className: 'tdy-btn tdy-small', onClick: () => setOpen(o => !o) },
        open ? 'Hide details' : 'Details')),
    (ck.failing || []).length
      ? h('p', { className: 'tdy-note', style: { color: '#e26d5c', opacity: 1 } }, 'Failing: ' + ck.failing.join(', '))
      : null,
    h('p', { className: 'tdy-note' }, d.hottest_note),
    open ? h(BoxDetails, { rest, tickKey }) : null)
}

/* ------------------------------------------------------------------------ */
/* the page                                                                  */
/* ------------------------------------------------------------------------ */
function oneLine(d) {
  const ag = d.agents || {}
  const items = ag.items || []
  const ran = items.filter(i => i.status === 'ok').length
  const blocked = items.filter(i => i.status === 'blocked').length
  const failed = items.filter(i => i.status === 'failed' || i.status === 'stopped').length
  const lp = d.loop || {}
  const bx = d.box || {}
  const parts = []
  parts.push('Agents: ' + ran + ' ran' + (blocked ? ', ' + blocked + ' blocked' : '') + (failed ? ', ' + failed + ' FAILED' : ''))
  parts.push('Loop: ' + (lp.state || '?') + (lp.queue_depth !== undefined && lp.queue_depth !== null ? ', queue ' + lp.queue_depth : '') +
    (lp.last_pass_age_days !== undefined && lp.last_pass_age_days !== null ? ', last pass ' + lp.last_pass_age_days + ' d ago' : ''))
  parts.push('Box: ' + (bx.ok ? 'OK' : 'look'))
  return parts.join(' · ')
}

function makeTodayPage(rest) {
  return function TodayPage() {
    const { data, err, loading, lastOkAt, errAt, tickKey } = useToday(true)
    useEffect(() => { injectStyle() }, [])

    if (loading && !data) return h('div', { className: 'tdy-root' }, h('p', null, 'Sampling the box…'))
    if (err && !data) return h('div', { className: 'tdy-root' }, h(Err, { msg: err }))

    const stale = Boolean(err && data)
    const iso = t => (t ? new Date(t).toISOString() : null)
    const ny = data.needs_you || {}
    const needs = needCount(data) || 0
    const parkedN = splitNeeds(ny).parked.length
    const ag = data.agents || {}
    const an = data.agents_now || {}
    return h('div', { className: stale ? 'tdy-root tdy-stale' : 'tdy-root' },
      stale ? h('div', { className: 'tdy-stalebar', role: 'alert' },
        'STALE — the last refresh failed ' + ago(iso(errAt)) +
        '. Everything below was sampled ' + ago(iso(lastOkAt)) + ' and is NOT current.',
        h('small', null, 'Error: ' + err)) : null,
      h('div', { className: 'tdy-body' },
        h('header', null,
          h('h1', null, 'Today'),
          h('div', { className: 'tdy-stamp' },
            h('span', null, 'sampled ' + clock(data.sampled_at)),
            h('span', null, 'refreshes every ' + Math.round(POLL_MS / 1000) + 's'),
            h('span', null, data.box && data.box.host ? data.box.host : ''),
            err ? h('span', { style: { color: '#e26d5c' } }, 'last refresh failed') : null),
          h('div', { className: cls('tdy-verdict', needs ? 'tdy-hot' : 'tdy-calm') }, needLine(needCount(data), parkedN)),
          h('p', { className: 'tdy-oneline' }, oneLine(data)),
          h('div', { className: 'tdy-actions' },
            h(CopyBtn, { text: data.text || '' }),
            h('span', { className: 'tdy-when', style: { alignSelf: 'center' } },
              '← the whole page as text, for an agent (also served at /today.txt)'))),
        h(Section, { title: 'Needs you', count: needs, hot: needs > 0,
          meta: (ny.sampled_at ? 'sampled ' + clock(ny.sampled_at) : '') +
            (ny.updated_at ? (ny.sampled_at ? ' · ' : '') + 'queue updated ' + ago(ny.updated_at) : '') || null,
          children: h(NeedsYou, { data: ny }) }),
        h(Section, { title: 'What the agents did', count: (ag.items || []).length,
          hot: (ag.failed_count || 0) > 0,
          meta: ag.sampled_at ? 'sampled ' + clock(ag.sampled_at) : null,
          children: h(Agents, { data: ag }) }),
        h(Section, { title: 'Goals',
          meta: data.goals
            ? (data.goals.sampled_at ? 'sampled ' + clock(data.goals.sampled_at) + ' · ' : '') +
              (data.goals.head ? 'okrs.json @ ' + data.goals.head : 'okrs.json')
            : null,
          children: h(Goals, { data: data.goals }) }),
        h(Section, { title: 'The box',
          meta: data.box ? 'sampled ' + clock(data.box.sampled_at) : null,
          children: h(Box, { data: data.box, rest, tickKey }) }),
        h(Section, { title: 'The board', count: data.board ? (data.board.in_flight ?? 0) : undefined,
          hot: Boolean(data.board && (data.board.counts || {}).blocked),
          meta: data.board
            ? (data.board.sampled_at ? 'sampled ' + clock(data.board.sampled_at) + ' · ' : '') +
              (data.board.source ? data.board.source + (data.board.vault_branch ? ' @ ' + data.board.vault_branch : '') : '')
            : null,
          children: h(Board, { data: data.board }) }),
        h(Section, { title: 'Agents now', count: an.rows ? an.rows.length : undefined,
          hot: Boolean((an.mac || {}).stale) || (an.rows || []).some(r => NOW_BAD.includes(r.state)),
          meta: an.sampled_at
            ? ((an.mac || {}).synced_at ? 'mac synced ' + ago(an.mac.synced_at) + ' · ' : 'no mac snapshot · ') +
              'box sampled ' + clock(an.sampled_at)
            : null,
          children: h(AgentsNow, { data: an }) })))
  }
}

/* ------------------------------------------------------------------------ */
/* Live — the call, as plan C draws it (docs/design/2026-09-22-command-center/ */
/* c-stage.html). The owners' tiles fill the stage; the tray on the floor asks */
/* ONE question, five to a batch, in the queue's own order (byQueue). Every    */
/* control here changes the VIEW only; the answer is a `decide` line Karl      */
/* copies into a terminal (one answer place).                                  */
/* ------------------------------------------------------------------------ */
const who = i => i.agent || 'no agent yet'
const md = iso => String(iso || '').slice(5, 10) // 2026-09-29 -> 09-29
const pad2 = n => String(n).padStart(2, '0')
function stamp(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso || '—')
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}
function hhmm(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}
const lastNight = iso => Date.now() - Date.parse(iso) < 864e5 // "last night" = the last 24 hours
/* A card's topic: its title up to the first dash, bracket or semicolon. */
const topic = i => String(i.title || i.ask || i.id || '').split(/ [—–] | \(|; /)[0]
/* A tile's short lead: the topic up to its colon, cut at a word near 36 characters. */
function lead(i) {
  const t = topic(i)
  const c = t.indexOf(': ')
  const head = c > 0 && c <= 36 ? t.slice(0, c) : t
  if (head.length <= 36) return head
  const cut = head.lastIndexOf(' ', 34)
  return head.slice(0, cut > 12 ? cut : 34) + '…'
}
/* Display only: a hyphen between digits (09-27) becomes a non-breaking one. */
const keep = t => String(t || '').replace(/(\d)-(?=\d)/g, '$1\u2011')

/* Faces, ported from the mockup's generator: one deterministic blob per seat.   */
/* The shape comes from the seat's name; the hue is handed in, spread over the   */
/* mockup's cool range (176–268) by the seats' alphabetical order, so no two     */
/* owners on stage share a colour. A tile's tint and its face use the same hue.  */
const hsh = s => { let x = 2166136261; for (let k = 0; k < s.length; k++) { x ^= s.charCodeAt(k); x = Math.imul(x, 16777619) >>> 0 } return x }
const rnd = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0
  let q = Math.imul(a ^ a >>> 15, 1 | a)
  q = q + Math.imul(q ^ q >>> 7, 61 | q) ^ q
  return ((q ^ q >>> 14) >>> 0) / 4294967296
}
function hueFor(seat, seats) {
  const names = seats.slice().sort()
  const k = names.indexOf(seat)
  return names.length < 2 || k < 0 ? 222 : Math.round(176 + (92 * k) / (names.length - 1))
}
const f1 = n => n.toFixed(1)
const faces = new Map()
function faceOf(id, hue) {
  const key = id + '|' + hue
  if (faces.has(key)) return faces.get(key)
  const r = rnd(hsh(id))
  r() // the mockup draws its hue here; the stage hands one in instead
  const sat = Math.round(34 + r() * 16), lit = Math.round(58 + r() * 8)
  const p = []
  for (let k = 0; k < 7; k++) {
    const q = (k / 7) * Math.PI * 2 + (r() - 0.5) * 0.35 - Math.PI / 2, rr = 34 + r() * 8
    p.push([50 + rr * Math.cos(q), 52 + rr * Math.sin(q)])
  }
  let body = 'M' + f1(p[0][0]) + ' ' + f1(p[0][1])
  for (let k = 0; k < 7; k++) {
    const p0 = p[(k + 6) % 7], p1 = p[k], p2 = p[(k + 1) % 7], p3 = p[(k + 2) % 7]
    body += 'C' + [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]].map(f1).join(' ')
  }
  const ey = 49, sp = 9 + r() * 4, ox = (r() - 0.5) * 6, hx = (r() - 0.5) * 1.6, mw = 5 + r() * 4, my = ey + 12
  const f = {
    fill: 'hsl(' + hue + ' ' + sat + '% ' + lit + '%)', body: body + 'Z', ey, hx,
    eyes: [-1, 1].map(k => 50 + ox + k * sp),
    mouth: 'M' + f1(50 + ox - mw) + ' ' + my + ' Q' + f1(50 + ox) + ' ' + f1(my + 3 + r() * 3) + ' ' + f1(50 + ox + mw) + ' ' + my
  }
  faces.set(key, f)
  return f
}
function Face({ id, hue }) {
  const f = faceOf(id, hue)
  return h('svg', { viewBox: '0 0 100 100', 'aria-hidden': true },
    h('path', { d: f.body, fill: f.fill }),
    h('ellipse', { cx: 36, cy: f.ey - 17, rx: 9, ry: 5, fill: '#fff', fillOpacity: 0.16, transform: 'rotate(-22 36 ' + (f.ey - 17) + ')' }),
    f.eyes.map(x => [
      h('ellipse', { key: 'e' + x, cx: f1(x), cy: f.ey, rx: 4.3, ry: 5.4, fill: '#131315' }),
      h('circle', { key: 'g' + x, cx: f1(x + 1.3 + f.hx), cy: f.ey - 2, r: 1.5, fill: '#fff' })]),
    h('path', { d: f.mouth, fill: 'none', stroke: '#131315', strokeWidth: 2.3, strokeLinecap: 'round' }))
}

const svgIcon = (sw, kids, className) => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: sw,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className }, kids)
const HAND_PATHS = ['M18 11V6a2 2 0 0 0-4 0', 'M14 10V4a2 2 0 0 0-4 0v2', 'M10 10.5V6a2 2 0 0 0-4 0v8',
  'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15']
const HandIcon = () => svgIcon(2.2, HAND_PATHS.map(d => h('path', { key: d, d })))
const LockIcon = () => svgIcon(1.8, [h('rect', { key: 'r', x: 5, y: 11, width: 14, height: 10, rx: 2 }),
  h('path', { key: 'p', d: 'M8 11V8a4 4 0 0 1 8 0v3' })])
const LeaveIcon = () => svgIcon(1.8, h('path', { d: 'M2.5 14.2c5.3-5 13.7-5 19 0l-2.1 2.8-4-1.5v-2.6a12 12 0 0 0-6.8 0v2.6l-4 1.5z' }))
const PromptGlyph = () => svgIcon(1.8, h('path', { d: 'M4 17l6-5-6-5M12 19h8' }), 'lv-kg')

/* A seat is on stage when a herdr pane carries its name (herdr agent rename). */
const paneOf = (rows, seat) => rows.find(r => r.name === seat) || null
const placeOf = r => (r.host === 'box' ? 'the box' : 'the Mac') + (r.detail ? ' · ' + r.detail : '') + (r.where ? ' · ' + r.where : '')
const PANE_TONE = { working: 'lv-c-working', active: 'lv-c-working', done: 'lv-c-done', blocked: 'lv-c-failed', failed: 'lv-c-failed' }

/* What silence does. A tier-3 card closes only by Karl's word, so its date is  */
/* when he wanted it by; a tier-1 card has a default, but nothing applies        */
/* defaults today (the applier is off), so it waits as well.                     */
function Silence({ i, today }) {
  const [word, ...rest] = String(i.default || '').split(/\s+[—–-]\s+/)
  const late = Boolean(i.expiry) && i.expiry < today
  const t3 = i.tier === 3 || !word
  const due = t3 ? 'wanted by ' : 'default due '
  return h('div', { className: 'lv-trdef' }, 'If you don’t answer: ',
    t3 ? h('b', null, 'it waits for your word')
      : [h('b', { key: 'w' }, 'it waits'), ' — its default “' + word + '” is not applied today'],
    i.expiry
      ? [' · ', late ? h('b', { key: 'x' }, due + md(i.expiry) + ' — still open')
        : [due, h('span', { key: 'x', className: 'lv-mono' }, md(i.expiry))]]
      : null,
    // the card's own words, as filed: they can lag behind its ask, so they are marked as such
    t3 && rest.length ? ' — as filed: ' + rest.join(' — ') : null)
}

/* "Sun 2026-09-27 16:45:00 CEST 9min 12s Sun …" -> "9min 12s", systemd's LEFT. */
const WEEKDAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/
function timerLeft(raw) {
  const t = String(raw || '').split(/\s+/)
  if (!WEEKDAY.test(t[0] || '')) return ''
  const out = []
  for (let k = 4; k < t.length && !WEEKDAY.test(t[k]) && t[k] !== 'n/a' && t[k] !== '-'; k++) out.push(t[k])
  return out.join(' ')
}

/* The box, as its own tile. Last night's failed and blocked runs never fold:   */
/* they stay until a run replaces them, and a job that broke twice shows once, */
/* ×2. Older ones are counted here and listed on Today. /overview adds what     */
/* /today leaves out (GPU name, cores, memory, uptime, the timers by name).     */
function HostTile({ box, ov, rows, wide, alone }) {
  const b = box && !box.error ? box : {}
  const hl = ov && ov.health && !ov.health.error ? ov.health : {}
  const g = hl.gpu && !hl.gpu.error ? hl.gpu : {}
  const mem = hl.memory && !hl.memory.error && hl.memory.total_mb ? hl.memory : null
  const ck = b.checks || {}
  const failing = (ck.failing || []).length
  const broke = rows.filter(r => r.status === 'failed' || r.status === 'stopped' || r.status === 'blocked')
  const night = []
  broke.filter(r => lastNight(r.t)).forEach(r => {
    const same = night.find(x => x.agent === r.agent && x.job === r.job && x.status === r.status)
    if (same) same.n += 1
    else night.push({ ...r, n: 1 })
  })
  const older = broke.length - night.reduce((a, r) => a + r.n, 0)
  const timers = ((ov && ov.jobs && !ov.jobs.error && ov.jobs.timers) || []).filter(t => t.scope === 'user')
  const load = Array.isArray(hl.load) ? hl.load : b.load1 !== undefined ? [b.load1] : null
  const used = mem ? mem.total_mb - mem.available_mb : 0
  const gb = mb => String(Math.round((mb || 0) / 1024))
  // alone in its row, the tile hugs its content instead of stretching to the seats' height
  return h('div', { className: cls('lv-tile lv-host', wide && 'lv-wide', alone && 'lv-alone') },
    h('div', { className: 'lv-hhd' },
      h('span', { className: 'lv-hname' }, 'the box'),
      h('span', { className: 'lv-tag' }, 'host'),
      h('span', { className: cls('lv-ok', ((box && box.error) || b.ok === false) && 'lv-c-failed') },
        box && box.error ? 'could not sample: ' + box.error
          : (ck.total ? (ck.total - failing) + '/' + ck.total + ' ' + String(ck.status || 'checks').toLowerCase() : 'checks —') +
            (hl.uptime_s ? ' · up ' + Math.floor(hl.uptime_s / 86400) + ' d' : ''))),
    h('div', { className: 'lv-hgrid' },
      h('div', { style: { minWidth: 0 } },
        h('div', { className: 'lv-hsub' }, 'GPU' + (g.name ? ' · ' + g.name : '')),
        h('div', { className: 'lv-gpu' },
          h('span', { className: 'lv-big' }, fmt(g.util_pct ?? b.gpu_util_pct, 0), h('small', null, '%')),
          h('div', { className: 'lv-hl' },
            fmt(g.temp_c ?? b.gpu_temp_c, 0) + ' °C' + (hl.cores ? ' · ' + hl.cores + ' cores' : ''), h('br'),
            'load ', h('span', { className: 'lv-mono' }, load ? load.map(x => fmt(x, 2)).join(' ') : '—'))),
        h('div', { className: 'lv-bar' }, h('i', { style: { width: mem ? Math.round((100 * used) / mem.total_mb) + '%' : 0 } })),
        h('div', { className: 'lv-hl' }, mem
          ? [h('span', { key: 'u', className: 'lv-mono' }, gb(used)), ' of ', h('span', { key: 't', className: 'lv-mono' }, gb(mem.total_mb)),
              ' GB used · ', h('span', { key: 'f', className: 'lv-mono' }, gb(mem.available_mb)), ' free']
          : 'memory: ' + (ov && ov.error ? 'could not sample' : 'sampling…'))),
      h('div', { style: { minWidth: 0 } },
        h('div', { className: 'lv-hsub' }, 'last night · never folds'),
        night.length
          ? night.slice(0, 5).map((r, k) => h('div', {
              key: k, className: 'lv-fl', title: stamp(r.t) + ' ' + r.status + ' · ' + (r.job || '?') + (r.reason ? ' — ' + r.reason : '')
            },
              h('span', { className: 'lv-mono' }, hhmm(r.t)),
              h('span', { className: r.status === 'blocked' ? null : 'lv-c-failed' }, r.status),
              ' · ' + (r.job || '?') + (r.n > 1 ? ' ×' + r.n : ''),
              r.reason ? h('span', { className: 'lv-dim' }, ' — ' + r.reason) : null))
          : h('div', { className: 'lv-fl lv-dim' }, 'nothing failed or blocked last night'),
        night.length > 5 ? h('div', { className: 'lv-fl lv-dim' }, '+ ' + (night.length - 5) + ' more on Today') : null,
        older ? h('div', { className: 'lv-fl lv-dim' }, 'earlier: ' + older + ' more failed or blocked — on Today') : null)),
    h('div', { className: 'lv-tmr' },
      h('span', { className: 'lv-hsub' }, 'timers · ' + (timers.length || b.timers || '—')),
      timers.map((t, k) => h('span', { key: t.name }, k ? h('i', null, '·') : null, t.name.replace(/\.timer$/, ''),
        timerLeft(t.raw) ? h('span', { className: 'lv-dim' }, ' in ' + timerLeft(t.raw)) : null))))
}

/* The newest receipt: by the day it closed, then the time it was answered or seen to leave;
 * a tie keeps the later one in the list. Never file order alone (the queue is not chronological). */
const receiptKey = r => String(r.doneOn || '') + '|' + String(r.answeredAt || r.seenGoneAt || '')
const newest = list => list.reduce((best, r) => (!best || receiptKey(r) >= receiptKey(best) ? r : best), null)

/* One owner's tile: its face, its raised hands, the first question it holds,   */
/* and one folded line — the fact that matters most about it right now. An      */
/* owner that no pane carries is drawn away from the call: its face is dimmed.  */
function SeatTile({ seat, hue, mine, parked, pane, gone, failedRow, today, speaking, onFocus }) {
  const top = mine[0]
  const noAgent = mine.concat(parked).some(i => i.agent_shipped === false)
  const late = mine.filter(i => i.expiry && i.expiry < today).length
  const left = newest(gone)
  const parkFold = !failedRow && !noAgent && parked.length > 0 // the fold says it; the status line need not
  const fold = failedRow ? [h('span', { key: 'f', className: 'lv-c-failed' }, 'failed ' + stamp(failedRow.t)), ' — ' + (failedRow.job || '?')]
    : noAgent ? 'no agent for this seat yet'
      : parked.length ? 'parked · until ' + md(parked[0].parked.until) + ' — ' + lead(parked[0])
        : left ? (left.answer ? 'answered “' + left.answer + '” today' + (left.by ? ' · ' + left.by : '')
          : 'left the queue ' + ago(left.seenGoneAt)) + ' — ' + lead(left)
          : top && top.expiry ? 'wanted by ' + md(top.expiry) : null
  return h('div', {
    className: cls('lv-tile', speaking && 'lv-speaking', !pane && 'lv-away'), 'data-s': mine.length ? 'needs' : 'parked',
    style: { '--h': String(hue) }, onClick: top ? onFocus : undefined,
    title: top ? 'Put ' + seat + '’s first question in the tray' : undefined
  },
    h('div', { className: 'lv-where' }, pane ? placeOf(pane) : 'not in a pane yet'),
    mine.length ? h('button', {
      type: 'button', className: 'lv-hand', title: mine.length + ' raised hand' + (mine.length === 1 ? '' : 's') + ' — ask the first',
      onClick: e => { e.stopPropagation(); onFocus() }
    }, h(HandIcon), String(mine.length)) : null,
    h('div', { className: 'lv-face' }, h(Face, { id: seat, hue })),
    h('div', { className: 'lv-name' }, h('span', null, seat), pane ? h(PromptGlyph) : null),
    h('div', { className: 'lv-cap' }, top
      ? [h('b', { key: 'b' }, lead(top)), ' — “' + (top.ask || top.title) + '”']
      : 'Nothing needs you; ' + parked.length + ' parked.'),
    h('div', { className: 'lv-tst' },
      failedRow ? h('span', { className: 'lv-sl lv-c-failed' }, h('i', { className: 'lv-dot' }), 'failed') : null,
      mine.length ? h('span', { className: 'lv-sl lv-nd' }, 'needs you ' + mine.length) : null,
      late ? h('span', { className: 'lv-sl lv-nd' }, late + ' expired') : null,
      pane ? h('span', { className: cls('lv-sl', PANE_TONE[pane.state]) }, h('i', { className: 'lv-dot' }), pane.state) : null,
      parked.length && !parkFold ? h('span', { className: 'lv-sl' }, h('i', { className: 'lv-dot lv-parkdot' }),
        'parked' + (parked.length > 1 ? ' ' + parked.length : '')) : null),
    fold ? h('div', { className: 'lv-fold' }, fold) : null)
}

const NEVER = 'You type the value in the pane that needs it — it never shows on this page.'
/* Only a plain id and plain words go into a line Karl pastes into a shell: the */
/* writer's own WORD shape. Anything else is left out, and the tray says so.    */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/
const SAFE_WORD = /^[a-z0-9][a-z0-9-]{0,39}$/
const wordsOf = q => (SAFE_ID.test(String(q.id)) ? (q.options || []).filter(o => SAFE_WORD.test(String(o))) : [])

/* The tray: ONE question. 1–9 pick a word, L later; the same key again or ↵    */
/* copies the decide line; Esc un-picks; ← → step. Copying is the only thing a */
/* key does outside this view, and the answer is still typed by Karl. Every     */
/* word answers and closes the card (decide v2); only later keeps it open.      */
function Tray({ q, hue, pos, batch, bi, nb, qLen, pane, pick, copied, derivedN, today, onPick, onCopy, onJump, send, onSend }) {
  if (!q) {
    return h('div', { className: 'lv-tray' },
      h('div', { className: 'lv-zero' },
        h('span', { className: 'lv-handoff' }, h(HandIcon)),
        h('div', null,
          h('div', { className: 'lv-tzt' }, 'no hands up'),
          h('div', { className: 'lv-tzs' }, derivedN
            ? derivedN + ' derived item(s) still wait — nobody typed them; see Today.'
            : 'Nothing waits on your word. A question lands here when an owner raises it.'))))
  }
  const opts = wordsOf(q)
  const plain = SAFE_ID.test(String(q.id))
  const dropped = (q.options || []).length - opts.length
  const word = pick !== null ? opts.concat('later')[pick] : null
  const line = word ? 'decide ' + q.id + ' ' + word : null
  const done = Boolean(word) && copied[q.id] === word
  // verb (a): drawn only when both flags are on and the server signed this card's word
  const canSend = Boolean(send && word && send.offer && send.offer.tokens && send.offer.tokens[word])
  const st = send && send.st && send.st.word === word ? send.st : null
  const armed = Boolean(st && st.state === 'confirm')
  const behind = []
  for (let b = bi + 1; b < nb; b++) behind.push(Math.min(BATCH, qLen - b * BATCH) + ' in batch ' + (b + 1))
  return h('div', { className: 'lv-tray' },
    h('div', { className: 'lv-trq' },
      h('div', { className: 'lv-tface' }, h(Face, { id: who(q), hue })),
      h('div', { style: { minWidth: 0 } },
        h('div', { className: 'lv-trmeta' }, h('b', null, who(q)),
          (pane ? ' · ' + placeOf(pane) : '') + ' · p' + (q.priority ?? '?') + ' · ' + (q.ask_kind || '?') +
          (q.tier === 3 ? ' · tier 3' : '') + (q.since ? ' · filed ' + md(q.since) : '') +
          (q.agent_shipped === false ? ' · no agent for this seat yet' : '')),
        h('div', { className: 'lv-trtitle', title: q.title || '' }, keep(topic(q))),
        q.ask && q.ask !== topic(q) ? h('div', { className: 'lv-trask' }, keep(q.ask)) : null,
        h(Silence, { i: q, today }))),
    h('div', { style: { minWidth: 0 } },
      opts.length
        ? h('div', { className: 'lv-picks' }, opts.map((o, n) => h('button', {
            key: o, type: 'button', className: cls('lv-pk', pick === n && 'lv-on'), onClick: e => onPick(n, e.timeStamp)
          }, h('kbd', null, String(n + 1)), o)))
        : h('div', { className: 'lv-echo lv-warn' }, !plain ? 'This card’s id is not a plain id — answer it with decide in a terminal.'
          : dropped ? 'Its words are not plain words — answer it with decide in a terminal.'
            : 'No options yet — nothing can answer this card; the chair adds them.'),
      h('div', { className: 'lv-echo' }, word
        ? ['→ ', h('b', { key: 'w' }, word), word === 'later' ? ' parks it until tomorrow; it stays open' : ' answers it and closes the card',
            ' — press ', h('kbd', { key: 'k' }, pick === opts.length ? 'L' : String(pick + 1)), ' again or ', h('kbd', { key: 'e' }, '↵'),
            ' to copy its decide line']
        : 'Any word answers the card and closes it.' + (dropped && opts.length ? ' ' + dropped + ' of its words is not plain — use decide in a terminal for it.' : '')),
      q.ask_kind === 'PASTE' ? h('div', { className: 'lv-never' }, h(LockIcon), NEVER) : null,
      plain ? h('div', { className: 'lv-latr' },
        h('button', { type: 'button', className: cls('lv-lat', pick === opts.length && 'lv-on'), onClick: e => onPick(opts.length, e.timeStamp) }, 'later'),
        'its line parks the card until tomorrow; the card stays open') : null,
      h('div', { className: 'lv-conf' },
        h('button', { type: 'button', className: 'lv-confirm', disabled: !line, onClick: onCopy }, done ? 'Copied' : 'Copy', h('kbd', null, '↵')),
        canSend ? h('button', {
          type: 'button', className: cls('lv-send', armed && 'lv-arm'), disabled: Boolean(send.busy), onClick: onSend,
          title: armed ? 'Tier 3: this second click sends the word' : 'Sends this one word for this one card'
        }, send.busy ? 'Sending…' : armed ? 'Confirm “' + word + '”' : 'Send “' + word + '”') : null,
        h('div', { className: 'lv-ow' }, line
          ? [h('span', { key: 'l', className: 'lv-dl' }, line),
              done ? ' — copied; paste it now' : ' — paste it in a terminal']
          : 'pick a word — ↵ copies its decide line' + (send ? '; Send records it from here' : pageKeyNote())),
        st && st.state !== 'sending' ? h('div', { className: cls('lv-sent', st.state === 'bad' && 'lv-bad') },
          armed ? ['Tier 3 — “', h('b', { key: 't' }, keep(st.title || topic(q))), '” → ', h('b', { key: 'w' }, word),
            '. Click Confirm to send it; nothing is written until you do.']
            : st.msg) : null)),
    h('div', { className: 'lv-tb' },
      h('div', { className: 'lv-tbh' }, 'question ' + (pos + 1) + ' of ' + batch.length + ' · batch ' + (bi + 1) + ' of ' + nb),
      h('div', { className: 'lv-pips' }, batch.map((c, n) => h('button', {
        key: c.id, type: 'button', title: topic(c), onClick: () => onJump(c.id), className: cls('lv-pip', n === pos && 'lv-cur')
      }))),
      h('div', null, behind.length ? 'queued behind it: ' + behind.join(' · ') : 'the last batch — nothing queued behind it'),
      h('div', { className: 'lv-dim2' }, 'nothing opens on its own: the next batch waits for your click' +
        (derivedN ? ' · ' + derivedN + ' derived item(s) wait on Today' : '')),
      h('div', { className: 'lv-navs' },
        bi > 0 ? h('button', { type: 'button', className: 'lv-nav', onClick: () => onJump(null, bi - 1) }, 'Back five') : null,
        bi < nb - 1 ? h('button', { type: 'button', className: 'lv-nav', onClick: () => onJump(null, bi + 1) }, 'Next five') : null),
      // the legend offers only the keys that do something on this card
      h('div', { className: 'lv-tbk' },
        opts.length ? [h('kbd', { key: 'a' }, '1'), '–', h('kbd', { key: 'b' }, String(opts.length)), 'pick ·'] : null,
        plain ? [h('kbd', { key: 'l' }, 'L'), 'later ·', h('kbd', { key: 'e' }, '↵'), 'copy the decide line ·'] : null,
        h('kbd', null, 'esc'), 'back')))
}

/* The box tile's second source: /overview, re-read on every Today tick. A    */
/* failed read keeps the last good sample and says it could not refresh.      */
function useOverview(tickKey) {
  const [ov, setOv] = useState(null)
  useEffect(() => {
    if (!restFn) return undefined
    let dead = false
    restFn('/overview')
      .then(d => { if (!dead) setOv(d || null) })
      .catch(e => { if (!dead) setOv(o => (o && !o.error ? o : { error: String(e) })) })
    return () => { dead = true }
  }, [tickKey])
  return ov
}

/* The call fills its pane, as the mockup's does: the stage runs from where it  */
/* starts to the bottom of the pane that scrolls it, so the tray sits on the    */
/* floor. Measured on mount and on window resize; the CSS height is the fallback.*/
function useFitHeight(el) {
  const [px, setPx] = useState(null)
  React.useLayoutEffect(() => {
    if (!el) return undefined
    let box = el.parentElement
    while (box && box !== document.body && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
    const scroller = box && box !== document.body ? box : null
    const measure = () => {
      const top = el.getBoundingClientRect().top + (scroller ? scroller.scrollTop : 0)
      const bottom = scroller
        ? Math.min(window.innerHeight, scroller.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(scroller).paddingBottom) || 0))
        : window.innerHeight
      setPx(Math.max(560, Math.floor(bottom - top)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [el])
  return px
}

function LivePage() {
  const s = useToday(true)
  const ov = useOverview(s.tickKey)
  const [stageEl, setStageEl] = useState(null) // a callback ref: the stage element once mounted
  const height = useFitHeight(stageEl)
  const [focus, setFocus] = useState({ id: null, idx: 0 }) // the card in the tray, and where it stood
  const [picked, setPicked] = useState(null) // { id, n, at } — this view only
  const [copied, setCopied] = useState({}) // id -> word — this view only
  const [sent, setSent] = useState({}) // id -> { word, state: sending|confirm|ok|bad, msg, confirm, at } — verb (a)
  const keyRef = React.useRef(null)
  useEffect(() => { injectStyle() }, [])
  useEffect(() => {
    const on = e => keyRef.current && keyRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const data = s.data
  const { today, live, parked, derived } = splitNeeds((data && data.needs_you) || {})
  // The server's live block when it has one (its order, its receipts); else the same order computed here.
  const lv = data && data.live && !data.live.error && Array.isArray(data.live.order) ? data.live : null
  const Q = lv ? lv.order.map(id => live.find(i => i.id === id)).filter(Boolean)
    .concat(live.filter(i => !lv.order.includes(i.id)).sort(byQueue)) : live.slice().sort(byQueue)
  // A card that left the queue (its decide ran) hands the tray to the one after it.
  let qi = focus.id ? Q.findIndex(c => c.id === focus.id) : -1
  if (qi < 0) qi = Math.min(focus.idx, Math.max(0, Q.length - 1))
  const q = Q[qi] || null
  const bi = Math.floor(qi / BATCH)
  const nb = Math.max(1, Math.ceil(Q.length / BATCH))
  const batch = Q.slice(bi * BATCH, bi * BATCH + BATCH)
  const pos = qi - bi * BATCH
  const opts = q ? wordsOf(q) : []
  const plain = Boolean(q) && SAFE_ID.test(String(q.id))
  const pick = q && picked && picked.id === q.id ? picked.n : null
  const word = pick !== null ? opts.concat('later')[pick] : null

  const focusOn = id => { if (id) { setFocus({ id, idx: Q.findIndex(c => c.id === id) }); setPicked(null) } }
  // Copying does not move on: the clipboard holds one line, so the next copy would replace it.
  const doCopy = () => {
    if (!q || !word) return
    const id = q.id
    copy('decide ' + id + ' ' + word)
      .then(() => setCopied(c => ({ ...c, [id]: word })))
      .catch(() => { /* not copied: the button keeps saying Copy */ })
  }
  // The same word again copies: at once by key, and by click only past 350 ms (a double-click is not two answers).
  if (ANSWER_ON_PAGE && lv && lv.answer && lv.answer.enabled) probePageKey()
  const answerOn = ANSWER_ON_PAGE && Boolean(lv && lv.answer && lv.answer.enabled) && pageKey === 'match'
  const offer = answerOn && q ? (lv.answer.offers || {})[q.id] || null : null
  // verb (a): one card per click; a click while one is in flight is dropped; a tier-3 confirm
  // counts only past 400 ms after it was armed (a double-click is not two clicks).
  const doSend = e => {
    if (!q || !word || !offer || !offer.tokens || !offer.tokens[word]) return
    const id = q.id
    const w = word
    const st = sent[id]
    const body = { id, word: w, exp: offer.exp, token: offer.tokens[w] }
    if (st && st.state === 'confirm' && st.word === w && st.confirm) {
      if (e && e.timeStamp - st.at < 400) return
      body.confirm_exp = st.confirm.exp
      body.confirm = st.confirm.token
    }
    const req = postAnswer(body)
    if (!req) return
    setSent(m => ({ ...m, [id]: { word: w, state: 'sending' } }))
    req
      .then(r => setSent(m => ({ ...m, [id]: r && r.verdict === 'confirm' && r.confirm
        ? { word: w, state: 'confirm', confirm: r.confirm, title: r.title, at: e ? e.timeStamp : 0 }
        : { word: w, state: r && r.ok ? 'ok' : 'bad', msg: r ? r.verdict + (r.detail ? ' — ' + r.detail : '') : 'no reply' } })))
      .catch(err => setSent(m => ({ ...m, [id]: { word: w, state: 'bad', msg: 'not sent — ' + String(err) } })))
  }
  const choose = (n, at) => {
    if (!q) return
    if (pick === n && (at === null || at - picked.at > 350)) { doCopy(); return }
    setPicked({ id: q.id, n, at: at ?? 0 })
  }
  useEffect(() => {
    keyRef.current = e => {
      if (!q || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const el = stageEl
      if (!el || !el.isConnected || !el.getClientRects().length) return // another route is in front
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return
      const k = e.key
      const n = /^[1-9]$/.test(k) && Number(k) <= opts.length ? Number(k) - 1 : (k === 'l' || k === 'L') && plain ? opts.length : -1
      if (n >= 0) { choose(n, null); e.preventDefault() }
      else if (k === 'Enter' && word && !(t && t.tagName === 'BUTTON')) { doCopy(); e.preventDefault() }
      else if (k === 'Escape' && pick !== null) { setPicked(null); e.preventDefault() }
      else if ((k === 'ArrowRight' || k === 'ArrowLeft') && (!t || t === document.body || el.contains(t))) {
        const to = Q[Math.max(0, Math.min(Q.length - 1, qi + (k === 'ArrowRight' ? 1 : -1)))]
        if (to) focusOn(to.id)
        e.preventDefault()
      }
    }
  })

  const rows = (data && data.agents && data.agents.items) || []
  const failed = rows.filter(r => r.status === 'failed' || r.status === 'stopped')
  const panes = (data && data.agents_now && data.agents_now.rows) || []
  const all = live.concat(parked)
  const hands = x => live.filter(i => who(i) === x).length
  const held = x => all.filter(i => who(i) === x).length
  const seats = [...new Set(all.map(who))].sort((a, b) => hands(b) - hands(a) || held(b) - held(a) || a.localeCompare(b))
  const onStage = seats.filter(x => paneOf(panes, x)).length
  // Receipts: the server's done-today list carries the word and who gave it; the fallback only saw cards leave.
  const gone = lv && Array.isArray(lv.done_today) ? lv.done_today : (s.receipts || [])
  const session = lv && lv.session ? lv.session : null
  const n = needCount(data)
  const iso = t => (t ? new Date(t).toISOString() : null)

  return h('div', { ref: setStageEl, className: 'lv-stage', style: height ? { height: height + 'px' } : undefined },
    h('div', null,
      s.err && data ? h('div', { className: 'tdy-stalebar', role: 'alert' },
        'STALE — the last refresh failed ' + ago(iso(s.errAt)) +
        '. Everything below was sampled ' + ago(iso(s.lastOkAt)) + ' and is NOT current.',
        h('small', null, 'Error: ' + s.err)) : null,
      h('div', { className: 'lv-cb' },
        h('div', { className: 'lv-cb-l' },
          h('span', { className: 'lv-live' }, h('i'), 'Live'),
          data ? h('span', { className: 'lv-sum' },
            all.length + ' open · ', h('b', null, (n ?? '?') + ' need you'), ' · ' + parked.length + ' parked · ',
            h('span', { className: cls('lv-pp', !onStage && 'lv-pp0') },
              onStage ? onStage + ' of ' + seats.length + ' owners in a pane' : 'no owner is in a pane yet'),
            session ? h('span', { className: 'lv-pp', title: session.basis || '' }, ' · session ' + session.line + ' answered today')
              : gone.length ? h('span', { className: 'lv-pp' }, ' · ' + gone.length + ' left the queue since ' + hhmm(s.since)) : null,
            answerOn ? h('span', { className: 'lv-pp' }, ' · answering on this page is ON') : null) : null),
        h('div', { className: 'lv-cb-r' },
          data ? h('span', { className: 'lv-stamp' }, 'sampled ' + hhmm(data.sampled_at)) : null,
          h('button', {
            type: 'button', className: 'lv-cbtn lv-leave', title: 'Closes this view only. Nothing is answered or parked.',
            onClick: () => navigate('/today')
          }, h(LeaveIcon), 'Leave the call')))),
    !data
      ? h('div', { className: 'lv-msg' }, s.err ? 'Could not sample: ' + s.err : 'Sampling the box…')
      : h('div', { className: 'lv-st' },
          h('div', { className: cls('lv-grid', !Q.length && 'lv-quiet') },
            seats.map(x => h(SeatTile, {
              key: x, seat: x, hue: hueFor(x, seats), today, speaking: Boolean(q) && who(q) === x,
              mine: Q.filter(i => who(i) === x), parked: parked.filter(i => who(i) === x),
              pane: paneOf(panes, x), gone: gone.filter(i => who(i) === x), failedRow: failed.find(r => r.agent === x),
              onFocus: () => { const t = Q.find(i => who(i) === x); if (t) focusOn(t.id) }
            })),
            h(HostTile, { box: data.box, ov, rows, wide: seats.length % 5 === 0, alone: seats.length % 5 === 0 || seats.length % 5 === 4 }))),
    data ? h(Tray, {
      q, hue: q ? hueFor(who(q), seats) : 222, pos, batch, bi, nb, qLen: Q.length, pane: q ? paneOf(panes, who(q)) : null,
      pick, copied, derivedN: derived.length, today, onPick: choose, onCopy: doCopy,
      onJump: (id, b) => focusOn(id || (Q[b * BATCH] || {}).id),
      send: answerOn ? { offer, st: q ? sent[q.id] || null : null, busy: Boolean(q && sent[q.id] && sent[q.id].state === 'sending') } : null,
      onSend: doSend
    }) : null)
}

/* ======================================================================== */
/* C STAGE — direction C of the Command Center, to parity with its click-   */
/* through (docs/design/2026-09-22-command-center/c-stage.html, local only; */
/* the checklist is parity-spec.md beside it). The mockup's own render code */
/* is ported here over REAL data — the box's live block, rooms, proposals,  */
/* the herdr snapshot — so the call looks and behaves as drawn by           */
/* construction, not by eye. Routes: /live (Gallery, Speaker, an agent's    */
/* chat, a room) and /battlefield. Deep-linkable states, so every one can   */
/* be opened and shot: hermes://open/live?view=speaker|chat=<seat>|         */
/* room=<id>|pop=rooms|sheet=props|sheet=leave|left=1|pick=1, and           */
/* hermes://open/battlefield?tray=1.                                        */
/*                                                                          */
/* What it writes: the decide line to the clipboard (↵ / Copy), and — verb  */
/* (a), ON since 09-27 — one word for one card through POST /answer, only   */
/* on Karl's click, tier 3 on a second click. Nothing else. Leaving closes  */
/* the view; it starts and stops nothing. No card data lives in this file: */
/* every name, lane, room and card comes from the box at run time.          */
/* ======================================================================== */
const CC_STYLE_ID = 'fleet-cc-style'
const CC_TOKENS = `
.ccs{--page:#0d0d0d;--surface:#161615;--surface-2:#1f1f1d;--surface-3:#292927;--stage:#0a0a0a;--chrome:#121211;
  --ink:#f4f3ee;--ink-2:#c3c2b7;--ink-3:#898781;--ink-4:#63625d;--grid:#2c2c2a;--border:rgba(255,255,255,.09);
  --border-2:rgba(255,255,255,.15);--blue:#3987e5;--orange:#d95926;--good:#3fbf3f;--danger:#e66767;
  --sans:"Geist",ui-sans-serif,system-ui,-apple-system,sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --e:cubic-bezier(.2,.7,.2,1);color:var(--ink);font:14px/1.5 var(--sans);-webkit-font-smoothing:antialiased;text-align:left;color-scheme:dark}
.ccs *,.ccs *::before,.ccs *::after{box-sizing:border-box;margin:0;padding:0}
.ccs.cc-page{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--stage)}
.ccs .cc-main{grid-row:auto;grid-column:auto;flex:1;min-height:0}
.ccs .cc-stale{flex:none;padding:6px 16px;background:#3a1d1a;color:#f2c9c2;font-size:12.5px}
.ccs .cc-stale small{margin-left:8px;opacity:.7}
.ccs .cc-msg{padding:24px;color:var(--ink-3)}
.ccs .send{height:34px;padding:0 13px;border-radius:9px;border:1px solid var(--ink);color:var(--ink);font-weight:600;font-size:13.5px;display:inline-flex;align-items:center;white-space:nowrap}
.ccs .send.arm{background:var(--orange);border-color:var(--orange)}
.ccs .send:disabled{opacity:.5}
.ccs .sent{flex-basis:100%;font-size:12px;color:var(--ink-2)}.ccs .sent.bad{color:var(--danger)}
.ccs .navs{display:flex;gap:6px;margin-top:8px}
.ccs .tile.away .t-face svg{filter:saturate(.35) brightness(.7)}
.ccs .comp .in{cursor:pointer}.ccs .comp .in:hover{border-color:var(--border-2);color:var(--ink-3)}
/* the sidebar sections below the Bots roster, and the chrome items */
.ccs.cc-side{padding:4px 8px 14px;display:flex;flex-direction:column;gap:1px;background:transparent}
.ccs.cc-side .sh{margin:14px 8px 5px}
.ccs.cc-title{position:fixed;left:0;top:0;height:var(--titlebar-height,38px);display:flex;align-items:center;
  font-size:12.5px;color:var(--ink-3);white-space:nowrap;pointer-events:none;z-index:5;background:transparent}
.ccs.cc-title b{color:var(--ink-2);font-weight:500}
.ccs.cc-pill{position:fixed;left:0;top:0;height:var(--titlebar-height,38px);z-index:5;background:transparent;display:inline-flex;align-items:center}
.ccs.cc-pill .need{cursor:pointer}
.ccs.cc-sbar{display:inline-flex;align-items:center;gap:14px;font:11.5px/1 var(--mono);color:var(--ink-3);white-space:nowrap;background:transparent}
.ccs.cc-sbar b{font-weight:500}
`
/* The mockup's own CSS, scoped under .ccs (ids became classes: #main .cc-main, #cb .cc-cb, #stage */
/* .cc-stage, #panel .cc-panel, #tray .cc-tray), frame-only rules dropped. Generated from the file */
/* by a one-off script; edit here, not there.                                                      */
const CC_MOCK_CSS = `.ccs a{color:inherit;text-decoration:none}
.ccs button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;text-align:inherit}
.ccs button:disabled{cursor:default}
.ccs kbd{display:inline-grid;place-items:center;min-width:19px;height:19px;padding:0 4px;border-radius:5px;background:var(--surface-3);border:1px solid var(--border-2);font:500 10.5px/1 var(--mono);color:var(--ink-2)}
.ccs .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.ccs .dim{color:var(--ink-3)}
.ccs .c-needs{color:var(--orange)}
.ccs .c-working{color:var(--blue)}
.ccs .c-parked{color:var(--ink-3)}
.ccs .c-done{color:var(--good)}
.ccs .c-failed{color:var(--danger)}
.ccs .eyebrow{font:500 10.5px/1.3 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.ccs .cbtn{height:28px;padding:0 11px;border-radius:8px;border:1px solid var(--border-2);font-size:12.5px;color:var(--ink-2);display:inline-flex;align-items:center;gap:7px;white-space:nowrap;background:rgba(255,255,255,.02);transition:border-color .15s,color .15s}
.ccs .cbtn:hover{color:var(--ink);border-color:rgba(255,255,255,.28)}
.ccs .cbtn.dash{border-style:dashed}
.ccs .cbtn.on{color:var(--ink)}
.ccs .sw{position:relative;width:24px;height:14px;border-radius:8px;background:var(--surface-3);border:1px solid var(--border-2)}
.ccs .sw::after{content:"";position:absolute;top:2px;left:2px;width:8px;height:8px;border-radius:50%;background:var(--ink-3);transition:transform .15s var(--e)}
.ccs .on .sw::after{transform:translateX(10px);background:var(--ink)}
.ccs .need{display:inline-flex;align-items:center;height:21px;padding:0 9px;border-radius:999px;background:var(--orange);color:var(--ink);font:600 11.5px/1 var(--sans);font-variant-numeric:tabular-nums;white-space:nowrap}
.ccs .need.zero{background:none;color:var(--ink-3);border:1px solid var(--border-2);font-weight:500}
.ccs .mk{display:inline-flex;align-items:center;height:16px;padding:0 5px;border-radius:4px;font:500 9.5px/1 var(--mono);letter-spacing:.04em;white-space:nowrap;flex:none;vertical-align:middle;user-select:none;cursor:help}
.ccs .mk-H{background:#d9d8d0;color:#121211}
.ccs .mk-P{border:1px solid rgba(255,255,255,.3);color:var(--ink-2)}
.ccs .mk-Ps{border:1px dashed rgba(255,255,255,.45);color:var(--ink-2)}
.ccs .mk-W{border:1px dotted rgba(255,255,255,.5);color:var(--ink-2);border-radius:1px}
.ccs .tabs{display:flex;align-items:center;gap:4px;margin:0 2px 8px}
.ccs .tabs .tg{flex:1;display:flex;padding:3px;border-radius:8px;background:var(--surface-2);font-size:12px}
.ccs .tabs .tg span{flex:1;text-align:center;padding:3px 0;border-radius:6px;color:var(--ink-3)}
.ccs .tabs .tg span.on{background:var(--surface-3);color:var(--ink)}
.ccs .row{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:8px;font-size:13px;color:var(--ink-2);min-width:0;cursor:pointer}
.ccs .row:hover{background:rgba(255,255,255,.04)}
.ccs .row.on{background:var(--surface-2);color:var(--ink)}
.ccs .rw{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.ccs .rw b{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccs .rw small{font-size:11px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccs .sh{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:14px 8px 5px;font:500 10.5px/1.3 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.ccs .sh.sub{margin-top:10px}
.ccs .gl{width:16px;height:16px;color:var(--ink-3);flex:none}
.ccs .fc{display:inline-grid;flex:none}
.ccs .fc svg{width:100%;height:100%;display:block}
.ccs .s16{width:16px;height:16px}
.ccs .s18{width:18px;height:18px}
.ccs .s22{width:22px;height:22px}
.ccs .s24{width:24px;height:24px}
.ccs .s28{width:28px;height:28px}
.ccs .s30{width:30px;height:30px}
.ccs .s34{width:34px;height:34px}
.ccs .s40{width:40px;height:40px}
.ccs .s64{width:64px;height:64px}
.ccs .stack{display:inline-flex;flex:none}
.ccs .stack .fc{margin-left:-7px;border-radius:50%;background:#20201e;box-shadow:0 0 0 2px var(--chrome);padding:1px}
.ccs .stack .fc:first-child{margin-left:0}
.ccs .cc-main{grid-row:2;grid-column:2;min-width:0;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr) auto;background:var(--stage)}
.ccs .cc-cb{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--chrome)}
.ccs .cb-l{display:flex;align-items:center;gap:12px;min-width:0}
.ccs .live{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:13.5px;flex:none}
.ccs .live i{width:7px;height:7px;border-radius:50%;background:var(--ink)}
.ccs .cb-sum{font-size:13px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ccs .cb-sum .pp{color:var(--ink-3)}
.ccs .cb-r{display:flex;align-items:center;gap:8px;flex:none}
.ccs .seg{display:inline-flex;padding:2px;border-radius:8px;border:1px solid var(--border-2)}
.ccs .seg button{height:22px;padding:0 10px;border-radius:6px;font-size:12px;color:var(--ink-3)}
.ccs .seg button.on{background:var(--surface-3);color:var(--ink)}
.ccs .cbtn.leave{color:var(--ink);border-color:rgba(255,255,255,.26)}
.ccs .cc-stage{grid-column:1;grid-row:2;min-height:0;min-width:0;overflow:auto;padding:14px 16px}
.ccs .grid{height:100%;min-height:0;display:grid;gap:12px;grid-auto-rows:minmax(0,1fr)}
.ccs .g5{grid-template-columns:repeat(5,minmax(0,1fr))}
.ccs .g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.ccs .g2{grid-template-columns:repeat(2,minmax(0,1fr))}
.ccs .tile{position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;padding:11px 14px 12px;border-radius:14px;border:1px solid var(--border);background:radial-gradient(85% 65% at 50% 36%,hsl(var(--h) 42% 52% / .12),transparent 72%),#161615;cursor:pointer;overflow:hidden;transition:border-color .18s var(--e),background-color .18s var(--e)}
.ccs .tile:hover{border-color:rgba(255,255,255,.2)}
.ccs .tile.speaking{border-color:rgba(244,243,238,.72)}
.ccs .where{font:10.5px/16px var(--mono);color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:60px}
.ccs .t-face{flex:1 1 auto;min-height:0;display:grid;place-items:center;padding:4px 0}
.ccs .t-face svg{width:76px;height:76px;filter:drop-shadow(0 8px 16px rgba(0,0,0,.5));transition:filter .18s var(--e)}
.ccs .t-body{min-width:0}
.ccs .t-name{display:flex;align-items:center;gap:7px;font-size:15.5px;font-weight:600;letter-spacing:-.01em;line-height:1.3;white-space:nowrap}
.ccs .kg{width:14px;height:14px;color:var(--ink-3);flex:none}
.ccs .t-cap{margin-top:3px;font-size:13px;line-height:1.42;color:var(--ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:37px}
.ccs .t-cap b{color:var(--ink);font-weight:500}
.ccs .t-st{margin-top:7px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-3);min-width:0;white-space:nowrap;overflow:hidden}
.ccs .sl{display:inline-flex;align-items:center;gap:6px;font-weight:500;white-space:nowrap;flex:none}
.ccs .dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none;display:inline-block}
.ccs .c-parked .dot,.ccs .dot.pk-d{background:none;border:1.5px dashed var(--ink-3)}
.ccs .t-fold{margin-top:3px;font-size:11.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccs .t-fold[data-act]{cursor:pointer}
.ccs .t-fold[data-act]:hover{color:var(--ink-2)}
.ccs .tile[data-s=parked]{background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.028) 0 6px,transparent 6px 12px)}
.ccs .quiet .tile{background:#131312}
.ccs .quiet .t-face svg{filter:saturate(.45) brightness(.85)}
.ccs .hand{position:absolute;top:9px;right:10px;z-index:2;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px 0 8px;border-radius:999px;background:var(--orange);color:var(--ink);font:600 13px/1 var(--sans);font-variant-numeric:tabular-nums;box-shadow:0 6px 18px -5px rgba(217,89,38,.6);transform-origin:50% 100%;cursor:pointer}
.ccs .hand svg{width:15px;height:15px}
.ccs .hand.sm{position:static;height:20px;padding:0 7px 0 6px;font-size:11.5px;gap:3px;box-shadow:none}
.ccs .hand.sm svg{width:12px;height:12px}
.ccs .hand.ab{position:absolute}
.ccs .hand.dip{animation:cc-dip .18s var(--e)}
.ccs .hand.lower{animation:cc-lower .18s var(--e) forwards;pointer-events:none}
.ccs .cap-in{animation:cc-capin .18s var(--e)}
.ccs .tick{animation:cc-tick .18s var(--e)}
@keyframes cc-dip{50%{transform:translateY(5px) scale(.93)}}
@keyframes cc-lower{to{transform:translateY(14px) rotate(-12deg) scale(.8);opacity:0}}
@keyframes cc-capin{from{opacity:0;transform:translateY(4px)}}
@keyframes cc-tick{from{opacity:.2;transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){.ccs .hand.lower{display:none}}
.ccs .host{cursor:default;background:linear-gradient(180deg,#171716,#131312)}
.ccs .host.span2{grid-column:span 2}
.ccs .h-hd{display:flex;align-items:center;gap:8px;min-width:0;white-space:nowrap}
.ccs .h-name{font-size:15.5px;font-weight:600}
.ccs .tag{font:500 9.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);border:1px solid var(--border-2);border-radius:4px;padding:3px 5px}
.ccs .h-hd .ok{margin-left:auto;font:11px var(--mono);color:var(--ink-3);overflow:hidden;text-overflow:ellipsis}
.ccs .h-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px;margin-top:12px}
.ccs .gpu{display:flex;align-items:center;gap:10px;margin-top:8px}
.ccs .gpu .big{font:500 36px/1 var(--mono);letter-spacing:-.04em}
.ccs .gpu .big small{font-size:15px;color:var(--ink-3);margin-left:2px;letter-spacing:0}
.ccs .bar{height:6px;border-radius:3px;background:var(--grid);overflow:hidden;margin:12px 0 5px}
.ccs .bar i{display:block;height:100%;background:var(--ink-2);border-radius:3px}
.ccs .h-l{font-size:11.5px;color:var(--ink-3);line-height:1.5;min-width:0;overflow-wrap:anywhere}
.ccs .h-l .mono{color:var(--ink-2)}
.ccs .h-sub{font:500 10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin:0 0 5px}
.ccs .tmr{font-size:11.5px;line-height:1.55;color:var(--ink-2)}
.ccs .tmr i{font-style:normal;color:var(--ink-4);margin:0 5px}
.ccs .fl{font-size:11.5px;line-height:1.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccs .fl .mono{color:var(--ink-3);margin-right:4px}
.ccs .spk{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);gap:12px}
.ccs .strip{display:flex;gap:10px;min-width:0}
.ccs .mini{position:relative;flex:1 1 0;min-width:0;height:98px;border-radius:12px;border:1px solid var(--border);background:radial-gradient(80% 70% at 50% 40%,hsl(var(--h) 42% 52% / .12),transparent 72%),#161615;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;cursor:pointer;padding:0 6px}
.ccs .mini.speaking{border-color:rgba(244,243,238,.72)}
.ccs .mini .fc{width:42px;height:42px}
.ccs .mini b{font-size:12px;font-weight:500;color:var(--ink-2);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccs .mini .hand{top:6px;right:6px}
.ccs .mini.hostm{cursor:default;font-size:11.5px;color:var(--ink-3);text-align:center;gap:2px}
.ccs .mini.hostm .big{font:500 20px/1 var(--mono);color:var(--ink)}
.ccs .bigt{align-items:center;text-align:center;padding:18px 28px 22px}
.ccs .bigt .where{padding:0}
.ccs .bigt .t-face svg{width:150px;height:150px}
.ccs .bigt .t-name{justify-content:center;font-size:22px}
.ccs .bigt .t-cap{font-size:18px;line-height:1.45;-webkit-line-clamp:3;min-height:0;max-width:60ch;margin:6px auto 0}
.ccs .bigt .t-st{justify-content:center}
.ccs .bigt .hand{top:16px;right:18px;height:32px;font-size:15px;padding:0 12px 0 10px}
.ccs .bigt .hand svg{width:18px;height:18px}
.ccs .you .t-face svg{filter:none}
.ccs .s26{width:26px;height:26px}
.ccs .s36{width:36px;height:36px}
.ccs .s44{width:44px;height:44px}
.ccs .cb-sum .cnt{color:var(--ink);font-weight:600}
.ccs .tile .sl.nd,.ccs .sl.nd{color:var(--ink-2);font-weight:500}
.ccs .tile.you{cursor:default;background:#141413;border-style:dashed;border-color:rgba(255,255,255,.14)}
.ccs .mini.sel::after{content:"";position:absolute;left:34%;right:34%;bottom:5px;height:2px;border-radius:2px;background:var(--ink)}
.ccs .mini.speaking.sel{border-color:rgba(244,243,238,.72)}
.ccs .cc-tray{grid-column:1;grid-row:3;min-width:0;position:relative;border-top:1px solid var(--border);background:var(--chrome);padding:14px 18px 15px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,330px) 236px;gap:22px;align-items:start}
.ccs .tr-q{display:flex;gap:14px;min-width:0}
.ccs .tr-q>.fc{margin-top:3px}
.ccs .tr-m{min-width:0;flex:1}
.ccs .tr-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-3);white-space:nowrap;overflow:hidden}
.ccs .tr-meta b{color:var(--ink-2);font-weight:500}
.ccs .tr-title{margin-top:2px;font-size:20px;font-weight:600;letter-spacing:-.018em;line-height:1.28;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ccs .tr-ask{margin-top:4px;font-size:14px;line-height:1.45;color:var(--ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;max-width:72ch}
.ccs .tr-def{margin-top:7px;font-size:12.5px;color:var(--ink-3);line-height:1.4}
.ccs .tr-def b{color:var(--ink-2);font-weight:500}
.ccs .tr-pos{display:none}
.ccs .tr-a{min-width:0}
.ccs .picks{display:flex;flex-wrap:wrap;gap:6px}
.ccs .pk{height:34px;display:inline-flex;align-items:center;gap:8px;padding:0 13px 0 7px;border-radius:9px;border:1px solid var(--border-2);background:var(--surface);font-size:13.5px;font-weight:500;color:var(--ink);white-space:nowrap;transition:border-color .15s var(--e),background-color .15s var(--e)}
.ccs .pk:hover{border-color:rgba(255,255,255,.32)}
.ccs .pk.on{border-color:var(--ink);background:var(--surface-3)}
.ccs .pk.on kbd{background:var(--ink);border-color:var(--ink);color:#121211}
.ccs .pk.sm{height:28px;font-size:12.5px;padding:0 10px 0 5px;gap:6px}
.ccs .never{margin-top:8px;display:flex;gap:7px;align-items:flex-start;font-size:12px;line-height:1.4;color:var(--ink-3)}
.ccs .never .gl{width:13px;height:13px;margin-top:2px}
.ccs .conf{display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap}
.ccs .confirm{height:34px;padding:0 9px 0 14px;border-radius:9px;background:var(--ink);color:#121211;font-weight:600;font-size:13.5px;display:inline-flex;align-items:center;gap:9px;white-space:nowrap}
.ccs .confirm kbd{background:rgba(0,0,0,.07);border-color:rgba(0,0,0,.18);color:#121211}
.ccs .confirm:disabled{background:var(--surface-3);color:var(--ink-4)}
.ccs .confirm:disabled kbd{background:transparent;color:var(--ink-4);border-color:var(--border)}
.ccs .confirm.sm{height:28px;font-size:12.5px;padding:0 7px 0 11px}
.ccs .ow{font-size:12px;color:var(--ink-3);min-width:0}
.ccs .ow .dl{color:var(--ink-2);word-break:break-all}
.ccs .tb{border-left:1px solid var(--border);padding-left:18px;min-width:0;font-size:12px;color:var(--ink-3);line-height:1.45}
.ccs .tb-h{font-size:13px;color:var(--ink);font-weight:500}
.ccs .pips{display:flex;gap:4px;margin:9px 0 9px}
.ccs .pip{flex:1;height:5px;border-radius:3px;background:var(--grid)}
.ccs .pip.p-working{background:var(--blue)}
.ccs .pip.p-done{background:var(--good)}
.ccs .pip.p-parked{background:none;box-shadow:inset 0 0 0 1px var(--ink-3)}
.ccs .pip.cur{background:var(--ink)}
.ccs .tb-l+.tb-l{margin-top:3px}
.ccs .tb-k{margin-top:9px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:11.5px}
.ccs .tb-k .mk{margin-right:3px}
.ccs .tr-zero{grid-column:1/-1;display:flex;align-items:center;gap:16px;min-height:62px}
.ccs .tz-t{font-size:22px;font-weight:600;letter-spacing:-.02em;line-height:1.2}
.ccs .tz-s{font-size:13px;color:var(--ink-3);margin-top:2px}
.ccs .tr-zero>div:nth-child(2){flex:1;min-width:0}
.ccs .hand-off{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--border-2);color:var(--ink-3);flex:none}
.ccs .hand-off svg{width:16px;height:16px;transform:rotate(-14deg) translateY(2px)}
.ccs .tr-mini{grid-column:1/-1;display:flex;align-items:center;gap:12px;min-width:0;white-space:nowrap}
.ccs .tr-mini .nx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--ink-3);font-size:13px}
.ccs .tr-mini .nx b{color:var(--ink-2);font-weight:500}
.ccs .tr-mini .cnt{font-weight:600}
.ccs[data-r=battlefield] .cc-tray{padding:10px 16px}
.ccs .trx{position:absolute;top:8px;right:8px}
.ccs .sbtn{display:inline-flex;align-items:center;gap:6px;color:var(--ink-2);font:inherit}
.ccs .sbtn:hover{color:var(--ink)}
.ccs .sbtn kbd{height:16px;font-size:10px}
.ccs .cc-panel{grid-column:2;grid-row:2/4;width:420px;min-height:0;border-left:1px solid var(--border);background:var(--chrome);display:flex;flex-direction:column}
.ccs .cc-panel:empty{display:none}
.ccs .cc-panel.wide{width:470px}
.ccs .ph{display:flex;align-items:center;gap:11px;padding:11px 12px 11px 14px;border-bottom:1px solid var(--border);flex:none}
.ccs .ph-t{flex:1;min-width:0}
.ccs .ph-t b{display:flex;align-items:center;gap:7px;font-size:15px;font-weight:600;line-height:1.3}
.ccs .ph-t small{display:block;font-size:12px;color:var(--ink-3);line-height:1.35;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccs .x{width:28px;height:28px;border-radius:7px;display:grid;place-items:center;color:var(--ink-3);flex:none}
.ccs .x:hover{background:var(--surface-2);color:var(--ink)}
.ccs .x .gl{width:14px;height:14px}
.ccs .cons{flex:none;padding:8px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--ink-3);display:flex;gap:8px;align-items:flex-start;line-height:1.45}
.ccs .cons .mk{margin-top:1px}
.ccs .msgs{flex:1;min-height:0;overflow:auto;padding:14px 14px 12px;display:flex;flex-direction:column;gap:9px}
.ccs .day{align-self:center;font:11px var(--mono);color:var(--ink-3);padding:3px 10px;border-radius:999px;background:var(--surface)}
.ccs .sys{align-self:center;text-align:center;font-size:12px;line-height:1.5;color:var(--ink-3);max-width:90%}
.ccs .sys b{color:var(--ink-2);font-weight:500}
.ccs .m{display:flex;gap:8px;align-items:flex-end;max-width:94%}
.ccs .m>.fc{margin-bottom:2px}
.ccs .m.me{align-self:flex-end;flex-direction:row-reverse;max-width:80%}
.ccs .bub{min-width:0;background:var(--surface-2);border-radius:14px 14px 14px 4px;padding:8px 11px 9px;font-size:13.5px;line-height:1.45;color:var(--ink);overflow-wrap:anywhere}
.ccs .bub>b{font-weight:600}
.ccs .me .bub{background:#22303a;border-radius:14px 14px 4px 14px}
.ccs .bub.ask{box-shadow:inset 2px 0 0 var(--orange)}
.ccs .who{font-size:12px;font-weight:600;color:var(--ink-2);margin-bottom:2px}
.ccs .at{font:500 12.5px var(--mono);color:var(--orange)}
.ccs .why,.ccs .def{display:block;margin-top:5px;font-size:12.5px;line-height:1.4;color:var(--ink-3)}
.ccs .lbl{display:block;font:500 10px/1.3 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:3px}
.ccs .qc{margin-top:9px;padding-top:9px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ccs .badge{display:inline-flex;align-items:center;height:19px;padding:0 8px;border-radius:999px;background:var(--orange);color:var(--ink);font:600 11px/1 var(--sans)}
.ccs .qpk{display:flex;flex-wrap:wrap;gap:5px;width:100%;align-items:center}
.ccs .qw{font-size:12px;color:var(--ink-3);margin-right:4px}
.ccs .tr-lint{font-size:12px;color:var(--orange);margin:0 0 6px}
.ccs .thr{display:block;margin-top:6px;font-size:12px;color:var(--ink-3)}
.ccs .wpv{display:flex;align-items:center;gap:8px;margin-top:8px;padding:7px 9px;border-radius:9px;border:1px dotted rgba(255,255,255,.28);font-size:12px;color:var(--ink-3)}
.ccs details.act{align-self:stretch;border:1px solid var(--border);border-radius:10px;padding:7px 11px;font-size:12px;line-height:1.5;color:var(--ink-3);background:var(--surface)}
.ccs details.act summary{cursor:pointer;color:var(--ink-2)}
.ccs details.act div{margin-top:3px}
.ccs .comp{flex:none;border-top:1px solid var(--border);padding:10px 12px 6px;display:flex;gap:8px;align-items:center}
.ccs .comp .in{flex:1;height:36px;border-radius:18px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;padding:0 14px;color:var(--ink-4);font-size:13px}
.ccs .ow2{flex:none;padding:0 14px 10px;font-size:11.5px;color:var(--ink-3)}
.ccs .bf{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
.ccs .bf-l,.ccs .bf-r{display:flex;flex-direction:column;gap:12px;min-width:0}
.ccs .cardx{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:13px 15px;min-width:0}
.ccs .bf-top{display:flex;align-items:flex-end;gap:30px;padding:16px 18px}
.ccs .bf-n{font-size:15px;color:var(--ink-2);white-space:nowrap}
.ccs .bf-n b{display:block;font:600 58px/1 var(--sans);letter-spacing:-.045em;color:var(--ink);font-variant-numeric:tabular-nums;margin-bottom:2px}
.ccs .tal{display:flex;gap:22px;padding-bottom:3px}
.ccs .tal div{font-size:12px;color:var(--ink-3)}
.ccs .tal b{display:block;font:500 22px/1.15 var(--mono);color:var(--ink)}
.ccs .bf-w{flex:1;text-align:right;font-size:12.5px;color:var(--ink-2);line-height:1.5;padding-bottom:3px}
.ccs .bf-top>.mk{align-self:flex-start}
.ccs .sh2{display:flex;align-items:baseline;gap:10px;font:500 10.5px/1.3 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:4px 2px -4px}
.ccs .sh2 span{letter-spacing:0;text-transform:none;font:12px var(--sans);color:var(--ink-4)}
.ccs .ev{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.ccs .evr{position:relative;display:flex;align-items:center;gap:10px;min-width:0;padding:9px 10px;border-radius:11px;border:1px solid var(--border);background:radial-gradient(90% 140% at 0% 50%,hsl(var(--h) 42% 52% / .1),transparent 70%),var(--surface);cursor:pointer}
.ccs .evr:hover,.ccs .cl:hover{border-color:rgba(255,255,255,.2)}
.ccs .evr .rw b{display:flex;align-items:center;gap:5px;font-size:13px}
.ccs .evr .kg{width:12px;height:12px}
.ccs .rooms{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.ccs .cl{display:flex;flex-direction:column;gap:8px;min-width:0;padding:11px 12px;border-radius:12px;border:1px solid var(--border);background:var(--surface);cursor:pointer}
.ccs .cl-h{display:flex;align-items:center;justify-content:space-between;gap:6px}
.ccs .cl b{font-size:13px;font-weight:600;line-height:1.3}
.ccs .cl .stack .fc{box-shadow:0 0 0 2px var(--surface)}
.ccs .cl small{font-size:11.5px;color:var(--ink-3);line-height:1.35}
.ccs .segbar{display:flex;gap:2px;height:5px}
.ccs .segbar i{flex:1;border-radius:2px;background:rgba(244,243,238,.3)}
.ccs .segbar i.p-working{background:var(--blue)}
.ccs .segbar i.p-done{background:var(--good)}
.ccs .segbar i.p-parked{background:none;box-shadow:inset 0 0 0 1px var(--ink-3)}
.ccs .ch{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.ccs .ch h4{font:500 10.5px/1.3 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.ccs .bxg{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
.ccs .bxg div{font-size:11.5px;color:var(--ink-3);line-height:1.35}
.ccs .bxg b{display:block;font:500 18px/1.25 var(--mono);color:var(--ink)}
.ccs .li2{margin-top:10px;font-size:11.5px;color:var(--ink-2);line-height:1.5}
.ccs .li2.dim{margin-top:3px;color:var(--ink-3)}
.ccs .li{display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--border);font-size:12.5px;min-width:0;white-space:nowrap}
.ccs .ch+.li{border-top:0}
.ccs .li>span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2)}
.ccs .li .mono{font-size:11px}
.ccs .pop-bg{position:fixed;inset:0;z-index:39}
.ccs .pop{position:fixed;z-index:40;background:var(--surface);border:1px solid var(--border-2);border-radius:13px;box-shadow:0 22px 60px rgba(0,0,0,.6);padding:12px;max-height:calc(100vh - 24px);overflow:auto;animation:cc-capin .16s var(--e)}
.ccs .pop-h{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;padding:2px 4px 10px}
.ccs .pop-n{font-size:12.5px;color:var(--ink-3);line-height:1.5;padding:0 4px 10px}
.ccs .pop-s{font:500 10.5px/1.3 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);padding:12px 4px 4px}
.ccs .prow{display:flex;align-items:center;gap:10px;padding:8px;border-radius:9px;min-width:0;cursor:pointer}
.ccs .prow:hover{background:var(--surface-2)}
.ccs .prow .stack .fc{box-shadow:0 0 0 2px var(--surface)}
.ccs .pop-f{font-size:11.5px;color:var(--ink-3);padding:9px 4px 2px;line-height:1.45;border-top:1px solid var(--border);margin-top:6px}
.ccs .lg{display:flex;align-items:flex-start;gap:12px;padding:5px 4px;font-size:12.5px;color:var(--ink-2);line-height:1.45}
.ccs .lg>:first-child{flex:none;width:66px;justify-content:center;margin-top:1px}
.ccs .lgs{display:inline-flex;justify-content:center;padding-top:5px}
.ccs .cc-in{border:1px dashed rgba(255,255,255,.2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:2px}
.ccs .cc-n{font-size:20px;font-weight:600;letter-spacing:-.02em;padding:6px 8px 4px}
.ccs .ov-bg{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.62);display:grid;place-items:center;padding:24px;animation:cc-capin .16s var(--e)}
.ccs .sheet{width:min(880px,100%);max-height:calc(100vh - 48px);overflow:auto;background:var(--surface);border:1px solid var(--border-2);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.ccs .sh-h{display:flex;align-items:flex-start;gap:16px;justify-content:space-between;padding:22px 24px 16px;border-bottom:1px solid var(--border)}
.ccs .sh-h h2{font-size:26px;font-weight:600;letter-spacing:-.025em;line-height:1.2;margin-top:6px}
.ccs .lead{margin-top:6px;font-size:14px;color:var(--ink-2);line-height:1.5;max-width:66ch}
.ccs .lv{display:grid;grid-template-columns:1fr 1fr;gap:0 30px;padding:4px 24px 8px}
.ccs .lv section{padding:14px 0 12px;border-bottom:1px solid var(--border);min-width:0}
.ccs .lv h3{font:500 10.5px/1.3 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px}
.ccs .lv h3 b{color:var(--orange);font-weight:500}
.ccs .lr{display:grid;grid-template-columns:86px minmax(0,1fr);gap:1px 12px;font-size:12.5px;line-height:1.45;padding:3px 0;color:var(--ink-2)}
.ccs .lr>:first-child{color:var(--ink-3);font-family:var(--mono);font-size:11.5px;padding-top:1px}
.ccs .lr small{grid-column:2;color:var(--ink-3);font-size:12px}
.ccs .sh-f{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:14px 24px;border-top:1px solid var(--border);position:sticky;bottom:0;background:var(--surface)}
.ccs .sh-f .ow{flex:1}
.ccs .pl{padding:4px 24px 8px}
.ccs .pi{display:flex;gap:12px;padding:13px 0;border-bottom:1px solid var(--border)}
.ccs .pi b{font-size:14.5px;font-weight:600;line-height:1.35}
.ccs .pi p{font-size:13px;color:var(--ink-2);margin-top:2px;line-height:1.45}
.ccs .pi small{display:block;font-size:11.5px;color:var(--ink-3);margin-top:3px}
@media (max-width:700px){.ccs .cc-main{display:block}
.ccs .cc-cb{flex-direction:column;align-items:stretch;gap:10px;padding:12px 16px}
.ccs .cb-l{flex-wrap:wrap;gap:8px 10px}
.ccs .cb-sum{white-space:normal}
.ccs .cb-r{flex-wrap:wrap}
.ccs .cc-stage{overflow:visible;padding:12px 16px 330px}
.ccs .grid{height:auto;display:flex;flex-direction:column;gap:8px}
.ccs .tile{flex-direction:row;align-items:center;gap:12px;padding:10px 12px;overflow:visible}
.ccs .tile .where,.ccs .tile .t-fold{display:none}
.ccs .t-face{flex:none;padding:0}
.ccs .t-face svg{width:44px;height:44px}
.ccs .t-body{flex:1;min-width:0}
.ccs .t-name{font-size:15px}
.ccs .t-cap{-webkit-line-clamp:1;min-height:0;font-size:12.5px}
.ccs .t-st{margin-top:3px}
.ccs .tile .hand{position:static;order:3;flex:none;box-shadow:none}
.ccs .host{display:block}
.ccs .host.span2{grid-column:auto}
.ccs .h-grid{grid-template-columns:1fr;gap:12px}
.ccs .strip{display:none}
.ccs .spk{display:block}
.ccs .bigt .t-face svg{width:56px;height:56px}
.ccs .bigt .t-cap{font-size:13px}
.ccs .cc-panel,.ccs .cc-panel.wide{width:auto;border-left:0;border-top:1px solid var(--border);padding-bottom:320px}
.ccs[data-r=chat] .cc-stage,.ccs[data-r=room] .cc-stage{display:none}
.ccs .msgs{overflow:visible}
.ccs .cc-tray{position:fixed;left:0;right:0;bottom:0;z-index:30;grid-template-columns:minmax(0,1fr);gap:10px;padding:12px 16px 14px;border-top:1px solid var(--border-2);box-shadow:0 -16px 36px rgba(0,0,0,.65);max-height:64vh;overflow:auto}
.ccs .tb{display:none}
.ccs .tr-pos{display:inline}
.ccs .tr-q>.fc{width:34px;height:34px}
.ccs .tr-title{font-size:17px}
.ccs .tr-ask{font-size:13px}
.ccs .tr-meta>span:nth-of-type(1){display:none}
.ccs[data-r=battlefield] .cc-stage{padding-bottom:96px}
.ccs .bf{grid-template-columns:minmax(0,1fr)}
.ccs .bf-top{flex-wrap:wrap;gap:14px 24px}
.ccs .bf-w{text-align:left;flex-basis:100%}
.ccs .ev{grid-template-columns:repeat(2,minmax(0,1fr))}
.ccs .rooms{grid-template-columns:repeat(2,minmax(0,1fr))}
.ccs .tr-mini .cbtn{flex:none}
.ccs .lv{grid-template-columns:1fr}
.ccs .ov-bg{padding:10px;align-items:end}
.ccs .sheet{max-height:calc(100vh - 20px)}
.ccs .sh-h{padding:18px 16px 12px}
.ccs .sh-h h2{font-size:22px}
.ccs .lv,.ccs .pl{padding-left:16px;padding-right:16px}
.ccs .sh-f{padding:12px 16px}}
.ccs .rh{display:inline-flex;align-items:center;gap:3px;font:500 11.5px/1 var(--mono);color:var(--ink-2);flex:none}
.ccs .rh svg{width:12px;height:12px;color:var(--orange)}
.ccs .dim2{color:var(--ink-4)}
.ccs .echo{margin-top:9px;font-size:12.5px;line-height:1.5;color:var(--ink-2)}
.ccs .echo b{color:var(--ink);font-weight:600}
.ccs .latr{margin-top:8px;font-size:11.5px;color:var(--ink-4);display:flex;gap:8px;align-items:baseline}
.ccs .lat{all:unset;cursor:pointer;font:500 12px/1.2 var(--mono);color:var(--ink-3);border-bottom:1px dashed var(--ink-4)}
.ccs .lat:hover,.ccs .lat.on{color:var(--ink);border-bottom-color:var(--ink-2)}
.ccs .lat:focus-visible{outline:1px solid var(--ink-3);outline-offset:3px}
.ccs .rw small.c-failed{color:var(--danger)}
.ccs .where{padding-right:46px}
.ccs .host .h-grid{flex:none}
.ccs .gpu .big{font-size:30px}
.ccs .host .h-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccs .host>.h-sub{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media (min-width:701px){.ccs .t-face{flex:1 1 0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ccs .t-face svg{height:100%;width:auto;max-height:76px;flex:none}
.ccs .bigt .t-face svg{height:100%;width:auto;max-height:128px}
.ccs[data-r=chat] .cc-tray,.ccs[data-r=room] .cc-tray{grid-template-columns:minmax(0,1fr) minmax(0,290px)}
.ccs[data-r=chat] .cc-tray .tb,.ccs[data-r=room] .cc-tray .tb{display:none}
.ccs[data-r=chat] .tr-pos,.ccs[data-r=room] .tr-pos{display:inline}
.ccs[data-r=chat] .tr-meta>span:nth-of-type(1),.ccs[data-r=room] .tr-meta>span:nth-of-type(1){display:none}}
.ccs .bigt .t-face svg{width:128px;height:128px}
.ccs .mini{height:104px;justify-content:flex-end;padding-bottom:10px}
.ccs .lv section.wide{grid-column:1/-1}
.ccs .cols2{columns:2;column-gap:30px}
.ccs .cols2 .lr{break-inside:avoid}
.ccs .row .need{height:19px;font-size:11px;padding:0 7px}
.ccs .tal .dot{margin-right:5px;vertical-align:1px}
.ccs .cc-in .mk{align-self:flex-start}
.ccs .li .fc{flex:none}
.ccs .bf-n b.tick{animation:cc-tick .18s var(--e)}
@media (max-width:700px){.ccs .cols2{columns:1}
.ccs .bigt .t-face svg{width:56px;height:56px}
.ccs .mini{height:auto}}
`
const CC_CSS = CC_TOKENS + CC_MOCK_CSS
function injectCC() {
  const old = document.getElementById(CC_STYLE_ID)
  if (old && old.textContent === CC_CSS) return
  if (old) old.remove()
  const el = document.createElement('style')
  el.id = CC_STYLE_ID
  el.textContent = CC_CSS
  document.head.appendChild(el)
}

/* ---- the route, from the hash router: #/live?room=… ------------------- */
function ccLoc() {
  const raw = String(window.location.hash || '').replace(/^#/, '')
  const qi = raw.indexOf('?')
  const path = qi < 0 ? raw : raw.slice(0, qi)
  const params = new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1))
  return { path: path || '/', params }
}
function useCcLoc() {
  const [loc, setLoc] = useState(ccLoc)
  useEffect(() => {
    const on = () => setLoc(ccLoc())
    window.addEventListener('hashchange', on)
    window.addEventListener('popstate', on)
    const t = setInterval(on, 800) // a router that replaces state without an event is still followed
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); clearInterval(t) }
  }, [])
  return loc
}

/* ---- helpers ported from the mockup ----------------------------------- */
const ccEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const ccClean = s => String(s == null ? '' : s).replace(/^NEEDS YOU #\d+\s*[—–-]\s*/i, '')
const ccT = s => ccEsc(keep(ccClean(s)))
const CC_HAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>'
const ccSv = (p, c = 'gl') => `<svg class="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
const CC_IC = {
  live: ccSv('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8.5"/>'),
  bf: ccSv('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  prop: ccSv('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'),
  leave: ccSv('<path d="M2.5 14.2c5.3-5 13.7-5 19 0l-2.1 2.8-4-1.5v-2.6a12 12 0 0 0-6.8 0v2.6l-4 1.5z"/>'),
  x: ccSv('<path d="M6 6l12 12M18 6L6 18"/>'),
  lock: ccSv('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')
}
const CC_KG = {
  claude: ccSv('<path d="M4 17l6-5-6-5M12 19h8"/>', 'kg'),
  hermes: ccSv('<path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.3-4.5A8.5 8.5 0 1 1 20.5 12z"/>', 'kg'),
  timer: ccSv('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.3 2M10 2.5h4"/>', 'kg')
}
const CC_KIND = { claude: 'Claude Code', hermes: 'Hermes Bot', timer: 'timer' }
const CC_YOU = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="#232321" stroke="rgba(255,255,255,.2)" stroke-width="1.5" stroke-dasharray="3 4"/><circle cx="50" cy="40" r="13" fill="#6b6a64"/><path d="M26 76c3-13 13-20 24-20s21 7 24 20" fill="#6b6a64"/></svg>'
/* Faces: the mockup's deterministic generator, whole — hue, shape family by kind. */
const ccHue = id => Math.round(176 + rnd(hsh(id))() * 92)
const ccFaces = new Map()
function ccFace(id, kind) {
  const key = id + '|' + kind
  if (ccFaces.has(key)) return ccFaces.get(key)
  const r = rnd(hsh(id))
  const hh = Math.round(176 + r() * 92), s = Math.round(20 + r() * 26), l = Math.round(58 + r() * 10)
  const fill = `hsl(${hh} ${s}% ${l}%)`, dk = `hsl(${hh} ${Math.round(s * 0.7)}% ${l - 20}%)`
  let body = '', ey = 49
  if (kind === 'hermes') {
    const A = 34 + r() * 3, B = 31 + r() * 3, n = 0.55
    let d = ''
    for (let i = 0; i < 56; i++) {
      const q = (i / 56) * Math.PI * 2, c = Math.cos(q), si = Math.sin(q)
      d += (i ? 'L' : 'M') + f1(50 + A * Math.sign(c) * Math.pow(Math.abs(c), n)) + ' ' + f1(47 + B * Math.sign(si) * Math.pow(Math.abs(si), n))
    }
    body = `<path d="M25 68 L15 93 L43 77 Z" fill="${fill}"/><path d="${d}Z" fill="${fill}"/>`; ey = 44
  } else if (kind === 'timer') {
    body = `<rect x="42" y="5" width="16" height="10" rx="3" fill="${dk}"/><rect x="46" y="12" width="8" height="10" fill="${dk}"/><rect x="79" y="21" width="13" height="7" rx="2.5" fill="${dk}" transform="rotate(42 85.5 24.5)"/><circle cx="50" cy="56" r="37" fill="${fill}"/><circle cx="50" cy="56" r="30.5" fill="none" stroke="${dk}" stroke-opacity=".5" stroke-width="1.6" stroke-dasharray="1.6 5.4" stroke-linecap="round"/>`; ey = 54
  } else {
    const N = 7, p = []
    for (let i = 0; i < N; i++) { const q = (i / N) * Math.PI * 2 + (r() - 0.5) * 0.35 - Math.PI / 2, rr = 34 + r() * 8; p.push([50 + rr * Math.cos(q), 52 + rr * Math.sin(q)]) }
    let d = `M${f1(p[0][0])} ${f1(p[0][1])}`
    for (let i = 0; i < N; i++) {
      const p0 = p[(i - 1 + N) % N], p1 = p[i], p2 = p[(i + 1) % N], p3 = p[(i + 2) % N]
      d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`
    }
    body = `<path d="${d}Z" fill="${fill}"/>`
  }
  const sp = 9 + r() * 4, ox = (r() - 0.5) * 6, hx = (r() - 0.5) * 1.6
  const eyes = [-1, 1].map(k => { const x = 50 + ox + k * sp; return `<ellipse cx="${f1(x)}" cy="${ey}" rx="4.3" ry="5.4" fill="#131315"/><circle cx="${f1(x + 1.3 + hx)}" cy="${ey - 2}" r="1.5" fill="#fff"/>` }).join('')
  const mw = 5 + r() * 4, my = ey + 12
  const mouth = `<path d="M${f1(50 + ox - mw)} ${my} Q${f1(50 + ox)} ${f1(my + 3 + r() * 3)} ${f1(50 + ox + mw)} ${my}" fill="none" stroke="#131315" stroke-width="2.3" stroke-linecap="round"/>`
  const shine = `<ellipse cx="36" cy="${ey - 17}" rx="9" ry="5" fill="#fff" fill-opacity=".16" transform="rotate(-22 36 ${ey - 17})"/>`
  const svg = `<svg viewBox="0 0 100 100" aria-hidden="true">${body}${shine}${eyes}${mouth}</svg>`
  ccFaces.set(key, svg)
  return svg
}

/* ---- the model: real data in the mockup's shape ------------------------ */
const ccMMDD = iso => { const m = String(iso || '').match(/\d{4}-(\d\d)-(\d\d)/); return m ? m[1] + '-' + m[2] : String(iso || '') }
const ccHM = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
const ccStamp = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso || '—') : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
const ccEvery = raw => {
  const s = String(raw || '')
  let m = s.match(/every\s+(\d+)\s*min/i); if (m) return m[1] + ' min'
  m = s.match(/^\*-\*-\* \*:\d\d\/(\d+):00$/); if (m) return Number(m[1]) + ' min'
  m = s.match(/^\*-\*-\* (\d\d:\d\d):00$/); if (m) return m[1]
  m = s.match(/every\s+(\d+)\s*h/i); if (m) return m[1] + ' h'
  return s.replace(/^every\s+/i, '') || '—'
}
function ccModel(data, ov) {
  const today = localDay()
  const ny = (data && data.needs_you) || {}
  const items = Array.isArray(ny.items) ? ny.items : []
  const lv = data && data.live && !data.live.error && Array.isArray(data.live.order) ? data.live : null
  const panes = (data && data.agents_now && data.agents_now.rows) || []
  const runs = (data && data.agents && data.agents.items) || []
  const rb = data && data.rooms && Array.isArray(data.rooms.rooms) ? data.rooms : { rooms: [], bots: {} }
  const botsB = data && data.bots && Array.isArray(data.bots.items) ? data.bots.items : []
  const seatOf = i => i.agent || 'no agent yet'
  const done = lv && Array.isArray(lv.done_today) ? lv.done_today : []

  const cards = items.map(i => {
    const pk = isParked(i, today)
    return {
      id: String(i.id), p: i.priority ?? 9, tier: Number(i.tier) || null, kind: i.ask_kind || 'DO', owner: seatOf(i),
      expiry: ccMMDD(i.expiry), expired: Boolean(i.expiry) && String(i.expiry) < today, title: topic(i), full: i.title || i.ask || i.id,
      ask: i.ask || '', why: i.why || '', default: i.default || '', options: wordsOf(i), plain: SAFE_ID.test(String(i.id)),
      parked: pk ? ((i.parked && (i.parked.reason === 'later' ? 'later' : i.parked.reason)) || 'parked') + ' · until ' + ccMMDD(i.parked.until) : null,
      shipped: i.agent_shipped !== false, since: i.since, raw: i, open: true
    }
  })
  const doneCards = done.filter(d => !cards.some(c => c.id === String(d.id))).map(d => ({
    id: String(d.id), p: 9, tier: Number(d.tier) || null, kind: '', owner: d.agent || 'no agent yet', expiry: '', title: d.title || d.ask || d.id,
    ask: d.ask || '', why: '', default: '', options: [], plain: false, parked: null, open: false,
    how: '“' + (d.answer || '?') + '” ✓✓ ' + (d.surface === 'page' ? 'sent from this page' : d.surface === 'phone' ? 'tapped on the phone' : d.surface === 'decide' ? 'by decide' : 'closed') +
      (d.answeredAt ? ' at ' + ccHM(d.answeredAt) : '') + ' — for its owner’s next pass'
  }))
  const order = lv ? lv.order.map(String) : cards.filter(c => !c.parked).sort((a, b) => byQueue(a.raw, b.raw)).map(c => c.id)
  cards.filter(c => !c.parked && !order.includes(c.id)).forEach(c => order.push(c.id))

  // agents: the seats first (Claude Code panes on the Mac when seated; each is also a Bot on the box)
  const AG = {}
  const botOf = id => botsB.find(b => (b.id || b.name) === id) || {}
  const botName = id => (rb.bots && rb.bots[id]) || botOf(id).name || botOf(id).display_name || id
  const botLane = id => botOf(id).lane || ''
  const failedOf = id => runs.filter(r => r.agent === id && (r.status === 'failed' || r.status === 'stopped') && lastNight(r.t))
  // a seat is an owner with an open card, or one whose card closed today; cards with no agent have no tile
  const seatIds = [...new Set(cards.map(c => c.owner).concat(done.filter(d => d.agent).map(d => d.agent)))]
  seatIds.forEach(id => {
    const pane = panes.find(r => r.host === 'mac' && r.name === id) || null
    AG[id] = { id, name: id, kind: pane ? 'claude' : 'hermes', where: pane ? 'mac' : 'box', pane, seat: true,
      herdr: pane ? [pane.detail, pane.where].filter(Boolean).join(' · ') : null,
      lane: botLane(id) || (pane ? 'owner seat · ' + (pane.detail || 'the Mac') : 'owner seat · not in a pane yet'),
      state: failedOf(id).length ? 'failed' : pane ? (PANE_STATE[pane.state] || pane.state || 'idle') : 'away' }
  })
  // everyone else the battlefield shows: the Mac's other panes, the box's Bots, the box's timers
  panes.filter(r => r.host === 'mac' && !AG[r.name]).forEach(r => {
    AG[r.name] = { id: r.name, name: r.name, kind: 'claude', where: 'mac', pane: r, herdr: [r.detail, r.where].filter(Boolean).join(' · '),
      lane: 'Claude Code · ' + (r.detail || 'a pane'), state: PANE_STATE[r.state] || r.state || 'idle' }
  })
  botsB.filter(b => !AG[b.id || b.name]).forEach(b => {
    const bid = b.id || b.name
    AG[bid] = { id: bid, name: b.name || b.display_name || bid, kind: 'hermes', where: 'box', lane: b.lane || (b.bot ? 'Hermes Bot' : 'Hermes profile'),
      state: failedOf(b.name).length ? 'failed' : 'idle' }
  })
  const tmr = data && data.timers && Array.isArray(data.timers.items) ? data.timers.items : []
  tmr.forEach(t => {
    const id = 'timer:' + t.name
    AG[id] = { id, name: t.name, kind: 'timer', where: 'box', lane: 'every ' + ccEvery(t.every), state: failedOf(t.name).length ? 'failed' : 'idle', timer: t }
  })
  Object.values(AG).forEach(a => { if (a.seat) a.name = a.id; a.display = a.seat ? botName(a.id) : a.name })

  const rooms = (rb.rooms || []).map(r => {
    const members = (r.members || []).map(String)
    return { id: String(r.id), name: r.name || r.id, agents: members.filter(m => AG[m]), cards: cards.concat(doneCards).filter(c => members.includes(c.owner)).map(c => c.id) }
  })

  // the box
  const b = data && data.box && !data.box.error ? data.box : {}
  const hl = ov && ov.health && !ov.health.error ? ov.health : {}
  const g = hl.gpu && !hl.gpu.error ? hl.gpu : {}
  const mem = hl.memory && !hl.memory.error && hl.memory.total_mb ? hl.memory : null
  const ck = b.checks || {}
  const failing = (ck.failing || []).length
  const models = b.models || {}
  const nightly = []
  runs.filter(r => (r.status === 'failed' || r.status === 'stopped' || r.status === 'blocked') && lastNight(r.t)).forEach(r => {
    const same = nightly.find(x => x.agent === r.agent && x.job === r.job && x.state === r.status)
    if (same) same.n += 1
    else nightly.push({ t: ccMMDD(r.t) + ' ' + ccHM(r.t), agent: r.agent, job: r.job || '?', state: r.status === 'stopped' ? 'failed' : r.status, why: r.reason || '', n: 1 })
  })
  const gb = mb => Math.round((mb || 0) / 1024)
  const box = {
    gpu: g.name || 'GPU', gpuPct: Math.round(Number(g.util_pct ?? b.gpu_util_pct) || 0), tempC: Math.round(Number(g.temp_c ?? b.gpu_temp_c) || 0),
    cores: hl.cores || '—', load: Array.isArray(hl.load) ? hl.load.map(x => fmt(x, 2)) : [fmt(b.load1, 2)],
    memTotal: mem ? gb(mem.total_mb) : '—', memUsed: mem ? gb(mem.total_mb - mem.available_mb) : '—', memFree: mem ? gb(mem.available_mb) : '—',
    memPct: mem ? ((mem.total_mb - mem.available_mb) / mem.total_mb) * 100 : 0,
    diskPct: b.disk_pct ?? '—', uptimeDays: hl.uptime_s ? Math.floor(hl.uptime_s / 86400) : '—',
    checks: ck.total ? (ck.total - failing) + '/' + ck.total + ' ' + String(ck.status || 'checks').toLowerCase() : 'checks —',
    models: (models.loaded || []).map(m => ({ id: m.name, gb: m.size_gb, loaded: true })), onDisk: models.on_disk ?? null,
    hermes: models.hermes || {}, timers: tmr.map(t => ({ id: t.name, every: ccEvery(t.every), next: t.next })), nightly,
    error: data && data.box && data.box.error
  }
  const proposals = (data && data.proposals && Array.isArray(data.proposals.items) ? data.proposals.items : [])
    .map((p, k) => ({ id: 'p' + k, owner: p.owner, title: p.title, why: p.why, about: p.about, date: p.date }))
  const answer = lv && lv.answer ? lv.answer : null
  return { today, cards, doneCards, order, AG, rooms, box, proposals, lv, answer, derived: (ny.derived || []).length,
    sampled: data ? ccStamp(data.sampled_at) : '—', sampledAt: data && data.sampled_at, queueErr: ny.error || null, session: lv && lv.session }
}

/* ---- the view state: one per window, it survives re-renders ------------ */
const CS = { focus: null, pick: null, pickAt: 0, view: 'gallery', pop: null, sheet: null, trayOpen: false, left: false,
  seen: {}, lastBy: {}, fx: null, want: null, sent: {}, copied: {}, applied: '', prevOpen: null, pk: '' }

function ccRender(M, route, answerOn) {
  const CARD = {}; M.cards.concat(M.doneCards).forEach(c => { CARD[c.id] = c })
  const AG = M.AG, ROOM = {}; M.rooms.forEach(r => { ROOM[r.id] = r })
  const st = id => { const c = CARD[id]; if (!c) return 'gone'; if (!c.open) return 'done'; return c.parked ? 'parked' : 'needs' }
  const QALL = M.cards.concat(M.doneCards)
  const Q = M.order.filter(id => st(id) === 'needs')
  const BATCH = {}; Q.forEach((id, i) => { BATCH[id] = Math.floor(i / BATCH_N) })
  const NB = Math.max(1, Math.ceil(Q.length / BATCH_N))
  const need = () => Q.length + M.derived
  const NEED = () => need() + ' need you'
  const openBatch = () => (Q.length ? BATCH[Q[0]] : -1)
  const isN = c => st(c.id) === 'needs'
  const cardsOf = a => QALL.filter(c => c.owner === a).sort((x, y) => (M.order.indexOf(x.id) + 1 || 999) - (M.order.indexOf(y.id) + 1 || 999))
  const hands = a => cardsOf(a).filter(isN).length
  const topQ = a => { const id = Q.find(x => CARD[x].owner === a); return id ? CARD[id] : null }
  const OWN = Object.values(AG).filter(a => a.seat).map(a => a.id)
    .sort((x, y) => hands(y) - hands(x) || cardsOf(y).length - cardsOf(x).length || x.localeCompare(y))
  const ORDER = ['failed', 'needs', 'working', 'parked', 'done']
  const LBL = { needs: 'needs you', working: 'working', parked: 'parked', done: 'done', failed: 'failed' }
  const stOf = cs => { const ss = cs.map(c => st(c.id)); for (const s of ORDER) if (ss.includes(s)) return s; return '' }
  const agentState = a => (AG[a] && AG[a].state === 'failed' ? 'failed' : stOf(cardsOf(a)) || (AG[a] && AG[a].state === 'working' ? 'working' : ''))
  const roomCards = rm => QALL.filter(c => rm.cards.includes(c.id))
  const roomNeeds = rm => roomCards(rm).filter(isN).length
  const roomState = rm => { const ss = rm.agents.map(agentState).concat([stOf(roomCards(rm))]); for (const s of ORDER) if (ss.includes(s)) return s; return '' }
  const kindOf = a => (AG[a] ? AG[a].kind : 'claude')
  const F = (id, z) => `<span class="fc s${z}">${ccFace(id, kindOf(id))}</span>`
  const whereOf = a => { const g = AG[a]; if (!g) return ''; return g.where === 'mac' ? 'the Mac' + (g.herdr ? ' · ' + g.herdr : '') : g.seat ? 'not in a pane yet' : 'the box' }
  const onWhere = a => (AG[a] && AG[a].where === 'mac' ? 'the Mac' : AG[a] && AG[a].seat ? 'no pane yet' : 'the box')
  const nameOf = a => (AG[a] ? AG[a].name : a)
  const failedBy = a => M.box.nightly.filter(x => x.agent === a && x.state === 'failed')
  const pw = (c, i) => (i === -1 ? 'later' : c.options[i])
  const nextFocus = () => {
    if (route.v === 'chat') { const q = topQ(route.id); if (q) return q.id }
    if (route.v === 'room' && ROOM[route.id]) { const q = roomCards(ROOM[route.id]).find(isN); if (q) return q.id }
    return Q[0] || null
  }
  if (!CS.focus || st(CS.focus) !== 'needs') CS.focus = nextFocus()
  const speaking = () => CS.last || (CS.focus && CARD[CS.focus] ? CARD[CS.focus].owner : null)
  const fxHas = cs => Boolean(CS.fx && CS.fx.c && cs.some(c => c.id === CS.fx.c))
  const tk = () => (CS.fx && CS.fx.c ? ' tick' : '')
  const viewName = () => (route.v === 'chat' ? nameOf(route.id) : route.v === 'room' ? (ROOM[route.id] || {}).name : route.v === 'battlefield' ? 'Battlefield' : 'Live')
  const pill = () => `<span class="need${need() ? '' : ' zero'}${tk()}">${NEED()}</span>`
  const MK = () => '' // markers are the mockup's annotation layer; the product draws none (parity-spec M1)

  const cbar = () => {
    let l = ''
    const seated = OWN.filter(a => AG[a].where === 'mac').length
    if (route.v === 'room') {
      const rm = ROOM[route.id]
      l = `<button class="cbtn" data-act="go" data-h="/live">← Back to the call</button><span class="live">${ccEsc(rm.name)}</span><span class="cb-sum">${rm.agents.length} members + you · ${rm.cards.length} cards · ${roomNeeds(rm)} of them wait on you</span>`
    } else if (route.v === 'battlefield') {
      l = `<span class="live"><i></i>Battlefield</span><span class="cb-sum">everyone · ${Object.keys(AG).length} agents · ${M.rooms.length} rooms · ${M.cards.length} cards · <b class="cnt${tk()}">${NEED()}</b></span>`
    } else {
      l = `<span class="live"><i></i>Live</span><span class="cb-sum">${M.cards.length} open · <b class="cnt${tk()}">${NEED()}</b> · ${M.cards.filter(c => c.parked).length} parked · <span class="pp">${seated}/${OWN.length} owners in a pane${M.session && M.session.line ? ' · session ' + ccEsc(M.session.line) + ' answered today' : ''}${answerOn ? ' · answering on this page is ON' : ''}</span></span>`
    }
    let rr = ''
    if (route.v === 'live') rr += `<div class="seg"><button class="${CS.view === 'gallery' ? 'on' : ''}" data-act="view" data-v="gallery">Gallery</button><button class="${CS.view === 'speaker' ? 'on' : ''}" data-act="view" data-v="speaker">Speaker</button></div>`
    rr += `<button class="cbtn" data-act="pop" data-p="rooms">Breakout rooms <span class="dim">${M.rooms.length}</span></button><button class="cbtn" data-act="sheet" data-s="props">Proposals</button>`
    rr += CS.left ? '<button class="cbtn leave" data-act="rejoin">Rejoin the call</button>' : `<button class="cbtn leave" data-act="sheet" data-s="leave">${CC_IC.leave}Leave the call</button>`
    return `<div class="cb-l">${l}</div><div class="cb-r">${rr}</div>`
  }
  const capHTML = (a, cs) => {
    const lb = CS.lastBy[a]
    if (lb && cs.some(c => c.id === lb.c)) {
      const c = CARD[lb.c], s = st(lb.c)
      if (lb.k === 'parked' && s === 'parked') return `parked — <b>${ccT(c.title)}</b>`
      if (lb.k === 'done' && s === 'done') return `done — <b>${ccT(c.title)}</b>${c.how ? ' · ' + ccEsc(c.how) : ''}`
    }
    const q = cs.find(isN); if (q) return `<b>${ccT(q.title)}</b> — “${ccT(q.ask)}”`
    return ccEsc(AG[a] ? AG[a].lane : '')
  }
  const stLine = (a, cs, room) => {
    const p = [], g = AG[a]
    if (g.state === 'failed') p.push('<span class="sl c-failed"><i class="dot"></i>failed</span>')
    const n = cs.filter(isN).length, cnt = s => cs.filter(c => st(c.id) === s).length
    if (n) p.push(`<span class="sl nd">needs you ${n}</span>`)
    const late = cs.filter(c => isN(c) && c.expired).length
    if (late) p.push(`<span class="sl nd">${late} expired</span>`)
    if (g.state === 'working') p.push('<span class="sl c-working"><i class="dot"></i>working</span>')
    const pk = cnt('parked'), d = cnt('done')
    if (pk) p.push(`<span class="sl c-parked"><i class="dot"></i>parked${pk > 1 ? ' ' + pk : ''}</span>`)
    if (d) p.push(`<span class="sl c-done"><i class="dot"></i>done ${d}</span>`)
    if (!cs.length || (!n && !pk && !d && g.state !== 'working' && g.state !== 'failed')) p.push(`<span class="sl dim">${cs.length ? '' : room ? 'no card in this room · ' : 'no card · '}${ccEsc(g.state === 'away' ? 'not in a pane' : g.state)}</span>`)
    return p.join('')
  }
  const folds = (a, cs, max) => {
    const o = []
    const f = failedBy(a)
    if (f.length) o.push(`<div class="t-fold c-failed">failed last night — ${f.map(x => ccEsc(x.job)).join(', ')}</div>`)
    if (AG[a].seat && !AG[a].pane && cs.some(c => c.open && !c.shipped)) o.push('<div class="t-fold">no agent for this seat yet</div>')
    cs.filter(c => st(c.id) === 'parked').forEach(c => { const nx = topQ(a); o.push(`<div class="t-fold">parked · ${ccEsc(c.parked)} — ${nx ? 'took next: ' + ccT(nx.title) : 'proposing next'}</div>`) })
    cs.filter(c => st(c.id) === 'done' && !CS.seen[c.id]).forEach(c => o.push(`<div class="t-fold" data-act="seen" data-id="${ccEsc(c.id)}" title="seen — fold it"><i class="dot c-done"></i> done — ${ccT(c.title)}${c.how ? ' · ' + ccEsc(c.how) : ''}</div>`))
    const sn = cs.filter(c => st(c.id) === 'done' && CS.seen[c.id]).length
    if (sn) o.push(`<div class="t-fold">… ${sn} done</div>`)
    return o.slice(0, max || 1).join('')
  }
  const handEl = (a, cs, cls) => {
    const n = cs.filter(isN).length, hit = fxHas(cs); cls = cls || ''
    if (n) return `<button class="hand${cls}${hit ? ' dip' : ''}" data-act="hand" data-a="${ccEsc(a)}" title="${n} question${n > 1 ? 's' : ''} — answer in the tray">${CC_HAND}<span class="${hit ? 'tick' : ''}">${n}</span></button>`
    if (hit) return `<span class="hand${cls} lower" aria-hidden="true">${CC_HAND}</span>`
    return ''
  }
  const ROOMWHERE = { hermes: 'Hermes Bot · native', claude: 'Claude · joins 1 Oct', timer: 'timer · not a Bot' }
  const tile = (a, o) => {
    o = o || {}
    const g = AG[a], rm = o.room
    const cs = rm ? roomCards(rm).filter(c => c.owner === a) : cardsOf(a)
    const s = g.state === 'failed' ? 'failed' : (stOf(cs) || 'idle'), hit = fxHas(cs)
    const where = rm ? (g.seat ? 'Hermes Bot · native' + (g.where === 'mac' ? ' · pane ' + ccEsc(g.pane.where || '') : '') : ROOMWHERE[g.kind]) : whereOf(a)
    return `<div class="tile${o.cls || ''}${speaking() === a ? ' speaking' : ''}${g.state === 'away' ? ' away' : ''}" style="--h:${ccHue(a)}" data-act="tile" data-a="${ccEsc(a)}" data-s="${s}"><div class="where">${ccEsc(where)}</div>${handEl(a, cs, o.hcls)}<div class="t-face">${ccFace(a, g.kind)}</div><div class="t-body"><div class="t-name">${ccEsc(g.name)}${g.where === 'mac' ? CC_KG.claude : CC_KG[g.kind]}</div><div class="t-cap${hit ? ' cap-in' : ''}">${cs.length ? capHTML(a, cs) : ccEsc(g.lane)}</div><div class="t-st">${stLine(a, cs, Boolean(rm))}</div>${folds(a, cs, o.max)}</div></div>`
  }
  const hostTile = cls => {
    const b = M.box, lm = b.models
    return `<div class="tile host${cls || ''}" data-s="host"><div class="h-hd"><span class="h-name">the box</span><span class="tag">host</span><span class="ok${b.error ? ' c-failed' : ''}">${ccEsc(b.error ? 'could not sample: ' + b.error : b.checks)} · up ${b.uptimeDays} d</span></div>
<div class="h-grid"><div><div class="h-sub">GPU · ${ccEsc(b.gpu)}</div><div class="gpu"><span class="big">${b.gpuPct}<small>%</small></span><span class="h-l">${b.tempC} °C · ${b.cores} cores<br>load <span class="mono">${b.load.join(' ')}</span></span></div><div class="bar"><i style="width:${b.memPct.toFixed(1)}%"></i></div><div class="h-l"><span class="mono">${b.memUsed}</span> of <span class="mono">${b.memTotal} GB</span> used · <span class="mono">${b.memFree}</span> free</div><div class="h-l">loaded: ${lm.length ? lm.map(m => `<span class="mono">${ccEsc(m.id)}</span>`).join(' + ') : '<span class="dim">no model in memory</span>'}</div></div>
<div><div class="h-sub">last night · never folds</div>${b.nightly.length ? b.nightly.map(f => `<div class="fl"><span class="mono">${ccEsc(f.t)}</span><span class="${f.state === 'failed' ? 'c-failed' : 'dim'}">${ccEsc(f.state)}</span> · ${ccEsc(f.job)}${f.n > 1 ? ' ×' + f.n : ''}${f.why ? ' <span class="dim">— ' + ccEsc(f.why) + '</span>' : ''}</div>`).join('') : '<div class="fl dim">nothing failed or blocked last night</div>'}</div></div>
<div class="h-sub" style="margin:9px 0 3px">timers · ${b.timers.length} <span class="tmr" style="letter-spacing:0;text-transform:none;font-family:var(--sans)">${b.timers.map(x => `${ccEsc(x.id)} <span class="dim">${ccEsc(x.every)}</span>`).join('<i>·</i>')}</span></div></div>`
  }
  const youTile = rm => { const n = roomNeeds(rm); return `<div class="tile you" data-s="you"><div class="where">you · in every room</div><div class="t-face">${CC_YOU}</div><div class="t-body"><div class="t-name">you</div><div class="t-cap">the one who answers: your word, one card at a time</div><div class="t-st"><span class="sl nd">${n ? n + ' question' + (n > 1 ? 's' : '') + ' here wait on you' : 'nothing here waits on you'}</span></div></div></div>` }
  const speakerV = id => {
    const sp = speaking()
    const minis = OWN.map(a => `<div class="mini${a === sp ? ' speaking' : ''}${a === id ? ' sel' : ''}" style="--h:${ccHue(a)}" data-act="tile" data-a="${ccEsc(a)}">${handEl(a, cardsOf(a), ' sm ab')}${F(a, 40)}<b>${ccEsc(AG[a].name)}</b></div>`).join('')
    const host = `<div class="mini hostm"><span class="big">${M.box.gpuPct}%</span>GPU · the box<span>${M.box.memUsed}/${M.box.memTotal} GB</span></div>`
    return `<div class="spk"><div class="strip">${minis}${host}</div>${AG[id] ? tile(id, { cls: ' bigt', max: 3 }) : ''}</div>`
  }
  const stage = () => {
    if (route.v === 'battlefield') return bf()
    if (route.v === 'room') { const rm = ROOM[route.id]; return `<div class="grid ${rm.agents.length + 1 <= 4 ? 'g2' : 'g3'}">${rm.agents.map(a => tile(a, { room: rm })).join('')}${youTile(rm)}</div>` }
    if (route.v === 'chat') return speakerV(route.id)
    if (CS.view === 'speaker') return speakerV(speaking() || OWN[0])
    return `<div class="grid g5">${OWN.map(a => tile(a)).join('')}${hostTile(' span2')}</div>`
  }

  /* the tray */
  const isPromote = c => /^promote/.test(c.id)
  const wLine = () => '<div class="wpv"><span>the preview opens in the preview rail — behind your Vercel login</span></div>'
  const silence = c => {
    const [word] = String(c.default || '').split(/\s+[—–-]\s+/)
    const t3 = c.tier === 3 || !word
    return `If you don't answer: <b>${t3 ? 'it waits for your word' : ccT(c.default)}</b>${t3 ? '' : ' <span class="dim">(its default)</span>'} · ${c.expired ? `<b>${t3 ? 'wanted by' : 'expired'} ${ccEsc(c.expiry)}, still open</b>` : `${t3 ? 'wanted by' : 'expires'} <span class="mono">${ccEsc(c.expiry || '—')}</span>`}`
  }
  const tray = () => {
    const n = need()
    if (CS.left) return `<div class="tr-zero"><span class="hand-off">${CC_HAND}</span><div><div class="tz-t">You left the call</div><div class="tz-s">You closed the view; the page starts and stops nothing, and owners work to their brief’s budget. Your words wait in the queue for each owner’s next pass. <b class="cnt">${NEED()}</b>; unanswered, a tier-3 card stays open (silence changes nothing).</div></div><button class="confirm" data-act="rejoin">Rejoin the call</button></div>`
    if (!Q.length) return `<div class="tr-zero"><span class="hand-off">${CC_HAND}</span><div><div class="tz-t">no hands up</div><div class="tz-s">${M.cards.filter(c => c.parked).length} parked · ${M.doneCards.length} done today${M.derived ? ' · ' + M.derived + ' derived item(s) wait on Today' : ''} — leaving only closes the view; answers wait in the queue for each owner’s next pass.</div></div><button class="cbtn leave" data-act="sheet" data-s="leave">${CC_IC.leave}Leave the call</button></div>`
    const id = CS.focus, c = CARD[id], a = AG[c.owner] || { name: c.owner, kind: 'claude' }
    if (route.v === 'battlefield' && !CS.trayOpen) return `<div class="tr-mini">${pill()}<span class="nx">next: <b>${ccT(c.title)}</b> · ${ccEsc(a.name)}</span><button class="cbtn" data-act="tray">Answer here <kbd>↵</kbd></button></div>`
    const os = c.options, b = BATCH[id], bq = Q.filter(x => BATCH[x] === b), qi = bq.indexOf(id) + 1, hit = CS.fx && CS.fx.c
    let h = `<div class="tr-q">${F(c.owner, 44)}<div class="tr-m"><div class="tr-meta"><b>${ccEsc(a.name)}</b><span>· ${onWhere(c.owner)} · ${CC_KIND[a.where === 'mac' ? 'claude' : a.kind] || ''}</span><span>· p${c.p} · ${ccEsc(c.kind)}${c.tier === 3 ? ' · tier 3' : ''}</span><span class="tr-pos">· ${qi} of ${bq.length} · batch ${b + 1} of ${NB}</span></div>
<div class="tr-title${hit ? ' cap-in' : ''}" title="${ccEsc(c.full || c.title)}">${ccT(c.title)}</div><div class="tr-ask">${ccT(c.ask)}</div>
${!c.shipped && !(AG[c.owner] && AG[c.owner].pane) ? '<div class="tr-lint">no agent for this seat yet — the card waits on its owner being built</div>' : ''}<div class="tr-def">${silence(c)}</div>${isPromote(c) ? wLine() : ''}</div></div>`
    h += `<div class="tr-a">${os.length ? `<div class="picks">${os.map((w, i) => `<button class="pk${CS.pick === i ? ' on' : ''}" data-act="pick" data-i="${i}"><kbd>${i + 1}</kbd>${ccEsc(w)}</button>`).join('')}</div>` : `<div class="tr-lint">${c.plain ? 'No options yet — nothing can answer this card; the chair adds them.' : 'This card’s id is not a plain id — answer it with decide in a terminal.'}</div>`}`
    const word = CS.pick != null ? pw(c, CS.pick) : null
    if (word) h += `<div class="echo">“${ccT(c.title)}” → <b>${ccEsc(word)}</b> — ${word === 'later' ? 'parks it until tomorrow; it stays open' : 'answers it and closes the card'} · press <kbd>${CS.pick === -1 ? 'L' : CS.pick + 1}</kbd> again or <kbd>↵</kbd> to copy its decide line</div>`
    if (c.kind === 'PASTE') h += `<div class="never">${CC_IC.lock}<span>${ccEsc(NEVER)}</span></div>`
    if (c.plain) h += `<div class="latr"><button class="lat${CS.pick === -1 ? ' on' : ''}" data-act="later">later</button><span>parks the card until tomorrow — it stays open; its owner takes the next</span></div>`
    const line = word ? 'decide ' + c.id + ' ' + word : null
    const offer = answerOn && M.answer ? (M.answer.offers || {})[c.id] || null : null
    const sst = CS.sent[c.id] && CS.sent[c.id].word === word ? CS.sent[c.id] : null
    const canSend = Boolean(word && offer && offer.tokens && offer.tokens[word])
    const armed = Boolean(sst && sst.state === 'confirm')
    h += `<div class="conf"><button class="confirm" data-act="confirm"${line ? '' : ' disabled'}>${line && CS.copied[c.id] === word ? 'Copied' : 'Copy'} <kbd>↵</kbd></button>`
    if (canSend) h += `<button class="send${armed ? ' arm' : ''}" data-act="send"${sst && sst.state === 'sending' ? ' disabled' : ''} title="${armed ? 'Tier 3: this second click sends the word' : 'Sends this one word for this one card'}">${sst && sst.state === 'sending' ? 'Sending…' : armed ? 'Confirm “' + ccEsc(word) + '”' : 'Send “' + ccEsc(word) + '”'}</button>`
    h += `<span class="ow">${line ? `<span class="mono dl">${ccEsc(line)}</span> — paste it in a terminal${canSend ? ', or Send records it from here' : ''}` : 'pick a word — ↵ copies its decide line' + (answerOn ? '; Send records it from here' : '; this page writes nothing')}</span>`
    if (sst && sst.state !== 'sending') h += `<div class="sent${sst.state === 'bad' ? ' bad' : ''}">${armed ? 'Tier 3 — “' + ccT(sst.title || c.title) + '” → <b>' + ccEsc(word) + '</b>. Click Confirm to send it; nothing is written until you do.' : ccEsc(sst.msg || '')}</div>`
    h += '</div></div>'
    const pips = bq.map(x => `<i class="pip${x === id ? ' cur' : st(x) !== 'needs' ? ' p-' + st(x) : ''}" data-act="jump" data-id="${ccEsc(x)}"></i>`).join('')
    const behind = []; for (let k = b + 1; k < NB; k++) behind.push(Q.filter(x => BATCH[x] === k).length + ' in batch ' + (k + 1))
    h += `<div class="tb"><div class="tb-h">question ${qi} of ${bq.length} · batch ${b + 1} of ${NB}</div><div class="pips">${pips}</div><div class="tb-l">${behind.length ? 'queued behind it: ' + behind.join(' · ') : 'the last batch — nothing queued behind it'}</div><div class="tb-l dim2">nothing opens on its own: the next batch waits for your click</div><div class="navs">${b > 0 ? '<button class="cbtn" data-act="batch" data-b="' + (b - 1) + '">Back five</button>' : ''}${b < NB - 1 ? '<button class="cbtn" data-act="batch" data-b="' + (b + 1) + '">Next five</button>' : ''}</div><div class="tb-k">${os.length > 1 ? `<kbd>1</kbd>–<kbd>${Math.min(9, os.length)}</kbd>` : '<kbd>1</kbd>'} pick · <kbd>L</kbd> later · <kbd>↵</kbd> copy the decide line · <kbd>esc</kbd> back</div></div>`
    if (route.v === 'battlefield') h += `<button class="x trx" data-act="tray" title="collapse">${CC_IC.x}</button>`
    return h
  }

  /* chats: lines composed only from card + agent fields */
  const bubble = (a, body, o) => { o = o || {}; return `<div class="m">${F(a, 26)}<div class="bub${o.ask ? ' ask' : ''}">${o.who ? `<div class="who">${ccEsc(nameOf(a))}</div>` : ''}${body}</div></div>` }
  const mine = (w, txt) => `<div class="m me"><div class="bub"><b>${ccEsc(w)}</b>${txt ? ' — ' + ccEsc(txt) : ''}</div></div>`
  const decCard = c => `<div class="qc"><span class="badge">needs you</span><div class="qpk"><span class="qw">${c.options.map(w => ccEsc(w)).join(' · ')}</span><button class="pk sm" data-act="totray" data-id="${ccEsc(c.id)}">answer in the tray →</button></div>${c.kind === 'PASTE' ? `<span class="thr">${CC_IC.lock.replace('class="gl"', 'class="gl" style="width:12px;height:12px;vertical-align:-2px"')} ${ccEsc(NEVER)}</span>` : ''}</div>`
  const cardThread = (c, room) => {
    const s = st(c.id), a = c.owner
    let h = ''
    if (c.open) {
      const def = `<span class="def">${silence(c)}</span>`
      h += bubble(a, `${room ? '<span class="at">@you</span> ' : ''}<b>${ccT(c.title)}</b><br>${ccT(c.ask)}${c.why ? `<span class="why">${ccT(c.why)}</span>` : ''}${def}${isPromote(c) ? wLine() : ''}${s === 'needs' ? decCard(c) : ''}`, { ask: s === 'needs', who: room })
    }
    if (s === 'parked') { const nx = topQ(a); h += bubble(a, `parked — ${ccEsc(c.parked)} — ${nx ? 'took next: <b>' + ccT(nx.title) + '</b>' : 'proposing next'}`, { who: room }) }
    if (s === 'done') { h += mine(String(c.how || '').replace(/^“([^”]*)”.*$/, '$1') || 'done', ''); h += bubble(a, `done — <b>${ccT(c.title)}</b>${c.how ? ' · ' + ccEsc(c.how) : ''}`, { who: room }) }
    return h
  }
  const chatPanel = id => {
    const g = AG[id], cs = cardsOf(id), bot = g.kind === 'hermes' || g.seat
    let h = `<div class="ph">${F(id, 36)}<div class="ph-t"><b>${ccEsc(g.name)}${g.where === 'mac' ? CC_KG.claude : CC_KG[g.kind]}</b><small>${g.seat ? 'Bot Chat · ' + ccEsc(g.display || g.name) + (g.pane ? ' · pane ' + ccEsc(g.pane.where || '') : '') : bot ? 'Bot Chat · ' + ccEsc(g.lane) : 'forever chat · ' + ccEsc(whereOf(id))}</small></div><button class="x" data-act="go" data-h="/live" title="back to the call">${CC_IC.x}</button></div>`
    h += `<div class="msgs"><div class="day">today · sampled ${ccEsc(M.sampled)}</div>`
    h += `<div class="sys"><b>${ccEsc(g.name)}</b> · ${g.seat ? 'owner seat — a Hermes Bot on the box' + (g.pane ? ', and a Claude Code pane on the Mac' : ', no pane on the Mac yet') : CC_KIND[g.kind] + ' on ' + onWhere(id)} · ${ccEsc(g.lane)}${g.timer ? '<br>cadence ' + ccEsc(ccEvery(g.timer.every)) : ''}</div>`
    const nf = M.box.nightly.filter(x => x.agent === id)
    if (nf.length) h += `<div class="sys">last night, in the 03:30 queue:<br>${nf.map(x => `<span class="mono">${ccEsc(x.t)}</span> <span class="${x.state === 'failed' ? 'c-failed' : ''}">${ccEsc(x.state)}</span> · ${ccEsc(x.job)}${x.why ? ' — ' + ccEsc(x.why) : ''}`).join('<br>')}</div>`
    if (!cs.length) h += `<div class="sys">no card — ${ccEsc(g.name)} owns none of today’s ${M.cards.length}</div>`
    cs.forEach(c => { h += cardThread(c, false) })
    M.proposals.filter(p => p.owner === id).forEach(p => { h += bubble(id, `<span class="lbl">proposal · not a question · never applied by silence</span><b>${ccEsc(p.title)}</b>${p.why ? `<span class="why">${ccEsc(p.why)}</span>` : ''}`) })
    h += `</div><div class="comp"><button class="in" data-act="openbot" data-p="${ccEsc(id)}" title="Opens ${ccEsc(g.name)}’s own chat">Message ${ccEsc(g.name)}</button></div><div class="ow2">Answers are words in the tray only — whatever is typed in a Bot chat is stored in that session and sent to its model</div>`
    return h
  }
  const roomPanel = id => {
    const rm = ROOM[id], cs = roomCards(rm), k = { seat: 0, claude: 0, hermes: 0, timer: 0 }
    rm.agents.forEach(a => { k[AG[a].seat ? 'seat' : AG[a].kind]++ })
    let h = `<div class="ph"><span class="stack">${rm.agents.map(a => F(a, 24)).join('')}</span><div class="ph-t"><b>${ccEsc(rm.name)}</b><small>${rm.agents.length} members + you · ${cs.length} cards</small></div><button class="x" data-act="go" data-h="/live" title="back to the call">${CC_IC.x}</button></div>`
    const parts = [k.seat ? k.seat + ' Hermes Bot' + (k.seat > 1 ? 's' : '') + ' — native, in this Group Chat' : '', k.claude ? k.claude + ' Claude Code — join' + (k.claude > 1 ? '' : 's') + ' only after the 1 Oct shim' : '', k.timer ? k.timer + ' timer' + (k.timer > 1 ? 's' : '') + ' — not a Bot' : ''].filter(Boolean)
    h += `<div class="cons"><span>The room is the box gateway’s Group Chat. Here: ${parts.join(' · ') || 'no member yet'}. A seat’s Claude Code pane joins after the 1 Oct shim.</span></div>`
    h += `<div class="msgs"><div class="day">today · sampled ${ccEsc(M.sampled)}</div><details class="act"><summary>Activity · ${rm.agents.length} members and you joined</summary>${rm.agents.map(a => `<div>${ccEsc(nameOf(a))} — ${ccEsc(AG[a].lane)}</div>`).join('')}</details>`
    cs.forEach(c => { h += cardThread(c, true) })
    if (!cs.length) h += '<div class="sys">no card in this room today</div>'
    h += `</div><div class="comp"><button class="in" data-act="openroom" data-g="${ccEsc(rm.name)}" title="Opens the room’s own Group Chat">Reply in thread</button></div><div class="ow2">Answers are words in the tray only — whatever is typed in a Bot chat is stored in that session and sent to its model</div>`
    return h
  }

  /* battlefield: everyone at once */
  const cell = a => {
    const g = AG[a], s = agentState(a) || '', n = hands(a)
    const lab = s ? LBL[s] : ccEsc(g.state === 'away' ? 'not in a pane' : g.state) + (g.seat ? '' : ' · no card')
    return `<button class="evr" style="--h:${ccHue(a)}" data-act="go" data-h="/live?chat=${encodeURIComponent(a)}">${F(a, 34)}<span class="rw"><b>${ccEsc(g.name)}${g.where === 'mac' ? CC_KG.claude : CC_KG[g.kind]}</b><small><span class="${s && s !== 'needs' ? 'c-' + s : ''}">${lab}</span></small></span>${n ? `<span class="hand sm">${CC_HAND}${n}</span>` : ''}</button>`
  }
  const bf = () => {
    const n = need(), k = s => M.cards.concat(M.doneCards).filter(c => st(c.id) === s).length
    const fa = Object.values(AG).filter(a => a.state === 'failed').length
    const all = Object.values(AG)
    const mac = all.filter(a => a.where === 'mac'), box = all.filter(a => a.where !== 'mac')
    const working = all.filter(a => a.state === 'working').length
    let L = `<div class="cardx bf-top"><div class="bf-n"><b class="${tk().trim()}">${n}</b>need you</div><div class="tal"><div><b>${working}</b><i class="dot c-working"></i>working</div><div><b>${k('parked')}</b><i class="dot pk-d"></i>parked</div><div><b>${k('done')}</b><i class="dot c-done"></i>done</div><div><b>${fa}</b><i class="dot c-failed"></i>failed · the nightly</div></div><div class="bf-w">the one who answers: you, one card at a time<br><span class="dim">${Q.length} questions in ${NB} batches · proposals sit apart — not questions</span></div></div>`
    L += `<div class="sh2">the Mac <span>${mac.length} Claude Code session${mac.length === 1 ? '' : 's'}</span></div><div class="ev">${mac.map(a => cell(a.id)).join('') || '<span class="dim">no pane on the Mac</span>'}</div>`
    L += `<div class="sh2">the box <span>${box.filter(a => a.kind === 'hermes').length} Hermes Bots · ${box.filter(a => a.kind === 'timer').length} timers</span></div><div class="ev">${box.map(a => cell(a.id)).join('')}</div>`
    L += `<div class="sh2">rooms <span>a room shows its worst member state</span></div><div class="rooms">${M.rooms.map(rm => { const cs = roomCards(rm), ws = roomState(rm), q = roomNeeds(rm); return `<button class="cl" data-act="go" data-h="/live?room=${encodeURIComponent(rm.id)}"><div class="cl-h"><span class="stack">${rm.agents.map(a => F(a, 22)).join('')}</span>${q ? `<span class="hand sm">${CC_HAND}${q}</span>` : ''}</div><b>${ccEsc(rm.name)}</b><div class="segbar">${cs.map(c => `<i class="p-${st(c.id)}"></i>`).join('')}</div><small><span class="${ws && ws !== 'needs' ? 'c-' + ws : ''}">${ccEsc(LBL[ws] || ws || 'quiet')}</span> · worst of ${rm.agents.length} members · ${cs.length} cards</small></button>` }).join('')}</div>`
    const b = M.box
    let R = `<div class="cardx"><div class="ch"><h4>the box</h4></div><div class="bxg"><div><b>${b.gpuPct} %</b>GPU · ${ccEsc(b.gpu)}</div><div><b>${b.memUsed}/${b.memTotal}</b>GB used · ${b.memFree} free</div><div><b>${b.tempC} °C</b>${b.cores} cores · load ${b.load[0]}</div><div><b>${b.diskPct} %</b>disk · up ${b.uptimeDays} d</div></div><div class="li2">loaded: ${b.models.length ? b.models.map(m => `<span class="mono">${ccEsc(m.id)}</span> ${m.gb} GB`).join(' · ') : 'no model in memory'}</div><div class="li2 dim">${b.onDisk != null ? Math.max(0, b.onDisk - b.models.length) + ' more models on disk · ' : ''}Hermes ${ccEsc(b.hermes.version || '—')}${b.hermes.skills ? ' · ' + b.hermes.skills + ' skills' : ''} · ${ccEsc(b.checks)}</div></div>`
    R += `<div class="cardx"><div class="ch"><h4><i class="dot c-failed" style="margin-right:6px"></i>failed · never folds</h4></div>${b.nightly.length ? b.nightly.map(x => `<div class="li"><span class="mono dim">${ccEsc(x.t)}</span><span class="${x.state === 'failed' ? 'c-failed' : 'dim'}">${ccEsc(x.state)}</span><span>${ccEsc(x.job)}${x.n > 1 ? ' ×' + x.n : ''}${x.why ? ' — ' + ccEsc(x.why) : ''}</span></div>`).join('') : '<div class="li"><span class="dim">nothing failed last night</span></div>'}</div>`
    R += `<div class="cardx"><div class="ch"><h4>proposals</h4><span class="dim" style="font-size:11.5px;white-space:nowrap">not questions · no count</span></div><div class="dim" style="font-size:11.5px;margin:-2px 0 8px">never applied by silence</div>${M.proposals.length ? M.proposals.map(p => `<div class="li" data-act="sheet" data-s="props" style="cursor:pointer">${F(p.owner, 18)}<span>${ccEsc(p.title)}</span></div>`).join('') : '<div class="li"><span class="dim">no proposal yet — owners write one per pass report</span></div>'}</div>`
    return `<div class="bf"><div class="bf-l">${L}</div><div class="bf-r">${R}</div></div>`
  }

  /* popovers */
  const pops = () => {
    if (!CS.pop) return ''
    let w = 340, h = ''
    if (CS.pop === 'rooms') {
      h = `<div class="pop-h">Breakout rooms</div>${M.rooms.map(rm => { const q = roomNeeds(rm); return `<div class="prow" data-act="go" data-h="/live?room=${encodeURIComponent(rm.id)}"><span class="stack">${rm.agents.map(a => F(a, 22)).join('')}</span><span class="rw"><b>${ccEsc(rm.name)}</b><small>${rm.agents.length} members + you · ${rm.cards.length} cards</small></span>${q ? `<span class="hand sm">${CC_HAND}${q}</span>` : ''}</div>` }).join('') || '<div class="pop-n">No room on the box gateway yet.</div>'}<div class="pop-f">Each room is a Group Chat on the box gateway: its Hermes Bots are native members. A seat’s Claude Code pane joins after the 1 Oct shim; timers are not Bots.</div>`
    }
    const vw = window.innerWidth, vh = window.innerHeight
    w = Math.min(w, vw - 16)
    const el = document.querySelector(`.ccs [data-act="pop"][data-p="${CS.pop}"]`), rc = el && el.getBoundingClientRect()
    const sty = rc && rc.width ? `left:${Math.max(8, Math.min(rc.right - w, vw - w - 8))}px;top:${Math.round(rc.bottom + 8)}px` : `left:${Math.round((vw - w) / 2)}px;top:64px`
    void vh
    return `<div class="pop-bg" data-act="close"></div><div class="pop" style="width:${w}px;${sty}">${h}</div>`
  }
  /* sheets */
  const ov = () => {
    if (!CS.sheet) return ''
    let h = ''
    const X = `<button class="x" data-act="close" title="close">${CC_IC.x}</button>`
    const b = M.box
    if (CS.sheet === 'leave') {
      const Pk = M.cards.filter(c => c.parked), N = Q.map(id => CARD[id])
      const Wk = Object.values(AG).filter(a => a.state === 'working')
      h = `<div class="sh-h"><div><div class="eyebrow">Leave the call</div><h2>Leaving closes the view</h2><p class="lead">The page starts and stops nothing: owners work to their brief’s budget (60 min or 6 cards). Your words wait in the queue for each owner’s next pass. On a tier-3 card silence changes nothing: it stays open until you answer. Leaving writes nothing.</p></div>${X}</div><div class="lv">
<section><h3>the box’s timers · ${b.timers.length} — own schedule, they read no answers</h3>${b.timers.map(x => `<div class="lr"><span>${ccEsc(x.every)}</span><span>${ccEsc(x.id)}</span>${x.next ? `<small>next ${ccEsc(ccHM(x.next))}</small>` : ''}</div>`).join('')}</section>
<section><h3>the 03:30 nightly · failures never fold</h3>${b.nightly.length ? b.nightly.map(x => `<div class="lr"><span>${ccEsc(x.t)}</span><span><span class="${x.state === 'failed' ? 'c-failed' : 'dim'}">${ccEsc(x.state)}</span> · ${ccEsc(x.job)}</span>${x.why ? `<small>${ccEsc(x.why)}</small>` : ''}</div>`).join('') : '<div class="lr"><span>—</span><span class="dim">nothing failed last night</span></div>'}
<h3 style="margin-top:16px">working · ${Wk.length} — panes keep their own budget</h3>${Wk.length ? Wk.map(a => `<div class="lr"><span>${ccEsc(a.name)}</span><span>${ccEsc(a.herdr || a.lane)}</span></div>`).join('') : '<div class="lr"><span>—</span><span class="dim">nothing yet — an answer waits in its owner’s queue for the next session</span></div>'}</section>
<section><h3>parked · ${Pk.length}</h3>${Pk.map(c => `<div class="lr"><span>${ccEsc(nameOf(c.owner))}</span><span>${ccT(c.title)}</span><small>${ccEsc(c.parked)}</small></div>`).join('') || '<div class="lr"><span>—</span><span class="dim">none</span></div>'}</section>
<section><h3>proposals · ${M.proposals.length} — not questions · never applied by silence</h3>${M.proposals.map(p => `<div class="lr"><span>${ccEsc(nameOf(p.owner))}</span><span>${ccEsc(p.title)}</span></div>`).join('') || '<div class="lr"><span>—</span><span class="dim">none yet</span></div>'}</section>
<section class="wide"><h3><b>${NEED()}</b> — unanswered, a tier-3 card stays open · what stays true if you don’t answer</h3><div class="cols2">${N.map(c => `<div class="lr"><span>${ccEsc(c.expiry || '—')}</span><span>${ccT(c.title)}</span><small>→ ${c.tier === 3 ? 'it waits for your word' : ccT(c.default)}</small></div>`).join('')}</div></section>
</div><div class="sh-f"><span class="ow">your word is the only answer — leaving writes nothing</span><button class="cbtn" data-act="close">Stay on the call</button><button class="confirm" data-act="leave-go">Leave the call</button></div>`
    } else if (CS.sheet === 'props') {
      h = `<div class="sh-h"><div><div class="eyebrow">Proposals</div><h2>Not questions</h2><p class="lead">The owners’ own ideas, one per pass report: not questions · no count · never applied by silence. They sit apart from the queue and never raise a hand.</p></div>${X}</div><div class="pl">${M.proposals.length ? M.proposals.map(p => `<div class="pi">${F(p.owner, 34)}<div><b>${ccEsc(p.title)}</b>${p.why ? `<p>${ccEsc(p.why)}</p>` : ''}<small>${ccEsc(nameOf(p.owner))}${p.about ? ' · ' + ccEsc(p.about) : ''}${p.date ? ' · ' + ccEsc(p.date) : ''}</small></div></div>`).join('') : '<div class="pi"><div><b>No proposal yet</b><p>An owner writes one “Next best action” line per pass report; they land here.</p></div></div>'}</div><div class="sh-f"><span class="ow">no count, no badge</span><button class="cbtn" data-act="close">Close</button></div>`
    }
    return `<div class="ov-bg" data-act="ovbg"><div class="sheet" role="dialog">${h}</div></div>`
  }

  let stale = ''
  const panel = route.v === 'chat' && AG[route.id] ? chatPanel(route.id) : route.v === 'room' && ROOM[route.id] ? roomPanel(route.id) : ''
  const html = `${stale}<div class="cc-main"><div class="cc-cb">${cbar()}</div><section class="cc-stage${CS.left || !Q.length ? ' quiet' : ''}">${stage()}</section><aside class="cc-panel${route.v === 'room' ? ' wide' : ''}">${panel}</aside><footer class="cc-tray">${tray()}</footer></div><div class="cc-pops">${pops()}</div><div class="cc-ov">${ov()}</div>`
  return { html, title: viewName(), need: need(), Q, CARD, BATCH, NB, nextFocus, pw, topQ, roomCards, ROOM, AG, st, isN, openBatch }
}
const BATCH_N = BATCH

/* ---- chrome shared with the titlebar and status bar ------------------- */
const ccChrome = { title: 'Live', path: '', listeners: new Set() }
function ccSetChrome(p) {
  if (ccChrome.title === p.title && ccChrome.path === p.path) return
  Object.assign(ccChrome, p)
  ccChrome.listeners.forEach(l => { try { l() } catch { /* isolated */ } })
}
const ccOurs = path => path === '/live' || path === '/battlefield'
const ccOpen = detail => { try { window.dispatchEvent(new CustomEvent('hermes:lucky-open', { detail })) } catch { /* older Desktop: no bridge */ } }

function makeCStage(bfRoute) {
  return function CStage() {
    const s = useToday(true)
    const ov = useOverview(s.tickKey)
    const loc = useCcLoc()
    const [, setVer] = useState(0)
    const [el, setEl] = useState(null)
    const height = useFitHeight(el)
    const rer = () => setVer(v => v + 1)
    useEffect(() => { injectCC() }, [])

    const P = loc.params
    const route = bfRoute ? { v: 'battlefield' } : P.get('chat') ? { v: 'chat', id: P.get('chat') } : P.get('room') ? { v: 'room', id: P.get('room') } : { v: 'live' }
    const data = s.data
    const M = data ? ccModel(data, ov) : null
    if (M) {
      if (route.v === 'chat' && !M.AG[route.id]) route.v = 'live'
      if (route.v === 'room' && !M.rooms.some(r => r.id === route.id)) route.v = 'live'
    }
    // one-shot UI state from the deep link, applied when the location changes
    const lk = loc.path + '?' + P.toString()
    if (CS.applied !== lk) {
      CS.applied = lk
      CS.pop = P.get('pop') || null
      CS.sheet = P.get('sheet') || null
      if (P.get('left') === '1') CS.left = true
      if (P.get('view') === 'speaker' || P.get('view') === 'gallery') CS.view = P.get('view')
      CS.trayOpen = P.get('tray') === '1'
      CS.pick = null
      CS.focus = CS.want || null
      CS.want = null
      if (P.get('pick')) CS.pickWant = Number(P.get('pick')) - 1
    }
    // receipts: a card that left the queue since the last sample lowers its hand
    if (M) {
      const open = new Set(M.cards.filter(c => !c.parked).map(c => c.id))
      if (CS.prevOpen) {
        CS.prevOpen.forEach(id => {
          if (open.has(id)) return
          const d = M.doneCards.find(c => c.id === id), p = M.cards.find(c => c.id === id && c.parked)
          const c = d || p
          if (c) { CS.lastBy[c.owner] = { k: d ? 'done' : 'parked', c: id }; CS.fx = { a: c.owner, c: id }; CS.last = c.owner }
        })
      }
      CS.prevOpen = open
      if (route.v === 'chat') M.doneCards.filter(c => c.owner === route.id).forEach(c => { CS.seen[c.id] = true })
    }
    if (ANSWER_ON_PAGE && M && M.answer && M.answer.enabled) probePageKey()
    const answerOn = Boolean(ANSWER_ON_PAGE && M && M.answer && M.answer.enabled && pageKey === 'match')
    const R = M ? ccRender(M, route, answerOn) : null
    if (R && CS.pickWant != null) { const c = R.CARD[CS.focus]; if (c && CS.pickWant < c.options.length) CS.pick = CS.pickWant; CS.pickWant = null }
    const R2 = R && CS.pick != null ? ccRender(M, route, answerOn) : R // the pick changes the tray's echo
    const html = !data ? `<div class="cc-msg">${s.err ? 'Could not sample: ' + ccEsc(s.err) : 'Sampling the box…'}</div>`
      : (s.err ? `<div class="cc-stale" role="alert">STALE — the last refresh failed ${ccEsc(ago(new Date(s.errAt).toISOString()))}; everything below was sampled ${ccEsc(ago(new Date(s.lastOkAt).toISOString()))}.<small>${ccEsc(s.err)}</small></div>` : '') + R2.html
    ccSetChrome({ title: R2 ? R2.title : bfRoute ? 'Battlefield' : 'Live', path: loc.path })

    // the stage's own DOM: set, keep the panel's scroll, place a popover under its button
    React.useLayoutEffect(() => {
      if (!el) return
      const m0 = el.querySelector('.cc-panel .msgs')
      const pk = route.v + '/' + (route.id || '')
      const keepTop = m0 && CS.pk === pk ? m0.scrollTop : null
      el.innerHTML = html
      el.dataset.r = route.v
      const m1 = el.querySelector('.cc-panel .msgs')
      if (m1) {
        if (keepTop != null) m1.scrollTop = keepTop
        else { const q = m1.querySelector('.bub.ask'); const y = q ? q.parentNode.offsetTop - m1.offsetTop : 0; m1.scrollTop = q ? (y < m1.clientHeight - 170 ? 0 : y - 60) : m1.scrollHeight }
      }
      CS.pk = pk
      const pop = el.querySelector('.pop'), btn = CS.pop && el.querySelector(`[data-act="pop"][data-p="${CS.pop}"]`)
      if (pop && btn) {
        const rc = btn.getBoundingClientRect(), w = pop.offsetWidth, vw = window.innerWidth
        pop.style.left = Math.max(8, Math.min(rc.right - w, vw - w - 8)) + 'px'
        pop.style.top = Math.round(rc.bottom + 8) + 'px'
      }
      CS.fx = null
      CS.last = null
    })

    // clicks
    const R2ref = React.useRef(null); R2ref.current = { R: R2, M, route, answerOn }
    const confirmQ = () => {
      const { R } = R2ref.current || {}
      const id = CS.focus
      if (!R || !id || !R.CARD[id] || R.st(id) !== 'needs' || CS.pick == null) return
      const word = R.pw(R.CARD[id], CS.pick)
      if (!R.CARD[id].plain || !word) return
      copy('decide ' + id + ' ' + word).then(() => { CS.copied[id] = word; rer() }).catch(() => {})
    }
    const doSend = ts => {
      const { R, M: m, answerOn: on } = R2ref.current || {}
      const id = CS.focus
      if (!on || !R || !id || CS.pick == null) return
      const word = R.pw(R.CARD[id], CS.pick)
      const offer = (m.answer.offers || {})[id]
      if (!offer || !offer.tokens || !offer.tokens[word]) return
      const cur = CS.sent[id]
      const body = { id, word, exp: offer.exp, token: offer.tokens[word] }
      if (cur && cur.state === 'confirm' && cur.word === word && cur.confirm) {
        if (ts - cur.at < 400) return
        body.confirm_exp = cur.confirm.exp
        body.confirm = cur.confirm.token
      }
      const req = postAnswer(body)
      if (!req) return
      CS.sent[id] = { word, state: 'sending' }; rer()
      req.then(r => {
        CS.sent[id] = r && r.verdict === 'confirm' && r.confirm
          ? { word, state: 'confirm', confirm: r.confirm, title: r.title, at: ts }
          : { word, state: r && r.ok ? 'ok' : 'bad', msg: r ? r.verdict + (r.detail ? ' — ' + r.detail : '') : 'no reply' }
        rer()
      }).catch(err => { CS.sent[id] = { word, state: 'bad', msg: 'not sent — ' + String(err) }; rer() })
    }
    const onClick = e => {
      const t = e.target.closest && e.target.closest('[data-act]')
      if (!t || !el || !el.contains(t)) return
      const { R, route: rt } = R2ref.current || {}
      const act = t.dataset.act
      switch (act) {
        case 'go': CS.pop = null; CS.sheet = null; navigate(t.dataset.h); break
        case 'tile': { const a = t.dataset.a; if (!(rt.v === 'chat' && rt.id === a)) navigate('/live?chat=' + encodeURIComponent(a)); break }
        case 'hand': {
          if (!R) break
          const a = t.dataset.a
          let q = rt.v === 'room' ? R.roomCards(R.ROOM[rt.id]).find(c => c.owner === a && R.isN(c)) : null
          if (!q) q = R.topQ(a)
          if (q) { if (CS.focus !== q.id) CS.pick = null; CS.focus = q.id; CS.trayOpen = true }
          rer(); break
        }
        case 'pick': { const i = +t.dataset.i; if (CS.pick === i && e.timeStamp - CS.pickAt > 350) { confirmQ(); break } CS.pick = i; CS.pickAt = e.timeStamp; rer(); break }
        case 'later': { if (CS.pick === -1 && e.timeStamp - CS.pickAt > 350) { confirmQ(); break } CS.pick = -1; CS.pickAt = e.timeStamp; rer(); break }
        case 'confirm': confirmQ(); break
        case 'send': doSend(e.timeStamp); break
        case 'jump': CS.focus = t.dataset.id; CS.pick = null; rer(); break
        case 'batch': { if (!R) break; const b = +t.dataset.b; const id = R.Q.find(x => R.BATCH[x] === b); if (id) { CS.focus = id; CS.pick = null } rer(); break }
        case 'totray': CS.want = t.dataset.id; CS.pop = null; CS.sheet = null; navigate('/live'); break
        case 'view': CS.view = t.dataset.v; rer(); break
        case 'pop': { const p = t.dataset.p; CS.pop = CS.pop === p ? null : p; rer(); break }
        case 'close': CS.pop = null; CS.sheet = null; rer(); break
        case 'sheet': CS.sheet = t.dataset.s; CS.pop = null; rer(); break
        case 'ovbg': if (e.target === t) { CS.sheet = null; rer() } break
        case 'leave-go': CS.left = true; CS.sheet = null; rer(); break
        case 'rejoin': CS.left = false; rer(); break
        case 'seen': CS.seen[t.dataset.id] = true; rer(); break
        case 'tray': CS.trayOpen = !CS.trayOpen; rer(); break
        case 'openbot': ccOpen({ profile: t.dataset.p }); break
        case 'openroom': ccOpen({ group: t.dataset.g }); break
        default: break
      }
    }
    // keys: only while this stage is on screen
    const keyRef = React.useRef(null)
    keyRef.current = e => {
      if (!el || !el.isConnected || !el.getClientRects().length) return
      const { R, route: rt } = R2ref.current || {}
      const tg = e.target
      const typing = tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName || '') || tg.isContentEditable)
      if (e.key === 'Escape') {
        if (typing) return
        if (CS.pop) { CS.pop = null; rer(); return }
        if (CS.sheet) { CS.sheet = null; rer(); return }
        if (CS.pick != null) { CS.pick = null; rer(); return }
        if (rt.v === 'battlefield' && CS.trayOpen) { CS.trayOpen = false; rer(); return }
        if (rt.v !== 'live') navigate('/live')
        return
      }
      if (typing || e.repeat || e.metaKey || e.ctrlKey || e.altKey || CS.sheet || CS.left || !R) return
      if (/^[1-9lL]$/.test(e.key)) {
        const id = CS.focus, c = id && R.CARD[id]
        if (!c || R.st(id) !== 'needs' || !c.plain) return
        const i = /l/i.test(e.key) ? -1 : +e.key - 1
        if (i < c.options.length) {
          if (CS.pick === i && (rt.v !== 'battlefield' || CS.trayOpen)) { confirmQ(); e.preventDefault(); return }
          CS.pick = i; CS.pickAt = e.timeStamp
          if (rt.v === 'battlefield') CS.trayOpen = true
          rer(); e.preventDefault()
        }
        return
      }
      if (e.key === 'Enter' && !(tg && tg.tagName === 'BUTTON')) {
        e.preventDefault()
        if (rt.v === 'battlefield' && !CS.trayOpen) { CS.trayOpen = true; rer(); return }
        confirmQ()
      }
    }
    useEffect(() => {
      const on = e => keyRef.current && keyRef.current(e)
      window.addEventListener('keydown', on)
      return () => window.removeEventListener('keydown', on)
    }, [])
    return h('div', { ref: setEl, className: 'ccs cc-page', 'data-r': route.v, onClick, style: height ? { height: height + 'px' } : undefined })
  }
}

/* ---- the sidebar's Fleet + Rooms sections (the Bots tab, core area botsPane.after) ---- */
function CcSide() {
  const s = useToday(false)
  const loc = useCcLoc()
  useEffect(() => { injectCC() }, [])
  const M = s.data ? ccModel(s.data, null) : null
  const P = loc.params
  const need = M ? M.order.filter(id => M.cards.some(c => c.id === id && !c.parked)).length + M.derived : null
  const pill = n => (n === null ? '' : `<span class="need${n ? '' : ' zero'}">${n} need you</span>`)
  const onLive = loc.path === '/live' && !P.get('room')
  const failed = M ? M.box.nightly.filter(x => x.state === 'failed').length : 0
  let html = `<div class="sh"><span>Fleet</span></div>`
  html += `<button class="row${onLive ? ' on' : ''}" data-h="/live">${CC_IC.live}<span class="rw"><b>Live</b></span>${pill(need)}</button>`
  html += `<button class="row${loc.path === '/battlefield' ? ' on' : ''}" data-h="/battlefield">${CC_IC.bf}<span class="rw"><b>Battlefield</b><small${failed ? ' class="c-failed"' : ''}>${M ? Object.keys(M.AG).length + ' agents · ' + M.rooms.length + ' rooms' + (failed ? ' · ' + failed + ' failed last night' : '') : 'sampling…'}</small></span></button>`
  html += `<button class="row" data-h="/live?sheet=props">${CC_IC.prop}<span class="rw"><b>Proposals</b><small>not questions · no count</small></span></button>`
  html += `<div class="sh sub"><span>Rooms</span></div>`
  if (M) {
    const inRoom = rm => M.cards.filter(c => !c.parked && rm.cards.includes(c.id)).length
    html += M.rooms.map(rm => { const k = inRoom(rm); return `<button class="row${loc.path === '/live' && P.get('room') === rm.id ? ' on' : ''}" data-h="/live?room=${encodeURIComponent(rm.id)}"><span class="stack">${rm.agents.slice(0, 3).map(a => `<span class="fc s18">${ccFace(a, M.AG[a] ? M.AG[a].kind : 'hermes')}</span>`).join('')}</span><span class="rw"><b>${ccEsc(rm.name)}</b><small>${rm.agents.length} + you</small></span>${k ? `<span class="rh">${CC_HAND}${k}</span>` : ''}</button>` }).join('') || '<div class="row"><span class="rw"><small>no room on the box gateway</small></span></div>'
  }
  return h('div', {
    className: 'ccs cc-side',
    onClick: e => { const t = e.target.closest && e.target.closest('[data-h]'); if (t) navigate(t.dataset.h) },
    dangerouslySetInnerHTML: { __html: html }
  })
}

/* ---- titlebar: "Hermes · <view>", centred, on the call's routes only ---- */
function useCcChrome() {
  const [, set] = useState(0)
  useEffect(() => { const l = () => set(v => v + 1); ccChrome.listeners.add(l); return () => { ccChrome.listeners.delete(l) } }, [])
  return ccChrome
}
function CcTitle() {
  const loc = useCcLoc()
  const c = useCcChrome()
  useEffect(() => { injectCC() }, [])
  const [el, setEl] = useState(null)
  useCcPin(el, 'center')
  if (!ccOurs(loc.path)) return null
  return h('div', { ref: setEl, className: 'ccs cc-title' }, h('span', null, h('b', null, 'Hermes'), ' · ' + (c.path === loc.path ? c.title : loc.path === '/battlefield' ? 'Battlefield' : 'Live')))
}
/* A titlebar slot sits in a cluster the Desktop moves with a transform, so "fixed" is relative to
 * that cluster, not the window. Pin the element to the window's centre or right edge by measuring. */
function useCcPin(el, where) {
  React.useLayoutEffect(() => {
    if (!el) return undefined
    const place = () => {
      el.style.left = '0px'; el.style.top = '0px'
      const o = el.getBoundingClientRect() // where (0,0) of its containing block lands in the window
      const w = el.offsetWidth
      const x = where === 'center' ? (window.innerWidth - w) / 2 : window.innerWidth - w - 14
      el.style.left = Math.round(x - o.left) + 'px'
      el.style.top = Math.round(-o.top) + 'px'
    }
    place()
    const t = setInterval(place, 1500)
    window.addEventListener('resize', place)
    return () => { clearInterval(t); window.removeEventListener('resize', place) }
  })
}
/* titlebar right: C's pill */
function CcPill() {
  const s = useToday(false)
  useEffect(() => { injectCC() }, [])
  const n = needCount(s.data)
  const label = n === null ? (s.loading ? 'needs you …' : 'needs you ?') : n + ' need you'
  const [el, setEl] = useState(null)
  useCcPin(el, 'right')
  return h('span', { ref: setEl, className: 'ccs cc-pill' },
    h('button', { type: 'button', className: cls('need', !n && 'zero'), onClick: () => navigate('/live'), title: 'Open Live' + (s.err ? ' — this count is STALE' : '') }, label + (s.err && s.data ? ' · stale' : '')))
}
/* status bar left: N need you · batch · the box · checks · GPU; right: sampled */
function CcStatus({ side }) {
  const s = useToday(false)
  useEffect(() => { injectCC() }, [])
  const M = s.data ? ccModel(s.data, null) : null
  if (!M) return null
  if (side === 'right') return h('span', { className: 'ccs cc-sbar' }, 'sampled ' + M.sampled)
  const Q = M.order.filter(id => M.cards.some(c => c.id === id && !c.parked))
  const n = Q.length + M.derived
  const nb = Math.max(1, Math.ceil(Q.length / BATCH))
  return h('span', { className: 'ccs cc-sbar' },
    h('span', { className: n ? 'c-needs' : '' }, h('b', null, n + ' need you')),
    h('span', null, Q.length ? 'batch 1 of ' + nb + ' open' : 'no batch open'),
    h('span', null, 'the box · ' + M.box.checks + ' · GPU ' + M.box.gpuPct + ' %'))
}
/* The app opens to the Stage: once per launch, if the first route is not a page of ours. */
const CStageLive = makeCStage(false)
const CStageBF = makeCStage(true)
function ccBootToStage() {
  if (window.__ccBooted) return
  window.__ccBooted = true
  if (typeof performance !== 'undefined' && performance.now() > 60000) return // a hot reload mid-session: never yank the view
  setTimeout(() => {
    const p = ccLoc().path
    if (!ccOurs(p) && !/^\/(settings|command-center|today|fleet|monitor|call)\b/.test(p)) navigate('/live')
    try { if (SDK.host && typeof SDK.host.revealPane === 'function') SDK.host.revealPane('hermes-bots:pane') } catch { /* no Bots pane */ }
  }, 1200)
}


/* ------------------------------------------------------------------------ */
/* Monitor — B's board with lanes by room (docs/design/2026-09-22-command-    */
/* center/b-board.html; plan C, slice 2: "one glance shows every agent; only  */
/* needs-you makes noise"). A lane per room: its members, each one's state    */
/* (working / idle / blocked / failed) and last activity, and the room's       */
/* needs-you cards. Orange belongs to needs-you alone; every other state is    */
/* ink. Failures stay loud on Today and /live, which this page does not        */
/* replace. READ-ONLY: a chip opens /live, a member's copy button copies its   */
/* attach or status line. Nothing here starts, stops, closes or sends.         */
/*                                                                            */
/* FLAG, ON since 2026-09-27 — the route, the sidebar row and the palette entry */
/* exist only when it is on. Switch it off by setting MONITOR_ON = false (the   */
/* hot reload picks it up), or, without editing the file, run                   */
/*   localStorage.setItem('fleet.monitor', 'on')                               */
/* in the Desktop's devtools and reload the plugin. Off again: false / remove. */
/* ------------------------------------------------------------------------ */
const MONITOR_ON = true
function monitorOn() {
  if (MONITOR_ON) return true
  try { return window.localStorage.getItem('fleet.monitor') === 'on' } catch { return false }
}

/* ROOM_STUB: the LAST fallback. The rooms are the box gateway's (hosted Group  */
/* Chats, created 2026-09-27), read live by today_api.py; this fixed owner→room */
/* map is used only when the payload carries no readable rooms block, and the   */
/* page then says "rooms: stub" wherever a lane is drawn.                      */
/* Either way, an id matches a member exactly or as its                       */
/* prefix ("foreman" holds "foreman-verify"); "name@host" counts as "name".      */
/* Anything the map does not name lands in the "No room" lane, never dropped.   */
const ROOM_STUB = [
  { id: 'chair', name: 'The chair', members: ['commander', 'hermes-serve', 'hermes-gateway', 'herdr-server', 'decide-listener', 'needs-you-notify'] },
  { id: 'site', name: 'Site + repo', members: ['panel', 'gatekeeper', 'showcase', 'artifact-return'] },
  { id: 'loop', name: 'The loop', members: ['loop', 'lucky-loop', 'bill-clerk', 'mail-triage', 'nightly', 'nightly-queue'] },
  { id: 'box', name: 'Wake the box', members: ['foreman', 'worker', 'scout', 'propose', 'infra-watch', 'hermes-cron'] },
  { id: 'vault', name: 'The vault', members: ['gardener'] }
]

/* THE SOURCE. today_api.py's `rooms` block, from the same /today sample:        */
/*   { source: 'gateway' | 'rooms.json' | 'none', sampled_at: '<ISO>',          */
/*     rooms: [ { id, name, members: ['<profile id>', …] } ], bots: {id: title} } */
/* 'gateway' is the live hosted-room store (the authority); 'rooms.json' is the   */
/* vault's copy, read only when the gateway could not be; either is used as it    */
/* comes. Names are the box's, never this file's. With no rooms block at all (an  */
/* older backend) or source 'none', the lanes fall back to ROOM_STUB, labelled.   */
function roomSource(data) {
  const rm = data && data.rooms
  if (rm && (rm.source === 'gateway' || rm.source === 'rooms.json') && Array.isArray(rm.rooms)) {
    return { source: rm.source, sampled_at: rm.sampled_at || null, rooms: rm.rooms, error: rm.error || null }
  }
  return { source: 'stub', sampled_at: null, rooms: ROOM_STUB, error: (rm && rm.error) || null }
}

const idOf = s => String(s || '').split('@')[0].trim().split(/\s/)[0]
const matches = (member, id) => id === member || id.startsWith(member + '-')
const PANE_STATE = { working: 'working', active: 'working', blocked: 'blocked', masked: 'blocked', failed: 'failed' }
const RUN_STATE = { failed: 'failed', stopped: 'failed', blocked: 'blocked' }
const STATE_RANK = { idle: 0, working: 1, blocked: 2, failed: 3 }
const later = (a, b) => (!a ? b : !b ? a : Date.parse(b.at) > Date.parse(a.at) ? b : a)

/* THE ADAPTER. Every room fact the page draws comes through here, as one view */
/* model; the member states come from the real sample whatever the room source. */
function getRooms(data, src = roomSource(data)) {
  const ny = (data && data.needs_you) || {}
  const { today, live, parked, derived } = splitNeeds(ny)
  const panes = (data && data.agents_now && data.agents_now.rows) || []
  const runs = (data && data.agents && data.agents.items) || []
  const board = (data && data.board && data.board.items) || []

  // Everyone the sample shows, by id: their state (worst wins) and their latest activity.
  const seen = new Map()
  const see = (rawId, state, act) => {
    const id = idOf(rawId)
    if (!id) return
    const m = seen.get(id) || { id, state: 'idle', last: null, cmd: null, where: null }
    if (STATE_RANK[state] > STATE_RANK[m.state]) m.state = state
    if (act && act.at && !Number.isNaN(Date.parse(act.at))) m.last = later(m.last, act)
    seen.set(id, m)
    return m
  }
  panes.forEach(r => {
    const m = see(r.name, PANE_STATE[r.state] || 'idle',
      { at: r.last_output || r.since, what: (r.host === 'box' ? 'unit ' : 'pane ') + (r.state || '?') })
    if (m) { m.cmd = m.cmd || r.attach || r.status || null; m.where = m.where || (r.host === 'box' ? 'the box' : 'the Mac') }
  })
  const lastRun = new Map()
  runs.forEach(r => { const id = idOf(r.agent); if (id && (!lastRun.has(id) || Date.parse(r.t) > Date.parse(lastRun.get(id).t))) lastRun.set(id, r) })
  lastRun.forEach((r, id) => see(id, lastNight(r.t) ? RUN_STATE[r.status] || 'idle' : 'idle',
    { at: r.t, what: (r.status || 'ran') + ' · ' + String(r.job || '?').slice(0, 60) }))
  board.forEach(r => { if (r.owner) see(r.owner, r.status === 'claimed' ? 'working' : 'idle', { at: r.claimed_at, what: 'board · ' + (r.status || '?') }) })
  live.concat(parked).forEach(i => { if (i.agent) see(i.agent, 'idle', { at: i.since, what: 'filed a card' }) })

  const rooms = (src.rooms || []).map(r => ({ id: r.id, name: r.name, mapped: r.members || [], explicit: new Set(r.cards || []),
    members: [], live: [], parked: [] }))
  const roomsOf = id => rooms.filter(r => r.mapped.some(k => matches(k, id)))
  const none = { id: null, name: 'No room', mapped: [], members: [], live: [], parked: [] }
  seen.forEach(m => {
    const rs = roomsOf(m.id)
    if (rs.length) rs.forEach(r => r.members.push(m))
    else none.members.push(m)
  })
  const place = (i, key) => {
    const r = rooms.find(x => x.explicit.has(i.id)) || (i.agent ? roomsOf(idOf(i.agent))[0] : null) || none
    r[key].push(i)
  }
  live.slice().sort(byQueue).forEach(i => place(i, 'live'))
  parked.forEach(i => place(i, 'parked'))
  const order = (a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || a.id.localeCompare(b.id)
  rooms.concat(none).forEach(r => r.members.sort(order))
  return { source: src.source, srcError: src.error || null, sampled_at: src.sampled_at || (data && data.sampled_at) || null, today,
    rooms, none, derivedN: derived.length, members: [...seen.keys()].sort() }
}

function MemberRow({ m, hue }) {
  return h('div', { className: 'mn-mem', title: m.id + ' — ' + m.state + (m.where ? ' · ' + m.where : '') },
    h('div', { className: 'mn-face' }, h(Face, { id: m.id, hue })),
    h('span', { className: 'mn-mn' }, m.id),
    m.cmd ? h('button', { type: 'button', className: 'mn-cp', title: 'Copy: ' + m.cmd, onClick: () => copy(m.cmd) }, 'copy') : h('span'),
    h('span', { className: 'mn-ml' },
      h('span', { className: 'mn-st' }, h('i', { className: 'mn-dot', 'data-s': m.state }), m.state),
      m.last ? ' · ' + ago(m.last.at) + ' — ' + m.last.what : ' · no activity in this sample'))
}

function RoomLane({ r, stub, hueOf, unread }) {
  const n = r.live.length
  const isNone = r.id === null
  const meta = isNone ? 'agents and cards no room holds'
    : r.mapped.filter(k => r.members.some(m => matches(k, m.id))).length + ' of ' + r.mapped.length + ' seen in this sample' + (stub ? ' · rooms: stub' : '')
  return h('div', { className: cls('mn-lane', isNone && 'mn-none') },
    h('div', { className: 'mn-lh' },
      h('div', { className: 'mn-rn' }, h('span', { className: 'mn-nm' }, r.name), n ? h('span', { className: 'mn-bdg' }, String(n)) : null),
      h('div', { className: 'mn-me' }, meta)),
    h('div', { className: 'mn-cell', 'data-l': 'members' },
      r.members.length ? r.members.map(m => h(MemberRow, { key: m.id, m, hue: hueOf(m.id) }))
        : h('div', { className: 'mn-e' }, isNone ? 'every agent in this sample has a room' : 'no member seen in this sample')),
    h('div', { className: cls('mn-cell mn-nyc', n && 'mn-hot'), 'data-l': 'needs you' },
      n ? r.live.map(i => h('button', {
        key: i.id, type: 'button', className: 'mn-chip', onClick: () => navigate('/live'),
        title: (i.agent || 'no agent yet') + ' · ' + (i.ask || i.title || i.id) + ' — answer it on Live'
      }, h('span', { className: 'mn-t' }, topic(i)), i.expiry ? h('span', { className: 'mn-x' }, md(i.expiry)) : null))
        : h('div', { className: 'mn-e' }, unread ? 'the queue could not be read' : 'nothing needs you here')),
    h('div', { className: 'mn-cell mn-pkc', 'data-l': 'parked' },
      r.parked.length ? r.parked.map(i => h('div', { key: i.id, className: 'mn-pk', title: i.ask || i.title || i.id },
        h('span', { className: 'lv-mono' }, 'until ' + md(i.parked.until)), topic(i)))
        : h('div', { className: 'mn-e' }, '—')))
}

function MonitorPage() {
  const s = useToday(true)
  useEffect(() => { injectStyle() }, [])
  const data = s.data
  const iso = t => (t ? new Date(t).toISOString() : null)
  const v = data ? getRooms(data) : null
  const stub = Boolean(v) && v.source === 'stub'
  const n = needCount(data)
  const hueOf = id => hueFor(id, v ? v.members : [])
  const lanes = v ? v.rooms.concat(v.none.members.length || v.none.live.length || v.none.parked.length ? [v.none] : []) : []
  const parkedN = v ? lanes.reduce((a, r) => a + r.parked.length, 0) : 0
  return h('div', { className: 'mn-stage' },
    s.err && data ? h('div', { className: 'tdy-stalebar', role: 'alert' },
      'STALE — the last refresh failed ' + ago(iso(s.errAt)) +
      '. Everything below was sampled ' + ago(iso(s.lastOkAt)) + ' and is NOT current.',
      h('small', null, 'Error: ' + s.err)) : null,
    h('div', { className: 'lv-cb' },
      h('div', { className: 'lv-cb-l' },
        h('span', { className: 'lv-live' }, 'Monitor'),
        stub ? h('span', { className: 'mn-tag', title: 'The box gave no readable rooms' + (v.srcError ? ' (' + v.srcError + ')' : '') + ', so the lanes use the fixed owner→room map in plugin.js.' }, 'rooms: stub')
          : v && v.source === 'rooms.json' ? h('span', { className: 'mn-tag', title: 'The gateway could not be read' + (v.srcError ? ' (' + v.srcError + ')' : '') + '; these rooms are the vault’s copy (tools/deploy/rooms.json), not the live list.' }, 'rooms: vault copy')
          : v ? h('span', { className: 'lv-stamp', title: 'Read live from the box gateway’s hosted-room store.' }, 'rooms: gateway · ' + hhmm(v.sampled_at)) : null,
        v ? h('span', { className: 'lv-sum' },
          v.rooms.length + ' rooms · ' + v.members.length + ' agents · ',
          h('b', null, (n ?? '?') + ' need you'), ' · ' + parkedN + ' parked',
          v.derivedN ? ' · ' + v.derivedN + ' derived on Today' : '') : null),
      h('div', { className: 'lv-cb-r' },
        data ? h('span', { className: 'lv-stamp' }, 'sampled ' + hhmm(data.sampled_at)) : null,
        h('button', { type: 'button', className: 'lv-cbtn', title: 'Opens the call. Nothing is answered here.', onClick: () => navigate('/live') },
          'Answer on Live'))),
    !data ? h('div', { className: 'lv-msg' }, s.err ? 'Could not sample: ' + s.err : 'Sampling the box…')
      : !v.rooms.length && !lanes.length ? h('div', { className: 'mn-empty' },
          'No rooms yet, and no agent or card in this sample. When a room exists it gets a lane here.')
        : h('div', null,
            h('div', { className: 'mn-bh' },
              h('div', null, h('span', { className: 'mn-eb' }, 'Room'), h('span', { className: 'mn-n' }, String(v.rooms.length))),
              h('div', null, h('span', { className: 'mn-eb' }, 'Members · state · last activity'), h('span', { className: 'mn-n' }, String(v.members.length))),
              h('div', { className: cls('mn-nyh', n && 'mn-hot') }, h('span', { className: 'mn-eb' }, 'Needs you'), h('span', { className: 'mn-n' }, String(n ?? '?'))),
              h('div', { className: 'mn-pkh' }, h('span', { className: 'mn-eb' }, 'Parked'), h('span', { className: 'mn-n' }, String(parkedN)))),
            !v.rooms.length ? h('div', { className: 'mn-empty' }, 'No rooms yet. Every agent and card below waits in “No room” until one exists.') : null,
            lanes.map(r => h(RoomLane, { key: r.id || '~none', r, stub, hueOf, unread: n === null })),
            n === 0 ? h('div', { className: 'mn-empty' }, 'Nothing needs you. Every lane is quiet.')
              : n === null ? h('div', { className: 'mn-empty lv-warn' }, 'The queue could not be read — the needs-you counts on this page are unknown, not zero.') : null),
    h('p', { className: 'mn-note' },
      stub ? 'Rooms: stub — the box gave no readable rooms, so the lanes group the real agents, panes, units, runs and cards of this sample ' +
        'by a fixed owner→room map in plugin.js (ROOM_STUB). ' : v && v.source === 'rooms.json'
        ? 'Rooms: the vault’s copy (tools/deploy/rooms.json) — the gateway could not be read, so these may not match the live rooms. ' : '',
      'States: a pane or unit reports working, blocked or failed; a run that failed or blocked in the last 24 h counts; ' +
      'a claimed board row is working; the worst wins. Read-only — a card opens Live, where the decide line is; copy buttons copy an attach or status line.'))
}

/* ------------------------------------------------------------------------ */
/* CALL (/call) — the decision call (slice 3, Karl 2026-09-27). ONE card at  */
/* a time, in the queue's order (the server's live block when it has one),  */
/* with its why, its words and what each is for, its default. "Start the    */
/* call" opens a Hermes chat with the `decision-call` profile, primed with   */
/* `call <id>`: that agent presents the card, discusses its effects (the     */
/* card and read-only vault context), reads Karl's word back, and records it */
/* only when his next message names that word (tier 3: names it twice). The */
/* recording is the agent's one narrow tool, enforced in code there          */
/* (hermes/plugins/decision-call), through the vault's one writer, doneBy    */
/* "karl — call <word>". THIS PAGE WRITES NOTHING: it opens a chat, or       */
/* copies a line. Voice: in the chat, the composer's voice button (Ctrl+B)   */
/* starts a spoken call; the profile hears with local Whisper and speaks     */
/* with Edge TTS, so a call spends nothing.                                  */
/* ------------------------------------------------------------------------ */
const CALL_PROFILE = 'decision-call'
const CALL_STYLE_ID = 'fleet-call-style'
const CALL_CSS = `
.cl-root{padding:22px 28px 64px;max-width:860px;font-size:14px;line-height:1.5}
.cl-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.cl-head h1{font-size:28px;font-weight:650;margin:0;letter-spacing:-.015em}
.cl-meta{font-size:11.5px;opacity:.55;font-variant-numeric:tabular-nums}
.cl-card{border:1px solid rgba(128,128,128,.3);border-radius:12px;padding:18px 20px;margin-top:14px;
  background:rgba(128,128,128,.05)}
.cl-pos{font-size:12px;opacity:.6;font-variant-numeric:tabular-nums;display:flex;gap:10px;flex-wrap:wrap}
.cl-tier{padding:0 7px;border-radius:999px;font-weight:600;background:rgba(128,128,128,.18)}
.cl-tier.cl-t3{background:#e26d5c;color:#fff}
.cl-ask{font-size:21px;font-weight:620;margin:8px 0 4px;letter-spacing:-.01em}
.cl-title{font-size:12.5px;opacity:.6;margin-bottom:10px}
.cl-sec{margin-top:12px}
.cl-sec b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.55;margin-bottom:2px}
.cl-sec p{margin:0;max-width:78ch;opacity:.88;white-space:pre-wrap}
.cl-words{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.cl-word{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;padding:3px 9px;
  border-radius:6px;border:1px solid rgba(128,128,128,.35)}
.cl-word.cl-noop{border-style:dashed}
.cl-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:18px}
.cl-start{font:inherit;font-size:14px;font-weight:600;padding:8px 16px;border-radius:8px;cursor:pointer;
  border:0;background:#2f7d5b;color:#fff}
.cl-start[disabled]{opacity:.5;cursor:default}
.cl-btn{font:inherit;font-size:12px;padding:6px 11px;border-radius:7px;cursor:pointer;
  border:1px solid rgba(128,128,128,.35);background:rgba(128,128,128,.08);color:inherit}
.cl-note{font-size:12px;opacity:.62;margin-top:14px;max-width:78ch}
.cl-state{font-size:12.5px;margin-top:10px}
.cl-bad{color:#e26d5c}
`
function injectCallStyle() {
  const old = document.getElementById(CALL_STYLE_ID)
  if (old && old.textContent === CALL_CSS) return
  if (old) old.remove()
  const el = document.createElement('style')
  el.id = CALL_STYLE_ID
  el.textContent = CALL_CSS
  document.head.appendChild(el)
}

/* The route that serves the decision-call profile on a connection this Desktop knows, or null.
 * The profile must live where the Desktop's BACKEND runs: on this Mac that is the box (the Desktop
 * dials 127.0.0.1:9119, a tunnel to the box's hermes-serve), so install.sh --box, not a Mac install.
 * The 2026-09-27 proof: with the profile only on the Mac, session.create failed ("Profile
 * 'decision-call' does not exist") and the old fallback opened a generic draft in the default profile. */
async function callRoute(host) {
  if (typeof host.profileRoutes !== 'function') return null
  try {
    const routes = await host.profileRoutes()
    const mine = (routes || []).filter(r => r && r.connectionId && (r.targetProfile || r.profile) === CALL_PROFILE)
    return mine.find(r => r.mode === 'local') || mine[0] || null
  } catch { return null }
}

/* Open a fresh decision-call chat primed with `call <id>`, through the profile's own route — the
 * same door Bot Mode uses: session.create → session.title → openSession → prompt.submit. When the
 * profile or any step is missing it opens NOTHING (a plain new chat would land in whatever profile is
 * active, which is not the call) and says why; the id line is offered for a chat Karl opens himself. */
async function startCall(card) {
  const host = SDK.host
  const line = 'call ' + card.id
  const fail = why => ({ ok: false, msg: why + ' Nothing was opened or written.' })
  if (!host || typeof host.requestProfile !== 'function' || typeof host.openSession !== 'function') {
    return fail('This Desktop cannot open a primed chat from a plugin.')
  }
  const route = await callRoute(host)
  if (!route) {
    return fail('The ' + CALL_PROFILE + ' profile is not on the Desktop\'s backend (install it there: ' +
      'hermes/profiles/decision-call/install.sh --box).')
  }
  const req = (method, params) => host.requestProfile(route, method, params, undefined, { spawnPriority: 'foreground' })
  const title = 'Call · ' + String(card.ask || card.title || card.id).slice(0, 60)
  let res
  try {
    res = await req('session.create', { profile: route.targetProfile || route.profile, title, follow_profile_config: true })
  } catch (e) {
    return fail('The ' + CALL_PROFILE + ' backend refused the session (' + String((e && e.message) || e).slice(0, 120) + ').')
  }
  const sid = res && typeof res.stored_session_id === 'string' ? res.stored_session_id : null
  const runtime = res && typeof res.session_id === 'string' ? res.session_id : null
  if (!sid || !runtime) return fail('The ' + CALL_PROFILE + ' backend did not return a session.')
  try { await req('session.title', { session_id: runtime, title }) } catch { /* the first prompt persists the row */ }
  const open = () => host.openSession(sid, { route, profile: route.profile, intent: 'main',
    keepAllProfilesScope: true, tabTitle: title })
  let opened = false
  try { await open(); opened = true } catch { /* the row may not exist until the first prompt; retried below */ }
  await new Promise(r => setTimeout(r, 400))
  try {
    await req('prompt.submit', { session_id: runtime, text: line })
  } catch (e) {
    return { ok: false, msg: 'The chat "' + title + '" was opened, but "' + line + '" could not be sent (' +
      String((e && e.message) || e).slice(0, 100) + '). Type it there yourself.' }
  }
  if (!opened) { try { await open() } catch { /* it is in the Sessions list under its title */ } }
  return { ok: true, msg: 'The call is open: the tab "' + title + '", profile ' + CALL_PROFILE + '. Press Ctrl+B there to talk.' }
}

function CallPage() {
  const s = useToday(true)
  const [focus, setFocus] = useState(null) // card id this view shows; null = the queue's first
  const [st, setSt] = useState(null) // { busy } | { ok, msg } — this view only
  useEffect(() => { injectStyle(); injectCallStyle() }, [])
  const data = s.data
  const { live } = splitNeeds((data && data.needs_you) || {})
  const lv = data && data.live && !data.live.error && Array.isArray(data.live.order) ? data.live : null
  const Q = lv ? lv.order.map(id => live.find(i => i.id === id)).filter(Boolean)
    .concat(live.filter(i => !lv.order.includes(i.id)).sort(byQueue)) : live.slice().sort(byQueue)
  let qi = focus ? Q.findIndex(c => c.id === focus) : 0
  if (qi < 0) qi = 0 // the card left the queue (its word was recorded): the queue's first is next
  const q = Q[qi] || null
  const words = q ? wordsOf(q) : []
  const tier = q ? Number(q.tier) || null : null
  const plain = q && SAFE_ID.test(String(q.id))
  const step = d => { const to = Q[Math.max(0, Math.min(Q.length - 1, qi + d))]; if (to) { setFocus(to.id); setSt(null) } }
  const go = () => {
    if (!q || !plain || (st && st.busy)) return
    setSt({ busy: true })
    startCall(q).then(r => setSt(r)).catch(e => setSt({ ok: false, msg: String(e) }))
  }
  const sec = (label, text) => text ? h('div', { className: 'cl-sec' }, h('b', null, label), h('p', null, String(text))) : null

  return h('div', { className: 'cl-root' },
    h('div', { className: 'cl-head' },
      h('h1', null, 'The call'),
      data ? h('span', { className: 'cl-meta' },
        (Q.length ? Q.length + ' card' + (Q.length === 1 ? '' : 's') + ' in the queue’s order' : 'nothing needs you') +
        ' · sampled ' + hhmm(data.sampled_at) + (s.err ? ' · STALE: ' + s.err : '')) : null),
    !data ? h('div', { className: 'tdy-empty' }, s.err ? 'Could not sample: ' + s.err : 'Sampling the box…')
      : !q ? h('div', { className: 'tdy-empty' }, 'Nothing needs you. Parked cards come back on their day.')
        : h('div', { className: 'cl-card' },
          h('div', { className: 'cl-pos' },
            h('span', null, 'card ' + (qi + 1) + ' of ' + Q.length),
            tier ? h('span', { className: cls('cl-tier', tier === 3 && 'cl-t3') }, 'tier ' + tier + (tier === 3 ? ' · name the word twice' : '')) : null,
            q.ask_kind ? h('span', null, q.ask_kind) : null,
            h('span', null, who(q)),
            q.expiry ? h('span', null, 'expires ' + q.expiry) : null),
          h('div', { className: 'cl-ask' }, q.ask || q.title),
          q.ask ? h('div', { className: 'cl-title' }, q.title) : null,
          sec('Why', q.why),
          sec('What it takes', q.steps),
          sec('If you say nothing', q.default),
          h('div', { className: 'cl-sec' }, h('b', null, 'The words'),
            h('div', { className: 'cl-words' },
              words.map((w, n) => h('span', { key: w, className: cls('cl-word', n === 0 && tier === 3 && 'cl-noop') }, w)),
              plain ? h('span', { key: 'later', className: 'cl-word cl-noop', title: 'parks it until tomorrow; it stays open' }, 'later') : null)),
          h('div', { className: 'cl-actions' },
            h('button', { type: 'button', className: 'cl-start', disabled: !plain || Boolean(st && st.busy), onClick: go,
              title: 'Opens a ' + CALL_PROFILE + ' chat primed with this card. Nothing is answered here.' },
            st && st.busy ? 'Opening the call…' : 'Start the call'),
            h('button', { type: 'button', className: 'cl-btn', disabled: qi <= 0, onClick: () => step(-1) }, '← previous'),
            h('button', { type: 'button', className: 'cl-btn', disabled: qi >= Q.length - 1, onClick: () => step(1) }, 'next →'),
            h('button', { type: 'button', className: 'cl-btn', onClick: () => copy('call ' + q.id).catch(() => {}),
              title: 'For a chat you already have open with the ' + CALL_PROFILE + ' profile' }, 'Copy “call <id>”')),
          st && !st.busy ? h('div', { className: cls('cl-state', !st.ok && 'cl-bad') }, st.msg) : null),
    h('p', { className: 'cl-note' },
      'In the call the agent presents this card, talks through what each word does, and reads your word back. ' +
      'It records only when your next message names that word itself (a bare yes is not enough) — a tier-3 card asks you to name it twice — ' +
      'through the same writer as decide, marked “karl — call <word>”. It has no shell and sends nothing. ' +
      'To talk instead of type, press Ctrl+B in the chat (local Whisper hears, Edge TTS speaks; nothing is spent). ' +
      'This page writes nothing; decide in a terminal still works.'))
}

/* Registration for /call, kept apart so the other lanes' registration edits do not collide with it. */
function callContributions() {
  const out = [
    { id: 'call-page', area: ROUTES_AREA, data: { path: '/call' },
      render: () => h(Boundary, { name: 'Call' }, h(CallPage)) },
    { id: 'call-nav', area: SIDEBAR_NAV_AREA, order: 8,
      data: { codicon: 'unmute', label: 'Call', path: '/call' } }
  ]
  if (PALETTE_AREA) {
    out.push({ id: 'open-call', area: PALETTE_AREA,
      data: { id: 'fleet.open-call', label: 'Open the call — one decision card, talked through', keywords: ['call', 'decide', 'voice', 'card'],
        run: () => navigate('/call') } })
  }
  return out
}

/* ------------------------------------------------------------------------ */
/* Fleet — the full view of the box, unchanged, as its own page.             */
/* Today ADDS a page; it does not replace this one (Karl, 2026-09-03).       */
/* ------------------------------------------------------------------------ */
function makeFleetPage(rest) {
  return function FleetPage() {
    const [data, setData] = useState(null)
    const [err, setErr] = useState(null)
    const [loading, setLoading] = useState(true)
    const [lastOkAt, setLastOkAt] = useState(null)
    const [errAt, setErrAt] = useState(null)

    useEffect(() => {
      injectStyle()
      let dead = false
      const tick = () =>
        rest('/overview')
          .then(d => { if (!dead) { setData(d); setErr(null); setLastOkAt(Date.now()); setLoading(false) } })
          .catch(e => { if (!dead) { setErr(String(e)); setErrAt(Date.now()); setLoading(false) } })
      tick()
      const id = setInterval(tick, POLL_MS)
      return () => { dead = true; clearInterval(id) }
    }, [])

    if (loading) return h('div', { className: 'tdy-root' }, h('p', null, 'Sampling the box…'))
    if (err && !data) return h('div', { className: 'tdy-root' }, h(Err, { msg: err }))

    const stale = Boolean(err && data)
    const iso = t => (t ? new Date(t).toISOString() : null)
    return h('div', { className: stale ? 'tdy-root tdy-stale' : 'tdy-root' },
      stale ? h('div', { className: 'tdy-stalebar', role: 'alert' },
        'STALE — the last refresh failed ' + ago(iso(errAt)) +
        '. Everything below was sampled ' + ago(iso(lastOkAt)) + ' and is NOT current.',
        h('small', null, 'Error: ' + err)) : null,
      h('div', { className: 'tdy-body' },
        h('header', null,
          h('h1', null, 'Fleet'),
          h('p', { className: 'tdy-oneline' }, data.maturity ||
            'Lucky Loop is an early MVP and is not finished. This view reports what is ' +
            'measured on one box; where something is not instrumented it says so.'),
          h('div', { className: 'tdy-stamp' },
            h('span', null, 'sampled ' + clock(data.sampled_at)),
            h('span', null, 'refreshes every ' + Math.round(POLL_MS / 1000) + 's'),
            err ? h('span', { style: { color: '#e26d5c' } }, 'last refresh failed') : null)),
        h(FSection, { title: 'Health',
          meta: data.health ? 'sampled ' + clock(data.health.sampled_at) : null,
          children: h(Health, { data: data.health }) }),
        h(FSection, { title: 'Checks',
          meta: data.checks
            ? (data.checks.status || '?') + ' · ' +
              ((data.checks.total || 0) - (data.checks.failing || []).length) + '/' +
              (data.checks.total || 0) + ' passing · written ' + ago(data.checks.checked_at)
            : null,
          children: h(Checks, { data: data.checks }) }),
        h(FSection, { title: 'Unit CPU budgets',
          meta: data.units && data.units.interval_s ? 'rate over ' + data.units.interval_s + 's' : 'first poll',
          children: h(Units, { data: data.units }) }),
        h(FSection, { title: 'Agent roster',
          meta: data.roster ? (data.roster.agents || []).length + ' units' : null,
          children: h(Roster, { data: data.roster }) }),
        h(FSection, { title: 'Scheduled jobs',
          meta: data.jobs
            ? (data.jobs.timers || []).length + ' timers · ' + (data.jobs.cron || []).length + ' cron'
            : null,
          children: h(Jobs, { data: data.jobs }) })))
  }
}

// The mockup's tokens (c-stage.html): page, chrome, surfaces, ink, the one orange.
const CC_DARK = {
  background: '#0d0d0d', foreground: '#f4f3ee', card: '#161615', cardForeground: '#f4f3ee',
  muted: '#1f1f1d', mutedForeground: '#898781', popover: '#161615', popoverForeground: '#f4f3ee',
  primary: '#d95926', primaryForeground: '#f4f3ee', secondary: '#292927', secondaryForeground: '#f4f3ee',
  accent: '#1f1f1d', accentForeground: '#f4f3ee', border: 'rgba(255,255,255,0.09)', input: 'rgba(255,255,255,0.15)',
  ring: '#d95926', destructive: '#e66767', destructiveForeground: '#f4f3ee',
  sidebarBackground: '#121211', sidebarBorder: 'rgba(255,255,255,0.09)'
}
const COMMAND_CENTER_THEME = {
  name: 'command-center', label: 'Command Center',
  description: 'The dark stage of plan C: near-black surfaces, one orange for what needs you.',
  colors: CC_DARK, darkColors: CC_DARK
}

const plugin = {
  id: 'fleet',
  name: 'Today + Fleet',
  description:
    'Today: what needs you, what the agents did, the goals, the box — one page, also served as ' +
    'text at /today.txt for agents. Fleet: the full view of the box, unchanged. Read-only; ' +
    'every action is a command you run yourself.',
  register(ctx) {
    restFn = ctx.rest
    const TodayPage = makeTodayPage(ctx.rest)
    const FleetPage = makeFleetPage(ctx.rest)
    const needDetail = () => {
      const n = needCount(store.data)
      return n === null ? 'not sampled yet' : n + ' need you' + (store.err ? ' · stale' : '')
    }
    const contributions = [
      { id: 'today-page', area: ROUTES_AREA, data: { path: '/today' },
        render: () => h(Boundary, { name: 'Today' }, h(TodayPage)) },
      { id: 'today-nav', area: SIDEBAR_NAV_AREA, order: 5,
        data: { codicon: 'home', label: 'Today', path: '/today' } },
      { id: 'live-page', area: ROUTES_AREA, data: { path: '/live' },
        render: () => h(Boundary, { name: 'Live' }, h(CStageLive)) },
      { id: 'battlefield-page', area: ROUTES_AREA, data: { path: '/battlefield' },
        render: () => h(Boundary, { name: 'Battlefield' }, h(CStageBF)) },
      { id: 'battlefield-nav', area: SIDEBAR_NAV_AREA, order: 6.5,
        data: { codicon: 'layout', label: 'Battlefield', path: '/battlefield' } },
      { id: 'live-nav', area: SIDEBAR_NAV_AREA, order: 6,
        data: { codicon: 'broadcast', label: 'Live', path: '/live' } },
      { id: 'page', area: ROUTES_AREA, data: { path: '/fleet' },
        render: () => h(Boundary, { name: 'Fleet' }, h(FleetPage)) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, order: 55,
        data: { codicon: 'pulse', label: 'Fleet', path: '/fleet' } }
    ]
    // Monitor mode is behind its flag (see MONITOR_ON): off, nothing of it registers.
    const monitor = monitorOn()
    if (monitor) {
      contributions.push(
        { id: 'monitor-page', area: ROUTES_AREA, data: { path: '/monitor' },
          render: () => h(Boundary, { name: 'Monitor' }, h(MonitorPage)) },
        { id: 'monitor-nav', area: SIDEBAR_NAV_AREA, order: 7,
          data: { codicon: 'layout', label: 'Monitor', path: '/monitor' } })
    }
    // C's chrome: the status bar's left items and its sampled stamp, the titlebar's
    // centred "Hermes · <view>" and its need pill, and the Bots tab's Fleet + Rooms.
    if (STATUSBAR_LEFT) {
      contributions.push({ id: 'cc-status', area: STATUSBAR_LEFT, order: 200,
        render: () => h(Boundary, { name: 'Status' }, h(CcStatus, { side: 'left' })) })
    }
    if (STATUSBAR_RIGHT) {
      contributions.push({ id: 'cc-sampled', area: STATUSBAR_RIGHT, order: 115,
        render: () => h(Boundary, { name: 'Status' }, h(CcStatus, { side: 'right' })) })
    }
    if (TITLEBAR_LEFT) {
      contributions.push({ id: 'cc-title', area: TITLEBAR_LEFT, order: 50,
        render: () => h(Boundary, { name: 'Title' }, h(CcTitle)) })
    }
    if (TITLEBAR_RIGHT) {
      contributions.push({ id: 'need-chip-title', area: TITLEBAR_RIGHT, order: 5,
        render: () => h(Boundary, { name: 'Needs-you chip' }, h(CcPill)) })
    }
    if (BOTS_PANE_AREA) {
      contributions.push({ id: 'cc-side', area: BOTS_PANE_AREA, order: 10,
        render: () => h(Boundary, { name: 'Fleet' }, h(CcSide)) })
    }
    ccBootToStage()
    // Listed in Settings → Appearance, never selected here: choosing it changes the
    // whole app, and that is Karl's click. /live carries the same palette on its own.
    if (THEMES_AREA) contributions.push({ id: 'command-center-theme', area: THEMES_AREA, data: COMMAND_CENTER_THEME })
    if (PALETTE_AREA) {
      contributions.push(
        { id: 'open-today', area: PALETTE_AREA,
          data: { id: 'fleet.open-today', label: 'Open Today — what needs you', keywords: ['today', 'needs', 'decide'],
            detail: needDetail, run: () => navigate('/today') } },
        { id: 'open-live', area: PALETTE_AREA,
          data: { id: 'fleet.open-live', label: 'Open Live — the call', keywords: ['live', 'call', 'cards'],
            detail: needDetail, run: () => navigate('/live') } })
      if (monitor) {
        contributions.push({ id: 'open-monitor', area: PALETTE_AREA,
          data: { id: 'fleet.open-monitor', label: 'Open Monitor — every room at a glance', keywords: ['monitor', 'rooms', 'board'],
            detail: needDetail, run: () => navigate('/monitor') } })
      }
    }
    contributions.push(...callContributions())
    ctx.registerMany(contributions)
  }
}

export default plugin
