// Body of the western style: a round-headed cartoon figure with a thick outline. It draws the pose solved by the core
// (lib/character/body.ts): a long top over the hips in the torso space of the western figure, plain legs and shoes, every arm as one thick
// rounded stroke from the shoulder through the elbow to the wrist, mitten hands in the hand frame and the props of lib/props.
import React from 'react';
import {n1, noise1, polyline, scaleHex, smooth} from '../../anim';
import {Outfit} from '../../character/Character';
import {HIP, Hand, Layer, NECKB, SHY} from '../../character/body';
import {handMatrix} from '../../character/hand';
import {Look} from '../../character/looks';
import type {BodyIn, BodyOut} from '../../character/style';
import {drawItem} from '../../props/props';
import {OL} from './head';

type Pt = [number, number];
const P = polyline;
/** The torso is drawn with its shoulders at y = −690 and moved onto the shoulder line of the body. */
const TORSO_DY = SHY + 690;

const torsoPath = (w: number, long = 0) => {
  const a = (x: number) => (x * w).toFixed(1);
  const yb = -362 + long;
  return `M ${a(-108)} -690 Q ${a(-132)} -540 ${a(-112 - long * 0.1)} ${yb} L ${a(112 + long * 0.1)} ${yb} Q ${a(132)} -540 ${a(108)} -690 Q 0 -728 ${a(-108)} -690 Z`;
};

/** Torso by the type of top, in the torso space of the western figure (shoulders at y = −690, hem at −362 + long). */
function torsoOf(o: Outfit, look: Look, uid: string, back: boolean, w: number, breathS: number, skin: string, badgeTurn: number): React.ReactNode {
  const L = o.line;
  const sw = OL;
  const top = look.top;
  const long = top === 'padded' ? 46 : 0;
  const dark = scaleHex(o.top, 0.7);
  const parts: React.ReactNode[] = [];
  const fill = top === 'undershirt' ? o.top : `url(#top${uid})`;
  parts.push(<path key="t" d={torsoPath(w, long)} fill={fill} stroke={L} strokeWidth={sw} strokeLinejoin="round" />);
  if (top === 'padded') {
    for (let y = -640; y < -362 + long - 10; y += 52) parts.push(<path key={`q${y}`} d={`M ${-118 * w} ${y} Q 0 ${y + 14} ${118 * w} ${y}`} stroke={dark} strokeWidth={6} fill="none" />);
  }
  if (top === 'jacket') {
    parts.push(<path key="hem" d={`M ${-110 * w} -392 L ${110 * w} -392`} stroke={scaleHex(o.top, 0.78)} strokeWidth={18} />);
    if (back) parts.push(<path key="seam" d="M 0 -690 L 0 -400" stroke={scaleHex(o.top, 0.82)} strokeWidth={4} />);
  }
  if (back && look.lanyard) parts.push(<path key="ly" d="M -40 -712 Q 0 -700 40 -712" fill="none" stroke={o.lanyard} strokeWidth={9} />);
  if (!back) {
    if (top === 'jacket') {
      parts.push(<path key="v" d="M -38 -712 L 38 -712 L 0 -548 Z" fill={o.shirt} stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" />);
      parts.push(<path key="c" d="M -38 -712 L -8 -676 L -2 -706 Z M 38 -712 L 8 -676 L 2 -706 Z" fill="#ffffff" stroke={L} strokeWidth={sw * 0.6} strokeLinejoin="round" />);
      [-505, -455, -405].forEach((yy) => parts.push(<circle key={yy} cx={0} cy={yy} r={7} fill={scaleHex(o.top, 0.55)} />));
    } else if (top === 'cardigan') {
      parts.push(<path key="v" d="M -40 -712 L 40 -712 L 0 -560 Z" fill={o.shirt} stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" />);
      parts.push(<path key="c" d="M -40 -712 Q -26 -690 -6 -690 L 0 -700 Z M 40 -712 Q 26 -690 6 -690 L 0 -700 Z" fill="#ffffff" stroke={L} strokeWidth={sw * 0.5} />);
      [-530, -480, -430].forEach((yy) => parts.push(<circle key={yy} cx={0} cy={yy} r={8} fill={scaleHex(o.top, 1.3)} stroke={L} strokeWidth={3} />));
      parts.push(<path key="l" d="M 0 -560 L 0 -362" stroke={dark} strokeWidth={5} />);
      parts.push(<rect key="h" x={-112 * w} y={-392} width={224 * w} height={18} fill={dark} />);
      parts.push(<rect key="pk1" x={-90 * w} y={-470} width={46} height={40} rx={6} fill="none" stroke={dark} strokeWidth={5} />);
      parts.push(<rect key="pk2" x={90 * w - 46} y={-470} width={46} height={40} rx={6} fill="none" stroke={dark} strokeWidth={5} />);
    } else if (top === 'padded') {
      parts.push(<path key="col" d="M -66 -734 Q -70 -690 -40 -680 L -10 -650 L -10 -712 Z M 66 -734 Q 70 -690 40 -680 L 10 -650 L 10 -712 Z" fill={o.top} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />);
      parts.push(<path key="z" d={`M 0 -650 L 0 ${-362 + long}`} stroke={dark} strokeWidth={6} />);
      parts.push(<path key="pk" d={`M ${-96 * w} -470 l 50 -8 M ${96 * w} -470 l -50 -8`} stroke={dark} strokeWidth={6} strokeLinecap="round" />);
    } else if (top === 'hoodie') {
      parts.push(<path key="pocket" d={`M ${-80 * w} -476 L ${80 * w} -476 L ${96 * w} -392 L ${-96 * w} -392 Z`} fill="none" stroke={dark} strokeWidth={6} strokeLinejoin="round" />);
      parts.push(<path key="neck" d="M -44 -716 Q 0 -676 44 -716" fill="none" stroke={dark} strokeWidth={8} />);
      parts.push(<path key="str" d="M -22 -700 L -26 -600 M 22 -700 L 26 -600" stroke="#f2f2f2" strokeWidth={7} strokeLinecap="round" />);
      parts.push(<rect key="hem" x={-112 * w} y={-392} width={224 * w} height={22} fill={dark} />);
    } else if (top === 'undershirt') {
      parts.push(<path key="neck" d="M -62 -706 Q 0 -590 62 -706 Z" fill={skin} stroke={L} strokeWidth={sw * 0.7} />);
      parts.push(<path key="la" d={`M ${-108 * w} -690 L ${-70 * w} -704 Q ${-80 * w} -640 ${-120 * w} -590 Z`} fill={skin} stroke={L} strokeWidth={sw * 0.6} strokeLinejoin="round" />);
      parts.push(<path key="ra" d={`M ${108 * w} -690 L ${70 * w} -704 Q ${80 * w} -640 ${120 * w} -590 Z`} fill={skin} stroke={L} strokeWidth={sw * 0.6} strokeLinejoin="round" />);
    } else if (top === 'tshirt') {
      parts.push(<path key="neck" d="M -46 -712 Q 0 -668 46 -712" fill={skin} stroke={L} strokeWidth={sw * 0.7} />);
    } else if (top === 'blouse') {
      parts.push(<path key="neck" d="M -44 -714 Q 0 -660 44 -714" fill={skin} stroke={L} strokeWidth={sw * 0.6} />);
      parts.push(<path key="col" d="M -46 -716 Q -60 -676 -4 -672 Q -10 -700 -46 -716 Z M 46 -716 Q 60 -676 4 -672 Q 10 -700 46 -716 Z" fill="#ffffff" stroke={L} strokeWidth={sw * 0.5} />);
    }
  }
  if (!back && look.lanyard) {
    parts.push(<path key="ly" d="M -30 -706 L -6 -560 M 30 -706 L 6 -560" stroke={o.lanyard} strokeWidth={9} strokeLinecap="round" />);
    parts.push(
      <g key="badge" transform={`rotate(${n1(badgeTurn)} 0 -560)`}>
        <rect x={-32} y={-566} width={64} height={84} rx={7} fill="#f3f5fb" stroke={L} strokeWidth={sw * 0.7} />
        <rect x={-32} y={-566} width={64} height={18} rx={5} fill={o.lanyard} />
        <rect x={-22} y={-540} width={22} height={26} rx={3} fill="#9fb4d6" />
        <rect x={5} y={-538} width={18} height={6} rx={3} fill="#7b8396" />
        <rect x={5} y={-526} width={14} height={6} rx={3} fill="#7b8396" />
        <rect x={-22} y={-506} width={44} height={8} rx={4} fill="#c8352d" />
      </g>,
    );
  }
  return <g transform={`translate(0 -362) scale(1 ${breathS}) translate(0 362)`}>{parts}</g>;
}


/** A mitten hand in the hand frame: a palm with a thumb; an open hand is longer, a closed one rounder. count raises the fingers one by
 *  one (q — how many are raised): every finger unfolds smoothly, so it does not appear within a frame. */
function mitten(h: Hand, fill: string, line: string, key: string): React.ReactNode {
  const sw = (OL * 0.75) / h.k;
  const open = ['relaxed', 'open', 'flat', 'point', 'count'].includes(h.shape);
  const thumb = h.view === 'dorsal' || h.view === 'palmar';
  const up = (i: number) => smooth(h.q - i); // 0 — folded on the palm, 1 — raised
  return (
    <g key={key} transform={handMatrix(h.W, h.f, h.u, h.k)}>
      {h.shape === 'count' && [0, 1, 2, 3].map((i) => (
        <rect key={i} x={-11 + i * 7.4 - 3.6} y={28} width={7.2} height={12 + 30 * up(i)} rx={3.6} fill={fill} stroke={line} strokeWidth={sw * 0.8} />
      ))}
      <ellipse cx={0} cy={open ? 24 : 21} rx={open ? 15 : 16} ry={open ? 23 : 18} fill={fill} stroke={line} strokeWidth={sw} />
      {thumb && <ellipse cx={13} cy={12} rx={5.5} ry={10} transform="rotate(-25 13 12)" fill={fill} stroke={line} strokeWidth={sw * 0.8} />}
    </g>
  );
}

export function westernBody(p: BodyIn): BodyOut {
  const {o, look, uid, back, body, breathS} = p;
  const L = o.line;
  const sw = OL;
  const skin = o.skin;
  const w = look.w ?? 1;
  const sk = look.bottom === 'skirt';
  const defs = (
    <defs>
      <linearGradient id={`top${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={scaleHex(o.top, 1.08)} />
        <stop offset="1" stopColor={scaleHex(o.top, 0.72)} />
      </linearGradient>
      <linearGradient id={`trs${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={o.trousers} />
        <stop offset="1" stopColor={scaleHex(o.trousers, 0.6)} />
      </linearGradient>
    </defs>
  );
  // legs from the hips down: the step lifts the foot in place (lib/character/walk.ts)
  const leg = (s: number) => {
    const a = (x: number) => n1(s * x * w);
    const dy = -body.liftH * body.lift[s < 0 ? 0 : 1];
    return (
      <g key={s} transform={`translate(0 ${n1(dy)})`}>
        <path d={sk ? `M ${a(70)} -300 L ${a(68)} -48 Q ${a(48)} -38 ${a(26)} -48 L ${a(24)} -300 Z` : `M ${a(92)} ${HIP} L ${a(88)} -48 Q ${a(58)} -36 ${a(24)} -48 L ${a(10)} ${HIP} Z`}
          fill={sk ? scaleHex(o.trousers, 0.5) : `url(#trs${uid})`} stroke={L} strokeWidth={sw} strokeLinejoin="round" />
        <ellipse cx={s * 60 * w} cy={-30} rx={back ? 44 : 50} ry={28} fill={o.shoes} stroke={L} strokeWidth={sw} />
      </g>
    );
  };
  const legs = (
    <g>
      {defs}
      {leg(-1)}
      {leg(1)}
      {sk && <path d={`M ${n1(-112 * w)} ${HIP} L ${n1(112 * w)} ${HIP} L ${n1(140 * w)} -214 Q 0 -196 ${n1(-140 * w)} -214 Z`} fill={o.trousers} stroke={L} strokeWidth={sw} strokeLinejoin="round" />}
    </g>
  );
  const bobT = body.bob ? ` translate(0 ${n1(body.bob)})` : '';
  const torso = <g transform={`translate(0 ${TORSO_DY})${bobT}`}>{torsoOf(o, look, uid, back, w, breathS, skin, 2 * noise1(`${p.seed}badge`, p.t * 0.7))}</g>;

  // arms: one thick rounded stroke per arm through the shoulder, the elbow and the wrist of the skeleton
  const bare = look.top === 'undershirt';
  const short = look.top === 'tshirt';
  const aw = body.armW + 4;
  const ps = {line: L, sw: sw * 0.8, folder: o.folder};
  const handFill = p.mark ? '#FF00FF' : skin;
  const layer = (l: Layer, key: string): React.ReactNode => {
    if (l.t === 'item') return <g key={key}>{drawItem(l.item, ps)}</g>;
    if (l.t === 'hand') return l.back ? null : mitten(l.h, handFill, L, key);
    const S: Pt = [l.S[0], l.S[1]];
    const E: Pt = [l.E[0], l.E[1]];
    const d = P(l.part === 'upper' ? [S, E] : [S, E, [l.W[0], l.W[1]]]);
    const mid: Pt = [(S[0] + E[0]) / 2, (S[1] + E[1]) / 2];
    return (
      <g key={key}>
        <path d={d} fill="none" stroke={L} strokeWidth={aw + 2 * sw} strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} fill="none" stroke={bare || short ? skin : `url(#top${uid})`} strokeWidth={aw} strokeLinecap="round" strokeLinejoin="round" />
        {short && <path d={P([S, mid])} fill="none" stroke={`url(#top${uid})`} strokeWidth={aw + 4} strokeLinecap="round" />}
      </g>
    );
  };
  const draw = (over: boolean) => body.arms.filter((a) => a.over === over).map((a, i) => <g key={i}>{a.layers.map((l, j) => layer(l, `${i}.${j}`))}</g>);
  const armT = body.bob ? `translate(0 ${n1(body.bob)})` : undefined;
  // the neck hides under the big head: the collar is closed for the neck fit of the core
  return {legs, torso, arms: <g transform={armT}>{draw(false)}</g>, over: <g transform={armT}>{draw(true)}</g>, neck: {y: NECKB, y0: NECKB, stoop: 16 * body.stoop, open: false}};
}
