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
/* --- live: the call --- */
.lv-band{border:1px solid rgba(226,109,92,.55);background:rgba(226,109,92,.1);border-radius:8px;
  padding:9px 12px;margin:12px 0 0;font-size:13px}
.lv-band b{color:#e26d5c}
.lv-tiles{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));margin:16px 0}
.lv-tile{border:1px solid rgba(128,128,128,.26);border-radius:9px;padding:9px 12px;cursor:pointer;
  background:rgba(128,128,128,.04);text-align:left;font:inherit;color:inherit}
.lv-tile:hover{background:rgba(128,128,128,.1)}
.lv-tile.lv-on{border-color:#d95926}
.lv-tname{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;font-weight:600}
.lv-tcount{font-size:12px;opacity:.65;margin-top:2px;font-variant-numeric:tabular-nums}
.lv-tray{border:1px solid rgba(128,128,128,.35);border-radius:12px;padding:14px 16px;background:rgba(128,128,128,.06)}
.lv-trayhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.lv-trayhead h2{font-size:17px;margin:0;font-weight:650}
.lv-card{border-top:1px solid rgba(128,128,128,.2);padding:11px 0 9px}
.lv-card:first-of-type{border-top:0}
.lv-silence{font-size:12px;opacity:.62;margin-top:6px;max-width:84ch}
.lv-expired{color:#d9a441}
.lv-receipt{font-size:12.5px;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.14)}
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
const byCall = (a, b) =>
  String(a.expiry || '9999').localeCompare(String(b.expiry || '9999')) ||
  (a.priority ?? 99) - (b.priority ?? 99) || String(a.since || '').localeCompare(String(b.since || ''))

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
function NeedChip() {
  const s = useToday(false)
  const n = needCount(s.data)
  const parked = s.data && s.data.needs_you ? splitNeeds(s.data.needs_you).parked.length : 0
  const label = n === null ? (s.loading ? 'needs you …' : 'needs you ?') : n + ' need you'
  return h('button', {
    type: 'button',
    className: cls('tdy-chip', n > 0 && 'tdy-hot'),
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
/* Live — the call. The agents' tiles around one tray; the tray holds at most */
/* five cards, soonest expiry first. Every control here changes the VIEW only; */
/* the answer is a `decide` line Karl copies into a terminal (one answer place).*/
/* ------------------------------------------------------------------------ */
function silenceCopy(i) {
  if (i.tier === 3) return 'Silence changes nothing: this card waits for your word.'
  const dflt = i.default ? '“' + String(i.default).split(/\s+/)[0] + '”' : 'none'
  return 'Tier 1. Its default is ' + dflt + ', but nothing applies defaults today (the applier is off), so silence also waits.'
}

function LiveCard({ i, today }) {
  const expired = Boolean(i.expiry) && i.expiry < today
  return h('div', { className: 'lv-card' },
    h('div', { className: 'tdy-sub', style: { marginTop: 0, marginBottom: 3 } },
      h('span', { className: 'tdy-agent' }, i.agent || 'no agent yet'),
      i.group ? ' · ' + i.group : '',
      i.expiry ? h('span', { className: expired ? 'lv-expired' : null },
        ' · ' + (expired ? 'expired ' + i.expiry + ' — still open, still yours' : 'expires ' + i.expiry)) : null),
    h(AskHead, { i }),
    i.why ? h('div', { className: 'tdy-why' }, i.why) : null,
    i.steps ? h('div', { className: 'tdy-steps' }, h('span', { className: 'tdy-lbl' }, 'Do'), i.steps) : null,
    i.command ? h('div', { className: 'tdy-cmdrow' },
      h('span', { className: 'tdy-lbl' }, 'Paste'), h('pre', { className: 'tdy-cmd' }, i.command),
      h(CopyBtn, { text: i.command, small: true })) : null,
    h('div', { className: 'tdy-cmdrow' },
      h('span', { className: 'tdy-lbl' }, 'Answer'), h('div', { style: { flex: 1 } }, h(DecideLines, { i }))),
    h('div', { className: 'lv-silence' }, silenceCopy(i)))
}

function LivePage() {
  const { data, err, loading, lastOkAt, errAt, receipts, since } = useToday(true)
  const [agent, setAgent] = useState(null)
  const [page, setPage] = useState(0)
  const gone = receipts || []
  useEffect(() => { injectStyle() }, [])

  if (loading && !data) return h('div', { className: 'tdy-root' }, h('p', null, 'Sampling the box…'))
  if (err && !data) return h('div', { className: 'tdy-root' }, h(Err, { msg: err }))

  const stale = Boolean(err && data)
  const iso = t => (t ? new Date(t).toISOString() : null)
  const ny = data.needs_you || {}
  const { today, live, parked, derived } = splitNeeds(ny)
  const n = needCount(data)
  const agents = [...new Set(live.map(i => i.agent || 'no agent yet'))].sort()
  const pool = live.filter(i => !agent || (i.agent || 'no agent yet') === agent).sort(byCall)
  const pages = Math.max(1, Math.ceil(pool.length / BATCH))
  const pg = Math.min(page, pages - 1)
  const batch = pool.slice(pg * BATCH, pg * BATCH + BATCH)
  const failed = ((data.agents || {}).items || []).filter(r => r.status === 'failed' || r.status === 'stopped')

  return h('div', { className: stale ? 'tdy-root tdy-stale' : 'tdy-root' },
    stale ? h('div', { className: 'tdy-stalebar', role: 'alert' },
      'STALE — the last refresh failed ' + ago(iso(errAt)) +
      '. Everything below was sampled ' + ago(iso(lastOkAt)) + ' and is NOT current.',
      h('small', null, 'Error: ' + err)) : null,
    h('div', { className: 'tdy-body' },
      h('header', null,
        h('h1', null, 'Live'),
        h('div', { className: 'tdy-stamp' },
          h('span', null, 'sampled ' + clock(data.sampled_at)),
          h('span', null, 'refreshes every ' + Math.round(POLL_MS / 1000) + 's'),
          ny.updated_at ? h('span', null, 'queue updated ' + ago(ny.updated_at)) : null),
        h('div', { className: cls('tdy-verdict', n ? 'tdy-hot' : 'tdy-calm') }, needLine(n, parked.length)),
        h('p', { className: 'tdy-oneline' },
          'Copy one ', h('code', null, 'decide <id> <word>'), ' line per card into a terminal. ',
          'This page writes nothing; Next, the tiles and Leave change only what you see.')),
      failed.length ? h('div', { className: 'lv-band', role: 'alert' },
        h('b', null, failed.length + ' failed'), ' — ',
        failed.map(r => (r.agent || '?') + ' ' + (r.job || '?') + ' ' + when(r.t)).join(' · '),
        ' (details on Today → What the agents did)') : null,
      h('div', { className: 'lv-tiles' },
        agents.map(a => {
          const mine = live.filter(i => (i.agent || 'no agent yet') === a)
          const notShipped = mine.some(i => i.agent_shipped === false)
          return h('button', { key: a, type: 'button', className: cls('lv-tile', agent === a && 'lv-on'),
            onClick: () => { setAgent(agent === a ? null : a); setPage(0) } },
            h('div', { className: 'lv-tname' }, a),
            h('div', { className: 'lv-tcount' }, mine.length + ' need you' +
              (mine.some(i => i.expiry && i.expiry < today) ? ' · some expired' : '')),
            notShipped ? h('div', { className: 'lv-tcount tdy-warn' }, 'not shipped — nothing runs on its cards yet') : null)
        })),
      h('div', { className: 'lv-tray' },
        h('div', { className: 'lv-trayhead' },
          h('h2', null, agent ? 'The call · ' + agent : 'The call'),
          h('span', { className: 'tdy-meta', style: { marginLeft: 0 } },
            pool.length ? 'batch ' + (pg + 1) + ' of ' + pages + ' · ' + batch.length + ' of ' + pool.length + ' cards · soonest expiry first' : ''),
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
            pg > 0 ? h('button', { className: 'tdy-btn tdy-small', onClick: () => setPage(pg - 1) }, 'Back') : null,
            pg < pages - 1 ? h('button', { className: 'tdy-btn tdy-small', onClick: () => setPage(pg + 1) }, 'Next five') : null,
            h('button', { className: 'tdy-btn tdy-small', title: 'Closes this view only. Nothing is answered or parked.',
              onClick: () => navigate('/today') }, 'Leave'))),
        batch.length
          ? batch.map(i => h(LiveCard, { key: i.id, i, today }))
          : h('p', { className: 'tdy-empty' }, agent ? 'Nothing from ' + agent + ' waits on you.' : 'Nothing is waiting on you.'),
        derived.length ? h('p', { className: 'tdy-note' },
          derived.length + ' derived item(s) also wait — nobody typed them; see Today → Needs you.') : null),
      h(Section, { title: 'Receipts', count: gone.length,
        meta: since ? 'since ' + clock(since) : null,
        children: h('div', null,
          gone.length
            ? gone.map(i => h('div', { key: i.id, className: 'lv-receipt' },
                h('span', { className: 'tdy-agent' }, i.agent || '—'), ' · ', i.ask || i.title,
                h('span', { className: 'tdy-when', style: { marginLeft: 8 } }, 'left the queue ' + ago(i.seenGoneAt))))
            : h('p', { className: 'tdy-empty' }, 'No card has left the queue since the Desktop loaded this page.'),
          h('p', { className: 'tdy-note' },
            'The word and who gave it are in the queue record, not on this page yet: the box serves open cards only, ' +
            'and serving closed ones needs a server change that is not part of this slice.')) }),
      parked.length ? h(Section, { title: 'Parked', count: parked.length,
        children: h('div', { className: 'tdy-parked' }, parked.map(i => h('div', { key: i.id, className: 'tdy-parkrow' },
          (i.agent ? i.agent + ' · ' : '') + (i.ask || i.title) + ' — until ' + i.parked.until))) }) : null))
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
