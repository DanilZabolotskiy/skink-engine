// A cut-out character drawn entirely in code (SVG), driven by numbers: emotion (Face), blink, head turn, gaze, breathing, the step and
// the staging gesture. The core solves the figure — the body pose (body.ts), the head placement on the neck, breathing and trembling,
// the frame journal marks and the pose journal — and a drawing style (style.ts, lib/styles) draws the head and the body.
// Local units: feet at (0, 0), the crown at about y = −1010; the figure is scaled to its height in pixels.
import React from 'react';
import {Face} from './emotions';
import {DEFAULT_LOOK, Hold, Look} from './looks';
import {noise1} from '../anim';
import {BodyGest, CROWN_Y, armLogs, bodyPose} from './body';
import {PoseLogCtx} from './arm';
import {HandMarkCtx} from './hand';
import {CharacterStyle, StyleCtx} from './style';

export type Outfit = {
  skin: string; hair: string; top: string; shirt: string; trousers: string; shoes: string;
  lanyard: string; folder: string; line: string;
};

/** Colours of a figure without an outfit; lib/chapter/figure.tsx outfitOf fills the colours a role does not set from here. */
export const OUTFIT_DEFAULT: Outfit = {
  skin: '#F3CFA9', hair: '#2A2420', top: '#6F7F96', shirt: '#E8EBF0', trousers: '#2F3240',
  shoes: '#16121A', lanyard: '#3E4A5C', folder: '#7A8FA6', line: '#0A0C10',
};

export type CharacterProps = {
  x: number; // screen, px — the point between the feet
  y: number;
  height: number; // px from the feet to the crown
  face: Face;
  t: number; // seconds — breathing and trembling
  facing?: 'front' | 'back';
  blink?: number;
  headTurn?: number; // -1..1, 1 — facing right on screen
  headTilt?: number; // degrees
  gazeX?: number; // -1..1
  gazeY?: number; // -1..1, -1 — up
  glow?: string; // glow colour around the figure; none by default
  light?: number; // lighting 0..1
  outfit?: Outfit;
  look?: Look; // hairstyle, clothes, items in hands (looks.ts); without it — DEFAULT_LOOK
  walk?: number; // step phase in steps (lib/character/walk.ts): an integer — a foot contact; 0 or none — standing
  seed?: string;
  style?: React.CSSProperties;
  drawing?: CharacterStyle; // drawing style (lib/styles); without it — StyleCtx
  gest?: BodyGest | null; // staging gesture (lib/staging/stage.ts gestAt): pose, hold, event fraction and event fields (side, n, grip)
  reach?: [number, number]; // hand point of the gesture, local figure units (Figure converts it from frame px)
  pace?: string; // pace of the running walk: run — running
  tapLift?: number; // thumb lift in tap: 1 — normal
  breath?: number; // breathing amplitude (1 — normal): a close-up damps the head sway to a few px (otherwise the static shot jitters)
};

const VB_W = 640;
const VB_H = 1120;

// SVG affine matrices [a b c d e f]. The head transform is computed as numbers, because the neck is placed under the head with it and the
// pose journal records head points through it.
type M6 = [number, number, number, number, number, number];
type Pt2 = [number, number];
const mmul = (A: M6, B: M6): M6 => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
const mapM = (A: M6, q: Pt2): Pt2 => [A[0] * q[0] + A[2] * q[1] + A[4], A[1] * q[0] + A[3] * q[1] + A[5]];
const rotAt = (deg: number, c: Pt2): M6 => {
  const r = (deg * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  return [co, si, -si, co, c[0] - co * c[0] + si * c[1], c[1] - si * c[0] - co * c[1]];
};
/** Bottom of the head (a polyline, body units) under x: the lowest intersection of the vertical with the polyline; outside it
 *  — the nearer end. */
const underAt = (pts: Pt2[], x: number): number => {
  let y = -Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if ((x - x0) * (x - x1) <= 0 && x0 !== x1) y = Math.max(y, y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  }
  if (y > -Infinity) return y;
  const ends = [pts[0], pts[pts.length - 1]].sort((a, b) => Math.abs(a[0] - x) - Math.abs(b[0] - x));
  return ends[0][1];
};
/** Visible neck at the front (body units), for a style that draws one (HeadOut.front): with an open collar a strip of at least NECK_REST
 *  shows at rest (a stoop does not lay the chin on the collar); with a tilt, a turn and a nod at least NECK_MIN and at least NECK_BAND of
 *  the larger side shows at each neck edge, otherwise the neck reads as a wedge. In three quarters the near edge is longer (it goes under
 *  the ear), which is not a wedge. A neck under a stand-up collar (a padded jacket) stays hidden: the head does not rise out of it. */
const NECK_REST = 10;
const NECK_MIN = 6;
const NECK_BAND = 0.25;

export const Character: React.FC<CharacterProps> = (p) => {
  const ctxStyle = React.useContext(StyleCtx);
  const st = p.drawing ?? ctxStyle;
  if (!st) throw new Error('Character: no drawing style — pass `drawing` or wrap the figure in <StyleCtx.Provider value={style}> (lib/styles)');
  const o = p.outfit ?? OUTFIT_DEFAULT;
  const lk = p.look ?? DEFAULT_LOOK;
  const f = p.face;
  const seed = p.seed ?? 'char';
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const back = p.facing === 'back';
  const turn = p.headTurn ?? 0;
  // blinking is suppressed while the figure is focused: the focused emotion (Face.focus) or a gesture it follows with its eyes (presses a
  // sheet, writes, dials) keeps the eyes open; blinking returns smoothly towards the end of the gesture event
  const gestFocus = p.gest && ['press', 'write', 'dial', 'tap'].includes(p.gest.pose) ? Math.min(1, p.gest.k * 4) * Math.min(1, (1 - p.gest.ph) * 8) : 0;
  const blink = (p.blink ?? 0) * (1 - Math.min(1, Math.max(p.face.focus ?? 0, gestFocus)));
  const gx = p.gazeX ?? 0;
  const gy = p.gazeY ?? 0;
  const light = p.light ?? 1;

  // breathing and trembling; a character trembles only in strong fear and slowly, not at the frame rate (production rule 2)
  const br = (p.breath ?? 1) * Math.sin(p.t * 2 * Math.PI / 3.6 + (seed.length % 7));
  const breathS = 1 + 0.013 * br;
  const tr = f.tremble;
  const jx = tr * 3 * noise1(`${seed}jx`, p.t * 6);
  const jy = tr * 2 * noise1(`${seed}jy`, p.t * 5);
  const headBob = -6 * br + jy;

  const holds: [Hold, Hold] = lk.hold ?? ['none', 'none'];
  const body = bodyPose({look: lk, holds, face: f, back, walk: p.walk ?? 0, pace: p.pace, gest: p.gest ?? undefined, reach: p.reach, tapLift: p.tapLift});
  const scale = p.height / 1010;
  // head scale: the style's head size, a child's head is larger
  const hs = st.headScale * (lk.hair === 'kid' ? 1.12 : lk.head ?? 1);
  const head = st.head({o, look: lk, uid, t: p.t, face: f, blink, turn, gx, gy, back, ppu: scale * hs});
  const mark = React.useContext(HandMarkCtx);
  const bodyOut = st.body({o, look: lk, uid, t: p.t, back, body, breathS, mark, seed});

  // head transform: head units → body units (scale hs around the crown), headTilt around the head–neck joint (not at the collar: the head
  // does not slide sideways off the neck), y shift — breathing, stooping, running; the front neck is a column from the collar to the joint
  const A0: M6 = [hs, 0, 0, hs, 0, CROWN_Y * (1 - hs)];
  const Rh = rotAt(p.headTilt ?? 0, mapM(A0, [0, st.pivot]));
  const fit = (() => {
    const n = bodyOut.neck;
    // at rest the chin stays at least NECK_REST above the collar: a stoop lowers the head less (front and back alike)
    const chin0 = CROWN_Y + hs * (head.chin - CROWN_Y);
    const gapRest = n.y0 - (chin0 + n.stoop);
    const restFix = n.open ? Math.max(0, Math.min(n.stoop, NECK_REST - gapRest)) : 0;
    const fr = head.front;
    const extra = lk.neck ?? 0; // a longer neck (look.neck): the head higher above the collar
    if (!fr) return {dy: -restFix - extra, h: null as number[] | null, rest: gapRest + restFix + extra};
    const M0 = mmul([1, 0, 0, 1, 0, headBob + body.headDy - restFix - extra], mmul(Rh, A0));
    const jaw = fr.jaw.map((q) => mapM(M0, q));
    const h = fr.edges.map((ex) => n.y - underAt(jaw, ex * hs));
    const hi = Math.max(...h), lo = Math.min(...h);
    // an open collar shows the neck as a strip: the head rises until the smaller edge is at least NECK_MIN and NECK_BAND of the larger.
    // A neck under a stand-up collar (hidden at rest) is left alone: in three quarters the side of the neck under the ear shows above the
    // stand, as in real life
    const d = n.open ? -Math.max(0, NECK_MIN - lo, (NECK_BAND * hi - lo) / (1 - NECK_BAND)) : 0;
    return {dy: d - restFix - extra, h: h.map((v) => v - d), rest: gapRest + restFix + extra};
  })();
  const Mh = mmul([1, 0, 0, 1, 0, headBob + body.headDy + fit.dy], mmul(Rh, A0));
  const headWrap = (n: React.ReactNode) => (n ? <g transform={`matrix(${Mh.map((v) => +v.toFixed(5)).join(' ')})`}>{n}</g> : null);
  const neckFront = head.front ? head.front.draw((q) => mapM(Mh, q), hs, bodyOut.neck.y + 26) : null;
  // the head mark of the frame journal (tools/stage_layout.mjs): a text card must not lie on it
  const headNode = <g data-stage="head" data-who={seed}>{headWrap(head.head)}</g>;

  // arm pose journal for the check (tools/hands_check.mjs): points in figure units and in frame pixels (by getScreenCTM)
  const poseLog = React.useContext(PoseLogCtx);
  const svgRef = React.useRef<SVGSVGElement>(null);
  React.useLayoutEffect(() => {
    if (!poseLog || !svgRef.current) return;
    const m = svgRef.current.getScreenCTM();
    if (!m) return;
    const tr = (q?: [number, number] | number[]) => (q ? [+(m.a * q[0] + m.c * q[1] + m.e).toFixed(1), +(m.b * q[0] + m.d * q[1] + m.f).toFixed(1)] : undefined);
    // the core journal with the self-check of the drawn hands of the style (CharacterStyle.handAudit)
    const arms = armLogs(body, st.handAudit).map((a) => ({...a, who: seed, scr: {S: tr(a.S), E: tr(a.E), W: tr(a.W), tip: tr(a.tip), grip: tr(a.grip)}}));
    const bodyPts = {neck: tr([0, -800]), hip: tr([0, -524]), top: tr([0, -1010]), feet: tr([0, 0])};
    // head and neck at the front, for the neck check: the collar (y of the collar top, x of the neck edges at the collar), the top of the
    // neck (points under the head), the bottom of the head (jaw and chin) and the skull centre, all in frame pixels; h — the visible neck
    // at the sides, body units. From behind — the head pose (the neck sheet) and the lost-profile features
    const fr = head.front;
    const headLog = fr ? {
      collar: [tr([fr.edges[0] * hs, bodyOut.neck.y]), tr([fr.edges[1] * hs, bodyOut.neck.y])],
      top: fr.top.map((q) => tr(mapM(Mh, q))),
      jaw: fr.jaw.map((q) => tr(mapM(Mh, q))),
      skull: tr(mapM(Mh, [0, -878])),
      h: fit.h?.map((v) => +v.toFixed(1)), dy: +fit.dy.toFixed(1), rest: +fit.rest.toFixed(1), open: bodyOut.neck.open, tilt: p.headTilt ?? 0, turn, gy,
    } : {dy: +fit.dy.toFixed(1), tilt: p.headTilt ?? 0, turn, gy, ...(head.back ? {th: +head.back.th.toFixed(3), eye: +head.back.eye.toFixed(2), ear: head.back.ear} : {})};
    console.log('POSE ' + JSON.stringify({who: seed, back, ppu: +Math.hypot(m.a, m.b).toFixed(4), clip: p.style?.clipPath ?? null, body: bodyPts, head: headLog, arms}));
  });

  const tree = back ? (
    <>
      {bodyOut.legs}
      {bodyOut.arms}
      {headWrap(head.neck)}
      {bodyOut.torso}
      {headNode}
    </>
  ) : (
    <>
      {headWrap(head.behind)}
      {bodyOut.legs}
      {headWrap(head.under)}
      {neckFront}
      {bodyOut.torso}
      {bodyOut.arms}
      {headNode}
      {bodyOut.over}
    </>
  );

  // the figure does not jump by a pixel separately from the background (production rule 2): the block is placed in whole pixels and the
  // fractional part of the shift goes into the viewBox (otherwise the browser snaps a filtered layer to a whole pixel, and on a push-in
  // the figure jerks against the background)
  const W = VB_W * scale;
  const H = VB_H * scale;
  const g1 = Math.max(1.5, p.height * 0.006);
  const g2 = Math.max(4, p.height * 0.02);
  const left0 = p.x - W / 2 + jx * scale;
  const top0 = p.y - H * (1040 / VB_H) + jy * scale;
  const li = Math.floor(left0);
  const ti = Math.floor(top0);
  const Wi = Math.ceil(W) + 2;
  const Hi = Math.ceil(H) + 2;
  const vb = `${(-VB_W / 2 - (left0 - li) / scale).toFixed(4)} ${(-1040 - (top0 - ti) / scale).toFixed(4)} ${(Wi / scale).toFixed(4)} ${(Hi / scale).toFixed(4)}`;
  return (
    <div
      style={{
        position: 'absolute',
        left: li,
        top: ti,
        width: Wi,
        height: Hi,
        filter: `brightness(${(0.42 + 0.58 * light).toFixed(3)})` + (p.glow ? ` drop-shadow(0 0 ${g1}px ${p.glow}) drop-shadow(0 0 ${g2}px ${p.glow}aa)` : ''),
        ...p.style,
      }}
    >
      <svg ref={svgRef} width={Wi} height={Hi} viewBox={vb} style={{overflow: 'visible'}} data-stage="fig" data-who={seed} data-style={st.id} data-facing={back ? 'back' : 'front'} data-pose={p.gest ? `${p.gest.pose}:${p.gest.k.toFixed(2)}` : ''} data-turn={turn.toFixed(2)} data-tilt={(p.headTilt ?? 0).toFixed(1)} data-gaze={`${gx.toFixed(2)},${gy.toFixed(2)}`} data-arms={body.logs.map((a) => [a.W[0], a.W[1], a.tip[0], a.tip[1]].map((v) => v.toFixed(0)).join(',')).join(';')}>
        {tree}
      </svg>
    </div>
  );
};
