// Kit "cafe": a small corner café described once in metres (lib/chapter/room.tsx); a view is a camera, not a new drawing.
// Axes: x — right, y — up, z — into the room. Back wall z = 6 with a window on the left, a menu board and a shelf of cups in the middle and
// an open door on the right; the counter stands across the room (front face z = 3.9) with a coffee machine; two pendant lamps hang over it.
// Views (channel.json → locations.cafe.views):
//   wide         — the whole room from the entrance side; push-in / pull back run over the whole shot
//   close-mira   — close on Mira behind the counter
//   close-oscar  — close on Oscar at the end of the counter
// Figures: OSCAR moves by the shot's walk events (cast[].path, metres of this kit), otherwise stands at the end of the counter; MIRA stands
// behind the counter, which covers her below the counter top. Gaze — look events; the targets are the points in POINTS.
import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {Cam, V3, focal, pt} from '../../../../lib/persp/persp';
import {RItem, box, draw, flatY, floorPool, gazeBy, textOn, wallGlowZ, wallX, wallZ} from '../../../../lib/chapter/room';
import {Figure} from '../../../../lib/chapter/figure';
import {pathAt} from '../../../../lib/staging/walk';
import {CastMember, KitProps} from '../../../../lib/chapter/types';
import {propMark} from '../../../../lib/staging/journal';
import {Glow, Vignette} from '../../../../lib/fx/fx';
import {smooth} from '../../../../lib/anim';
import {CAST} from '../cast';
import {Pal, palOf} from '../palette';

const ROOM = {x0: -3, x1: 3, z1: 6, h: 2.8};
const COUNTER = {x0: -1.9, x1: 0.6, z0: 3.9, z1: 4.5, h: 1.05};
const DOOR = {x0: 1.55, x1: 2.45, h: 2.1};
const WIN = {x0: -2.75, x1: -2.0, y0: 0.95, y1: 2.15};
const LAMPS = [-1.2, 0.1];
const SPOTS = {oscarCounter: [0.95, 3.4] as [number, number], oscarDoor: [2.0, 5.6] as [number, number], miraBar: [-0.55, 4.85] as [number, number]};

const head = (who: string, x: number, z: number): V3 => [x, CAST[who].h - 0.13, z];

function camOf(view: string, k: number, W: number, H: number): Cam {
  if (view === 'close-mira') return {pos: [-0.2, 1.5, 3.0], yaw: -11, pitch: -1, fov: 34, W, H};
  if (view === 'close-oscar') return {pos: [0.5, 1.6, 1.65], yaw: 13, pitch: -2, fov: 36, W, H};
  // wide: k — progress of the camera move over the whole shot (0 — start)
  return {pos: [0.1, 1.55, -2.1 + 0.7 * k], yaw: 0, pitch: -5, fov: 60, W, H};
}

/** The room behind the counter: walls, floor, window, menu board, shelf of cups, the door. */
function room(o: Pal, doorOpen: number): RItem[] {
  const zb = ROOM.z1 - 0.01;
  const it: RItem[] = [
    {pts: flatY(0, ROOM.x0, ROOM.x1, -3, ROOM.z1), fill: o.floor},
    ...[-2, -1, 0, 1, 2].map((x): RItem => ({line: [[x * 0.6, 0.002, -3], [x * 0.6, 0.002, ROOM.z1]], stroke: o.trim, sw: 0.012})),
    {pts: flatY(ROOM.h, ROOM.x0, ROOM.x1, -3, ROOM.z1), fill: o.ceil},
    {pts: wallX(ROOM.x0, -3, ROOM.z1, 0, ROOM.h), fill: o.wallSide},
    {pts: wallX(ROOM.x1, -3, ROOM.z1, 0, ROOM.h), fill: o.wallSide},
    {pts: wallZ(ROOM.z1, ROOM.x0, ROOM.x1, 0, ROOM.h), fill: o.wall},
    // tiles along the bottom of the back wall
    {pts: wallZ(zb, ROOM.x0, ROOM.x1, 0, 0.9), fill: o.tile},
    {pts: wallZ(zb - 0.001, ROOM.x0, ROOM.x1, 0.88, 0.94), fill: o.brand, ol: false},
    // window: sky, a lower band of light, frame and a cross bar
    {pts: wallZ(zb, WIN.x0, WIN.x1, WIN.y0, WIN.y1), fill: o.sky},
    {pts: wallZ(zb - 0.002, WIN.x0, WIN.x1, WIN.y0, WIN.y0 + 0.4), fill: o.skyLow, ol: false},
    {line: [[WIN.x0, (WIN.y0 + WIN.y1) / 2, zb - 0.005], [WIN.x1, (WIN.y0 + WIN.y1) / 2, zb - 0.005]], stroke: o.trim, sw: 0.035},
    {pts: wallZ(zb - 0.01, WIN.x0 - 0.08, WIN.x1 + 0.08, WIN.y0 - 0.08, WIN.y0), fill: o.trim},
    // menu board over the shelf
    {pts: wallZ(zb, -1.65, -0.35, 1.75, 2.4), fill: '#2F3B36'},
    textOn('z', [-1.0, 2.2, zb - 0.01], 'MENU', 16, '#F5EFE2', {weight: 900}),
    ...[0, 1, 2].map((i): RItem => ({line: [[-1.45, 2.04 - i * 0.09, zb - 0.01], [-0.55 - (i % 2) * 0.2, 2.04 - i * 0.09, zb - 0.01]], stroke: '#C9D8D0', sw: 0.012})),
    // shelf of cups
    ...box(-1.8, 0.4, 1.52, 1.56, 5.75, 5.98, o.shelf, o.shelf),
    // doorway and the open leaf (hinge on the right jamb; open 0..1 — a quarter turn into the room)
    {pts: wallZ(zb, DOOR.x0, DOOR.x1, 0, DOOR.h), fill: o.doorway},
  ];
  ['#FFFFFF', o.brand, '#E9C46A', '#FFFFFF', o.brand, '#E76F51'].forEach((c, i) => {
    const x = -1.65 + i * 0.36;
    it.push(...box(x, x + 0.16, 1.56, 1.72, 5.8, 5.94, c, c));
  });
  const a = (doorOpen * Math.PI) / 2;
  const ex = DOOR.x1 - (DOOR.x1 - DOOR.x0) * Math.cos(a);
  const ez = ROOM.z1 - 0.02 - (DOOR.x1 - DOOR.x0) * Math.sin(a);
  it.push({pts: [[DOOR.x1, 0, ROOM.z1 - 0.02], [ex, 0, ez], [ex, DOOR.h, ez], [DOOR.x1, DOOR.h, ROOM.z1 - 0.02]], fill: o.wood, ...propMark('door', doorOpen.toFixed(2))} as RItem);
  return it;
}

/** The counter with a coffee machine and cups, and the pendant lamps above it. */
function counter(o: Pal): RItem[] {
  const top = COUNTER.h;
  return [
    ...box(COUNTER.x0, COUNTER.x1, 0, top - 0.05, COUNTER.z0 + 0.04, COUNTER.z1, o.tile, o.tile),
    ...box(COUNTER.x0, COUNTER.x1, 0.82, 0.88, COUNTER.z0 + 0.03, COUNTER.z0 + 0.05, o.brand, o.brand),
    ...box(COUNTER.x0 - 0.04, COUNTER.x1 + 0.04, top - 0.05, top, COUNTER.z0, COUNTER.z1 + 0.02, o.woodTop, o.wood),
    // coffee machine: body, top tray, a cup under the spout
    ...box(-1.65, -1.15, top, top + 0.42, 4.05, 4.4, '#3C3F44', '#55595F'),
    ...box(-1.68, -1.12, top + 0.42, top + 0.46, 4.03, 4.42, '#8D9298', '#8D9298'),
    ...box(-1.45, -1.33, top, top + 0.09, 4.05, 4.15, '#FFFFFF', '#FFFFFF'),
    // two cups at the end of the counter
    ...box(0.12, 0.22, top, top + 0.1, 4.05, 4.15, '#FFFFFF', '#FFFFFF'),
    ...box(0.3, 0.4, top, top + 0.1, 4.1, 4.2, o.brand, o.brand),
    // pendant lamps: a cord from the ceiling and a cone shade
    ...LAMPS.flatMap((x): RItem[] => [
      {line: [[x, ROOM.h, 4.2], [x, 2.3, 4.2]], stroke: o.trim, sw: 0.012},
      {pts: [[x - 0.07, 2.3, 4.2], [x + 0.07, 2.3, 4.2], [x + 0.2, 2.12, 4.2], [x - 0.2, 2.12, 4.2]], fill: o.brand},
    ]),
  ];
}

export const CafeKit: React.FC<KitProps> = ({shot, lt, f}) => {
  const {width: W, height: H} = useVideoConfig();
  const o = palOf(shot.preset);
  const dur = shot.end - shot.start;
  const u = dur > 0 ? lt / dur : 0;
  const view = shot.view === 'close-mira' || shot.view === 'close-oscar' ? shot.view : 'wide';
  const kMove = shot.move === 'push' ? smooth(u) : shot.move === 'pull' ? 1 - smooth(u) : 0; // cam: push-in / pull back over the whole shot
  const cam = camOf(view, kMove, W, H);
  const fl = focal(cam);
  const dopts = {outline: o.outline, olK: 1.4};
  const doorOpen = 0.8; // the door stands open in every shot of the example (no door events)

  // where everyone stands at this moment
  const member = (who: string): CastMember | undefined => shot.cast.find((m) => m.who === who);
  const oscar = member('OSCAR');
  const mira = member('MIRA');
  const op = oscar?.path?.length ? pathAt(oscar.path, u, dur) : {x: SPOTS.oscarCounter[0], z: SPOTS.oscarCounter[1], walk: 0};
  const POINTS: Record<string, V3> = {
    oscar: head('OSCAR', op.x, op.z),
    mira: head('MIRA', SPOTS.miraBar[0], SPOTS.miraBar[1]),
    window: [(WIN.x0 + WIN.x1) / 2, 1.5, ROOM.z1],
    door: [(DOOR.x0 + DOOR.x1) / 2, 1.5, ROOM.z1],
    counter: [-0.2, COUNTER.h, 4.2],
    cam: cam.pos,
  };

  // figures behind the counter are drawn before it, the others after it
  const behind: {z: number; node: React.ReactNode}[] = [];
  const front: {z: number; node: React.ReactNode}[] = [];
  const place = (m: CastMember, x: number, z: number, walk: number, base: string) => {
    const p = pt(cam, [x, 0, z]);
    if (!p) return;
    const g = gazeBy(cam, shot.stage, m.who, lt, head(m.who, x, z), m.facing, POINTS, base);
    (z > COUNTER.z0 ? behind : front).push({z: p.z, node: (
      <Figure key={m.who} m={m} x={p.x} y={p.y} ppm={fl / p.z} f={f} lt={lt} dur={dur} walk={walk} headTurn={g.headTurn} gazeX={g.gazeX} gazeY={g.gazeY}
        breath={view === 'wide' ? 1 : 0.4} />
    )});
  };
  if (oscar) place(oscar, op.x, op.z, op.walk, view === 'close-oscar' ? 'cam' : 'counter');
  if (mira) place(mira, SPOTS.miraBar[0], SPOTS.miraBar[1], 0, view === 'close-mira' ? 'cam' : 'oscar');
  const byDepth = (a: {z: number}, b: {z: number}) => b.z - a.z;

  const pools: RItem[] = [
    ...LAMPS.map((x) => floorPool(x, 3.6, 0.9, 0.7, o.light, o.pool)),
    wallGlowZ(ROOM.z1 - 0.03, -0.6, 2.0, 1.9, 0.8, o.light, o.pool * 0.6),
  ];
  const glows = LAMPS.map((x) => ({p: pt(cam, [x, 2.14, 4.2]), x}));
  return (
    <AbsoluteFill style={{background: o.wall, overflow: 'hidden'}}>
      <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0}}>
        {draw(cam, room(o, doorOpen), dopts)}
        {draw(cam, pools, dopts)}
      </svg>
      {behind.sort(byDepth).map((x) => x.node)}
      <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0}}>
        {draw(cam, counter(o), dopts, true)}
      </svg>
      {front.sort(byDepth).map((x) => x.node)}
      {glows.map(({p, x}) => (p ? <Glow key={x} x={p.x} y={p.y} r={(fl * 0.55) / p.z} color="255,226,170" intensity={0.55} /> : null))}
      <Vignette strength={0.35} color="40,26,16" />
    </AbsoluteFill>
  );
};
