// Perspective for backgrounds in code: a location is set once in metres, a frame is a camera.
// Drawn flat (SVG polygons), only the projection is computed. Any view of one room.
// Axes: x — right, y — up, z — forward (into the depth).

export type V3 = [number, number, number];
export type Cam = {pos: V3; yaw: number; pitch: number; fov: number; W: number; H: number; roll?: number};

const D2R = Math.PI / 180;

export function toCam(c: Cam, p: V3): V3 {
  const dx = p[0] - c.pos[0];
  const dy = p[1] - c.pos[1];
  const dz = p[2] - c.pos[2];
  const cy = Math.cos(-c.yaw * D2R);
  const sy = Math.sin(-c.yaw * D2R);
  // rotation around Y (yaw > 0 — looking right)
  const x1 = cy * dx + sy * dz;
  const z1 = -sy * dx + cy * dz;
  const cp = Math.cos(-c.pitch * D2R);
  const sp = Math.sin(-c.pitch * D2R);
  // rotation around X (pitch > 0 — looking up)
  const y2 = cp * dy + sp * z1;
  const z2 = -sp * dy + cp * z1;
  return [x1, y2, z2];
}

export function focal(c: Cam) {
  return c.W / 2 / Math.tan((c.fov * D2R) / 2);
}

function projCam(c: Cam, q: V3): [number, number] {
  const fl = focal(c);
  let x = (fl * q[0]) / q[2];
  let y = (-fl * q[1]) / q[2];
  if (c.roll) {
    const r = c.roll * D2R;
    const xr = x * Math.cos(r) - y * Math.sin(r);
    const yr = x * Math.sin(r) + y * Math.cos(r);
    x = xr;
    y = yr;
  }
  return [c.W / 2 + x, c.H / 2 + y];
}

const NEAR = 0.05;

/** Entirely beyond the frame edge (with a margin) — not drawn: thousands of windows of distant houses do not slow the render down. */
export function offscreen(c: Cam, sp: [number, number][], m = 60): boolean {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of sp) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < -m || x0 > c.W + m || y1 < -m || y0 > c.H + m;
}

/** World polygon → an SVG path string (clipped by the near plane) or null. */
export function polyPath(c: Cam, pts: V3[]): string | null {
  const q = pts.map((p) => toCam(c, p));
  const out: V3[] = [];
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const ain = a[2] > NEAR;
    const bin = b[2] > NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
    }
  }
  if (out.length < 3) return null;
  const sp = out.map((p) => projCam(c, p));
  if (offscreen(c, sp)) return null;
  return sp.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + 'Z';
}

/** World segment → a path (for thin lines: railings, seams). */
export function linePath(c: Cam, a: V3, b: V3): string | null {
  let qa = toCam(c, a);
  let qb = toCam(c, b);
  if (qa[2] <= NEAR && qb[2] <= NEAR) return null;
  if (qa[2] <= NEAR || qb[2] <= NEAR) {
    const t = (NEAR - qa[2]) / (qb[2] - qa[2]);
    const m: V3 = [qa[0] + (qb[0] - qa[0]) * t, qa[1] + (qb[1] - qa[1]) * t, NEAR];
    if (qa[2] <= NEAR) qa = m; else qb = m;
  }
  const [x1, y1] = projCam(c, qa);
  const [x2, y2] = projCam(c, qb);
  if (offscreen(c, [[x1, y1], [x2, y2]])) return null;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** World point → screen + depth (null if behind the camera). */
export function pt(c: Cam, p: V3): {x: number; y: number; z: number} | null {
  const q = toCam(c, p);
  if (q[2] <= NEAR) return null;
  const [x, y] = projCam(c, q);
  return {x, y, z: q[2]};
}

/** A rectangle on a plane: centre, two directions (half-axes). */
export function quad(center: V3, u: V3, v: V3): V3[] {
  const [cx, cy, cz] = center;
  return [
    [cx - u[0] - v[0], cy - u[1] - v[1], cz - u[2] - v[2]],
    [cx + u[0] - v[0], cy + u[1] - v[1], cz + u[2] - v[2]],
    [cx + u[0] + v[0], cy + u[1] + v[1], cz + u[2] + v[2]],
    [cx - u[0] + v[0], cy - u[1] + v[1], cz - u[2] + v[2]],
  ];
}

/** An ellipse on a plane (n vertices). */
export function ellipse(center: V3, u: V3, v: V3, n = 20): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    out.push([center[0] + u[0] * ca + v[0] * sa, center[1] + u[1] * ca + v[1] * sa, center[2] + u[2] * ca + v[2] * sa]);
  }
  return out;
}

/** Distance from the camera (for fog). */
export function dist(c: Cam, p: V3) {
  return Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1], p[2] - c.pos[2]);
}
