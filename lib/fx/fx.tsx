// Effects over the frame: dust, haze, vignette, glow, flicker. Everything is deterministic by the frame.
import React from 'react';
import {AbsoluteFill, random} from 'remotion';
import {noise1} from '../anim';

/** Brightness of a flickering lamp 0..1 by a schedule of windows [start, end] in seconds. */
export function flicker(t: number, seed: string, windows: [number, number][], base = 1, offLevel = 0.12): number {
  const hum = 1 - 0.03 * (0.5 + 0.5 * noise1(`${seed}hum`, t * 9));
  for (const [a, b] of windows) {
    if (t >= a && t <= b) {
      // ragged flashes: short drops of different length
      const k = Math.floor(t * 24);
      const r = random(`${seed}:${k}`);
      const r2 = random(`${seed}:b${Math.floor(t * 9)}`);
      const level = r2 < 0.35 ? offLevel : r < 0.45 ? offLevel + 0.15 : 0.85 + 0.15 * r;
      return base * level;
    }
  }
  return base * hum;
}

/** Dust specks. depth moves them with the camera (parallax). */
export const Dust: React.FC<{
  t: number; n?: number; seed?: string; color?: string; camX?: number; camY?: number; depth?: number;
  area?: [number, number, number, number]; brightness?: number; size?: number;
}> = ({t, n = 70, seed = 'dust', color = '#cfe8ff', camX = 0, camY = 0, depth = 1, area = [0, 0, 1920, 1080], brightness = 1, size = 1}) => {
  const [ax, ay, aw, ah] = area;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {new Array(n).fill(0).map((_, i) => {
        const r = (k: string) => random(`${seed}${k}${i}`);
        const s = (1.5 + r('s') * 3.5) * size;
        const x = ax + ((r('x') * aw + 25 * Math.sin(t * (0.25 + r('w') * 0.4) + i) - camX * depth * (0.6 + r('d'))) % aw + aw) % aw;
        const y = ay + ((r('y') * ah - t * (6 + 14 * r('v')) - camY * depth) % ah + ah) % ah;
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1 + r('f') * 2) + r('p') * 6));
        return (
          <div key={i} style={{
            position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: '50%',
            background: color, opacity: brightness * tw * (0.25 + 0.6 * r('o')),
            boxShadow: `0 0 ${s * 2}px ${color}`,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

/** Haze: a few soft bands drifting slowly. */
export const Haze: React.FC<{t: number; color?: string; opacity?: number; seed?: string; horizon?: number}> = ({t, color = '120,170,220', opacity = 0.18, seed = 'haze', horizon = 0.55}) => (
  <AbsoluteFill style={{pointerEvents: 'none', mixBlendMode: 'screen'}}>
    {[0, 1, 2, 3].map((i) => {
      const x = -400 + ((random(`${seed}x${i}`) * 1600 + t * (12 + 8 * i)) % 2400);
      const y = 1080 * horizon - 220 + random(`${seed}y${i}`) * 380;
      return (
        <div key={i} style={{
          position: 'absolute', left: x - 500, top: y - 160, width: 1300, height: 420, borderRadius: '50%',
          background: `radial-gradient(closest-side, rgba(${color},${opacity}), rgba(${color},0))`,
        }} />
      );
    })}
    <AbsoluteFill style={{background: `linear-gradient(180deg, rgba(${color},0) 30%, rgba(${color},${opacity * 0.5}) 75%, rgba(${color},${opacity * 0.2}) 100%)`}} />
  </AbsoluteFill>
);

export const Vignette: React.FC<{strength?: number; color?: string}> = ({strength = 0.75, color = '4,6,18'}) => (
  <AbsoluteFill style={{
    pointerEvents: 'none',
    background: `radial-gradient(ellipse 75% 70% at 50% 48%, rgba(${color},0) 55%, rgba(${color},${strength * 0.55}) 82%, rgba(${color},${strength}) 100%)`,
  }} />
);

/** Soft glow of a source (a lamp) in screen coordinates. */
export const Glow: React.FC<{x: number; y: number; r: number; color?: string; intensity?: number}> = ({x, y, r, color = '190,235,255', intensity = 1}) => (
  <div style={{
    position: 'absolute', left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: '50%', pointerEvents: 'none',
    mixBlendMode: 'screen',
    background: `radial-gradient(closest-side, rgba(${color},${0.75 * intensity}), rgba(${color},${0.22 * intensity}) 35%, rgba(${color},0))`,
  }} />
);
