// Props in hands — a shared library of items, the same for every drawing style. The body skeleton (lib/character/body.ts) places an item
// by the grip point of a hand and says how it is turned; a style draws it with drawItem, passing its own outline colour and width.
// Figure units: feet at (0, 0), height about 1010, y down.
import React from 'react';
import {n1, scaleHex} from '../anim';

type Pt = [number, number];

export type PhoneFace = 'screen' | 'back' | 'edge' | 'flat';
/** Items that hang from a fist (keys, a stamp) or lie in hooked fingers by their handle (a bag, a tote). */
export type Hang = 'keys' | 'stamp' | 'bag' | 'tote';

/** An item in a hand and its placement: folder — a sheet in a folder, centre at, rotation rot (°); flashlight — body centre at, axis —
 *  towards the lens, len — length factor; cup — centre at, scale; phone — centre at, angle (rad, 0 — upright), face (screen, back cover,
 *  edge, or lying flat screen up), scale, squeeze along the axis (the phone turning over its edge); box — a box at the waist held in both
 *  hands, half-width w; pen — tail and tip; hang — the item hangs from point at, swing — its rotation around it (°). */
export type Item =
  | {kind: 'folder'; at: Pt; rot: number}
  | {kind: 'flashlight'; at: Pt; axis: Pt; len: number}
  | {kind: 'cup'; at: Pt; scale: number}
  | {kind: 'phone'; at: Pt; angle: number; face: PhoneFace; scale: number; squeeze: number}
  | {kind: 'box'; w: number}
  | {kind: 'pen'; tail: Pt; tip: Pt}
  | {kind: 'hang'; what: Hang; at: Pt; swing: number};

/** How a style draws props: outline colour and width (figure units), the folder colour of the role's outfit. */
export type PropStyle = {line: string; sw: number; folder: string};

/** A folder with a sheet of paper: a header and text lines. */
function folder(it: Extract<Item, {kind: 'folder'}>, {line: L, sw, folder: col}: PropStyle) {
  return (
    <g transform={`translate(${n1(it.at[0])} ${n1(it.at[1])}) rotate(${n1(it.rot)})`}>
      <rect x={-62} y={-80} width={124} height={160} rx={7} fill={col} stroke={L} strokeWidth={sw} />
      <rect x={-48} y={-94} width={100} height={118} rx={4} fill="#fbf7ea" stroke={L} strokeWidth={sw * 0.7} />
      <rect x={-38} y={-82} width={54} height={11} rx={3} fill="#c8352d" />
      {[0, 1, 2].map((i) => <rect key={i} x={-38} y={-63 + i * 17} width={i === 2 ? 46 : 74} height={6} rx={3} fill="#9aa3b5" />)}
      <rect x={-62} y={16} width={124} height={11} fill={scaleHex(col, 0.8)} />
    </g>
  );
}

function flashlight(it: Extract<Item, {kind: 'flashlight'}>, {line: L, sw}: PropStyle) {
  const ang = (Math.atan2(it.axis[1], it.axis[0]) * 180) / Math.PI;
  return (
    <g transform={`translate(${n1(it.at[0])} ${n1(it.at[1])}) rotate(${n1(ang)}) scale(${n1(it.len)} 1)`}>
      <rect x={-40} y={-12} width={74} height={24} rx={7} fill="#3a4152" stroke={L} strokeWidth={sw * 0.8} />
      <path d="M 30 -13 L 52 -18 L 52 18 L 30 13 Z" fill="#4b5468" stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />
      <ellipse cx={52} cy={0} rx={6} ry={16} fill="#fff6c8" stroke={L} strokeWidth={sw * 0.5} />
    </g>
  );
}

function cup(it: Extract<Item, {kind: 'cup'}>, {line: L, sw}: PropStyle) {
  const sc = it.scale;
  return (
    <g transform={`translate(${n1(it.at[0])} ${n1(it.at[1])}) scale(${sc})`}>
      <path d="M -30 -44 L 30 -44 L 24 40 L -24 40 Z" fill="#C4C9D1" stroke={L} strokeWidth={(sw * 0.8) / sc} strokeLinejoin="round" />
      <ellipse cx={0} cy={-44} rx={30} ry={9} fill="#B5873A" stroke={L} strokeWidth={(sw * 0.6) / sc} />
      <path d="M -10 -64 q 7 -12 0 -24 M 9 -62 q 7 -12 0 -24" stroke="#F4F0EA" strokeWidth={4.5 / sc} fill="none" strokeLinecap="round" />
    </g>
  );
}

/** A phone: upright with the screen or the back cover (camera) towards the viewer, on its edge, or lying screen up on the palm (seen from
 *  above: a light screen with rows of dial keys). */
function phone(it: Extract<Item, {kind: 'phone'}>, {line: L, sw}: PropStyle) {
  const {at, angle, face, scale: sc, squeeze: sy} = it;
  return (
    <g transform={`translate(${n1(at[0])} ${n1(at[1])}) rotate(${n1((angle * 180) / Math.PI)}) scale(${sc} ${n1(sc * sy)})`}>
      {face === 'flat' ? (
        <>
          <rect x={-28} y={-19} width={56} height={38} rx={8} fill="#23262F" stroke={L} strokeWidth={sw * 0.7} />
          <rect x={-22} y={-14} width={44} height={28} rx={3} fill="#9FD3FF" />
          {[0, 1, 2].map((i) => [0, 1, 2].map((j) => <rect key={`${i}${j}`} x={-14 + j * 10} y={-9.5 + i * 7.5} width={7} height={4} rx={1.8} fill="#5E8FBF" />))}
        </>
      ) : face === 'edge' ? (
        <rect x={-9} y={-46} width={18} height={92} rx={6} fill="#23262F" stroke={L} strokeWidth={sw * 0.7} />
      ) : (
        <>
          <rect x={-25} y={-46} width={50} height={92} rx={9} fill="#23262F" stroke={L} strokeWidth={sw * 0.7} />
          {face === 'screen' ? <rect x={-18} y={-38} width={36} height={70} rx={4} fill="#9FD3FF" /> : (
            <>
              <rect x={-17} y={-37} width={20} height={26} rx={6} fill="#363A46" />
              <circle cx={-10} cy={-30} r={4.5} fill="#11131A" />
              <circle cx={-10} cy={-18} r={4.5} fill="#11131A" />
            </>
          )}
        </>
      )}
    </g>
  );
}

function box(bw: number, {line: L, sw}: PropStyle) {
  return (
    <g>
      <rect x={-bw} y={-560} width={2 * bw} height={160} rx={6} fill="#C99A5B" stroke={L} strokeWidth={sw} />
      <rect x={-bw} y={-560} width={2 * bw} height={28} fill="#B3854A" stroke={L} strokeWidth={sw * 0.6} />
      <rect x={-16} y={-560} width={32} height={160} fill="#E6D3A0" opacity={0.9} />
      <rect x={-bw * 0.62} y={-508} width={60} height={40} rx={4} fill="#F4F1EA" stroke={L} strokeWidth={3} />
    </g>
  );
}

function pen(tail: Pt, tip: Pt, {line: L}: PropStyle) {
  const l = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]) || 1;
  const nib: Pt = [tip[0] - ((tip[0] - tail[0]) / l) * 10, tip[1] - ((tip[1] - tail[1]) / l) * 10];
  const P = (q: Pt) => `${n1(q[0])} ${n1(q[1])}`;
  return (
    <g>
      <path d={`M ${P(tail)} L ${P(tip)}`} stroke={L} strokeWidth={13} strokeLinecap="round" />
      <path d={`M ${P(tail)} L ${P(nib)}`} stroke="#2456c8" strokeWidth={7} strokeLinecap="round" />
      <path d={`M ${P(nib)} L ${P(tip)}`} stroke="#D9DCE3" strokeWidth={6} strokeLinecap="round" />
    </g>
  );
}

/** A hanging item drawn with its hanging point at the origin. */
function hang(what: Hang, {line: L, sw}: PropStyle) {
  switch (what) {
    case 'keys':
      // a ring and keys with a dark outline, so they do not vanish on a light background
      return (
        <g>
          <circle cx={0} cy={20} r={20} fill="none" stroke={L} strokeWidth={7 + sw} />
          {[-1, 0, 1].map((k) => <path key={`o${k}`} d={`M ${k * 12} 36 l ${k * 6} 44`} stroke={L} strokeWidth={9 + sw} strokeLinecap="round" />)}
          <circle cx={0} cy={20} r={20} fill="none" stroke="#C4C9D1" strokeWidth={7} />
          {[-1, 0, 1].map((k) => <path key={k} d={`M ${k * 12} 36 l ${k * 6} 44`} stroke="#E8B23A" strokeWidth={9} strokeLinecap="round" />)}
        </g>
      );
    case 'stamp':
      // a rubber stamp held by the handle: the knob is in the fist, the stem and the base hang below
      return (
        <g>
          <rect x={-10} y={-24} width={20} height={58} fill="#8A5A34" stroke={L} strokeWidth={sw * 0.6} />
          <rect x={-30} y={30} width={60} height={22} rx={4} fill="#C8352D" stroke={L} strokeWidth={sw * 0.7} />
        </g>
      );
    case 'bag':
      return (
        <g>
          <path d="M -60 40 L 0 0 L 60 40" fill="none" stroke="#2a2a30" strokeWidth={10} />
          <rect x={-90} y={30} width={180} height={150} rx={12} fill="#E2462F" stroke={L} strokeWidth={sw} />
          <rect x={-90} y={30} width={180} height={30} rx={10} fill="#C9CED8" stroke={L} strokeWidth={sw * 0.6} />
          <rect x={-60} y={90} width={120} height={14} rx={7} fill="#F4C430" />
        </g>
      );
    case 'tote':
      return (
        <g>
          <path d="M -34 40 Q 0 -30 34 40" fill="none" stroke={L} strokeWidth={10} />
          <path d="M -70 36 L 70 36 L 82 200 L -82 200 Z" fill="#D9A441" stroke={L} strokeWidth={sw * 0.9} strokeLinejoin="round" />
          <rect x={-40} y={90} width={80} height={50} rx={6} fill="#C0603A" opacity={0.85} />
        </g>
      );
  }
}

/** Draws an item placed by the body skeleton. */
export function drawItem(it: Item, st: PropStyle): React.ReactNode {
  switch (it.kind) {
    case 'folder':
      return folder(it, st);
    case 'flashlight':
      return flashlight(it, st);
    case 'cup':
      return cup(it, st);
    case 'phone':
      return phone(it, st);
    case 'box':
      return box(it.w, st);
    case 'pen':
      return pen(it.tail, it.tip, st);
    case 'hang':
      return <g transform={`translate(${n1(it.at[0])} ${n1(it.at[1])})${it.swing ? ` rotate(${n1(it.swing)})` : ''}`}>{hang(it.what, st)}</g>;
  }
}
