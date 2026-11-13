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

/** Two-segment IK: shoulder joint S, wrist target T, elbow pole (where the elbow points). Lengths do not change:
 *  a target farther than L1 + L2 — the wrist on the ray to the target (the arm stretched), nearer than |L1 − L2| — it is pushed away;
 *  otherwise the elbow bends. */
export function ik3(S: V3, T: V3, pole: V3, L1 = ARM_L1, L2 = ARM_L2): {E: V3; W: V3} {
  const d = v3.sub(T, S);
  const dl = v3.len(d);
  const u: V3 = dl > 1e-6 ? v3.mul(d, 1 / dl) : [0, 1, 0];
  const D = Math.min((L1 + L2) * 0.999, Math.max(Math.abs(L1 - L2) + 2, dl));
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
};

/** Pose journal: the service composition turns it on, the figure writes arm poses to the browser console (tools/hands_check.mjs). */
export const PoseLogCtx = React.createContext(false);
