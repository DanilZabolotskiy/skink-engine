// Shared animation helpers: keys, easing, deterministic noise.
// Portable: depends only on remotion.random (deterministic by a string).
import {random} from 'remotion';

export type Key<T = number> = [number, T];

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** A number with one decimal for SVG coordinates. */
export const n1 = (v: number) => v.toFixed(1);
/** An SVG polyline path through the points (M, then L). */
export const polyline = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${n1(x)} ${n1(y)}`).join(' ');
export const smooth = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

/** Value by keys [frame, value] with easing between keys. */
export function track(f: number, keys: Key[], ease: (t: number) => number = smooth): number {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [f0, v0] = keys[i];
    const [f1, v1] = keys[i + 1];
    if (f <= f1) return lerp(v0, v1, ease((f - f0) / Math.max(1e-6, f1 - f0)));
  }
  return keys[keys.length - 1][1];
}

/** Smooth one-dimensional value noise, -1..1. */
export function noise1(seed: string, t: number): number {
  const i = Math.floor(t);
  const fr = t - i;
  const a = random(`${seed}:${i}`) * 2 - 1;
  const b = random(`${seed}:${i + 1}`) * 2 - 1;
  return lerp(a, b, smooth(fr));
}

/** A 0..1 window: rises over fadeIn frames from start, falls over fadeOut towards end. */
export function windowFade(f: number, start: number, end: number, fadeIn = 6, fadeOut = 6): number {
  if (f < start || f > end) return 0;
  return Math.min(clamp((f - start) / fadeIn), clamp((end - f) / fadeOut));
}

/** Mix of #rrggbb colours. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(lerp(ch(pa, s), ch(pb, s), clamp(t)));
  return `#${((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1)}`;
}

export function scaleHex(a: string, k: number): string {
  const p = parseInt(a.slice(1), 16);
  const c = (s: number) => Math.round(clamp(((p >> s) & 255) * k, 0, 255));
  return `#${((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1)}`;
}
