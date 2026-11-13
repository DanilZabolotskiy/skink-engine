// Frame journal of the staging layer (docs/STAGING.md, "Frame journal"): what stands where in the finished frame, for the automatic
// layout checks. The service composition (<channel>-chapter-stage) includes the journal; a frame writes it to the browser console as
// lines "STAGE {json}"; tools/stage_layout.mjs collects it, the rules are in tools/pipeline/stage_check.py (layout_checks).
// Marks in the frame — the data-stage attribute:
//   bar — the title bar; card — a text card; head (+ data-who) — a figure's head; fig (+ data-who) — a figure (svg, feet (0, 0), crown
//   (0, −1010)); line — a document line; read (+ data-read = id) — a text the shot must show in full (a room number, a sign, a display);
//   hit (+ data-who, data-obj) — a figure stands inside a prop (set by the kit); prop — a place prop (PropMark / propMark); hand — a hand
//   drawn by the kit (handMark). The journal collects the kit texts itself (all SVG <text> and HTML text); an intended cut of a text is
//   marked with data-cut-ok="<why>" on it or on its group.
import React from 'react';
import {continueRender, delayRender} from 'remotion';
import type {Stage} from './stage';

/** Staging layer of the current shot, the shot time and the frame rate: figures take their gesture from here without asking the kit. */
export const StageCtx = React.createContext<{stage: Stage | undefined; lt: number; fps: number} | null>(null);
/** The frame journal is on (service composition). */
export const StageLogCtx = React.createContext(false);

// frame size, px: taken from the frame root when the journal is written
let W = 1920;
let H = 1080;
type R = [number, number, number, number]; // x0, y0, x1, y1

const rectOf = (el: Element): R => {
  const b = el.getBoundingClientRect();
  return [+b.left.toFixed(1), +b.top.toFixed(1), +b.right.toFixed(1), +b.bottom.toFixed(1)];
};

/** Opacity of an element including its ancestors. */
function alphaOf(el: Element): number {
  let a = 1;
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    const o = parseFloat(getComputedStyle(e).opacity || '1');
    if (!Number.isNaN(o)) a *= o;
  }
  return a;
}

const rgbaAlpha = (c: string) => {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return c && c !== 'none' && c !== 'transparent' ? 1 : 0;
  const p = m[1].split(',').map((x) => parseFloat(x));
  return p.length > 3 ? p[3] : 1;
};

/** A gradient fill is opaque if all its stops are opaque (light pools and glows are semi-transparent: they do not cover a text). */
function paintOpaque(fill: string): boolean {
  const id = fill.match(/#([^"')]+)/)?.[1];
  const g = id ? document.getElementById(id) : null;
  if (!g) return true;
  const stops = Array.from(g.querySelectorAll('stop'));
  return stops.length > 0 && stops.every((st) => {
    const cs = getComputedStyle(st);
    return parseFloat(cs.stopOpacity || '1') * rgbaAlpha(cs.stopColor) >= 0.5;
  });
}

/** Does an element cover what is under it: an SVG shape with a fill or a stroke, a block with a background; containers and
 *  transparent ones do not. */
function opaque(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (['svg', 'g', 'defs', 'clippath', 'body', 'html'].includes(tag)) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || alphaOf(el) < 0.5) return false;
  if (el instanceof SVGElement) {
    const fo = parseFloat(cs.fillOpacity || '1');
    const fill = cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url') ? rgbaAlpha(cs.fill) * fo : 0;
    const stroke = cs.stroke && cs.stroke !== 'none' ? rgbaAlpha(cs.stroke) * parseFloat(cs.strokeOpacity || '1') : 0;
    return fill >= 0.5 || stroke >= 0.5 || (cs.fill.startsWith('url') && fo >= 0.5 && paintOpaque(cs.fill));
  }
  return rgbaAlpha(cs.backgroundColor) >= 0.5;
}

/** Share of a text covered by what is drawn over it: a grid of points over its box; a point counts if it lands on the text itself. */
function occlusion(el: Element, r: R): {occ: number; n: number; by: string} {
  let seen = 0;
  let hid = 0;
  const by: Record<string, number> = {};
  const NX = 12;
  const NY = 6;
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      const x = r[0] + ((i + 0.5) / NX) * (r[2] - r[0]);
      const y = r[1] + ((j + 0.5) / NY) * (r[3] - r[1]);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const st = document.elementsFromPoint(x, y);
      const k = st.findIndex((e) => e === el || el.contains(e));
      if (k < 0) continue;
      seen++;
      const top = st.slice(0, k).find(opaque);
      if (top) {
        hid++;
        const ds = top.closest('[data-stage]')?.getAttribute('data-stage');
        const who = ds && ds !== 'root' ? ds : `${top.tagName.toLowerCase()} ${getComputedStyle(top).fill || getComputedStyle(top).backgroundColor}`.slice(0, 40);
        by[who] = (by[who] ?? 0) + 1;
      }
    }
  }
  return {occ: seen ? hid / seen : 0, n: seen, by: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 2).join(', ')};
}

/** Is a figure visible: points along the body axis (head, chest, waist, knees) in the frame, and in at least one of them the figure itself
 *  is on top (a clip-path cut — round a corner, behind a leaf — and what is drawn over it are taken into account). */
function figVisible(svg: SVGSVGElement): {vis: number; rect: R; feet: [number, number]} {
  const m = svg.getScreenCTM();
  const P = (x: number, y: number): [number, number] => (m ? [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f] : [0, 0]);
  const pts: [number, number][] = [[0, -900], [0, -700], [0, -560], [-45, -300], [45, -300], [0, -120], [-70, -640], [70, -640]].map(([x, y]) => P(x, y));
  let inFrame = 0;
  let hit = 0;
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    inFrame++;
    const top = document.elementsFromPoint(x, y).find(opaque);
    if (top && svg.contains(top)) hit++;
  }
  const a = P(-110, -1010);
  const b = P(110, 0);
  return {vis: +(hit / pts.length).toFixed(2), rect: [+a[0].toFixed(1), +a[1].toFixed(1), +b[0].toFixed(1), +b[1].toFixed(1)], feet: [+P(0, 0)[0].toFixed(1), +P(0, 0)[1].toFixed(1)]};
}

const r1 = (v: number) => +v.toFixed(1);

/** Figure attributes (Character.tsx, svg data-stage="fig"): view, the staging gesture and its hold, head turn and tilt, gaze, arms — the
 *  wrist and the hand edge of each arm in frame pixels. The "event without a visible change" check uses them (stage_check.py). */
function figAttrs(svg: SVGSVGElement) {
  const m = svg.getScreenCTM();
  const P = (x: number, y: number) => (m ? [r1(m.a * x + m.c * y + m.e), r1(m.b * x + m.d * y + m.f)] : [0, 0]);
  const g = (k: string) => svg.getAttribute(k) ?? '';
  const [pose, pk] = g('data-pose').split(':');
  const arms = g('data-arms').split(';').filter(Boolean).map((s) => {
    const [wx, wy, tx, ty] = s.split(',').map(Number);
    return [...P(wx, wy), ...P(tx, ty)];
  });
  return {facing: g('data-facing') || null, pose: pose || null, pk: pk ? +pk : 0, turn: +(g('data-turn') || 0), tilt: +(g('data-tilt') || 0),
    gaze: (g('data-gaze') || '0,0').split(',').map(Number), arms, ppu: m ? +Math.hypot(m.a, m.b).toFixed(4) : 0, a: +alphaOf(svg).toFixed(2)};
}

/** The kit layer is the first child of the frame root (Chapter.tsx: the kit, then cards, the title bar, the place tag, the
 *  episode plate, the dip). */
const kitLayer = (): Element | null => document.querySelector('[data-stage="root"]')?.firstElementChild ?? null;

/** Visible share of an element: a grid of points over its box clipped by the frame (an arm with a long sleeve has a box far beyond the
 *  edge); of the points that land on the element itself — the share where nothing opaque is above it. 0 — the element is not in the
 *  frame or fully covered. */
function visShare(el: Element, r0: R, nx = 7, ny = 7): number {
  const r: R = [Math.max(0, r0[0]), Math.max(0, r0[1]), Math.min(W - 0.5, r0[2]), Math.min(H - 0.5, r0[3])];
  if (r[2] <= r[0] || r[3] <= r[1]) return 0;
  let on = 0;
  let top = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = r[0] + ((i + 0.5) / nx) * (r[2] - r[0]);
      const y = r[1] + ((j + 0.5) / ny) * (r[3] - r[1]);
      const st = document.elementsFromPoint(x, y);
      const k = st.findIndex((e) => e === el || el.contains(e));
      if (k < 0) continue;
      on++;
      if (!st.slice(0, k).some(opaque)) top++;
    }
  }
  return on ? +(top / on).toFixed(2) : 0;
}

type Q = [number, number, number, number, number, number, number, number]; // quadrilateral: x0 y0 x1 y1 x2 y2 x3 y3 (round)

/** Box of an SVG element in its coordinates (getBBox), shrunk by dx0…dy1, — into the frame by getScreenCTM: four corners. */
function quadOf(el: SVGGraphicsElement, dx0 = 0, dy0 = 0, dx1 = 0, dy1 = 0): Q | null {
  const m = el.getScreenCTM();
  let b: DOMRect;
  try {
    b = el.getBBox();
  } catch {
    return null;
  }
  if (!m || b.width <= 0 || b.height <= 0) return null;
  const P = (x: number, y: number) => [r1(m.a * x + m.c * y + m.e), r1(m.b * x + m.d * y + m.f)];
  const x0 = b.x + dx0;
  const x1 = b.x + b.width - dx1;
  const y0 = b.y + dy0;
  const y1 = b.y + b.height - dy1;
  return [...P(x0, y0), ...P(x1, y0), ...P(x1, y1), ...P(x0, y1)] as Q;
}
const quadBox = (q: Q): R => [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];
const rectQuad = (r: R): Q => [r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]];

let measureCtx: CanvasRenderingContext2D | null = null;
/** Letters of an SVG line in the frame: horizontally — the line box (getBBox) without the glyph margins, vertically — from the baseline up
 *  and down by the height of the letters of this line (canvas measureText with the same font), → four corners via getScreenCTM. */
function inkQuad(el: SVGTextContentElement, str: string, cs: CSSStyleDeclaration, fs: number): Q | null {
  const m = el.getScreenCTM();
  const n = el.getNumberOfChars();
  if (!m || n < 1 || !str) return null;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return null;
  measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
  const mt = measureCtx.measureText(str);
  if (!(mt.actualBoundingBoxAscent > 0)) return null;
  let b: DOMRect;
  try {
    b = (el as unknown as SVGGraphicsElement).getBBox();
  } catch {
    return null;
  }
  const p0 = el.getStartPositionOfChar(0);
  const p1 = el.getEndPositionOfChar(n - 1);
  let base = (p0.y + p1.y) / 2;
  const db = cs.dominantBaseline;
  if (db === 'middle' || db === 'central') base += ((mt.actualBoundingBoxAscent - mt.actualBoundingBoxDescent) / 200) * fs; // point — the middle of the letters
  else if (db === 'hanging' || db === 'text-before-edge') base += (mt.actualBoundingBoxAscent / 100) * fs;
  const asc = (mt.actualBoundingBoxAscent / 100) * fs;
  const desc = (mt.actualBoundingBoxDescent / 100) * fs;
  const x0 = b.x + 0.04 * fs;
  const x1 = b.x + b.width - 0.04 * fs;
  const P = (x: number, y: number) => [r1(m.a * x + m.c * y + m.e), r1(m.b * x + m.d * y + m.f)];
  return [...P(x0, base - asc), ...P(x1, base - asc), ...P(x1, base + desc), ...P(x0, base + desc)] as Q;
}

/** A text of the frame (SVG <text> or kit HTML text). rect — the line box (with the font margin above and below); ink — the quadrilateral
 *  of the letters themselves in the frame (the line box shrunk by the font margins: Hangul ~0.30 em above and ~0.20 em below, digits and
 *  Latin — 0.40 / 0.27); px — the line height (em) across the baseline in the frame; rot — the baseline rotation, °; sq — squeeze (the
 *  smaller axis to the larger, 1 — no distortion). By glyph centres (n — in the frame, nc — total): hit — share landing on the text itself
 *  (a clip-path cut and a box cut miss), top — share where nothing opaque is above it, hud — covered by the title bar or a card; plate — the
 *  quadrilateral of what the text lies on (a sign, a strip, a sheet: what is most often under the letters), pa — its area to the text
 *  area; ok — data-cut-ok (an intended cut), id — data-read. */
function textOf(el: Element, svg: boolean, kit: Element | null) {
  const r = rectOf(el);
  if (r[2] <= 0 || r[0] >= W || r[3] <= 0 || r[1] >= H || r[2] - r[0] < 3 || r[3] - r[1] < 3) return null;
  const host = svg ? el : el.parentElement!;
  const cs = getComputedStyle(host);
  if (cs.visibility === 'hidden' || cs.display === 'none') return null;
  const a = alphaOf(host);
  if (a < 0.3) return null;
  const fs = parseFloat(cs.fontSize) || 16;
  const str = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const hangul = /[ㄱ-힣]/.test(str);
  let px = fs;
  let rot = 0;
  let sq = 1;
  let ink: Q | null = null;
  if (svg) {
    const m = (el as SVGGraphicsElement).getScreenCTM();
    if (m) {
      const sx = Math.hypot(m.a, m.b);
      const det = Math.abs(m.a * m.d - m.b * m.c);
      const s2 = (m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d) / 2;
      const disc = Math.sqrt(Math.max(0, s2 * s2 - det * det));
      const smax = Math.sqrt(s2 + disc);
      const smin = Math.sqrt(Math.max(0, s2 - disc));
      px = sx > 1e-6 ? (fs * det) / sx : 0;
      rot = (Math.atan2(m.b, m.a) * 180) / Math.PI;
      sq = smax > 1e-6 ? smin / smax : 1;
    }
    ink = inkQuad(el as SVGTextContentElement, str, cs, fs) ?? quadOf(el as SVGGraphicsElement, 0.04 * fs, (hangul ? 0.3 : 0.4) * fs, 0.04 * fs, (hangul ? 0.2 : 0.27) * fs);
  } else {
    const oh = (host as HTMLElement).offsetHeight;
    px = oh > 0 ? (fs * (r[3] - r[1])) / oh : fs;
    const k = px / fs;
    ink = rectQuad([r[0] + 0.04 * px, r[1] + (hangul ? 0.3 : 0.4) * px * (oh > 0 ? 1 : k), r[2] - 0.04 * px, r[3] - (hangul ? 0.2 : 0.27) * px]);
  }
  let ctmOk = true;
  if (svg && ink) {
    // a CSS 3D transform of an ancestor (a sheet in perspective — matrix3d) is not seen by getScreenCTM, but getBoundingClientRect
    // sees it: if the boxes disagree, the letters are taken by the line box in the frame (without rotation and squeeze), so such texts
    // stay in the journal
    const qf = quadOf(el as SVGGraphicsElement); // the whole line box by CTM (without shrinking by font margins) — compared with the box in the frame
    const qb = qf ? quadBox(qf) : quadBox(ink);
    const ov = Math.max(0, Math.min(qb[2], r[2]) - Math.max(qb[0], r[0])) * Math.max(0, Math.min(qb[3], r[3]) - Math.max(qb[1], r[1]));
    const ua = (qb[2] - qb[0]) * (qb[3] - qb[1]) + (r[2] - r[0]) * (r[3] - r[1]) - ov;
    if (ov < 0.75 * Math.max(1, ua)) { // the boxes do not match (IoU < 0.75)
      ctmOk = false;
      px = (r[3] - r[1]) / 1.45;
      rot = 0;
      sq = 1;
      ink = rectQuad([r[0] + 0.04 * px, r[1] + (hangul ? 0.3 : 0.4) * px, r[2] - 0.04 * px, r[3] - (hangul ? 0.2 : 0.27) * px]);
    }
  }
  if (px < 7 || !ink) return null; // a tiny text is not read and not checked (a cut by the title bar is visible from 8 px)
  const ib = quadBox(ink);
  // points — glyph centres (getExtentOfChar; spaces skipped), for HTML text — a grid over the letter box
  const pts: [number, number][] = [];
  const m0 = svg ? (el as SVGGraphicsElement).getScreenCTM() : null;
  if (svg && m0 && ctmOk) {
    const t = el as SVGTextContentElement;
    const nc = t.getNumberOfChars();
    const step = Math.max(1, Math.ceil(nc / 40));
    const chars = Array.from(el.textContent ?? '');
    for (let i = 0; i < nc; i += step) {
      if (chars[i] !== undefined && !chars[i].trim()) continue;
      let e0: DOMRect;
      try {
        e0 = t.getExtentOfChar(i);
      } catch {
        continue;
      }
      if (e0.width <= 0 && e0.height <= 0) continue;
      const cx = e0.x + e0.width / 2;
      const cy = e0.y + e0.height / 2;
      pts.push([m0.a * cx + m0.c * cy + m0.e, m0.b * cx + m0.d * cy + m0.f]);
    }
  } else {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
      const u = (i + 0.5) / 8;
      const v = (j + 0.5) / 2;
      pts.push([(1 - v) * ((1 - u) * ink[0] + u * ink[2]) + v * ((1 - u) * ink[6] + u * ink[4]), (1 - v) * ((1 - u) * ink[1] + u * ink[3]) + v * ((1 - u) * ink[7] + u * ink[5])]);
    }
  }
  let n = 0;
  let hit = 0;
  let top = 0;
  let hud = 0;
  const under = new Map<Element, number>();
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    n++;
    const st = document.elementsFromPoint(x, y);
    const k = st.findIndex((e) => e === host || host.contains(e));
    if (k < 0) continue;
    hit++;
    const above = st.slice(0, k).find(opaque);
    if (!above) top++;
    else if (!kit || !kit.contains(above)) hud++;
    const ue = st.slice(k + 1).find((e) => opaque(e) && e.tagName.toLowerCase() !== 'text' && e.tagName.toLowerCase() !== 'tspan' && !e.contains(host) && (!kit || kit.contains(e)));
    if (ue) under.set(ue, (under.get(ue) ?? 0) + 1);
  }
  const pl = [...under.entries()].sort((p, q) => q[1] - p[1])[0]?.[0];
  const pq = pl ? (pl instanceof SVGGraphicsElement ? quadOf(pl) : null) ?? rectQuad(rectOf(pl)) : null;
  const pb = pq ? quadBox(pq) : null;
  const ia = Math.max(1, (ib[2] - ib[0]) * (ib[3] - ib[1]));
  return {
    s: str.slice(0, 18), rect: r, ink, px: r1(px), rot: r1(rot), sq: +sq.toFixed(2),
    hit: n ? +(hit / n).toFixed(2) : 0, top: n ? +(top / n).toFixed(2) : 0, hud: n ? +(hud / n).toFixed(2) : 0, n, nc: pts.length,
    plate: pq, pa: pb ? +(((pb[2] - pb[0]) * (pb[3] - pb[1])) / ia).toFixed(1) : null,
    ok: el.closest('[data-cut-ok]')?.getAttribute('data-cut-ok') ?? null, id: el.closest('[data-read]')?.getAttribute('data-read') ?? null, ...(svg ? {} : {html: 1}), ...(ctmOk ? {} : {fb: 1}),
  };
}

/** All kit texts in the frame: SVG <text> and HTML text nodes of the kit layer (the title bar, cards, the place tag and the episode plate
 *  are outside the layer). */
function textsOf() {
  const kit = kitLayer();
  if (!kit) return [];
  const out: NonNullable<ReturnType<typeof textOf>>[] = [];
  kit.querySelectorAll('text').forEach((el) => {
    if ((el.textContent ?? '').trim()) {
      const t = textOf(el, true, kit);
      if (t) out.push(t);
    }
  });
  const tw = document.createTreeWalker(kit, NodeFilter.SHOW_TEXT);
  for (let nd = tw.nextNode(); nd; nd = tw.nextNode()) {
    const p = nd.parentElement;
    if (!p || p.closest('svg') || !(nd.textContent ?? '').trim()) continue;
    const t = textOf(p, false, kit);
    if (t) out.push(t);
  }
  return out;
}

/** Writes the frame journal to the console (only in the service composition). In a normal render it does nothing and draws nothing. */
export const StageJournal: React.FC<{frame: number; shot: string}> = ({frame, shot}) => {
  const on = React.useContext(StageLogCtx);
  React.useLayoutEffect(() => {
    if (!on) return;
    // Remotion assembles a frame in a hidden container (top: −999999) and moves it into the window after the children's
    // effects: measure later, when the frame is in the window (otherwise elementsFromPoint sees nothing), while the render
    // waits for the journal (delayRender)
    const handle = delayRender('frame journal');
    const measure = () => {
      const q = (s: string) => Array.from(document.querySelectorAll(`[data-stage="${s}"]`));
      const root = q('root')[0]?.getBoundingClientRect();
      if (root && root.width > 0 && root.height > 0) [W, H] = [root.width, root.height];
      const j = {
        frame, shot, root: root ? [Math.round(root.left), Math.round(root.top), Math.round(root.width), Math.round(root.height)] : null,
        bar: q('bar').map(rectOf),
        cards: q('card').filter((e) => alphaOf(e) > 0.3).map((e) => ({rect: rectOf(e), text: (e.textContent ?? '').slice(0, 24)})),
        heads: q('head').map((e) => ({who: e.getAttribute('data-who'), rect: rectOf(e)})),
        figs: q('fig').map((e) => ({who: e.getAttribute('data-who'), ...figVisible(e as SVGSVGElement), ...figAttrs(e as SVGSVGElement)})),
        lines: q('line').map((e) => rectOf(e)).filter((r) => r[2] > 0 && r[0] < W && r[3] > 0 && r[1] < H && r[3] - r[1] > 6),
        // a line mark is either the text itself (checked by the texts rules) or a non-text: a frame edge, a paper clip, a lamp shade
        lineText: q('line').filter((e) => {
          const r = rectOf(e);
          return r[2] > 0 && r[0] < W && r[3] > 0 && r[1] < H && r[3] - r[1] > 6;
        }).map((e) => (e.tagName.toLowerCase() === 'text' || e.querySelector('text') ? 1 : 0)),
        texts: textsOf(),
        hands: q('hand').map((e) => {
          const r = rectOf(e);
          return {act: e.getAttribute('data-act'), who: e.getAttribute('data-who'), rect: r, a: +alphaOf(e).toFixed(2), vis: visShare(e, r, 12, 12)};
        }).filter((h) => h.rect[2] > h.rect[0] && h.rect[3] > h.rect[1]),
        props: q('prop').map((e) => {
          const r = rectOf(e);
          const has = r[2] > r[0] && r[3] > r[1];
          return {id: e.getAttribute('data-prop'), state: e.getAttribute('data-state') ?? '', needs: e.getAttribute('data-needs') || null,
            ...(has ? {rect: r, a: +alphaOf(e).toFixed(2), vis: visShare(e, r, 12, 12)} : {})};
        }),
        reads: q('read').map((e) => {
          const r = rectOf(e);
          return {id: e.getAttribute('data-read'), rect: r, ...occlusion(e, r)};
        }),
        hits: q('hit').map((e) => ({who: e.getAttribute('data-who'), obj: e.getAttribute('data-obj')})),

      };
      // a long line in the browser log gets truncated: write it in chunks "STAGE <frame> <i>/<n> <chunk>"
      const txt = JSON.stringify(j);
      const N = Math.ceil(txt.length / 1500);
      for (let i = 0; i < N; i++) console.log(`STAGE ${frame} ${i + 1}/${N} ${txt.slice(i * 1500, (i + 1) * 1500)}`);
      continueRender(handle);
    };
    const timer = setTimeout(() => setTimeout(measure, 0), 0);
    return () => clearTimeout(timer);
  }, [on, frame, shot]);
  return null;
};

/** The kit sets the mark "a figure stands inside a prop" (a path through a prop): an invisible element for the frame journal. */
export const HitMark: React.FC<{who: string; obj: string}> = ({who, obj}) => <div data-stage="hit" data-who={who} data-obj={obj} style={{display: 'none'}} />;

/** The kit sets the mark of a place prop or a story prop of the shot for the frame journal (continuity at a cut, the cause of an action):
 *  id — "kind:name" (door:main, lamp:desk, sheet:1, card:loyalty, phone:MIRA…), state — a state as a word or a number (on / off / red, ear /
 *  chest, number of sheets…), needs — what the prop cannot be in the frame without: "fig:<who>" (a torch beam without its holder, a hand
 *  without a person). An invisible element; the rules are in tools/pipeline/stage_check.py (docs/STAGING.md, "Frame journal"). */
export const PropMark: React.FC<{id: string; state?: string | number | boolean; needs?: string}> = ({id, state, needs}) => (
  <div data-stage="prop" data-prop={id} data-state={state === undefined ? '' : String(state)} data-needs={needs ?? ''} style={{display: 'none'}} />
);

/** The same as PropMark, as attributes on the drawn prop itself (<g {...propMark('door:main', open)}>…leaf…</g>): the journal also
 *  knows its box and visibility — it looks for a hand at the leaf (door.* / window.* events) and catches the prop appearing and
 *  vanishing within one frame. */
export const propMark = (id: string, state?: string | number | boolean, needs?: string) => ({
  'data-stage': 'prop', 'data-prop': id, 'data-state': state === undefined ? '' : String(state), ...(needs ? {'data-needs': needs} : {}),
});

/** Attributes for a hand drawn by the kit (a pen circles, a finger runs along a line, a hand closes a window): the frame journal sees that
 *  an action with "hand": true has a hand in the frame. Set on the element of the hand itself: <g {...handMark('pen.mark')}>…</g>. */
export const handMark = (act: string, who?: string) => ({'data-stage': 'hand', 'data-act': act, ...(who ? {'data-who': who} : {})});
