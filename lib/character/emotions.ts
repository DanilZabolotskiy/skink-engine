// Character emotions are sets of numbers that every drawing style reads. A new emotion is a new line: nothing needs to be drawn.
import {random} from 'remotion';
import {clamp, lerp} from '../anim';

// 6 frames: closing 2, holding 1, opening 3.
const smoothBlink = (d: number) => [0.5, 1, 1, 0.7, 0.35, 0.1][d] ?? 0;

export type Face = {
  browY: number; // brow raise, 0..1
  browTilt: number; // >0 inner ends up (worry), <0 down (concentration)
  eyeOpen: number; // eye openness, 0..1.2
  eyeWhite: number; // 0 — dot eyes, 1 — whites and small pupils
  pupil: number; // pupil size with whites, 0.4..1
  mouthCurve: number; // -1 sad .. 1 smile
  mouthOpen: number; // 0..1
  mouthWide: number; // mouth width, 0.6..1.4
  wobble: number; // trembling mouth line
  sweat: number; // sweat drop, 0..1
  pale: number; // pallor, 0..1
  blush: number; // blush, 0..1
  tremble: number; // body trembling, 0..1
  clutch: number; // hold a folder higher, closer to the chest, 0..1
  focus?: number; // focused on what it does: does not blink (eyes open and holding the look), 0..1; no field — 0
  over?: number; // looks over the glasses: glasses lower on the nose, pupils above the frame, the head slightly down, 0..1; no field — 0
  wide?: number; // the lids do not drop when looking down — staring in fear, 0..1; no field — 0
};

export const EMOTIONS: Record<string, Face> = {
  calm: {browY: 0.1, browTilt: 0.05, eyeOpen: 1, eyeWhite: 0, pupil: 1, mouthCurve: 0.25, mouthOpen: 0, mouthWide: 0.9, wobble: 0, sweat: 0, pale: 0, blush: 0.35, tremble: 0, clutch: 0},
  alert: {browY: 0.45, browTilt: -0.35, eyeOpen: 1.1, eyeWhite: 0.55, pupil: 0.8, mouthCurve: -0.1, mouthOpen: 0.08, mouthWide: 0.7, wobble: 0, sweat: 0.2, pale: 0.15, blush: 0, tremble: 0, clutch: 0.35},
  scared: {browY: 0.9, browTilt: 0.9, eyeOpen: 1.2, eyeWhite: 1, pupil: 0.5, mouthCurve: -0.35, mouthOpen: 0, mouthWide: 0.95, wobble: 1, sweat: 1, pale: 0.7, blush: 0, tremble: 0.3, clutch: 1},
  sleepy: {browY: 0, browTilt: 0.2, eyeOpen: 0.32, eyeWhite: 0, pupil: 1, mouthCurve: -0.05, mouthOpen: 0.12, mouthWide: 0.8, wobble: 0, sweat: 0, pale: 0, blush: 0.15, tremble: 0, clutch: 0},
  relief: {browY: 0.25, browTilt: 0.5, eyeOpen: 0.55, eyeWhite: 0, pupil: 1, mouthCurve: 0.45, mouthOpen: 0.25, mouthWide: 1.05, wobble: 0, sweat: 0.6, pale: 0.2, blush: 0.2, tremble: 0, clutch: 0.3},
  sad: {browY: 0.3, browTilt: 0.85, eyeOpen: 0.72, eyeWhite: 0.1, pupil: 1, mouthCurve: -0.6, mouthOpen: 0, mouthWide: 0.75, wobble: 0, sweat: 0, pale: 0.1, blush: 0, tremble: 0, clutch: 0.25},
  scream: {browY: 1, browTilt: 1, eyeOpen: 1.25, eyeWhite: 1, pupil: 0.4, mouthCurve: -0.25, mouthOpen: 1, mouthWide: 1.2, wobble: 0, sweat: 1, pale: 0.75, blush: 0, tremble: 1, clutch: 1},
  // focused on a task (puts in a sheet, writes): brows slightly drawn together, eyes open and not blinking (half-closed eyes would read
  // as squeezed shut). In a script — the word focused (tools/pipeline/timeline.py → EMO_WORDS)
  focused: {browY: 0.04, browTilt: -0.3, eyeOpen: 1, eyeWhite: 0, pupil: 1, mouthCurve: 0.05, mouthOpen: 0, mouthWide: 0.8, wobble: 0, sweat: 0, pale: 0, blush: 0.2, tremble: 0, clutch: 0, focus: 1},
  // confused: brows raised in the middle (inner ends up), eyes slightly wider, the mouth straight and small; no drop
  confused: {browY: 0.4, browTilt: 0.75, eyeOpen: 1.05, eyeWhite: 0.25, pupil: 0.9, mouthCurve: -0.12, mouthOpen: 0, mouthWide: 0.72, wobble: 0, sweat: 0, pale: 0, blush: 0.2, tremble: 0, clutch: 0},
  // looks over the glasses: the head slightly down, glasses lower on the nose, pupils above the frame, brows raised;
  // where it looks — from the kit (gazeX / gazeY, gazeBy)
  peer: {browY: 0.35, browTilt: -0.1, eyeOpen: 1.02, eyeWhite: 0, pupil: 1, mouthCurve: 0.05, mouthOpen: 0, mouthWide: 0.8, wobble: 0, sweat: 0, pale: 0, blush: 0.2, tremble: 0, clutch: 0, over: 1},
  // staring in horror: like scared, but the lids do not drop when looking down (wide), otherwise fear looking down reads as a sleepy face
  aghast: {browY: 0.95, browTilt: 0.85, eyeOpen: 1.25, eyeWhite: 1, pupil: 0.45, mouthCurve: -0.3, mouthOpen: 0.12, mouthWide: 0.9, wobble: 0.6, sweat: 1, pale: 0.75, blush: 0, tremble: 0.2, clutch: 0.8, wide: 0.85},
  // amused: a smile, brows slightly raised
  amused: {browY: 0.25, browTilt: -0.05, eyeOpen: 0.9, eyeWhite: 0, pupil: 1, mouthCurve: 0.6, mouthOpen: 0.06, mouthWide: 1.0, wobble: 0, sweat: 0, pale: 0, blush: 0.35, tremble: 0, clutch: 0},
  // curious: brows up, eyes wider, a hint of a smile
  curious: {browY: 0.55, browTilt: 0.2, eyeOpen: 1.1, eyeWhite: 0.12, pupil: 0.95, mouthCurve: 0.15, mouthOpen: 0.03, mouthWide: 0.75, wobble: 0, sweat: 0, pale: 0, blush: 0.25, tremble: 0, clutch: 0},
  // surprised, staring: brows high, eyes wide open with whites, the mouth slightly open in a circle
  surprised: {browY: 0.95, browTilt: 0.25, eyeOpen: 1.22, eyeWhite: 0.9, pupil: 0.55, mouthCurve: -0.05, mouthOpen: 0.2, mouthWide: 0.62, wobble: 0, sweat: 0, pale: 0.1, blush: 0, tremble: 0, clutch: 0.2, wide: 0.6},
  // polite smile: a wider smile, eyes slightly narrowed, calm brows
  polite: {browY: 0.2, browTilt: 0.1, eyeOpen: 0.85, eyeWhite: 0, pupil: 1, mouthCurve: 0.7, mouthOpen: 0.04, mouthWide: 1.02, wobble: 0, sweat: 0, pale: 0, blush: 0.3, tremble: 0, clutch: 0},
  // parted lips, as if about to reply but silent; fear in the eyes
  parted: {browY: 0.6, browTilt: 0.6, eyeOpen: 1.1, eyeWhite: 0.75, pupil: 0.6, mouthCurve: -0.15, mouthOpen: 0.16, mouthWide: 0.78, wobble: 0, sweat: 0.8, pale: 0.4, blush: 0, tremble: 0.1, clutch: 0.5},
  // angry, grumbling: the brows low and drawn together (inner ends down), a heavy look, the mouth corners down, a flush. The brows sit low
  // and steep: high and almost level brows over an old face with heavy lids read as tired
  angry: {browY: -0.55, browTilt: -1.35, eyeOpen: 1.14, eyeWhite: 0.6, pupil: 0.72, mouthCurve: -0.7, mouthOpen: 0.03, mouthWide: 0.84, wobble: 0, sweat: 0, pale: 0, blush: 0.5, tremble: 0, clutch: 0},
  // asleep: the lids closed, a calm face, the mouth slightly open
  asleep: {browY: 0.0, browTilt: 0.1, eyeOpen: 0.04, eyeWhite: 0, pupil: 1, mouthCurve: 0.05, mouthOpen: 0.05, mouthWide: 0.8, wobble: 0, sweat: 0, pale: 0, blush: 0.2, tremble: 0, clutch: 0},
};

function mixFace(a: Face, b: Face, t: number): Face {
  const out = {} as Face;
  // the fields are the union of both faces: an optional one (focus) missing on one of them counts as zero
  (Array.from(new Set([...Object.keys(a), ...Object.keys(b)])) as (keyof Face)[]).forEach((k) => (out[k] = lerp(a[k] ?? 0, b[k] ?? 0, t)));
  return out;
}

/** Emotion by a schedule [[frame, name], ...]; transition over `blend` frames. */
export function faceAt(f: number, plan: [number, string][], blend = 8): Face {
  // an unknown emotion name — a calm face (like script words without their own line), not a crashed frame
  let cur = EMOTIONS[plan[0][1]] ?? EMOTIONS.calm;
  for (let i = 1; i < plan.length; i++) {
    const [fi, name] = plan[i];
    if (f < fi) break;
    const t = clamp((f - fi) / blend);
    const s = t * t * (3 - 2 * t);
    cur = mixFace(cur, EMOTIONS[name] ?? EMOTIONS.calm, s);
  }
  return cur;
}

/** Blink: 0 — open, 1 — closed. Random intervals of 2–5 s; no double blink — two blinks 0.3 s apart read as flickering: the pause
 *  between blinks is at least 2 s. */
export function blinkAt(f: number, seed: string, fps = 30): number {
  let t = Math.floor(random(`${seed}:start`) * fps * 1.5);
  for (let i = 0; i < 400 && t <= f + 8; i++) {
    const d = f - t;
    if (d >= 0 && d < 6) return smoothBlink(d);
    t += Math.floor(fps * (2 + random(`${seed}:gap${i}`) * 3));
  }
  return 0;
}

/** Mouth while speaking: syllables [start, end] in seconds (timeline: cast[].talk) → opening 0..1, one stroke per syllable; the mouth
 *  is closed in pauses. */
export function talkAt(t: number, talk?: [number, number][]): number {
  if (!talk) return 0;
  for (let i = 0; i < talk.length; i++) {
    const [a, b] = talk[i];
    if (t < a) return 0;
    if (t <= b) return Math.sin(Math.PI * Math.min(1, (t - a) / Math.max(0.08, b - a))) * (0.4 + 0.06 * (i % 4));
  }
  return 0;
}
