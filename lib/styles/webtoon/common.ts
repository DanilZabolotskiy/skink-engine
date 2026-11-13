// Shared parts of the webtoon style: the outline width, the skin of a role, smooth paths.
import {mixHex} from '../../anim';
import type {Outfit} from '../../character/Character';
import type {Look} from '../../character/looks';

type Pt = [number, number];

/** Outline width of a figure, figure units (thinner than the western style). */
export const SW = 6.5;

/** Skin of a role: a tan (look.features.tan) darkens it. The tone does not change with the emotion: pallor is only the shadows under the eyes. */
export const skinOf = (o: Outfit, look: Look) => (look.features?.tan ? mixHex(o.skin, '#B9784C', look.features.tan) : o.skin);

/** Smooth path through points (Catmull-Rom → cubic Béziers): closed — back to the first point; k — tension; move — start with M (otherwise
 *  the path continues from the current point); digits — coordinate precision. */
export function cr(pts: Pt[], closed = true, k = 1 / 6, move = true, digits = 1): string {
  const n = pts.length;
  if (n < 2) return '';
  const f = (v: number) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(digits));
  const P = (p: Pt) => `${f(p[0])} ${f(p[1])}`;
  const g = (i: number) => pts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = move ? `M ${P(pts[0])}` : '';
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += ` C ${P(c1)} ${P(c2)} ${P(p2)}`;
  }
  return closed ? d + ' Z' : d;
}

/** Continues the current path with a smooth curve through the points; the first point is the current one. */
export const crOpen = (pts: Pt[]) => cr(pts, false, 1 / 6, false);
