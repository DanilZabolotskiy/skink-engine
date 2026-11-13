// Colour grades of a preset: kits draw with their plain colours, and a grade turns them into the look of the preset in the frame.
// Chapter.tsx applies the grade of the shot preset (ChannelModule.grades) to the kit layer after the frame is drawn: every colour in the
// fill, stroke, stop-color and style attributes goes through the grade function. The title bar, the counter, cards and subtitles are
// outside the layer; figures grade their own clothes (figure.tsx); presets without a grade get no layer.
// The role of an element can be set with the data-grade attribute (it applies to the whole subtree): plane — always as a plane (a table
// top), accent — always as an accent (the sky), keep — leave the colours as they are.
//
// mutedDayRgb is a ready grade a channel can map to a preset (for example, {day: mutedDayRgb}): pale planes become warm greys while colour
// accents stay. The lightness of every colour stays (luma Y, Rec. 709); only the saturation S (HSV) changes:
// - planes (S below 0.30): light ones (Y from 0.65) get S 0.06, medium and dark ones (Y up to 0.45) get S at most 0.10, smoothly in
//   between; colours that are already grey stay;
// - colour accents (S above 0.36) get S × 0.9, with a smooth transition between 0.30 and 0.36;
// - skin tones (hue 20–32°, S 0.27–0.45, light) stay as they are, so hands and faces drawn by kits do not turn grey with the walls.
import React from 'react';
import {smooth} from '../anim';

export type GradeRole = 'auto' | 'plane' | 'accent' | 'keep';
type Rgb = [number, number, number]; // 0..255

const MUTED_DAY = {
  lightS: 0.06, // S of light planes
  darkS: 0.095, // ceiling of S for medium and dark planes (≤ 0.10 with a margin for rounding)
  yDark: 0.45, // up to this luma — darkS
  yLight: 0.65, // from this one — lightS
  s0: 0.3, // below — a plane
  s1: 0.36, // above — a colour accent
  accentK: 0.9, // S multiplier of accents
};

const smoothstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));

/** Multiplier k (c' = Y + k·(c − Y)) at which the saturation becomes T. Luma Y does not change. */
function kFor(T: number, Y: number, M: number, C: number): number {
  const den = C - T * (M - Y);
  return den > 1e-9 ? Math.min(1, (T * Y) / den) : 1;
}

/** The muted day grade of a colour 0..255. */
export function mutedDayRgb(c: Rgb, role: GradeRole = 'auto'): Rgb {
  if (role === 'keep') return c;
  const [r, g, b] = [c[0] / 255, c[1] / 255, c[2] / 255];
  const M = Math.max(r, g, b);
  const C = M - Math.min(r, g, b);
  if (C < 1e-6) return c;
  const S = C / M;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const St = MUTED_DAY.darkS + (MUTED_DAY.lightS - MUTED_DAY.darkS) * Math.max(0, Math.min(1, (Y - MUTED_DAY.yDark) / (MUTED_DAY.yLight - MUTED_DAY.yDark)));
  const kPlane = S <= St + 0.008 ? 1 : kFor(St, Y, M, C);
  const kAcc = kFor(S * MUTED_DAY.accentK, Y, M, C);
  const p = role === 'plane' ? 1 : role === 'accent' ? 0 : 1 - smoothstep(MUTED_DAY.s0, MUTED_DAY.s1, S);
  let k = p * kPlane + (1 - p) * kAcc;
  if (role === 'auto') {
    // skin tone — not graded (smooth edges, so neighbouring colours do not jump)
    const h = M === r ? (60 * (g - b)) / C : M === g ? 120 + (60 * (b - r)) / C : 240 + (60 * (r - g)) / C;
    const w = smoothstep(16, 21, h) * (1 - smoothstep(32, 34, h)) * smoothstep(0.25, 0.29, S) * (1 - smoothstep(0.45, 0.5, S)) * smoothstep(0.5, 0.58, Y);
    k = w + (1 - w) * k;
  }
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round((Y + k * (v - Y)) * 255)));
  return [ch(r), ch(g), ch(b)];
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

export type GradeFn = (c: Rgb, role: GradeRole) => Rgb;

// a colour in an attribute or style string: #hex (except url(#id) references), rgb()/rgba()
const RE = /(?<!url\()#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])|rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/g;

export function gradeStr(s: string, role: GradeRole, fn: GradeFn): string {
  if (!/[#(]/.test(s)) return s;
  return s.replace(RE, (_m, hx: string | undefined, r?: string, g?: string, b?: string, a?: string) => {
    if (hx) {
      const full = hx.length <= 4 ? hx.split('').map((x) => x + x).join('') : hx;
      const n = parseInt(full.slice(0, 6), 16);
      const o = fn([(n >> 16) & 255, (n >> 8) & 255, n & 255], role);
      return `#${hex2(o[0])}${hex2(o[1])}${hex2(o[2])}${full.slice(6)}`;
    }
    const o = fn([Math.round(Number(r)), Math.round(Number(g)), Math.round(Number(b))], role);
    return a !== undefined ? `rgba(${o[0]}, ${o[1]}, ${o[2]}, ${a})` : `rgb(${o[0]}, ${o[1]}, ${o[2]})`;
  });
}

const ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'];

/** Grade the colours of all elements of the subtree (after the frame is drawn). */
export function gradeDom(root: Element, preset: string, grades: Record<string, GradeFn>) {
  const fn = grades[preset];
  if (!fn) return;
  const walk = (el: Element, role: GradeRole) => {
    const r = el.getAttribute('data-grade') as GradeRole | null;
    if (r) role = r;
    if (role === 'keep') return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) {
        const g = gradeStr(v, role, fn);
        if (g !== v) el.setAttribute(a, g);
      }
    }
    const st = el.getAttribute('style');
    if (st) {
      const g = gradeStr(st, role, fn);
      if (g !== st) el.setAttribute('style', g);
    }
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) walk(c, role);
  };
  walk(root, 'auto');
}

/** Preset of the kit layer if it is graded; figures (figure.tsx) take from here whether to grade their clothes. */
export const GradeCtx = React.createContext<string | null>(null);
