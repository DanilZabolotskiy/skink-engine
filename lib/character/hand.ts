// Hand frame and grips — the part of a hand that does not depend on the drawing style.
// Hand frame: origin — the wrist, +y — towards the fingers, +x — towards the thumb (dorsal, palmar views) or towards the palm (radial,
// ulnar views); the length of an open hand from the wrist to the tip of the middle finger is about 64 frame units. The pose solver
// (body.ts) sets the frame and its scale for every hand and places props by the grip points below; a style draws a hand shape in this
// frame (handMatrix). The left hand mirrors the right one: its frame has the other sign of u (arm.ts sideVec).
import React from 'react';
import type {Pt} from './arm';

export type HandShape = 'relaxed' | 'fist' | 'hook' | 'open' | 'flat' | 'point' | 'pen' | 'ear' | 'phone' | 'cup' | 'box' | 'count' | 'rail' | 'tap';

/** Length of a hand shape from the wrist to its edge (fingertips or knuckles), frame units. */
export const HAND_LEN: Record<HandShape, number> = {relaxed: 62, fist: 46, hook: 56, open: 63, flat: 63, point: 68, pen: 52, ear: 63, phone: 53, cup: 53, box: 53, count: 60, rail: 50, tap: 56};

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

/** SVG transform of the hand frame: wrist W, fingers along f, thumb (or palm) side u, scale k. */
export const handMatrix = (W: Pt, f: Pt, u: Pt, k: number) =>
  `matrix(${(u[0] * k).toFixed(3)} ${(u[1] * k).toFixed(3)} ${(f[0] * k).toFixed(3)} ${(f[1] * k).toFixed(3)} ${W[0].toFixed(1)} ${W[1].toFixed(1)})`;

/** A point of the hand frame in figure coordinates. */
export const handPt = (W: Pt, f: Pt, u: Pt, k: number, x: number, y: number): Pt => [W[0] + (u[0] * x + f[0] * y) * k, W[1] + (u[1] * x + f[1] * y) * k];

/** Service mode: hands are filled with a marker colour (hand crop sheets, tools/hands_sheet.py). */
export const HandMarkCtx = React.createContext(false);
