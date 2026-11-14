// Hands of the webtoon style. Two ways of drawing, both in the same hand frame of lib/character/hand.ts and with the same journal of the
// joint bends (the skeleton pose HandPose of the core):
// 1) the skeleton (rig): a palm and four fingers of three phalanges plus the thumb, posed by the joint angles of the core. A finger bends
//    only towards the palm and only within its joint (the core clamps the pose). It draws the hands with the back or the palm to the
//    viewer: open, pressed to a sheet, counting on fingers, on a rail, on a table, around a cup, and from the side — hooked fingers (a bag)
//    and a box; a transition between shapes blends the angles (the core: Hand.from);
// 2) drawn shapes: from the side a hanging hand, a fist and an open hand (SIDE: one solid "mitten" silhouette, the fingers together, short
//    lines between the fingers inside; a fist — a band of four bent fingers with the thumb on top — the skeleton from the side gave a
//    "rake" of a hanging hand, a "lump" of a fist, and a flat palm next to the prop in the grips), a pen, a phone at the ear, a folder and a
//    phone in the hand, a phone lying on the palm. The fingers start inside the palm and cannot come off it. A transition between the
//    drawn side shapes blends their support points (mixSide), without swapping the drawing.
// There are always four fingers and a thumb; the left hand mirrors the right one. How it is drawn: the silhouette is the union of the
// palm and the fingers (a common outline as a thick stroke under the fill), the fingers are separated by thin lines (the thin outline of a
// finger over its neighbour). No "C" curls, claws or sausages. Grips with a prop are layered: back (behind the prop) and front (in front
// of it). handAudit — the self-check of the drawing for the pose journal (tools/hands_check.mjs).
import React from 'react';
import type {HandView} from '../../character/arm';
import {HandMix, HandPose, HandShape, handPose} from '../../character/hand';
import {cr} from './common';

/** bare — an arm without a sleeve (undershirt, T-shirt): no seam at the wrist, the hand continues the forearm as one shape. */
export type HandStyle = {fill: string; line: string; sw: number; shade: string; bare?: boolean};

// ---------- geometry ----------
type P = [number, number];
const f2 = (v: number) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(2));
const fp = (p: P) => `${f2(p[0])} ${f2(p[1])}`;
const cl01 = (v: number) => Math.max(0, Math.min(1, v));

/** Smooth curve through points, two decimals (hand frame units are small). */
const smooth = (pts: P[], closed = false) => cr(pts, closed, 1 / 6, true, 2);

/** Finger: the axis is a quadratic curve B → C → T, half-width wb at the base and wt at the tip, the tip is rounded. */
type Fin = {B: P; C: P; T: P; wb: number; wt: number};
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

/** Finger edge ('L' or 'R') from fraction t0 to the tip — the inner line between fingers; wrap — how many points of the tip rounding
 *  to take. */
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
type Over = {fill: string; edge: string};
type HandLay = {sil: string[]; over?: Over[]; lines?: {d: string; k?: number}[]};

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

/** A row of fingers: silhouettes and inner lines between neighbours (the finger edge on side gapSide from fraction gapFrom to the tip). */
function fingers(fs: Fin[], gapFrom = 0.45, gapSide: 'L' | 'R' = 'R', k = 0.5) {
  const gs = fs.map((f) => finGeo(f));
  const lines = gs.slice(0, -1).map((g) => ({d: finEdge(g, gapSide, gapFrom, 1), k}));
  return {sil: gs.map((g) => g.out), lines, gs};
}

/** A finger over the silhouette (the thumb in front): the fill is the whole finger, the outline goes from fraction t0 along edge startSide,
 *  around the tip and back along the other edge to fraction t1. */
function thumbOver(f: Fin, t0: number, t1: number, startSide: 'L' | 'R' = 'L'): Over {
  const g = finGeo(f);
  const n = g.L.length - 1;
  const A = (startSide === 'L' ? g.L : g.R).slice(Math.round(t0 * n));
  const Bs = (startSide === 'L' ? g.R : g.L).slice(Math.round(t1 * n)).reverse();
  const cap = startSide === 'L' ? g.cap : g.cap.slice().reverse();
  return {fill: g.out, edge: smooth([...A, ...cap, ...Bs])};
}

// ---------- the skeleton drawing ----------
// skeleton geometry, frame units. The knuckles are where the drawn hands have them (the back view, a right hand, the thumb — +x)
const MCP: P[] = [[9.6, 34.5], [2.9, 36], [-3.8, 35.2], [-10.2, 32.6]];
const FAN = [0.045, 0.005, -0.045, -0.1];
const SEG: [number, number, number][] = [[10.7, 7.3, 5.7], [12, 8.2, 6.4], [10.8, 7.4, 5.8], [8.5, 5.8, 4.5]];
const FW: [number, number][] = [[3.9, 3.1], [4.0, 3.2], [3.8, 3.0], [3.4, 2.7]]; // half-width at the base and at the tip
const widths = (i: number): number[] => {
  const [a, b] = FW[i];
  return [a, a + (b - a) * 0.4, a + (b - a) * 0.72, b];
};
// the side view (radial, ulnar) is a three-quarter view from the back: across the hand it is narrower (K34X), the bend of the fingers and
// the thumb come out towards the palm (+x) by a share K34Z of their depth. A pure side view folded four fingers into one "claw"
const K34X = 0.82;
const K34Z = 0.57;
const THW = [5.3, 4.8, 4.2, 3.5];
const THL = [10.5, 8.5, 7.5];

const capsuleD = (A: P, B: P, ra: number, rb: number): string => {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const l = Math.hypot(dx, dy);
  if (l < 0.05) {
    const r = Math.max(ra, rb);
    return `M ${f2(A[0] - r)} ${f2(A[1])} a ${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0 a ${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0 Z`;
  }
  const nx = -dy / l, ny = dx / l;
  return `M ${f2(A[0] + nx * ra)} ${f2(A[1] + ny * ra)} L ${f2(B[0] + nx * rb)} ${f2(B[1] + ny * rb)} A ${f2(rb)} ${f2(rb)} 0 0 0 ${f2(B[0] - nx * rb)} ${f2(B[1] - ny * rb)} L ${f2(A[0] - nx * ra)} ${f2(A[1] - ny * ra)} A ${f2(ra)} ${f2(ra)} 0 0 0 ${f2(A[0] + nx * ra)} ${f2(A[1] + ny * ra)} Z`;
};
/** A chain of segments — capsules with shared joints (a rounded bend without self-intersections). */
const chainD = (pts: P[], ws: number[], i0 = 0, i1 = pts.length - 1): string => {
  const out: string[] = [];
  for (let i = i0; i < i1; i++) out.push(capsuleD(pts[i], pts[i + 1], ws[i], ws[i + 1]));
  return out.join(' ');
};
const circleD = (c: P, r: number) => `M ${f2(c[0] - r)} ${f2(c[1])} a ${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0 a ${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0 Z`;
const step = (p: P, ang: number, l: number): P => [p[0] + Math.sin(ang) * l, p[1] + Math.cos(ang) * l];

/** A skeleton layer: sil — the shapes of the common outline; ops — in order: part — a part with its own thin outline (a finger over its
 *  neighbour), fill — a fill without an outline (the palm, a patch at a finger base); lines — thin lines; wrist — the layer has the
 *  wrist. */
type RigOp = {d: string; kind: 'part' | 'fill'};
type RigLay = {sil: string[]; ops: RigOp[]; lines?: {d: string; k?: number}[]; wrist?: boolean};

function rigLayer(l: RigLay, st: HandStyle, key?: string): React.ReactNode {
  const {fill, line, sw} = st;
  const t = sw * 0.42;
  return (
    <g key={key}>
      {l.sil.map((d, i) => <path key={`o${i}`} d={d} fill={line} stroke={line} strokeWidth={2 * sw} strokeLinejoin="round" />)}
      {l.ops.map((o, i) => (o.kind === 'fill' ? <path key={`p${i}`} d={o.d} fill={fill} /> : (
        <g key={`p${i}`}>
          <path d={o.d} fill={line} stroke={line} strokeWidth={2 * t} strokeLinejoin="round" />
          <path d={o.d} fill={fill} />
        </g>
      )))}
      {/* bare arm: no seam at the wrist — a skin strip covers the hand outline across the wrist (as in handLayer) */}
      {st.bare && l.wrist ? <rect x={-10.3} y={-2 - sw - 1.2} width={21.4} height={sw + 5.2} fill={fill} /> : null}
      {(l.lines ?? []).map((q, i) => <path key={`l${i}`} d={q.d} fill="none" stroke={line} strokeWidth={sw * (q.k ?? 0.5)} strokeLinecap="round" strokeLinejoin="round" />)}
    </g>
  );
}

type Curl = HandPose['f'][number];
type Chain = {pts: P[]; ws: number[]};
type Proj = (x: number, y: number, z: number) => P;
/** Projection of a hand point (x — towards the thumb, y — towards the fingers, z — towards the palm) onto the frame of a view. */
const projOf = (view: HandView): Proj => {
  if (view === 'dorsal' || view === 'palmar') return (x, y) => [x, y];
  const sg = view === 'ulnar' ? -1 : 1;
  return (x, y, z) => [sg * x * (1 - (1 - K34X) * cl01(y / 24)) + K34Z * z, y];
};
/** A finger: the bend goes towards the palm (z); in the frame a segment is shorter by the cos of the accumulated angle, a segment beyond
 *  90° goes back towards the wrist on the palm side. vis — how many segments are seen from the back (a finger bent further hides under
 *  itself); back — the finger is folded. */
function finger(i: number, c: Curl, spread: number, pr: Proj): Chain & {vis: number; back: boolean} {
  const phi = FAN[i] + spread * (1.5 - i);
  const a1 = c[0], a2 = a1 + c[1], a3 = a2 + c[2];
  const cs = [Math.max(Math.cos(a1), 0.14), Math.cos(a2), Math.cos(a3)];
  const sn = [Math.sin(a1), Math.sin(a2), Math.sin(a3)];
  let [x, y] = MCP[i];
  let z = 0;
  const pts: P[] = [pr(x, y, z)];
  for (let k = 0; k < 3; k++) {
    x += Math.sin(phi) * SEG[i][k] * cs[k];
    y += Math.cos(phi) * SEG[i][k] * cs[k];
    z += SEG[i][k] * sn[k];
    pts.push(pr(x, y, z));
  }
  const vis = cs[1] <= 0.02 ? 1 : cs[2] <= 0.02 ? 2 : 3;
  return {pts, ws: widths(i), vis, back: cs[1] < 0.25};
}
/** The thumb: from the mound at the wrist out and up, slightly in front of the palm; opp — it goes across the palm and the fingers. */
function thumb(t: HandPose['th'], pr: Proj): Chain {
  const a0 = (0.55 + 0.45 * t.abd) * (1 - t.opp) - 0.35 * t.opp;
  const a1 = a0 - 0.3 * (1 - t.opp) - 0.5 * t.flex;
  const a2 = a1 - 0.15 - 0.7 * t.flex;
  const b: P = [10.8 - 5 * t.opp, 8.5];
  const p1 = step(b, a0, THL[0]);
  const p2 = step(p1, a1, THL[1]);
  const p3 = step(p2, a2, THL[2]);
  const zs = [2, 5 + 3 * t.opp, 7 + 4 * t.opp, 7 + 5 * t.opp];
  return {pts: [b, p1, p2, p3].map((q, k) => pr(q[0], q[1], zs[k])), ws: THW};
}
/** The palm in the frame of a view: in three quarters narrower towards the knuckles, with a band of its thickness on the palm side. */
function palmOf(view: HandView, pr: Proj): string {
  if (view === 'dorsal' || view === 'palmar') return palmD(35);
  const q = (x: number, y: number, z = 0) => fp(pr(x, y, z));
  const sg = view === 'ulnar' ? -1 : 1;
  // the right edge (+x of the frame) is the near one: from the thumb side the thickness of the palm shows (z); from the little finger
  // side — the edge of the palm
  const zr = sg > 0 ? 5 : 3;
  const zl = sg > 0 ? 0 : 2;
  const [xl, xr] = sg > 0 ? [-1, 1] : [1, -1];
  return `M -11 -2 C ${q(xl * 12.6, 9, zl)} ${q(xl * 14, 21, zl)} ${q(xl * 13.7, 33, zl)} C ${q(xl * 13.5, 36, zl)} ${q(xl * 11, 37.5, zl)} ${q(xl * 8, 37, zl)} L ${q(xr * 9, 37.5, zr)} C ${q(xr * 12, 37.5, zr)} ${q(xr * 13.6, 36, zr)} ${q(xr * 13.6, 33, zr)} C ${q(xr * 13.8, 21, zr)} ${q(xr * 12.8, 9, zr * 0.5)} 11.6 -2 Z`;
}

/** What to draw: a whole finger, no thumb, only the thumb and so on (the layers of the grips). */
type RigPick = {palm?: boolean; fingers?: number[]; thumb?: boolean; from?: number; thumbFrom?: number; noCrease?: boolean};
const ALL: RigPick = {palm: true, fingers: [0, 1, 2, 3], thumb: true};

/** A hand layer by a pose and a view. pick — which parts are in the layer (grips split a hand into the layers behind the prop and in front
 *  of it); pick.from, pick.thumbFrom — the fingers and the thumb of the layer are drawn from that segment (the near phalanx stayed in the
 *  layer behind the prop). */
function rigHand(pose: HandPose, view: HandView, pick: RigPick = ALL): RigLay {
  const sil: string[] = [];
  const ops: RigOp[] = [];
  const lines: {d: string; k?: number}[] = [];
  const from = pick.from ?? 0;
  const part = (d: string) => {
    sil.push(d);
    ops.push({d, kind: 'part'});
  };
  const pr = projOf(view);
  const palm = palmOf(view, pr);
  const th = thumb(pose.th, pr);
  const thD = chainD(th.pts, th.ws, pick.thumbFrom ?? 0);
  // the order of the fingers — from the far to the near one: from the little finger side the near one is the little finger, otherwise the
  // index finger
  const order = (view === 'ulnar' ? [0, 1, 2, 3] : [3, 2, 1, 0]).filter((i) => (pick.fingers ?? []).includes(i));
  const fs = order.map((i) => ({i, ...finger(i, pose.f[i], pose.spread, pr)}));
  if (view !== 'palmar') {
    // from the back (and in three quarters): the fingers go under the palm at the bases (the web), a finger bent beyond 90° — behind
    // itself; the thumb: from the back and from the little finger side — behind the palm (its edge shows), from the thumb side — on top
    if (pick.thumb && view !== 'radial') part(thD);
    for (const f of fs) part(chainD(f.pts, f.ws, from, Math.max(from + 1, f.vis)));
    if (pick.palm) {
      sil.push(palm);
      ops.push({d: palm, kind: 'fill'});
      // bent fingers: knuckle arcs at the bases (only from the back: in three quarters they fall onto the fingers as strokes)
      for (const f of view === 'dorsal' ? fs : []) {
        const bend = cl01((pose.f[f.i][0] - 0.75) / 0.4);
        if (bend > 0.05) {
          const [x, y] = f.pts[0];
          lines.push({d: `M ${f2(x - 2.4)} ${f2(y + 0.4)} Q ${f2(x)} ${f2(y - 1.8 * bend - 0.4)} ${f2(x + 2.4)} ${f2(y + 0.4)}`, k: 0.42 * bend});
        }
      }
    }
    if (pick.thumb && view === 'radial') {
      part(thD);
      if (pick.palm) ops.push({d: circleD([th.pts[0][0] - 0.6, th.pts[0][1] - 1.6], THW[0] + 1.5), kind: 'fill'});
    }
    return {sil, ops, lines, wrist: !!pick.palm};
  }
  // with the palm to the viewer: a bent finger lies on the palm — its far phalanges on top; the finger bases are covered by skin patches
  // (after all the fingers at once — no scraps of the thin outline between them)
  if (pick.palm) {
    sil.push(palm);
    ops.push({d: palm, kind: 'fill'});
    // the crease at the thumb; a palm pressed to a surface (flat) has none: behind the edge of a prop only one arc of the hand remained
    if (pose.th.opp <= 0.5 && !pick.noCrease) lines.push({d: 'M 10.2 7 C 4.6 13 3.6 21 5.6 29', k: 0.32});
  }
  for (const f of fs) part(chainD(f.pts, f.ws, from, f.back && from === 0 ? 1 : 3));
  if (pick.palm && from === 0) for (const f of fs) ops.push({d: circleD([f.pts[0][0], f.pts[0][1] - 1.6], f.ws[0] + 2), kind: 'fill'});
  for (const f of fs) if (f.back && from === 0) part(chainD(f.pts, f.ws, 1, 3));
  if (pick.thumb) {
    part(thD);
    if (pick.palm) ops.push({d: circleD([th.pts[0][0] - 1.2, th.pts[0][1] - 1.4], THW[0] + 1.6), kind: 'fill'});
  }
  return {sil, ops, lines, wrist: !!pick.palm};
}

// ---------- drawn shapes: the side view ----------
/** A hand from the side (radial — from the thumb side, ulnar — from the little finger side): body — the palm outline from the wrist around
 *  the knuckles back to the wrist (12 points, a smooth curve), fins — index … little finger, thumb — the thumb; gap — from which share of
 *  a finger the line between neighbours starts, t0 and t1 — where the outline of the thumb starts on the inner and the outer edge. All the
 *  shapes are made of the same parts: a transition between them blends the support points (mixSide). */
type SideArt = {body: P[]; fins: Fin[]; thumb: Fin; gap: number; t0: number; t1: number};
// hangs: a "mitten" — the fingers together, slightly bent towards the palm in one arc, the tips stepped (the little finger shorter and
// bent more); the thumb lies along the palm, its tip at the base of the index finger
const SIDE_RELAXED: SideArt = {
  body: [[-10.6, -2], [-12.2, 10], [-13.4, 22], [-13, 31], [-10.6, 36.6], [-4, 38.6], [3, 38.2], [9.2, 35.6], [12.6, 29], [13.8, 19], [13.2, 9], [11.6, -2]],
  fins: [
    {B: [-7, 33], C: [-7.6, 47], T: [-4.6, 58], wb: 4.0, wt: 3.3},
    {B: [-4.4, 34], C: [-4.2, 49.6], T: [-0.2, 60.6], wb: 4.0, wt: 3.3},
    {B: [-1.6, 34], C: [-0.6, 48.4], T: [4, 57.8], wb: 3.8, wt: 3.2},
    {B: [1.2, 33], C: [2.8, 44.4], T: [7.4, 52.4], wb: 3.5, wt: 3.0},
  ],
  thumb: {B: [7.4, 9], C: [13, 22], T: [6.6, 40.6], wb: 5.4, wt: 4.2},
  gap: 0.5, t0: 0.34, t1: 0.95,
};
// a fist: four bent fingers are one band across the hand on the palm side (the tips stick out slightly as bumps), the thumb lies on top at
// the wrist; the back of the hand continues the forearm line. A prop (a torch, a pen, a handle) passes under the band
const SIDE_FIST: SideArt = {
  body: [[-10.6, -2], [-12.4, 8], [-14.4, 18], [-14.8, 29], [-13.6, 38.4], [-8.6, 44.2], [-1, 45.6], [6.5, 44.8], [12.8, 41.6], [15.4, 30], [14.2, 15], [11.6, -2]],
  fins: [
    {B: [-3, 40.2], C: [6, 41], T: [13.4, 39.8], wb: 3.5, wt: 3.2},
    {B: [-3, 33.3], C: [7, 33.9], T: [15, 33], wb: 3.8, wt: 3.4},
    {B: [-3, 26.2], C: [7.6, 26.6], T: [15.6, 26], wb: 3.9, wt: 3.5},
    {B: [-3, 19], C: [7.4, 19.2], T: [14.8, 19], wb: 3.8, wt: 3.4},
  ],
  thumb: {B: [3.4, 7.6], C: [10.4, 9.4], T: [16, 14.2], wb: 4.9, wt: 3.7},
  gap: 0.3, t0: 0.22, t1: 0.22,
};
// an open hand from the side: the fingers straight, together, in line with the arm, the tips stepped; the thumb apart on the palm side
const SIDE_OPEN: SideArt = {
  body: [[-10.6, -2], [-11.4, 10], [-10.2, 21], [-8.6, 29], [-7.2, 33.4], [-3, 35.4], [2, 35.4], [6.4, 33.6], [8.2, 29], [10.2, 20], [11.8, 10], [11.6, -2]],
  fins: [
    {B: [-3.6, 31], C: [-3.8, 47], T: [-3.8, 61.6], wb: 4.0, wt: 3.2},
    {B: [-1.2, 32], C: [-1.2, 48], T: [-1.2, 64.4], wb: 3.9, wt: 3.2},
    {B: [1.2, 32], C: [1.4, 46], T: [1.6, 60.4], wb: 3.8, wt: 3.1},
    {B: [3.4, 31], C: [3.8, 44], T: [4.2, 54.6], wb: 3.6, wt: 3.0},
  ],
  thumb: {B: [9, 12], C: [15.6, 21], T: [16.6, 32.4], wb: 4.8, wt: 3.4},
  gap: 0.55, t0: 0.2, t1: 0.95,
};
/** Shapes with a side drawing: a hand on a rail is seen from the side only on the way of a gesture — as a hanging one, a palm on a door
 *  leaf — as an open one. */
const SIDE: Partial<Record<HandShape, SideArt>> = {relaxed: SIDE_RELAXED, rail: SIDE_RELAXED, fist: SIDE_FIST, open: SIDE_OPEN, flat: SIDE_OPEN};
const mixN = (a: number, b: number, k: number) => a + (b - a) * k;
const mixP = (a: P, b: P, k: number): P => [mixN(a[0], b[0], k), mixN(a[1], b[1], k)];
const mixFin = (a: Fin, b: Fin, k: number): Fin => ({B: mixP(a.B, b.B, k), C: mixP(a.C, b.C, k), T: mixP(a.T, b.T, k), wb: mixN(a.wb, b.wb, k), wt: mixN(a.wt, b.wt, k)});
/** A transition between the drawn side shapes: the support points of the palm and the fingers go from one shape to the other — the
 *  fingers bend. */
const mixSide = (a: SideArt, b: SideArt, k: number): SideArt => ({
  body: a.body.map((p, i) => mixP(p, b.body[i], k)),
  fins: a.fins.map((f, i) => mixFin(f, b.fins[i], k)),
  thumb: mixFin(a.thumb, b.thumb, k),
  gap: mixN(a.gap, b.gap, k), t0: mixN(a.t0, b.t0, k), t1: mixN(a.t1, b.t1, k),
});
/** A hand layer from the side: the silhouette — the palm, four fingers and the thumb as one shape; the lines — the edge of the near finger
 *  over the far one (from the thumb side the near one is the index finger, from the little finger side — the little finger); the thumb is
 *  seen in front only from its own side (radial) — from the little finger side it is behind the palm, its edge is in the silhouette. */
function sideLay(a: SideArt, view: HandView): HandLay {
  const gs = a.fins.map((f) => finGeo(f));
  const tg = finGeo(a.thumb);
  const near = view === 'radial' ? [0, 1, 2] : [3, 2, 1];
  // a hanging hand has the little finger separated by a step of the silhouette — two lines between the fingers; the band of a fist is
  // split by three (the third line appears on the way to the fist — without a jump)
  const k3 = 0.5 * cl01((0.5 - a.gap) / 0.15);
  const lines = near.map((i, n) => ({d: finEdge(gs[i], view === 'radial' ? 'R' : 'L', a.gap, 1), k: n < 2 ? 0.5 : k3})).filter((l) => l.k > 0.02);
  return {sil: [smooth(a.body) + ' Z', ...gs.map((g) => g.out), tg.out], lines, over: view === 'radial' ? [thumbOver(a.thumb, a.t0, a.t1, 'L')] : []};
}
/** The drawn side shape for a shape (and a transition from another one) — or null: such a hand is drawn by the skeleton. */
function sideArt(shape: HandShape, from?: HandMix): SideArt | null {
  const to = SIDE[shape];
  if (!to) return null;
  if (!from || from.k >= 1 || from.shape === shape) return to;
  const a = SIDE[from.shape];
  return a ? mixSide(a, to, cl01(from.k)) : null;
}

// ---------- drawn shapes: grips with the back to the viewer ----------
/** A hand with its back to the viewer and a prop: the palm palmD(yk), fins — the fingers from the little finger to the index finger (the
 *  lines between them — from share gap), thumb — the thumb, index — the index finger as a separate shape over the prop (a pen). */
type FaceArt = {yk: number; fins: Fin[]; gap: number; thumb: Fin; index?: Fin};
const FACE: Partial<Record<HandShape, FaceArt>> = {
  // writes: the pen between the thumb and the index finger — the tip comes out from under the bent index finger, the tail rises above the
  // dip between the thumb and the index finger; the middle, ring and little finger are tucked
  pen: {
    yk: 32, gap: 0.25,
    fins: [
      {B: [-10.2, 29.6], C: [-10.8, 36.6], T: [-9.8, 41.6], wb: 3.4, wt: 3.2},
      {B: [-3.8, 32], C: [-4.2, 40.6], T: [-3.4, 46], wb: 3.8, wt: 3.5},
      {B: [2.9, 33], C: [3.2, 43], T: [3.4, 50], wb: 4.0, wt: 3.5},
    ],
    index: {B: [9.4, 31], C: [12.6, 44], T: [9.2, 50.6], wb: 4.0, wt: 3.3},
    thumb: {B: [12, 9], C: [19.6, 22], T: [15, 36.6], wb: 5.0, wt: 3.5},
  },
  // a phone at the ear: the fingers bent onto the back cover of the phone — they lie across it in an arc, the tips towards the face (−x);
  // the thumb along the near edge of the phone. The phone is drawn before the hand
  ear: {
    yk: 34, gap: 0.36,
    fins: [
      {B: [-10.2, 32.6], C: [-12.8, 41.6], T: [-18.6, 45.6], wb: 3.4, wt: 3.0},
      {B: [-3.8, 35.2], C: [-6.4, 48.4], T: [-13.8, 54.4], wb: 3.7, wt: 3.2},
      {B: [2.9, 36], C: [1.4, 51.6], T: [-7, 60], wb: 3.9, wt: 3.3},
      {B: [9.6, 34.5], C: [9.6, 50.4], T: [2, 60.4], wb: 3.8, wt: 3.2},
    ],
    thumb: {B: [11, 10], C: [16.6, 19], T: [16.4, 31], wb: 4.9, wt: 3.6},
  },
  // a folder or a phone in the hand: the back of the hand at the near edge, four fingers lie on the cover — separate (the lines between them
  // start almost at the knuckles), straight, without a sideways bend, bent over the edge (shorter than open ones); the thumb behind the
  // prop. No creases at the joints: in a medium shot they read as scratches
  phone: {
    yk: 32, gap: 0.2,
    fins: [
      {B: [-10.2, 30.6], C: [-10.6, 39], T: [-10.9, 46.4], wb: 3.5, wt: 3.1},
      {B: [-3.8, 32.6], C: [-4, 42.6], T: [-4.1, 51.4], wb: 3.8, wt: 3.3},
      {B: [2.9, 33.4], C: [3, 44], T: [3.1, 53.4], wb: 4.0, wt: 3.4},
      {B: [9.6, 32], C: [10, 42], T: [10.3, 50.4], wb: 3.9, wt: 3.3},
    ],
    thumb: {B: [11, 9], C: [17.4, 17], T: [17, 30], wb: 4.9, wt: 3.4},
  },
};
// a phone lying on the palm screen up (tap): the palm under the phone is wider than it on the finger side — along the side edge (−x) a band
// of the hand shows, from it three fingers curl over the edge onto the screen
const TAP_PALM = 'M -11 -2 C -12.8 5 -19.4 8.8 -22.4 14.4 C -23.8 19 -24 30 -23.4 34.4 C -22.6 38 -19.4 38.4 -16.4 36.4 L 12.2 30 C 12.8 18 12.6 8 11.6 -2 Z';
const TAP_TIPS: Fin[] = [17.2, 23.6, 30].map((y, i) => ({B: [-22, y], C: [-21.4, y + 1.6], T: [-15 + i * 0.3, y + 2.2], wb: 3.3, wt: 2.9}));
const tapThumb = (q: number): Fin => ({B: [10.6, 5.6], C: [18.6 + 0.8 * q, 15 - 3.4 * q], T: [5 + 5.4 * q, 24.6 - 5.6 * q], wb: 5.2, wt: 3.7 + 0.5 * q});

// ---------- hands ----------
/** The palm of the dorsal and palmar views: from the wrist (half-width ≈ 11) to the knuckles (width ≈ 28). yk — the knuckle level. */
function palmD(yk = 34) {
  return `M -11 -2 C -12.4 9 -14.2 ${f2(yk * 0.6)} -13.8 ${f2(yk - 2)} C -13.6 ${f2(yk + 1)} -11 ${f2(yk + 2.5)} -8 ${f2(yk + 2)} L 9 ${f2(yk + 2.5)} C 12 ${f2(yk + 2.5)} 13.6 ${f2(yk + 1)} 13.6 ${f2(yk - 2)} C 13.8 ${f2(yk * 0.6)} 12.8 9 11.6 -2 Z`;
}

/** The hand of a shape in a view. q — the progress of a live shape: count — how many fingers are unbent (a fraction — a finger on its way),
 *  rail — the tapping phase (a cycle is 1), tap — the thumb lift over the screen (0 — it touches). from — a transition from another
 *  shape: share k of the way from from.shape to shape (the joint angles blend — the fingers bend instead of being swapped). */
export function handParts(shape: HandShape, view: HandView, st: HandStyle, q = 0, from?: HandMix): {back?: React.ReactNode; front: React.ReactNode} {
  const D = (l: HandLay) => handLayer(l, st);
  const side = view === 'radial' || view === 'ulnar';
  if (side) {
    // from the side: a hanging hand, a fist, an open hand and the transitions between them — drawn shapes (one silhouette, fingers together)
    const art = sideArt(shape, from);
    if (art) return {front: D(sideLay(art, view))};
  } else if (!from || from.k >= 1 || from.shape === shape) {
    const a = FACE[shape];
    if (a) {
      const fg = fingers(a.fins, a.gap, 'R');
      const tg = finGeo(a.thumb);
      if (shape === 'pen') {
        // the pen is drawn by the body between the layers: the index finger and the thumb are over it (front), their bases with the
        // common outline — under it
        const index = finGeo(a.index!);
        return {
          back: D({sil: [palmD(a.yk), ...fg.sil, index.out, tg.out], lines: fg.lines}),
          front: D({sil: [], over: [{fill: index.out, edge: smooth([...index.L.slice(2), ...index.cap, ...index.R.slice().reverse().slice(0, 8)])}, thumbOver(a.thumb, 0.35, 0.35, 'L')]}),
        };
      }
      // a phone at the ear — the hand as one shape over the phone; a folder and a phone in the hand — the thumb behind the prop (back)
      if (shape === 'ear') return {front: D({sil: [tg.out, palmD(a.yk), ...fg.sil], lines: fg.lines})};
      return {back: D({sil: [tg.out]}), front: D({sil: [palmD(a.yk), ...fg.sil], lines: fg.lines})};
    }
  }
  const pose = handPose(shape, q, from);
  if (pose) {
    const R = (pick: RigPick = ALL) => rigLayer(rigHand(pose, view, shape === 'flat' ? {...pick, noCrease: true} : pick), st);
    switch (shape) {
      case 'phone':
      case 'cup':
        // the back of the hand at the near edge of the prop, the fingers across the back cover (the wall); the thumb behind the prop
        return {back: R({thumb: true}), front: R({palm: true, fingers: [0, 1, 2, 3]})};
      case 'ear':
        // a phone at the ear: the hand with its back over the phone, the thumb on the near side
        return {front: R()};
      case 'pen':
        // the pen between the layers: the palm, the tucked fingers, the bases of the index finger and the thumb — under it; the index
        // finger from the middle joint and the thumb from its second phalanx — over it
        return {back: R({palm: true, fingers: [0, 1, 2, 3], thumb: true}), front: R({fingers: [0], thumb: true, from: 1, thumbFrom: 1})};
      default:
        return {front: R()};
    }
  }
  if (shape === 'tap') {
    // the phone lies on the palm screen up (seen from above, squeezed by the view; the body draws it between back and front, the centre —
    // HAND_GRIP.tap.c, 36 × 24 frame units). The hand is one shape around the phone: at the near edge the heel of the palm shows, along
    // the side edge (−x) a band of the hand wider than the phone (the finger bases), from it three fingers curl over the edge onto the
    // screen: the fingers start on the visible band instead of hanging over the phone separately. The thumb goes from the mound at the
    // wrist over the other edge above the screen and taps: q = 0 — it touches, 1 — it is lifted
    const th = tapThumb(q);
    return {
      back: D({sil: [TAP_PALM, finGeo(th).out]}),
      front: D({sil: [], over: [...TAP_TIPS.map((f) => thumbOver(f, 0.4, 0.4)), thumbOver(th, 0.25, 0.25, 'L')]}),
    };
  }
  return {front: null};
}

// ---------- self-check of the drawing (the pose journal → tools/hands_check.mjs) ----------
/** A polyline along a path of absolute M, L, C, Z commands: the palm outline. */
function pathPoly(d: string): P[] {
  const t = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: P[] = [];
  let i = 0;
  let cur: P = [0, 0];
  let cmd = 'M';
  const num = () => parseFloat(t[i++]);
  while (i < t.length) {
    if (/[MLCZ]/.test(t[i])) cmd = t[i++];
    if (cmd === 'Z') continue;
    if (cmd === 'C') {
      const a: P = [num(), num()], b: P = [num(), num()], e: P = [num(), num()];
      for (let k = 1; k <= 8; k++) {
        const s = k / 8, m = 1 - s;
        out.push([m * m * m * cur[0] + 3 * m * m * s * a[0] + 3 * m * s * s * b[0] + s * s * s * e[0], m * m * m * cur[1] + 3 * m * m * s * a[1] + 3 * m * s * s * b[1] + s * s * s * e[1]]);
      }
      cur = e;
    } else {
      cur = [num(), num()];
      out.push(cur);
    }
  }
  return out;
}
const distSeg = (p: P, a: P, b: P): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
};
const inPoly = (poly: P[], p: P): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
  }
  return c;
};
/** How far a point is outside an outline (0 — inside). */
const outside = (poly: P[], p: P): number => (inPoly(poly, p) ? 0 : Math.min(...poly.map((q, i) => distSeg(p, q, poly[(i + 1) % poly.length]))));
/** The axis of a hand part: points and the half-width at them. */
type Bone = {pts: P[]; ws: number[]};
const finBone = (f: Fin, n = 10): Bone => {
  const pts: P[] = [];
  const ws: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    pts.push([a * f.B[0] + b * f.C[0] + c * f.T[0], a * f.B[1] + b * f.C[1] + c * f.T[1]]);
    ws.push(f.wb + (f.wt - f.wb) * Math.pow(t, 1.4));
  }
  return {pts, ws};
};
/** What is drawn: the palm outline (null — none), the fingers in order and the thumb. The same choice of the drawing as in handParts. */
function handSkel(shape: HandShape, view: HandView, q = 0, from?: HandMix): {palm: P[] | null; fins: Bone[]; thumb: Bone | null} {
  const side = view === 'radial' || view === 'ulnar';
  if (side) {
    const art = sideArt(shape, from);
    if (art) return {palm: pathPoly(smooth(art.body) + ' Z'), fins: art.fins.map((f) => finBone(f)), thumb: finBone(art.thumb)};
  } else if (!from || from.k >= 1 || from.shape === shape) {
    const a = FACE[shape];
    if (a) return {palm: pathPoly(palmD(a.yk)), fins: [...a.fins, ...(a.index ? [a.index] : [])].map((f) => finBone(f)), thumb: finBone(a.thumb)};
  }
  const pose = handPose(shape, q, from);
  if (pose) {
    const pr = projOf(view);
    const th = thumb(pose.th, pr);
    return {palm: pathPoly(palmOf(view, pr)), fins: [0, 1, 2, 3].map((i) => {
      const f = finger(i, pose.f[i], pose.spread, pr);
      return {pts: f.pts, ws: f.ws};
    }), thumb: {pts: th.pts, ws: th.ws}};
  }
  if (shape === 'tap') return {palm: pathPoly(TAP_PALM), fins: TAP_TIPS.map((f) => finBone(f)), thumb: finBone(tapThumb(q))};
  return {palm: null, fins: [], thumb: null};
}
/** The point and the half-width of a part at share t of its length (by the point numbers). */
const boneAt = (b: Bone, t: number): {p: P; w: number} => {
  const x = Math.max(0, Math.min(1, t)) * (b.pts.length - 1);
  const i = Math.min(b.pts.length - 2, Math.floor(x));
  const k = x - i;
  return {p: [b.pts[i][0] + (b.pts[i + 1][0] - b.pts[i][0]) * k, b.pts[i][1] + (b.pts[i + 1][1] - b.pts[i][1]) * k], w: b.ws[i] + (b.ws[i + 1] - b.ws[i]) * k};
};
const boneLen = (b: Bone): number => b.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - b.pts[i][0], p[1] - b.pts[i][1]), 0);
/** The length of the free end of finger a next to its neighbour b: from the tip back until the finger meets the neighbour or the palm. */
const freeEnd = (a: Bone, b: Bone, palm: P[]): number => {
  const N = 24;
  for (let i = N; i >= 0; i--) {
    const {p, w} = boneAt(a, i / N);
    let near = Infinity;
    let wn = 0;
    for (let j = 0; j <= N; j++) {
      const q = boneAt(b, j / N);
      const d = Math.hypot(p[0] - q.p[0], p[1] - q.p[1]);
      if (d < near) {
        near = d;
        wn = q.w;
      }
    }
    if (near <= w + wn + 0.4 || inPoly(palm, p)) return (1 - i / N) * boneLen(a);
  }
  return boneLen(a);
};
const mixKey = (shape: HandShape, from?: HandMix) => (from && from.k < 1 && from.shape !== shape ? `${from.shape}${from.k.toFixed(2)}` : '');
const AUDIT = new Map<string, {gap: number; notch: number}>();
/** The self-check of a hand drawing: gap — how far a finger base (or the thumb base) is outside the palm outline (a finger torn off);
 *  notch — the deepest notch between neighbouring fingers (both fingers apart for that length from the tips), frame units. */
function drawAudit(shape: HandShape, view: HandView, q = 0, from?: HandMix): {gap: number; notch: number} {
  // (the drawing depends only on the shape, the view, the progress q and the transition — the result is remembered: the journal is
  // written for every hand of every frame)
  const key = `${shape}|${view}|${q.toFixed(2)}|${mixKey(shape, from)}`;
  const hit = AUDIT.get(key);
  if (hit) return hit;
  const s = handSkel(shape, view, q, from);
  let gap = 0;
  let notch = 0;
  if (s.palm) {
    for (const b of [...s.fins, ...(s.thumb ? [s.thumb] : [])]) gap = Math.max(gap, outside(s.palm, b.pts[0]));
    for (let i = 0; i + 1 < s.fins.length; i++) notch = Math.max(notch, Math.min(freeEnd(s.fins[i], s.fins[i + 1], s.palm), freeEnd(s.fins[i + 1], s.fins[i], s.palm)));
  }
  const res = {gap, notch};
  if (AUDIT.size > 20000) AUDIT.clear();
  AUDIT.set(key, res);
  return res;
}
const GRIP = new Map<string, number>();
/** The grip: how many fingers lie on a prop — the prop axis (a segment through c along a, 14 frame units both ways: the part of the prop
 *  inside the hand) passes under a finger, within its width. A fist holds a prop when at least three fingers lie on it: a prop along one
 *  finger (under none — next to the hand) is not a grip. */
function gripAudit(shape: HandShape, view: HandView, q: number, from: HandMix | undefined, c: P, a: P): number {
  const key = `${shape}|${view}|${q.toFixed(2)}|${mixKey(shape, from)}|${c[0].toFixed(1)},${c[1].toFixed(1)}|${a[0].toFixed(2)},${a[1].toFixed(2)}`;
  const hit = GRIP.get(key);
  if (hit !== undefined) return hit;
  const s = handSkel(shape, view, q, from);
  const al = Math.hypot(a[0], a[1]) || 1;
  const A: P = [c[0] - (a[0] / al) * 14, c[1] - (a[1] / al) * 14];
  const B: P = [c[0] + (a[0] / al) * 14, c[1] + (a[1] / al) * 14];
  const n = s.fins.filter((b) => {
    for (let i = 0; i <= 16; i++) {
      const p = boneAt(b, i / 16);
      if (distSeg(p.p, A, B) <= p.w) return true;
    }
    return false;
  }).length;
  if (GRIP.size > 20000) GRIP.clear();
  GRIP.set(key, n);
  return n;
}

/** CharacterStyle.handAudit of the style: the self-check of the drawn hand of a pose (gap, notch) and, with a prop in the fist, how many
 *  fingers lie on it (wrap; grip — the prop centre and axis in the hand frame). */
export function handAudit(h: {shape: HandShape; view: HandView; q: number; from?: HandMix}, grip?: {c: P; axis: P}): {gap: number; notch: number; wrap?: number} {
  const d = drawAudit(h.shape, h.view, h.q, h.from);
  return grip ? {...d, wrap: gripAudit(h.shape, h.view, h.q, h.from, grip.c, grip.axis)} : d;
}
