// A sweep of the engine arm poses without a render (tools/hands_check.mjs --sweep): every pose a staging can set — a prop in the hand
// (hold), a gesture (pose, side, grip, progress k and ph), a hand point (reach), walking and running, front and back views, different
// figures — is computed right by bodyPose (lib/character/body.ts); its arm journal (ArmLog, with the self-check of the hands of a style,
// CharacterStyle.handAudit) is checked by hands_check.mjs: natural joints, fingers, the left arm mirroring the right one, jumps on the way
// of a gesture. Bundled by esbuild (it is in node_modules — a dependency of Remotion).
import {BodyGest, armLogs, bodyPose} from '../lib/character/body';
import type {ArmLog} from '../lib/character/arm';
import {EMOTIONS} from '../lib/character/emotions';
import type {Hold, Look} from '../lib/character/looks';
import {styleById} from '../lib/styles';

/** Figures: a man in a jacket, a woman, a slim teenager in a hoodie, a wide one in a T-shirt (a bare arm), an old man (stooping), a child. */
const LOOKS: Record<string, Look> = {
  man: {hair: 'short', top: 'jacket'},
  woman: {build: 'woman', hair: 'bob', top: 'cardigan', w: 0.9},
  slim: {hair: 'short', top: 'hoodie', w: 0.85},
  wide: {hair: 'side', top: 'tshirt', w: 1.1},
  old: {hair: 'bald', top: 'cardigan', age: 0.9},
  kid: {build: 'child', hair: 'kid', top: 'tshirt', head: 1.08, w: 0.82},
};
const HOLDS: Hold[] = ['none', 'carry', 'point', 'folder', 'flashlight', 'phone', 'phoneEar', 'stamp', 'box', 'tote', 'bag', 'keys', 'pen', 'cup', 'count', 'reach', 'rest', 'mop', 'mopRaised'];
const PAIRS: [Hold, Hold][] = [['folder', 'pen'], ['pen', 'folder'], ['folder', 'flashlight'], ['bag', 'phone'], ['folder', 'reach'], ['reach', 'folder'], ['box', 'box'], ['carry', 'carry'],
  ['rest', 'rest'], ['keys', 'flashlight'], ['bag', 'phoneEar'], ['rest', 'count'], ['folder', 'phone'], ['mop', 'none'], ['none', 'cup']];

export type Sample = {id: string; look: string; back: boolean; holds: [Hold, Hold]; gest?: BodyGest; reach?: [number, number]; walk: number; pace?: string; clutch: number;
  seq?: string; step?: number; dt?: number; mirror?: ArmLog[]; arms: ArmLog[]};

type PoseOpt = {gest?: BodyGest; reach?: [number, number]; walk?: number; pace?: string; clutch?: number};

/** The sweep: cb gets every sample in order (the samples of one motion — in a row). full — gestures on every figure (otherwise on three);
 *  style — the style whose hand self-check goes into the journal (a style without one — the core journal only). */
export function sweep(cb: (s: Sample) => void, full = false, style = 'webtoon'): number {
  const audit = styleById(style).handAudit;
  const pose = (look: string, back: boolean, holds: [Hold, Hold], o: PoseOpt = {}): ArmLog[] => {
    const face = {...EMOTIONS.calm, clutch: o.clutch ?? 0};
    return armLogs(bodyPose({look: LOOKS[look], holds, face, back, walk: o.walk ?? 0, pace: o.pace, gest: o.gest, reach: o.reach}), audit);
  };
  let n = 0;
  const looks = Object.keys(LOOKS);
  const gLooks = full ? looks : ['man', 'woman', 'slim'];
  const add = (id: string, look: string, back: boolean, holds: [Hold, Hold], o: PoseOpt = {}, extra: Partial<Sample> = {}) => {
    n++;
    cb({id, look, back, holds, gest: o.gest, reach: o.reach, walk: o.walk ?? 0, pace: o.pace, clutch: o.clutch ?? 0, ...extra, arms: pose(look, back, holds, o)});
  };
  // 1. props in the hands: every hand, pairs, fear, walking and running; the mirror — the same pose with the hands swapped
  for (const look of looks) {
    for (const back of [false, true]) {
      const tag = `${look}${back ? ' from behind' : ''}`;
      const sets: [Hold, Hold][] = [...HOLDS.flatMap((h): [Hold, Hold][] => [[h, 'none'], ['none', h]]), ...PAIRS];
      for (const holds of sets) {
        add(`hold ${holds.join('+')} · ${tag}`, look, back, holds, {}, {mirror: pose(look, back, [holds[1], holds[0]])});
        if (!back) add(`hold ${holds.join('+')} · ${tag} · fear`, look, back, holds, {clutch: 1});
      }
      for (const holds of [['none', 'none'], ['folder', 'flashlight'], ['bag', 'none'], ['keys', 'flashlight'], ['tote', 'none']] as [Hold, Hold][]) {
        for (const pace of [undefined, 'run']) {
          const seq = `walk ${pace ?? 'step'} ${holds.join('+')} · ${tag}`;
          for (let i = 0; i <= 60; i++) add(seq, look, back, holds, {walk: 0.01 + i / 30, pace}, {seq, step: i, dt: i ? 1 : 0});
        }
      }
    }
  }
  // 2. gestures: pose × side × grip × hand point × progress in time
  const tl = timeline();
  const pts: ([number, number] | undefined)[] = [undefined];
  for (const x of [-300, -200, -100, 0, 100, 200, 300]) for (const y of [-860, -740, -620, -500]) pts.push([x, y]);
  type GS = {pose: string; holds: [Hold, Hold][]; reach?: boolean; e?: Partial<BodyGest>[]; front?: boolean};
  const GEST: GS[] = [
    {pose: 'push', holds: [['none', 'none'], ['folder', 'flashlight'], ['none', 'phone'], ['box', 'none']], reach: true, e: [{}, {grip: 'fist'}, {side: 'R'}, {side: 'L', grip: 'fist'}, {grip: 'point'}, {side: 'L', grip: 'press'}]},
    {pose: 'pull', holds: [['none', 'none'], ['tote', 'none'], ['folder', 'none']], reach: true, e: [{}, {side: 'R'}, {side: 'L'}]},
    {pose: 'rail', holds: [['none', 'none'], ['folder', 'flashlight']], reach: true, e: [{}, {side: 'R'}, {side: 'L'}]},
    {pose: 'count', holds: [['none', 'none'], ['none', 'bag'], ['folder', 'none'], ['rest', 'count']], e: [{n: 1}, {n: 3}, {n: 4}, {n: 4, side: 'L'}]},
    {pose: 'press', holds: [['folder', 'reach'], ['reach', 'folder'], ['reach', 'none']], e: [{}, {stay: true}]},
    {pose: 'write', holds: [['folder', 'pen'], ['pen', 'folder']]},
    {pose: 'dial', holds: [['phone', 'none'], ['none', 'phone'], ['bag', 'phone']], e: [{stay: true}], front: true},
    {pose: 'tap', holds: [['phone', 'none'], ['none', 'phone'], ['bag', 'phone']], e: [{}, {stay: true}, {ramp: 0.001}], front: true},
    {pose: 'hangup', holds: [['phoneEar', 'none'], ['none', 'phoneEar']], e: [{stay: true}], front: true},
    {pose: 'straighten', holds: [['none', 'none'], ['folder', 'none']]},
    {pose: 'point', holds: [['none', 'none'], ['folder', 'none']]},
    {pose: 'knock', holds: [['mop', 'none'], ['none', 'mop']], e: [{}, {n: 2}]},
  ];
  const G = (p: string, k: number, ph: number, e: Partial<BodyGest> = {}): BodyGest => ({pose: p, k, ph, dur: 2, ...e});
  for (const look of gLooks) {
    for (const back of [false, true]) {
      const tag = `${look}${back ? ' from behind' : ''}`;
      for (const gs of GEST) {
        if (gs.front && back) continue;
        for (const holds of gs.holds) {
          for (const e of gs.e ?? [{}]) {
            for (const reach of gs.reach ? pts : [undefined]) {
              const seq = `${gs.pose}${Object.keys(e).length ? ' ' + JSON.stringify(e).replace(/"/g, '') : ''} ${holds.join('+')}${reach ? ` → ${reach.join(',')}` : ''} · ${tag}`;
              // the mirror (in the pose of the gesture): the hands and the side swapped, the point on the other side
              const sideM = e.side === 'R' ? 'L' : e.side === 'L' ? 'R' : undefined;
              const eM = {...e, ...(sideM ? {side: sideM} : {})};
              const rM: [number, number] | undefined = reach ? [-reach[0], reach[1]] : undefined;
              tl.forEach(([k, ph, dt], i) => add(seq, look, back, holds, {gest: G(gs.pose, k, ph, e), reach}, {seq, step: i, dt,
                // (without a side and with equal hands the gesture is made by the same hand of the figure — a rule of the hand choice,
                // not a mirror)
                ...(i === 14 && sideM ? {mirror: pose(look, back, [holds[1], holds[0]], {gest: G(gs.pose, k, ph, eM), reach: rM})} : {})}));
            }
          }
        }
      }
    }
  }
  return n;
}

/** The progress of a gesture over an event of 2 s: the entry and the exit of 0.35 s each frame by frame (dt = 1: a jump between
 *  neighbouring frames is checked), the pose between them — eight moments (dt = 0: only the joints). [k, ph, dt]. */
function timeline(): [number, number, number][] {
  const out: [number, number, number][] = [];
  const dur = 2, io = 0.35;
  const sm = (x: number) => x * x * (3 - 2 * x);
  for (let f = 0; f <= Math.round(io * 30) + 1; f++) out.push([sm(Math.min(1, f / 30 / io)), f / 30 / dur, f ? 1 : 0]);
  for (let i = 1; i <= 8; i++) out.push([1, (io + 0.05 + ((dur - io - 0.1) * i) / 9) / dur, 0]);
  for (let f = 0; f <= Math.round(io * 30) + 1; f++) out.push([sm(Math.max(0, 1 - f / 30 / io)), 1, f ? 1 : 0]);
  return out;
}
