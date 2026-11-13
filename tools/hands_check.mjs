// Arm pose check over all shots of a chapter, on stills from the code copy (no video). For every arm of every figure: upper arm and
// forearm lengths, the elbow, the wrist bend, the thumb side, the palm turn, the touch of the prop, a hanging arm reaching mid-thigh, a
// foreshortened stump, a wing (the elbow of an arm at the chest sticking out of the silhouette), gesture poses (pull, push, rail, count,
// tap, dial, hangup) touching the reach point; plus:
// - hand without an arm: a visible hand in mid-frame with no forearm leading to it — the forearm is behind a prop (hidden 'fore',
//   wristHidden) or foreshortened to less than half, so the arm does not read as the chain upper arm → elbow → forearm → hand; allowed
//   only if the arm leaves over the frame edge (the elbow beyond the edge, the wrist at the edge) or the hand behind a prop is almost all
//   beyond the edge;
// - kink: the hand in the frame at more than 50° to the visible forearm;
// - front neck, by the head journal (collar, top of the neck, bottom of the head, skull centre): the visible neck at the sides is not a
//   wedge (with an open collar the smaller side is at least 0.22 of the larger and at least 4 units), the neck axis is within 15° of the
//   vertical, the skull centre is within 0.6 of the neck width from the middle of the neck at the collar, the width at the head is 0.8–1.7
//   of the width at the collar;
// - turn from behind without features: the back of the head turned by 0.6 rad or more, but the lost-profile features (lid, lashes, brow,
//   nose tip) are missing in the head journal or below 0.3.
//
// node tools/hands_check.mjs <absolute chapter work folder> [--shots 01.01,23.01] [--at 0.08,0.5,0.92] [--out check/arms] [--no-png]
//   [--no-look] [--no-gest] [--reuse]          (run from the code copy: cd "$(python tools/mirror.py)")
// Renders clean frames of the composition <channel>-chapter-poses (the chapter with the pose journal) at fractions --at of every shot, at
// gesture moments (35 % and 75 % of the event; --no-gest — without them) and around look events (before, in the middle and after; --no-look
// — without them), collects the journal from the browser console and writes to <folder>/<out>/: frames/c_<frame>.png (not with --no-png),
// poses.json, report.json and report.txt (violations with a reason). --reuse — no render, a report from an existing poses.json (a new rule
// on an old journal). Exit code 1 — there are violations, 3 — the browser did not start even after a retry (an environment error, a line
// "ENVIRONMENT: …", tools/remotion.mjs). Hand, arm and neck sheets from the frames and poses.json — tools/hands_sheet.py.
import {renderStill, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import {browsers, bundleProject, envExit, safePorts} from './remotion.mjs';

const args = process.argv.slice(2);
const work = path.resolve(args[0]);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const outDir = path.join(work, opt('out', 'check/arms'));
const fr = opt('at', '0.08,0.5,0.92').split(',').map(Number);
const only = opt('shots', null)?.split(',');
const noPng = args.includes('--no-png');
const reuse = args.includes('--reuse');
const withGest = !args.includes('--no-gest');
const withLook = !args.includes('--no-look');
const timeline = JSON.parse(fs.readFileSync(path.join(work, 'timeline.json'), 'utf-8'));
fs.mkdirSync(path.join(outDir, 'frames'), {recursive: true});

// ---------- rules ----------
const V = {
  sub: (a, b) => a.map((x, i) => x - b[i]),
  dot: (a, b) => a.reduce((s, x, i) => s + x * b[i], 0),
  len: (a) => Math.hypot(...a),
  norm: (a) => {
    const l = Math.hypot(...a) || 1;
    return a.map((x) => x / l);
  },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
const deg = (r) => (r * 180) / Math.PI;
// the hand conventions of the engine — the same functions as lib/character/arm.ts sideVec and palmNormal
const sideVec = (hand, view, f) => {
  const k = (hand === 'R' ? 1 : -1) * (view === 'dorsal' || view === 'radial' ? 1 : -1);
  return [k * f[1], -k * f[0]];
};
const palmNormal = (view, u) => (view === 'dorsal' ? [0, 0, -1] : view === 'palmar' ? [0, 0, 1] : [u[0], u[1], 0]);
const LIM = {
  dorsal: {toU: 25, away: 40}, // towards the thumb (radial deviation) / towards the little finger (ulnar)
  palmar: {toU: 25, away: 40},
  radial: {toU: 75, away: 60}, // towards the palm (flexion) / towards the back (extension)
  ulnar: {toU: 75, away: 60},
};

/** Violations of one arm: [{rule, msg}]; info — notes without a violation. */
function checkArm(a) {
  const out = [];
  const info = [];
  const bad = (rule, msg) => out.push({rule, msg});
  const {S, E, W} = a;
  // 1. lengths are constant
  const l1 = V.len(V.sub(E, S));
  const l2 = V.len(V.sub(W, E));
  if (Math.abs(l1 - a.L1) > a.L1 * 0.005) bad('length', `upper arm ${l1.toFixed(1)} instead of ${a.L1}`);
  if (Math.abs(l2 - a.L2) > a.L2 * 0.005) bad('length', `forearm ${l2.toFixed(1)} instead of ${a.L2}`);
  // 2. elbow: not folded beyond a natural limit and not sticking up (except an arm raised up and to the side)
  const eu = V.norm(V.sub(S, E));
  const ef = V.norm(V.sub(W, E));
  const inner = deg(Math.acos(Math.max(-1, Math.min(1, V.dot(eu, ef)))));
  if (inner < 30) bad('elbow', `folded to ${inner.toFixed(0)}° (natural — from 30°)`);
  const sw = V.sub(W, S);
  const swl = V.len(sw) || 1;
  const t = V.dot(V.sub(E, S), sw) / (swl * swl);
  const off = V.sub(E, S.map((x, i) => x + sw[i] * t));
  const ol = V.len(off);
  const backward = off[2] * (a.back ? 1 : -1); // elbow back (away from the figure's chest)
  if (ol > 6 && off[1] < -0.25 * ol && a.side * off[0] < 0.5 * ol && backward < 0.5 * ol) bad('elbow', `elbow sticks up (offset ${off.map((x) => x.toFixed(0)).join(', ')})`);
  // 3. wrist: the hand continues the forearm, the bend within a natural range (in the frame; a foreshortened forearm gets a larger
  // tolerance)
  const E2 = [E[0], E[1]];
  const W2 = [W[0], W[1]];
  const fl = V.len(V.sub(W2, E2));
  const r = fl / a.L2;
  const ru = V.len(V.sub(E2, [S[0], S[1]])) / a.L1;
  if (a.wristHidden) info.push({rule: 'wrist', msg: `not visible: ${a.wristHidden}`});
  else if (fl > 4) {
    const fa = V.norm(V.sub(W2, E2));
    const ang = deg(Math.acos(Math.max(-1, Math.min(1, V.dot(fa, a.f)))));
    const towardU = V.dot(a.f, a.u) > V.dot(fa, a.u); // the hand turned towards side u (thumb or palm)
    const lim = LIM[a.view][towardU ? 'toU' : 'away'] + Math.max(0, 0.85 - r) * 120;
    if (ang > lim) bad('wrist', `bend ${ang.toFixed(0)}° ${towardU ? (a.view === 'dorsal' || a.view === 'palmar' ? 'towards the thumb' : 'towards the palm') : (a.view === 'dorsal' || a.view === 'palmar' ? 'towards the little finger' : 'towards the back')} (natural — up to ${lim.toFixed(0)}°)`);
  }
  // 4. the thumb (palm) is on the side where it is on a real hand of this arm
  const sv = sideVec(a.hand, a.view, a.f);
  if (!a.wristHidden && V.dot(sv, a.u) < 0.5) bad('hand', `thumb on the wrong side: hand ${a.hand === 'R' ? 'right' : 'left'}, view ${a.view} — twisted`);
  // 5. forearm rotation: the palm within a natural range from neutral (a bent elbow sets the neutral by the arm plane)
  if (inner < 155 && !a.wristHidden) {
    const up = V.norm(V.sub(E, S));
    const fo = V.norm(V.sub(W, E));
    let n0 = V.norm(V.cross(up, fo));
    if (a.hand === 'L') n0 = n0.map((x) => -x);
    const n = a.palm ?? palmNormal(a.view, a.u); // palm up under the phone (tap) — its own normal
    const pj = (v) => V.norm(v.map((x, i) => x - V.dot(v, fo) * fo[i]));
    if (Math.abs(V.dot(n, fo)) > 0.85) info.push({rule: 'rotation', msg: 'the forearm points at the viewer — the palm rotation is not visible in the frame'});
    else {
    const rot = deg(Math.acos(Math.max(-1, Math.min(1, V.dot(pj(n), pj(n0))))));
    if (rot > 100) bad('rotation', `palm rotated by ${rot.toFixed(0)}° from neutral (natural — up to 100°): the hand is twisted`);
    }
  }
  // 6. touch: the hand holds the prop
  if (a.grip && a.target) {
    const d = V.len(V.sub(a.grip, a.target));
    if (d > 8) bad('grip', `the hand does not touch the prop: ${d.toFixed(0)} units`);
  }
  // 7. a hanging arm reaches mid-thigh with its fingers
  if (a.hangRef !== undefined && a.tip[1] < a.hangRef - 4) bad('length', `hanging arm too short: fingers at ${a.tip[1].toFixed(0)}, mid-thigh at ${a.hangRef.toFixed(0)}`);
  // 7a. "wing": the hand at the chest (the wrist within the torso width), but the elbow sticks out sideways beyond the torso silhouette.
  // An arm hanging or reaching to the side (the wrist outside the torso) is not a wing
  if (!a.back && a.torsoX && Math.abs(W[0]) < a.torsoX && a.side * E[0] > a.torsoX + 30) bad('wing', `arm at the chest, the elbow ${(a.side * E[0] - a.torsoX).toFixed(0)} units beyond the torso silhouette (up to 30)`);
  // 8. stump: a visible segment foreshortened to less than half
  if (!a.hidden) {
    if (r < 0.55) (a.allowFore ? info : out).push({rule: 'foreshortening', msg: `forearm in the frame ${(r * 100).toFixed(0)} % of its length ${a.allowFore ? ' — ' + a.allowFore : ' — stump'}`});
    if (ru < 0.4) (a.allowFore ? info : out).push({rule: 'foreshortening', msg: `upper arm in the frame ${(ru * 100).toFixed(0)} % of its length ${a.allowFore ? ' — ' + a.allowFore : ' — stump'}`});
  }
  return {out, info, stats: {inner: +inner.toFixed(0), fore: +r.toFixed(2), upper: +ru.toFixed(2)}};
}

/** A journal point in frame pixels: the Remotion render page is shifted by −1 000 000 in y (getScreenCTM sees it). */
const fixY = (q) => (q ? [q[0], q[1] < -500_000 ? q[1] + 1_000_000 : q[1]] : q);

/** 9. "Hand without an arm": a visible hand with no forearm leading to it in the frame — not at the frame edge; and "kink": the hand in the
 *  frame at more than 50° to the visible forearm. fig — the figure record of the journal (ppu — pixels per figure unit), Wf × Hf — the
 *  frame. Returns a list of violations. */
function checkChain(a, fig, Wf, Hf) {
  const out = [];
  if (a.hideHand || a.hidden === 'all' || !a.scr?.W || !a.scr?.tip) return out;
  const W = fixY(a.scr.W);
  const T = fixY(a.scr.tip);
  const C = [(W[0] + T[0]) / 2, (W[1] + T[1]) / 2];
  if (C[0] < 0 || C[0] > Wf || C[1] < 0 || C[1] > Hf) return out; // hand out of frame
  const L2px = a.L2 * fig.ppu;
  const edge = (q) => Math.min(q[0], Wf - q[0], q[1], Hf - q[1]);
  const E2 = [a.E[0], a.E[1]];
  const W2 = [a.W[0], a.W[1]];
  const fl = Math.hypot(W2[0] - E2[0], W2[1] - E2[1]);
  const r = fl / a.L2;
  const E = fixY(a.scr.E);
  const eOut = E[0] < 0 || E[0] > Wf || E[1] < 0 || E[1] > Hf;
  let why = null;
  if (a.hidden === 'fore' || a.wristHidden) {
    // forearm behind a prop: allowed only if the hand itself is almost beyond the frame edge — otherwise a hand "on its own" is visible
    if (edge(C) >= 0.12 * L2px) why = a.hidden === 'fore' ? 'forearm behind a prop' : `wrist not visible (${a.wristHidden})`;
  } else if (r < 0.5) {
    // foreshortened forearm: allowed if the arm leaves over the edge (the elbow out of frame, at least a third visible) or the wrist
    // is at the edge
    if (!(eOut && r >= 0.33) && edge(W) >= 0.33 * L2px) why = `foreshortened forearm ${(r * 100).toFixed(0)} % of its length`;
  }
  if (why) out.push({rule: 'hand without an arm', msg: `${why}, hand ${edge(C).toFixed(0)} px from the frame edge — the arm does not read as the chain upper arm → elbow → forearm → hand`});
  // wrist kink in the frame: the forearm is visible (at least a third), and the hand is turned to it by more than 50°
  if (!a.wristHidden && a.hidden !== 'fore' && r >= 0.33) {
    const fa = [(W2[0] - E2[0]) / fl, (W2[1] - E2[1]) / fl];
    const bend = deg(Math.acos(Math.max(-1, Math.min(1, fa[0] * a.f[0] + fa[1] * a.f[1]))));
    if (bend > 50) out.push({rule: 'kink', msg: `hand in the frame at ${bend.toFixed(0)}° to the forearm (up to 50°) — the arm is "broken" at the wrist`});
  }
  return out;
}

/** Front neck by the head journal (Character → POSE.head): violations [{rule, msg}]. */
function checkNeck(fig) {
  const out = [];
  const h = fig.head;
  if (!h || fig.back || !h.jaw?.length) return out;
  const C = h.collar.map(fixY), T = h.top.map(fixY), J = h.jaw.map(fixY), K = fixY(h.skull);
  const ppu = fig.ppu;
  // bottom of the head under x: the lowest point of the jaw polyline on this vertical
  const under = (x) => {
    let y = -Infinity;
    for (let i = 1; i < J.length; i++) {
      const [x0, y0] = J[i - 1], [x1, y1] = J[i];
      if ((x - x0) * (x - x1) <= 0 && x0 !== x1) y = Math.max(y, y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
    }
    return y;
  };
  // visible neck at the sides: from the collar (the neck edge point on the collar line) up to the bottom of the head on the same vertical —
  // as the engine computes it
  const vis = C.map((c) => {
    const u = under(c[0]);
    return u === -Infinity ? 0 : Math.max(0, c[1] - u);
  });
  const hi = Math.max(...vis), lo = Math.min(...vis);
  // neck under a stand-up collar (padded jacket, open: false): in three quarters the side of the neck under the ear shows above the stand —
  // not a wedge. The engine keeps the smaller side no lower than 6 units and 0.25 of the larger (Character, NECK_MIN, NECK_BAND); the check
  // has a margin: 4 units and 0.22
  if (h.open !== false && hi >= Math.max(3, 5 * ppu) && (lo < 0.22 * hi || lo < 4 * ppu)) out.push({rule: 'neck wedge', msg: `visible neck at the sides ${vis.map((v) => v.toFixed(0)).join(' and ')} px — on one side the chin lies on the collar, the neck reads as a wedge`});
  const mb = [(C[0][0] + C[1][0]) / 2, (C[0][1] + C[1][1]) / 2], mt = [(T[0][0] + T[1][0]) / 2, (T[0][1] + T[1][1]) / 2];
  const lean = deg(Math.atan2(Math.abs(mt[0] - mb[0]), Math.max(1e-6, mb[1] - mt[1])));
  if (lean > 15) out.push({rule: 'neck slanted', msg: `neck axis at ${lean.toFixed(0)}° to vertical (up to 15°)`});
  const wb = Math.hypot(C[1][0] - C[0][0], C[1][1] - C[0][1]), wt = Math.hypot(T[1][0] - T[0][0], T[1][1] - T[0][1]);
  if (Math.abs(K[0] - mb[0]) > 0.6 * wb) out.push({rule: 'head not over the neck', msg: `skull centre ${Math.abs(K[0] - mb[0]).toFixed(0)} px from the middle of the neck at the collar (up to ${(0.6 * wb).toFixed(0)})`});
  if (wt < 0.8 * wb || wt > 1.7 * wb) out.push({rule: 'neck width', msg: `at the head ${wt.toFixed(0)} px, at the collar ${wb.toFixed(0)} px (0.8–1.7)`});
  return out;
}

/** Head from behind on a turn: lost-profile features are present (head journal: th — turn of the back of the head, eye — features 0..1). */
function checkBackTurn(fig) {
  const h = fig.head;
  if (!fig.back || !h || h.th === undefined) return [];
  if (h.th >= 0.6 && !(h.eye >= 0.3)) return [{rule: 'turn from behind without features', msg: `back of the head turned by ${h.th.toFixed(2)} rad, profile features ${(+(h.eye ?? 0)).toFixed(2)} — the cheek is an empty patch`}];
  return [];
}

// ---------- render ----------
const shots = timeline.shots.filter((s) => !only || only.includes(s.id));
const jobs = [];
for (const s of shots) {
  const set = new Set(fr.map((k) => Math.min(s.to - 1, s.from + Math.round(k * (s.to - s.from - 1)))));
  // gesture moments: the middle of the entry and almost the end of the event (the hand in the gesture pose)
  if (withGest) {
    for (const e of s.stage?.events ?? []) {
      if (e.do !== 'gesture' || e.t0 === undefined) continue;
      for (const q of [0.35, 0.75]) set.add(Math.min(s.to - 1, Math.max(s.from, s.from + Math.round((e.t0 + q * (e.t1 - e.t0)) * timeline.fps))));
    }
  }
  // look: before the event, in the middle and after — head and neck turned and tilted
  if (withLook) {
    for (const e of s.stage?.events ?? []) {
      if (e.do !== 'look' || e.t0 === undefined) continue;
      for (const tt of [e.t0 - 0.15, (e.t0 + e.t1) / 2, e.t1 + 0.2]) set.add(Math.min(s.to - 1, Math.max(s.from, s.from + Math.round(tt * timeline.fps))));
    }
  }
  for (const f of [...set].sort((x, y) => x - y)) jobs.push({shot: s.id, frame: f});
}
let poses = [];
const t0 = Date.now();
if (reuse) {
  poses = JSON.parse(fs.readFileSync(path.join(outDir, 'poses.json'), 'utf-8')).filter((p) => !only || only.includes(p.shot));
} else {
const inputProps = {timeline, clean: true};
// an own bundle folder and an own frame server port: the frame journal runs in parallel in the precheck step
const serveUrl = await bundleProject('hands');
const port = safePorts(5100 + (process.pid % 2000));
// one browser for the whole run (tools/remotion.mjs); if it does not start even after a retry — an environment error, code 3
const br = browsers('swangle');
const scale = noPng ? 0.25 : 1;
let composition;
try {
  composition = await selectComposition({serveUrl, id: `${timeline.channel}-chapter-poses`, inputProps, chromiumOptions: {gl: 'swangle'}, port, puppeteerInstance: await br.get(scale)});
} catch (e) {
  await br.close();
  envExit(e);
}
let cur = null;
const onBrowserLog = (log) => {
  if (cur && log.text.startsWith('POSE ')) {
    try {
      const j = JSON.parse(log.text.slice(5));
      cur.figs[j.who] = j; // a repeated render of the same frame — the last journal wins
    } catch {
      /* truncated journal line */
    }
  }
};
for (const job of jobs) {
  cur = {...job, figs: {}};
  const output = noPng ? path.join(outDir, 'frames', '_tmp.png') : path.join(outDir, 'frames', `c_${job.frame}.png`);
  try {
    await br.still(renderStill, {composition, serveUrl, output, frame: job.frame, inputProps, chromiumOptions: {gl: 'swangle'}, port, onBrowserLog, scale});
  } catch (e) {
    await br.close();
    envExit(e);
  }
  poses.push({shot: job.shot, frame: job.frame, figs: Object.values(cur.figs)});
}
cur = null;
await br.close();
fs.writeFileSync(path.join(outDir, 'poses.json'), JSON.stringify(poses));
}

// ---------- report ----------
const rows = [];
let nArms = 0;
for (const p of poses) {
  for (const fig of p.figs) {
    for (const a of fig.arms) {
      nArms++;
      const r = checkArm(a);
      r.out.push(...checkChain(a, fig, timeline.width ?? 1920, timeline.height ?? 1080));
      rows.push({shot: p.shot, frame: p.frame, who: fig.who, side: a.side < 0 ? 'left in frame' : 'right in frame', hand: a.hand, hold: a.pose ? `${a.hold} · gesture ${a.pose}` : a.hold, back: a.back, ...r});
    }
  }
}
let nNeck = 0;
for (const p of poses) {
  for (const fig of p.figs) {
    if (!fig.head?.jaw || fig.back) continue;
    nNeck++;
    rows.push({shot: p.shot, frame: p.frame, who: fig.who, side: 'neck', hand: '-', hold: `neck · turn ${(+fig.head.turn).toFixed(2)}, tilt ${(+fig.head.tilt).toFixed(1)}°, looking down ${(+fig.head.gy).toFixed(2)}`, back: false, out: checkNeck(fig), info: [], stats: {h: fig.head.h, dy: fig.head.dy}});
  }
}
let nBack = 0;
for (const p of poses) {
  for (const fig of p.figs) {
    if (!fig.back || fig.head?.th === undefined) continue;
    nBack++;
    rows.push({shot: p.shot, frame: p.frame, who: fig.who, side: 'head from behind', hand: '-', hold: `back of the head turned by ${(+fig.head.th).toFixed(2)} rad`, back: true, out: checkBackTurn(fig), info: [], stats: {eye: fig.head.eye, ear: fig.head.ear}});
  }
}
const viol = rows.filter((r) => r.out.length);

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({date: new Date().toISOString(), work, frames: poses.length, arms: nArms, necks: nNeck, backHeads: nBack, violations: viol.length, rows}, null, 1));
const lines = [`Arm pose check: ${poses.length} frames, ${nArms} figure arms, ${nNeck} front necks and ${nBack} heads from behind, violations: ${viol.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`];
for (const r of viol) lines.push(`${r.shot} · frame ${r.frame} · ${r.who} · ${r.side}${r.hand === '-' ? '' : ` (${r.hand === 'R' ? 'right' : 'left'} hand)`} · ${r.hold}${r.back ? ' · from behind' : ''}: ${r.out.map((o) => `[${o.rule}] ${o.msg}`).join('; ')}`);
const infos = rows.filter((r) => r.info.length);
if (infos.length) {
  lines.push('', 'Notes (not violations — the view is intended by the pose):');
  const seen = new Set();
  for (const r of infos) {
    const key = `${r.shot}|${r.who}|${r.hold}|${r.info.map((o) => o.msg).join()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${r.shot} · ${r.who} · ${r.hold}: ${r.info.map((o) => o.msg).join('; ')}`);
  }
}
fs.writeFileSync(path.join(outDir, 'report.txt'), lines.join('\n') + '\n', 'utf-8');
console.log(lines.slice(0, 40).join('\n'));
process.exit(viol.length ? 1 : 0);
