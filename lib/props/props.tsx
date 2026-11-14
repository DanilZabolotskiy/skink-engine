// Props in hands — a shared library of items, the same for every drawing style. The body skeleton (lib/character/body.ts) places an item
// by the grip point of a hand and says how it is turned; a style draws it with drawItem, passing its own outline colour and width.
// Figure units: feet at (0, 0), height about 1010, y down.
import React from 'react';
import {n1, scaleHex} from '../anim';

type Pt = [number, number];

export type PhoneFace = 'screen' | 'back' | 'edge' | 'flat';
/** Items that hang from a fist (keys, a stamp) or lie in hooked fingers by their handle (a bag, a tote). */
export type Hang = 'keys' | 'stamp' | 'bag' | 'tote';

/** The look of a role's phone (Look.phone), so the phone in the hand is the same model as the one a kit draws on a table or in a box:
 *  screen — the screen colour (a dark one reads as switched off and gets a glare), keys — the dial keys on the screen of a phone lying on
 *  the palm, crack — a crack across the upper corner of the screen, body — the body colour, sc — a scale. No field — the default phone (a
 *  light blue screen with dial keys). */
export type PhoneLook = {screen?: string; keys?: boolean; crack?: boolean; body?: string; sc?: number};
/** The look of a box held in both hands (Look.box), so it matches the box a kit draws on the floor or a counter: fill, top — the colours
 *  of the front and the top face, tape, label — the tape and the shipping label, stain — wet cardboard: a dark stain from the bottom with
 *  a wavy edge and drips, edge — the colour of their line (default — the outline). No field — the default light kraft box. */
export type BoxLook = {fill?: string; top?: string; tape?: string; label?: string; stain?: string; edge?: string};

/** An item in a hand and its placement: folder — a sheet in a folder, centre at, rotation rot (°); flashlight — body centre at, axis —
 *  towards the lens, len — length factor; cup — centre at, scale; phone — centre at, angle (rad, 0 — upright), face (screen, back cover,
 *  edge, or lying flat screen up), scale, squeeze along the axis (the phone turning over its edge), look — the role's phone; box — a box at
 *  the waist held in both hands, half-width w, look — the role's box; pen — tail and tip; hang — the item hangs from point at, swing — its
 *  rotation around it (°), strap — the colour of a bag strap drawn over its outline (a dark strap over dark trousers does not read; no
 *  field — the default thin dark strap); mop — the clamp at base, the handle up to top, the rag hangs rag units down from the clamp,
 *  spread 0..1 — the strands spread on the floor. */
export type Item =
  | {kind: 'folder'; at: Pt; rot: number}
  | {kind: 'flashlight'; at: Pt; axis: Pt; len: number}
  | {kind: 'cup'; at: Pt; scale: number}
  | {kind: 'phone'; at: Pt; angle: number; face: PhoneFace; scale: number; squeeze: number; look?: PhoneLook}
  | {kind: 'box'; w: number; look?: BoxLook}
  | {kind: 'pen'; tail: Pt; tip: Pt}
  | {kind: 'hang'; what: Hang; at: Pt; swing: number; strap?: string}
  | {kind: 'mop'; base: Pt; top: Pt; rag: number; spread: number};

/** A bag strap with its own colour (Item hang → strap): a curve over the handle point with an outline. */
const BAG_STRAP = 'M -56 40 Q -8 -6 0 -4 Q 8 -6 56 40';

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
 *  above: a light screen with rows of dial keys); the role's look (PhoneLook) sets its colours, keys, crack and scale. */
function phone(it: Extract<Item, {kind: 'phone'}>, {line: L, sw}: PropStyle) {
  const {at, angle, face, scale: sc0, squeeze: sy, look: ph} = it;
  const body = ph?.body ?? '#23262F', scr = ph?.screen ?? '#9FD3FF', keys = ph?.keys ?? true;
  const sc = sc0 * (ph?.sc ?? 1);
  // a dark screen (switched off) gets a glare; the crack line is lighter on it
  const dark = (parseInt(scr.slice(1, 3), 16) + parseInt(scr.slice(3, 5), 16) + parseInt(scr.slice(5, 7), 16)) / 3 < 70;
  const crack = dark ? '#8A909A' : '#5A6470';
  return (
    <g transform={`translate(${n1(at[0])} ${n1(at[1])}) rotate(${n1((angle * 180) / Math.PI)}) scale(${sc} ${n1(sc * sy)})`}>
      {face === 'flat' ? (
        <>
          <rect x={-28} y={-19} width={56} height={38} rx={8} fill={body} stroke={L} strokeWidth={sw * 0.7} />
          <rect x={-22} y={-14} width={44} height={28} rx={3} fill={scr} />
          {keys && [0, 1, 2].map((i) => [0, 1, 2].map((j) => <rect key={`${i}${j}`} x={-14 + j * 10} y={-9.5 + i * 7.5} width={7} height={4} rx={1.8} fill="#5E8FBF" />))}
          {dark && <path d="M -18 10 L -8 -12" stroke="#FFFFFF" strokeWidth={2.2} opacity={0.18} strokeLinecap="round" />}
          {ph?.crack && <path d="M 22 -8 L 15 -5 L 17 -1 L 10 3 M 15 -5 L 11 -14 M 17 -1 L 22 1" stroke={crack} strokeWidth={1.3} fill="none" strokeLinejoin="round" />}
        </>
      ) : face === 'edge' ? (
        <rect x={-9} y={-46} width={18} height={92} rx={6} fill={body} stroke={L} strokeWidth={sw * 0.7} />
      ) : (
        <>
          <rect x={-25} y={-46} width={50} height={92} rx={9} fill={body} stroke={L} strokeWidth={sw * 0.7} />
          {face === 'screen' ? (
            <>
              <rect x={-18} y={-38} width={36} height={70} rx={4} fill={scr} />
              {ph?.crack && <path d="M 18 -27 L 11 -22 L 13 -17 L 6 -12 M 11 -22 L 7 -38 M 13 -17 L 18 -15" stroke={crack} strokeWidth={1.3} fill="none" strokeLinejoin="round" />}
            </>
          ) : (
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

/** A box at the waist; the role's look (BoxLook) sets its colours and a wet stain. */
function box(bw: number, {line: L, sw}: PropStyle, bx?: BoxLook) {
  // wet cardboard: a dark stain from the bottom up to a wavy line, two drips from above down to it
  const wave = (x: number) => -462 + 9 * Math.sin((x / bw) * 2.9 + 0.6) + 5 * Math.sin((x / bw) * 7.3);
  const wavePts = Array.from({length: 13}, (_, i) => {
    const x = -bw + (2 * bw * i) / 12;
    return `${n1(x)} ${n1(wave(x))}`;
  });
  return (
    <g>
      <rect x={-bw} y={-560} width={2 * bw} height={160} rx={6} fill={bx?.fill ?? '#C99A5B'} stroke={L} strokeWidth={sw} />
      {bx?.stain && (
        <>
          <path d={`M ${n1(-bw)} -402 L ${wavePts.join(' L ')} L ${n1(bw)} -402 Z`} fill={bx.stain} />
          <path d={`M ${wavePts.join(' L ')}`} fill="none" stroke={bx.edge ?? L} strokeWidth={sw * 0.5} />
          {[-0.55, 0.5].map((f) => <path key={f} d={`M ${n1(f * bw)} -530 L ${n1(f * bw + 3)} ${n1(wave(f * bw))}`} stroke={bx.edge ?? L} strokeWidth={sw * 0.7} strokeLinecap="round" />)}
        </>
      )}
      <rect x={-bw} y={-560} width={2 * bw} height={28} fill={bx?.top ?? '#B3854A'} stroke={L} strokeWidth={sw * 0.6} />
      <rect x={-16} y={-560} width={32} height={160} fill={bx?.tape ?? '#E6D3A0'} opacity={0.9} />
      <rect x={-bw * 0.62} y={-508} width={60} height={40} rx={4} fill={bx?.label ?? '#F4F1EA'} stroke={L} strokeWidth={3} />
      {/* the stain covers the outline of the front face at the bottom: the outline again on top */}
      {bx?.stain && <rect x={-bw} y={-560} width={2 * bw} height={160} rx={6} fill="none" stroke={L} strokeWidth={sw} />}
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

/** A mop: the rag — a bunch of strands from the clamp that hangs down and spreads a little on the floor, the handle from the clamp to the
 *  top, the clamp over both. */
function mop(it: Extract<Item, {kind: 'mop'}>, {line: L, sw}: PropStyle) {
  const B = it.base;
  const du: Pt = [it.top[0] - B[0], it.top[1] - B[1]];
  const len = Math.hypot(du[0], du[1]) || 1;
  const nx = (-du[1] / len) * 8;
  const ny = (du[0] / len) * 8;
  const rag = '#CFC8B8';
  const sp = it.spread;
  const strands = [-3, -2, -1, 0, 1, 2, 3].map((i) => ({
    x0: B[0] + i * 6,
    x1: B[0] + i * (9 + 5 * sp) + (i % 2 ? 3 : -2),
    y1: B[1] + it.rag - 6 + (Math.abs(i) % 2 ? -5 : 0) - 4 * Math.abs(i) * sp,
  }));
  const blob = `M ${n1(B[0] - 22)} ${n1(B[1] + 6)} C ${n1(B[0] - 30)} ${n1(B[1] + 40)} ${n1(B[0] - 34 - 18 * sp)} ${n1(B[1] + 80)} ${n1(strands[0].x1 - 6)} ${n1(strands[0].y1)} ` +
    strands.map((q) => `Q ${n1(q.x1)} ${n1(q.y1 + 12)} ${n1(q.x1 + 6)} ${n1(q.y1)}`).join(' ') +
    ` C ${n1(B[0] + 34 + 18 * sp)} ${n1(B[1] + 80)} ${n1(B[0] + 30)} ${n1(B[1] + 40)} ${n1(B[0] + 22)} ${n1(B[1] + 6)} Z`;
  return (
    <g>
      <path d={blob} fill={rag} stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" />
      {strands.map((q, i) => <path key={i} d={`M ${n1(q.x0)} ${n1(B[1] + 12)} Q ${n1((q.x0 + q.x1) / 2 + (i % 2 ? 3 : -3))} ${n1(B[1] + it.rag * 0.55)} ${n1(q.x1)} ${n1(q.y1 - 4)}`}
        stroke={scaleHex(rag, 0.74)} strokeWidth={3.5} fill="none" strokeLinecap="round" />)}
      <path d={`M ${n1(it.top[0] - nx)} ${n1(it.top[1] - ny)} L ${n1(it.top[0] + nx)} ${n1(it.top[1] + ny)} L ${n1(B[0] + nx)} ${n1(B[1] + ny)} L ${n1(B[0] - nx)} ${n1(B[1] - ny)} Z`}
        fill="#A57A4E" stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" />
      <rect x={n1(B[0] - 26)} y={n1(B[1] - 4)} width={52} height={18} rx={5} fill="#7E858F" stroke={L} strokeWidth={sw * 0.6} />
    </g>
  );
}

/** A hanging item drawn with its hanging point at the origin. */
function hang(what: Hang, {line: L, sw}: PropStyle, strap?: string) {
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
          {strap ? (
            <g fill="none" strokeLinejoin="round">
              <path d={BAG_STRAP} stroke={L} strokeWidth={20} />
              <path d={BAG_STRAP} stroke={strap} strokeWidth={11} />
            </g>
          ) : <path d="M -60 40 L 0 0 L 60 40" fill="none" stroke="#2a2a30" strokeWidth={10} />}
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
      return box(it.w, st, it.look);
    case 'pen':
      return pen(it.tail, it.tip, st);
    case 'hang':
      return <g transform={`translate(${n1(it.at[0])} ${n1(it.at[1])})${it.swing ? ` rotate(${n1(it.swing)})` : ''}`}>{hang(it.what, st, it.strap)}</g>;
    case 'mop':
      return mop(it, st);
  }
}
