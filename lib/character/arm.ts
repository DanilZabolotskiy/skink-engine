// Arm skeleton, shared by every drawing style: upper arm and forearm of constant length, two-segment IK in 3D with an elbow pole, an
// orthographic projection onto the frame. Figure axes: x — right on screen, y — down, z — towards the viewer. From behind z is also
// towards the viewer (that is, towards the figure's back).
// Hand: the frame at the wrist — f (towards the fingers, in the frame) and u (towards the thumb for the dorsal/palmar views, towards the
// palm for radial/ulnar). A natural hand: side u follows from which hand it is (right/left) and how it is turned to the viewer — sideVec.
// Poses are written to the journal (PoseLogCtx), checked by tools/hands_check.mjs.
import React from 'react';

export type Pt = [number, number];
export type V3 = [number, number, number];

/** Arm lengths in figure units (height 1010): upper arm — from the shoulder joint to the elbow, forearm — from the elbow to the wrist. */
export const ARM_L1 = 162;
export const ARM_L2 = 138;

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};

/** The elbow does not fold more than a living one: the inner angle is at least ELBOW_MIN (degrees) — the shoulder → wrist distance is at
 *  least that. */
export const ELBOW_MIN = 30.5;
const ELBOW_DMIN = (L1: number, L2: number) => Math.sqrt(L1 * L1 + L2 * L2 - 2 * L1 * L2 * Math.cos((ELBOW_MIN * Math.PI) / 180));

/** Two-segment IK: shoulder joint S, wrist target T, elbow pole (where the elbow points). Lengths do not change:
 *  a target farther than L1 + L2 — the wrist on the ray to the target (the arm stretched); nearer than a natural elbow bend allows
 *  (ELBOW_MIN) — it is pushed away along the same ray; otherwise the elbow bends. */
export function ik3(S: V3, T: V3, pole: V3, L1 = ARM_L1, L2 = ARM_L2): {E: V3; W: V3} {
  const d = v3.sub(T, S);
  const dl = v3.len(d);
  const u: V3 = dl > 1e-6 ? v3.mul(d, 1 / dl) : [0, 1, 0];
  const D = Math.min((L1 + L2) * 0.999, Math.max(ELBOW_DMIN(L1, L2), dl));
  const W = v3.add(S, v3.mul(u, D));
  const a = (L1 * L1 - L2 * L2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  let p = v3.sub(pole, v3.mul(u, v3.dot(pole, u)));
  if (v3.len(p) < 1e-6) p = v3.sub([0, 0, -1], v3.mul(u, u[2] * -1));
  p = v3.norm(p);
  return {E: v3.add(v3.add(S, v3.mul(u, a)), v3.mul(p, h)), W};
}

/** Direction by angles: abduction to the side (rad, + outwards, s — side on screen) and forward towards the viewer (rad). */
export const dirOf = (s: number, abd: number, fwd: number): V3 => v3.norm([s * Math.sin(abd), Math.cos(abd) * Math.cos(fwd), Math.cos(abd) * Math.sin(fwd)]);

export type HandSide = 'R' | 'L';
/** How the hand is turned to the viewer: back, palm, edge on the thumb side or on the little finger side. */
export type HandView = 'dorsal' | 'palmar' | 'radial' | 'ulnar';

/** Which hand it is: from the front the figure's right hand is on the left of the screen, from behind — on the right. */
export const handOf = (s: number, back: boolean): HandSide => ((s < 0) !== back ? 'R' : 'L');

/** Side of the thumb (dorsal, palmar) or the palm (radial, ulnar) on screen for a natural hand with fingers along f.
 *  A right hand with its back to the viewer, fingers up — the thumb on the left; palm to the viewer — on the right. */
export function sideVec(hand: HandSide, view: HandView, f: Pt): Pt {
  const k = (hand === 'R' ? 1 : -1) * (view === 'dorsal' || view === 'radial' ? 1 : -1);
  return [k * f[1], -k * f[0]];
}

/** Palm normal in 3D (where the palm faces) by the hand view: back to the viewer — the palm away from the viewer. */
export function palmNormal(view: HandView, u: Pt): V3 {
  if (view === 'dorsal') return [0, 0, -1];
  if (view === 'palmar') return [0, 0, 1];
  return [u[0], u[1], 0];
}

/** Wrist limits in the frame, degrees from the forearm line: toU — towards side u (dorsal, palmar views — towards the thumb; side
 *  views — towards the palm), away — the other way (towards the little finger / the back of the hand). The same numbers are in
 *  tools/hands_check.mjs (LIM). */
export const WRIST_LIM: Record<HandView, {toU: number; away: number}> = {
  dorsal: {toU: 25, away: 40},
  palmar: {toU: 25, away: 40},
  radial: {toU: 75, away: 60},
  ulnar: {toU: 75, away: 60},
};
/** The wrist bend limit during the motion of a gesture, degrees (one for all views). */
export const WRIST_MOVE = 24;
/** The hand continues the forearm: the finger direction f is brought into a natural wrist bend. fa — the forearm in the frame, r — the
 *  visible share of its length (a foreshortened forearm line in the frame is short and imprecise — the tolerance is wider, as in the
 *  check); wk < 1 — the arm in motion. Returns f, the bend and how much was cut off, degrees. */
export function wristClamp(fa: Pt, f: Pt, hand: HandSide, view: HandView, r: number, wk = 1): {f: Pt; bend: number; cut: number} {
  const ang = Math.atan2(fa[0] * f[1] - fa[1] * f[0], fa[0] * f[0] + fa[1] * f[1]); // from the forearm to the hand, rad (signed)
  const u0 = sideVec(hand, view, fa);
  const sU = Math.sign(fa[0] * u0[1] - fa[1] * u0[0]) || 1; // the sign of a turn "towards side u"
  const toU = ang * sU > 0;
  // wk < 1 — the arm in motion (the entry and exit of a gesture): one limit for all views (WRIST_MOVE), so that the hand direction does
  // not jump when the hand view changes on the way; towards the end of the motion (wk → 1) — the limit of the view
  const full = WRIST_LIM[view][toU ? 'toU' : 'away'] - 0.01 + Math.max(0, 0.85 - r) * 120;
  const lim = ((WRIST_MOVE + (full - WRIST_MOVE) * Math.max(0, Math.min(1, wk))) * Math.PI) / 180;
  // a pose asking for the hand almost backwards along the forearm (beyond 90°): the hand returns to the forearm line smoothly (lim · sin)
  // instead of flipping from one limit to the other when the request passes through "straight back"
  const a = Math.abs(ang) <= Math.PI / 2 ? Math.max(-lim, Math.min(lim, ang)) : Math.sign(ang) * Math.min(lim, Math.PI / 2) * Math.sin(Math.abs(ang));
  if (a === ang) return {f, bend: (Math.abs(ang) * 180) / Math.PI, cut: 0};
  return {f: [fa[0] * Math.cos(a) - fa[1] * Math.sin(a), fa[0] * Math.sin(a) + fa[1] * Math.cos(a)], bend: (Math.abs(a) * 180) / Math.PI, cut: ((Math.abs(ang) - Math.abs(a)) * 180) / Math.PI};
}

/** Forearm rotation: the angle between the palm of view and its neutral for a bent arm (the palm in the arm plane, the thumb up),
 *  degrees; an almost straight arm or a forearm pointing at the viewer — 0 (the rotation is undefined / not visible). */
export function twistOf(hand: HandSide, view: HandView, S: V3, E: V3, W: V3, f: Pt, palm?: V3): number {
  const up = v3.norm(v3.sub(E, S));
  const fo = v3.norm(v3.sub(W, E));
  if (v3.dot(up, fo) > Math.cos((25 * Math.PI) / 180)) return 0; // the elbow bent less than 25° (an inner angle > 155°)
  let n0 = v3.norm(v3.cross(up, fo));
  if (hand === 'L') n0 = v3.mul(n0, -1);
  const n = palm ?? palmNormal(view, sideVec(hand, view, f));
  if (Math.abs(v3.dot(n, fo)) > 0.85) return 0;
  const pj = (q: V3) => v3.norm(v3.sub(q, v3.mul(fo, v3.dot(q, fo))));
  return (Math.acos(Math.max(-1, Math.min(1, v3.dot(pj(n), pj(n0))))) * 180) / Math.PI;
}
/** A natural limit of the palm turn from neutral, degrees. */
export const TWIST_LIM = 100;
const VIEW_RING: HandView[] = ['dorsal', 'radial', 'palmar', 'ulnar'];
/** The hand view within a natural forearm rotation: the wanted view if its palm is not twisted; otherwise the nearest natural one (a
 *  neighbour by forearm rotation, then the opposite one). A hand that a pose asks to be twisted is drawn in the nearest natural turn. */
export function liveView(want: HandView, hand: HandSide, S: V3, E: V3, W: V3, f: Pt | ((v: HandView) => Pt), palm?: V3): HandView {
  // f — the finger direction; as a function — its own for every view (the wrist bend is brought to the limits of the view)
  const fOf = (v: HandView) => (typeof f === 'function' ? f(v) : f);
  const tw = (v: HandView) => twistOf(hand, v, S, E, W, fOf(v));
  // palm — the palm normal of the wanted view, if the pose sets it itself (a palm on a door leaf — towards the target, on a rail — down)
  if (twistOf(hand, want, S, E, W, fOf(want), palm) <= TWIST_LIM) return want;
  const i = VIEW_RING.indexOf(want);
  const rest = [VIEW_RING[(i + 1) % 4], VIEW_RING[(i + 3) % 4], VIEW_RING[(i + 2) % 4]].map((v) => ({v, t: tw(v)}));
  const near = rest.slice(0, 2).sort((a, b) => a.t - b.t);
  for (const c of [...near, rest[2]]) if (c.t <= TWIST_LIM) return c.v;
  return rest.sort((a, b) => a.t - b.t)[0].v;
}

/** Arm journal — for the pose check (tools/hands_check.mjs). Points — figure units; screen — the same points in frame pixels. */
export type ArmLog = {
  side: number; hand: HandSide; hold: string; back: boolean; who?: string;
  S: V3; E: V3; W: V3; L1: number; L2: number; pole: V3;
  f: Pt; u: Pt; view: HandView; shape: string; handLen: number;
  tip: Pt; // fingertips (or fist knuckles) — the edge of the hand
  grip?: Pt; target?: Pt; // the grip point of the hand and the point of the prop it holds
  hidden?: 'fore' | 'all'; // from behind the forearm or the whole hand is behind the body
  hideHand?: boolean; // the hand is covered by a prop or the body (not in the frame)
  wristHidden?: string; // the wrist and the palm are behind a prop (only the fingers on the edge are visible) — the hand bend and turn are not visible
  hangRef?: number; // hanging arm: y of mid-thigh that the fingers must reach
  allowFore?: string; // why the forearm is foreshortened (towards the viewer) — intended by the pose
  layers?: string; // order of the grip layers from bottom to top
  pose?: string; // staging gesture the arm performs (pull, push, rail, count, tap, dial, hangup)
  torsoX?: number; // torso half-width at elbow height (an arm at the chest: the elbow farther out is a "wing", tools/hands_check.mjs)
  palm?: V3; // palm normal if it does not come from the hand view (a phone on the palm screen up — the palm up)
  fingers?: number[][]; // joint bends of the fingers, degrees: index … little finger × (base, middle, far) — the skeleton pose of the hand
  thumb?: number[]; // the thumb: abduction 0..1, bend (degrees), opposition 0..1
  mix?: string; // a shape transition: "from → to share"
  moving?: boolean; // the arm is in the motion of a gesture (entry or exit): an intermediate pose — "wing" and foreshortening are not checked
  wristCut?: number; // by how many degrees the engine removed the wrist bend (the pose asked for the hand at a large angle to the forearm)
  viewWant?: HandView; // the view the pose asked for, if the engine replaced it with the nearest natural one (the palm would be twisted)
  fgap?: number; // self-check of the drawn hand (CharacterStyle.handAudit): how far a finger base is outside the palm outline, hand frame units
  notch?: number; // the deepest notch between neighbouring fingers, hand frame units
  wrap?: number; // a prop in the fist: how many fingers lie on it (CharacterStyle.handAudit)
  itemMoving?: boolean; // the prop is in motion (a mop being raised): an intermediate pose — the grip is not checked
  item?: {p: Pt; d: Pt; t0: number; t1: number; w: number; over: boolean}; // a long prop in the fist: segment p + d·t (t0…t1) in the frame, half-width, over — drawn over the arm
};

/** Pose journal: the service composition turns it on, the figure writes arm poses to the browser console (tools/hands_check.mjs). */
export const PoseLogCtx = React.createContext(false);
