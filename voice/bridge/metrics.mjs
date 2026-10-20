// C1 and C2, computed from the page's event timestamps (performance.timeOrigin + now(), ms).
//   speech_end      Karl's voice-activity score fell below the threshold after he spoke
//   agent_speaking  the SDK switched to "speaking", i.e. the first agent audio began to play
//   barge_start     Karl's voice rose while the agent was speaking
//   agent_stopped   the agent stopped speaking (mode "listening" or an interruption event)
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

export function metrics(events) {
  const t = events.filter((e) => e.type === "timing" && typeof e.at === "number").sort((a, b) => a.at - b.at);
  const c1 = [];
  const c2 = [];
  let lastEnd = null;
  let bargeAt = null;
  for (const e of t) {
    if (e.kind === "speech_end") lastEnd = e.at;
    if (e.kind === "speech_start") lastEnd = null; // he kept talking: the turn is not over
    if (e.kind === "agent_speaking" && lastEnd !== null) {
      const d = e.at - lastEnd;
      if (d >= 0 && d < 20_000) c1.push(d);
      lastEnd = null;
    }
    if (e.kind === "barge_start") bargeAt = e.at;
    if (e.kind === "agent_stopped" && bargeAt !== null) {
      const d = e.at - bargeAt;
      if (d >= 0 && d < 3000) c2.push(d);
      bargeAt = null;
    }
    if (e.kind === "agent_speaking") bargeAt = null;
  }
  return {
    c1: { n: c1.length, median_ms: median(c1), pass: c1.length >= 10 && median(c1) <= 1500, samples: c1 },
    c2: { n: c2.length, median_ms: median(c2), pass: c2.length >= 1 && median(c2) <= 500, samples: c2 },
  };
}
