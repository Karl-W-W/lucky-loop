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
 * The page writes nothing — `decide` in a terminal is the one answer place. The
 * same parked-aware count ("N need you") is computed here, once, and shown on
 * Today, on /live, in the status bar and in the ⌘K palette.
 *
 * Pure SDK-consumer work, same shape as before: a `/fleet` route + a sidebar row,
 * data from the Fleet plugin's REST router through `ctx.rest`. Plain ESM, no
 * build step, hot-reloaded from `~/.hermes/desktop-plugins/fleet/plugin.js`.
 *
 * READ-ONLY BY DESIGN. It reports; it does not control. Every action is a
 * copy-pasteable command a human runs — Hermes is interface and chat runtime,
 * never orchestration.
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
const THEMES_AREA = SDK.THEMES_AREA || null
function navigate(path) {
  try { if (SDK.host && typeof SDK.host.navigate === 'function') SDK.host.navigate(path) } catch { /* no-op */ }
}

const h = React.createElement
const POLL_MS = 15000
const IDLE_POLL_MS = 60000 // when only the status bar is listening
const BATCH = 5
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
.lv-stage{--surface:#161615;--surface-3:#292927;--stage:#0a0a0a;--chrome:#121211;--ink:#f4f3ee;--ink-2:#c3c2b7;--ink-3:#898781;
  --ink-4:#63625d;--grid:#2c2c2a;--line:rgba(255,255,255,.09);--line-2:rgba(255,255,255,.15);--blue:#3987e5;--orange:#d95926;
  --good:#3fbf3f;--danger:#e66767;--warn:#d9a441;--sans:ui-sans-serif,system-ui,-apple-system,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;--e:cubic-bezier(.2,.7,.2,1);
  display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:calc(100vh - 72px);min-height:560px;
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
const BOARD_DONE = ['verified', 'done', 'converged']
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

/* One owner's tile: its face, its raised hands, the first question it holds,   */
/* and one folded line — the fact that matters most about it right now. An      */
/* owner that no pane carries is drawn away from the call: its face is dimmed.  */
function SeatTile({ seat, hue, mine, parked, pane, gone, failedRow, today, speaking, onFocus }) {
  const top = mine[0]
  const noAgent = mine.concat(parked).some(i => i.agent_shipped === false)
  const late = mine.filter(i => i.expiry && i.expiry < today).length
  const left = gone[gone.length - 1]
  const parkFold = !failedRow && !noAgent && parked.length > 0 // the fold says it; the status line need not
  const fold = failedRow ? [h('span', { key: 'f', className: 'lv-c-failed' }, 'failed ' + stamp(failedRow.t)), ' — ' + (failedRow.job || '?')]
    : noAgent ? 'no agent for this seat yet'
      : parked.length ? 'parked · until ' + md(parked[0].parked.until) + ' — ' + lead(parked[0])
        : left ? 'left the queue ' + ago(left.seenGoneAt) + ' — ' + lead(left)
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
function Tray({ q, hue, pos, batch, bi, nb, qLen, pane, pick, copied, derivedN, today, onPick, onCopy, onJump }) {
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
        h('div', { className: 'lv-ow' }, line
          ? [h('span', { key: 'l', className: 'lv-dl' }, line),
              done ? ' — copied; paste it now' : ' — paste it in a terminal']
          : 'pick a word — ↵ copies its decide line; this page writes nothing'))),
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
  const keyRef = React.useRef(null)
  useEffect(() => { injectStyle() }, [])
  useEffect(() => {
    const on = e => keyRef.current && keyRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const data = s.data
  const { today, live, parked, derived } = splitNeeds((data && data.needs_you) || {})
  const Q = live.slice().sort(byQueue)
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
  const gone = s.receipts || []
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
            gone.length ? h('span', { className: 'lv-pp' }, ' · ' + gone.length + ' left the queue since ' + hhmm(s.since)) : null) : null),
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
      onJump: (id, b) => focusOn(id || (Q[b * BATCH] || {}).id)
    }) : null)
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
        render: () => h(Boundary, { name: 'Live' }, h(LivePage)) },
      { id: 'live-nav', area: SIDEBAR_NAV_AREA, order: 6,
        data: { codicon: 'broadcast', label: 'Live', path: '/live' } },
      { id: 'page', area: ROUTES_AREA, data: { path: '/fleet' },
        render: () => h(Boundary, { name: 'Fleet' }, h(FleetPage)) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, order: 55,
        data: { codicon: 'pulse', label: 'Fleet', path: '/fleet' } }
    ]
    if (STATUSBAR_RIGHT) {
      contributions.push({ id: 'need-chip', area: STATUSBAR_RIGHT, order: 115,
        render: () => h(Boundary, { name: 'Needs-you chip' }, h(NeedChip)) })
    }
    if (TITLEBAR_RIGHT) {
      contributions.push({ id: 'need-chip-title', area: TITLEBAR_RIGHT, order: 5,
        render: () => h(Boundary, { name: 'Needs-you chip' }, h(NeedChip, { title: true })) })
    }
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
    }
    ctx.registerMany(contributions)
  }
}

export default plugin
