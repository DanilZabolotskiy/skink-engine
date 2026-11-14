// Hand frame, grips and the skeleton pose of a hand — the part of a hand that does not depend on the drawing style.
// Hand frame: origin — the wrist, +y — towards the fingers, +x — towards the thumb (dorsal, palmar views) or towards the palm (radial,
// ulnar views); the length of an open hand from the wrist to the tip of the middle finger is about 64 frame units, the width at the
// knuckles about 28. The pose solver (body.ts) sets the frame and its scale for every hand and places props by the grip points below; a
// style draws a hand shape in this frame (handMatrix). The left hand mirrors the right one: its frame has the other sign of u (arm.ts
// sideVec).
// The skeleton pose (HandPose) is the hand as numbers, like an emotion: the bend of every finger joint and the thumb. The core blends
// shapes by these angles (a transition bends the fingers instead of swapping the drawing) and writes them to the pose journal (the joint
// limits are checked by tools/hands_check.mjs); a style draws from them or with its own drawn shapes of the same grip.
import React from 'react';
import type {HandView, Pt} from './arm';

export type HandShape = 'relaxed' | 'fist' | 'hook' | 'open' | 'flat' | 'point' | 'pen' | 'ear' | 'phone' | 'cup' | 'box' | 'count' | 'rail' | 'tap';

/** A transition from another shape: share k of the way from shape (the fingers bend by the joints). */
export type HandMix = {shape: HandShape; k: number};

/** Length of a hand shape from the wrist to its edge (fingertips or knuckles), frame units. */
export const HAND_LEN: Record<HandShape, number> = {relaxed: 63, fist: 46, hook: 51, open: 65, flat: 65, point: 61, pen: 52, ear: 62, phone: 53, cup: 57, box: 52, count: 62, rail: 52, tap: 56};

/** Grip points in the hand frame: grip — where the hand holds the prop; c and axis — the centre and the axis of the prop; tip, tail — the
 *  ends of a pen. */
export const HAND_GRIP: Partial<Record<HandShape, {grip: Pt; c?: Pt; axis?: Pt; tip?: Pt; tail?: Pt}>> = {
  fist: {grip: [7, 27], c: [7, 27], axis: [-0.34, 0.94]},
  hook: {grip: [-1, 50]},
  pen: {grip: [9.5, 50.6], tip: [5, 64], tail: [24, 8]},
  ear: {grip: [-4, 44], c: [-9, 42], axis: [-0.25, 0.97]},
  phone: {grip: [0, 36], c: [16, 35], axis: [1, 0]},
  cup: {grip: [0, 41], c: [1, 41], axis: [1, 0]},
  box: {grip: [8, 44]},
  rail: {grip: [0, 40]}, // rail — under the fingers at the knuckles
  tap: {grip: [0, 26], c: [-2, 26], axis: [1, 0]}, // the phone lies on the palm screen up: centre c, width along axis
};

/** A prop in the fist (a torch, a handle): its centre and axis in the hand frame by the view. From the side the prop goes along the hand
 *  under the band of the fingers (HAND_GRIP.fist); with the back or the palm to the viewer the fingers are folded to the palm — the prop
 *  lies under them across the hand, towards the thumb. */
export const fistGrip = (view: HandView): {c: Pt; axis: Pt} =>
  view === 'radial' || view === 'ulnar' ? {c: HAND_GRIP.fist!.c!, axis: HAND_GRIP.fist!.axis!} : {c: [0, 30], axis: [0.993, 0.12]};

/** The tip of the straight index finger of the point shape in the hand frame of a view (the knuckle of the index finger plus its three
 *  segments): from the side — radial (the thumb side) or ulnar (the little finger side), facing or from the back — beside the thumb. The
 *  push gesture with grip point puts this tip on the kit point; a style draws the finger up to it. */
export const pointTip = (view: HandView): Pt => [view === 'ulnar' ? -8.1 : view === 'radial' ? 9.5 : 10.7, 58];

/** SVG transform of the hand frame: wrist W, fingers along f, thumb (or palm) side u, scale k. */
export const handMatrix = (W: Pt, f: Pt, u: Pt, k: number) =>
  `matrix(${(u[0] * k).toFixed(3)} ${(u[1] * k).toFixed(3)} ${(f[0] * k).toFixed(3)} ${(f[1] * k).toFixed(3)} ${W[0].toFixed(1)} ${W[1].toFixed(1)})`;

/** A point of the hand frame in figure coordinates. */
export const handPt = (W: Pt, f: Pt, u: Pt, k: number, x: number, y: number): Pt => [W[0] + (u[0] * x + f[0] * y) * k, W[1] + (u[1] * x + f[1] * y) * k];

/** Service mode: hands are filled with a marker colour (hand crop sheets, tools/hands_sheet.py). */
export const HandMarkCtx = React.createContext(false);

// ---------- skeleton pose ----------
/** The bend of a finger, rad: the knuckle (metacarpophalangeal) joint, the middle and the far one. Only towards the palm (≥ 0) and not
 *  beyond JOINT_LIM. */
export type Curl = [number, number, number];
/** A hand pose: f — index, middle, ring and little finger; spread — the fan of the fingers (rad per finger); th — the thumb: abd — abduction
 *  from the palm 0..1, flex — the bend of its phalanges (rad), opp — opposition 0..1 (it lies across the palm and the fingers). */
export type HandPose = {f: [Curl, Curl, Curl, Curl]; spread: number; th: {abd: number; flex: number; opp: number}};
/** Joint limits (rad): a finger does not bend backwards (0) and not beyond a natural bend. The same numbers in degrees are in
 *  tools/hands_check.mjs (FINGER_LIM, THUMB_FLEX). */
export const JOINT_LIM = {mcp: 1.6, pip: 1.95, dip: 1.25, spread: 0.22, flex: 1.2};
const cl01 = (v: number) => Math.max(0, Math.min(1, v));
const clr = (v: number, hi: number) => Math.max(0, Math.min(hi, Number.isFinite(v) ? v : 0));
/** A pose within the joint limits: whatever is outside them is brought to the nearest natural position. */
const clampPose = (p: HandPose): HandPose => ({
  f: p.f.map((c) => [clr(c[0], JOINT_LIM.mcp), clr(c[1], JOINT_LIM.pip), clr(c[2], JOINT_LIM.dip)]) as HandPose['f'],
  spread: clr(p.spread, JOINT_LIM.spread),
  th: {abd: cl01(p.th.abd), flex: clr(p.th.flex, JOINT_LIM.flex), opp: cl01(p.th.opp)},
});
/** A transition between poses by the joint angles: the fingers bend and unbend, the drawing is not swapped. */
const mixPose = (a: HandPose, b: HandPose, k: number): HandPose => {
  const m = (x: number, y: number) => x + (y - x) * k;
  return {
    f: a.f.map((c, i) => [m(c[0], b.f[i][0]), m(c[1], b.f[i][1]), m(c[2], b.f[i][2])]) as HandPose['f'],
    spread: m(a.spread, b.spread),
    th: {abd: m(a.th.abd, b.th.abd), flex: m(a.th.flex, b.th.flex), opp: m(a.th.opp, b.th.opp)},
  };
};

const all4 = (c: Curl): HandPose['f'] => [c, c, c, c];
const STRAIGHT: Curl = [0.03, 0.04, 0.03];
const FIST: HandPose['f'] = [[1.3, 1.7, 1.0], [1.35, 1.7, 1.0], [1.4, 1.7, 1.0], [1.45, 1.7, 1.0]];
/** Skeleton shapes: the joint angles. q — the progress of a live shape: count — how many fingers are unbent (a fraction — a finger on its
 *  way), rail — the tapping phase (a cycle is 1). A style may draw some shapes with its own drawn art (a side view, a grip); the angles
 *  still go to the pose journal (joint limits, "jump") and into the drawing of the other views and of the transitions. */
const RIG: Partial<Record<HandShape, (q: number) => HandPose>> = {
  // hangs or lies freely: the fingers slightly bent, more towards the little finger (the tips stepped), the thumb along the index finger
  relaxed: () => ({f: [[0.15, 0.3, 0.16], [0.2, 0.38, 0.2], [0.27, 0.46, 0.24], [0.34, 0.54, 0.26]], spread: 0, th: {abd: 0.25, flex: 0.3, opp: 0.1}}),
  // a fist: the fingers pressed to the palm, the thumb over the index and the middle finger
  fist: () => ({f: FIST, spread: 0, th: {abd: 0.1, flex: 0.8, opp: 0.45}}),
  // a bag handle: the fingers hooked — the middle joint bent, the thumb along the index finger
  hook: () => ({f: [[0.2, 1.2, 0.85], [0.24, 1.25, 0.85], [0.28, 1.3, 0.85], [0.34, 1.35, 0.85]], spread: 0, th: {abd: 0.15, flex: 0.35, opp: 0.15}}),
  // an open palm ("over there"): the fingers straight, a slight fan, the thumb apart
  open: () => ({f: all4(STRAIGHT), spread: 0.05, th: {abd: 0.7, flex: 0, opp: 0}}),
  // a palm pressed to a surface: the fingers straight and together
  flat: () => ({f: all4([0.02, 0.03, 0.02]), spread: 0.015, th: {abd: 0.4, flex: 0.05, opp: 0}}),
  // points with a finger: the index finger straight, the others in a fist, the thumb on the middle finger
  point: () => ({f: [[0.02, 0.03, 0.02], FIST[1], FIST[2], FIST[3]], spread: 0, th: {abd: 0.1, flex: 0.7, opp: 0.5}}),
  // a box from the side: the fingers go under the bottom, the thumb on the front face
  box: () => ({f: [[0.3, 0.85, 0.5], [0.34, 0.9, 0.5], [0.38, 0.95, 0.5], [0.44, 1.0, 0.5]], spread: 0, th: {abd: 0.3, flex: 0.2, opp: 0.1}}),
  // counting: from a fist the index, middle, ring and little finger unbend one by one; the thumb lies across the bent ones
  count: (q) => ({
    f: FIST.map((c, i) => {
      const e = cl01(q - i);
      const e2 = e * e * (3 - 2 * e);
      return [c[0] + (STRAIGHT[0] - c[0]) * e2, c[1] + (STRAIGHT[1] - c[1]) * e2, c[2] + (STRAIGHT[2] - c[2]) * e2];
    }) as HandPose['f'],
    spread: 0.05 * cl01(q / 2),
    th: {abd: 0.1, flex: 0.75, opp: 0.9},
  }),
  // a hand on a rail: the fingers hang over the bar (shorter in the frame) and tap in turn from the little finger to the index finger
  rail: (q) => ({
    f: [0, 1, 2, 3].map((i) => {
      const x = (((q % 1) + 1) % 1) * 4 - (3 - i);
      const a = x > 0 && x < 1 ? Math.sin(Math.PI * x) : 0;
      return [0.62 * (1 - 0.55 * a), 0.66 * (1 - 0.5 * a), 0.3];
    }) as HandPose['f'],
    spread: 0.01,
    th: {abd: 0.35, flex: 0.2, opp: 0},
  }),
  // a phone or a folder under the hand: the fingers lie across, slightly bent; the thumb behind the prop
  phone: () => ({f: [[0.28, 0.48, 0.28], [0.3, 0.5, 0.28], [0.32, 0.5, 0.3], [0.36, 0.54, 0.3]], spread: 0.01, th: {abd: 0.4, flex: 0.1, opp: 0}}),
  cup: () => ({f: [[0.32, 0.52, 0.3], [0.34, 0.54, 0.3], [0.36, 0.54, 0.3], [0.4, 0.58, 0.3]], spread: 0.005, th: {abd: 0.4, flex: 0.1, opp: 0}}),
  // a phone at the ear: the fingers on the back cover, almost straight
  ear: () => ({f: [[0.18, 0.32, 0.2], [0.2, 0.34, 0.2], [0.22, 0.36, 0.22], [0.26, 0.4, 0.24]], spread: 0.02, th: {abd: 0.3, flex: 0.2, opp: 0}}),
  // a pen between the thumb and the index finger: the index finger bent towards the pen tip, the others tucked
  pen: () => ({f: [[0.35, 0.55, 0.3], [0.75, 0.95, 0.4], [0.9, 1.05, 0.4], [1.0, 1.1, 0.4]], spread: 0, th: {abd: 0.25, flex: 0.25, opp: 0.1}}),
};
/** Skeleton shapes: they can be blended (Hand.from) and shown in any view. tap (a phone on the palm) has no skeleton pose. */
export const isRig = (shape: HandShape) => !!RIG[shape];
/** The pose of a shape in joint angles (for the pose journal and tools/hands_check.mjs), with a transition from another skeleton shape;
 *  a shape without a skeleton pose — null. */
export const handPose = (shape: HandShape, q = 0, from?: HandMix): HandPose | null => {
  const to = RIG[shape];
  if (!to) return null;
  const a = from && RIG[from.shape] ? RIG[from.shape]!(q) : null;
  return clampPose(a ? mixPose(a, to(q), cl01(from!.k)) : to(q));
};
