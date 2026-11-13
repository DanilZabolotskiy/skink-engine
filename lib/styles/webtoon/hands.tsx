// Hands of the webtoon style — a library of drawn hand shapes: every grip has its own hand, the outline is one natural curve.
// A shape is drawn in the hand frame of lib/character/hand.ts (the wrist at the origin, the fingers along +y, the thumb or the palm along
// +x); the body places it with handMatrix.
// Every finger is a tapering curve (a quadratic axis, a rounded tip), the palm is a Bézier curve; the silhouette is the union of the parts
// (a thick outline stroke under the fill), fingers are separated by thin inner lines from the notches between the tips, and a finger in
// front of another (side view) has its own edge. Grips are layered: back (behind the prop) and front (in front of it).
import React from 'react';
import type {HandView} from '../../character/arm';
import type {HandShape} from '../../character/hand';
import {cr} from './common';

/** bare — an arm without a sleeve (undershirt, T-shirt): no seam at the wrist, the hand continues the forearm as one shape. */
export type HandStyle = {fill: string; line: string; sw: number; shade: string; bare?: boolean};

// ---------- geometry ----------
type P = [number, number];
const f2 = (v: number) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(2));

/** Smooth curve through points, two decimals (hand frame units are small). */
const smooth = (pts: P[], closed = false) => cr(pts, closed, 1 / 6, true, 2);

/** Finger: the axis is a quadratic curve B → C → T, half-width wb at the base and wt at the tip, the tip is rounded. */
export type Fin = {B: P; C: P; T: P; wb: number; wt: number};
type FinG = {L: P[]; R: P[]; cap: P[]; out: string};
function finGeo(f: Fin, n = 9): FinG {
  const L: P[] = [];
  const R: P[] = [];
  let dEnd: P = [0, 1];
  let nEnd: P = [1, 0];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    const p: P = [a * f.B[0] + b * f.C[0] + c * f.T[0], a * f.B[1] + b * f.C[1] + c * f.T[1]];
    let d: P = [2 * (1 - t) * (f.C[0] - f.B[0]) + 2 * t * (f.T[0] - f.C[0]), 2 * (1 - t) * (f.C[1] - f.B[1]) + 2 * t * (f.T[1] - f.C[1])];
    const l = Math.hypot(d[0], d[1]) || 1;
    d = [d[0] / l, d[1] / l];
    const nr: P = [-d[1], d[0]];
    // towards the tip the finger narrows faster (the pad), at the base it is almost even
    const w = f.wb + (f.wt - f.wb) * Math.pow(t, 1.4);
    L.push([p[0] + nr[0] * w, p[1] + nr[1] * w]);
    R.push([p[0] - nr[0] * w, p[1] - nr[1] * w]);
    dEnd = d;
    nEnd = nr;
  }
  const cap: P[] = [];
  for (let k = 1; k < 6; k++) {
    const th = (k / 6) * Math.PI;
    cap.push([f.T[0] + f.wt * (nEnd[0] * Math.cos(th) + dEnd[0] * Math.sin(th) * 1.05), f.T[1] + f.wt * (nEnd[1] * Math.cos(th) + dEnd[1] * Math.sin(th) * 1.05)]);
  }
  const ring = [...L, ...cap, ...R.slice().reverse()];
  return {L, R, cap, out: smooth(ring, true)};
}

/** Finger edge ('L' or 'R') from fraction t0 to the tip — the inner line between fingers; wrap — how many points of the
 *  tip rounding to take. */
function finEdge(g: FinG, side: 'L' | 'R', t0: number, wrap = 1): string {
  const n = g.L.length - 1;
  const i0 = Math.round(t0 * n);
  const pts = (side === 'L' ? g.L : g.R).slice(i0);
  const capPts = side === 'L' ? g.cap.slice(0, wrap) : g.cap.slice().reverse().slice(0, wrap);
  return smooth([...pts, ...capPts]);
}

// ---------- hand layer ----------
/** sil — closed parts of the silhouette (joined by a common outline); over — parts over the silhouette with their own edge (the thumb in
 *  front): fill — the fill, edge — an open outline; lines — thin inner lines (k — share of the outline width). */
export type Over = {fill: string; edge: string};
export type HandLay = {sil: string[]; over?: Over[]; lines?: {d: string; k?: number}[]};

function handLayer(l: HandLay, st: HandStyle, key?: string): React.ReactNode {
  const {fill, line, sw} = st;
  return (
    <g key={key}>
      {l.sil.map((d, i) => <path key={`o${i}`} d={d} fill={line} stroke={line} strokeWidth={2 * sw} strokeLinejoin="round" />)}
      {l.sil.map((d, i) => <path key={`f${i}`} d={d} fill={fill} />)}
      {/* bare arm: no seam at the wrist — a skin strip covers the hand outline across the wrist for its whole thickness (the stroke goes sw
         outwards from the silhouette edge); the side outlines of the hand and the forearm are untouched */}
      {st.bare && l.sil.some((d) => /^M -1[01](\.\d+)? -\d/.test(d)) ? <rect x={-10.3} y={-2 - sw - 1.2} width={21.4} height={sw + 5.2} fill={fill} /> : null}
      {(l.lines ?? []).map((q, i) => <path key={`l${i}`} d={q.d} fill="none" stroke={line} strokeWidth={sw * (q.k ?? 0.5)} strokeLinecap="round" strokeLinejoin="round" />)}
      {(l.over ?? []).map((o, i) => (
        <g key={`v${i}`}>
          <path d={o.fill} fill={fill} />
          <path d={o.edge} fill="none" stroke={line} strokeWidth={sw * 0.75} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
    </g>
  );
}

/** A row of fingers: silhouettes and inner lines between neighbours (the finger edge on the gapSide from fraction gapFrom to the tip). */
export function fingers(fs: Fin[], gapFrom = 0.45, gapSide: 'L' | 'R' = 'R', k = 0.5) {
  const gs = fs.map((f) => finGeo(f));
  const lines = gs.slice(0, -1).map((g) => ({d: finEdge(g, gapSide, gapFrom, 1), k}));
  return {sil: gs.map((g) => g.out), lines, gs};
}

/** A finger over the silhouette (the thumb in front): the fill is the whole finger, the outline goes from fraction t0 along the startSide
 *  edge, round the tip and back along the other edge to fraction t1. */
function thumbOver(f: Fin, t0: number, t1: number, startSide: 'L' | 'R' = 'L'): Over {
  const g = finGeo(f);
  const n = g.L.length - 1;
  const A = (startSide === 'L' ? g.L : g.R).slice(Math.round(t0 * n));
  const Bs = (startSide === 'L' ? g.R : g.L).slice(Math.round(t1 * n)).reverse();
  const cap = startSide === 'L' ? g.cap : g.cap.slice().reverse();
  return {fill: g.out, edge: smooth([...A, ...cap, ...Bs])};
}

// ---------- hands ----------
// Finger bases (knuckles) for the back-of-hand view, the right hand, the thumb at +x.
const MCP = {I: [9.6, 34.5] as P, M: [2.9, 36] as P, R: [-3.8, 35.2] as P, P: [-10.2, 32.6] as P};

/** Palm of the dorsal/palmar view: from the wrist (half-width ≈ 11) to the knuckles (width ≈ 28). yk — the knuckle level. */
const palmD = (yk = 34) =>
  `M -11 -2 C -12.4 9 -14.2 ${f2(yk * 0.6)} -13.8 ${f2(yk - 2)} C -13.6 ${f2(yk + 1)} -11 ${f2(yk + 2.5)} -8 ${f2(yk + 2)} L 9 ${f2(yk + 2.5)} C 12 ${f2(yk + 2.5)} 13.6 ${f2(yk + 1)} 13.6 ${f2(yk - 2)} C 13.8 ${f2(yk * 0.6)} 12.8 9 11.6 -2 Z`;
/** Palm of the side view (radial/ulnar): the back of the hand — −x, the palm — +x. */
const palmS = `M -10.6 -2 C -11.8 9 -13.4 20 -13.4 29 C -13.4 35 -11 38 -6 38.5 L 8 38 C 12.6 37 14.6 33 14.8 27 C 15 18 13.4 8 11.6 -2 Z`;

/** q — the progress of a live shape: count — how many fingers are unfolded (fractional — a finger on its way), rail — tapping phase
 *  (cycle — 1), tap — thumb lift over the screen (0 — touching). */
export function handParts(shape: HandShape, view: HandView, st: HandStyle, q = 0): {back?: React.ReactNode; front: React.ReactNode} {
  const side = view === 'radial' || view === 'ulnar';
  const D = (l: HandLay) => handLayer(l, st);
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  const lerpP = (a: P, b: P, k: number): P => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  switch (shape) {
    case 'count': {
      // counts on fingers, palm towards the viewer at the chest (not the back: one finger over a fist with the back out reads as "the
      // middle finger"): the index, middle, ring and little finger unfold one by one from a fist (q — how many are unfolded), slightly
      // fanned; the bent ones are short rolls on the palm, the thumb lies across them
      const base: P[] = [MCP.I, MCP.M, MCP.R, MCP.P];
      const len = [24, 27, 25, 19];
      const fs: Fin[] = base.map((B, i) => {
        const e = cl(q - i);
        const e2 = e * e * (3 - 2 * e);
        return {B, C: lerpP([B[0], B[1] + 6], [B[0] * 1.15, B[1] + 12], e2), T: lerpP([B[0] * 0.9, B[1] - 6], [B[0] * 1.35, B[1] + len[i]], e2), wb: [3.9, 4.0, 3.8, 3.4][i], wt: [3.2, 3.3, 3.1, 2.8][i]};
      });
      const thumb: Fin = {B: [11.5, 10], C: [9.4, 24], T: [-1.5, 27.4], wb: 5.2, wt: 3.8};
      const crease = {d: 'M 10.2 7 C 4.6 13 3.6 21 5.6 29', k: 0.32};
      const order = [3, 2, 1, 0];
      return {front: D({sil: [palmD(34), ...fs.map((f) => finGeo(f).out)], lines: [crease], over: [...order.map((i) => thumbOver(fs[i], 0, 0)), thumbOver(thumb, 0.2, 0.35, 'L')]})};
    }
    case 'rail': {
      // the hand lies on a rail (view from above and behind, back of the hand): the knuckles on the bar, the fingers hang over it and are
      // shorter in the frame; they tap in turn from the little finger to the index (q — phase, cycle — 1): a finger lifts and comes down
      const base: P[] = [MCP.P, MCP.R, MCP.M, MCP.I];
      const tap = (i: number) => {
        const x = (((q % 1) + 1) % 1) * 4 - i;
        return x > 0 && x < 1 ? Math.sin(Math.PI * x) : 0;
      };
      const fs: Fin[] = base.map((B, i) => {
        const a = tap(i);
        return {B, C: lerpP([B[0], B[1] + 8], [B[0] * 1.02, B[1] + 11], a), T: lerpP([B[0] * 1.02, B[1] + 13.5], [B[0] * 1.08, B[1] + 22], a), wb: [3.4, 3.8, 4.0, 3.9][i], wt: [2.9, 3.2, 3.4, 3.3][i]};
      });
      const fg = fingers(fs, 0.2, 'R');
      const thumb = finGeo({B: [10.4, 9], C: [16.4, 18], T: [17.4, 29], wb: 5.0, wt: 3.4});
      const knuckles = base.map((B) => ({d: `M ${f2(B[0] - 2.4)} ${f2(B[1] - 2.2)} Q ${f2(B[0])} ${f2(B[1] - 4.6)} ${f2(B[0] + 2.4)} ${f2(B[1] - 2.2)}`, k: 0.42}));
      return {front: D({sil: [thumb.out, palmD(), ...fg.sil], lines: [...fg.lines, ...knuckles]})};
    }
    case 'tap': {
      // the phone lies on the palm screen up (seen from above, squeezed by the view; the caller draws it between back and front, centre —
      // HAND_GRIP.tap.c, 36 × 24 frame units): the palm is under it, its heel shows at the near edge; the tips of three fingers curl over
      // the side edge (−x) onto the screen; the thumb goes from the mound at the wrist over the other edge above the screen and taps: q = 0
      // — touching, 1 — lifted
      const palm = 'M -11 -2 C -12.6 8 -15.2 18 -16.4 30 L 12.2 30 C 12.8 18 12.6 8 11.6 -2 Z';
      const tips: Fin[] = [17.4, 23.4, 29.2].map((y, i) => ({B: [-24.2 + i * 0.4, y], C: [-23.6, y + 2.2], T: [-16.6 + i * 0.3, y + 2.8], wb: 3.4, wt: 2.9}));
      const th: Fin = {B: [10.6, 5.6], C: lerpP([18.6, 15], [19.4, 11.6], q), T: lerpP([5, 24.6], [10.4, 19], q), wb: 5.2, wt: 3.7 + 0.5 * q};
      return {
        back: D({sil: [palm]}),
        front: D({sil: [], over: [...tips.map((f) => thumbOver(f, 0, 0)), thumbOver(th, 0.25, 0.25, 'L')]}),
      };
    }
    case 'relaxed': {
      if (side) {
        // hangs: view from the thumb side (radial, front) or the little finger side (ulnar, from behind). Fingers slightly bent to the
        // palm, the tips of three or four fingers show in steps; the thumb in front — a separate shape along the index finger
        const fs: Fin[] = [
          {B: [-4.6, 33], C: [-1.4, 46.6], T: [12.6, 51.2], wb: 3.6, wt: 2.8},
          {B: [-5.8, 34], C: [-3.8, 51], T: [9.6, 57.4], wb: 3.9, wt: 3.0},
          {B: [-7, 34], C: [-6.8, 54.6], T: [4.6, 61.4], wb: 4.1, wt: 3.2},
          {B: [-8.2, 33], C: [-9.8, 56], T: [-1.8, 63.6], wb: 4.3, wt: 3.4},
        ];
        const order = view === 'radial' ? fs : fs.slice().reverse();
        const fg = fingers(order, 0.5, view === 'radial' ? 'R' : 'L');
        const tf: Fin = {B: [9.4, 11], C: [11, 27.4], T: [3.8, 44.4], wb: 5.8, wt: 4.4};
        const thumb = view === 'radial' ? [thumbOver(tf, 0.3, 0.62, 'L')] : [];
        return {front: D({sil: [palmS, ...fg.sil, ...(view === 'radial' ? [finGeo(tf).out] : [])], lines: fg.lines, over: thumb})};
      }
      // back of the hand up (palm on the knees): fingers together, slightly bent (shorter), the thumb at the side
      const fs: Fin[] = [
        {B: MCP.P, C: [-10.8, 40], T: [-11.2, 46.8], wb: 3.4, wt: 2.8},
        {B: MCP.R, C: [-4.1, 44], T: [-4.5, 52.6], wb: 3.8, wt: 3.1},
        {B: MCP.M, C: [3.1, 46], T: [2.9, 55.6], wb: 4.0, wt: 3.3},
        {B: MCP.I, C: [10, 43], T: [9.8, 51.6], wb: 3.9, wt: 3.2},
      ];
      const fg = fingers(fs, 0.35, 'R');
      const thumb = finGeo({B: [10.4, 9], C: [17, 17], T: [18.4, 30], wb: 5.0, wt: 3.4});
      return {front: D({sil: [thumb.out, palmD(), ...fg.sil], lines: fg.lines})};
    }
    case 'fist': {
      if (side) {
        // a fist on a stick (torch, keys), front view (radial) or from behind (ulnar): the back of the hand — −x, the bent fingers
        // step across the stick on the palm side (+x), the thumb on top over the index finger
        const fs: Fin[] = [
          {B: [-3, 40.2], C: [6, 41.2], T: [13.6, 39.6], wb: 3.4, wt: 3.1},
          {B: [-3, 33.4], C: [7, 34], T: [15.8, 33], wb: 3.7, wt: 3.4},
          {B: [-3, 26.2], C: [7.6, 26.6], T: [16.6, 25.8], wb: 3.9, wt: 3.5},
          {B: [-3, 18.8], C: [7.4, 18.8], T: [16, 18.6], wb: 3.9, wt: 3.5},
        ];
        const fg = fingers(fs, 0.3, 'L');
        const body = `M -10.6 -2 C -12 8 -14.8 17 -14.8 27 C -14.8 37 -12.4 43 -6 44.4 C -2 45 2 44.6 4 43.4 L 6 14 C 9 9 11 4 11.6 -2 Z`;
        const thumb = view === 'radial' ? [thumbOver({B: [2, 9.4], C: [9, 10.6], T: [15.6, 14.4], wb: 4.6, wt: 3.4}, 0.25, 0.25, 'L')] : [];
        return {front: D({sil: [body, ...fg.sil], lines: fg.lines, over: thumb})};
      }
      // a fist with the back out: a row of knuckles, fingers curled under the bar, the thumb at the index finger
      const fs: Fin[] = [
        {B: [-10.2, 31.4], C: [-10.6, 38], T: [-10.2, 42.6], wb: 3.5, wt: 3.4},
        {B: [-3.8, 33.6], C: [-4, 41], T: [-3.8, 46], wb: 3.9, wt: 3.8},
        {B: [2.9, 34.4], C: [3, 42], T: [2.9, 47.2], wb: 4.0, wt: 3.9},
        {B: [9.6, 33], C: [9.9, 40], T: [9.6, 45], wb: 3.9, wt: 3.8},
      ];
      const fg = fingers(fs, 0.15, 'R');
      const thumb = finGeo({B: [11, 12], C: [17, 23], T: [14, 37], wb: 4.8, wt: 3.6});
      const knuckles = [-10.2, -3.8, 2.9, 9.6].map((x) => ({d: `M ${f2(x - 2.4)} ${f2(33.6)} Q ${f2(x)} ${f2(31.4)} ${f2(x + 2.4)} ${f2(33.6)}`, k: 0.45}));
      return {front: D({sil: [thumb.out, palmD(33), ...fg.sil], lines: [...fg.lines, ...knuckles]})};
    }
    case 'hook': {
      // a bag handle in the bent fingers of a lowered hand: fingers hooked to the palm, tips in steps, the thumb
      // along the index finger
      const fs: Fin[] = [
        {B: [-4.6, 33], C: [-4, 50], T: [8.4, 43.6], wb: 3.6, wt: 2.9},
        {B: [-5.8, 34], C: [-6, 54.6], T: [6.4, 49], wb: 3.9, wt: 3.1},
        {B: [-7, 34], C: [-8, 58.4], T: [4, 53.4], wb: 4.1, wt: 3.3},
        {B: [-8.2, 33], C: [-10, 61], T: [1.2, 57], wb: 4.3, wt: 3.4},
      ];
      const order = view === 'ulnar' ? fs.slice().reverse() : fs;
      const fg = fingers(order, 0.5, view === 'ulnar' ? 'L' : 'R');
      const tf: Fin = {B: [9.4, 11], C: [10.4, 25.4], T: [2.6, 39.6], wb: 5.7, wt: 4.3};
      const thumb = view !== 'ulnar' ? [thumbOver(tf, 0.3, 0.62, 'L')] : [];
      return {front: D({sil: [palmS, ...fg.sil, ...(view !== 'ulnar' ? [finGeo(tf).out] : [])], lines: fg.lines, over: thumb})};
    }
    case 'open':
    case 'flat': {
      if (side && shape === 'open') {
        // an open hand from the side (the "over there" gesture with a straight arm): fingers together in line with the arm — tips in steps,
        // the thumb apart on the palm side (+x)
        const fs: Fin[] = [
          {B: [3.4, 31], C: [3.8, 44], T: [4.2, 54.6], wb: 3.6, wt: 3.0},
          {B: [1.2, 32], C: [1.4, 46], T: [1.6, 60.4], wb: 3.8, wt: 3.1},
          {B: [-1.2, 32], C: [-1.2, 48], T: [-1.2, 64.4], wb: 3.9, wt: 3.2},
          {B: [-3.6, 31], C: [-3.8, 47], T: [-3.8, 61.6], wb: 4.0, wt: 3.2},
        ];
        const fg = fingers(fs, 0.55, 'L');
        const palm = `M -10.6 -2 C -11.6 10 -8.6 22 -7.6 33 L 7.4 33 C 9.6 24 12.6 12 11.6 -2 Z`;
        const thumb = finGeo({B: [9, 12], C: [15.6, 21], T: [16.6, 32.4], wb: 4.8, wt: 3.4});
        return {front: D({sil: [thumb.out, palm, ...fg.sil], lines: fg.lines})};
      }
      // an open hand: fingers together, straight, slightly fanned; the thumb apart. open — the "over there" gesture (palm to the target),
      // flat — the palm pressed to a surface (frame, folder)
      const fs: Fin[] = [
        {B: MCP.P, C: [-11, 42], T: [-12, 51.4], wb: 3.4, wt: 2.8},
        {B: MCP.R, C: [-4.3, 47], T: [-4.9, 59.2], wb: 3.8, wt: 3.1},
        {B: MCP.M, C: [3, 49], T: [3.1, 62.6], wb: 4.0, wt: 3.3},
        {B: MCP.I, C: [10.2, 46], T: [10.6, 58.2], wb: 3.9, wt: 3.2},
      ];
      const fg = fingers(fs, 0.5, 'R');
      const thumb = finGeo(shape === 'open' ? {B: [10.6, 9], C: [19, 15], T: [23.4, 27.6], wb: 5.2, wt: 3.5} : {B: [10.6, 9], C: [18, 16], T: [21.4, 29], wb: 5.2, wt: 3.5});
      // the palm pressed to a wall, the back of the hand towards the viewer (flat, dorsal). Knuckle arcs across the hand read as a seam or
      // "odd strokes at the wrist" in a close shot: the back of the hand is shown by the thumb at the side and the place of the hand
      const back: {d: string; k?: number}[] = [];
      return {front: D({sil: [thumb.out, palmD(), ...fg.sil], lines: [...fg.lines, ...back]})};
    }
    case 'point': {
      // points with a finger, side view (radial): the index straight, three fingers tucked in steps, the thumb on the middle finger
      const fs: Fin[] = [
        {B: [-3, 38.6], C: [5, 40], T: [12.4, 37.4], wb: 3.4, wt: 3.0},
        {B: [-3, 32.6], C: [6, 33.6], T: [14.2, 31.4], wb: 3.6, wt: 3.2},
        {B: [-3, 26.4], C: [6.4, 27], T: [14.8, 25.4], wb: 3.8, wt: 3.3},
      ];
      const fg = fingers(fs, 0.3, 'L');
      const index = finGeo({B: [-6.6, 30], C: [-6.8, 50], T: [-6.4, 68], wb: 4.1, wt: 3.2});
      const body = `M -10.6 -2 C -12 8 -13.4 18 -13.2 28 C -13 36 -10.4 42 -5 43 C 0 43.6 3 42.6 4.6 40.8 L 6 14 C 9 9 11 4 11.6 -2 Z`;
      const thumb = thumbOver({B: [6, 9], C: [12, 15], T: [11.4, 24.4], wb: 4.6, wt: 3.3}, 0.25, 0.6, 'L');
      return {front: D({sil: [body, index.out, ...fg.sil], lines: [...fg.lines, {d: finEdge(index, 'L', 0.55, 0)}], over: [thumb]})};
    }
    case 'pen': {
      // writes: the pen between the thumb and the index finger — the tip comes out from under the bent index finger, the tail is above
      // the dip between the thumb and the index finger; the middle, ring and little fingers are tucked (back). The caller draws the
      // pen between the layers
      const fs: Fin[] = [
        {B: [-10.2, 29.6], C: [-10.8, 36.6], T: [-9.8, 41.6], wb: 3.4, wt: 3.2},
        {B: [-3.8, 32], C: [-4.2, 40.6], T: [-3.4, 46], wb: 3.8, wt: 3.5},
        {B: [2.9, 33], C: [3.2, 43], T: [3.4, 50], wb: 4.0, wt: 3.5},
      ];
      const fg = fingers(fs, 0.25, 'R');
      const index = finGeo({B: [9.4, 31], C: [12.6, 44], T: [9.2, 50.6], wb: 4.0, wt: 3.3});
      const thumbF = thumbOver({B: [12, 9], C: [19.6, 22], T: [15, 36.6], wb: 5.0, wt: 3.5}, 0.35, 0.35, 'L');
      return {
        back: D({sil: [palmD(32), ...fg.sil], lines: fg.lines}),
        front: D({sil: [], over: [{fill: index.out, edge: smooth([...index.L.slice(2), ...index.cap, ...index.R.slice().reverse().slice(0, 8)])}, thumbF]}),
      };
    }
    case 'ear': {
      // phone at the ear: the back of the hand out, the fingers bent around the back edge of the phone — the tips to the face (−x); the
      // thumb on the near side, under the phone. The caller draws the phone before the hand
      const fs: Fin[] = [
        {B: MCP.P, C: [-12.4, 43], T: [-18.4, 47], wb: 3.3, wt: 2.6},
        {B: MCP.R, C: [-5.2, 50.4], T: [-13.2, 57], wb: 3.6, wt: 2.9},
        {B: MCP.M, C: [2.6, 54], T: [-6, 63.4], wb: 3.8, wt: 3.0},
        {B: MCP.I, C: [10.6, 52], T: [3.4, 63], wb: 3.7, wt: 3.0},
      ];
      const fg = fingers(fs, 0.4, 'R');
      const thumb = finGeo({B: [11, 10], C: [16.6, 18], T: [17, 30], wb: 4.8, wt: 3.4});
      return {front: D({sil: [thumb.out, palmD(), ...fg.sil], lines: fg.lines})};
    }
    case 'phone':
    case 'cup': {
      // a phone or a cup in the hand: the back of the hand at the near edge, the fingers lie across the back cover (the wall), the tips
      // curl over the far edge; the thumb on the screen (behind the prop, back). For a cup the fingers form an arc
      const cup = shape === 'cup';
      const b = cup ? -2.2 : -0.6; // fingers bend towards the little finger — wrapping a cylinder
      const fs: Fin[] = [
        {B: [-10.2, 30.6], C: [-10.6 + b, 39], T: [-11.4, 46.6], wb: 3.4, wt: 2.9},
        {B: [-3.8, 32.6], C: [-4 + b, 42.6], T: [-4.6, 51.6], wb: 3.8, wt: 3.2},
        {B: [2.9, 33.4], C: [3.2 + b, 44], T: [2.8, 53.6], wb: 4.0, wt: 3.4},
        {B: [9.6, 32], C: [10.2 + b, 42], T: [9.8, 50.6], wb: 3.9, wt: 3.3},
      ];
      const fg = fingers(fs, 0.3, 'R');
      const thumb = finGeo({B: [11, 9], C: [17.4, 17], T: [17, 30], wb: 4.9, wt: 3.4});
      return {back: D({sil: [thumb.out]}), front: D({sil: [palmD(32), ...fg.sil], lines: fg.lines})};
    }
    case 'box': {
      // a box at the waist: the hand on the side face, view from the thumb side; fingers go under the bottom — the tips show in steps, the
      // thumb on the front face
      const fs: Fin[] = [
        {B: [-4.6, 32], C: [-2.4, 41], T: [9.6, 41.4], wb: 3.5, wt: 2.9},
        {B: [-5.8, 33], C: [-4.6, 45], T: [10.4, 46.6], wb: 3.8, wt: 3.1},
        {B: [-7, 33], C: [-7, 49.6], T: [8.4, 51.4], wb: 4.0, wt: 3.2},
        {B: [-8.2, 32], C: [-9.4, 52], T: [4.4, 54.6], wb: 4.2, wt: 3.4},
      ];
      const fg = fingers(fs, 0.5, 'R');
      const tf: Fin = {B: [9.4, 11], C: [11, 23], T: [6.6, 35], wb: 5.7, wt: 4.3};
      return {front: D({sil: [palmS, ...fg.sil, finGeo(tf).out], lines: fg.lines, over: [thumbOver(tf, 0.3, 0.62, 'L')]})};
    }
  }
}
