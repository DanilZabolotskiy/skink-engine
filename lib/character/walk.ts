// Figure step (production rule 4): the phase is in steps, a whole phase is a foot contact (the moment of the step sound,
// tools/pipeline/staging.py step_hits). Figures are drawn facing the camera or from behind and walk towards the camera or away from it, so
// the legs do not swing sideways: they lift in turn — the foot leaves the floor and comes down in place. The phase follows the travelled
// path (lib/staging/walk.ts pathAt), so the step always matches the body speed and nobody walks on the spot.

/** Foot lift 0..1 for leg s (-1 — left on screen, 1 — right) at phase ph (steps). */
export function footLift(ph: number, s: number): number {
  if (!ph) return 0;
  const c = (((ph / 2) % 1) + 1) % 1; // a cycle is two steps
  const own = s < 0 ? c : (c + 0.5) % 1;
  return own < 0.5 ? Math.sin(own * 2 * Math.PI) : 0;
}

/** Arm swing -1..1 (an arm goes forward with the opposite leg), the period is two steps. */
export const armSwing = (ph: number) => (ph ? Math.sin(Math.PI * ph) : 0);
