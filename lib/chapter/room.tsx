// Interior engine for location kits (a café, stairs, a flat, an office): a room in metres → a camera → flat SVG polygons.
// No palette recolouring: the kit sets colours explicitly per preset; a preset with a colour grade goes into the frame graded (grade.ts).
// Drawing order: layers in order; inside a layer with sort — from far to near (by the item centre). The outline is comic-like, by depth.
import React from 'react';
import {Cam, V3, dist, ellipse, focal, linePath, polyPath, pt, quad, toCam} from '../persp/persp';
import {mixHex, scaleHex} from '../anim';
import {FONT_KR} from '../hud/hud';
import {Stage, eventsOf, hold} from '../staging/stage';

export type Grad = {radial: string; a: number; a1?: number}; // radial light pool: colour, opacity in the centre (a1 — at the edge)
export type RItem = {
  pts?: V3[];
  line?: [V3, V3];
  sortAt?: V3; // draw(sort): a depth point instead of the centre (a light pool — by the centre of its floor, right after it)
  sortBias?: number; // draw(sort): how many metres nearer to count it (draw later than equals)
  text?: {origin: V3; u: V3; v: V3; str: string; size: number; weight?: number; anchor?: 'start' | 'middle' | 'end'; font?: string; italic?: boolean; read?: string}; // read — a text the shot must show in full (frame journal)
  fill?: string | Grad;
  stroke?: string; // for a line — the line colour; for a polygon — its own outline instead of the common one
  sw?: number; // width, m (line — line width; polygon — outline)
  ol?: boolean; // polygon outline (default — yes, except light pools and text)
  op?: number;
  blend?: 'screen' | 'multiply';
  blur?: number; // px
  cull?: boolean; // do not draw a face turned away from the camera (boxes)
  key?: string;
};

export type DrawOpts = {outline: string; olK?: number; minPx?: number; maxPx?: number};

const centroid = (pts: V3[]): V3 => {
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / pts.length, y / pts.length, z / pts.length];
};
function normal(p: V3[]): V3 {
  const a = p[0], b = p[1], c = p[2];
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

let gradN = 0;

/** List of items → SVG elements. sort — from far to near by the centre. */
export function draw(cam: Cam, items: RItem[], o: DrawOpts, sort = false): React.ReactNode[] {
  const fl = focal(cam);
  const list = sort
    ? items.map((it) => ({it, d: dist(cam, it.sortAt ?? (it.pts ? centroid(it.pts) : it.line ? centroid(it.line) : it.text!.origin)) - (it.sortBias ?? 0)})).sort((a, b) => b.d - a.d).map((x) => x.it)
    : items;
  const out: React.ReactNode[] = [];
  const defs: React.ReactNode[] = [];
  let k = 0;
  for (const it of list) {
    if (it.text) {
      const {origin, u, v, str, size, weight, anchor, font, italic, read} = it.text;
      const p0 = pt(cam, origin);
      const a = pt(cam, [origin[0] + u[0], origin[1] + u[1], origin[2] + u[2]]);
      const b = pt(cam, [origin[0] + v[0], origin[1] + v[1], origin[2] + v[2]]);
      if (!p0 || !a || !b) continue;
      if ((fl * 0.01 * size) / p0.z < 2 || p0.z < 0.25) continue; // smaller than 2 px or the anchor point right at the camera (letters would blow up over the whole frame)
      // a text on a plane at a steep angle is not drawn (production rule 7, "vertical numbers"; a floor number on a wall edge-on to the
      // camera was squeezed ~25 times): squeeze — the ratio of the axes of the letter box in the frame (u and v of the text are of equal
      // length); from the back side (mirrored) — not drawn. Between squeeze 0.5 and 0.6 the text fades in by opacity — no jump on a moving
      // camera. A required text of the shot stays readable on another wall: the kit puts it where it is visible
      const A = a.x - p0.x, B = a.y - p0.y, Cc = b.x - p0.x, D = b.y - p0.y;
      const det = A * D - B * Cc;
      if (det <= 0) continue;
      const s2 = (A * A + B * B + Cc * Cc + D * D) / 2;
      const disc = Math.sqrt(Math.max(0, s2 * s2 - det * det));
      const sq = Math.sqrt(Math.max(0, s2 - disc) / Math.max(1e-9, s2 + disc));
      if (sq < 0.5) continue;
      const opK = Math.min(1, (sq - 0.5) / 0.1);
      out.push(
        <text key={`t${k++}`} transform={`matrix(${A} ${B} ${Cc} ${D} ${p0.x} ${p0.y})`} x={0} y={0}
          fontFamily={font ?? FONT_KR} fontWeight={weight ?? 700} fontSize={size} fontStyle={italic ? 'italic' : undefined} textAnchor={anchor ?? 'middle'}
          fill={typeof it.fill === 'string' ? it.fill : '#000'} opacity={(it.op ?? 1) * opK} data-stage={read ? 'read' : 'line'} data-read={read}>{str}</text>, // read — a required text of the shot; other kit texts — "line": not cut by the title bar or the edge
      );
      continue;
    }
    let d: string | null = null;
    let c: V3;
    if (it.pts) {
      if (it.cull) {
        const n = normal(it.pts);
        const cc = centroid(it.pts);
        if (n[0] * (cc[0] - cam.pos[0]) + n[1] * (cc[1] - cam.pos[1]) + n[2] * (cc[2] - cam.pos[2]) >= 0) continue;
      }
      d = polyPath(cam, it.pts);
      c = centroid(it.pts);
    } else if (it.line) {
      d = linePath(cam, it.line[0], it.line[1]);
      c = centroid(it.line);
    } else continue;
    if (!d) continue;
    const depth = Math.max(0.2, toCam(cam, c)[2]);
    let fill: string = 'none';
    if (typeof it.fill === 'object') {
      const id = `rg${gradN++ % 100000}`;
      defs.push(
        <radialGradient key={id} id={id}>
          <stop offset="0" stopColor={it.fill.radial} stopOpacity={it.fill.a} />
          <stop offset="0.45" stopColor={it.fill.radial} stopOpacity={it.fill.a * 0.62} />
          <stop offset="0.8" stopColor={it.fill.radial} stopOpacity={it.fill.a * 0.16 + (it.fill.a1 ?? 0)} />
          <stop offset="1" stopColor={it.fill.radial} stopOpacity={it.fill.a1 ?? 0} />
        </radialGradient>,
      );
      fill = `url(#${id})`;
    } else if (it.fill) fill = it.fill;
    const isLine = !!it.line;
    const olOn = !isLine && it.ol !== false && typeof it.fill !== 'object';
    const stroke = isLine ? it.stroke ?? o.outline : olOn ? it.stroke ?? o.outline : undefined;
    const swM = isLine ? it.sw ?? 0.01 : it.sw ?? 0.012 * (o.olK ?? 1.6);
    const swPx = stroke ? Math.round(2 * Math.min(isLine ? 60 : o.maxPx ?? 7, Math.max(o.minPx ?? 0.8, (fl * swM) / depth))) / 2 : 0;
    out.push(
      <path key={it.key ?? `p${k++}`} d={d} fill={isLine ? 'none' : fill} stroke={stroke} strokeWidth={swPx} strokeLinejoin="round" strokeLinecap="round"
        opacity={it.op ?? 1} style={it.blend || it.blur ? {mixBlendMode: it.blend, filter: it.blur ? `blur(${it.blur}px)` : undefined} : undefined} />,
    );
  }
  if (defs.length) out.unshift(<defs key="defs">{defs}</defs>);
  return out;
}

// --- builders ---

/** A rectangle on the plane x = const (left/right wall): z0..z1, y0..y1. */
export const wallX = (x: number, z0: number, z1: number, y0: number, y1: number): V3[] => [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]];
/** A rectangle on the plane z = const (front/back wall): x0..x1, y0..y1. */
export const wallZ = (z: number, x0: number, x1: number, y0: number, y1: number): V3[] => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
/** A rectangle on the plane y = const (floor, ceiling, table top): x0..x1, z0..z1. */
export const flatY = (y: number, x0: number, x1: number, z0: number, z1: number): V3[] => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];

/** A box: faces outwards, those turned away from the camera are culled. Colours: top, front/back (along z), sides (along x). */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, top: string, front: string, side?: string, extra: Partial<RItem> = {}): RItem[] {
  const sd = side ?? scaleHex(front, 0.8);
  return [
    {pts: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], fill: top, cull: true, ...extra}, // top (normal +y)
    {pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], fill: scaleHex(front, 0.6), cull: true, ...extra}, // bottom
    {pts: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], fill: front, cull: true, ...extra}, // face z0 (normal -z)
    {pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], fill: front, cull: true, ...extra}, // face z1
    {pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], fill: sd, cull: true, ...extra}, // face x0 (normal -x)
    {pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], fill: sd, cull: true, ...extra}, // face x1
  ];
}

/** Text on a wall x = const (readable from the room where x is larger than the wall: dir = 1) or z = const. */
export function textOn(plane: 'x' | 'z' | 'y', at: V3, str: string, size: number, fill: string, o: {weight?: number; anchor?: 'start' | 'middle' | 'end'; dir?: 1 | -1; font?: string} = {}): RItem {
  const s = 0.01;
  const dir = o.dir ?? 1;
  const u: V3 = plane === 'x' ? [0, 0, -s * dir] : plane === 'z' ? [s * dir, 0, 0] : [s, 0, 0];
  const v: V3 = plane === 'y' ? [0, 0, -s] : [0, -s, 0];
  return {text: {origin: at, u, v, str, size, weight: o.weight, anchor: o.anchor, font: o.font}, fill};
}

/** A light pool on the floor (y = 0) under a lamp: one smooth radial falloff. */
export const floorPool = (x: number, z: number, rx: number, rz: number, color: string, a: number, y = 0.003): RItem => ({pts: ellipse([x, y, z], [rx, 0, 0], [0, 0, rz], 32), fill: {radial: color, a}});
/** A glow on a wall z = const. */
export const wallGlowZ = (z: number, x: number, y: number, rx: number, ry: number, color: string, a: number): RItem => ({pts: ellipse([x, y, z], [rx, 0, 0], [0, ry, 0], 28), fill: {radial: color, a}});

/** Surface tone under light: mix(base, light, k). */
export const lit = (base: string, light: string, k: number) => mixHex(base, light, k);

export {quad, ellipse};

// --- a figure looking at a target (staging layer: the look event, "to" — the name of a kit point) ---

export type Gaze = {headTurn: number; gazeX: number; gazeY: number};
const lim1 = (v: number) => Math.max(-1, Math.min(1, v));

/** A figure looking at a point of the room: head and eye turn are computed from the position of the target relative to the head in the
 *  frame of this camera, not by a sign in kit code (otherwise the look goes to the side where nobody is). head, target — room points, m;
 *  facing — how the figure is drawn (front — facing the camera, back — away from it). headTurn: −1..1, 1 — facing right on screen;
 *  gazeX — the same; gazeY: −1 — up. The head takes up to three quarters of the turn, the rest is the eyes. backHead — from behind the eyes
 *  are not visible, the head turn carries the look: it takes a larger share of the angle (gazeBy). */
function gazeTo(cam: Cam, head: V3, target: V3, facing: 'front' | 'back' = 'front', backHead = false): Gaze {
  const h = toCam(cam, head);
  const t = toCam(cam, target);
  const dx = t[0] - h[0], dy = t[1] - h[1], dz = t[2] - h[2];
  const yaw = (Math.atan2(dx, facing === 'back' ? dz : -dz) * 180) / Math.PI; // angle to the target from the face axis, + — right on screen
  const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI; // + — up
  const head0 = facing === 'back' && backHead ? 0.8 * lim1(yaw / 65) : 0.65 * lim1(yaw / 80);
  return {headTurn: head0, gazeX: lim1(yaw / 40), gazeY: lim1(-pitch / 35)};
}

const mixGaze = (a: Gaze, b: Gaze, k: number): Gaze => ({
  headTurn: a.headTurn + (b.headTurn - a.headTurn) * k, gazeX: a.gazeX + (b.gazeX - a.gazeX) * k, gazeY: a.gazeY + (b.gazeY - a.gazeY) * k,
});

/** Look of figure who by the look events of the shot: the event target ("to") is the name of a kit point (points), without events — the
 *  base target base. Events go in time order and replace each other by their progress (hold: entry "in", exit "out" or "stay"); a target that
 *  is not among the kit points does not move the look. Direction — gazeTo: from the target position in the room. k — the progress of the last
 *  event towards target to. */
export function gazeBy(cam: Cam, stage: Stage | undefined, who: string, lt: number, head: V3, facing: 'front' | 'back',
  points: Record<string, V3>, base: string): Gaze & {on: Record<string, number>} {
  let g = gazeTo(cam, head, points[base], facing, true);
  const on: Record<string, number> = {};
  for (const e of eventsOf(stage, 'look', undefined, who).sort((a, b) => a.t0 - b.t0)) {
    const to = points[String(e.to)];
    if (!to) continue;
    const k = hold(e, lt);
    on[String(e.to)] = Math.max(on[String(e.to)] ?? 0, k);
    g = mixGaze(g, gazeTo(cam, head, to, facing, true), k);
  }
  return {...g, on};
}

/** Screen point and scale for a figure standing at (x, 0, z) of the room: {x, y, h (px per height)}; null — behind the camera. */
export function feet(cam: Cam, x: number, z: number, heightM: number, y = 0) {
  const p = pt(cam, [x, y, z]);
  if (!p) return null;
  return {x: p.x, y: p.y, h: (focal(cam) * heightM) / p.z, z: p.z};
}
