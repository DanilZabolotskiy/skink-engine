// Body skeleton of a character — the part of the body that does not depend on the drawing style: proportions, posture and the pose of the
// arms and hands. Local figure units: feet at (0, 0), the crown at about y = −1010; x — right on screen, y — down, z — towards the viewer
// (from behind z also points at the viewer, that is, at the figure's back).
// Arms are the skeleton of arm.ts (constant lengths, IK in 3D, the elbow bends the natural way); a hand is a frame of hand.ts with a hand
// shape; an item in a hand is a prop of lib/props placed by the grip point of the hand. The pose of an arm is a list of layers from bottom
// to top (the back of a hand behind a prop, the prop, the arm, the front of the hand…); a style draws every layer its own way
// (lib/character/style.ts). The poses are written to the pose journal and checked by tools/hands_check.mjs.
import {armSwing, footLift} from './walk';
import type {Face} from './emotions';
import type {Hold, Look} from './looks';
import {clamp, lerp} from '../anim';
import {ARM_L1, ARM_L2, ArmLog, ELBOW_MIN, HandSide, HandView, Pt, V3, dirOf, handOf, ik3, liveView, sideVec, v3, wristClamp} from './arm';
import {HAND_GRIP, HAND_LEN, HandMix, HandShape, fistGrip, handPose, handPt, isRig, pointTip} from './hand';
import type {Hang, Item} from '../props/props';

/** Height of the crown: a style scales its head around this point (CharacterStyle.headScale). */
export const CROWN_Y = -1006;
/** Reference heights of the body, figure units: the base of the neck, the top of the shoulder, the hips (top of the legs). */
export const NECKB = -800;
export const SHY = -776;
export const HIP = -524;

/** "Pushes a door" gesture from behind: wrist target and elbow pole (s — side in the frame). The hand lies on the leaf beside the body at
 *  rail height (≈ 1.0 m: −612), farther from the body than the elbow: the upper arm goes down along the side, the elbow is at the waist
 *  slightly back, the forearm goes from the elbow out and forward to the leaf (almost horizontal in the frame, about 60 % of its length
 *  visible). A hand inside the elbow (the forearm back towards the body) reads as a hand on the hip, not a push. The target depth is
 *  small: with the forearm pointing away from the viewer the fist twists (a palm turn over 100°, tools/hands_check.mjs). */
const PUSH_T = (s: number): V3 => [s * 172, -602, -60];
const PUSH_POLE = (s: number): V3 => [-s * 0.4, 1, 0.8];
/** "Presses a sheet": how far the palm slides down. */
const PRESS_DY = 46;
/** Poses with a hand point of the kit (reach) or without it — the gesture arm of the common solver. */
const REACH_POSES = ['pull', 'push', 'rail'];
const PHONE_POSES = ['dial', 'tap', 'hangup'];
/** Holds of a mop: at the side or raised over the head (the knock gesture raises it and jabs the handle up). */
const MOP: Hold[] = ['mop', 'mopRaised'];
/** From the front the visible forearm is no shorter than this share of its length in the frame (no hand without an arm in mid-frame). */
const FORE_MIN = 0.62;
/** A mop: the handle length from the clamp to the top and the rag length from the clamp to the floor, figure units. */
const MOP_LEN = 650;
const MOP_RAG = 116;

/** Middle of the palm of the reach hold (a palm on a framed sheet or a button to the side at head height), figure units: a kit places the
 *  figure so that this point lands on the sheet. s — side on screen, w — body width (look.w). */
const reachPalm = (s: number, w = 1): Pt => [s * 280 * w, -888];

/** Gesture: pose, hold k, event fraction ph; event fields: side — the figure's own hand (R / L), n — how many fingers (count) or hits
 *  (knock), grip — the push grip (fist — a fist on the handle, flat — a palm on the leaf; press — the palm presses a sheet to a wall,
 *  facing with the back or the edge of the hand towards the viewer; point — the tip of the index finger on the point: a line of a sheet, a
 *  button of a screen), dur — event length, stay — the pose stays after the event, ramp — the event fraction of the tap entry (default
 *  0.15; 0.001 — the figure is in the phone from the first frame of the shot instead of a slow entry over a long event). */
export type BodyGest = {pose: string; k: number; ph: number; side?: string; n?: number; grip?: string; dur?: number; stay?: boolean; ramp?: number};

/** A hand: the frame (wrist W, fingers along f, thumb or palm side u, scale k), its shape and view; q — the progress of a live shape (count —
 *  how many fingers are up, rail — the tapping phase, tap — the thumb lift); from — a transition from another shape (the fingers bend by
 *  the joints of the skeleton pose, hand.ts). at — a point of the hand frame in figure units. */
export type Hand = {W: Pt; f: Pt; u: Pt; k: number; shape: HandShape; view: HandView; q: number; from?: HandMix; at: (x: number, y: number) => Pt};

/** A layer of an arm pose, bottom to top: arm — upper arm and forearm (part upper — only the upper arm; one — the sleeve as one shape,
 *  without a joint line at the elbow); hand — the back part (behind a prop) or the front part of a hand; item — a prop (opacity — a prop
 *  fading out, e.g. the part of a mop handle in front of a rising arm). */
export type Layer =
  | {t: 'arm'; S: V3; E: V3; W: V3; part: 'full' | 'upper'; one: boolean}
  | {t: 'hand'; h: Hand; back: boolean}
  | {t: 'item'; item: Item; opacity?: number};
/** An arm: its layers; over — drawn over the head (a phone at the ear). From behind the arms are drawn under the torso. */
export type ArmPose = {layers: Layer[]; over: boolean};

export type BodyIn = {
  look: Look; holds: [Hold, Hold]; face: Face; back: boolean;
  walk: number; // step phase (walk.ts)
  pace?: string; // pace of the running walk event: run — running (bent knees, arm swing, the body leans forward)
  gest?: BodyGest; // staging gesture: push, pull, rail, count, press, write, dial, tap, hangup, straighten, knock
  reach?: Pt; // hand point of the gesture (door handle, rail), figure units
  tapLift?: number; // thumb lift in tap (1 — normal): a larger lift reads better on a dark medium shot
};

/** A hand of the pose journal: the hand and, with a prop in the fist, the prop centre and axis in the hand frame — for the self-check of
 *  the drawn hand of a style (CharacterStyle.handAudit). */
export type HandRef = {h: Hand; grip?: {c: Pt; axis: Pt}};

/** Body pose. Half-widths of the torso before the body width w: sx — shoulders, cx0 — chest, wx — waist, hx — hips; shY — the shoulder
 *  line; stoop 0..1 — an elderly stoop; bob — vertical offset of the torso and the arms (running bounce, the straighten gesture); headDy —
 *  how much lower the head sits; lift — foot lift of the left and right leg on screen, 0..1, liftH — its height in units; armW — sleeve
 *  width; logs — arm poses for the pose journal, hands — the hands of these entries (one per entry). */
export type Body = {
  fem: boolean; w: number; sx: number; cx0: number; wx: number; hx: number; shY: number; stoop: number; run: boolean;
  bob: number; headDy: number; lift: [number, number]; liftH: number; armW: number; arms: ArmPose[]; logs: ArmLog[]; hands: HandRef[];
};

/** The arm journal with the self-check of the drawn hands of a style (CharacterStyle.handAudit): fgap, notch and, with a prop in the fist,
 *  wrap. Without an audit — the journal as it is. */
export function armLogs(body: Body, audit?: (h: Hand, grip?: {c: Pt; axis: Pt}) => {gap: number; notch: number; wrap?: number}): ArmLog[] {
  if (!audit) return body.logs;
  return body.logs.map((a, i) => {
    const r = body.hands[i];
    if (!r) return a;
    const au = audit(r.h, r.grip);
    return {...a, fgap: +au.gap.toFixed(1), notch: +au.notch.toFixed(1), ...(au.wrap !== undefined ? {wrap: au.wrap} : {})};
  });
}

export function bodyPose(p: BodyIn): Body {
  const {look, back} = p;
  const fem = look.build === 'woman';
  const w = look.w ?? 1;
  const age = look.age ?? 0;
  const stoop = clamp((age - 0.75) / 0.15);
  // running (walk with pace: run): the body bounces highest in the middle of the leg swing and leans forward — the head is lower
  const run = p.pace === 'run' && !!p.walk;
  const runBob0 = run ? -12 * Math.abs(Math.sin(Math.PI * p.walk)) : 0;
  // straighten gesture: slightly stooped at the start of the event (body and head lower), straight by the end
  const bend0 = p.gest?.pose === 'straighten' ? 1 - (() => { const x = clamp(p.gest!.ph); return x * x * (3 - 2 * x); })() : 0;
  const runBob = runBob0 + 7 * bend0;
  const headDy = 16 * stoop + (run ? 12 : 0) + runBob + 14 * bend0;
  const sx = fem ? 100 : 112;
  const cx0 = fem ? 90 : 97; // the arms hang outside the chest and cover its side
  const wx = fem ? 78 : 87;
  const hx = fem ? 100 : 93;
  const shY = SHY + 6 * stoop;
  const armW = (fem ? 38 : 44) * Math.min(1, 0.85 + 0.15 * w);
  const unit = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const pr = (q: V3): Pt => [q[0], q[1]];
  const S3 = (s: number): V3 => [s * (sx * w - armW / 2), -738 + 6 * stoop, 0];
  // an adult hand: a fist is about a third of the head, an open hand spans from the brows to the chin
  const handK = (fem ? 1.4 : 1.55) * (look.build === 'child' ? 0.85 : 1);
  /** Hand at wrist W: fingers along f; u — the natural side of the thumb (or the palm) for this hand and view. from — a transition from
   *  another shape (share of the way): the fingers bend by the joints, the drawing is not swapped. */
  const handAt = (W: Pt, f: Pt, hand: HandSide, view: HandView, shape: HandShape, k = handK, q = 0, from?: HandMix): Hand => {
    const u = sideVec(hand, view, f);
    return {W, f, u, k, shape, view, q, ...(from ? {from} : {}), at: (x, y) => handPt(W, f, u, k, x, y)};
  };
  /** Axis of the prop held in a shape (HAND_GRIP) in figure coordinates. */
  const gAxis = (h: Hand, shape: HandShape): Pt => {
    const a = HAND_GRIP[shape]?.axis ?? [0, 1];
    return unit([0, 0], [h.u[0] * a[0] + h.f[0] * a[1], h.u[1] * a[0] + h.f[1] * a[1]]);
  };
  /** A prop in the fist: its centre and axis in the frame by the view of the fist (fistGrip): from the side — along the hand under the band
   *  of the fingers, with the back or the palm to the viewer — across the hand under the folded fingers. */
  const fistAt = (h: Hand): {G: Pt; ax: Pt} => {
    const g = fistGrip(h.view);
    return {G: h.at(g.c[0], g.c[1]), ax: unit([0, 0], [h.u[0] * g.axis[0] + h.f[0] * g.axis[1], h.u[1] * g.axis[0] + h.f[1] * g.axis[1]])};
  };
  const arm = (S: V3, E: V3, W: V3, part: 'full' | 'upper' = 'full', one = false): Layer => ({t: 'arm', S, E, W, part, one});
  const front = (h: Hand): Layer => ({t: 'hand', h, back: false});
  const behind = (h: Hand): Layer => ({t: 'hand', h, back: true});
  const prop = (item: Item, opacity?: number): Layer => ({t: 'item', item, ...(opacity !== undefined ? {opacity} : {})});

  const arms: ArmPose[] = [];
  const logs: ArmLog[] = [];
  const hands: HandRef[] = [];
  const cl = p.face.clutch;
  const holds = p.holds;
  // drawing order of the arms: the folder first, so that the hand with the pen writes over it; otherwise the hand with a prop at the chest
  // (folder, phone, cup) goes after the other hand, so that the other shoulder does not overlap the prop
  const chestItem = (h: Hold) => ['folder', 'phone', 'cup', 'box', 'carry'].includes(h);
  const order = holds[1] === 'folder' && holds[0] === 'pen' ? [1, 0] : holds[1] === 'pen' || holds[0] === 'pen' ? [0, 1]
    : chestItem(holds[0]) && !chestItem(holds[1]) ? [1, 0] : [0, 1];
  let folderF: Pt | null = null; // centre of the folder (held by the other hand) — for the hand with the pen
  const thighMid = (HIP - 262) / 2; // middle of the thigh: a hanging hand reaches it with its fingers
  const walkPh = armSwing(p.walk);
  // the hand that pushes a door: the free one; if both are busy, the one with a small prop in the fist (a torch, keys), which stays in the
  // hand; a hand holding a folder, a box or a phone in front does not push
  const pushRank = (h: Hold) => (h === 'none' ? 0 : ['flashlight', 'keys', 'stamp'].includes(h) ? 1 : ['bag', 'tote'].includes(h) ? 2 : 3);
  const pushIdx = pushRank(holds[1]) <= pushRank(holds[0]) ? 1 : 0;
  // the hand of a gesture: the side of the event, if set (the figure's own R or L); for phone gestures — the hand with the phone; for
  // count — the free hand; for a reach point far to the side (beyond the torso width + 60 units) — the hand of that side, unless it holds
  // a prop at the chest or a bag while the other hand is free; for a point in front of the body — the free hand; from behind — always the
  // hand of the point's side (otherwise the arm reaches across the back and the fist sticks out at the shoulder). A point that crosses the
  // middle during the gesture would switch hands: set "side" in the event
  const g0 = p.gest;
  const sOf = (i: number) => (i === 0 ? -1 : 1) * (back ? -1 : 1);
  const gIdx = !g0 ? -1 : g0.side === 'R' ? 0 : g0.side === 'L' ? 1
    : PHONE_POSES.includes(g0.pose) ? (['phone', 'phoneEar'].includes(holds[0]) ? 0 : ['phone', 'phoneEar'].includes(holds[1]) ? 1 : -1)
    : g0.pose === 'count' ? pushIdx
    : g0.pose === 'knock' ? (MOP.includes(holds[0]) ? 0 : MOP.includes(holds[1]) ? 1 : pushIdx)
    : REACH_POSES.includes(g0.pose) && p.reach && (back || Math.abs(p.reach[0]) > ((fem ? 90 : 97) * w + 60)) ? (() => {
      const i = sOf(0) === (p.reach[0] >= 0 ? 1 : -1) ? 0 : 1;
      return pushRank(holds[i]) >= 2 && holds[1 - i] === 'none' ? 1 - i : i;
    })()
    : pushIdx;
  /** Arm idx. dry — a trial pass: the pose of the arm without a gesture (how it holds its prop); nothing is drawn or logged — it returns the
   *  elbow and the wrist of that pose; the motion of a gesture of an arm that held something starts from it. */
  const armOf = (idx: number, dry = false): {E: V3; W: V3} | null => {
    let dryEW: {E: V3; W: V3} | null = null;
    // holds are the figure's own hands, [right, left]. Facing the camera the right hand is on the left of the screen, from behind on the
    // right: the screen sides swap, and a prop stays in the same hand
    const s = (idx === 0 ? -1 : 1) * (back ? -1 : 1);
    const hold = holds[idx];
    const pair = holds[1 - idx];
    const hand = handOf(s, back);
    let S = S3(s); // a raised arm (reach) raises the shoulder joint too
    const sideSwing = s * walkPh; // the arms swing towards each other (by screen side — in antiphase with the leg of the same side)
    const zb = back ? -1 : 1; // the figure's forward: facing the camera — towards the viewer, from behind — away from the viewer
    const push = (layers: (Layer | null)[], over = false) => {
      if (!dry) arms.push({layers: layers.filter((l): l is Layer => l !== null), over: over && !back});
    };
    /** A front forearm shorter than 0.72 of its length in the frame (pointing towards or away from the viewer): the wrist stays and the
     *  elbow moves away from it in the frame, towards the old elbow, until the visible forearm reaches a length between 0.72 (r ≥ 0.72 —
     *  unchanged) and FORE_MIN (r → 0); if the shoulder cannot reach that point, the elbow takes the reachable point nearest to the old
     *  direction. The change is continuous in the pose, so the elbow does not jump during a gesture or an arm swing; depth signs stay.
     *  null — nothing to change. */
    const unfold = (E: V3, W: V3): {E: V3; W: V3; pole: V3} | null => {
      const E2 = pr(E);
      const W2 = pr(W);
      const lf = Math.hypot(W2[0] - E2[0], W2[1] - E2[1]);
      const R0 = 0.72;
      const r = lf / ARM_L2;
      if (r >= R0) return null;
      const rho = (R0 - (R0 - FORE_MIN) * ((R0 - r) / R0)) * ARM_L2;
      const d0: Pt = lf > 1e-3 ? unit(W2, E2) : [0, 1];
      let c: Pt = [W2[0] + d0[0] * rho, W2[1] + d0[1] * rho];
      const Lm = ARM_L1 * 0.995;
      if (Math.hypot(c[0] - S[0], c[1] - S[1]) > Lm) {
        // intersection of the circles around the wrist (rho) and around the shoulder (Lm): of the two points, the one
        // nearer the old direction
        const dx = S[0] - W2[0];
        const dy = S[1] - W2[1];
        const D = Math.hypot(dx, dy);
        if (D < 1e-3 || D > rho + Lm || D < Math.abs(Lm - rho)) return null;
        const a = (rho * rho - Lm * Lm + D * D) / (2 * D);
        const h = Math.sqrt(Math.max(0, rho * rho - a * a));
        const ux = dx / D;
        const uy = dy / D;
        const P1: Pt = [W2[0] + ux * a - uy * h, W2[1] + uy * a + ux * h];
        const P2: Pt = [W2[0] + ux * a + uy * h, W2[1] + uy * a - ux * h];
        const dot = (q: Pt) => (q[0] - W2[0]) * d0[0] + (q[1] - W2[1]) * d0[1];
        c = dot(P1) >= dot(P2) ? P1 : P2;
      }
      const ez = Math.sign((E[2] - S[2]) * zb) || 1;
      const wz = Math.sign((W[2] - E[2]) * zb) || 1;
      const pl = byPlane(c, W2, ez, wz);
      return {E: pl.E, W: [W2[0], W2[1], pl.T[2]], pole: pl.pole};
    };
    /** The engine keeps the arm joints natural whatever the pose: the elbow does not fold more than a living one (ik3), the hand continues
     *  the forearm — the wrist bend in the frame within natural limits (wristClamp); a free hand (a skeleton shape without a prop in the
     *  layers) gets a view within a natural forearm rotation (liveView: a twisted palm is replaced by the nearest natural view). from — a
     *  transition of the hand shape; fixed — the view is kept; palm — the palm normal of the pose; wk < 1 — the arm in motion. */
    type SolveOpt = {bend?: number; dir?: Pt; dirK?: number; q?: number; keep?: boolean; from?: HandMix; fixed?: boolean; palm?: V3; wk?: number};
    /** "Wing": the hand at the chest while the elbow sticks out beyond the torso silhouette farther than WING — the elbow returns to the side
     *  in the frame (the wrist stays, the depths follow from the lengths, the signs are kept). Whatever the pose, the engine keeps an arm at
     *  the chest with its elbow at the side. */
    const WING = 30;
    const unwing = (E: V3, W: V3): {E: V3; W: V3; pole: V3} | null => {
      const lim = cx0 * w + WING;
      if (back || Math.abs(W[0]) >= cx0 * w || s * E[0] <= lim) return null;
      const ez = Math.sign((E[2] - S[2]) * zb) || 1;
      const wz = Math.sign((W[2] - E[2]) * zb) || 1;
      const pl = byPlane([s * lim, E[1]], pr(W), ez, wz);
      return {E: pl.E, W: [W[0], W[1], pl.T[2]], pole: pl.pole};
    };
    /** Solve the arm: wrist target T, elbow pole; the hand continues the forearm with bend (rad, + towards side u) or along dir. */
    const solve = (T: V3, pole: V3, view: HandView, shape: HandShape, opt: SolveOpt = {}) => {
      const ik = ik3(S, T, pole);
      // from the front the visible forearm is no shorter than FORE_MIN of its length, otherwise the hand hangs in mid-frame without an
      // arm: the wrist stays, the elbow moves away from it in the frame (down and to the side, not out like a wing), depths follow
      // from the constant lengths
      const uf = !back && !opt.keep ? unfold(ik.E, ik.W) : null;
      const uw = !opt.keep ? unwing(uf ? uf.E : ik.E, uf ? uf.W : ik.W) : null;
      const fx = uw ?? uf;
      return place(fx ? fx.E : ik.E, fx ? fx.W : ik.W, fx ? fx.pole : pole, view, shape, opt);
    };
    /** The hand on a solved arm (elbow E, wrist W): the finger direction, the view, the wrist bend. */
    const place = (E: V3, W: V3, pole: V3, view: HandView, shape: HandShape, opt: SolveOpt = {}) => {
      const E2 = pr(E);
      const W2 = pr(W);
      const lf = Math.hypot(W2[0] - E2[0], W2[1] - E2[1]);
      // the line the hand continues: the forearm in the frame; when it is a point in the frame (it points at the viewer or away: shorter
      // than 0.15 of its length — under the hand it is not seen), it has no direction — the hand goes smoothly over to the line
      // shoulder → wrist
      const fa0: Pt = lf > 2 ? unit(E2, W2) : [0, 1];
      const sw2 = Math.hypot(W2[0] - S[0], W2[1] - S[1]);
      const kf = sw2 > 8 ? clamp((lf / ARM_L2 - 0.05) / 0.1) : 1;
      const sa2: Pt = sw2 > 8 ? unit([S[0], S[1]], W2) : fa0;
      const fa: Pt = kf >= 1 ? fa0 : unit([0, 0], [fa0[0] * kf + sa2[0] * (1 - kf), fa0[1] * kf + sa2[1] * (1 - kf)]);
      let f = fa;
      if (opt.bend) {
        const u0 = sideVec(hand, view, fa);
        const b = opt.bend;
        f = unit([0, 0], [fa[0] * Math.cos(b) + u0[0] * Math.sin(Math.abs(b)) * Math.sign(b), fa[1] * Math.cos(b) + u0[1] * Math.sin(Math.abs(b)) * Math.sign(b)]);
      }
      if (opt.dir) {
        // dirK — the way from "the hand along the forearm" to the direction of the pose: at the entry of a gesture the hand turns smoothly
        // instead of flipping out of the frame
        const d = unit([0, 0], opt.dir);
        const dk = opt.dirK ?? 1;
        if (dk >= 1) f = d;
        else {
          // the pose direction almost backwards along the forearm (it happens on the way): the hand does not turn to it — the shortest
          // turn changes sides there, and the hand would flip out of the frame
          const a0 = Math.atan2(f[0] * d[1] - f[1] * d[0], f[0] * d[0] + f[1] * d[1]);
          const a = a0 * dk * clamp((Math.PI - Math.abs(a0)) / (Math.PI / 3));
          f = [f[0] * Math.cos(a) - f[1] * Math.sin(a), f[0] * Math.sin(a) + f[1] * Math.cos(a)];
        }
      }
      // the wrist: the hand does not break against the forearm (a forearm almost a point in the frame has no line, the bend is not seen)
      const clampV = (v: HandView) => (lf > 2 ? wristClamp(fa, f, hand, v, lf / ARM_L2, opt.wk ?? 1) : {f, bend: 0, cut: 0});
      // the view: a free hand is not twisted — the palm within a natural turn from the neutral of the arm (with the wrist bend of that view)
      const free = !opt.fixed && isRig(shape) && !['phone', 'cup', 'ear', 'pen'].includes(shape);
      const view1 = free ? liveView(view, hand, S, E, W, (v) => clampV(v).f, opt.palm) : view;
      const wc = clampV(view1);
      const h = handAt(W2, wc.f, hand, view1, shape, handK, opt.q ?? 0, opt.from);
      return {E, W, h, pole, wristCut: wc.cut, viewWant: view1 !== view ? view : undefined};
    };
    let gripRef: {c: Pt; axis: Pt} | undefined; // the prop in the fist of the next journal entry (itemLog) — for the grip check of a style
    const log = (r: {E: V3; W: V3; h: Hand; pole: V3; wristCut?: number; viewWant?: HandView}, extra: Partial<ArmLog> = {}) => {
      if (dry) {
        dryEW = {E: r.E, W: r.W};
        return;
      }
      const L0 = HAND_LEN[r.h.shape];
      const hp = handPose(r.h.shape, r.h.q, r.h.from);
      const dg = (v: number) => +((v * 180) / Math.PI).toFixed(1);
      logs.push({side: s, hand, hold, back, S, E: r.E, W: r.W, L1: ARM_L1, L2: ARM_L2, pole: r.pole, f: r.h.f, u: r.h.u, view: r.h.view, shape: r.h.shape,
        handLen: L0 * r.h.k, tip: r.h.at(0, L0), torsoX: cx0 * w,
        ...(hp ? {fingers: hp.f.map((c) => c.map(dg)), thumb: [+hp.th.abd.toFixed(2), dg(hp.th.flex), +hp.th.opp.toFixed(2)]} : {}),
        ...(r.h.from && r.h.from.k < 1 ? {mix: `${r.h.from.shape} → ${r.h.shape} ${r.h.from.k.toFixed(2)}`} : {}),
        ...(r.wristCut && r.wristCut > 0.5 ? {wristCut: +r.wristCut.toFixed(1)} : {}), ...(r.viewWant ? {viewWant: r.viewWant} : {}), ...extra});
      hands.push({h: r.h, ...(gripRef ? {grip: gripRef} : {})});
      gripRef = undefined;
    };
    /** A prop in the fist — for the check (tools/hands_check.mjs): item — the prop segment in the frame from t0 to t1 along d, half-width
     *  hw, over — drawn over the arm; the prop axis through the grip point of the fist goes to the grip check of the style (wrap). */
    const itemLog = (h: Hand, d: Pt, t0: number, t1: number, hw: number, over: boolean): Partial<ArmLog> => {
      const c = fistGrip(h.view).c;
      gripRef = {c, axis: [d[0] * h.u[0] + d[1] * h.u[1], d[0] * h.f[0] + d[1] * h.f[1]]};
      return {item: {p: h.at(c[0], c[1]), d, t0, t1, w: hw, over}};
    };
    // hangs along the body: almost straight, the elbow slightly back and out; swings back and forth with the step
    const hangT = (abd: number, fwd: number): V3 => v3.add(S, v3.mul(dirOf(s, abd, fwd), (ARM_L1 + ARM_L2) * 0.985));
    const hangPole: V3 = [s * 0.45, 0.1, -zb];
    const swingF = zb * 0.3 * sideSwing;
    /** An arm set in the frame plane: an arm reads on a flat frame, so its shape is given by points in the frame — elbow E2 and wrist W2
     *  — and the depths follow from the constant lengths (ez — the sign of the elbow depth: +1 — the figure's forward, −1 — back; wz — the
     *  same for the wrist relative to the elbow). The upper arm and the forearm show with the lengths the points give (no foreshortened
     *  stump), the elbow stays where it was put (at the side, not out like a wing). A point beyond a segment length is pulled in to it.
     *  Returns the IK target and pole that make ik3 give exactly this elbow. */
    const byPlane = (E2: Pt, W2: Pt, ez = 1, wz = 1): {T: V3; pole: V3; E: V3} => {
      let ex = E2[0] - S[0];
      let ey = E2[1] - S[1];
      const d = Math.min(ARM_L1 * 0.995, Math.hypot(ex, ey));
      const d0 = Math.hypot(ex, ey) || 1;
      ex *= d / d0;
      ey *= d / d0;
      const E: V3 = [S[0] + ex, S[1] + ey, S[2] + zb * ez * Math.sqrt(Math.max(0, ARM_L1 * ARM_L1 - d * d))];
      let wx = W2[0] - E[0];
      let wy = W2[1] - E[1];
      const l = Math.min(ARM_L2 * 0.995, Math.hypot(wx, wy));
      const l0 = Math.hypot(wx, wy) || 1;
      wx *= l / l0;
      wy *= l / l0;
      const T: V3 = [E[0] + wx, E[1] + wy, E[2] + zb * wz * Math.sqrt(Math.max(0, ARM_L2 * ARM_L2 - l * l))];
      return {T, pole: v3.norm(v3.sub(E, S)), E}; // a unit pole: poses blend by it (gesture entry), like the other poles
    };
    /** Elbow at the side at waist height, at most 24 units beyond the chest silhouette (not out like a wing): the support of an arm that
     *  holds a prop in front. */
    const waistElbow = (out = 18, y = -588): Pt => [s * (cx0 * w + out), y];
    // "pushes a door" from behind without a reach point: the arm goes from the side forward to the leaf at waist height, the elbow out,
    // the hand (with its prop, if any) lies on the leaf; the IK target and pole blend from the hanging arm over the gesture
    const g = dry ? undefined : p.gest;
    const pushK = g?.pose === 'push' && back && !p.reach && idx === (gIdx >= 0 ? gIdx : pushIdx) ? g.k : 0;
    const mixV = (a: V3, b: V3, q: number): V3 => [lerp(a[0], b[0], q), lerp(a[1], b[1], q), lerp(a[2], b[2], q)];
    const pushT = (h: V3): V3 => (pushK > 0 ? mixV(h, PUSH_T(s), pushK) : h);
    const pushPole: V3 = pushK > 0 ? mixV(hangPole, PUSH_POLE(s), pushK) : hangPole;
    const pushLog: Partial<ArmLog> = pushK > 0.2 ? {allowFore: 'pushes a door away: forearm forward and out'} : {};
    // running: the arm is bent at the elbow and the fist swings at the waist, forward (higher, in front of the chest towards the middle)
    // and back (behind the hip); the elbow goes back — not hands on hips
    const runArm = (): {T: V3; pole: V3} => {
      const a = (sideSwing + 1) / 2;
      // facing the camera the arm is set in the frame plane: the elbow at the side slightly back, the fist goes from the hip (back) to the
      // chest at the middle of the body (forward), the forearm keeps at least 60 % of its length in the frame (a fist swung towards the
      // viewer would be a hand without an arm)
      if (!back) {
        // the forearm turns around the elbow in the frame, through the side to the middle of the body: a straight wrist path would pass
        // the elbow and shorten the forearm to a third of its length in the middle of the swing
        const E2: Pt = [s * (cx0 * w + lerp(20, 14, a)), lerp(-596, -616, a)];
        const th = Math.atan2(0.87, s * 0.5) + s * a * 2.5; // back — the fist at the hip to the side (elbow bent), forward — at the chest
        const W2: Pt = [E2[0] + Math.cos(th) * 0.76 * ARM_L2, E2[1] + Math.sin(th) * 0.76 * ARM_L2];
        const pl = byPlane(E2, W2, -1, 1);
        return {T: pl.T, pole: pl.pole};
      }
      return {T: [s * lerp(104, 50, a), lerp(-556, -636, a), zb * lerp(-44, 118, a)], pole: [s * 0.25, 0.25, -zb]};
    };

    // ---------- arm gesture: pull, push (facing; from behind — with a reach point), rail, count ----------
    // Entry and exit follow the event hold k: the wrist target and the elbow pole go from the hanging arm to the gesture pose with constant
    // lengths. With a reach point the hand puts its grip point (a fist on the handle, a palm on the leaf, fingers on the rail) at reach;
    // the target depth comes from the arm length (the arm almost straight to the handle) and is small at the rail. A prop in the fist (a
    // torch, keys) stays in the hand.
    // An arm busy with a prop in front or with a bag (a folder, a phone, a cup, a box, a bag) does not make a gesture: its pose is the grip,
    // and the path of a gesture starts from a hanging arm — the arm would jump down and the prop would vanish (the pose sweep: "the wrist
    // jumps by 200 units"). A gesture is made by a free arm or by an arm with a prop in the fist (a torch, keys). From behind what is held
    // in front is hidden by the body: such an arm makes the gesture, its motion starts from the pose of the grip (a trial pass), not from a
    // hanging arm
    const free = ['none', 'count', 'stamp', 'flashlight', 'keys'].includes(hold);
    const hidden = back && !['bag', 'tote', 'mop', 'mopRaised'].includes(hold);
    const busy = !free && !hidden;
    const gk = g && idx === gIdx && !busy && g.k > 0.001 && ((g.pose === 'count' && !back) || (REACH_POSES.includes(g.pose) && !(g.pose === 'push' && back && !p.reach))) ? g.k : 0;
    if (g && gk > 0) {
      const restT = run ? runArm().T : hangT(0.09, swingF + 0.03);
      const restPole = run ? runArm().pole : hangPole;
      const restView: HandView = back ? 'ulnar' : 'radial';
      const fistItem = ['flashlight', 'keys', 'stamp'].includes(hold);
      let Tg: V3;
      let poleG: V3;
      let shape: HandShape;
      let view: HandView;
      let q = 0;
      let dir: Pt | undefined;
      let aim: Pt | undefined;
      let gripL: Pt | undefined;
      let note: string;
      let reachW = 1; // a point beyond the arm and hand length: the hand lets go of it smoothly instead of reaching for it like a stick
      let plane: [Pt, Pt] | null = null; // gesture pose set in the frame plane (elbow, wrist): entry and exit go in the frame too
      let planeOut = false; // during the motion the forearm turns through the side away from the body (outwards), not towards the middle
      let palmIn = false; // grip press: the palm faces the sheet on a wall beside the figure — away from the viewer (facing), not towards
      if (g.pose === 'count') {
        // counts on fingers: the palm towards the viewer, the fingers up, they unfold one by one over the event (n — how many, default 4).
        // The arm is set in the frame plane: the elbow at the side slightly above the waist and slightly out, the hand above the shoulder
        // joint at shoulder height, so the upper arm and the forearm form a V in the frame (both visible, the elbow bent by about 70°) and
        // the palm faces the viewer within a natural turn. A hand in front of the chest with the palm to the viewer would need a turn over
        // 100°; a hand straight above the elbow would hide the upper arm behind the forearm, and the arm would read as one stick
        plane = [[S[0] + s * 32, -620], [S[0] + s * 9, -738]];
        // the forearm rises in front of the body, through its middle (not through the side: on the way the arm stuck out sideways like a
        // wing); the hand view on the way is within a natural turn (liveView): the back of the hand while the forearm is across the body,
        // the palm when it has risen
        planeOut = false;
        ({T: Tg, pole: poleG} = byPlane(plane[0], plane[1]));
        shape = 'count';
        view = 'palmar';
        dir = [-s * 0.06, -1];
        q = Math.max(1, Math.min(4, Math.round(g.n ?? 4))) * clamp(g.ph / 0.88);
        note = 'counts on fingers: forearm towards the viewer';
      } else {
        // the default point (the kit gave none) — to the side of the body within the reach of an arm with a natural wrist (at 150 units
        // from the middle it was nearer than a hand length from the shoulder: the arm folded and the hand twisted to the point)
        const def: Pt = g.pose === 'rail' ? [s * 168, -560] : [s * 205, back ? -610 : -630];
        aim = p.reach ?? def;
        // push with grip press / point: facing, a palm on a sheet at a wall beside the figure shows the edge of the hand to the viewer (a
        // palm towards the viewer there reads as "please"); the tip of the index finger goes on a line or a button (a flat palm on a line
        // reads as "stop")
        const gPress = g.pose === 'push' && g.grip === 'press' && !fistItem;
        const gPoint = g.pose === 'push' && g.grip === 'point' && !fistItem && !!p.reach; // a finger only on a kit point
        palmIn = gPress;
        shape = fistItem || g.pose === 'pull' || (g.pose === 'push' && g.grip === 'fist') ? 'fist' : g.pose === 'rail' ? 'rail' : gPoint ? 'point' : 'flat';
        // a finger from behind is seen from the side (the natural view of an arm reaching forward: the right hand from the thumb side, the
        // left one from the little finger side), facing — from the palm (the hand enters and leaves in this view: the back of the hand in
        // the hold turned the hand over on the exit)
        view = shape === 'fist' ? restView : gPoint ? (back ? (s > 0 ? 'radial' : 'ulnar') : 'palmar') : shape === 'rail' || back ? 'dorsal' : gPress ? 'radial' : 'palmar';
        gripL = shape === 'fist' ? HAND_GRIP.fist!.grip : shape === 'rail' ? HAND_GRIP.rail!.grip : shape === 'point' ? pointTip(view) : [0, 36];
        if (shape === 'rail') q = g.ph * (g.dur ?? 2) * 1.5; // fingers tap: 1.5 cycles per second (6 touches)
        // the arm reaches the target almost in the frame plane (a small depth): a forearm foreshortened towards the viewer is a stump,
        // and the hand on it spins from a small shift. The hand continues the arm along the line shoulder → target (a palm on the leaf
        // is bent upwards); from behind, for a point in front of the body the arm goes forward and deeper instead of bending the elbow
        // up to the shoulder
        const zMax = g.pose === 'rail' ? 50 : back ? 160 : 70;
        const d2 = Math.hypot(aim[0] - S[0], aim[1] - S[1]);
        reachW = clamp((ARM_L1 + ARM_L2 + 36 - d2) / 40);
        const T0: V3 = [aim[0], aim[1], zb * Math.min(zMax, Math.sqrt(Math.max(0, (0.95 * (ARM_L1 + ARM_L2)) ** 2 - d2 * d2)))];
        Tg = T0;
        // the elbow down and back, not out to the side ("wing")
        poleG = g.pose === 'rail' ? [s * 0.7, 0.35, -zb * 0.6] : back ? [s * 0.3, 0.85, -zb * 0.45] : [s * 0.18, 0.85, -zb * 0.5];
        // a rail from behind near the body (a point below the shoulder, 110–240 units from it): the arm is longer than the way to the point,
        // and the elbow had to go far out like a wing. The arm is set in the frame: the hand lies on the rail diagonally towards the body,
        // the forearm steeper, almost vertical (a wrist bend towards the little finger up to 38°), the elbow back towards the viewer and only
        // slightly out; the upper arm and the forearm are shorter in the frame (foreshortened) but visible: the forearm at least 0.56 of its
        // length
        if (g.pose === 'rail' && back && d2 > 110 && d2 < 240 && aim[1] - S[1] > 100 && (aim[0] - S[0]) * s > -70) {
          const near = clamp((300 - d2) / 150);
          const b0 = Math.atan2(-(aim[0] - S[0]) * s, aim[1] - S[1]); // the direction shoulder → point from the vertical, + towards the body
          const th = b0 + (52 * Math.PI / 180) * near; // the hand
          const al = th - (36 * Math.PI / 180) * near; // the forearm
          const gl = Math.hypot(gripL[0], gripL[1]) * handK;
          const fh: Pt = [-s * Math.sin(th), Math.cos(th)];
          const W2: Pt = [aim[0] - fh[0] * gl, aim[1] - fh[1] * gl];
          const lf = ARM_L2 * lerp(0.58, 0.95, clamp((d2 - 150) / 150));
          const E2: Pt = [W2[0] + s * Math.sin(al) * lf, W2[1] - Math.cos(al) * lf];
          ({T: Tg, pole: poleG} = byPlane(E2, W2, -1, 1));
          dir = fh;
        }
        if (shape !== 'rail') {
          // the hand continues the forearm if the forearm shows at least 20 % of its length in the frame; a shorter one is almost a point,
          // and the hand goes along the line shoulder → target instead (otherwise it would spin from a small shift)
          const r0 = solve(Tg, poleG, view, shape, {q, fixed: true});
          const fl = Math.hypot(r0.W[0] - r0.E[0], r0.W[1] - r0.E[1]);
          const ar = fl >= 0.2 * ARM_L2 ? unit([r0.E[0], r0.E[1]], [r0.W[0], r0.W[1]]) : unit([S[0], S[1]], aim);
          const up = shape === 'flat' && back ? s * 0.3 : 0; // from behind a palm on the leaf has its fingers slightly up; facing — along the arm (a bend towards the thumb is natural only up to 25°)
          dir = [ar[0] * Math.cos(up) - ar[1] * Math.sin(up), ar[0] * Math.sin(up) + ar[1] * Math.cos(up)];
        }
        for (let it = 0; it < 8; it++) {
          const g1 = solve(Tg, poleG, view, shape, {q, dir, fixed: true}).h.at(gripL[0], gripL[1]);
          Tg = [Tg[0] + aim[0] - g1[0], Tg[1] + aim[1] - g1[1], Tg[2]];
        }
        // a check of the solution: the hand must continue the forearm and lie on the point. If the pose needs a broken wrist (the engine
        // does not break it — the hand leaves the point) or the point is not reached, the arm is solved anew: the hand goes along the forearm
        // line (along the line shoulder → target while the forearm is almost a point in the frame), the target is brought in by damped
        // steps; the best approximation is taken
        {
          const chk = solve(Tg, poleG, view, shape, {q, dir, fixed: true});
          const gc = chk.h.at(gripL[0], gripL[1]);
          if (chk.wristCut > 0.5 || Math.hypot(aim[0] - gc[0], aim[1] - gc[1]) > 1.5) {
            const up = shape === 'flat' && back ? s * 0.3 : 0;
            const sa = unit([S[0], S[1]], aim);
            const follow = (E: V3, W: V3): Pt => {
              const fl = Math.hypot(W[0] - E[0], W[1] - E[1]);
              const wk = clamp((fl / ARM_L2 - 0.15) / 0.25);
              const fa = fl > 1 ? unit([E[0], E[1]], [W[0], W[1]]) : sa;
              const b = unit([0, 0], [fa[0] * wk + sa[0] * (1 - wk), fa[1] * wk + sa[1] * (1 - wk)]);
              return [b[0] * Math.cos(up) - b[1] * Math.sin(up), b[0] * Math.sin(up) + b[1] * Math.cos(up)];
            };
            let T1 = T0;
            let d1: Pt = follow([S[0], S[1], 0], [aim[0], aim[1], 0]);
            let best = Infinity;
            for (let it = 0; it < 16; it++) {
              const r1 = solve(T1, poleG, view, shape, {q, dir: d1, fixed: true});
              const g1 = r1.h.at(gripL[0], gripL[1]);
              const err = Math.hypot(aim[0] - g1[0], aim[1] - g1[1]) + 2 * r1.wristCut;
              if (err < best) {
                best = err;
                Tg = T1;
                dir = d1;
              }
              if (err < 0.4) break;
              const nd = follow(r1.E, r1.W);
              d1 = unit([0, 0], [d1[0] * 0.4 + nd[0] * 0.6, d1[1] * 0.4 + nd[1] * 0.6]);
              T1 = [T1[0] + (aim[0] - g1[0]) * 0.8, T1[1] + (aim[1] - g1[1]) * 0.8, T1[2]];
            }
          }
        }
        // a fingertip (grip point): the hand view is the natural turn (liveView) of the arm already brought to the point, then the tip is
        // fitted to that view, and the same view is drawn (fixed) — otherwise the natural turn wavers between the back of the hand and the
        // edge, and the tip leaves the point by the width of the hand (the journal: "hand not touching" by 25–33 units; "palm twisted" by
        // 138° with a view chosen in advance)
        if (gPoint && aim) {
          for (let pass = 0; pass < 3; pass++) {
            const v1 = solve(Tg, poleG, view, shape, {q, dir}).h.view; // the palm by the neutral of the arm (not the palm to the target)
            if (v1 === view) break;
            view = v1;
            gripL = pointTip(view);
            for (let it = 0; it < 8; it++) {
              const g1 = solve(Tg, poleG, view, shape, {q, dir, fixed: true}).h.at(gripL[0], gripL[1]);
              Tg = [Tg[0] + aim[0] - g1[0], Tg[1] + aim[1] - g1[1], Tg[2]];
            }
          }
        }
        note = g.pose === 'pull' ? 'pulls a door: arm to the handle foreshortened' : g.pose === 'push' ? 'pushes a door away: arm to the leaf foreshortened' : 'hand on the rail';
      }
      const gw = gk * reachW;
      // the hand shape goes over by the joints (the fingers bend and unbend with the motion of the arm); the view — the one of the pose from
      // the middle of the motion, before that — the view of the hanging arm; whatever view is asked for, a free hand is drawn within a
      // natural turn (solve → liveView)
      const on = gw > 0.45;
      const dirK = clamp((gw - 0.2) / 0.6);
      // a palm on a door leaf faces the target (away from the shoulder), on a sheet pressed to a wall (grip press) — the wall; on a rail —
      // down; a fist on a handle has the thumb up and the palm towards the middle of the body
      const palmG: V3 | undefined = shape === 'rail' ? [0, 1, 0] : shape === 'flat' && aim ? v3.norm([aim[0] - S[0], aim[1] - S[1], (palmIn ? -zb : zb) * 60]) : shape === 'fist' ? v3.norm([-s, 0.25, 0]) : undefined;
      const restShape: HandShape = fistItem || run ? 'fist' : 'relaxed';
      const mixK = clamp((gw - 0.12) / 0.6);
      let mix: HandMix | undefined = isRig(shape) && shape !== restShape && mixK < 1 ? {shape: restShape, k: mixK * mixK * (3 - 2 * mixK)} : undefined;
      let drawShape: HandShape = mixK > 0 ? shape : restShape;
      // a finger (grip point) comes out of a fist: a hanging hand → a fist → the index finger unbends. Straight from a hanging hand the
      // index and the middle finger parted on the way with a notch between them ("fingers apart")
      if (shape === 'point' && restShape !== 'fist') {
        const k1 = clamp((gw - 0.12) / 0.33), k2 = clamp((gw - 0.45) / 0.4);
        const sm = (x: number) => x * x * (3 - 2 * x);
        if (k2 > 0) {
          drawShape = 'point';
          mix = k2 < 1 ? {shape: 'fist', k: sm(k2)} : undefined;
        } else if (k1 > 0) {
          drawShape = 'fist';
          mix = k1 < 1 ? {shape: restShape, k: sm(k1)} : undefined;
        } else {
          drawShape = restShape;
          mix = undefined;
        }
      }
      // the motion of a gesture turns the arm segments IN THE FRAME: the upper arm and the forearm turn from the pose of the arm to the pose
      // of the gesture each along its own arc in the frame, the visible length of a segment goes from the start one to the end one (a segment
      // on the way does not point "at the viewer" — the hand is not left without an arm), the depth comes from the constant length. The
      // elbow neither folds nor jumps. Blending the wrist targets and the elbow poles made the wrist path from the hip to a high point pass
      // the shoulder: on the way the arm folded and the elbow jumped (the pose sweep: up to 120 units a frame). A segment that has to turn
      // almost backwards (count: the forearm from "down" to "up") goes through side viaX: towards the middle of the body or where it points
      // in the pose of the gesture — not outwards like a wing
      const swing = (a: V3, b: V3, viaX: number, t: number): V3 => {
        const la = Math.hypot(a[0], a[1]);
        const lb = Math.hypot(b[0], b[1]);
        const aa = la > 0.05 ? Math.atan2(a[1], a[0]) : Math.atan2(b[1], b[0]);
        const ab = lb > 0.05 ? Math.atan2(b[1], b[0]) : aa;
        let da = ab - aa;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        if (viaX && Math.abs(da) > 2.3 && Math.cos(aa + da / 2) * viaX < 0) da -= Math.sign(da) * 2 * Math.PI;
        const ang = aa + da * t;
        const l = lerp(la, lb, t);
        const z = (Math.sign(t < 0.5 ? a[2] : b[2]) || 1) * Math.sqrt(Math.max(0, 1 - l * l));
        return [Math.cos(ang) * l, Math.sin(ang) * l, z];
      };
      const moving = gw < 0.999;
      let Tm = mixV(restT, Tg, gw);
      let Pm = mixV(restPole, poleG, gw);
      let EWm: {E: V3; W: V3} | null = null;
      if (moving) {
        const rest = (!free ? armOf(idx, true) : null) ?? ik3(S, restT, restPole);
        const fin = solve(Tg, poleG, view, shape, {q, dir, fixed: true, keep: run});
        const fg = v3.norm(v3.sub(fin.W, fin.E));
        // the side the forearm turns through: the one it points to in the pose of the gesture (a point outside — through the side out); a
        // forearm pointing almost straight up (count) — towards the middle of the body
        const viaX = Math.abs(fg[0]) > 0.25 ? Math.sign(fg[0]) : -s;
        const viaF: V3 = v3.norm([viaX, 0.12, zb * 0.15]);
        const u = swing(v3.norm(v3.sub(rest.E, S)), v3.norm(v3.sub(fin.E, S)), 0, gw); // the upper arm — along the shortest arc
        const fo = swing(v3.norm(v3.sub(rest.W, rest.E)), fg, viaX, gw);
        // on the way the elbow does not fold more than a living one: the forearm is moved away from the upper arm up to ELBOW_MIN
        const back1 = v3.mul(u, -1);
        const ca = clamp(v3.dot(back1, fo), -1, 1);
        const lim = (ELBOW_MIN + 2) * (Math.PI / 180);
        let fo1 = fo;
        if (Math.acos(ca) < lim) {
          let perp = v3.sub(fo, v3.mul(back1, ca));
          if (v3.len(perp) < 1e-3) perp = v3.sub(viaF, v3.mul(back1, v3.dot(viaF, back1)));
          fo1 = v3.norm(v3.add(v3.mul(back1, Math.cos(lim)), v3.mul(v3.norm(perp), Math.sin(lim))));
        }
        const Em = v3.add(S, v3.mul(u, ARM_L1));
        EWm = {E: Em, W: v3.add(Em, v3.mul(fo1, ARM_L2))};
        Pm = u;
      }
      if (plane && !moving) {
        // the elbow goes in the frame from the hanging arm to the pose; the forearm turns around it through the side to the middle of the
        // body (not towards the viewer, where it would be shorter than half in the middle of the motion), its length in the frame between
        // the lengths at the ends
        const rest = ik3(S, restT, restPole);
        const Er = pr(rest.E);
        const Wr = pr(rest.W);
        const Em: Pt = [lerp(Er[0], plane[0][0], gw), lerp(Er[1], plane[0][1], gw)];
        const aR = Math.atan2(Wr[1] - Er[1], Wr[0] - Er[0]);
        const aP = Math.atan2(plane[1][1] - plane[0][1], plane[1][0] - plane[0][0]);
        let da = aP - aR;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        if ((Math.cos(aR + da / 2) * s > 0) !== planeOut) da -= Math.sign(da) * 2 * Math.PI;
        const lm = lerp(Math.hypot(Wr[0] - Er[0], Wr[1] - Er[1]), Math.hypot(plane[1][0] - plane[0][0], plane[1][1] - plane[0][1]), gw);
        const am = aR + da * gw;
        // the hand keeps its pose angle to the forearm over the whole motion (otherwise it would look up at the entry while the
        // forearm is still sideways)
        if (dir) {
          let off = Math.atan2(dir[1], dir[0]) - aP;
          while (off > Math.PI) off -= 2 * Math.PI;
          while (off < -Math.PI) off += 2 * Math.PI;
          dir = [Math.cos(am + off), Math.sin(am + off)];
        }
        const Wm: Pt = [Em[0] + Math.cos(am) * lm, Em[1] + Math.sin(am) * lm];
        // a hand in front of the body keeps the elbow at the side (the running pose starts with the elbow back and out)
        if (Math.abs(Wm[0]) < cx0 * w && s * Em[0] > cx0 * w + 24) {
          const ex = s * (cx0 * w + 24) - Em[0];
          Em[0] += ex;
          Wm[0] += ex;
        }
        ({T: Tm, pole: Pm} = byPlane(Em, Wm));
      }
      // while the forearm goes across the body in the frame, the back of the hand faces the viewer (a natural turn), not the edge
      // of a hanging hand
      const midView: HandView = plane && gw > 0.12 ? (planeOut ? 'palmar' : 'dorsal') : restView;
      // the hand view — the one of the pose while its palm is not twisted (a pose with a point has its own palm normal: towards the target,
      // down onto the rail); otherwise the nearest natural one (solve → liveView). The hand direction goes from the forearm line to the
      // direction of the pose over the motion (dirK). A fingertip (grip point) at the point (gw > 0.98, as the grip goes to the journal)
      // keeps the view fitted to the point above; on the way — the natural turn (fixed on the way twisted the palm by 131°)
      const hopt: SolveOpt = {q, dir, dirK: dirK * dirK * (3 - 2 * dirK), bend: (back ? -0.1 : 0.1) * (1 - dirK), keep: run, from: mix, palm: on ? palmG : undefined, wk: clamp((gw - 0.6) / 0.4),
        fixed: gw > 0.98 && shape === 'point' ? true : undefined};
      const r = EWm ? place(EWm.E, EWm.W, Pm, on ? view : midView, drawShape, hopt) : solve(Tm, Pm, on ? view : midView, drawShape, hopt);
      let item: Layer | null = null;
      if (fistItem && r.h.shape === 'fist') {
        item = hold === 'flashlight' ? prop({kind: 'flashlight', at: fistAt(r.h).G, axis: fistAt(r.h).ax, len: back ? 1.15 : 1.3})
          : prop({kind: 'hang', what: hold as Hang, at: r.h.at(7, 44), swing: 0});
      }
      push([arm(S, r.E, r.W), item, front(r.h)]);
      // the palm normal of the pose — into the journal, if the hand is drawn in the view of the pose (not brought to another one)
      const palmN: V3 | undefined = on && r.h.view === view ? palmG : undefined;
      const flG = hold === 'flashlight' && r.h.shape === 'fist' && !r.h.from ? itemLog(r.h, fistAt(r.h).ax, -40 * (back ? 1.15 : 1.3), 52 * (back ? 1.15 : 1.3), 12, true) : {};
      log(r, {...(on && gripL && aim && gw > 0.98 ? {grip: r.h.at(gripL[0], gripL[1]), target: aim} : {}), allowFore: note, pose: g.pose, ...(palmN ? {palm: palmN} : {}), ...(moving ? {moving: true} : {}), ...flG});
      return dryEW;
    }

    // ---------- a mop: the same pose facing the camera and from behind ----------
    // mop — the mop in a lowered hand: the rag stands on the floor by the foot, the handle goes through the fist slanted to the shoulder and
    // lies over the sleeve at the shoulder (in a close-up the handle is at the shoulder, not a separate stick). mopRaised — raised over the
    // head without hits (waits for an answer: the end pose of knock). The knock gesture: the arm raises the mop (entry by the event hold,
    // "in"), the handle jabs straight up n times (default 3) every 0.27 s, the first hit 0.5 s after the event start; between the hits the
    // arm bends, on a hit it straightens. Constant arm lengths (IK); the handle has a constant length and passes through the centre of the
    // fist; order — the arm, the mop, the fingers of the fist on top
    if (MOP.includes(hold)) {
      const kg = g && g.pose === 'knock' && idx === gIdx ? g : null;
      const up = hold === 'mopRaised' ? 1 : kg ? kg.k : 0;
      let jab = 0;
      if (kg) {
        const tt = kg.ph * (kg.dur ?? 2);
        const n = Math.max(1, Math.round(kg.n ?? 3));
        for (let i = 0; i < n; i++) {
          const x = (tt - 0.5 - i * 0.27) / 0.12;
          if (x > -1 && x < 1) jab = Math.max(jab, 0.5 + 0.5 * Math.cos(Math.PI * x));
        }
      }
      if (up > 0) S = [S[0] + s * 4 * up, S[1] - 14 * up, S[2]]; // a raised arm raises the shoulder joint: the sleeve comes out of the shoulder
      const upT: V3 = v3.add(S, v3.mul(v3.norm([s * 0.3, -1, zb * 0.12]), (ARM_L1 + ARM_L2) * (0.8 + 0.17 * jab)));
      const T = mixV(hangT(0.15, 0.12 + swingF * 0.5), upT, up);
      const pole = v3.norm(mixV(hangPole, [s * 0.75, 0.25, -zb * 0.45], up));
      const r = solve(T, pole, back ? 'ulnar' : 'radial', 'fist', up > 0.02 ? {keep: true} : {});
      const G = r.h.at(7, 27);
      // lowered: the handle goes from the fist to the outside of the shoulder joint, its bottom at the rag height above the floor; raised —
      // straight up, the fist 330 units below the top
      const du0 = unit(G, [S[0] + s * 14, S[1] - 60]);
      const lb = Math.max(60, (G[1] + MOP_RAG) / Math.min(-0.2, du0[1]));
      const B0: Pt = [G[0] - du0[0] * lb, G[1] - du0[1] * lb];
      const B1: Pt = [G[0], G[1] + (MOP_LEN - 330)];
      const B: Pt = [lerp(B0[0], B1[0], up), lerp(B0[1], B1[1], up)];
      const du = unit(B, G);
      const top: Pt = [B[0] + du[0] * MOP_LEN, B[1] + du[1] * MOP_LEN];
      // layers: a lowered mop stands in front of the arm — the handle lies over the sleeve at the shoulder and goes under the fingers of the
      // fist. A raised one — the handle behind the arm: over the forearm it went as a strip along the sleeve and read "through the arm"; it
      // comes out of the fist behind the fingers, below the fist the forearm covers it. On the way up the front handle fades (over the first
      // 40 % of the motion) instead of vanishing at once
      const staffFront = clamp(1 - up * 2.5);
      const mopItem: Item = {kind: 'mop', base: B, top, rag: MOP_RAG, spread: 1 - up};
      push([prop(mopItem), arm(S, r.E, r.W), staffFront > 0.01 ? prop(mopItem, +staffFront.toFixed(1)) : null, front(r.h)]);
      const gb = Math.hypot(G[0] - B[0], G[1] - B[1]);
      log(r, {grip: G, target: G, ...itemLog(r.h, du, -gb, MOP_LEN - gb, 8, staffFront > 0.5), ...(up > 0.02 && up < 0.98 ? {itemMoving: true} : {}),
        layers: up > 0.4 ? 'mop → arm → the fist on the handle' : 'arm → mop → the fingers of the fist on the handle', ...(up > 0.2 ? {allowFore: 'raises the mop over the head: the arm up'} : {})});
      return dryEW;
    }

    // ---------- from behind ----------
    if (back) {
      const sideItems = ['keys', 'bag', 'tote', 'flashlight'];
      if (sideItems.includes(hold)) {
        // a prop at the side in a lowered hand, seen from the little finger side: a bag handle lies in the bent fingers (hook); a torch
        // and keys are in a fist — the torch passes through it, keys hang from it
        const hook = hold === 'bag' || hold === 'tote';
        const bagI = hold === 'bag' || hold === 'tote';
        const r = solve(pushT(hangT(bagI ? 0.2 : 0.14, swingF * (run ? 1.3 : 0.6) - 0.1)), pushPole, 'ulnar', hook ? 'hook' : 'fist');
        const G = hook ? r.h.at(-1, 50) : r.h.at(7, 27);
        const Gb = r.h.at(7, 44); // bottom of the fist
        let item: Layer;
        let target: Pt = G;
        if (hold === 'flashlight') {
          item = prop({kind: 'flashlight', at: fistAt(r.h).G, axis: fistAt(r.h).ax, len: 1.15});
        } else {
          // keys hang from the bottom of the fist, a bag handle lies in the hooked fingers; when running the bag swings on it
          target = bagI ? G : Gb;
          item = prop({kind: 'hang', what: hold as Hang, at: target, swing: run && bagI ? -16 * sideSwing : 0, strap: look.bagStrap});
        }
        // from behind the bag hangs at the side by the arm, over the leg: the hand is drawn over the handle
        push([arm(S, r.E, r.W), item, front(r.h)]);
        log(r, {grip: target === Gb ? Gb : G, target, ...pushLog, ...(hold === 'flashlight' ? itemLog(r.h, fistAt(r.h).ax, -40 * 1.15, 52 * 1.15, 12, true) : {})});
        return dryEW;
      }
      if (hold === 'none' || hold === 'count' || hold === 'stamp') {
        const ra = runArm();
        const r = run && pushK <= 0 ? solve(ra.T, ra.pole, 'ulnar', 'fist') : solve(pushT(hangT(0.09, swingF + 0.02)), pushPole, 'ulnar', 'relaxed', {bend: -0.1});
        push([arm(S, r.E, r.W), front(r.h)]);
        log(r, pushK > 0.2 ? pushLog : run ? {allowFore: 'running: fist forward away from the viewer'} : {hangRef: thighMid});
        return dryEW;
      }
      if (hold === 'reach' && p.reach) {
        // from behind the palm is on the kit point (the spine of a folder on a shelf, moved by a kit event): the arm from the shoulder to
        // the point is almost straight forward, the back of the hand towards the viewer, the middle of the palm at the point. Without a
        // point — the pose "the arm forward and up" below (the palm would hang above the target and read as a wave). The arm is set in the
        // frame (production rule 4d): the upper arm and the forearm keep at least 0.85 of their length in the frame, the elbow below the
        // line shoulder → hand, the depths follow from the lengths
        const d0 = unit([S[0], S[1]], p.reach);
        const hl = HAND_LEN.relaxed * handK;
        const W2: Pt = [p.reach[0] - d0[0] * hl * 0.45, p.reach[1] - d0[1] * hl * 0.45];
        const dd = Math.hypot(W2[0] - S[0], W2[1] - S[1]) || 1;
        const q = Math.max(1, (dd * 1.02) / ((ARM_L1 + ARM_L2) * 0.85)); // a far point stretches both segments in the frame
        const l1 = ARM_L1 * 0.85 * q;
        const l2 = ARM_L2 * 0.85 * q;
        const ua: Pt = [(W2[0] - S[0]) / dd, (W2[1] - S[1]) / dd];
        const nd: Pt = ua[0] >= 0 ? [-ua[1], ua[0]] : [ua[1], -ua[0]]; // across the arm — downwards: the elbow below the line
        const aa = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
        const hh = Math.sqrt(Math.max(0, l1 * l1 - aa * aa));
        const pl = byPlane([S[0] + ua[0] * aa + nd[0] * hh, S[1] + ua[1] * aa + nd[1] * hh], W2);
        const r = solve(pl.T, pl.pole, 'dorsal', 'relaxed', {keep: true});
        push([arm(S, r.E, r.W), front(r.h)]);
        log(r, {grip: p.reach, target: p.reach, layers: 'from behind: the arm to the point, the palm on it'});
        return dryEW;
      }
      // what is held in front (a folder, a phone, a cup, a box, a pen, a load) is hidden by the body from behind. The arm does not end at
      // the waist as a stump: the elbow is away from the side, the forearm shows from the elbow to the edge of the back and goes behind the
      // torso almost horizontally, and the sleeve is drawn as one L-shaped piece, so the arm reads as bent with the hand in front
      const Tf: V3 = hold === 'phoneEar' ? [s * 84, -786, -84] : hold === 'point' || hold === 'reach' ? [s * 230, -930, -40] : [s * 20, -608, -150];
      const poleB: V3 = hold === 'phoneEar' ? [s * 0.3, 0.55, 0.6] : hold === 'point' || hold === 'reach' ? [s * 0.6, 0.55, 0.55] : [s * 0.814, 0.568, 0.119];
      const vis = hold === 'point' || hold === 'reach' || hold === 'phoneEar';
      const r = solve(Tf, poleB, 'dorsal', 'relaxed', {fixed: !vis}); // a hand behind the body is not seen — no view is chosen for it
      push([arm(S, r.E, r.W, 'full', !vis), vis ? front(r.h) : null]); // the forearm goes behind the torso — the body covers its end
      log(r, {hidden: vis ? undefined : 'fore', hideHand: !vis, wristHidden: vis ? undefined : 'from behind the hand is behind the body'});
      return dryEW;
    }

    // ---------- from the front ----------
    switch (hold) {
      case 'rest': {
        // sits at a table, forearms on the table: the elbow at the side below the chest, the forearm goes up to the middle of the
        // body in the frame (at least 0.72 of its length visible), the hand continues it with its back up; the table covers
        // everything below its edge
        const pl = byPlane(waistElbow(16, -538), [s * 8, -568]); // the forearm keeps 0.72 of its length, so the elbow is not moved out (on slim roles it would stick out)
        const r = solve(pl.T, pl.pole, 'dorsal', 'relaxed');
        push([arm(S, r.E, r.W), front(r.h)]);
        log(r, {torsoX: cx0 * w, layers: 'forearm on the table → hand with its back up'});
        return dryEW;
      }
      case 'folder': {
        // the folder is held by its near edge, and the arm is one visible chain: the upper arm along the side, the elbow at the waist, the
        // forearm diagonally up to the near edge (at least 0.7 of its length visible) and drawn over the folder; the hand lies with its back
        // on the cover at the edge, fingers up and in, the thumb behind the folder (the edge in the fork of the thumb and the index finger).
        // A frightened figure (Face.clutch) holds the folder higher; with a pen in the other hand the folder moves towards the holding hand
        // and the hand goes along the edge (the writing hand needs the far edge of the sheet)
        const F: Pt = pair === 'pen' ? [s * 6, -682] : [-s * lerp(4, 8, cl), lerp(-680, -702, cl)];
        const W2: Pt = [F[0] + s * 66, F[1] + 20];
        const pl = byPlane(waistElbow(20), W2);
        // when the other hand is also in front of the folder (a pen, a phone), the fingers go up along the edge and leave the middle free
        // for it (two hands in one place would read as holding the phone with both hands); otherwise the fingers lie across the cover
        const r = solve(pl.T, pl.pole, 'dorsal', 'phone', {bend: ['pen', 'phone', 'cup'].includes(pair) ? 0.3 : 0.05});
        folderF = F;
        push([behind(r.h), prop({kind: 'folder', at: F, rot: -s * 2}), arm(S, r.E, r.W), front(r.h)]);
        const G = r.h.at(0, 30);
        log(r, {grip: G, target: G, torsoX: cx0 * w, layers: 'thumb behind the folder → folder → arm → hand with its back on the cover at the edge'});
        return dryEW;
      }
      case 'flashlight': {
        // a torch in a lowered hand: a fist seen from the thumb side, the bent fingers stepped across the torch, the thumb on top of the
        // index finger; the torch passes through the fist — the tail above it at the palm, the lens below
        const r = solve(hangT(0.13, 0.16 + swingF * 0.5), hangPole, 'radial', 'fist');
        const {G, ax} = fistAt(r.h);
        push([arm(S, r.E, r.W), prop({kind: 'flashlight', at: G, axis: ax, len: 1.3}), front(r.h)]);
        log(r, {grip: G, target: G, ...itemLog(r.h, ax, -40 * 1.3, 52 * 1.3, 12, true), layers: 'torch → fist on top (tail and lens at the ends of the fist)'});
        return dryEW;
      }
      case 'pen': {
        // writes in the folder held by the other hand, the arm one visible chain: the elbow at the side at the waist, the forearm diagonally
        // to the sheet (at least 0.65 of its length visible), the hand continues it (a wrist bend up to 20°) and guides the pen between the
        // thumb and the index finger — the tip comes out from under the bent index finger onto the sheet, the tail rises above the dip
        // between them, the other fingers are tucked. The tip is on the far half of the sheet: at the near edge the hand has no room, the
        // forearm would become a stump and the hand would turn to it at 70°
        const F: Pt = folderF ?? [-s * 20, -700];
        // the write gesture: the pen tip runs along a line of the sheet with a slight up-and-down; without the gesture the pen stands still
        const wr = g?.pose === 'write' ? g : null;
        // the line is written left to right in the frame whichever hand writes: the hand goes to the line start, runs along it and returns
        const wx = wr ? wr.k * (-24 + 32 * wr.ph) : 0;
        const wy = wr ? wr.k * 3.2 * Math.sin(wr.ph * 44) : 0;
        const gp = HAND_GRIP.pen!;
        const E2 = waistElbow(24, -586);
        // the tip is on a free part of the sheet next to the fingers of the holding hand, not on them (the pen "wrote" on the wrist of the
        // other hand): nearer the middle of the sheet and higher; the forearm keeps at least 0.65 of its length in the frame
        const tip1: Pt = [F[0] - s * (10 + 60 * Math.max(0, 1 - w)) + wx * 0.75, F[1] - 36 + wy];
        const hl = Math.hypot(gp.tip![0], gp.tip![1]) * handK;
        let fd: Pt = unit(E2, tip1);
        let W2: Pt = [tip1[0] - fd[0] * hl, tip1[1] - fd[1] * hl];
        for (let it = 0; it < 6; it++) {
          const u1 = sideVec(hand, 'dorsal', fd);
          // the pen tip is at (5, 64) in the hand frame: the wrist is placed so that the tip comes to tip1
          W2 = [tip1[0] - (u1[0] * gp.tip![0] + fd[0] * gp.tip![1]) * handK, tip1[1] - (u1[1] * gp.tip![0] + fd[1] * gp.tip![1]) * handK];
          // the hand points between the forearm and the direction to the tip: it continues the arm, slightly bent towards the sheet
          const fa = unit(E2, W2);
          const ft = unit(W2, tip1);
          fd = unit([0, 0], [0.55 * fa[0] + 0.45 * ft[0], 0.55 * fa[1] + 0.45 * ft[1]]);
        }
        const pl = byPlane(E2, W2);
        const r = solve(pl.T, pl.pole, 'dorsal', 'pen', {dir: fd});
        const pT = r.h.at(gp.tip![0], gp.tip![1]);
        const pB = r.h.at(gp.tail![0], gp.tail![1]);
        push([arm(S, r.E, r.W), behind(r.h), prop({kind: 'pen', tail: pB, tip: pT}), front(r.h)]);
        log(r, {grip: pT, target: tip1, torsoX: cx0 * w, layers: 'arm → fist → pen → index finger and thumb over the pen'});
        return dryEW;
      }
      case 'phone':
      case 'phoneEar': {
        // A phone in the hand in front (phone): the back cover faces the viewer; the hand with its back at the near edge, the fingers lie
        // across the cover and curl over the far edge, the thumb on the screen behind the phone; the elbow at the side, its pole down and
        // back. A phone at the ear (phoneEar): the elbow low at the chest, the forearm almost vertical up to the jaw; the hand with its
        // back out, the fingers wrap the back edge of the phone with the tips to the face; the phone between the palm and the cheek.
        // Dialling (tap, the first half of dial): the phone lies on the palm screen up in front of the belly, the screen is seen from above
        // and the thumb taps it in view; dial dials and lifts the phone to the ear; hangup lowers it from the ear in front. The poses are
        // segment ends (A → B, x): the target, the pole and the hand turn change continuously, the hand shape changes halfway (at the
        // fastest point), and the phone moves smoothly from grip A to grip B (from lying to standing it turns over its edge)
        type PP = {T: V3; pole: V3; dir: Pt; shape: HandShape; view: HandView; face: 'back' | 'flat'};
        const PH: Record<string, PP> = {
          // in front and on the palm the arm is set in the frame plane (byPlane): the elbow at the side at the waist, the forearm diagonally
          // up to the hand (at least 70 % of its length in the frame), the hand continues it (a bend up to 25°)
          phone: {...byPlane(waistElbow(22), [s * 66, -680]), dir: [-s * 0.7, -1], shape: 'phone', view: 'dorsal', face: 'back'},
          mid: {...byPlane(waistElbow(10, -606), [s * 74, -738]), dir: [-s * 0.6, -0.8], shape: 'phone', view: 'dorsal', face: 'back'},
          ear: {T: [s * 84, -800, 90], pole: [s * 0.1, 1, 0.55], dir: [-s * 0.1, -1], shape: 'ear', view: 'dorsal', face: 'back'},
          // on the palm screen up: the forearm across the belly in the frame (a natural turn for a palm up), the hand at the middle of the
          // body, the elbow at the side slightly back (otherwise the palm up goes beyond a natural turn, tools/hands_check.mjs)
          tap: {...byPlane(waistElbow(14, -608), [-s * 14, -640], -1, 1), dir: [-s * 0.92, -0.4], shape: 'tap', view: 'palmar', face: 'flat'},
        };
        const gp = idx === gIdx && g && PHONE_POSES.includes(g.pose) ? g : null;
        const base = hold === 'phoneEar' ? 'ear' : 'phone';
        const sm = (v: number) => {
          const x = clamp(v);
          return x * x * (3 - 2 * x);
        };
        // the segment: before the event starts the staging layer gives its initial state (k = 0, ph = 0), that is the base pose
        let seg: [string, string, number] = [base, base, 0];
        let tq = 0.3; // thumb lift over the screen
        if (gp) {
          const w = gp.stay ? 1 : gp.k;
          const taps = (gp.ph * (gp.dur ?? 1.3) * 3.2) % 1; // screen taps: 3.2 per second
          if (gp.pose === 'hangup') seg = ['ear', 'phone', sm(gp.ph)];
          else if (gp.pose === 'tap') {
            seg = [base, 'tap', w * sm(gp.ph / (gp.ramp ?? 0.15))];
            tq = (p.tapLift ?? 1) * (0.5 - 0.5 * Math.cos(2 * Math.PI * taps));
          } else {
            const up = sm((gp.ph - 0.5) / 0.5);
            // dialing starts with the phone in front, whatever was held before (not at the ear before dialing)
            seg = up > 0 ? ['tap', 'ear', up] : ['phone', 'tap', w * sm(gp.ph / 0.12)];
            if (gp.ph < 0.45) tq = 0.5 - 0.5 * Math.cos(2 * Math.PI * taps);
          }
        }
        // from the phone in front or on the palm to the ear the arm goes through the intermediate pose mid: a direct blend of the targets
        // would throw the elbow out to the side or fold it to 20° on the way up
        let [A, B, x] = seg;
        if ((['phone', 'tap'].includes(A) && B === 'ear') || (A === 'ear' && ['phone', 'tap'].includes(B))) {
          const lo = A === 'ear' ? B : A;
          const dm0 = A === 'ear' ? 1 - x : x;
          [A, B, x] = dm0 < 0.5 ? [lo, 'mid', dm0 * 2] : ['mid', 'ear', (dm0 - 0.5) * 2];
          if (seg[0] === 'ear') [A, B, x] = [B, A, 1 - x];
        }
        const pa = PH[A];
        const pb = PH[B];
        const mixP = (u: Pt, v: Pt, q: number): Pt => [lerp(u[0], v[0], q), lerp(u[1], v[1], q)];
        // the hand shape of the nearer end of the segment (phone and mid have the same shape)
        const near = x < 0.5 ? pa : pb;
        const r = solve(mixV(pa.T, pb.T, x), mixV(pa.pole, pb.pole, x), near.view, near.shape, {dir: mixP(pa.dir, pb.dir, x), q: tq});
        // the place and tilt of the phone in the grip of each end, taken in the frame of the current hand (the wrist and the fingers as now,
        // the thumb side by the view of the end): the phone moves with the hand instead of lagging behind it
        const place = (pp: PP) => {
          const hh = handAt(r.h.W, r.h.f, hand, pp.view, pp.shape);
          const rr = {h: hh};
          const gc = HAND_GRIP[pp.shape === 'ear' ? 'ear' : pp.shape === 'tap' ? 'tap' : 'phone']!;
          const ax = gAxis(rr.h, pp.shape);
          // a lying phone has its width along the grip axis (across the palm), a standing one has its axis up
          return {C: rr.h.at(gc.c![0], gc.c![1]), a: pp.face === 'flat' ? Math.atan2(ax[1], ax[0]) : Math.atan2(ax[0], -ax[1]), sc: pp.shape === 'ear' ? 1.12 : 1};
        };
        const ka = place(pa);
        const kb = place(pb);
        const mm = sm((x - 0.3) / 0.4);
        const C: Pt = mixP(ka.C, kb.C, mm);
        let dA = kb.a - ka.a;
        while (dA > Math.PI) dA -= 2 * Math.PI;
        while (dA < -Math.PI) dA += 2 * Math.PI;
        const flip = pa.face !== pb.face;
        const face = flip ? (mm < 0.5 ? pa.face : pb.face) : pa.face;
        const sy = flip ? (mm < 0.5 ? 1 - 1.5 * mm : 0.25 + 1.5 * (mm - 0.5)) : 1;
        const phone = prop({kind: 'phone', at: C, angle: ka.a + dA * mm, face, scale: lerp(ka.sc, kb.sc, mm), squeeze: sy, ...(look.phone ? {look: look.phone} : {})});
        const lvl = (n: string) => (n === 'ear' ? 1 : n === 'mid' ? 0.5 : 0);
        const dm = lvl(A) * (1 - x) + lvl(B) * x; // arm height: 0 — in front, 1 — at the ear
        if (r.h.shape !== 'ear') {
          push([arm(S, r.E, r.W), behind(r.h), phone, front(r.h)], dm > 0.25);
          const tapS = r.h.shape === 'tap';
          const G = tapS ? r.h.at(HAND_GRIP.tap!.grip[0], HAND_GRIP.tap!.grip[1]) : r.h.at(0, 36);
          log(r, {grip: G, target: G, pose: gp?.pose, torsoX: cx0 * w, ...(tapS ? {palm: [0, -1, 0] as V3, allowFore: 'phone on the palm in front: forearm towards the viewer'} : {}),
            layers: tapS ? 'palm under the phone → phone screen up → fingertips and thumb on the screen' : 'thumb behind the phone → phone → hand and fingers on the back cover'});
        } else {
          push([phone, arm(S, r.E, r.W), front(r.h)], true);
          const c1 = r.h.at(HAND_GRIP.ear!.c![0], HAND_GRIP.ear!.c![1]);
          log(r, {grip: c1, target: c1, pose: gp?.pose, allowFore: 'elbow in front at the chest: upper arm and forearm towards the viewer', layers: 'phone at the cheek → arm → hand with its back out, fingers on the cover'});
        }
        return dryEW;
      }
      case 'cup': {
        // a cup at the chest: the back of the hand at the near side, four fingers wrap the front wall in an arc with the tips at the far
        // side, the thumb behind the cup; the arm is set in the frame plane: the elbow at the side, the forearm diagonally from it (at
        // least 65 % of its length in the frame), the hand continues it (a bend up to 25°)
        const se = byPlane(waistElbow(20), [s * 44, -650]);
        const r = solve(se.T, se.pole, 'dorsal', 'cup', {dir: [-s, -0.32]});
        const gc = HAND_GRIP.cup!;
        const Cc = r.h.at(gc.c![0], gc.c![1]);
        push([arm(S, r.E, r.W), behind(r.h), prop({kind: 'cup', at: Cc, scale: 0.78}), front(r.h)]);
        log(r, {grip: Cc, target: Cc, layers: 'thumb behind the cup → cup → hand and fingers in an arc on the wall'});
        return dryEW;
      }
      case 'box': {
        // a box at the waist in both hands: the hands on the side faces seen from the thumb side, the fingers go under the bottom (the tips
        // show at the lower edge), the thumb on the front face
        const bw = 112 * (look.w ?? 1);
        const pole: V3 = [s * 0.5, 0.75, -0.4];
        const want: Pt = [s * (bw + 2), -404];
        let T: V3 = [s * (bw + 14), -470, 40];
        let r = solve(T, pole, 'radial', 'box', {dir: [-s * 0.2, 1]});
        for (let it = 0; it < 3; it++) {
          const g0 = r.h.at(12, 44);
          T = [T[0] + want[0] - g0[0], T[1] + want[1] - g0[1], T[2]];
          r = solve(T, pole, 'radial', 'box', {dir: [-s * 0.2, 1]});
        }
        const G = r.h.at(12, 44);
        // the box is drawn once: by the left arm on screen, or by this arm if the other hand holds something else
        push([arm(S, r.E, r.W), s < 0 || pair !== 'box' ? prop({kind: 'box', w: bw, ...(look.box ? {look: look.box} : {})}) : null, front(r.h)]);
        log(r, {grip: G, target: [s * bw, G[1]], layers: 'arm → box → hand on the side face, fingers under the bottom'});
        return dryEW;
      }
      case 'bag':
      case 'tote':
      case 'keys':
      case 'stamp': {
        // a prop in a lowered hand: a bag handle lies in the bent fingers (hook); keys and a stamp are in a fist and hang below it
        const hook = hold === 'bag' || hold === 'tote';
        const r = solve(hangT(0.13, 0.12 + swingF * (run ? 1.3 : 0.6)), hangPole, 'radial', hook ? 'hook' : 'fist');
        const G = hook ? r.h.at(-1, 50) : r.h.at(7, 44);
        // when running the bag swings on its handle
        const item = prop({kind: 'hang', what: hold as Hang, at: G, swing: run && hook ? -16 * sideSwing : 0, strap: look.bagStrap});
        push([arm(S, r.E, r.W), item, front(r.h)]);
        log(r, {grip: G, target: G, layers: hook ? 'arm → handle → fingers hooked over it' : 'arm → prop → fist'});
        return dryEW;
      }
      case 'point': {
        // points at something up and to the side: the arm stretched towards the target, the open hand continues it — the palm towards the
        // target, the fingers together, the thumb apart (not one finger over a fist)
        S = [S[0] + s * 4, S[1] - 14, 0]; // a raised arm raises the shoulder joint: the sleeve comes out of the shoulder, not out of the chest
        const T: V3 = v3.add(S, v3.mul(v3.norm([s * 200, -230, 40]), (ARM_L1 + ARM_L2) * 0.995));
        const r = solve(T, [s * 0.6, 0.8, -0.3], 'ulnar', 'open');
        push([arm(S, r.E, r.W), front(r.h)]);
        log(r);
        return dryEW;
      }
      case 'carry': {
        // carries something in both arms: the forearms crossed under it at the chest, the hands edge-on (thumb on top); the kit draws what
        // is carried on top
        const r = solve([-s * 30, s < 0 ? -574 : -582, 70], [s * 0.5, 0.8, -0.3], 'radial', 'relaxed', {dir: [-s, 0.12]});
        push([arm(S, r.E, r.W), front(r.h)]);
        log(r, {allowFore: 'forearms under the load towards the viewer'});
        return dryEW;
      }
      case 'reach': {
        // a palm on the wall behind the figure to the side (a framed sheet, a button). The figure faces the viewer, the wall is behind: the
        // arm reaches for the sheet back and up diagonally (the elbow raised and pulled back, the upper arm and the forearm foreshortened
        // into one slanted line), the palm pressed to the wall, the back of the hand (the knuckles) towards the viewer, the fingers up, the
        // thumb out. The elbow out with the forearm up and the palm to the viewer would read as a greeting or an oath, and the back of the
        // hand to the viewer at such an elbow would twist the hand by 180° (tools/hands_check.mjs). The middle of the palm is at reachPalm:
        // the kit places the figure at the sheet by this point.
        // The press gesture smooths the sheet: the palm slides down over it (PRESS_DY), turning slightly outwards, and stays ("stay") or
        // returns with the end of the gesture; the progress follows the event fraction and the weight follows the hold, so it does not jump
        // at the start or the end
        const pr0 = g?.pose === 'press' ? g.k * g.ph * g.ph * (3 - 2 * g.ph) : 0;
        const hd = reachPalm(s, look.w ?? 1);
        const palm: Pt = [hd[0], hd[1] + PRESS_DY * pr0];
        // the raised arm lifts the shoulder joint to the shoulder line (the sleeve comes out of the shoulder, not out of the chest);
        // the arm is almost straight, one slanted line in the frame from the shoulder to the sheet (the elbow slightly down), both
        // segments at least 60 % of their length; the hand continues the arm with the fingers slightly steeper up (a bend up to 20°)
        // and turns out when pressing
        S = [S[0] + s * 4, S[1] - 14, 0];
        const sp = unit([S[0], S[1]], palm);
        const fd: Pt = unit([0, 0], [sp[0] + s * 0.3 * pr0, sp[1] - 0.38]);
        const W2: Pt = [palm[0] - fd[0] * 26 * handK, palm[1] - fd[1] * 26 * handK];
        const sw2 = unit([S[0], S[1]], W2);
        const dsw = Math.hypot(W2[0] - S[0], W2[1] - S[1]);
        const nDown: Pt = sw2[0] >= 0 ? [-sw2[1], sw2[0]] : [sw2[1], -sw2[0]]; // across the arm — downwards
        const tE = ARM_L1 / (ARM_L1 + ARM_L2);
        const E2: Pt = [S[0] + sw2[0] * dsw * tE + nDown[0] * 10, S[1] + sw2[1] * dsw * tE + nDown[1] * 10];
        const pl = byPlane(E2, W2, -1, -1);
        const r = solve(pl.T, pl.pole, 'dorsal', 'flat', {dir: fd, keep: true});
        push([arm(S, r.E, r.W), front(r.h)]);
        log(r, {grip: r.h.at(0, 26), target: palm, allowFore: 'reaches for the wall behind: a straight arm foreshortened, both segments ≥ 60 %'});
        return dryEW;
      }
      default: {
        if (pair === 'phoneEar') {
          // the free hand while the phone is at the ear (sitting in bed): lies on the knees with its back up
          const r = solve([s * 34, -556, 86], [s * 0.6, 0.5, -0.6], 'dorsal', 'relaxed', {dir: [-s * 0.85, 0.5]});
          push([arm(S, r.E, r.W), front(r.h)]);
          log(r, {allowFore: 'hand on the knees: forearm towards the viewer'});
          return dryEW;
        }
        // the free hand hangs at the body, seen from the thumb side, the fingers slightly bent to the palm with the tips stepped;
        // when running the arm is bent at the elbow and the fist swings at the waist, forward towards the viewer, without moving the
        // elbow in the frame
        const ra = runArm();
        const r = run ? solve(ra.T, ra.pole, 'radial', 'fist', {keep: true}) : solve(hangT(0.09, swingF + 0.03), hangPole, 'radial', 'relaxed', {bend: 0.1});
        push([arm(S, r.E, r.W), front(r.h)]);
        log(r, run ? {allowFore: 'running: fist forward towards the viewer'} : {hangRef: thighMid});
      }
    }
    return dryEW;
  };
  order.forEach((idx) => armOf(idx));

  return {fem, w, sx, cx0, wx, hx, shY, stoop, run, bob: runBob + (run ? 4 : 0), headDy, lift: [footLift(p.walk, -1), footLift(p.walk, 1)],
    liftH: run ? 88 : 36, armW, arms, logs, hands};
}
