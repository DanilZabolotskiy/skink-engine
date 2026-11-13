// Body of the webtoon style: adult proportions (5–6 heads tall), narrow shoulders, long arms and legs, adult hands and feet; flat fills
// with one step of shade. It draws the pose solved by the core (lib/character/body.ts): the torso and the clothes by the top of the
// look, the legs with the foot lift of the step, every arm as tapering sleeve capsules with the hands of ./hands.tsx in the hand frame,
// and the props of lib/props.
import React from 'react';
import {clamp, lerp, mixHex, n1, polyline, scaleHex} from '../../anim';
import {ARM_L1, Pt, V3} from '../../character/arm';
import {HIP, Layer, NECKB} from '../../character/body';
import {handMatrix} from '../../character/hand';
import type {BodyIn, BodyOut} from '../../character/style';
import {drawItem} from '../../props/props';
import {HandStyle, handParts} from './hands';
import {crOpen, skinOf, SW} from './common';

const P = polyline;

export function webtoonBody(p: BodyIn): BodyOut {
  const {o, uid, back, look, body} = p;
  const {fem, w, sx, cx0, wx, hx, shY, stoop, run, bob, armW} = body;
  const L = o.line;
  const sw = SW;
  const skin = skinOf(o, look);
  const top = look.top;
  const skirt = look.bottom === 'skirt';
  const shadeOf = (c: string) => scaleHex(c, 0.82);

  // ---------- torso silhouette ----------
  const long = top === 'padded' ? 54 : top === 'jacket' ? 20 : 0; // clothes below the hips
  const hemY = HIP + 14 + long;
  // bare shoulder (undershirt): no "box" corner or joint — the neck line goes down to the shoulder, the deltoid is rounded into the arm
  const bareSh = top === 'undershirt';
  const side = (s: number): Pt[] => [
    [s * 30, NECKB],
    ...((bareSh
      ? [[s * (sx - 40) * w, shY - 9], [s * (sx - 13) * w, shY + 1], [s * (sx + 0.5) * w, shY + 18], [s * (sx + 2) * w, shY + 40]]
      : [[s * sx * w, shY], [s * (sx + 2) * w, shY + 22]]) as Pt[]),
    [s * (cx0 + 4) * w, -700],
    [s * cx0 * w, -660],
    [s * wx * w, -594],
    [s * (hx - 2) * w, HIP + 10],
    [s * (hx + 2 + long * 0.1) * w, hemY],
  ];
  // silhouette: from the left hem corner up the side, through the neckline, down the right side; the hem is straight
  const lS = side(-1).slice().reverse();
  const rS = side(1);
  const torsoD = `M ${n1(lS[0][0])} ${n1(lS[0][1])} ${crOpen(lS.slice(0, -1))} Q 0 ${NECKB + 10} ${n1(rS[0][0])} ${n1(rS[0][1])} L ${n1(rS[1][0])} ${n1(rS[1][1])} ${crOpen(rS.slice(1))} Z`;
  const topCol = o.top;
  const dark = scaleHex(topCol, 0.7);
  const tParts: React.ReactNode[] = [];
  tParts.push(<path key="t" d={torsoD} fill={topCol} stroke={L} strokeWidth={sw} strokeLinejoin="round" />);
  // one step of shade: the left side under the arm
  tParts.push(<path key="sh" d={`M ${n1(-(cx0 - 2) * w)} -700 Q ${n1(-(cx0 - 22) * w)} -620 ${n1(-(wx - 16) * w)} -594 L ${n1(-(hx - 18) * w)} ${hemY - 4} L ${n1(-(hx + 1) * w)} ${hemY - 4} L ${n1(-(hx - 2) * w)} ${HIP + 10} L ${n1(-wx * w)} -594 L ${n1(-cx0 * w)} -660 Z`} fill={shadeOf(topCol)} />);
  const hem = (h = 18) => <rect key="hem" x={-(hx + 2) * w} y={hemY - h} width={2 * (hx + 2) * w} height={h} fill={dark} />;
  const V = (depth: number, col: string, k: string, wide = 34) => <path key={k} d={`M ${-wide} ${NECKB - 2} L ${wide} ${NECKB - 2} L 0 ${NECKB + depth} Z`} fill={col} stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" />;
  const collarWings = (k: string, y = NECKB - 4) => <path key={k} d={`M -32 ${y} L -8 ${y + 30} L -2 ${y + 4} Z M 32 ${y} L 8 ${y + 30} L 2 ${y + 4} Z`} fill="#FFFFFF" stroke={L} strokeWidth={sw * 0.55} strokeLinejoin="round" />;
  const buttons = (ys: number[], col: string, k: string, x = 0) => ys.map((y) => <circle key={`${k}${y}`} cx={x} cy={y} r={5.5} fill={col} stroke={L} strokeWidth={sw * 0.35} />);
  /** Undershirt: bare shoulders — skin from the strap to the shoulder edge (the patch is clipped by the torso silhouette), the strap
   *  edge is one line, the torso outline is drawn over the patch (otherwise it is half as thick at the shoulder). */
  const strapY = NECKB + ((58 * w - 30) / Math.max(1, (sx - 40) * w - 30)) * (shY - 9 - NECKB) + 1;
  const strapD = (s: number) => `M ${n1(s * (cx0 + 2) * w)} -700 Q ${n1(s * 76 * w)} -712 ${n1(s * 58 * w)} ${n1(strapY)}`;
  const bareShoulders = (): React.ReactNode[] => [
    <defs key="ud"><clipPath id={`tu${uid}`}><path d={torsoD} /></clipPath></defs>,
    ...[-1, 1].map((s) => (
      <g key={`ar${s}`} clipPath={`url(#tu${uid})`}>
        <path d={`${strapD(s)} L ${n1(s * 58 * w)} ${NECKB - 40} L ${n1(s * (sx + 40) * w)} ${NECKB - 40} L ${n1(s * (sx + 40) * w)} -700 Z`} fill={skin} />
      </g>
    )),
    ...[-1, 1].map((s) => <path key={`al${s}`} d={strapD(s)} fill="none" stroke={L} strokeWidth={sw * 0.6} strokeLinecap="round" />),
    // torso outline without the part between the sides of the neck: the top edge of the torso across the neck read as a
    // string under the chin
    <defs key="tod"><clipPath id={`tn${uid}`} clipRule="evenodd"><path clipRule="evenodd" d={`M -2000 -2000 H 2000 V 2000 H -2000 Z M -44 ${NECKB - 80} H 44 V ${NECKB + 22} H -44 Z`} /></clipPath></defs>,
    <path key="to" d={torsoD} fill="none" stroke={L} strokeWidth={sw} strokeLinejoin="round" clipPath={`url(#tn${uid})`} />,
  ];
  // quilting of a padded jacket — only over the torso: from behind the arms are under it, and the stitches ran onto the sleeves
  const quilt = (step: number, sag: number, y0 = -740) => (
    <g key="quilt">
      <defs><clipPath id={`tq${uid}`}><path d={torsoD} /></clipPath></defs>
      <g clipPath={`url(#tq${uid})`}>
        {Array.from({length: Math.max(0, Math.ceil((hemY - 16 - y0) / step))}, (_, i) => y0 + i * step).map((y) => (
          <path key={`q${y}`} d={`M ${n1(-(cx0 + 14) * w)} ${y} Q 0 ${y + sag} ${n1((cx0 + 14) * w)} ${y}`} stroke={dark} strokeWidth={4} fill="none" />
        ))}
      </g>
    </g>
  );
  if (!back) {
    if (top === 'jacket') {
      tParts.push(V(110, o.shirt, 'v'), collarWings('cw'));
      tParts.push(...buttons([-648, -604, -560], scaleHex(topCol, 0.55), 'b'));
      tParts.push(hem(16));
      tParts.push(<path key="pk" d={`M ${n1(-82 * w)} -566 l 34 -4 M ${n1(82 * w)} -566 l -34 -4`} stroke={dark} strokeWidth={4} strokeLinecap="round" />);
    } else if (top === 'cardigan') {
      tParts.push(V(140, o.shirt, 'v', 36), collarWings('cw'));
      tParts.push(<path key="l" d={`M 0 ${NECKB + 140} L 0 ${hemY}`} stroke={dark} strokeWidth={4} />);
      tParts.push(...buttons([-636, -600, -564], scaleHex(topCol, 1.3), 'b'));
      tParts.push(hem(16));
      [-1, 1].forEach((s) => tParts.push(<rect key={`pk${s}`} x={s > 0 ? 34 : -34 - 36} y={-580} width={36} height={30} rx={5} fill="none" stroke={dark} strokeWidth={4} />));
    } else if (top === 'padded') {
      tParts.push(quilt(44, 12));
      tParts.push(<path key="col" d={`M -44 ${NECKB - 22} Q -48 ${NECKB + 8} -26 ${NECKB + 18} L -6 ${NECKB + 38} L -6 ${NECKB} Z M 44 ${NECKB - 22} Q 48 ${NECKB + 8} 26 ${NECKB + 18} L 6 ${NECKB + 38} L 6 ${NECKB} Z`} fill={topCol} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />);
      tParts.push(<path key="z" d={`M 0 ${NECKB + 38} L 0 ${hemY}`} stroke={dark} strokeWidth={5} />);
      tParts.push(<path key="pk" d={`M ${n1(-74 * w)} -566 l 34 -6 M ${n1(74 * w)} -566 l -34 -6`} stroke={dark} strokeWidth={5} strokeLinecap="round" />);
    } else if (top === 'hoodie') {
      tParts.push(<path key="hood" d={`M -52 ${NECKB - 6} Q 0 ${NECKB + 34} 52 ${NECKB - 6} Q 60 ${NECKB + 22} 30 ${NECKB + 34} Q 0 ${NECKB + 46} -30 ${NECKB + 34} Q -60 ${NECKB + 22} -52 ${NECKB - 6} Z`} fill={scaleHex(topCol, 0.88)} stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" />);
      tParts.push(<path key="str" d={`M -16 ${NECKB + 36} L -19 ${NECKB + 100} M 16 ${NECKB + 36} L 19 ${NECKB + 100}`} stroke="#F2F2F2" strokeWidth={5} strokeLinecap="round" />);
      tParts.push(<path key="pocket" d={`M ${n1(-62 * w)} -604 L ${n1(62 * w)} -604 L ${n1(78 * w)} -546 L ${n1(-78 * w)} -546 Z`} fill="none" stroke={dark} strokeWidth={5} strokeLinejoin="round" />);
      tParts.push(hem(20));
    } else if (top === 'undershirt') {
      tParts.push(<path key="neck" d={`M -46 ${NECKB - 2} Q 0 ${NECKB + 100} 46 ${NECKB - 2}`} fill={skin} stroke={L} strokeWidth={sw * 0.7} />); // open path: the straight segment across the neck is not outlined
      tParts.push(...bareShoulders());
    } else if (top === 'tshirt') {
      tParts.push(<path key="neck" d={`M -36 ${NECKB - 2} Q 0 ${NECKB + 34} 36 ${NECKB - 2}`} fill={skin} stroke={L} strokeWidth={sw * 0.7} />);
    } else if (top === 'blouse') {
      tParts.push(<path key="neck" d={`M -34 ${NECKB - 2} Q 0 ${NECKB + 40} 34 ${NECKB - 2}`} fill={skin} stroke={L} strokeWidth={sw * 0.6} />);
      tParts.push(<path key="col" d={`M -36 ${NECKB - 4} Q -46 ${NECKB + 26} -4 ${NECKB + 30} Q -8 ${NECKB + 8} -36 ${NECKB - 4} Z M 36 ${NECKB - 4} Q 46 ${NECKB + 26} 4 ${NECKB + 30} Q 8 ${NECKB + 8} 36 ${NECKB - 4} Z`} fill="#FFFFFF" stroke={L} strokeWidth={sw * 0.5} />);
    }
    if (look.lanyard) {
      tParts.push(<path key="ly" d={`M -24 ${NECKB - 2} L -5 -690 M 24 ${NECKB - 2} L 5 -690`} stroke={o.lanyard} strokeWidth={7} strokeLinecap="round" />);
      tParts.push(
        <g key="bd">
          <rect x={-24} y={-694} width={48} height={64} rx={5} fill="#f3f5fb" stroke={L} strokeWidth={sw * 0.6} />
          <rect x={-24} y={-694} width={48} height={14} rx={4} fill={o.lanyard} />
          <rect x={-16} y={-674} width={16} height={20} rx={2} fill="#9fb4d6" />
          <rect x={4} y={-672} width={13} height={5} rx={2} fill="#7b8396" />
          <rect x={4} y={-662} width={10} height={5} rx={2} fill="#7b8396" />
          <rect x={-16} y={-648} width={32} height={6} rx={3} fill="#c8352d" />
        </g>,
      );
    }
  } else {
    tParts.push(<path key="seam" d={`M 0 ${NECKB + 14} L 0 ${hemY - 18}`} stroke={dark} strokeWidth={4} />);
    // from behind the neck comes out of the collar: the stand of the collar is over the base of the neck, the collar line is visible
    if (!['undershirt', 'tshirt', 'blouse', 'hoodie'].includes(top)) {
      tParts.push(<path key="col" d={`M -42 ${NECKB + 2} Q 0 ${NECKB - 10} 42 ${NECKB + 2} L 40 ${NECKB + 16} Q 0 ${NECKB + 6} -40 ${NECKB + 16} Z`} fill={scaleHex(topCol, 0.82)} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />);
    } else if (top === 'tshirt' || top === 'blouse') {
      tParts.push(<path key="col" d={`M -36 ${NECKB + 2} Q 0 ${NECKB + 8} 36 ${NECKB + 2}`} fill="none" stroke={L} strokeWidth={sw * 0.7} strokeLinecap="round" />);
    }
    if (top === 'hoodie') tParts.push(<path key="hood" d={`M -60 ${NECKB - 4} Q 0 ${NECKB - 16} 60 ${NECKB - 4} Q 64 -720 0 -706 Q -64 -720 -60 ${NECKB - 4} Z`} fill={scaleHex(topCol, 0.88)} stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" />);
    if (top === 'padded') tParts.push(quilt(44, 12));
    if (top === 'undershirt') {
      tParts.push(<path key="neck" d={`M -40 ${NECKB - 2} Q 0 ${NECKB + 20} 40 ${NECKB - 2}`} fill={skin} stroke={L} strokeWidth={sw * 0.6} />);
      tParts.push(...bareShoulders());
    }
    if (top !== 'undershirt' && top !== 'tshirt' && top !== 'blouse') tParts.push(hem(16));
  }
  const torso = <g transform={`translate(0 ${n1(bob)}) translate(0 ${HIP}) scale(1 ${p.breathS}) translate(0 ${-HIP})`}>{tParts}</g>;
  // top of the collar at the front — the neck is visible from here: a padded jacket stand is above the neckline, with an undershirt or
  // a T-shirt the neck goes into the neckline
  const rise = top === 'padded' ? 22 : top === 'hoodie' ? -10 : ['jacket', 'cardigan', 'blouse'].includes(top) ? 4 : 2; // hood at the sides of the neck below the neckline
  const neckY0 = NECKB - rise;
  const neck = {y: HIP + (neckY0 - HIP) * p.breathS + bob, y0: neckY0, stoop: 16 * stoop, open: top !== 'padded'};

  // ---------- legs and shoes ----------
  const trs = o.trousers;
  const leg = (s: number) => {
    const lift = body.lift[s < 0 ? 0 : 1]; // step: the foot lifts and comes down in place (lib/character/walk.ts), no sideways swing
    // running: the knee goes forward and higher (the foot lifts twice as high as in a step), feet wider; the trouser crease on the bent
    // knee grows with the lift
    const a = (x: number) => n1(s * x * w);
    const legD = skirt
      ? `M ${a(52)} -300 L ${a(46)} -46 L ${a(18)} -46 L ${a(16)} -300 Z`
      : `M ${a(hx)} ${HIP - 4} Q ${a(hx - 4)} -380 ${a(80)} -262 L ${a(62)} -46 L ${a(20)} -46 L ${a(16)} -262 Q ${a(10)} -400 ${n1(s * 2)} ${HIP - 4} Z`;
    const fx = s * ((fem ? 34 : 42) + (run ? 9 : 0)) * w;
    const fw = fem ? 24 : 32;
    const shoe = back
      ? `M ${n1(fx - fw)} -48 Q ${n1(fx - fw - 2)} -6 ${n1(fx - fw + 8)} 0 L ${n1(fx + fw - 8)} 0 Q ${n1(fx + fw + 2)} -6 ${n1(fx + fw)} -48 Z`
      : `M ${n1(fx - fw + 2)} -50 Q ${n1(fx - fw - 4)} -14 ${n1(fx - fw + 4)} -2 Q ${n1(fx)} 4 ${n1(fx + fw - 4)} -2 Q ${n1(fx + fw + 4)} -14 ${n1(fx + fw - 2)} -50 Z`;
    return (
      <g key={s} transform={`translate(0 ${n1(-body.liftH * lift)})`}>
        <path d={legD} fill={skirt ? scaleHex(trs, 0.5) : trs} stroke={L} strokeWidth={sw} strokeLinejoin="round" />
        {!skirt && <path d={`M ${a(18)} -262 L ${a(22)} -60`} stroke={scaleHex(trs, 0.78)} strokeWidth={10} strokeLinecap="round" />}
        {run && !skirt && lift > 0.15 && <path d={`M ${a(22)} -292 Q ${a(50)} -270 ${a(76)} -288`} fill="none" stroke={scaleHex(trs, 0.62)} strokeWidth={n1(6 * clamp((lift - 0.15) / 0.35))} strokeLinecap="round" />}
        <path d={shoe} fill={o.shoes} stroke={L} strokeWidth={sw * 0.9} strokeLinejoin="round" />
        {!back && <path d={`M ${n1(fx - fw + 2)} -12 Q ${n1(fx)} -6 ${n1(fx + fw - 2)} -12`} stroke={scaleHex(o.shoes, 1.8)} strokeWidth={3} fill="none" />}
      </g>
    );
  };
  const legs = (
    <g>
      {leg(-1)}
      {leg(1)}
      {skirt && <path d={`M ${n1(-(hx + 2) * w)} ${HIP} L ${n1((hx + 2) * w)} ${HIP} L ${n1((hx + 26) * w)} -300 Q 0 -288 ${n1(-(hx + 26) * w)} -300 Z`} fill={trs} stroke={L} strokeWidth={sw} strokeLinejoin="round" />}
    </g>
  );
  // ---------- arms ----------
  // Skeleton — lib/character/arm.ts: upper arm ARM_L1 and forearm ARM_L2 of constant length, IK in 3D (z — towards the viewer), the elbow
  // towards the pole. The arm is drawn as a projection: upper arm and forearm are tapering capsules of one shape (outline only outside);
  // if the segments overlap (a bent arm), the segment nearer to the viewer is drawn on top with its own outline.
  // Hand — ./hands.tsx in the wrist frame: f — towards the fingers (continues the forearm with a natural bend), u — towards
  // the thumb or the palm, depending on which hand it is and how it is turned (sideVec). Grips are layered: hand behind the prop → prop →
  // fingers in front of it.
  const bare = top === 'undershirt';
  const short = top === 'tshirt';
  const R0 = armW / 2 + 2;
  const R1 = armW / 2 - 1;
  const R2 = armW / 2 - 5;
  const unit = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const add = (a: Pt, d: Pt, k: number): Pt => [a[0] + d[0] * k, a[1] + d[1] * k];
  const P2 = (q: Pt) => `${n1(q[0])} ${n1(q[1])}`;
  const pr = (q: V3): Pt => [q[0], q[1]];
  const capsule = (A: Pt, B: Pt, ra: number, rb: number) => {
    const d = unit(A, B);
    const nr: Pt = [-d[1], d[0]];
    return `M ${P2(add(A, nr, ra))} L ${P2(add(B, nr, rb))} A ${n1(rb)} ${n1(rb)} 0 0 0 ${P2(add(B, nr, -rb))} L ${P2(add(A, nr, -ra))} A ${n1(ra)} ${n1(ra)} 0 0 0 ${P2(add(A, nr, ra))} Z`;
  };
  const torsoTf = `translate(0 ${HIP}) scale(1 ${p.breathS}) translate(0 ${-HIP})`;

  /** Arm by 3D points. part: 'full' — upper arm and forearm; 'upper' — only the upper arm with the elbow (from behind the forearm went
   *  forward behind the body). */
  /** one — the sleeve as one shape even with a bent elbow (outline only outside, no joint arc across the arm): for poses where the elbow
   *  bend must read as the angle of the sleeve, not a hinge (a folder at the chest; an arm going behind the back). */
  const armNode = (S: V3, E: V3, W: V3, k: string, part: 'full' | 'upper' = 'full', one = false) => {
    const Sh = pr(S);
    const E2 = pr(E);
    const W2 = pr(W);
    const s = Sh[0] >= 0 ? 1 : -1;
    const col = bare || short ? skin : topCol;
    const d1 = unit(Sh, E2);
    const d2 = unit(E2, W2);
    const up = capsule(Sh, E2, R0, R1);
    const fo = part === 'upper' ? capsule(E2, add(E2, d2, Math.min(18, Math.hypot(W2[0] - E2[0], W2[1] - E2[1]))), R1, R1) : capsule(E2, W2, R1, R2);
    // segments overlap: the arm is folded or one segment points at the viewer (shorter in the frame)
    const lenUp = Math.hypot(E2[0] - Sh[0], E2[1] - Sh[1]);
    const overlap = !one && part === 'full' && (d1[0] * d2[0] + d1[1] * d2[1] < -0.15 || lenUp < 0.62 * ARM_L1);
    const foreOnTop = (E[2] + W[2]) / 2 >= (S[2] + E[2]) / 2;
    const cid = `tc${uid}${k}`;
    // the sleeve as one shape at a sharp bend (one): the inner angle of the elbow is a triangular web, otherwise a black wedge of outline
    // or a gap of background stays between the capsules
    const cosB = d1[0] * d2[0] + d1[1] * d2[1];
    const webA = one && part === 'full' && cosB < -0.1 ? Math.min(2.4 * R1 / Math.max(0.2, Math.sqrt(1 - cosB * cosB)), 0.9 * lenUp, 1.6 * Math.hypot(W2[0] - E2[0], W2[1] - E2[1]) + 20) : 0;
    const web = webA > 0 ? P([add(E2, d1, -webA), E2, add(E2, d2, webA)]) + 'Z' : null;
    const nodes: React.ReactNode[] = [<defs key="d"><clipPath id={cid}><path d={torsoD} transform={torsoTf} /></clipPath></defs>];
    if (overlap && !foreOnTop) {
      nodes.push(<path key="fo" d={fo} fill={col} stroke={L} strokeWidth={sw} strokeLinejoin="round" />);
      nodes.push(<path key="uo" d={up} fill={col} stroke={L} strokeWidth={sw} strokeLinejoin="round" />);
    } else {
      nodes.push(<path key="ou" d={up} fill={L} stroke={L} strokeWidth={2 * sw} strokeLinejoin="round" />);
      if (!overlap) nodes.push(<path key="of" d={fo} fill={L} stroke={L} strokeWidth={2 * sw} strokeLinejoin="round" />);
      if (web) nodes.push(<path key="ow" d={web} fill={L} stroke={L} strokeWidth={2 * sw} strokeLinejoin="round" />);
      nodes.push(<path key="fu" d={up} fill={col} />);
      if (web) nodes.push(<path key="fw" d={web} fill={col} />);
    }
    // shoulder: a patch inside the torso silhouette — the joint circle is not visible, the shoulder line flows into the sleeve
    nodes.push(<g key="cap" clipPath={`url(#${cid})`}><circle cx={Sh[0]} cy={Sh[1]} r={R0 + sw + 1} fill={short ? topCol : col} /></g>);
    if (overlap && foreOnTop) nodes.push(<path key="fo" d={fo} fill={col} stroke={L} strokeWidth={sw} strokeLinejoin="round" />);
    else if (!overlap) nodes.push(<path key="ff" d={fo} fill={col} />);
    if (short) {
      // T-shirt: a short sleeve to the middle of the upper arm over the bare arm
      const M: Pt = [lerp(Sh[0], E2[0], 0.5), lerp(Sh[1], E2[1], 0.5)];
      nodes.push(<path key="sl" d={capsule(Sh, M, R0 + 4, R0 + 3)} fill={topCol} stroke={L} strokeWidth={sw} strokeLinejoin="round" />);
      nodes.push(<g key="slc" clipPath={`url(#${cid})`}><circle cx={Sh[0]} cy={Sh[1]} r={R0 + 4 + sw + 1} fill={topCol} /></g>);
    } else if (bare) {
      nodes.push(<path key="arm" d={strapD(s)} transform={torsoTf} fill="none" stroke={L} strokeWidth={sw * 0.6} strokeLinecap="round" />);
    } else if (part === 'full') {
      // cuff — a darker strip at the wrist, no outline
      const nr: Pt = [-d2[1], d2[0]];
      const c0 = add(W2, d2, -Math.min(16, 0.4 * Math.hypot(W2[0] - E2[0], W2[1] - E2[1])));
      nodes.push(<path key="cf" d={P([add(c0, nr, R2 + 1.5), add(W2, nr, R2), add(W2, nr, -R2), add(c0, nr, -(R2 + 1.5))]) + 'Z'} fill={scaleHex(col, 0.8)} />);
    }
    return <g key={k}>{nodes}</g>;
  };

  // ---------- hands and props ----------
  const hst = (k: number): HandStyle => ({fill: p.mark ? '#FF00FF' : skin, line: L, sw: (sw * 0.9) / k, shade: mixHex(skin, L, 0.45), bare: bare || short});
  const ps = {line: L, sw, folder: o.folder};
  const layer = (l: Layer, key: string): React.ReactNode => {
    if (l.t === 'arm') return armNode(l.S, l.E, l.W, key, l.part, l.one);
    if (l.t === 'item') return <g key={key}>{drawItem(l.item, ps)}</g>;
    const h = l.h;
    const parts = handParts(h.shape, h.view, hst(h.k), h.q);
    const node = l.back ? parts.back : parts.front;
    return node ? <g key={key} transform={handMatrix(h.W, h.f, h.u, h.k)}>{node}</g> : null;
  };
  const armsUnder = body.arms.filter((a) => !a.over).map((a, i) => <g key={`a${i}`}>{a.layers.map((l, j) => layer(l, `a${i}l${j}`))}</g>);
  const armsOver = body.arms.filter((a) => a.over).map((a, i) => <g key={`o${i}`}>{a.layers.map((l, j) => layer(l, `o${i}l${j}`))}</g>);
  // the arms move with the body when running and straightening up
  const runT = bob ? `translate(0 ${n1(bob)})` : undefined;
  return {legs, torso, arms: <g transform={runT}>{armsUnder}</g>, over: <g transform={runT}>{armsOver}</g>, neck};
}
