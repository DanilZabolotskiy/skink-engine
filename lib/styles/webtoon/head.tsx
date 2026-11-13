// Head of the webtoon style: an egg-shaped face with a jaw and a chin, a neck, ears, eyes with an iris, a pupil and lids, thin brows, a
// nose stroke, a small mouth, hair as a mass with strands and a parting. A thin outline, flat fills, one step of shade on the skin (the
// neck under the jaw).
// Head units (lib/character/style.ts HeadIn): the crown at about −1006, drawn at full size; the core scales the head by HEAD_SCALE.
// Head turn −1..1 (1 — facing right on screen).
import React from 'react';
import type {Look} from '../../character/looks';
import type {HeadIn, HeadOut} from '../../character/style';
import {clamp, lerp, mixHex, n1, scaleHex, smooth} from '../../anim';
import {cr, skinOf, SW as BODY_SW} from './common';

/** Head units → body units: the webtoon head is small on an adult body. */
export const HEAD_SCALE = 0.72;

type Pt = [number, number];
const P2 = (p: Pt) => `${n1(p[0])} ${n1(p[1])}`;

/** Edge of strands: 'n' — a fork (higher), 't' — a tip (lower). Strands are convex, tips and forks are sharp; between two 'n'
 *  — a smooth line. */
type EP = [number, number, 'n' | 't'];
function strands(pts: EP[], move = true): string {
  let d = move ? `M ${P2([pts[0][0], pts[0][1]])}` : '';
  const q = (i: number): Pt => { const j = Math.max(0, Math.min(pts.length - 1, i)); return [pts[j][0], pts[j][1]]; };
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0, k0] = pts[i - 1];
    const [x1, y1, k1] = pts[i];
    if (k0 === 'n' && k1 === 'n') {
      const p0 = q(i - 2), p3 = q(i + 1);
      const c1: Pt = [x0 + (x1 - p0[0]) / 6, y0 + (y1 - p0[1]) / 6];
      const c2: Pt = [x1 - (p3[0] - x0) / 6, y1 - (p3[1] - y0) / 6];
      d += ` C ${P2(c1)} ${P2(c2)} ${n1(x1)} ${n1(y1)}`;
      continue;
    }
    const c: Pt = k1 === 't' ? [x0 + (x1 - x0) * 0.15, y0 + (y1 - y0) * 0.55] : [x1 + (x0 - x1) * 0.15, y1 + (y0 - y1) * 0.55];
    d += ` Q ${P2(c)} ${n1(x1)} ${n1(y1)}`;
  }
  return d;
}

/** Continue the path with an arc through points (first a segment to the first point). */
const thru = (pts: Pt[]) => `L ${P2(pts[0])} ${cr(pts, false, 1 / 6, false)}`;

/** Edge of half-round curls (a perm): arcs outwards between adjacent points. */
// minLen > 0: for a link shorter than minLen the curl is lower (in proportion to the length) — points squeezed by the view make no loops,
// and the points themselves are not dropped: thinning changed the curl numbering and the whole edge jumped within a frame ("small jump")
function scallops(pts: Pt[], bulge: number, move = true, vary = 0, minLen = 0): string {
  let d = move ? `M ${P2(pts[0])}` : '';
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    // normal to the left of the traversal direction
    const nx = (y1 - y0) / len, ny = -(x1 - x0) / len;
    const bg = bulge * (1 + vary * Math.sin(i * 2.3)) * (minLen > 0 ? Math.min(1, len / minLen) : 1);
    d += ` Q ${n1(mx + nx * bg)} ${n1(my + ny * bg)} ${n1(x1)} ${n1(y1)}`;
  }
  return d;
}

// ---------- head geometry (front, turn = 0) ----------
const SY = -878; // skull centre in y
const RX = 116; // skull half-width
const RY = 128; // skull half-height: crown -1006
const EY = -858; // eye line
const BY = -893; // brows
const NY = -812; // nose tip
const MY = -781; // mouth
const CY = -741; // chin
const JY = -790; // jaw angle
const EAR0 = -872;
const EAR1 = -814;
const NECK0 = -806;
const NECK1 = -690;
/** The head–neck joint (head units): the head tilts sideways around it (headTilt), the neck below does not tilt with the head. */
export const HEAD_PIVOT = -790;

/** Head turn from behind, rad: the back of the head in three quarters. From behind headTurn gives a larger angle than facing (there the
 *  face is drawn up to ~39°), otherwise a turn towards a target at the side is not visible. */
const backYaw = (t: number) => Math.min(1.35, 1.7 * Math.abs(t));
/** Front hairline by hairstyle: [y, u] top to bottom (u — share of the face half-width, 1 — the temple at the ear). From behind in three
 *  quarters the cheek opens along it: the hair on the turn side ends here, not along the outline of the back of the head. */
const HAIRLINE: Record<string, [number, number][]> = {
  // short haircuts have the sideburn in front of the ear (u ≈ 0.96) and the ear slightly behind the middle of the side:
  // skin shows between them
  cowlick: [[-960, 0], [-946, 0.16], [-938, 0.44], [-926, 0.7], [-904, 0.9], [-846, 0.96]],
  short: [[-940, 0], [-934, 0.42], [-924, 0.66], [-906, 0.88], [-846, 0.96]],
  shaggy: [[-924, 0], [-916, 0.53], [-906, 0.77], [-880, 0.93], [-826, 0.96]],
  side: [[-958, 0], [-948, 0.58], [-934, 0.8], [-902, 0.93], [-868, 0.96]],
  kid: [[-920, 0], [-912, 0.6], [-900, 0.85], [-852, 0.96]],
  bob: [[-960, 0.1], [-944, 0.16], [-920, 0.5], [-906, 0.84], [-880, 0.87], [-832, 0.9], [-772, 0.93]],
  perm: [[-940, 0], [-930, 0.45], [-918, 0.7], [-904, 0.9], [-872, 0.97], [-796, 0.97]],
  long: [[-966, 0.05], [-942, 0.45], [-884, 0.84], [-800, 0.96], [-716, 0.98]],
  bun: [[-964, 0.02], [-960, 0.4], [-922, 0.8], [-886, 0.98], [-848, 1]],
  ponytail: [[-964, 0.02], [-960, 0.4], [-922, 0.8], [-886, 0.98], [-848, 1]],
};
/** Angle of the hairline from the middle of the back of the head at height y (rad): π — hair covers everything, π/2 — the edge at the
 *  temple (below — behind the ear). */
function hairlineAng(hair: string, y: number): number {
  const tb = HAIRLINE[hair];
  if (!tb) return Math.PI / 2;
  if (y <= tb[0][0]) return Math.PI - Math.asin(clamp(tb[0][1])) * clamp(1 - (tb[0][0] - y) / 30);
  for (let i = 1; i < tb.length; i++) {
    if (y <= tb[i][0]) {
      const k = (y - tb[i - 1][0]) / (tb[i][0] - tb[i - 1][0]);
      return Math.PI - Math.asin(clamp(lerp(tb[i - 1][1], tb[i][1], k)));
    }
  }
  return Math.PI / 2;
}

type Build = {
  fem: boolean; kid: boolean; male: boolean; age: number;
  jx: number; cw: number; cy: number; jy: number; ang: number; cheek: number;
  eyeW: number; eyeH: number; tilt: number; round: number; mono: boolean; brow: number; arch: number; mouthW: number; lip: number; stubble: number;
  // wrinkles by age, 0..1: creases at the eyes, bags, nasolabial folds, forehead, deep ones (mouth, cheeks, neck)
  wr: {crease: number; bags: number; naso: number; fore: number; deep: number};
};

/** Face type: man — wider and more angular jaw, thicker straighter brows, narrower eyes; woman — softer chin, thin arched brows, lashes.
 *  Role adjustments — look.features (looks.ts). Wrinkles strictly by look.age: up to 0.3 — none; 0.4–0.5 — light creases at the eyes; 0.55 —
 *  a bit more; 0.75 — moderate; 0.9 — all. */
function buildOf(look: Look): Build {
  const k = look.features ?? {};
  const fem = look.build === 'woman';
  const kid = look.build === 'child';
  const male = !fem && !kid;
  const age = look.age ?? 0;
  const step = (x: number, a0: number, a1: number) => clamp((x - a0) / (a1 - a0));
  return {
    fem, kid, male, age,
    jx: (kid ? 100 : fem ? 87 : 99) + 4 * age + (k.jaw ?? 0),
    cw: (kid ? 38 : fem ? 19 : 31) + 5 * age + (k.jaw ?? 0) * 0.35,
    cy: (kid ? CY - 10 : CY) + (male ? 4 : 0) + (k.long ?? 0),
    jy: JY + (male ? 4 : 0) + (k.long ?? 0) * 0.5 + 4 * age,
    ang: k.ang ?? (male ? 0.45 : 0),
    cheek: k.cheek ?? 0,
    eyeW: k.eyeW ?? (fem ? 1.02 : 1),
    eyeH: k.eyeH ?? (male ? 0.8 : 1),
    tilt: k.tilt ?? (fem ? 1.5 : 0),
    round: k.round ?? 0,
    mono: k.mono ?? false,
    brow: (k.brow ?? 1) * (male ? 1.45 : fem ? 0.72 : 1),
    arch: (k.arch ?? 1) * (fem ? 1.7 : male ? 0.25 : 1),
    mouthW: male ? 1.12 : fem ? 0.86 : 0.9,
    lip: fem ? (k.lip ?? 0.5) : 0,
    stubble: k.stubble ?? 0,
    wr: {crease: step(age, 0.3, 0.6), bags: step(age, 0.5, 0.8), naso: step(age, 0.5, 0.9), fore: step(age, 0.68, 0.9), deep: step(age, 0.84, 0.92)},
  };
}

export function webtoonHead(p: HeadIn): HeadOut {
  const {o, uid, face: F, back, look} = p;
  const L = o.line;
  const skin = skinOf(o, look);
  const sw = BODY_SW / HEAD_SCALE; // the outline of the scaled head is as wide as the body outline
  const t = clamp(p.turn, -1, 1);
  const a = t * 0.68; // turn angle, rad
  const b = buildOf(look);
  const hair = look.hair;
  const hat = look.hat;
  // line widths: in head units, but not thinner than minPx on screen
  const lw = (base: number, minPx = 1.1) => Math.max(base, minPx / Math.max(p.ppu, 1e-3));
  const SW = lw(sw, 1.5); // head outline
  const IN = lw(2.4, 1); // thin lines inside the face
  const shade = mixHex(skin, '#A8604E', 0.3); // one step of skin shade
  const soft = mixHex(skin, L, 0.42); // wrinkles, creases
  const hc = o.hair;
  const hairDark = lum(hc) < 0.35;
  const hLine = hairDark ? mixHex(hc, '#C8CCDA', 0.4) : scaleHex(hc, 0.66); // strands inside the mass — more contrast, so they read on a small shot
  const browCol = hairDark ? mixHex(hc, L, 0.3) : scaleHex(hc, 0.6);

  // projection of a face point: u -1..1 across the width (front), rr — bulge (nose > 1)
  const pxu = (u: number, rr = 1) => RX * rr * Math.sin(Math.asin(clamp(u, -1, 1)) + a);
  const wfu = (u: number) => clamp(Math.cos(Math.asin(clamp(u, -1, 1)) + a) / Math.cos(Math.asin(clamp(u, -0.999, 0.999))), 0.25, 1.1);

  // ---------- head outline ----------
  const chinX = 0.85 * RX * Math.sin(a);
  const jawX = (s: number) => {
    const k = s * t;
    return s * (b.jx - 30 * Math.max(0, -k) + 3 * Math.max(0, k)) + t * 10;
  };
  const chinSide = (s: number): Pt => [s * b.cw + chinX, b.cy - 8];
  const sidePts = (s: number): Pt[] => {
    const k = s * t;
    const far = Math.max(0, k);
    const jx = jawX(s);
    const pts: Pt[] = [
      [s * (RX - 2 - 6 * far) + t * 5, EY - 6],
      [s * (RX - 4 + 3 * far + 4 * b.cheek) + t * 7, -838],
    ];
    if (b.cheek > 0.3) pts.push([s * (RX - 9 - 3 * b.cheek + 2 * far) + t * 8, -812]); // hollow under the cheekbone
    if (b.ang > 0.05) pts.push([jx + s * 2, b.jy - 16 * b.ang]);
    pts.push([jx, b.jy]);
    if (b.ang > 0.05) pts.push([jx - s * 16 * b.ang + chinX * 0.3, b.jy + 12 * b.ang]);
    pts.push(chinSide(s));
    return pts;
  };
  const skull: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const th = Math.PI * (1 + i / 8);
    skull.push([RX * Math.cos(th) + t * 3, SY + RY * Math.sin(th)]);
  }
  const R = sidePts(1);
  const Lf = sidePts(-1);
  const outline: Pt[] = [...skull, ...R, [chinX, b.cy], ...Lf.slice().reverse()];
  const headD = cr(outline);
  const jawPts: Pt[] = [[jawX(-1), b.jy], chinSide(-1), [chinX, b.cy], chinSide(1), [jawX(1), b.jy]];

  // ---------- neck ----------
  // in three quarters the back edge of the neck goes under the ear (the neck is not a "stick" under the head)
  const nk = t * 8;
  const nw = (b.fem ? 27 : b.kid ? 26 : 32) * (look.w && look.w > 1 ? 1 + (look.w - 1) * 0.6 : 1) * 1.22; // the neck is wider than the face would suggest: it carries the scaled head
  const farS = t >= 0 ? 1 : -1;
  const nearS = -farS;
  const m3 = back ? 0 : smooth(Math.abs(t) / 0.5);
  const nTopF: Pt = [nk + farS * nw, NECK0];
  const nBotF: Pt = [nk + farS * (nw - 2), NECK1];
  const nTopN: Pt = [nk + nearS * (nw + 22 * m3), NECK0];
  const nBotN: Pt = [nk + nearS * (nw - 2 + 6 * m3), NECK1];
  const neckD = `M ${P2(nTopF)} L ${P2(nBotF)} L ${P2(nBotN)} L ${P2(nTopN)} Z`;
  const shJaw = jawPts.slice().reverse().map(([x, y]) => [x, y + 26] as Pt);
  const jawShadow = `M ${P2(jawPts[0])} ${cr(jawPts, false, 1 / 6, false)} ${thru(shJaw)} Z`;
  // nod (looking down, over glasses): the head tilts to the chest — the face gets shorter and the crown goes down while the chin stays
  // (a chin rising on a nod would turn the neck under it into a wedge)
  const gd0 = clamp(p.gy);
  const nk2 = clamp(gd0 + 0.6 * clamp(F.over ?? 0), 0, 1.2);
  const kNod = 0.07 * nk2;
  const nod = (q: Pt): Pt => [q[0], b.cy + (q[1] - b.cy) * (1 - kNod)];
  // from the front the neck is a column from the collar to the head joint in body units: the bottom at the collar at the body middle,
  // the top under the head (head points through its transform); constant width; at any turn, tilt and nod the neck comes out of the
  // collar under the head
  const neckFront = (map: (q: Pt) => Pt, sc: number, baseY: number) => {
    const tF = map(nTopF);
    const tN = map(nTopN);
    const bF: Pt = [farS * (nw - 2) * sc, baseY];
    const bN: Pt = [nearS * (nw - 2 + 6 * m3) * sc, baseY];
    const d = `M ${P2(tF)} L ${P2(bF)} L ${P2(bN)} L ${P2(tN)} Z`;
    const jp = jawPts.map((q) => map(nod(q)));
    const sj = shJaw.map((q) => map(nod(q)));
    const shD = `M ${P2(jp[0])} ${cr(jp, false, 1 / 6, false)} ${thru(sj)} Z`;
    const cid = `kn${uid}`;
    return (
      <g>
        <defs><clipPath id={cid}><path d={d} /></clipPath></defs>
        <path d={d} fill={skin} />
        <path d={shD} fill={shade} clipPath={`url(#${cid})`} />
        {b.wr.deep > 0 && (
          <g clipPath={`url(#${cid})`}>
            {[-1, 1].map((s) => {
              const a0 = map([nk + s * 9, -748]), a1 = map([nk + s * 12, -728]), a2 = map([nk + s * 8, -708]);
              return <path key={s} d={`M ${P2(a0)} Q ${P2(a1)} ${P2(a2)}`} stroke={soft} strokeWidth={IN * sc} fill="none" strokeLinecap="round" />;
            })}
          </g>
        )}
        <path d={`M ${P2(tF)} L ${P2(bF)} M ${P2(tN)} L ${P2(bN)}`} stroke={L} strokeWidth={SW * sc} fill="none" />
      </g>
    );
  };
  const neck = (
    <g>
      <defs>
        <clipPath id={`kn${uid}`}><path d={neckD} /></clipPath>
      </defs>
      <path d={neckD} fill={skin} />
      {back
        ? <rect x={nk - 60} y={-790} width={120} height={36} fill={shade} clipPath={`url(#kn${uid})`} />
        : <path d={jawShadow} fill={shade} clipPath={`url(#kn${uid})`} />}
      {b.wr.deep > 0 && !back && [-1, 1].map((s) => (
        <path key={s} d={`M ${n1(nk + s * 9)} -748 Q ${n1(nk + s * 12)} -728 ${n1(nk + s * 8)} -708`} stroke={soft} strokeWidth={IN} fill="none" strokeLinecap="round" />
      ))}
      <path d={`M ${P2(nTopF)} L ${P2(nBotF)} M ${P2(nTopN)} L ${P2(nBotN)}`} stroke={L} strokeWidth={SW} fill="none" />
    </g>
  );

  // ---------- ears ----------
  // ear: kin — how far the inner edge of the ear goes onto the cheek (0 — the edge on the head outline). The near ear is drawn twice with
  // one shape: behind the head (the part beyond the outline) and over the skin clipped by the head silhouette (the part on the cheek) —
  // without transparency, so it does not vanish within a frame on a turn in either direction (production rule 3)
  const earAt = (s: number, wf: number, k: string, x0in?: number, kin = 1, xin?: number) => {
    const x0 = x0in ?? s * RX * Math.cos(a) + (back ? -t * 6 : t * 4);
    const ww = 22 * wf;
    const xi = xin ?? x0 - s * 3; // inner edge of the ear (from behind over the hair — from the hair edge to its place, as the head turns)
    const d = `M ${n1(xi)} ${EAR0} C ${n1(x0 + s * ww)} ${EAR0 - 10} ${n1(x0 + s * (ww + 6))} ${EAR1 - 10} ${n1(x0 + s * 4)} ${EAR1 + 2} Q ${n1(xi - s * 5 * kin)} ${(EAR0 + EAR1) / 2} ${n1(xi)} ${EAR0} Z`;
    return (
      <g key={k}>
        <path d={d} fill={skin} stroke={L} strokeWidth={SW * 0.85} strokeLinejoin="round" />
        {!back && <path d={`M ${n1(x0 + s * 7 * wf)} ${EAR0 + 12} Q ${n1(x0 + s * 17 * wf)} ${EAR0 + 18} ${n1(x0 + s * 11 * wf)} ${EAR1 - 14}`} stroke={L} strokeWidth={IN} fill="none" strokeLinecap="round" />}
      </g>
    );
  };
  const hideEars = !hat && ['bob', 'perm', 'long'].includes(hair);
  const kinN = smooth(Math.abs(t) / 0.3); // the near ear goes onto the cheek on a turn
  // the far ear does not vanish abruptly on a turn: it narrows and goes behind the head (production rule 3)
  const earsBehind = hideEars ? null : (
    <g>
      {[-1, 1].map((s) => {
        const far = back ? 0 : Math.max(0, s * t);
        const wf = far > 0 ? 1 - smooth(far / 0.4) : 1 + 0.35 * Math.max(0, -s * t);
        return wf < 0.02 ? null : earAt(s, wf, `eb${s}`, undefined, s === nearS ? kinN : 0);
      })}
    </g>
  );
  const earTop = hideEars || back || Math.abs(t) < 0.005 ? null : <g clipPath={`url(#kh${uid})`}>{earAt(nearS, 1 + 0.35 * Math.abs(t), 'et', undefined, kinN)}</g>;

  // ---------- facial features ----------
  const open = Math.max(0, F.eyeOpen * (1 - p.blink));
  const smile = clamp((F.mouthCurve - 0.2) / 0.5);
  const eu = 0.43;
  const eyes: React.ReactNode[] = [];
  const brows: React.ReactNode[] = [];
  const extras: React.ReactNode[] = [];
  const wrOp = (v: number) => (v > 0 ? 0.3 + 0.5 * v : 0); // wrinkle visibility by level
  // looking down and up is visible for every role: pupils to the lid, the upper lid lower when looking down, the head nods (features
  // lower on the face)
  const gd = clamp(p.gy);
  const gu = clamp(-p.gy);
  const ov = clamp(F.over ?? 0); // looks over the glasses: glasses lower on the nose, pupils above the frame, the head slightly down
  const fy = 8 * clamp(gd + 0.6 * ov, 0, 1.2) - 3 * gu;
  // the far eye and brow stay inside the face silhouette: the eye narrows from the outer corner and on a strong turn goes away completely
  const limE = (s: number) => RX - 2 - Math.max(0, s * t) - SW * 0.5 - 4;
  const limB = (s: number) => RX + s * t * 3 - SW * 0.5 - 3;
  for (const s of [-1, 1]) {
    const u = s * eu;
    const ex0 = pxu(u);
    const wf = wfu(u);
    const ey = EY;
    const aw0 = 25 * wf * b.eyeW;
    const icx = ex0 - s * aw0;
    const ocx = s * Math.min(s * (ex0 + s * aw0 * 0.98), limE(s));
    const aw = Math.max(0, (s * (ocx - icx)) / 1.98);
    const ex = icx + s * aw;
    const vk = clamp((aw - 2.5) / (aw0 * 0.55)); // a narrow eye is lower in height and goes to zero
    const IC: Pt = [icx, ey + 2 + b.tilt * 0.3];
    const OC: Pt = [ocx, ey - 1 - b.tilt];
    // brows: thicker and straighter for men, thin and arched for women
    {
      const by = BY + (b.male ? 3 : 0) - 3 * gu + 2 * gd;
      const bin: Pt = [ex0 - s * 19 * wf, by + 3 - F.browY * 14 - F.browTilt * 11];
      const bout: Pt = [s * Math.min(s * (ex0 + s * 30 * wf), limB(s)), by + 5 - F.browY * 12 + F.browTilt * 5 + (b.fem ? 3 : 0)];
      const pk: Pt = [lerp(bin[0], bout[0], b.fem ? 0.6 : 0.5), Math.min(bin[1], bout[1]) - 4.5 * b.arch + F.browTilt * 2];
      const ti = 4.2 * b.brow * Math.max(0.7, wf);
      const to = (b.male ? 2.6 : 1.3) * Math.max(0.7, wf);
      const d = `M ${n1(bin[0])} ${n1(bin[1] - ti / 2)} Q ${n1(pk[0])} ${n1(pk[1] - ti / 2)} ${n1(bout[0])} ${n1(bout[1] - to / 2)} L ${n1(bout[0])} ${n1(bout[1] + to / 2)} Q ${n1(pk[0])} ${n1(pk[1] + ti / 2)} ${n1(bin[0])} ${n1(bin[1] + ti / 2)} Z`;
      brows.push(<path key={`b${s}`} d={d} fill={browCol} stroke={browCol} strokeWidth={lw(0.8, 0.6)} strokeLinejoin="round" />);
    }
    if (vk < 0.04) continue;
    if (open < 0.16) {
      // closed eyes: an arc down (sleep, blink) or up (a smile of relief)
      const upc = smile > 0.4 && F.eyeOpen < 0.75;
      const d = upc
        ? `M ${P2(IC)} Q ${n1(ex)} ${n1(ey - 10)} ${P2(OC)}`
        : `M ${P2(IC)} Q ${n1(ex)} ${n1(ey + 8)} ${P2(OC)}`;
      eyes.push(
        <g key={`e${s}`}>
          <path d={d} stroke={L} strokeWidth={lw(4.6, 1.3)} fill="none" strokeLinecap="round" />
          {b.fem && !upc && <path d={`M ${n1(OC[0] - s * 2)} ${n1(OC[1] + 1)} l ${s * 6} 4 M ${n1(OC[0] - s * 8)} ${n1(OC[1] + 4)} l ${s * 3} 5`} stroke={L} strokeWidth={lw(2.4)} strokeLinecap="round" />}
        </g>,
      );
      continue;
    }
    // male eyes are narrower; in fear they open almost like everyone's
    const eh = lerp(b.eyeH, 1, F.eyeWhite * 0.6);
    const up = 15.5 * Math.min(open, 1.25) * eh * (1 - 0.5 * gd * (1 - 0.85 * ov) * (1 - clamp(F.wide ?? 0)) + 0.1 * gu + 0.08 * ov) * vk;
    const lo = (8.5 + 4.5 * F.eyeWhite - 4.5 * smile) * (b.male ? lerp(0.82, 1, F.eyeWhite) : 1) * (1 + 0.25 * b.round) * vk;
    const uk = (1 + 0.15 * b.round) * (b.mono ? 0.88 : 1);
    const upper = `M ${P2(IC)} C ${n1(ex - s * aw * (0.62 - 0.2 * b.round))} ${n1(ey - up * 1.04 * uk)} ${n1(ex + s * aw * (0.42 - 0.1 * b.round))} ${n1(ey - up * 1.12 * uk - b.tilt * 0.5)} ${P2(OC)}`;
    const lower = `C ${n1(ex + s * aw * 0.5)} ${n1(ey + lo)} ${n1(ex - s * aw * 0.55)} ${n1(ey + lo)} ${P2(IC)}`;
    const shape = `${upper} ${lower} Z`;
    const ir = lerp(12.6, 8.2, F.eyeWhite) * (0.9 + 0.1 * b.eyeW);
    const irx = ir * (0.72 + 0.28 * wf);
    // the pupil does not go into the corner of a narrow eye: the iris stays visible (no white without a pupil)
    const ixr = Math.max(0, aw - irx * 0.55);
    const ix = ex + clamp(p.gx * aw * 0.42, -ixr, ixr);
    // over the glasses the head nods to the target, the eyes are above the frame: looking down goes into the nod, the pupils do not
    // drop behind the frame
    const gyE = p.gy > 0 ? p.gy * (1 - 0.85 * ov) : p.gy;
    const iy = ey - lerp(3, 0, F.eyeWhite) * eh + gyE * (gyE > 0 ? 8.5 : 6) - 7 * ov;
    const pr = ir * (0.42 + 0.14 * F.pupil);
    const cid = `ke${uid}${s > 0 ? 'r' : 'l'}`;
    eyes.push(
      <g key={`e${s}`}>
        <defs><clipPath id={cid}><path d={shape} /></clipPath></defs>
        <path d={shape} fill="#FBFBF7" />
        <g clipPath={`url(#${cid})`}>
          {/* lid shadow on the white of the eye */}
          <path d={`${upper} L ${n1(OC[0])} ${n1(OC[1] + 5)} C ${n1(ex + s * aw * 0.42)} ${n1(ey - up * 1.12 + 6)} ${n1(ex - s * aw * 0.62)} ${n1(ey - up * 1.04 + 6)} ${n1(IC[0])} ${n1(IC[1] + 5)} Z`} fill="#DCDDE3" />
          <ellipse cx={ix} cy={iy} rx={irx} ry={ir} fill="#4B3529" />
          <ellipse cx={ix} cy={iy} rx={pr * (irx / ir)} ry={pr} fill="#130D0B" />
          <circle cx={ix + irx * 0.32} cy={iy - ir * 0.4} r={Math.max(2.2, ir * 0.27)} fill="#FFFFFF" />
          <circle cx={ix - irx * 0.36} cy={iy + ir * 0.38} r={Math.max(1.2, ir * 0.12)} fill="#FFFFFF" opacity={0.8} />
        </g>
        {/* upper lid — the thickest line of the face; women have lashes */}
        <path d={`${upper} ${b.fem ? `L ${n1(OC[0] + s * 7)} ${n1(OC[1] - 5)}` : `L ${n1(OC[0] + s * 3)} ${n1(OC[1] + 1)}`}`} stroke={L} strokeWidth={lw(b.mono ? 6.2 : b.male ? 5.4 : 5, 1.3)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {b.fem && (
          <path d={`M ${n1(ex + s * aw * 0.62)} ${n1(ey - up * 0.95)} l ${n1(s * 4)} -6 M ${n1(ex + s * aw * 0.82)} ${n1(ey - up * 0.7)} l ${n1(s * 5)} -5`} stroke={L} strokeWidth={lw(2.2, 0.8)} strokeLinecap="round" />
        )}
        {/* lower lid — a thin stroke at the outer corner */}
        <path d={`M ${n1(OC[0] - s * 1)} ${n1(OC[1] + 3)} C ${n1(ex + s * aw * 0.5)} ${n1(ey + lo)} ${n1(ex - s * aw * 0.1)} ${n1(ey + lo + 0.5)} ${n1(ex - s * aw * 0.35)} ${n1(ey + lo - 1)}`} stroke={L} strokeWidth={lw(2, 0.8)} fill="none" strokeLinecap="round" />
        {/* lid crease: for women and with age */}
        {(b.fem || b.wr.bags > 0) && !b.mono && (
          <path d={`M ${n1(ex - s * aw * 0.25)} ${n1(ey - up * 1.1 - 6)} Q ${n1(ex + s * aw * 0.5)} ${n1(ey - up * 1.15 - 7)} ${n1(OC[0] + s * 1)} ${n1(OC[1] - 6)}`} stroke={L} strokeWidth={lw(1.8, 0.7)} fill="none" strokeLinecap="round" opacity={0.85} />
        )}
      </g>,
    );
    // shadows under the eyes — fear and pallor
    if (F.pale > 0.35) {
      extras.push(<path key={`ds${s}`} d={`M ${n1(ex - s * aw * 0.8)} ${n1(ey + lo + 1)} Q ${n1(ex)} ${n1(ey + lo + 14)} ${n1(ex + s * aw * 1.0)} ${n1(ey + lo - 1)} Q ${n1(ex)} ${n1(ey + lo + 5)} ${n1(ex - s * aw * 0.8)} ${n1(ey + lo + 1)} Z`}
        fill={scaleHex(skin, 0.78)} opacity={clamp((F.pale - 0.35) * 2)} />);
    }
    // blush: a flat patch and strokes; almost none for men
    const bl = (b.fem || b.kid ? Math.max(F.blush, 0.35) : F.blush * 0.35) * (b.age > 0.6 ? 0.5 : 1);
    if (bl > 0.04) {
      const cx = ex + s * 4 * wf;
      const cy = ey + 26;
      extras.push(
        <g key={`bl${s}`}>
          <ellipse cx={cx} cy={cy} rx={20 * wf} ry={8} fill="#F08C8C" opacity={0.3 * bl} />
          {[-1, 0, 1].map((k) => (
            <path key={k} d={`M ${n1(cx + k * 8 * wf - 3)} ${n1(cy + 4)} l ${n1(6 * wf)} -8`} stroke="#D9646E" strokeWidth={lw(1.8, 0.7)} strokeLinecap="round" opacity={0.75 * bl} />
          ))}
        </g>,
      );
    }
    // age at the eyes: creases (crow's feet), bags
    const W = b.wr;
    if (W.crease > 0 || W.bags > 0) {
      extras.push(
        <g key={`ag${s}`} stroke={soft} strokeWidth={IN} fill="none" strokeLinecap="round">
          {W.crease > 0 && <path opacity={wrOp(W.crease) * 0.85} d={`M ${n1(OC[0] + s * 6)} ${n1(OC[1] + 3)} l ${n1(s * 9 * wf)} -2${W.crease > 0.6 ? ` M ${n1(OC[0] + s * 5)} ${n1(OC[1] + 9)} l ${n1(s * 9 * wf)} 3` : ''}`} />}
          {W.bags > 0 && <path opacity={wrOp(W.bags)} d={`M ${n1(ex - s * aw * 0.5)} ${n1(ey + lo + 7)} Q ${n1(ex + s * aw * 0.1)} ${n1(ey + lo + 12)} ${n1(ex + s * aw * 0.7)} ${n1(ey + lo + 5)}`} />}
          {W.deep > 0 && <path opacity={wrOp(W.deep)} d={`M ${n1(ex - s * aw * 0.4)} ${n1(ey + lo + 15)} Q ${n1(ex + s * aw * 0.1)} ${n1(ey + lo + 21)} ${n1(ex + s * aw * 0.6)} ${n1(ey + lo + 13)}`} />}
        </g>,
      );
    }
    // cheekbones: a short thin stroke under the cheekbone
    if (b.cheek > 0.5 && s * t <= 0.3) {
      extras.push(<path key={`ck${s}`} d={`M ${n1(pxu(s * 0.86))} -826 Q ${n1(pxu(s * 0.8))} -812 ${n1(pxu(s * 0.82))} -800`} stroke={soft} strokeWidth={IN} fill="none" strokeLinecap="round" opacity={0.6} />);
    }
  }

  // nose: a stroke of the bridge towards the far side and the corner of the nostril; larger for men
  const nx = pxu(0, 1.12);
  // the nose side changes smoothly over t ∈ [−0.05; 0] instead of jumping when passing through full face (production rule 3); at t = 0 and t
  // ≤ −0.05 — as before
  const sg = clamp(((t + 0.05) / 0.05) * 2 - 1, -1, 1);
  const ua = smooth(Math.abs(t) / 0.6);
  const nl = b.male ? 1.15 : b.fem ? 0.9 : 1;
  const nose = (
    <g stroke={L} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${n1(nx - sg * (2 + 3 * ua))} ${n1(NY - (26 + 8 * ua) * nl)} Q ${n1(nx + sg * (1 + 5 * ua))} ${NY - 10} ${n1(nx + sg * (3 + 4 * ua))} ${NY - 1} Q ${n1(nx - sg * 1)} ${NY + 4} ${n1(nx - sg * (7 + 2 * ua) * nl)} ${NY + 1}`} strokeWidth={lw(2.6, 1)} />
      {ua < 0.8 && <path d={`M ${n1(nx - sg * 13 * nl * (1 - 0.6 * ua))} ${NY - 2} q ${n1(sg * 3)} 3 ${n1(sg * 6)} 2`} strokeWidth={lw(2, 0.8)} opacity={1 - ua} />}
    </g>
  );

  // mouth: a line for men, open — dark inside with a tongue, no lip colour; for women — a light lip tone
  const mx = pxu(0, 0.98);
  const mwf = 1 - 0.28 * Math.abs(t);
  const bigO = clamp((F.mouthOpen - 0.7) / 0.3); // scream: the mouth wider and higher
  const mw = 16 * F.mouthWide * mwf * b.mouthW * (b.age > 0.6 ? 0.9 : 1) * (1 + 0.35 * bigO);
  const mc = F.mouthCurve * 6;
  const lipC = '#D98C88';
  // the mouth is one shape that changes smoothly (production rule 3): closed — a line (a smile, straight, a trembling wave — the wave size by
  // wobble), open grows out of the same line; parted lips — a narrow dark slit without teeth
  const oK = smooth(F.mouthOpen / 0.12); // 0 — lips closed, 1 — mouth open
  const big = bigO; // scream: the mouth wide, teeth visible
  const oh = 4 + F.mouthOpen * 24 + big * 16;
  const topCy = lerp(MY + mc * 0.7, MY - 3 - mc * 0.4 - big * 5, oK); // control point of the upper lip
  const botCy = lerp(topCy, MY + oh * 1.5 - mc, oK);
  const wob = F.wobble * (1 - oK);
  const topPts: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    const yq = (1 - u) * (1 - u) * (MY - mc) + 2 * u * (1 - u) * topCy + u * u * (MY - mc);
    const tri = i % 2 ? 0 : (i / 2) % 2 ? 1 : -1; // wave: crests every sixth of the mouth
    topPts.push([mx - mw + 2 * mw * u, yq + 2.2 * wob * tri]);
  }
  const topLine = `M ${topPts.map(P2).join(' L ')}`;
  const mouthD = `${topLine} Q ${n1(mx)} ${n1(botCy)} ${n1(mx - mw)} ${n1(MY - mc)} Z`;
  const cidM = `km${uid}`;
  const teethH = (5 + oh * 0.2) * clamp((oh - 10) / 6);
  const mouth = (
    <g>
      {b.lip > 0 && (1 - oK) > 0.01 && <path d={`M ${n1(mx - mw * 0.6)} ${n1(MY + 2 - mc * 0.3)} Q ${n1(mx)} ${n1(MY + 11)} ${n1(mx + mw * 0.6)} ${n1(MY + 2 - mc * 0.3)} Q ${n1(mx)} ${n1(MY + 4)} ${n1(mx - mw * 0.6)} ${n1(MY + 2 - mc * 0.3)} Z`} fill={lipC} opacity={0.7 * b.lip * (1 - oK)} />}
      {b.lip > 0 && oK > 0.01 && <ellipse cx={mx} cy={MY + oh * 0.75 - mc + 3} rx={mw * 0.8} ry={oh * 0.5 * oK + 3} fill={lipC} opacity={0.45 * b.lip * oK} />}
      {oK > 0.01 && (
        <>
          <defs><clipPath id={cidM}><path d={mouthD} /></clipPath></defs>
          <path d={mouthD} fill="#3A1D21" />
          <g clipPath={`url(#${cidM})`}>
            <ellipse cx={mx} cy={MY + oh * 1.05} rx={mw * 0.62} ry={oh * 0.4} fill="#9C4F57" />
            {teethH > 0.2 && <rect x={mx - mw} y={MY - 10 - big * 5} width={2 * mw} height={teethH} fill="#FBFBF5" />}
            {big > 0.3 && <rect x={mx - mw} y={MY + oh * 1.5 - mc - 8 - oh * 0.12} width={2 * mw} height={oh * 0.4} fill="#FBFBF5" opacity={big} />}
          </g>
        </>
      )}
      <path d={oK > 0.01 ? mouthD : topLine} fill="none" stroke={L} strokeWidth={lw(2.8, 1)} strokeLinecap="round" strokeLinejoin="round" />
      {!b.fem && (1 - oK) * (1 - F.wobble) > 0.02 && <path d={`M ${n1(mx - mw * 0.35)} ${MY + 10} Q ${n1(mx)} ${MY + 12} ${n1(mx + mw * 0.35)} ${MY + 10}`} stroke={L} fill="none" strokeLinecap="round" strokeWidth={lw(1.6, 0.6)} opacity={0.55 * (1 - oK) * (1 - F.wobble)} />}
    </g>
  );

  // age: nasolabial folds, wrinkles at the mouth, hollow cheeks, forehead — strictly by age
  const W = b.wr;
  const ageLines = !back && (W.naso > 0 || W.fore > 0) && (
    <g stroke={soft} strokeWidth={IN} fill="none" strokeLinecap="round">
      {[-1, 1].map((s) => {
        const wf = wfu(s * 0.2);
        return (
          <g key={s}>
            {W.naso > 0 && <path opacity={wrOp(W.naso)} d={`M ${n1(nx + s * 15 * wf)} ${NY - 4} Q ${n1(mx + s * (mw + 14) * wf)} ${MY - 14} ${n1(mx + s * (mw + 9) * wf)} ${n1(MY + 8 * Math.min(1, W.naso * 2))}`} />}
            {W.deep > 0 && <path opacity={wrOp(W.deep)} d={`M ${n1(mx + s * (mw + 3))} ${MY + 6} Q ${n1(mx + s * (mw + 6))} ${MY + 18} ${n1(mx + s * (mw + 3))} ${MY + 28}`} />}
            {W.deep > 0 && s * t <= 0.3 && <path opacity={wrOp(W.deep)} d={`M ${n1(pxu(s * 0.82))} -834 Q ${n1(pxu(s * 0.74))} -812 ${n1(pxu(s * 0.76))} -796`} />}
          </g>
        );
      })}
      {W.fore > 0 && <path opacity={wrOp(W.fore)} d={`M ${n1(pxu(-0.36))} -930 Q ${n1(pxu(0))} -936 ${n1(pxu(0.36))} -930${W.fore > 0.6 ? ` M ${n1(pxu(-0.28))} -916 Q ${n1(pxu(0))} -921 ${n1(pxu(0.28))} -916` : ''}`} />}
    </g>
  );

  // stubble: small dots on the chin, cheeks and above the lip (deterministic)
  const stubble = b.stubble > 0 && !back && (() => {
    const dots: React.ReactNode[] = [];
    const col = mixHex(skin, '#2E3440', 0.42);
    for (let i = 0; i < 70; i++) {
      const r1 = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const r2 = (Math.sin(i * 78.233) * 12543.1234) % 1;
      const u = Math.abs(r1) * 2 - 1;
      const v = Math.abs(r2);
      let x: number;
      let y: number;
      if (i < 14) { x = mx + u * (mw + 10); y = MY - 15 + v * 8; } else { x = mx + u * b.jx * 0.82; y = MY + 4 + v * (b.cy - MY - 6); }
      if (Math.abs(x - mx) < mw + 2 && Math.abs(y - MY) < 5) continue;
      dots.push(<circle key={i} cx={x + (x - mx) * -0.05 * t} cy={y} r={1.7} fill={col} />);
    }
    return <g clipPath={`url(#kh${uid})`} opacity={b.stubble}>{dots}</g>;
  })();

  // sweat: one drop per emotion (production rule 3). Its place is tied to the temple (left in the frame when facing, u = −0.8) on the skin,
  // under the strands; the drop grows from zero with the emotion, stays while the emotion stays and goes to zero with it. When the temple
  // turns to the silhouette edge, the drop shrinks and goes behind the cheek completely. Light wariness (sweat < 0.3) — no drop
  const SWU = -0.8;
  const swAng = Math.asin(SWU) + a; // angle of the temple with the drop from the face axis
  const sweatK = smooth((F.sweat - 0.3) / 0.4) * (1 - smooth((Math.abs(swAng) - 1.08) / 0.24));
  const sweat = sweatK > 0.01 && !back && (
    <g transform={`translate(${n1(RX * Math.sin(clamp(swAng, -Math.PI / 2, Math.PI / 2)))} -874) scale(${sweatK.toFixed(3)})`}>
      <path d="M 0 -18 Q 11 0 8 8 A 8.5 8.5 0 1 1 -8 8 Q -11 0 0 -18 Z" fill="#CFEFFF" stroke={L} strokeWidth={lw(2.4, 1)} />
    </g>
  );

  // ---------- hair ----------
  const sd = t >= 0 ? 1 : -1; // from behind: the side the face is turned to
  const th = back ? backYaw(t) : 0;
  const H = hairOf({hair, hat, t, a, b, pxu, back, c: hc, line: hLine, L, SW, IN, uid, skin, lw, ppu: p.ppu, longY: -430, th, sd});

  // ---------- hats and glasses ----------
  const hatNode = hat ? hatOf(look.hatColor ?? '#6A4E3A', t, back, L, SW, IN) : null;
  const glassesNode = !back && look.glasses ? glassesOf(look.glasses, t, pxu, wfu, L, lw, 32 * ov) : null;

  if (back) {
    // the skin of the head from behind — in the neck layer, before the neck and the torso: the neck, the collar and the shoulders are
    // closer to the camera than the chin and cover it on a turn (the jaw shows only beside the neck)
    const bh = backHead({t, th, sd, b, hair, hideEars, skin, L, SW, IN, lw, uid, earAt, skull, H, hatNode, look, browCol, hc, nw});
    // the head turns around the neck axis, and the skull centre is slightly in front of it: on a turn the head shifts towards the face
    // side (the neck stays)
    const swing = th > 1e-4 ? `translate(${n1(sd * 14 * Math.sin(th))} 0)` : undefined;
    return {behind: null, under: null, neck: <g><g transform={swing}>{bh.skin}</g>{neck}<g transform={swing}>{bh.skinTop}</g></g>, head: <g transform={swing}>{bh.head}</g>, chin: b.cy, back: {th, ...bh.feat}};
  }
  const head = (
    <g>
      <defs><clipPath id={`kh${uid}`}><path d={headD} /></clipPath></defs>
      {earsBehind}
      <path d={headD} fill={skin} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
      {stubble}
      {/* facial features — inside the head silhouette; a nod down (looking down, over glasses) — features lower on the face */}
      <g clipPath={`url(#kh${uid})`}>
        <g transform={fy ? `translate(0 ${n1(fy)})` : undefined}>
          {ageLines}
          {extras}
          {nose}
          {mouth}
          {eyes}
          {brows}
        </g>
      </g>
      {earTop}
      <g clipPath={`url(#kh${uid})`}>{sweat}</g>
      {H.front}
      {hatNode}
      {glassesNode && <g transform={fy ? `translate(0 ${n1(fy)})` : undefined}>{glassesNode}</g>}
    </g>
  );
  // nod: when looking down and over glasses the head tilts to the chest — the crown goes down, the face gets shorter, the chin stays (nod
  // higher); otherwise a small figure looks down with the pupils only, and the look does not read. Neck — front.draw, without the nod
  const nodT = nk2 > 0.005 ? `translate(0 ${n1(b.cy * kNod)}) scale(1 ${(1 - kNod).toFixed(4)})` : undefined;
  // bottom of the head for the visible neck: left side → chin → right side (with the nod)
  const jawLine: Pt[] = [...Lf, [chinX, b.cy] as Pt, ...R.slice().reverse()].map(nod);
  const front = {jaw: jawLine, top: [nTopF, nTopN] as [Pt, Pt], edges: [farS * (nw - 2), nearS * (nw - 2 + 6 * m3)] as [number, number], draw: neckFront};
  return nodT
    ? {behind: <g transform={nodT}>{H.behind}</g>, under: <g transform={nodT}>{H.under}</g>, neck: null, head: <g transform={nodT}>{head}</g>, front, chin: b.cy}
    : {behind: H.behind, under: H.under, neck: null, head, front, chin: b.cy};
}

type BackIn = {
  t: number; th: number; sd: number; b: Build; hair: string; hideEars: boolean; skin: string; L: string; SW: number; IN: number; lw: (v: number, m?: number) => number;
  uid: string; earAt: (s: number, wf: number, k: string, x0?: number, kin?: number, xin?: number) => React.ReactNode; skull: Pt[];
  H: {backView: React.ReactNode; backPatch?: React.ReactNode; edgeAt?: (y: number) => number}; hatNode: React.ReactNode; look: Look; browCol: string; hc: string;
  nw: number; // neck half-width, head units
};

/** Head from behind. headTurn turns the back of the head into three quarters: the face goes away from the camera by angle th, on the
 *  turn side the cheek, the cheekbone and the jaw open, the ear of that side moves towards the middle and lies over the hair, the far
 *  one goes behind the back of the head; what sticks out in front of the face (brow end, lashes and lid corner, nose tip, glasses frame)
 *  is drawn behind the head and shows only beyond the cheek outline; the glasses temple goes from the ear to the cheek. At th = 0 — the
 *  plain back of the head. */
function backHead(q: BackIn): {skin: React.ReactNode; skinTop: React.ReactNode; head: React.ReactNode; feat: {eye: number; ear: number}} {
  const {th, sd: s, b, L, SW, lw, uid, skin} = q;
  const kC = Math.cos(th), kS = Math.sin(th);
  const fK = smooth(th / 0.55); // how open the side of the face is
  const proj = (xl: number, zl: number) => s * (xl * kC + zl * kS); // head point: xl — towards the turn side, zl — forward, towards the face
  const sec = (w: number, d: number, zc: number) => s * (zc * kS + Math.sqrt(w * w * kC * kC + d * d * kS * kS)); // edge of the head section
  // outline of the face side top to bottom: cheek, under the cheekbone, jaw angle, chin side, chin; at th = 0 — the plain edge of the
  // back of the head
  const BA: Pt = [s * (RX - 4) + q.t * 3, -846];
  const BB: Pt = [s * 58 + q.t * 6, -770];
  const face: Pt[] = [
    [sec(RX - 3, RX + 4, 6), -846],
    [sec(106, 104, 14), -812],
    [sec(b.jx, 64, 18), b.jy],
    [sec(b.cw + 8, 34, 42), b.cy - 10],
    [sec(16, 16, 50), b.cy - 2],
    [proj(40, 30), b.cy - 4], // the bottom of the chin is rounded: the jaw line goes back from it to the ear
    [proj(70, 12), (b.cy + b.jy) / 2 + 2],
  ];
  const fr = [0, 0.3, 0.55, 0.75, 0.88, 0.95, 1];
  // the chin comes out from behind the neck later than the cheek: on a small and medium turn (the default back of the head, 0.42 rad) the
  // cheek shows down to the jaw angle, not a narrow "needle" of cheek down to the chin under the hair
  const fJ = fK * smooth((th - 0.65) / 0.45);
  const side: Pt[] = face.map((p, i): Pt => {
    const k = i <= 2 ? fK : fJ;
    return [lerp(lerp(BA[0], BB[0], fr[i]), p[0], k), lerp(lerp(BA[1], BB[1], fr[i]), p[1], k)];
  });
  const G: Pt = [lerp(BB[0], proj(b.jx, -12), fK), lerp(BB[1], b.jy + 2, fK)]; // jaw angle under the ear: the jaw line ends here
  // base of the back of the head at the neck; on a large turn its projection went past the neck to the far side — a "shelf" of
  // skin beside the neck
  const nS: Pt = [s * Math.max(s * lerp(BB[0], proj(58, -78), fK), -0.5 * q.nw), -770];
  // base of the back of the head on the far side — at the neck edge: on a turn the back of the head goes sideways, and the skin under the
  // hair stuck out as a "shelf" behind the neck
  const nF: Pt = [s * lerp(-58, -q.nw, fK) + (1 - fK) * (q.t * 6), lerp(-770, -806, fK)];
  const farSide: Pt = [-s * (RX - 4) + q.t * 3, -846];
  // fill — a closed outline; stroke — without the bottom (no outline from the jaw angle to the back of the head: the neck flows into the
  // skin behind the ear)
  const skullLR = q.skull; // left to right over the crown
  const ring: Pt[] = s > 0
    ? [...skullLR, ...side, G, nS, nF, farSide]
    : [...skullLR, farSide, nF, nS, G, ...side.slice().reverse()];
  const fillD = cr(ring);
  // stroke: the back of the head and the cheek down to the chin; the bottom of the jaw (from the chin to the angle under the ear)
  // is its own line that appears with the turn: on a small turn a narrow strip of cheek with two outlines read as a black
  // "moustache" under the hair
  const strokeD = s > 0
    ? cr([nF, farSide, ...skullLR, ...side.slice(0, 5)], false)
    : cr([...side.slice(0, 5).reverse(), ...skullLR, farSide, nF], false);
  const underD = cr([...side.slice(4), G], false);
  const underW = SW * smooth((th - 0.65) / 0.45); // together with the chin (fJ)
  const cid = `kb${uid}`;

  // what sticks out in front of the face is behind the head: it shows only beyond the cheek outline
  const fem = b.fem;
  const behind: React.ReactNode[] = [];
  // lost profile (on a turn from behind a skin oval without features reads as an "empty face"): the features stand at the cheek outline at
  // their height and grow from zero with the turn (fP) — lid with lashes, brow, nose tip beyond the outline, mouth corner, blush for women
  const fP = smooth((th - 0.3) / 0.6);
  const half: Pt[] = [...(s > 0 ? q.skull.slice(4) : q.skull.slice(0, 5).reverse()), ...side.slice(0, 5)];
  const silAt = (y: number): number => {
    for (let i = 1; i < half.length; i++) {
      const [x0, y0] = half[i - 1], [x1, y1] = half[i];
      if (y >= y0 && y <= y1) return s * lerp(x0, x1, y1 === y0 ? 0 : (y - y0) / (y1 - y0));
    }
    return s * half[half.length - 1][0];
  };
  const X = (y: number, d: number) => s * (silAt(y) + d); // d — out of the outline (+) or in (−)
  const feat: React.ReactNode[] = [];
  if (fK > 0.01) {
    if (fP > 0.01) {
      const ey = EY + 2;
      const lidW = lw(b.male ? 5.4 : 5, 1.3);
      // brow — an arc above the eye, its end at the cheek outline
      const by = BY + 6 + (b.male ? 3 : 0);
      feat.push(<path key="bt" d={`M ${n1(X(by, -(14 + 14 * fP)))} ${by + 4} Q ${n1(X(by, -10 * fP))} ${by - 5} ${n1(X(by, 2 * fP))} ${by - 1}`} stroke={q.browCol} strokeWidth={4.4 * b.brow * (0.5 + 0.5 * fP)} fill="none" strokeLinecap="round" />);
      // eye from the side — "<": the outer corner inside the cheek, the upper lid a thick arc to the outline, the lower one a thin line,
      // the pupil between them
      const V: Pt = [X(ey, -(12 + 12 * fP)), ey + 1];
      const up: Pt = [X(ey - 7, 1.5 * fP), ey - 7];
      const lo: Pt = [X(ey + 5, -1), ey + 5];
      const eyeD = `M ${P2(V)} Q ${n1(X(ey - 4, -9 * fP))} ${ey - 10} ${P2(up)} L ${P2(lo)} Q ${n1(X(ey + 4, -8 * fP))} ${ey + 6} ${P2(V)} Z`;
      feat.push(<path key="ew" d={eyeD} fill="#FFFFFF" />);
      feat.push(<g key="ei"><defs><clipPath id={`ke${uid}`}><path d={eyeD} /></clipPath></defs>
        <ellipse cx={X(ey, -4 - 3 * fP)} cy={ey - 1} rx={4 + 3 * fP} ry={7} fill="#2A1C16" clipPath={`url(#ke${uid})`} /></g>);
      feat.push(<path key="lid" d={`M ${P2(V)} Q ${n1(X(ey - 4, -9 * fP))} ${ey - 10} ${P2(up)}`} stroke={L} strokeWidth={lidW * (0.5 + 0.5 * fP)} fill="none" strokeLinecap="round" />);
      feat.push(<path key="lw" d={`M ${P2(V)} Q ${n1(X(ey + 4, -8 * fP))} ${ey + 6} ${P2(lo)}`} stroke={L} strokeWidth={lw(2.2, 0.8)} fill="none" strokeLinecap="round" />);
      if (fem) feat.push(<path key="lash" d={`M ${P2(up)} L ${n1(X(ey - 9, 7 * fP))} ${ey - 11} M ${n1(X(ey - 8, -3 * fP))} ${ey - 9} L ${n1(X(ey - 12, 2 * fP))} ${ey - 15}`} stroke={L} strokeWidth={lw(2.6, 0.9)} strokeLinecap="round" />);
      // nose tip — a bump beyond the cheek outline; the cheek line under it breaks (fill over the stroke, the stroke only outside)
      const fN = smooth((th - 0.6) / 0.5); // nose tip — only closer to profile
      const n0 = NY - 34, n2 = NY + 7;
      const nose = `M ${n1(X(n0, -4))} ${n0} Q ${n1(X(NY - 12, 4 * fN))} ${NY - 10} ${n1(X(NY - 1, 6 * fN))} ${NY} Q ${n1(X(NY + 4, 5 * fN))} ${NY + 5} ${n1(X(n2, -4))} ${n2}`;
      feat.push(<path key="nf" d={`${nose} Z`} fill={skin} />);
      feat.push(<path key="ns" d={nose} stroke={L} strokeWidth={SW} fill="none" strokeLinecap="round" strokeLinejoin="round" />);
      // mouth corner
      if (fP > 0.3) feat.push(<path key="mo" d={`M ${n1(X(MY, -12 * fP))} ${MY + 2} Q ${n1(X(MY, -5 * fP))} ${MY} ${n1(X(MY, -1))} ${MY - 1}`} stroke={b.lip > 0 ? mixHex(L, '#D98C88', 0.35) : L} strokeWidth={lw(2.6, 0.9)} fill="none" strokeLinecap="round" />);
      if (fem || b.kid) feat.push(<ellipse key="bl" cx={X(EY + 34, -26)} cy={EY + 34} rx={14 * fP} ry={6 * fP} fill="#F08C8C" opacity={0.28 * (b.age > 0.6 ? 0.5 : 1)} />);
    }
    const gl = q.look.glasses;
    if (gl) {
      const w = lw(3.4, 1.1);
      const cx = proj(50, 112);
      behind.push(gl === 'round'
        ? <ellipse key="lens" cx={cx} cy={EY - 1} rx={Math.max(3, 30 * kC + 3 * kS)} ry={29} fill="#FFFFFF" fillOpacity={0.14} stroke={L} strokeWidth={w} />
        : <rect key="lens" x={cx - Math.max(3, 36 * kC + 3 * kS)} y={EY - 24} width={2 * Math.max(3, 36 * kC + 3 * kS)} height={46} rx={8} fill="#FFFFFF" fillOpacity={0.14} stroke={L} strokeWidth={w} />);
    }
  }
  // ears: the far one — behind the head, going behind the back of the head; the near one — the same shape behind the head and over the hair
  // clipped by the head silhouette
  const ears: React.ReactNode[] = [];
  const earsTop: React.ReactNode[] = [];
  if (!q.hideEars) {
    ears.push(q.earAt(-s, 1, 'ebf', proj(-RX, -4), 0));
    const kin = smooth(th / 0.35);
    // the ear sits slightly behind the middle of the side of the head: skin shows between it and the sideburn; on a turn it gets narrower
    // (edge-on to the camera)
    const xn = proj(lerp(RX, RX - 6, fK), lerp(-4, -24, fK));
    const wn = lerp(1, 0.72, fK);
    ears.push(q.earAt(s, wn, 'ebn', xn, kin));
    // over the hair: the inner edge of the ear comes out from under the hair edge and reaches its place as the head turns — the ear grows
    // over the hair with its outline, without transparency and without a jump on a small turn
    const xe = q.H.edgeAt ? q.H.edgeAt(-846) : xn;
    const xin = lerp(s * Math.max(s * xe, s * (xn - s * 3)), xn - s * 3, kin);
    if (th > 0.005) earsTop.push(<g key="etn" clipPath={`url(#${cid})`}>{q.earAt(s, wn, 'etn', xn, kin, xin)}</g>);
  }
  // glasses temples: from the ear forward to the frame. Whole — behind the head (visible above the ears even at th = 0); over the head —
  // only the part of the near temple on the camera side (further on the temple goes behind the cheek)
  let arm: React.ReactNode = null;
  if (q.look.glasses) {
    const w = lw(3.4, 1.1);
    const armPts = (sg: number) => {
      const pts: [number, number, number][] = []; // screen x, y, depth (< 0 — towards the camera)
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        const xl = (1 - u) * (1 - u) * (RX + 4) + 2 * u * (1 - u) * (RX + 3) + u * u * 84;
        const zl = (1 - u) * (1 - u) * -4 + 2 * u * (1 - u) * 52 + u * u * 106;
        pts.push([proj(sg * xl, zl), EY - 16 + 8 * u, -sg * xl * kS + zl * kC]);
      }
      return pts;
    };
    const line = (pts: [number, number, number][]) => `M ${pts.map((p) => `${n1(p[0])} ${n1(p[1])}`).join(' L ')}`;
    behind.push(<path key="armF" d={line(armPts(-1))} stroke={L} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />);
    const near = armPts(1);
    behind.push(<path key="armN" d={line(near)} stroke={L} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />);
    const vis: [number, number, number][] = [near[0]];
    for (let i = 1; i < near.length && near[i - 1][2] < 0; i++) {
      if (near[i][2] < 0) vis.push(near[i]);
      else {
        const k = near[i - 1][2] / (near[i - 1][2] - near[i][2]);
        vis.push([lerp(near[i - 1][0], near[i][0], k), lerp(near[i - 1][1], near[i][1], k), 0]);
      }
    }
    if (vis.length > 1 && th > 0.005) arm = <g clipPath={`url(#${cid})`}><path d={line(vis)} stroke={L} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>;
  }
  // the neck is closer to the camera than the chin, but farther than the cheek and the jaw angle: the head is over the neck — all of it
  // except the wedge under the jaw line (from the jaw angle to the chin) on the turn side
  const CH = side[4];
  const jawClip = `M ${n1(-s * 500)} -1300 L ${n1(s * 500)} -1300 L ${n1(s * 500)} ${n1(CH[1])} L ${P2(CH)} L ${P2(G)} L ${n1(G[0])} 0 L ${n1(-s * 500)} 0 Z`;
  const jid = `kj${uid}`;
  return {
    skin: (
      <g>
        {behind}
        {ears}
        <path d={fillD} fill={skin} />
        <path d={strokeD} fill="none" stroke={L} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round" />
        {underW > 0.05 && <path d={underD} fill="none" stroke={L} strokeWidth={underW} strokeLinejoin="round" strokeLinecap="round" />}
      </g>
    ),
    skinTop: (
      <g>
        <defs><clipPath id={jid}><path d={jawClip} /></clipPath></defs>
        <g clipPath={`url(#${jid})`}>
          <path d={fillD} fill={skin} />
          <path d={strokeD} fill="none" stroke={L} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round" />
          {underW > 0.05 && <path d={underD} fill="none" stroke={L} strokeWidth={underW} strokeLinejoin="round" strokeLinecap="round" />}
        </g>
        {/* lost-profile features — over the cheek skin (redrawn here over the neck), under the hair */}
        {feat}
      </g>
    ),
    head: (
      <g>
        <defs><clipPath id={cid}><path d={fillD} /></clipPath></defs>
        {/* head box for the frame journal (data-stage="head"): the skin from behind is in the neck layer, but the cheek and the jaw on a
           turn are part of the head */}
        <path d={fillD} fill="none" stroke="none" />
        {q.H.backView}
        {/* ear — over the hair of the back of the head, but under the hair in front of the ear (on a small turn their edge covers the ear) */}
        {earsTop}
        {q.H.backPatch}
        {q.hair === 'bald' && <path d={strokeD} fill="none" stroke={L} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round" />}
        {arm}
        {q.hatNode}
      </g>
    ),
    feat: {eye: fK > 0.01 ? fP : 0, ear: q.hideEars ? 0 : 1},
  };
}

// ---------- hair ----------

type HairIn = {
  ppu: number; longY: number; hair: Look['hair']; hat?: Look['hat']; t: number; a: number; b: Build; pxu: (u: number, rr?: number) => number; back: boolean;
  c: string; line: string; L: string; SW: number; IN: number; uid: string; skin: string; lw: (v: number, m?: number) => number;
  th?: number; sd?: number; // from behind: head turn angle and side (backHead)
};

function lum(hex: string) {
  const p = parseInt(hex.slice(1), 16);
  return (0.2126 * ((p >> 16) & 255) + 0.7152 * ((p >> 8) & 255) + 0.0722 * (p & 255)) / 255;
}

/** Outer outline of the hair mass: an ellipse arc from the lower left over the crown to the lower right. */
function massArc(cx: number, cy: number, rx: number, ry: number, th0: number, th1: number, n = 12): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const th = th0 + ((th1 - th0) * i) / n;
    pts.push([cx + rx * Math.cos(th), cy + ry * Math.sin(th)]);
  }
  return pts;
}

function hairOf(h: HairIn): {under: React.ReactNode; front: React.ReactNode; backView: React.ReactNode; behind: React.ReactNode; backPatch?: React.ReactNode; edgeAt?: (y: number) => number} {
  const {hair, hat, t, back, c, line, L, SW} = h;
  const cx = -t * 6;
  const strandW = h.lw(2.4, 1.3);
  const spK = clamp(0.5 / Math.max(h.ppu, 1e-3), 1, 1.8); // on a small shot the spiky strands are longer, so the silhouette stays uneven
  const st = (d: string, k: string, w = strandW, col = line) => <path key={k} d={d} stroke={col} strokeWidth={w} fill="none" strokeLinecap="round" />;
  const fillOnly = (d: string, k: string) => <path key={k} d={d} fill={c} />;
  const edge = (d: string, k: string) => <path key={k} d={d} fill="none" stroke={L} strokeWidth={SW * 0.85} strokeLinecap="round" strokeLinejoin="round" />;
  // front hair edge: a point beyond the head silhouette (on the far side on a turn) stays on the silhouette instead of curling back onto
  // the face — a temple strand does not cut the far eye
  const X = (u: number) => RX * Math.sin(clamp(Math.asin(clamp(u, -1, 1)) + h.a, -Math.PI / 2, Math.PI / 2));
  // uneven silhouette: strands stick out of the mass [angle, length, tilt]; the fill covers the mass outline at their base
  const spikeNodes = (cx0: number, cy0: number, rx: number, ry: number, list: number[][]) => list.map(([th, len, tw], i) => {
    const bx = cx0 + rx * Math.cos(th), byy = cy0 + ry * Math.sin(th);
    const nx = Math.cos(th), ny = Math.sin(th);
    const ln = len * spK;
    const tx = bx + nx * ln + -ny * tw * ln, ty = byy + ny * ln + nx * tw * ln;
    const w = 16;
    const sideP = (k: number, o: number): Pt => [bx + k * -ny * w - nx * o, byy + k * nx * w - ny * o];
    const ctl = (k: number): Pt => [bx + k * -ny * w * (k < 0 ? 0.3 : 0.5) + nx * ln * (k < 0 ? 0.6 : 0.3), byy + k * nx * w * (k < 0 ? 0.3 : 0.5) + ny * ln * (k < 0 ? 0.6 : 0.3)];
    const a0 = sideP(-1, 1), a1 = sideP(1, 1);
    const fillD = `M ${P2(sideP(-1, 12))} L ${P2(a0)} Q ${P2(ctl(-1))} ${n1(tx)} ${n1(ty)} Q ${P2(ctl(1))} ${P2(a1)} L ${P2(sideP(1, 12))} Z`;
    const edgeD = `M ${P2(a0)} Q ${P2(ctl(-1))} ${n1(tx)} ${n1(ty)} Q ${P2(ctl(1))} ${P2(a1)}`;
    return (
      <g key={`sp${i}`}>
        <path d={fillD} fill={c} />
        <path d={edgeD} fill="none" stroke={L} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round" />
      </g>
    );
  });
  const SPIKES: Record<string, number[][]> = {
    cowlick: [[-2.75, 14, -0.35], [-2.35, 12, -0.15], [-0.62, 12, 0.3], [-0.3, 10, 0.4]],
    short: [[-2.75, 12, -0.35], [-2.35, 10, -0.15], [-0.62, 10, 0.3], [-0.3, 9, 0.4]],
    side: [],
    shaggy: [[-2.95, 18, -0.45], [-2.6, 16, -0.25], [-2.2, 14, -0.05], [-1.2, 12, 0.15], [-0.7, 16, 0.3], [-0.3, 18, 0.45]],
  };

  // ---------- view from behind ----------
  // head turn (h.th, side h.sd): everything drawn on the back of the head turns with it — a point of the back of the head at height y moves
  // along the circle of its section (W) and squeezes to the silhouette at the far edge; the silhouette of the back of the head is round and
  // does not change with the turn. On the turn side the hair reaches the hairline (HAIRLINE): between it and the cheek outline — skin
  // (backPatch — the hair in front of the ear)
  if (back) {
    const th = h.th ?? 0;
    const sd = h.sd ?? 1;
    const long = hair === 'long';
    const bob = hair === 'bob';
    const perm = hair === 'perm';
    const taper = !bob && !long && !perm && hair !== 'bald';
    const bottom = long ? -560 : bob ? -770 : perm ? -790 : hair === 'shaggy' ? -760 : -768;
    const wide = hair === 'bald' ? 4 : bob ? 26 : perm ? 22 : long ? 22 : hair === 'shaggy' ? 18 : 12;
    const rxM = RX + wide;
    const ryM = RY + (perm ? 22 : 20);
    // half-width of the hair mass at height y before the turn (= section radius): the mass narrows at the back of the head towards the neck
    const xLow = perm ? 64 : 58;
    const Rh = (y: number) => {
      const dy = (y - (SY - 6)) / ryM;
      if (y < SY - 6) return rxM * Math.sqrt(Math.max(0.0025, 1 - dy * dy));
      if (bob || long || y <= -846) return y <= -856 ? rxM : lerp(rxM, rxM - 2, (y + 856) / 10);
      return lerp(rxM - 2, xLow, Math.pow(clamp((y + 846) / (bottom + 846)), 2));
    };
    const W = (x: number, y: number) => {
      if (th < 1e-4) return x;
      const R = Math.max(Rh(y), Math.abs(x) + 0.5);
      const al = Math.asin(clamp((sd * x) / R, -1, 1));
      return sd * R * Math.sin(Math.max(al - th, -Math.PI / 2));
    };
    const w2 = (q: Pt): Pt => [W(q[0], q[1]), q[1]];
    const wE = (q: EP): EP => [W(q[0], q[1]), q[1], q[2]];
    const WQ = (p0: Pt, p1: Pt, p2: Pt) => `M ${P2(w2(p0))} Q ${P2(w2(p1))} ${P2(w2(p2))}`;
    // a strand at the far edge that went to the silhouette thins to zero: otherwise strands bunch up there into a "curtain" (no
    // jump — by thickness)
    const foldK = (...ps: Pt[]) => (th < 1e-4 ? 1 : smooth((Math.min(...ps.map(([x, y]) => Math.asin(clamp((sd * x) / Math.max(Rh(y), Math.abs(x) + 0.5), -1, 1)) - th)) + 1.4) / 0.3));
    const stW = (d: string, k: string, f: number) => (f < 0.04 ? null : st(d, k, strandW * f));
    const tx = 0;
    const cx0 = 0;
    // hair in front of the ear on the turn side: from the silhouette of the back of the head to the hairline
    const patch = (() => {
      const tb = HAIRLINE[hair];
      if (th < 0.01 || !tb) return null;
      const grow = smooth(th / 0.3); // patch width and the curl height of its edge — from zero with the turn (production rule 3, a small detail)
      const yTop = SY - 6 - ryM + 3;
      const yBot = tb[tb.length - 1][0];
      // edge of the back-of-head mass (before the turn) at height y — its image after the turn gives the inner edge of the patch
      const massX = Rh;
      const N = 18;
      const outer: Pt[] = [];
      const inner: Pt[] = [];
      for (let i = 0; i <= N; i++) {
        const y = lerp(yTop, yBot, i / N);
        const H = hairlineAng(hair, y);
        // in front of the ear the hair mass is wide at the sides (as when facing), at the back of the head narrower: the patch radius
        // follows the side; at the temple the hair is thin
        const Rp = y < SY - 6 ? Rh(y) : rxM;
        const R = Rp - wide * (1 - clamp((H - Math.PI / 2) / (Math.PI / 3)));
        const xm = sd * W(sd * massX(y), y); // edge of the back-of-head mass after the turn
        // the patch grows out of the mass edge with the turn: in the first frame of the turn it was wider than the mass — an outline jump
        const xr = xm + (Math.max(R * Math.sin(Math.min(H, Math.PI / 2 + th) - th), xm) - xm) * grow; // only widens the hair, does not cut the mass
        // with a margin: the corner of the mass outline at the temple does not peek out (more for a perm and a bob; short hair has the ear
        // next to it, do not cover it)
        const xi = Math.min(xr, xm - (perm || bob || long ? 32 : 8));
        outer.push([sd * xr, y]);
        inner.push([sd * xi, y]);
      }
      // the lower end merges into the mass edge behind the ear
      const yEnd = yBot + 12;
      const tip: Pt = [W(sd * Math.min(massX(yEnd), rxM - 4), yEnd), yEnd];
      // patch edge — like the mass edge: curls for a perm (at the bottom — down to the tip at the back of the head), smooth for the rest
      const bot: Pt[] = [];
      for (let i = 1; i <= 5; i++) bot.push([lerp(outer[N][0], tip[0], i / 5), lerp(outer[N][1], tip[1], i / 5)]);
      // curls — over points no closer than 8 units to each other (otherwise outline loops)
      const sc: Pt[] = [];
      for (const q of [...outer, ...bot]) if (!sc.length || Math.hypot(q[0] - sc[sc.length - 1][0], q[1] - sc[sc.length - 1][1]) > 0.5) sc.push(q);
      const edgeD = perm
        ? `M ${P2(sc[0])} ${scallops(sc, 9 * sd * grow, false, 0.45, 8)}`
        : `M ${P2(outer[0])} ${cr([...outer, tip], false, 1 / 6, false)}`;
      const d = `${edgeD} L ${P2(inner[N])} ${cr(inner.slice().reverse(), false, 1 / 6, false)} Z`;
      return (
        <g>
          <path d={d} fill={c} />
          <path d={edgeD} fill="none" stroke={L} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    })();
    if (hair === 'bald') {
      // grey hair covers the lower back of the head from ear to ear down to the neck; the top edge is uneven, slightly higher towards the
      // middle a horseshoe of grey: higher at the ears, lower towards the middle of the back of the head (the bald patch goes down), the
      // top edge — sparse strands
      const top: Pt[] = [];
      for (let i = 0; i <= 10; i++) {
        const u = 1 - (2 * i) / 10;
        top.push(w2([u * (RX + 4), -836 - 54 * u * u]));
      }
      const nape: Pt[] = [];
      for (let i = 0; i <= 6; i++) nape.push(w2([-56 + (112 * i) / 6, -768 + (i % 2 ? 6 : 0)]));
      const d = `M ${P2(top[0])} ${scallops(top, -6, false, 0.7)} Q ${P2(w2([-RX - 2, -812]))} ${P2(nape[0])} ${scallops(nape, -5, false)} Q ${P2(w2([RX + 2, -812]))} ${P2(top[0])} Z`;
      return {under: null, behind: null, front: null, backView: (
        <g>
          <path d={d} fill={c} />
          <path d={`M ${P2(top[0])} ${scallops(top, -6, false, 0.7)}`} fill="none" stroke={scaleHex(c, 0.72)} strokeWidth={h.lw(2.4, 1)} strokeLinecap="round" />
          {[-0.75, -0.4, 0, 0.4, 0.75].map((k) => {
            const x0 = k * 90, y0 = -830 - 54 * k * k;
            return st(WQ([x0, y0], [x0 + k * 6, y0 + 24], [x0 + k * 3, y0 + 40 + 30 * k * k]), `bl${k}`);
          })}
        </g>
      )};
    }
    const arc = massArc(cx0, SY - 6, rxM, ryM, Math.PI * 0.94, Math.PI * 2.06, perm ? 26 : 24).map(w2);
    const lft: Pt = [cx0 - rxM + (bob || long ? 0 : 8), bottom];
    const rgt: Pt = [cx0 + rxM - (bob || long ? 0 : 8), bottom];
    // bottom edge: strands; short hair — the back of the head narrows to the neck, tips of different length
    const nTips = long ? 9 : bob ? 8 : 7;
    const edgePts: EP[] = [];
    for (let i = 0; i <= nTips * 2; i++) {
      const u = i / (nTips * 2);
      const x = taper ? lerp(cx0 + 58, cx0 - 58, u) : perm ? lerp(cx0 + 64, cx0 - 64, u) : lerp(rgt[0], lft[0], u);
      const sag = long ? 0 : bob ? -6 * Math.sin(u * Math.PI) : taper ? 0 : -18 * Math.sin(u * Math.PI);
      const tipL = taper ? [10, 18, 12, 20, 14, 16, 10][Math.floor(i / 2) % 7] : 12;
      edgePts.push(wE([x, bottom + sag + (i % 2 ? tipL : 0), i % 2 ? 't' : 'n']));
    }
    const sideL: Pt = w2([cx0 - rxM + 2, -846]);
    const sideR: Pt = w2([cx0 + rxM - 2, -846]);
    // curls — over points no closer than 8 units: after the turn points at the edge come together, and a short curl arc
    // made an outline knot
    const massD = perm
      ? `M ${P2(sideL)} ${scallops([sideL, ...arc, sideR], 9, false, 0.45, 8 * smooth(th / 0.05))} Q ${P2(w2([cx0 + RX + 4, bottom - 18]))} ${P2(w2([cx0 + 64, bottom]))} ${scallops(edgePts.map(([x]) => [x, bottom] as Pt), 5, false, 0.4)} Q ${P2(w2([cx0 - RX - 4, bottom - 18]))} ${P2(sideL)} Z`
      : taper
        ? `M ${P2(sideL)} L ${P2(arc[0])} ${cr(arc, false, 1 / 6, false)} L ${P2(sideR)} Q ${P2(w2([cx0 + RX - 2, bottom - 20]))} ${P2(w2([cx0 + 58, bottom]))} ${strands(edgePts, false)} Q ${P2(w2([cx0 - RX + 2, bottom - 20]))} ${P2(sideL)} Z`
        : `M ${P2(w2(lft))} L ${P2(arc[0])} ${cr(arc, false, 1 / 6, false)} L ${P2(w2(rgt))} ${strands(edgePts, false)} Z`;
    const lines: React.ReactNode[] = [];
    if (perm) {
      for (let i = 0; i < 14; i++) {
        const x = cx0 + Math.sin(i * 2.4) * (RX - 20);
        const y = -960 + ((i * 37) % 150);
        lines.push(stW(WQ([x - 7, y], [x, y - 9], [x + 6, y + 1]), `pc${i}`, foldK([x - 7, y], [x + 6, y + 1])));
      }
    } else if (taper) {
      // crown: strands spread from a cowlick slightly above the middle and go to the back of the head
      const wx = tx + 10;
      const wy = -968;
      [-1.0, -0.55, -0.1, 0.35, 0.8].forEach((k, i) => {
        const q0: Pt = [wx + k * 34, wy + 14 + Math.abs(k) * 16], q1: Pt = [wx + k * 64, wy + 70], q2: Pt = [cx0 + k * 56, bottom - 10];
        lines.push(stW(WQ(q0, q1, q2), `bs${i}`, foldK(q0, q1, q2)));
      });
      lines.push(st(WQ([wx - 12, wy], [wx, wy - 14], [wx + 12, wy]), 'bw'));
    } else {
      [-0.7, -0.35, 0, 0.35, 0.7].forEach((k, i) => {
        const q0: Pt = [tx + k * 30, SY - RY + 10], q1: Pt = [tx + k * 110, SY - 20], q2: Pt = [tx + k * (rxM - 14), bottom - 14];
        lines.push(stW(WQ(q0, q1, q2), `bs${i}`, foldK(q0, q1, q2)));
      });
    }
    // spiky silhouette strands: on the far side they stay on the silhouette, on the turn side they go with the turn (there the
    // silhouette is the hairline)
    const spikesB = taper && !hat ? spikeNodes(cx0, SY - 6, rxM, ryM, (SPIKES[hair] ?? []).map(([a0, len, tw]) => [a0, len * 0.9 * (Math.cos(a0) * sd > 0 ? 1 - smooth(th / 0.5) : 1), tw]).filter(([, len]) => len > 0.5)) : null;
    const bunX = W(tx, -940);
    return {under: null, behind: null, front: null, backPatch: patch, edgeAt: (y: number) => W(sd * Rh(y), y), backView: (
      <g>
        {hair === 'ponytail' && <path d={`M ${P2(w2([tx - 20, -930]))} Q ${P2(w2([tx - 34, -800]))} ${P2(w2([tx, -700]))} Q ${P2(w2([tx + 34, -800]))} ${P2(w2([tx + 20, -930]))} Z`} fill={c} stroke={L} strokeWidth={SW} />}
        <path d={massD} fill={c} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
        {spikesB}
        {lines}
        {hair === 'bun' && (
          <g>
            <ellipse cx={bunX} cy={-940} rx={44} ry={36} fill={c} stroke={L} strokeWidth={SW} />
            {st(`M ${n1(bunX - 28)} -948 Q ${n1(bunX)} -968 ${n1(bunX + 28)} -944 M ${n1(bunX - 24)} -928 Q ${n1(bunX + 2)} -942 ${n1(bunX + 30)} -924`, 'bn')}
          </g>
        )}
      </g>
    )};
  }

  // ---------- front and three quarters ----------
  const sbY = -846; // temple tip (sideburn)
  const sb = (s: number, y = sbY): EP => [X(s * 1) + s * 2, y, 't'];

  if (hair === 'bald') {
    // grey temples at the ears and sparse strands on the crown
    const tuft = (s: number) => {
      const x0 = s * RX * Math.cos(h.a) + t * 4;
      const d = `M ${n1(x0 - s * 6)} -936 Q ${n1(x0 + s * 16)} -930 ${n1(x0 + s * 16)} -902 Q ${n1(x0 + s * 18)} -884 ${n1(x0 + s * 10)} -868 L ${n1(x0 + s * 2)} -878 L ${n1(x0 - s * 4)} -870 Q ${n1(x0 - s * 9)} -900 ${n1(x0 - s * 6)} -936 Z`;
      return <path key={`tf${s}`} d={d} fill={c} stroke={L} strokeWidth={SW * 0.8} strokeLinejoin="round" />;
    };
    return {under: null, behind: null, backView: null, front: (
      <g>
        {[-1, 1].map((s) => (s * t > 0.45 ? null : tuft(s)))}
        {st(`M ${n1(X(-0.28))} -964 Q ${n1(X(0))} -978 ${n1(X(0.28))} -962`, 'cv1', h.lw(1.8, 0.7), scaleHex(c, 0.75))}
        {st(`M ${n1(X(-0.22))} -952 Q ${n1(X(0.04))} -964 ${n1(X(0.26))} -950`, 'cv2', h.lw(1.6, 0.7), scaleHex(c, 0.75))}
      </g>
    )};
  }

  // mass parameters by hairstyle
  let massW = 15, massH = 22, bottomY = -850;
  if (hair === 'bob') { massW = 28; massH = 24; bottomY = -772; }
  if (hair === 'perm') { massW = 22; massH = 24; bottomY = -806; }
  if (hair === 'long') { massW = 22; massH = 20; bottomY = -794; }
  if (hair === 'bun' || hair === 'ponytail') { massW = 9; massH = 12; bottomY = -852; }
  if (hair === 'kid') { massW = 16; massH = 22; bottomY = -846; }
  if (hair === 'shaggy') { massW = 20; massH = 28; bottomY = -832; }
  if (hair === 'side') { massW = 9; massH = 17; bottomY = -862; }
  const mcy = SY - 6;
  const rxM = RX + massW;
  const ryM = RY + massH;
  const thB = Math.asin(clamp((Math.min(bottomY, mcy + ryM * 0.6) - mcy) / ryM, -1, 1));
  const arc = massArc(cx, mcy, rxM, ryM, Math.PI - thB, 2 * Math.PI + thB, 14);
  const flat = hair === 'bob' || hair === 'long';
  // in three quarters short hairstyles have the back of the head behind the ear go down to the neck
  const nape = flat || hair === 'perm' ? 0 : smooth(Math.abs(t) / 0.5);
  const lowY = (s: number) => (s * t < 0 ? lerp(bottomY, -824, nape) : bottomY);
  const lowL: Pt = [cx - rxM + (flat ? 2 : 6) + (t > 0 ? 10 * nape : 0), lowY(-1)];
  const lowR: Pt = [cx + rxM - (flat ? 2 : 6) - (t < 0 ? 10 * nape : 0), lowY(1)];
  const fullArc: Pt[] = [lowL, ...arc.filter(([, y]) => y < bottomY - 4), lowR];
  const inset = massArc(cx, mcy, rxM - 3, ryM - 3, Math.PI - thB, 2 * Math.PI + thB, 14).filter(([, y]) => y < bottomY - 4);
  const insetFill = (from: Pt, to: Pt) => `L ${P2(from)} ${thru(inset)} L ${P2(to)} Z`;
  const fL: Pt = [cx - rxM + (flat ? 2 : 6), bottomY];
  const fR: Pt = [cx + rxM - (flat ? 2 : 6), bottomY];
  const arcF = arc.filter(([, y]) => y < bottomY - 4);

  let under: React.ReactNode = null;
  let behind: React.ReactNode = null;
  const front: React.ReactNode[] = [];

  if (hair === 'perm') {
    // perm: a mass of curls, the fringe and the strands at the cheeks are curls, little rings inside
    const thP = Math.asin(clamp((-806 - mcy) / ryM, -1, 1));
    const ring = massArc(cx, mcy, rxM, ryM, Math.PI - thP, 2 * Math.PI + thP, 22);
    under = <path d={`M ${P2(ring[0])} ${scallops(ring, 8, false, 0.45)} L ${n1(cx)} -790 Z`} fill={c} stroke={L} strokeWidth={SW} strokeLinejoin="round" />;
    const fr: Pt[] = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const u = 0.9 - (1.8 * i) / n;
      fr.push([X(u), -940 + 44 * u * u - (i % 3 === 0 ? 5 : i % 3 === 1 ? 0 : 2)]);
    }
    const sideR: Pt[] = [[ring[ring.length - 1][0] - 4, -808], [X(0.97) + 2, -836], [X(0.97), -872]];
    const sideL: Pt[] = [[X(-0.97), -872], [X(-0.97) - 2, -836], [ring[0][0] + 4, -808]];
    const edgePts = [...sideR, ...fr, ...sideL];
    const edgeD = `M ${P2(edgePts[0])} ${scallops(edgePts, 6, false)}`;
    const ins = massArc(cx, mcy, rxM - 3, ryM - 3, Math.PI - thP, 2 * Math.PI + thP, 22);
    front.push(fillOnly(`${edgeD} L ${P2(ins[0])} ${cr(ins, false, 1 / 6, false)} Z`, 'pf'), edge(`M ${P2(edgePts[1])} ${scallops(edgePts.slice(1, -1), 6, false)}`, 'pe'));
    for (let i = 0; i < 14; i++) {
      const u = -0.82 + (1.64 * ((i * 5) % 14)) / 13;
      const y = -1010 + ((i * 37) % 70) + 18 * u * u;
      const r = 6 + (i % 3) * 2;
      const sgn = i % 2 ? 1 : -1;
      front.push(st(`M ${n1(X(u) - r)} ${n1(y)} a ${r} ${r} 0 1 ${sgn > 0 ? 1 : 0} ${n1(2 * r)} 0 a ${r * 0.55} ${r * 0.55} 0 0 ${sgn > 0 ? 1 : 0} ${n1(-r * 0.9)} ${n1(r * 0.4)}`, `pc${i}`));
    }
  } else if (hair === 'bob') {
    // bob to the jaw: a bell — a smooth top, the sides go down and spread to the bottom; parting on the left, a slanted fringe in a smooth
    // wave to the right
    const by = bottomY;
    const side = (s: number): Pt[] => [[cx + s * (RX + 18), -890], [cx + s * (RX + 22), -832], [cx + s * (RX + 28), by]];
    const topArc = massArc(cx, mcy, RX + 18, RY + 22, Math.PI + 0.22, 2 * Math.PI - 0.22, 12);
    const outerP: Pt[] = [...side(-1).reverse(), ...topArc, ...side(1)];
    const k3 = (p: Pt): Pt => [cx + (p[0] - cx) * 0.975, mcy + (p[1] - mcy) * 0.98];
    const innerP = outerP.map(k3);
    const tips: EP[] = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const x = lerp(cx + RX + 28, cx - RX - 28, u);
      const inward = Math.abs(u - 0.5) * 2;
      tips.push([x, by + (i % 2 ? 9 : 0) - 4 * (1 - inward), i % 2 ? 't' : 'n']);
    }
    under = <path d={`M ${P2(outerP[0])} ${cr(outerP, false, 1 / 6, false)} ${strands(tips, false)} Z`} fill={c} stroke={L} strokeWidth={SW} strokeLinejoin="round" />;
    const part = -0.38;
    const edgeP: EP[] = [
      [cx + RX + 22, by, 'n'],
      [X(0.93) + 6, by + 2, 't'],
      [X(0.9) + 3, -832, 'n'],
      [X(0.87), -880, 'n'],
      [X(0.84), -906, 'n'],
      [X(0.72), -894, 't'],
      [X(0.5), -920, 'n'],
      [X(0.16), -944, 'n'],
      [X(-0.14), -961, 'n'],
      [X(part), -968, 'n'],
      [X(-0.62), -946, 'n'],
      [X(-0.84), -900, 'n'],
      [X(-0.9) - 3, -840, 'n'],
      [X(-0.93) - 6, by + 2, 't'],
      [cx - RX - 22, by, 'n'],
    ];
    const fillD = `${strands(edgeP)} L ${P2(innerP[0])} ${cr(innerP, false, 1 / 6, false)} Z`;
    front.push(fillOnly(fillD, 'bf'), edge(strands(edgeP.slice(1, -1)), 'be'));
    front.push(st(`M ${n1(X(part * 0.4))} -1004 Q ${n1(X(part - 0.02))} -990 ${n1(X(part))} -968`, 'pl', strandW * 1.1));
    // fringe strands along the wave from the parting to the right temple
    [0, 1, 2].forEach((k) => front.push(st(`M ${n1(X(part + 0.06 + k * 0.03))} ${-990 + k * 6} C ${n1(X(0.0 + k * 0.1))} ${-990 + k * 8} ${n1(X(0.5 + k * 0.08))} ${-960 + k * 6} ${n1(X(0.7 + k * 0.06))} ${-918 + k * 6}`, `bs${k}`)));
    // strands at the sides, down to the bottom of the bob
    [-1, 1].forEach((s) => [0, 1].forEach((k) => front.push(st(`M ${n1(cx + s * (RX + 4 + 8 * k))} ${-930 + 30 * k} Q ${n1(cx + s * (RX + 14 + 6 * k))} -850 ${n1(cx + s * (RX + 16 + 6 * k))} ${by - 4}`, `bsl${s}${k}`))));
  } else if (hair === 'long') {
    // long: parting in the middle, strands at the sides of the face down to the shoulders, the mass behind the back
    behind = <path d={`M ${n1(cx - rxM)} -880 L ${n1(cx - rxM - 10)} ${h.longY} Q ${n1(cx)} ${h.longY + 30} ${n1(cx + rxM + 10)} ${h.longY} L ${n1(cx + rxM)} -880 Z`} fill={c} stroke={L} strokeWidth={SW} strokeLinejoin="round" />;
    under = <path d={`M ${P2(fullArc[0])} ${cr(fullArc, false, 1 / 6, false)} Z`} fill={c} stroke={L} strokeWidth={SW} />;
    const pu = 0.05;
    for (const s of [-1, 1]) {
      const inner: Pt[] = [[X(pu), -966], [X(s * 0.45), -942], [X(s * 0.84), -884], [X(s * 0.96) + s * 2, -800], [X(s * 0.98) + s * 10, -716]];
      const ox = cx + s * (rxM + 8);
      const tipsB: EP[] = [[inner[4][0], inner[4][1], 'n'], [lerp(inner[4][0], ox, 0.3), -648, 't'], [lerp(inner[4][0], ox, 0.6), -670, 'n'], [ox - s * 2, -640, 't'], [ox, -664, 'n']];
      const outer: Pt[] = [[ox, -664], [cx + s * (rxM + 2), -800], [cx + s * (rxM - 3), -900], [cx + s * 60, -1000], [X(pu), -1004]];
      const d = `M ${P2(inner[0])} ${cr(inner, false, 1 / 6, false)} ${strands(tipsB, false)} ${thru(outer)} Z`;
      front.push(<path key={`lgf${s}`} d={d} fill={c} />);
      front.push(edge(`M ${P2(inner[1])} ${cr(inner.slice(1), false, 1 / 6, false)} ${strands(tipsB, false)} ${thru(outer.slice(0, 2))}`, `lge${s}`));
      front.push(st(`M ${n1(X(s * 0.3))} -950 Q ${n1(X(s * 0.9) + s * 12)} -860 ${n1(X(s * 0.98) + s * 20)} -690`, `ls${s}`));
    }
    front.push(st(`M ${n1(X(pu))} -966 L ${n1(X(pu * 0.5))} -1004`, 'lp', strandW * 1.1));
  } else if (hair === 'bun' || hair === 'ponytail') {
    // hair smoothly back: parting in the middle, "curtains" to the temples, a bun or a ponytail at the back
    const extra = hair === 'bun'
      ? <ellipse cx={cx * 2} cy={-1030} rx={40} ry={34} fill={c} stroke={L} strokeWidth={SW} />
      : <path d={`M ${n1(cx + RX - 30)} -940 Q ${n1(cx + RX + 50)} -880 ${n1(cx + RX + 28)} -760 Q ${n1(cx + RX + 6)} -850 ${n1(cx + RX - 50)} -900 Z`} fill={c} stroke={L} strokeWidth={SW} />;
    under = <g>{extra}<path d={`M ${P2(fullArc[0])} ${cr(fullArc, false, 1 / 6, false)} Z`} fill={c} stroke={L} strokeWidth={SW} strokeLinejoin="round" /></g>;
    const pu = 0.02;
    const edgeD = `M ${n1(X(1) + 2)} -848 Q ${n1(X(0.98))} -886 ${n1(X(0.8))} -922 Q ${n1(X(0.4))} -960 ${n1(X(pu))} -964 Q ${n1(X(-0.4))} -960 ${n1(X(-0.8))} -922 Q ${n1(X(-0.98))} -886 ${n1(X(-1) - 2)} -848`;
    front.push(fillOnly(`${edgeD} ${insetFill(fL, fR)}`, 'nf'), edge(edgeD, 'ne'));
    front.push(st(`M ${n1(X(pu))} -964 L ${n1(X(pu * 0.5) - t * 4)} -1004`, 'np', strandW * 1.1));
    for (const s of [-1, 1]) [0, 1].forEach((k) => front.push(st(`M ${n1(X(s * (0.1 + k * 0.12)))} ${-986 + k * 6} Q ${n1(X(s * (0.6 + k * 0.1)))} ${-974 + k * 10} ${n1(X(s * (0.92 - k * 0.04)) + s * 6)} ${-930 + k * 10}`, `ns${s}${k}`)));
  } else {
    // short: cowlick, short, side, kid — a mass with strand tips above the ears and a fringe of strands
    const tipsSide = (s: number): EP[] => {
      const y = lowY(s);
      return [[cx + s * (RX - 4), y, 'n'], [cx + s * (RX + 3), y + 14, 't'], [cx + s * (RX + 9), y - 6, 'n'], [cx + s * (rxM + 1), y + 7, 't']];
    };
    const lSeq: EP[] = [...tipsSide(-1), [arcF[0][0], arcF[0][1], 'n']];
    const rSeq: EP[] = [[arcF[arcF.length - 1][0], arcF[arcF.length - 1][1], 'n'], ...tipsSide(1).reverse()];
    // uneven silhouette: a few strands stick out of the mass (behind it — only the sticking-out part shows)
    const spikes = hat ? null : spikeNodes(cx, mcy, rxM, ryM, SPIKES[hair] ?? []);
    under = (
      <g>
        <path d={`M ${P2([lSeq[0][0], lSeq[0][1]])} ${strands(lSeq, false)} ${cr(arcF, false, 1 / 6, false)} ${strands(rSeq, false)} Z`} fill={c} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
        {spikes}
      </g>
    );
    let edgeP: EP[];
    let lines: string[] = [];
    if (hair === 'side') {
      // short male haircut: parting on the left, the top combed back and to the right, the forehead open, short temples,
      // receding at the temples
      edgeP = [sb(1, -868), [X(0.93), -902, 'n'], [X(0.8), -934, 'n'], [X(0.58), -948, 'n'], [X(0.2), -956, 'n'], [X(-0.2), -958, 'n'],
        [X(-0.46), -956, 'n'], [X(-0.68), -944, 'n'], [X(-0.86), -916, 'n'], sb(-1, -868)];
      lines = [
        `M ${n1(X(-0.46))} -956 Q ${n1(X(-0.47))} -985 ${n1(X(-0.4))} -1010`,
        `M ${n1(X(-0.36))} -958 Q ${n1(X(0.1))} -990 ${n1(X(0.7))} -980`,
        `M ${n1(X(-0.2))} -958 Q ${n1(X(0.3))} -975 ${n1(X(0.85))} -950`,
        `M ${n1(X(-0.32))} -990 Q ${n1(X(0.2))} -1010 ${n1(X(0.6))} -1004`,
        `M ${n1(X(-0.6))} -950 Q ${n1(X(-0.75))} -975 ${n1(X(-0.8))} -1000`,
      ];
    } else if (hair === 'kid') {
      edgeP = [sb(1, -852)];
      const n = 11;
      for (let i = 0; i <= n; i++) {
        const u = 0.88 - (1.76 * i) / n;
        edgeP.push([X(u), i % 2 ? -900 + 6 * u * u : -916 + 10 * u * u, i % 2 ? 't' : 'n']);
      }
      edgeP.push(sb(-1, -852));
      lines = [-0.5, -0.15, 0.2, 0.55].map((u) => `M ${n1(X(u * 0.4))} -1010 Q ${n1(X(u))} -960 ${n1(X(u * 1.05))} -922`);
    } else if (hair === 'cowlick') {
      // open face: a short fringe, parting on the left, strands combed to the right, the forehead and brows visible
      edgeP = [sb(1), [X(0.9), -904, 'n'], [X(0.82), -900, 't'], [X(0.7), -926, 'n'], [X(0.6), -916, 't'], [X(0.44), -938, 'n'],
        [X(0.34), -926, 't'], [X(0.16), -946, 'n'], [X(0.06), -934, 't'], [X(-0.1), -952, 'n'], [X(-0.3), -960, 'n'],
        [X(-0.56), -946, 'n'], [X(-0.7), -926, 't'], [X(-0.82), -922, 'n'], sb(-1)];
      lines = [
        `M ${n1(X(-0.26))} -996 Q ${n1(X(0.1))} -990 ${n1(X(0.34))} -930`,
        `M ${n1(X(-0.22))} -982 Q ${n1(X(-0.02))} -976 ${n1(X(0.06))} -938`,
        `M ${n1(X(-0.18))} -1004 Q ${n1(X(0.4))} -996 ${n1(X(0.6))} -922`,
        `M ${n1(X(-0.34))} -992 Q ${n1(X(-0.55))} -970 ${n1(X(-0.68))} -930`,
      ];
    } else if (hair === 'shaggy') {
      // longer and shaggier: a fringe of uneven strands down to the brows, strands cover the top of the ears
      edgeP = [sb(1, -826), [X(0.93), -880, 'n'], [X(0.86), -870, 't'], [X(0.77), -906, 'n'], [X(0.64), -890, 't'], [X(0.53), -916, 'n'],
        [X(0.4), -894, 't'], [X(0.28), -920, 'n'], [X(0.14), -890, 't'], [X(0.02), -918, 'n'], [X(-0.12), -894, 't'], [X(-0.24), -920, 'n'],
        [X(-0.38), -898, 't'], [X(-0.5), -916, 'n'], [X(-0.63), -890, 't'], [X(-0.76), -906, 'n'], [X(-0.86), -872, 't'], [X(-0.93), -882, 'n'], sb(-1, -826)];
      lines = [
        `M ${n1(X(0.2))} -1008 Q ${n1(X(0.3))} -960 ${n1(X(0.14))} -900`,
        `M ${n1(X(-0.05))} -1004 Q ${n1(X(-0.1))} -955 ${n1(X(-0.12))} -902`,
        `M ${n1(X(-0.3))} -996 Q ${n1(X(-0.45))} -950 ${n1(X(-0.38))} -904`,
        `M ${n1(X(0.45))} -994 Q ${n1(X(0.55))} -950 ${n1(X(0.4))} -902`,
        `M ${n1(X(0.7))} -976 Q ${n1(X(0.82))} -930 ${n1(X(0.86))} -878`,
        `M ${n1(X(-0.62))} -982 Q ${n1(X(-0.78))} -930 ${n1(X(-0.86))} -880`,
      ];
    } else {
      // short — a fringe of strands, more even
      const tp = 8;
      const lean = 0.03;
      edgeP = [sb(1), [X(0.88), -906, 'n']];
      const notches = [0.88, 0.66, 0.42, 0.18, -0.06, -0.3, -0.54, -0.8];
      const ys = [-906, -924, -932, -936, -936, -932, -924, -912];
      for (let i = 1; i < notches.length; i++) {
        const um = (notches[i - 1] + notches[i]) / 2 - lean;
        edgeP.push([X(um), -900 - tp + (i === 4 ? 4 : 0) + (i % 2 ? 0 : 3), 't']);
        edgeP.push([X(notches[i]), ys[i], 'n']);
      }
      edgeP.push(sb(-1));
      lines = [
        `M ${n1(X(0.3))} -1004 Q ${n1(X(0.34))} -960 ${n1(X(0.22))} -918`,
        `M ${n1(X(0.1))} -998 Q ${n1(X(0.04))} -950 ${n1(X(-0.08))} -916`,
        `M ${n1(X(-0.1))} -996 Q ${n1(X(-0.22))} -955 ${n1(X(-0.4))} -918`,
        `M ${n1(X(0.55))} -990 Q ${n1(X(0.62))} -950 ${n1(X(0.5))} -918`,
        `M ${n1(X(-0.36))} -986 Q ${n1(X(-0.55))} -950 ${n1(X(-0.66))} -914`,
      ];
    }
    const edgeD = strands(edgeP);
    front.push(fillOnly(`${edgeD} ${insetFill(fL, fR)}`, 'sf'), edge(edgeD, 'se'));
    lines.forEach((d, i) => front.push(st(d, `sl${i}`)));
    if (hair === 'cowlick' && !hat) {
      // the cowlick: one strand standing up on the crown
      const x0 = 14 - t * 16;
      const y0 = mcy - ryM + 6;
      front.push(<path key="ah" d={`M ${n1(x0 - 8)} ${n1(y0 + 6)} Q ${n1(x0 + 6)} ${n1(y0 - 44)} ${n1(x0 + 40)} ${n1(y0 - 40)} Q ${n1(x0 + 14)} ${n1(y0 - 24)} ${n1(x0 + 8)} ${n1(y0 + 6)} Z`} fill={c} stroke={L} strokeWidth={SW * 0.8} strokeLinejoin="round" />);
    }
  }

  return {under, behind, front: <g>{front}</g>, backView: null};
}

// ---------- headwear ----------

function hatOf(col: string, t: number, back: boolean, L: string, SW: number, IN: number): React.ReactNode {
  // a peaked cap: the crown wider than the head, a band, a glossy peak; from behind the crown is round and does not move with the turn
  const fs = back ? 0 : t * 26;
  const crown = `M ${n1(-RX - 10 + fs * 0.6)} -926 Q ${n1(-RX - 40 + fs)} -1010 ${n1(-RX + 18 + fs)} -1046 L ${n1(RX - 18 + fs)} -1046 Q ${n1(RX + 40 + fs)} -1010 ${n1(RX + 10 + fs * 0.6)} -926 Z`;
  return (
    <g>
      <path d={crown} fill={col} stroke={L} strokeWidth={SW} strokeLinejoin="round" />
      <path d={`M ${n1(-RX - 8 + fs * 0.6)} -958 L ${n1(RX + 8 + fs * 0.6)} -958 L ${n1(RX + 10 + fs * 0.6)} -924 Q ${n1(fs * 0.6)} -916 ${n1(-RX - 10 + fs * 0.6)} -924 Z`} fill={scaleHex(col, 0.62)} stroke={L} strokeWidth={SW * 0.8} strokeLinejoin="round" />
      {!back && (
        <>
          <path d={`M ${n1(-RX + 2 + fs * 1.2)} -926 Q ${n1(fs * 1.3)} -894 ${n1(RX - 2 + fs * 1.2)} -926 Q ${n1(fs * 1.2)} -912 ${n1(-RX + 2 + fs * 1.2)} -926 Z`} fill="#121218" stroke={L} strokeWidth={SW * 0.8} strokeLinejoin="round" />
          <path d={`M ${n1(-RX * 0.5 + fs * 1.25)} -916 Q ${n1(fs * 1.3)} -904 ${n1(RX * 0.4 + fs * 1.25)} -914`} stroke="#5A5E70" strokeWidth={IN * 1.2} fill="none" strokeLinecap="round" />
        </>
      )}
    </g>
  );
}

// ---------- glasses ----------

function glassesOf(kind: 'round' | 'square', t: number, pxu: (u: number, rr?: number) => number, wfu: (u: number) => number, L: string, lw: (v: number, m?: number) => number, drop = 0): React.ReactNode {
  // drop — glasses lower on the nose (looks over the glasses, Face.over): lenses and the bridge lower, the temples go up to the ears
  const round = kind === 'round';
  const w = lw(3.4, 1.1);
  const lens = (s: number) => {
    const u = s * 0.43;
    const x = pxu(u, 1.04);
    const wf = wfu(u);
    return round
      ? <ellipse key={`g${s}`} cx={x} cy={EY - 1 + drop} rx={30 * wf} ry={29 - 0.15 * drop} fill="#FFFFFF" fillOpacity={0.14} stroke={L} strokeWidth={w} />
      : <rect key={`g${s}`} x={x - 36 * wf} y={EY - 24 + drop} width={72 * wf} height={46 - 0.2 * drop} rx={8} fill="#FFFFFF" fillOpacity={0.14} stroke={L} strokeWidth={w} />;
  };
  const gl = pxu(-0.43, 1.04) + (round ? 30 : 36) * wfu(-0.43);
  const gr = pxu(0.43, 1.04) - (round ? 30 : 36) * wfu(0.43);
  const near = t >= 0 ? -1 : 1;
  const ex = near * (RX - 4) * Math.cos(t * 0.68) + t * 4;
  const lx = pxu(near * 0.43, 1.04) + near * (round ? 30 : 36) * wfu(near * 0.43);
  const by = EY - 6 + drop;
  const fx = pxu(-near * 0.43, 1.04) - near * (round ? 30 : 36) * wfu(-near * 0.43); // outer edge of the far lens
  return (
    <g>
      {lens(-1)}
      {lens(1)}
      <path d={`M ${n1(gl)} ${n1(by)} Q ${n1((gl + gr) / 2)} ${n1(by - 8)} ${n1(gr)} ${n1(by)}`} stroke={L} strokeWidth={w} fill="none" />
      <path d={`M ${n1(lx)} ${n1(EY - 8 + drop)} L ${n1(ex)} ${EY - 14}`} stroke={L} strokeWidth={w} />
      {/* the far temple — from the lens edge to the temple; shortens to zero when the temple goes behind the silhouette (no jump at |t| =
         0.25) */}
      {-near * (-ex - fx) > 0.5 && <path d={`M ${n1(fx)} ${n1(EY - 8 + drop)} L ${n1(-ex)} ${EY - 14}`} stroke={L} strokeWidth={w} />}
    </g>
  );
}
