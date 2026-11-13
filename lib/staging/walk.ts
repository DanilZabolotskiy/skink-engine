// Figure path over a shot (staging layer, docs/STAGING.md): segments [u0, u1, [x0, z0], [x1, z1]] — shot fractions and kit metres, from
// walk events (tools/pipeline/staging.py). On a segment the figure accelerates for RAMP_S, walks at an even pace and stops; the step phase
// is the travelled path in steps, with a whole number of steps per segment, so the figure ends on both feet and the step matches the body
// speed (production rule 4). The foot contacts (whole phases) are the moments staging.py step_hits computes for the step sound.
// The gait constants are in walk.json, which tools/pipeline/staging.py reads too.
import WALK from './walk.json';

export type PathSeg = [number, number, [number, number], [number, number]];
const STEP_M = WALK.step_m;
const RAMP_S = WALK.ramp_s;
const STEP_MIN = WALK.step_min;

function stepsOf(seg: PathSeg): number {
  const d = Math.hypot(seg[3][0] - seg[2][0], seg[3][1] - seg[2][1]);
  return d < 1e-3 ? 0 : Math.max(STEP_MIN, Math.round(d / STEP_M));
}

/** Travelled share of the path at time fraction x: acceleration a, a steady part, a stop a. */
function travel(x: number, a: number): number {
  const v = Math.max(0, Math.min(1, x));
  const k = 1 / (2 * a * (1 - a));
  if (v < a) return k * v * v;
  if (v > 1 - a) return 1 - k * (1 - v) * (1 - v);
  return (v - a / 2) / (1 - a);
}

/** Place and step phase at shot fraction u; dur — shot length, s. walk = 0 — standing. */
export function pathAt(path: PathSeg[], u: number, dur: number): {x: number; z: number; walk: number; moving: boolean} {
  let base = 0;
  let x = path[0][2][0];
  let z = path[0][2][1];
  for (const seg of path) {
    const [u0, u1, a, b] = seg;
    const n = stepsOf(seg);
    if (u <= u0) return {x, z, walk: 0, moving: false};
    const T = Math.max(1e-6, (u1 - u0) * dur);
    const k = u >= u1 ? 1 : travel((u - u0) / Math.max(1e-6, u1 - u0), Math.min(RAMP_S, T / 3) / T);
    x = a[0] + (b[0] - a[0]) * k;
    z = a[1] + (b[1] - a[1]) * k;
    if (u < u1) {
      const ph = base + n * k;
      return {x, z, walk: ph > 1e-4 ? ph : 0, moving: true};
    }
    base += n;
  }
  return {x, z, walk: 0, moving: false};
}
