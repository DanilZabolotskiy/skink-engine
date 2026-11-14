// Arm pose check over all shots of a chapter, on stills from the code copy (no video). For every arm of every figure: upper arm and
// forearm lengths, the elbow, the wrist bend, the thumb side, the palm turn, the touch of the prop, a hanging arm reaching mid-thigh, a
// foreshortened stump, a wing (the elbow of an arm at the chest sticking out of the silhouette), gesture poses (pull, push, rail, count,
// tap, dial, hangup) touching the reach point; plus:
// - hand without an arm: a visible hand in mid-frame with no forearm leading to it — the forearm is behind a prop (hidden 'fore',
//   wristHidden) or foreshortened to less than half, so the arm does not read as the chain upper arm → elbow → forearm → hand; allowed
//   only if the arm leaves over the frame edge (the elbow beyond the edge, the wrist at the edge) or the hand behind a prop is almost all
//   beyond the edge;
// - kink: the hand in the frame at more than 50° to the visible forearm;
// - finger: the skeleton pose of the hand (the joint bends from the pose journal) — four fingers and a thumb, every joint bends only towards
//   the palm and within natural limits; and, by the self-check of the drawn hand of the style (CharacterStyle.handAudit), a finger base
//   is not torn off the palm;
// - fingers apart: from the side the fingers are together (the notch between neighbouring fingers of the style drawing is shallow);
// - wrap: a fist holds its prop (at least three fingers lie on it, by the style self-check);
// - prop through the arm: a long prop in the fist of a raised arm is not drawn over the forearm along it;
// - front neck, by the head journal (collar, top of the neck, bottom of the head, skull centre): the visible neck at the sides is not a
//   wedge (with an open collar the smaller side is at least 0.22 of the larger and at least 4 units), the neck axis is within 15° of the
//   vertical, the skull centre is within 0.6 of the neck width from the middle of the neck at the collar, the width at the head is 0.8–1.7
//   of the width at the collar;
// - turn from behind without features: the back of the head turned by 0.6 rad or more, but the lost-profile features (lid, lashes, brow,
//   nose tip) are missing in the head journal or below 0.3.
//
// A note "pose adjusted": the engine removed an impossible wrist bend or a twisted palm of the pose (arm.ts: wristClamp, liveView) — the
// frame is right, but the point or the pose in the staging is worth fixing.
//
// node tools/hands_check.mjs <absolute chapter work folder> [--shots 01.01,23.01] [--at 0.08,0.5,0.92] [--out check/arms] [--no-png]
//   [--no-look] [--no-gest] [--motion] [--frames 120,455,…] [--reuse]          (run from the code copy: cd "$(python tools/mirror.py)")
// --frames — only these chapter frames (the pose journal at the given frames: a comparison with the frames of tools/guard.py), without the
//   fractions --at and the events. --motion — the frames of the entry and the exit of every gesture every 2 frames (0.5 s from the event
//   start and 0.5 s at its end): the rule "jump" — the elbow, the wrist, the hand turn and the fingers between neighbouring frames (a hand
//   swapped on the way, a jerk of the arm).
// node tools/hands_check.mjs --sweep [--full] [--style webtoon] [--out <folder>]
//   a sweep of the engine poses without a chapter and without a render (tools/hands_sweep.ts): every hold, every gesture with its sides,
//   grips and a grid of hand points, the entry and the exit of a gesture frame by frame, walking and running, from the front and from
//   behind, different figures — the arm journal right from bodyPose with the self-check of the style hands. It checks the same as on the
//   chapter frames (joints, fingers) and what the rare frames do not show: "jump" (the elbow, the wrist, the hand turn, the fingers between
//   neighbouring frames of a motion — a swapped hand drawing, a jittering view) and "mirror" (the left arm mirrors the right one). Run it
//   after an edit of lib/character (arm.ts, hand.ts, body.ts) or of the hands of a style: 0 violations. The report — <out>/report.txt
//   (default check/arms_sweep).
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
const sweepMode = args.includes('--sweep');
const work = path.resolve(sweepMode ? '.' : args[0]);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const outDir = sweepMode ? path.resolve(opt('out', 'check/arms_sweep')) : path.join(work, opt('out', 'check/arms'));
const fr = opt('at', '0.08,0.5,0.92').split(',').map(Number);
const only = opt('shots', null)?.split(',');
const noPng = args.includes('--no-png');
const reuse = args.includes('--reuse');
const withGest = !args.includes('--no-gest');
const withLook = !args.includes('--no-look');
const withMotion = args.includes('--motion');
const onlyFrames = opt('frames', null)?.split(',').map(Number);
const timeline = sweepMode ? {shots: [], fps: 30} : JSON.parse(fs.readFileSync(path.join(work, 'timeline.json'), 'utf-8'));
fs.mkdirSync(sweepMode ? outDir : path.join(outDir, 'frames'), {recursive: true});

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

/** Finger joint limits, degrees (lib/character/hand.ts, JOINT_LIM): the base, the middle, the far joint; a bend only towards the palm (≥ 0). */
const FINGER_LIM = [91.7, 111.7, 71.6];
const THUMB_FLEX = 68.8;
const FINGER_NAMES = ['index', 'middle', 'ring', 'little'];
const JOINT_NAMES = ['at the base', 'at the middle joint', 'at the far joint'];
/** The fingers of the skeleton pose of a hand (journal fingers, thumb): four fingers, every joint from 0 (straight) to its natural limit. */
function checkFingers(a) {
  const out = [];
  if (!a.fingers) return out;
  if (a.fingers.length !== 4) out.push({rule: 'finger', msg: `${a.fingers.length} fingers instead of four`});
  a.fingers.forEach((c, i) => c.forEach((v, k) => {
    if (!(v >= -0.6)) out.push({rule: 'finger', msg: `the ${FINGER_NAMES[i]} finger is bent backwards ${JOINT_NAMES[k]} by ${(-v).toFixed(0)}° — a broken finger`});
    else if (v > FINGER_LIM[k] + 0.6) out.push({rule: 'finger', msg: `the ${FINGER_NAMES[i]} finger is bent ${JOINT_NAMES[k]} by ${v.toFixed(0)}° (natural — up to ${FINGER_LIM[k].toFixed(0)}°)`});
  }));
  if (a.thumb) {
    const [abd, flex, opp] = a.thumb;
    if (!(abd >= -0.01 && abd <= 1.01) || !(opp >= -0.01 && opp <= 1.01) || !(flex >= -0.6 && flex <= THUMB_FLEX + 0.6)) out.push({rule: 'finger', msg: `the thumb is beyond natural limits: abduction ${abd}, bend ${flex}°, opposition ${opp}`});
  } else out.push({rule: 'finger', msg: 'the hand has no thumb'});
  return out;
}

/** The hand drawing (journal fgap, notch, wrap, item — the self-check of the style and the core): a finger base no farther than FGAP hand
 *  frame units from the palm outline; from the side the notch between neighbouring fingers no deeper than NOTCH; a long prop (beyond the
 *  wrist by LONG_ITEM units) in the fist of a raised arm over the sleeve of the forearm (sleeve half-width ARM_R) — no longer than THROUGH
 *  units. Checked on a pose that read "through the arm" (a mop handle over a raised arm covered the sleeve by 37 units — the rule catches
 *  it; behind the arm — 0). */
const FGAP = 1.5;
const NOTCH = 8;
const THROUGH = 20;
const LONG_ITEM = 60;
const ARM_R = 18;
/** Violations of one arm: [{rule, msg}]; info — notes without a violation. */
function checkArm(a) {
  const out = [];
  const info = [];
  const bad = (rule, msg) => out.push({rule, msg});
  const {S, E, W} = a;
  out.push(...checkFingers(a));
  // the hand drawing (the self-check of the style, CharacterStyle.handAudit): the fingers grow from the palm; from the side the fingers are
  // together; a fist holds its prop
  if (!a.hideHand && a.hidden !== 'all') {
    if (a.fgap > FGAP) bad('finger', `a finger is torn off the palm: its base is ${a.fgap.toFixed(1)} hand frame units from the palm outline (up to ${FGAP})`);
    // (counting on fingers — the fingers apart by design: they unbend one by one)
    if (a.notch > NOTCH && (a.view === 'radial' || a.view === 'ulnar') && a.shape !== 'count') bad('fingers apart', `side view: the notch between neighbouring fingers is ${a.notch.toFixed(1)} hand frame units (up to ${NOTCH}) — a "rake" instead of fingers together`);
    // (on the way of a gesture the pose is intermediate — as for "wing" and foreshortening)
    if (a.wrap !== undefined && a.wrap < 3 && !a.moving && !a.itemMoving) bad('wrap', `a fist without a grip: ${a.wrap} of four fingers lie on the prop (at least three needed)`);
  }
  if (a.wristCut) info.push({rule: 'pose adjusted', msg: `the pose asked for the hand at ${a.wristCut.toFixed(0)}° more to the forearm than natural — the engine kept a natural wrist bend`});
  if (a.viewWant) info.push({rule: 'pose adjusted', msg: `the pose asked for the view ${a.viewWant} — the palm would be twisted; the hand is drawn in the nearest natural turn (${a.view})`});
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
  if (!a.moving && ol > 6 && off[1] < -0.25 * ol && a.side * off[0] < 0.5 * ol && backward < 0.5 * ol) bad('elbow', `elbow sticks up (offset ${off.map((x) => x.toFixed(0)).join(', ')})`);
  // 3. wrist: the hand continues the forearm, the bend within a natural range (in the frame; a foreshortened forearm gets a larger
  // tolerance)
  const E2 = [E[0], E[1]];
  const W2 = [W[0], W[1]];
  const fl = V.len(V.sub(W2, E2));
  const r = fl / a.L2;
  const ru = V.len(V.sub(E2, [S[0], S[1]])) / a.L1;
  if (a.wristHidden) info.push({rule: 'wrist', msg: `not visible: ${a.wristHidden}`});
  else if (r >= 0.15) { // a forearm almost a point in the frame (towards the viewer) — no line, a bend to it is not seen
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
  if (!a.back && !a.moving && a.torsoX && Math.abs(W[0]) < a.torsoX && a.side * E[0] > a.torsoX + 30.5) bad('wing', `arm at the chest, the elbow ${(a.side * E[0] - a.torsoX).toFixed(0)} units beyond the torso silhouette (up to 30)`);
  // 7b. prop through the arm: a long prop in the fist of a raised arm (the wrist above the elbow; long — it comes out of the fist towards the
  // elbow beyond the wrist by more than LONG_ITEM units) is drawn over the forearm and goes along it — it reads "through the arm". The prop
  // comes out of the fist and goes behind the arm. A lowered arm does not count: a mop in a lowered hand stands in front of the arm, the
  // handle at the shoulder — by design
  const itemBack = a.item ? Math.max(a.item.t0 * V.dot(a.item.d, V.norm(V.sub(E2, W2))), a.item.t1 * V.dot(a.item.d, V.norm(V.sub(E2, W2)))) - V.len(V.sub(a.item.p, W2)) : 0;
  if (a.item?.over && itemBack > LONG_ITEM && W[1] < E[1] - 4 && !a.hideHand) {
    const it = a.item;
    const A = [it.p[0] + it.d[0] * it.t0, it.p[1] + it.d[1] * it.t0], B = [it.p[0] + it.d[0] * it.t1, it.p[1] + it.d[1] * it.t1];
    const hl = a.handLen ?? 0;
    let n = 0;
    const N = 60;
    for (let i = 0; i <= N; i++) {
      // points of the forearm from the wrist to the elbow, without the part at the hand (the prop is in the fist there); the prop covers the
      // sleeve where its axis is nearer to the forearm axis than the half-widths of the sleeve and the prop together
      const q = [W2[0] + ((E2[0] - W2[0]) * i) / N, W2[1] + ((E2[1] - W2[1]) * i) / N];
      if (V.len(V.sub(q, W2)) < 0.25 * hl) continue;
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / l2));
      if (Math.hypot(q[0] - A[0] - dx * t, q[1] - A[1] - dy * t) < it.w + ARM_R) n++;
    }
    const over = (n / (N + 1)) * fl;
    if (over > THROUGH) bad('prop through the arm', `the prop in the fist goes over the forearm sleeve for ${over.toFixed(0)} units (up to ${THROUGH}) — it must go behind the arm`);
  }
  // 8. stump: a visible segment foreshortened to less than half
  if (!a.hidden && !a.moving) {
    if (r < 0.55) (a.allowFore ? info : out).push({rule: 'foreshortening', msg: `forearm in the frame ${(r * 100).toFixed(0)} % of its length ${a.allowFore ? ' — ' + a.allowFore : ' — stump'}`});
    if (ru < 0.4) (a.allowFore ? info : out).push({rule: 'foreshortening', msg: `upper arm in the frame ${(ru * 100).toFixed(0)} % of its length ${a.allowFore ? ' — ' + a.allowFore : ' — stump'}`});
  }
  return {out, info, stats: {inner: +inner.toFixed(0), fore: +r.toFixed(2), upper: +ru.toFixed(2)}};
}

/** "Jump" between neighbouring frames of an arm motion: a — the arm earlier, b — the same arm dt frames later (30 frames a second). The
 *  elbow and the wrist do not jump (figure units a frame), the hand does not turn with a jerk, the fingers do not change their bend with
 *  a jump (a swapped hand drawing instead of a motion by the joints). A change of the hand view (back ↔ edge ↔ palm) is a forearm rotation,
 *  not a violation. */
const JUMP = {W: 150, E: 100, turn: 110, wrist: 42, finger: 55};
/** The signed wrist bend in the frame, degrees: from the forearm line to the fingers (a forearm almost a point — null). */
const wristAng = (a) => {
  const fx = a.W[0] - a.E[0], fy = a.W[1] - a.E[1];
  if (Math.hypot(fx, fy) < 0.3 * a.L2) return null;
  return deg(Math.atan2(fx * a.f[1] - fy * a.f[0], fx * a.f[0] + fy * a.f[1]));
};
function checkJump(a, b, dt = 1) {
  const out = [];
  const d3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const dW = d3(a.W, b.W) / dt;
  const dE = d3(a.E, b.E) / dt;
  if (dW > JUMP.W) out.push({rule: 'jump', msg: `the wrist jumps by ${dW.toFixed(0)} units a frame (up to ${JUMP.W})`});
  if (dE > JUMP.E) out.push({rule: 'jump', msg: `the elbow jumps by ${dE.toFixed(0)} units a frame (up to ${JUMP.E})`});
  // the hand: on a fast swing it turns with the forearm — that is the motion; a jump is when it flips by itself within a frame (the wrist
  // bend changes with a jerk) or turns by more than JUMP.turn
  const turn = deg(Math.acos(Math.max(-1, Math.min(1, a.f[0] * b.f[0] + a.f[1] * b.f[1])))) / dt;
  const wa = wristAng(a), wb = wristAng(b);
  // a foreshortened forearm (shorter than a third of its length in the frame) passes "towards the viewer" and turns in the frame by itself —
  // the hand goes with it: that is the motion of the arm. A jump — the hand turned noticeably more than the forearm
  const rf = (x) => Math.hypot(x.W[0] - x.E[0], x.W[1] - x.E[1]) / x.L2;
  const fdir = (x) => [(x.W[0] - x.E[0]) / (rf(x) * x.L2 || 1), (x.W[1] - x.E[1]) / (rf(x) * x.L2 || 1)];
  const fturn = deg(Math.acos(Math.max(-1, Math.min(1, fdir(a)[0] * fdir(b)[0] + fdir(a)[1] * fdir(b)[1])))) / dt;
  if (!a.hideHand && !b.hideHand) {
    if (turn > JUMP.turn && Math.min(rf(a), rf(b)) >= 0.35 && turn - fturn > 60) out.push({rule: 'jump', msg: `the hand turns by ${turn.toFixed(0)}° a frame (up to ${JUMP.turn})`});
    else if (wa !== null && wb !== null && Math.abs(wa - wb) / dt > JUMP.wrist) out.push({rule: 'jump', msg: `the hand flips at the wrist by ${(Math.abs(wa - wb) / dt).toFixed(0)}° a frame (up to ${JUMP.wrist})`});
  }
  if (a.fingers && b.fingers && !a.hideHand && !b.hideHand) {
    let m = 0;
    a.fingers.forEach((c, i) => c.forEach((v, k) => (m = Math.max(m, Math.abs(v - b.fingers[i][k])))));
    if (m / dt > JUMP.finger) out.push({rule: 'jump', msg: `the fingers change their bend by ${(m / dt).toFixed(0)}° a frame (up to ${JUMP.finger}) — the hand shape ${a.shape} → ${b.shape} is swapped instead of going by the joints`});
  }
  return out;
}

/** "Mirror": arm b — the same pose with the other arm (the props, the gesture side and the hand point mirrored) — must mirror arm a: the
 *  joints mirrored in x, the same view and shape, the hand of the other arm. */
function checkMirror(a, b) {
  const out = [];
  const far = (p, q, tol) => Math.abs(p[0] + q[0]) > tol || Math.abs(p[1] - q[1]) > tol;
  if (a.hand === b.hand) out.push({rule: 'mirror', msg: `the hand of the same arm (${a.hand}) — it must be the other one`});
  if (a.view !== b.view || a.shape !== b.shape) out.push({rule: 'mirror', msg: `the hand ${a.shape}/${a.view} on one arm and ${b.shape}/${b.view} on the other`});
  for (const k of ['S', 'E', 'W']) if (far(a[k], b[k], 0.8)) out.push({rule: 'mirror', msg: `point ${k} is not mirrored: ${a[k].slice(0, 2).map((v) => v.toFixed(0))} and ${b[k].slice(0, 2).map((v) => v.toFixed(0))}`});
  if (far(a.f, b.f, 0.03)) out.push({rule: 'mirror', msg: `the fingers do not point as a mirror: ${a.f.map((v) => v.toFixed(2))} and ${b.f.map((v) => v.toFixed(2))}`});
  if (Math.abs(a.u[0] + b.u[0]) > 0.03 || Math.abs(a.u[1] - b.u[1]) > 0.03) out.push({rule: 'mirror', msg: 'the thumb side is not mirrored'});
  return out.slice(0, 2);
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

// ---------- a sweep of the engine poses (--sweep) ----------
if (sweepMode) {
  const {build} = await import('esbuild');
  const {pathToFileURL} = await import('node:url');
  const tmp = path.join((await import('node:os')).tmpdir(), `hands-sweep-${process.pid}.mjs`); // a self-contained bundle — outside the project folder
  process.on('exit', () => fs.rmSync(tmp, {force: true}));
  await build({entryPoints: [path.resolve('tools/hands_sweep.ts')], bundle: true, platform: 'node', format: 'esm', outfile: tmp, jsx: 'automatic', logLevel: 'error',
    banner: {js: "import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);"}});
  const {sweep} = await import(pathToFileURL(tmp).href);
  const t0s = Date.now();
  const byRule = {};
  const examples = [];
  const notes = {};
  let nArm = 0, nJump = 0, nMir = 0;
  let prev = null;
  let flips = 0;
  const hit = (s, a, o) => {
    byRule[o.rule] = (byRule[o.rule] ?? 0) + 1;
    const key = `${o.rule}|${s.seq ?? s.id}|${a.side}`;
    if (!examples.some((e) => e.key === key)) examples.push({key, rule: o.rule, id: s.seq ?? s.id, step: s.step, k: s.gest?.k, ph: s.gest?.ph, side: a.side < 0 ? 'left in frame' : 'right in frame', hand: a.hand, hold: a.pose ? `${a.hold} · gesture ${a.pose}` : a.hold,
      shape: `${a.shape}/${a.view}`, msg: o.msg});
  };
  const UNREACH = 'the hand point cannot be reached by a natural pose — the hand stops next to it';
  const n = sweep((s) => {
    for (const a of s.arms) {
      nArm++;
      const r = checkArm(a);
      for (const o of r.out) {
        // a hand point of the sweep grid may be out of reach of a natural arm (too near, behind the back, above the head): the engine does
        // not twist the hand to it — it stops next to it. In a chapter that is a "grip" violation (the staging sets the point), here a note
        if (o.rule === 'grip' && s.reach && a.pose) notes[UNREACH] = (notes[UNREACH] ?? 0) + 1;
        else hit(s, a, o);
      }
      for (const o of r.info) if (o.rule === 'pose adjusted') {
        const k = o.msg.split(' — ')[0].replace(/at \d+°/, 'at N°');
        notes[k] = (notes[k] ?? 0) + 1;
      }
    }
    // jump: neighbouring frames of one motion
    if (s.seq && prev && prev.seq === s.seq && s.dt === 1) {
      for (const a of s.arms) {
        const b = prev.arms.find((x) => x.side === a.side);
        if (!b) continue;
        nJump++;
        for (const o of checkJump(b, a)) hit(s, a, o);
        if (a.view !== b.view) flips++;
      }
    } else flips = 0;
    // a jittering view: within one entry or exit of a gesture the hand views change more than six times (both arms counted)
    if (flips > 6) {
      hit(s, s.arms[0], {rule: 'jump', msg: `the hand view changed ${flips} times within a gesture motion — jitter`});
      flips = 0;
    }
    // mirror
    if (s.mirror) {
      // carrying in both arms — the forearms crossed, one above the other: not a mirror by design
      if (!s.holds.includes('carry')) {
        for (const a of s.arms) {
          const b = s.mirror.find((x) => x.side === -a.side);
          if (!b) continue;
          nMir++;
          for (const o of checkMirror(a, b)) hit(s, a, o);
        }
      }
    }
    prev = s;
  }, args.includes('--full'), opt('style', 'webtoon'));
  const total = Object.values(byRule).reduce((x, y) => x + y, 0);
  const lines = [`Sweep of the engine arm poses: ${n} poses, ${nArm} arms, ${nJump} pairs of neighbouring motion frames, ${nMir} mirror pairs; violations: ${total} (${((Date.now() - t0s) / 1000).toFixed(0)} s)`];
  for (const [r, c] of Object.entries(byRule).sort((x, y) => y[1] - x[1])) lines.push(`  ${r}: ${c}`);
  const shown = {};
  for (const e of examples) {
    shown[e.rule] = (shown[e.rule] ?? 0) + 1;
    if (shown[e.rule] > 25) continue;
    lines.push(`[${e.rule}] ${e.id}${e.step !== undefined ? ` · step ${e.step}` : ''}${e.k !== undefined ? ` (k ${(+e.k).toFixed(2)}, ph ${(+e.ph).toFixed(2)})` : ''} · ${e.side} (${e.hand}) · ${e.hold} · ${e.shape}: ${e.msg}`);
  }
  if (Object.keys(notes).length) {
    lines.push('', 'Poses the engine brought to natural ones (not violations):');
    for (const [k, c] of Object.entries(notes).sort((x, y) => y[1] - x[1])) lines.push(`  ${c} × ${k}`);
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({date: new Date().toISOString(), poses: n, arms: nArm, jumps: nJump, mirrors: nMir, violations: total, byRule, examples, notes}, null, 1));
  fs.writeFileSync(path.join(outDir, 'report.txt'), lines.join('\n') + '\n', 'utf-8');
  console.log(lines.slice(0, 60).join('\n'));
  process.exit(total ? 1 : 0);
}

// ---------- render ----------
const shots = timeline.shots.filter((s) => !only || only.includes(s.id));
const jobs = [];
const motion = new Set(); // frames of the gesture motions (--motion)
for (const s of shots) {
  if (onlyFrames) {
    for (const f of onlyFrames.filter((x) => x >= s.from && x < s.to).sort((x, y) => x - y)) jobs.push({shot: s.id, frame: f});
    continue;
  }
  const set = new Set(fr.map((k) => Math.min(s.to - 1, s.from + Math.round(k * (s.to - s.from - 1)))));
  // gesture moments: the middle of the entry and almost the end of the event (the hand in the gesture pose)
  if (withGest) {
    for (const e of s.stage?.events ?? []) {
      if (e.do !== 'gesture' || e.t0 === undefined) continue;
      for (const q of [0.35, 0.75]) set.add(Math.min(s.to - 1, Math.max(s.from, s.from + Math.round((e.t0 + q * (e.t1 - e.t0)) * timeline.fps))));
      // --motion: the entry and the exit of a gesture every 2 frames — "jump" between neighbouring frames
      if (withMotion) {
        for (const [a, b] of [[e.t0 - 0.05, e.t0 + 0.5], [e.t1 - 0.15, e.t1 + 0.45]]) {
          const f0 = Math.max(s.from, s.from + Math.round(a * timeline.fps)), f1 = Math.min(s.to - 1, s.from + Math.round(b * timeline.fps));
          for (let f = f0; f <= f1; f += 2) {
            set.add(f);
            motion.add(f);
          }
        }
      }
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
// "jump": the frames of the gesture motions (--motion), neighbouring in time within one shot — the same arm of the same figure
let nJumpF = 0;
if (withMotion) {
  const seq = poses.filter((p) => motion.has(p.frame)).sort((x, y) => x.frame - y.frame);
  for (let i = 1; i < seq.length; i++) {
    const p0 = seq[i - 1], p1 = seq[i];
    const dt = p1.frame - p0.frame;
    if (p0.shot !== p1.shot || dt > 3) continue;
    for (const fig of p1.figs) {
      const f0 = p0.figs.find((x) => x.who === fig.who);
      if (!f0 || f0.back !== fig.back) continue;
      for (const a of fig.arms) {
        const b = f0.arms.find((x) => x.side === a.side);
        if (!b) continue;
        nJumpF++;
        const out = checkJump(b, a, dt);
        if (out.length) rows.push({shot: p1.shot, frame: p1.frame, who: fig.who, side: a.side < 0 ? 'left in frame' : 'right in frame', hand: a.hand, hold: `${a.pose ? `${a.hold} · gesture ${a.pose}` : a.hold} · motion from frame ${p0.frame}`, back: a.back, out, info: [], stats: {}});
      }
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
const lines = [`Arm pose check: ${poses.length} frames, ${nArms} figure arms${withMotion ? `, ${nJumpF} pairs of gesture motion frames` : ''}, ${nNeck} front necks and ${nBack} heads from behind, violations: ${viol.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`];
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
