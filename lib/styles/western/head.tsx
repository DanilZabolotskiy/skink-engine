// Head of the western style: a large round head with dot eyes, simple brows and mouth, blush and a sweat drop; hairstyles, headwear,
// glasses and wrinkles of the look. Head units (lib/character/style.ts HeadIn): the head centre at (0, −858), radius 152; the core scales
// the head by HEAD_SCALE around the crown.
import React from 'react';
import {lerp, scaleHex} from '../../anim';
import {Outfit} from '../../character/Character';
import type {HeadIn, HeadOut} from '../../character/style';
import {Look} from '../../character/looks';

/** Outline width of a western figure, figure units: a thick cartoon line (the body uses it too). */
export const OL = 10;
/** Head units → body units: a big round head on the body. */
export const HEAD_SCALE = 0.8;
/** The head–neck joint, head units: the head tilts around it. */
export const HEAD_PIVOT = -720;

export type Ctx = {
  o: Outfit; L: string; sw: number; skin: string; uid: string; turn: number; back: boolean;
  HX: number; HY: number; HR: number; w: number; t: number; look: Look;
};

/** A cloud of circles with a common outline (a perm, curls): first the outline, then the fill. */
function blob(c: Ctx, circles: [number, number, number][], fill: string, key: string, under?: string) {
  // under — a fill between passes: covers outline gaps between circles (dark "triangles" inside a hairstyle)
  return (
    <g key={key}>
      {circles.map(([x, y, r], i) => <circle key={`o${i}`} cx={x} cy={y} r={r + c.sw * 0.8} fill={c.L} />)}
      {under && <path d={under} fill={fill} />}
      {circles.map(([x, y, r], i) => <circle key={`f${i}`} cx={x} cy={y} r={r} fill={fill} />)}
    </g>
  );
}

// ---------- hair ----------

/** Hair behind the back, before the torso (long). */
function hairBehindBody(c: Ctx): React.ReactNode {
  const {o, L, sw, HR, HY, look} = c;
  if (look.hair !== 'long' || look.hat) return null;
  const R = HR + 20;
  return <path d={`M ${-R} ${HY} L ${-R - 6} ${-560} Q 0 ${-530} ${R + 6} ${-560} L ${R} ${HY} Z`} fill={o.hair} stroke={L} strokeWidth={sw} strokeLinejoin="round" />;
}

/** Hair and hat behind the head (front view) — before the face circle. Also returns whether the ears are hidden. */
function hairBack(c: Ctx): {node: React.ReactNode; hideEars: boolean} {
  const {o, L, sw, HR, HY, turn, look} = c;
  const fs = turn * 44;
  const h = look.hair;
  if (h === 'bob') {
    const R = HR + 26;
    const x0 = fs * 0.2;
    // uneven lower edge of a bob: tooth-like strands
    const edge: string[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      edge.push(`L ${(x0 + R - 2 * R * u).toFixed(1)} ${(HY + 118 + (i % 2 ? 14 : 0) + 8 * Math.sin(u * Math.PI)).toFixed(1)}`);
    }
    const dark = scaleHex(o.hair, 0.72);
    return {node: (
      <g>
        <path d={`M ${-R + x0} ${HY + 118} L ${-R + x0} ${HY - 10} A ${R} ${R + 8} 0 0 1 ${R + x0} ${HY - 10} ${edge.join(' ')} Z`} fill={o.hair} stroke={L} strokeWidth={sw} strokeLinejoin="round" />
        {[-1, 1].map((s2) => [0, 1].map((k) => (
          <path key={`${s2}${k}`} d={`M ${x0 + s2 * (HR - 6 + 14 * k)} ${HY - 70 + 30 * k} Q ${x0 + s2 * (HR + 14 + 6 * k)} ${HY + 30} ${x0 + s2 * (HR + 4 + 10 * k)} ${HY + 116}`} stroke={dark} strokeWidth={5} fill="none" strokeLinecap="round" />
        )))}
      </g>), hideEars: true};
  }
  if (h === 'perm') {
    const cs: [number, number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (1.0 + i / 12); // from the left side over the crown to the right
      cs.push([fs * 0.25 + Math.cos(a) * (HR + 6), HY - 6 + Math.sin(a) * (HR + 4), 44 + (i % 2) * 6]);
    }
    for (const s of [-1, 1]) for (const dy of [30, 70]) cs.push([s * (HR + 4) + fs * 0.2, HY + dy, 38]);
    return {node: blob(c, cs, o.hair, 'perm'), hideEars: true};
  }
  if (h === 'long') return {node: <ellipse cx={fs * 0.3} cy={HY - 6} rx={HR + 20} ry={HR + 14} fill={o.hair} stroke={L} strokeWidth={sw} />, hideEars: true};
  if (h === 'bun') {
    return {node: (
      <g>
        <circle cx={fs * 0.4} cy={HY - HR - 18} r={52} fill={o.hair} stroke={L} strokeWidth={sw} />
        <ellipse cx={fs * 0.3} cy={HY - 12} rx={HR + 10} ry={HR + 8} fill={o.hair} stroke={L} strokeWidth={sw} />
      </g>), hideEars: false};
  }
  if (h === 'ponytail') {
    return {node: (
      <g>
        <ellipse cx={HR + 26 - fs} cy={HY + 60} rx={40} ry={96} transform={`rotate(-14 ${HR + 26 - fs} ${HY + 60})`} fill={o.hair} stroke={L} strokeWidth={sw} />
        <ellipse cx={fs * 0.3} cy={HY - 12} rx={HR + 12} ry={HR + 8} fill={o.hair} stroke={L} strokeWidth={sw} />
      </g>), hideEars: false};
  }
  if (h === 'bald') return {node: null, hideEars: false};
  // short, side, kid
  return {node: <ellipse cx={fs * 0.3} cy={HY - 16} rx={HR + 12} ry={HR + 8} fill={o.hair} stroke={L} strokeWidth={sw} />, hideEars: false};
}

/** Fringe and strands over the face (clipped by the head circle) — down to the brows. */
function hairFront(c: Ctx): React.ReactNode {
  const {o, L, sw, HR, HY, turn, look} = c;
  const fs = turn * 44;
  const h = look.hair;
  const top = HY - 200;
  if (h === 'bob') {
    // slanted fringe and strands at the sides of the face
    return (
      <g>
        <path d={`M ${-HR - 20} ${top} L ${HR + 20} ${top} L ${HR + 20} ${HY - 78} Q ${30 + fs} ${HY - 92} ${-40 + fs} ${HY - 52} Q ${-90 + fs} ${HY - 30} ${-HR - 20} ${HY - 40} Z`} fill={o.hair} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />
        <path d={`M ${-HR - 20} ${HY - 60} L ${-HR + 34 + fs * 0.5} ${HY - 40} L ${-HR + 26 + fs * 0.5} ${HY + 120} L ${-HR - 20} ${HY + 120} Z`} fill={o.hair} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />
        <path d={`M ${HR + 20} ${HY - 70} L ${HR - 34 + fs * 0.5} ${HY - 50} L ${HR - 26 + fs * 0.5} ${HY + 120} L ${HR + 20} ${HY + 120} Z`} fill={o.hair} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />
        {/* parting and strands: a bob reads as hair, not as a solid cap */}
        <path d={`M ${-30 + fs} ${top + 40} Q ${-34 + fs} ${HY - 120} ${-40 + fs} ${HY - 98}`} stroke={scaleHex(o.hair, 0.62)} strokeWidth={6} fill="none" strokeLinecap="round" />
        {[0, 1, 2, 3].map((k) => (
          <path key={k} d={`M ${-20 + fs + k * 40} ${HY - 140 + k * 4} Q ${10 + fs + k * 44} ${HY - 108} ${-4 + fs + k * 46} ${HY - 74 - k * 4}`} stroke={scaleHex(o.hair, 0.7)} strokeWidth={5} fill="none" strokeLinecap="round" />
        ))}
        {[-1, 1].map((s2) => (
          <path key={`sl${s2}`} d={`M ${s2 * (HR - 14) + fs * 0.5} ${HY - 30} Q ${s2 * (HR - 22) + fs * 0.5} ${HY + 40} ${s2 * (HR - 12) + fs * 0.5} ${HY + 110}`} stroke={scaleHex(o.hair, 0.7)} strokeWidth={5} fill="none" strokeLinecap="round" />
        ))}
      </g>
    );
  }
  if (h === 'perm') {
    const cs: [number, number, number][] = [];
    for (let i = 0; i < 7; i++) cs.push([-HR + 20 + i * ((2 * HR - 40) / 6) + fs, HY - 92 + (i % 2) * 12 - 10 * Math.cos(((i - 3) / 3) * 1.2), 30]);
    cs.push([fs, HY - 140, 70]);
    for (const s of [-1, 1]) cs.push([s * (HR - 8) + fs * 0.4, HY - 40, 34]);
    return blob(c, cs, o.hair, 'permf', `M ${fs - HR + 14} ${HY - 118} A ${HR - 14} 64 0 1 1 ${fs + HR - 14} ${HY - 118} A ${HR - 14} 64 0 1 1 ${fs - HR + 14} ${HY - 118} Z`);
  }
  if (h === 'side') {
    return (
      <g>
        <path d={`M ${-HR - 20} ${top} L ${HR + 20} ${top} L ${HR + 20} ${HY - 30} Q ${HR - 30} ${HY - 60} ${60 + fs} ${HY - 92} Q ${-20 + fs} ${HY - 118} ${-HR + 10 + fs} ${HY - 70} L ${-HR - 20} ${HY - 20} Z`}
          fill={o.hair} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />
        <path d={`M ${-56 + fs} ${HY - 150} Q ${-50 + fs} ${HY - 126} ${-60 + fs} ${HY - 104}`} stroke={scaleHex(o.hair, 1.9)} strokeWidth={6} fill="none" strokeLinecap="round" />
        <path d={`M ${-20 + fs} ${HY - 146} Q ${40 + fs} ${HY - 130} ${90 + fs} ${HY - 92} M ${10 + fs} ${HY - 152} Q ${70 + fs} ${HY - 140} ${120 + fs} ${HY - 100}`} stroke={scaleHex(o.hair, 1.9)} strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.8} />
      </g>
    );
  }
  if (h === 'long' || h === 'ponytail' || h === 'bun') {
    // parting in the middle: two "curtains" to the temples
    const px = fs * 0.8;
    return (
      <path d={`M ${-HR - 20} ${top} L ${HR + 20} ${top} L ${HR + 20} ${HY + (h === 'long' ? 110 : 10)} Q ${HR - 26} ${HY - 40} ${px + 8} ${HY - 116} L ${px - 8} ${HY - 116} Q ${-HR + 26} ${HY - 40} ${-HR - 20} ${HY + (h === 'long' ? 110 : 10)} Z`}
        fill={o.hair} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />
    );
  }
  if (h === 'bald') {
    return (
      <g>
        {[-1, 1].map((s) => <ellipse key={s} cx={s * (HR - 4) + fs * 0.3} cy={HY - 6} rx={30} ry={52} fill={o.hair} stroke={L} strokeWidth={sw * 0.7} />)}
        <path d={`M ${-40 + fs} ${HY - 120} Q ${fs} ${HY - 134} ${40 + fs} ${HY - 122}`} stroke={scaleHex(c.skin, 0.8)} strokeWidth={6} fill="none" strokeLinecap="round" />
      </g>
    );
  }
  // short / kid: a straight toothed fringe
  const kid = h === 'kid';
  const pts: string[] = [`M ${-HR - 20} ${top}`, `L ${HR + 20} ${top}`, `L ${HR + 20} ${HY + 10}`];
  const n = kid ? 10 : 9;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const xx = HR + 10 - (2 * HR + 20) * u + fs;
    const base = (kid ? HY - 58 : HY - 84) + (Math.abs(u - 0.5) > 0.42 ? 70 : 0);
    pts.push(`L ${xx.toFixed(1)} ${(base + (i % 2 ? (kid ? 10 : 18) : -2)).toFixed(1)}`);
  }
  pts.push(`L ${-HR - 20} ${HY + 10} Z`);
  return <path d={pts.join(' ')} fill={o.hair} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />;
}

/** Back of the head (view from behind) — the head circle is already drawn in skin colour. */
function hairBackView(c: Ctx): React.ReactNode {
  const {o, L, sw, HR, HY, turn, look} = c;
  const h = look.hair;
  const tx = -turn * 40;
  if (h === 'perm') {
    const cs: [number, number, number][] = [];
    for (let ring = 0; ring < 3; ring++) {
      const rr = [HR - 10, HR - 70, 20][ring];
      const n = [12, 7, 1][ring];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        cs.push([tx + Math.cos(a) * rr, HY - 10 + Math.sin(a) * rr * 0.95, ring === 2 ? 70 : 46]);
      }
    }
    return blob(c, cs, o.hair, 'permb', `M ${tx - HR + 6} ${HY - 10} A ${HR - 6} ${HR - 6} 0 1 1 ${tx + HR - 6} ${HY - 10} A ${HR - 6} ${HR - 6} 0 1 1 ${tx - HR + 6} ${HY - 10} Z`);
  }
  if (h === 'bob' || h === 'long') {
    const R = HR + 24;
    const bottom = h === 'long' ? -560 : HY + 120;
    const dark = scaleHex(o.hair, 0.7);
    return (
      <g>
        <path d={`M ${-R + tx} ${bottom} L ${-R + tx} ${HY - 10} A ${R} ${R + 8} 0 0 1 ${R + tx} ${HY - 10} L ${R + tx} ${bottom} ${Array.from({length: 11}, (_, i) => `L ${(tx + R - (2 * R * i) / 10).toFixed(1)} ${(bottom + (i % 2 ? 14 : 0) + 8 * Math.sin((i / 10) * Math.PI)).toFixed(1)}`).join(' ')} Z`}
          fill={o.hair} stroke={L} strokeWidth={sw} strokeLinejoin="round" />
        {[-0.75, -0.4, -0.05, 0.3, 0.65].map((a, i) => (
          <path key={i} d={`M ${tx + a * 60} ${HY - R + 30} Q ${tx + a * 150} ${HY - 20} ${tx + a * (R - 8)} ${bottom - 6}`} stroke={dark} strokeWidth={5} fill="none" strokeLinecap="round" />
        ))}
      </g>
    );
  }
  if (h === 'bald') {
    // a grey fringe of hair at the back of the head and above the ears — curls along the lower arc of the head
    const cs: [number, number, number][] = [];
    for (let i = 0; i <= 9; i++) {
      const a = (Math.PI * (0.05 + 0.9 * i / 9));
      cs.push([tx + Math.cos(a) * (HR - 14), HY + 20 + Math.sin(a) * (HR - 40), 26]);
    }
    return <g clipPath={`url(#hc${c.uid})`}>{blob(c, cs, o.hair, 'baldb', `M ${tx - HR + 20} ${HY + 30} Q ${tx} ${HY + 150} ${tx + HR - 20} ${HY + 30} Z`)}</g>;
  }
  const nape = (() => {
    const pts: string[] = [`M ${-HR - 10} ${HY - 200}`, `L ${HR + 10} ${HY - 200}`, `L ${HR + 10} ${HY + 40}`];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      pts.push(`L ${(HR - 2 * HR * u + tx).toFixed(1)} ${(HY + HR + 8 - 30 * Math.sin(u * Math.PI) + (i % 2 ? 10 : 0)).toFixed(1)}`);
    }
    pts.push(`L ${-HR - 10} ${HY + 40} Z`);
    return pts.join(' ');
  })();
  return (
    <g>
      <g clipPath={`url(#hc${c.uid})`}><path d={nape} fill={o.hair} stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" /></g>
      {h === 'bun' && (
        <g>
          <ellipse cx={tx} cy={HY - 40} rx={58} ry={46} fill={o.hair} stroke={L} strokeWidth={sw} />
          <path d={`M ${tx - 36} ${HY - 50} Q ${tx} ${HY - 74} ${tx + 34} ${HY - 44} M ${tx - 30} ${HY - 26} Q ${tx + 4} ${HY - 40} ${tx + 36} ${HY - 20}`} stroke={scaleHex(o.hair, 1.6)} strokeWidth={5} fill="none" strokeLinecap="round" />
        </g>
      )}
      {h === 'ponytail' && <path d={`M ${tx - 26} ${HY - 20} Q ${tx - 40} ${HY + 120} ${tx} ${HY + 200} Q ${tx + 40} ${HY + 120} ${tx + 26} ${HY - 20} Z`} fill={o.hair} stroke={L} strokeWidth={sw} />}
    </g>
  );
}

// ---------- headwear, glasses, wrinkles ----------

export function hat(c: Ctx): React.ReactNode {
  const {L, sw, HR, HY, turn, back, look} = c;
  if (!look.hat) return null;
  const col = look.hatColor ?? '#6A4E3A';
  const fs = turn * 30;
  // a peaked cap: the crown wider than the head, a band, a peak
  const crown = `M ${-HR - 6 + fs} ${HY - 70} Q ${-HR - 34 + fs} ${HY - 190} ${-HR + 30 + fs} ${HY - 214} L ${HR - 30 + fs} ${HY - 214} Q ${HR + 34 + fs} ${HY - 190} ${HR + 6 + fs} ${HY - 70} Z`;
  return (
    <g>
      <path d={crown} fill={col} stroke={L} strokeWidth={sw} strokeLinejoin="round" />
      <rect x={-HR - 4 + fs} y={HY - 110} width={2 * HR + 8} height={40} rx={8} fill={scaleHex(col, 0.62)} stroke={L} strokeWidth={sw * 0.8} />
      {!back && <path d={`M ${-HR + 4 + fs * 1.3} ${HY - 72} Q ${fs * 1.3} ${HY - 26} ${HR - 4 + fs * 1.3} ${HY - 72} Z`} fill="#121218" stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />}
    </g>
  );
}

export function glasses(c: Ctx, eyeSp: number, fx: number, eyeY: number): React.ReactNode {
  const {L, HR, look} = c;
  if (!look.glasses) return null;
  const round = look.glasses === 'round';
  const lens = (x: number) => round
    ? <circle cx={x} cy={eyeY} r={36} fill="#ffffff" fillOpacity={0.18} stroke={L} strokeWidth={7} />
    : <rect x={x - 40} y={eyeY - 28} width={80} height={56} rx={12} fill="#ffffff" fillOpacity={0.18} stroke={L} strokeWidth={8} />;
  return (
    <g>
      {lens(fx - eyeSp)}
      {lens(fx + eyeSp)}
      <path d={`M ${fx - eyeSp + (round ? 34 : 40)} ${eyeY - 6} Q ${fx} ${eyeY - 16} ${fx + eyeSp - (round ? 34 : 40)} ${eyeY - 6}`} stroke={L} strokeWidth={6} fill="none" />
      {[-1, 1].map((s) => <path key={s} d={`M ${fx + s * (eyeSp + (round ? 36 : 40))} ${eyeY - 8} L ${s * (HR - 4)} ${eyeY - 14}`} stroke={L} strokeWidth={6} />)}
    </g>
  );
}

export function wrinkles(c: Ctx, eyeSp: number, fx: number, eyeY: number, mx: number, my: number): React.ReactNode {
  const a = c.look.age ?? 0;
  if (a < 0.3 || c.back) return null;
  const op = Math.min(0.8, 0.3 + a * 0.5);
  const col = scaleHex(c.skin, 0.62);
  return (
    <g stroke={col} strokeWidth={5} fill="none" strokeLinecap="round" opacity={op}>
      {[-1, 1].map((s) => (
        <g key={s}>
          {a >= 0.6 && <path d={`M ${fx + s * (eyeSp + 34)} ${eyeY - 2} l ${s * 16} -4`} />}
          {a > 0.5 && <path d={`M ${mx + s * 30} ${my - 40} Q ${mx + s * 50} ${my - 14} ${mx + s * 44} ${my + 8}`} />}
        </g>
      ))}
      {a > 0.7 && <path d={`M ${fx - 40} ${eyeY - 74} Q ${fx} ${eyeY - 82} ${fx + 40} ${eyeY - 74}`} />}
    </g>
  );
}


/** The western head (HeadIn → HeadOut). */
export function westernHead(p: HeadIn): HeadOut {
  const {o, look: lk, uid, face: f, blink, turn, gx, gy, back} = p;
  const L = o.line;
  const sw = OL;
  const skin = o.skin;
  const ctx: Ctx = {o, L, sw, skin, uid, turn, back, HX: 0, HY: -858, HR: 152, w: lk.w ?? 1, t: p.t, look: lk};
  // the cowlick haircut is drawn here, every other hairstyle — by the functions above
  const cowlickHair = lk.hair === 'cowlick' && !lk.hat;
  // head
  const HX = 0;
  const HY = -858;
  const HR = 152;
  const ears = [-1, 1].map((s) => {
    const recede = back ? Math.max(0, -s * turn) : Math.max(0, s * turn);
    const ex = s * (HR - 6 - 46 * recede) + (back ? -turn * 10 : turn * 10);
    return <ellipse key={s} cx={ex} cy={HY + 10} rx={26 * (1 - 0.4 * recede)} ry={34} fill={skin} stroke={L} strokeWidth={sw} />;
  });

  const fx = turn * 72; // shift of the facial features on a turn
  const eyeSp = 54 * (1 - 0.22 * Math.abs(turn));
  const eyeY = HY + 22;
  const open = Math.max(0, f.eyeOpen * (1 - blink));
  const eyes = [-1, 1].map((s) => {
    const ex = fx + s * eyeSp;
    if (open < 0.18) {
      return <path key={s} d={`M ${ex - 18} ${eyeY} Q ${ex} ${eyeY + 10} ${ex + 18} ${eyeY}`} stroke={L} strokeWidth={9} fill="none" strokeLinecap="round" />;
    }
    const w = f.eyeWhite;
    const rx = lerp(14, 27, w);
    const ry = lerp(19, 31, w) * open;
    const pr = lerp(14, 12 * f.pupil, w);
    const px = ex + gx * lerp(4, 11, w);
    const py = eyeY + gy * lerp(4, 10, w);
    return (
      <g key={s}>
        {w > 0.02 && <ellipse cx={ex} cy={eyeY} rx={rx} ry={ry} fill="#ffffff" stroke={L} strokeWidth={6} opacity={Math.min(1, w * 1.6)} />}
        <ellipse cx={px} cy={py} rx={pr} ry={Math.min(pr * 1.3, ry)} fill={L} />
        <circle cx={px + pr * 0.35} cy={py - pr * 0.45} r={Math.max(2.5, pr * 0.3)} fill="#ffffff" />
      </g>
    );
  });
  const browY = eyeY - 40 - f.browY * 14;
  const brows = [-1, 1].map((s) => {
    const bx = fx + s * eyeSp;
    const inner = bx - s * 20;
    const outer = bx + s * 22;
    return <path key={s} d={`M ${inner} ${browY - f.browTilt * 13} L ${outer} ${browY + f.browTilt * 5}`} stroke={L} strokeWidth={11} strokeLinecap="round" />;
  });
  const mx = turn * 78;
  const my = HY + 88;
  const mw = 34 * f.mouthWide;
  const mc = f.mouthCurve * 20;
  let mouth: React.ReactNode;
  const wob = (n: number, amp: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const xx = mx - mw + 2 * mw * u;
      const yy = my + mc * (1 - Math.pow(2 * u - 1, 2)) + (i % 2 ? amp : -amp);
      pts.push(`${i ? 'L' : 'M'}${xx.toFixed(1)} ${yy.toFixed(1)}`);
    }
    return pts.join(' ');
  };
  if (f.mouthOpen > 0.06) {
    const oh = f.mouthOpen * 46;
    const top = f.wobble > 0.3 ? wob(6, 4 * f.wobble).replace(/^M/, 'M') : `M ${mx - mw} ${my} Q ${mx} ${my + mc * 1.4} ${mx + mw} ${my}`;
    mouth = (
      <path d={`${top} Q ${mx} ${my + oh + mc} ${mx - mw} ${my} Z`} fill="#5a1626" stroke={L} strokeWidth={8} strokeLinejoin="round" />
    );
  } else {
    mouth = f.wobble > 0.3
      ? <path d={wob(6, 6 * f.wobble)} stroke={L} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      : <path d={`M ${mx - mw} ${my} Q ${mx} ${my + mc * 2} ${mx + mw} ${my}`} stroke={L} strokeWidth={8} fill="none" strokeLinecap="round" />;
  }
  const blush = f.blush > 0.02 && [-1, 1].map((s) => (
    <ellipse key={s} cx={fx + s * (eyeSp + 26)} cy={eyeY + 46} rx={22} ry={12} fill="#ff7d8c" opacity={0.45 * f.blush} />
  ));
  // the drop grows from zero, slides and fades out by the end of the cycle — no popping in or jumping within a frame (as in the webtoon head)
  const sweat = f.sweat > 0.02 && (() => {
    const c = (((p.t * 0.6) % 1) + 1) % 1;
    const up = Math.min(1, c / 0.15);
    const dn = Math.min(1, (1 - c) / 0.18);
    const k = Math.min(up * up * (3 - 2 * up), dn * dn * (3 - 2 * dn)) * Math.min(1, f.sweat * 1.4);
    return k < 0.01 ? null : (
      <path
        transform={`translate(${HX + 118 + turn * 20} ${HY - 40 + 22 * c}) scale(${k.toFixed(3)})`}
        d="M 0 -26 Q 16 0 12 12 A 12 12 0 1 1 -12 12 Q -16 0 0 -26 Z"
        fill="#bfe8ff" stroke={L} strokeWidth={6} opacity={Math.min(1, f.sweat * 2.8)}
      />
    );
  })();

  // hair: volume at the back, a fringe in front (clipped by the head circle), a cowlick
  const fringeShift = turn * 44;
  const fringe = (() => {
    const pts: string[] = [`M ${-HR - 20} ${HY - 200}`, `L ${HR + 20} ${HY - 200}`, `L ${HR + 20} ${HY + 30}`];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const xx = HR + 10 - (2 * HR + 20) * u + fringeShift;
      const base = HY - 80 + (Math.abs(u - 0.5) > 0.42 ? 80 : 0);
      const yy = base + (i % 2 ? 26 : -4);
      pts.push(`L ${xx.toFixed(1)} ${yy.toFixed(1)}`);
    }
    pts.push(`L ${-HR - 20} ${HY + 30} Z`);
    return pts.join(' ');
  })();

  const nape = (() => {
    // lower hair edge at the back: teeth above the neck
    const pts: string[] = [`M ${-HR - 10} ${HY - 200}`, `L ${HR + 10} ${HY - 200}`, `L ${HR + 10} ${HY + 40}`];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const xx = HR - 2 * HR * u - turn * 46;
      const yy = HY + HR + 8 - 30 * Math.sin(u * Math.PI) + (i % 2 ? 10 : 0); // back of the head: hair down to the neck, skin — only a narrow edge above the neck
      pts.push(`L ${xx.toFixed(1)} ${yy.toFixed(1)}`);
    }
    pts.push(`L ${-HR - 10} ${HY + 40} Z`);
    return pts.join(' ');
  })();
  const head = back ? (
    <g>
      {ears}
      <circle cx={HX} cy={HY} r={HR} fill={skin} stroke={L} strokeWidth={sw} />
      <g clipPath={`url(#hc${uid})`}>
        <path d={nape} fill={`url(#hairB${uid})`} stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" />
        {/* strands from top to bottom, almost parallel: no vanishing point and no curl (they read as an eye) */}
        {[-0.78, -0.42, -0.06, 0.3, 0.66].map((a, i) => (
          <path key={i} d={`M ${a * 118 - turn * 40} ${HY - 138 + Math.abs(a) * 34} Q ${a * 132 - turn * 42} ${HY - 40} ${a * 146 - turn * 46} ${HY + 66}`}
            stroke="#3b3a5c" strokeWidth={6} fill="none" strokeLinecap="round" opacity={0.75} />
        ))}
        <path d={`M ${-92 - turn * 40} ${HY - 92} Q ${-22 - turn * 40} ${HY - 134} ${58 - turn * 40} ${HY - 110}`} stroke="#5d5d92" strokeWidth={13} fill="none" strokeLinecap="round" opacity={0.55} />
      </g>
      <circle cx={HX} cy={HY} r={HR} fill="none" stroke={L} strokeWidth={sw} />
    </g>
  ) : (
    <g>
      <ellipse cx={HX + fringeShift * 0.3} cy={HY - 14} rx={HR + 16} ry={HR + 12} fill={o.hair} stroke={L} strokeWidth={sw} />
      {ears}
      <circle cx={HX} cy={HY} r={HR} fill={skin} stroke={L} strokeWidth={sw} />
      <g clipPath={`url(#hc${uid})`}>
        <path d={fringe} fill={o.hair} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" />
      </g>
      <path d={`M ${-60 + fringeShift} ${HY - 120} Q ${-10 + fringeShift} ${HY - 148} ${50 + fringeShift} ${HY - 126}`} stroke="#4a4a78" strokeWidth={10} fill="none" strokeLinecap="round" opacity={0.7} />
      {blush}
      {brows}
      {eyes}
      {mouth}
      {sweat}
    </g>
  );
  const cowlick = (
    <path d={`M ${10 + fringeShift * 0.5} ${HY - HR - 4} Q ${30 + fringeShift * 0.5} ${HY - HR - 70} ${70 + fringeShift * 0.5} ${HY - HR - 52}`} stroke={o.hair} strokeWidth={14} fill="none" strokeLinecap="round" />
  );

  let headLook: React.ReactNode = null;
  if (!(cowlickHair && !lk.glasses)) {
    const c = ctx;
    const hb = cowlickHair ? {node: null, hideEars: false} : hairBack(c);
    const framed = !lk.hat && ['perm', 'bob', 'long'].includes(lk.hair);
    headLook = back ? (
      <g>
        {ears}
        <circle cx={HX} cy={HY} r={HR} fill={skin} stroke={L} strokeWidth={sw} />
        {cowlickHair ? <g clipPath={`url(#hc${uid})`}><path d={nape} fill={`url(#hairB${uid})`} stroke={L} strokeWidth={sw * 0.7} strokeLinejoin="round" /></g> : hairBackView(c)}
        {(cowlickHair || !['bob', 'perm', 'long'].includes(lk.hair)) && <circle cx={HX} cy={HY} r={HR} fill="none" stroke={L} strokeWidth={sw} />}
        {hat(c)}
      </g>
    ) : (
      <g>
        {cowlickHair ? <ellipse cx={HX + fringeShift * 0.3} cy={HY - 14} rx={HR + 16} ry={HR + 12} fill={o.hair} stroke={L} strokeWidth={sw} /> : hb.node}
        {!hb.hideEars && ears}
        <circle cx={HX} cy={HY} r={HR} fill={skin} stroke={framed ? 'none' : L} strokeWidth={sw} />
        <g clipPath={`url(#hc${uid})`}>
          {cowlickHair ? <path d={fringe} fill={o.hair} stroke={L} strokeWidth={sw * 0.8} strokeLinejoin="round" /> : lk.hat === 'cap' || lk.hair === 'perm' ? null : hairFront(c)}
        </g>
        {lk.hair === 'perm' && !lk.hat && hairFront(c)}
        {framed && (() => {
          // face outline only where the skin meets the hair from below: no circle line over the hairstyle
          const [a0, a1] = lk.hair === 'perm' ? [-12, 192] : [52, 128];
          const P0 = [HX + HR * Math.cos((a0 * Math.PI) / 180), HY + HR * Math.sin((a0 * Math.PI) / 180)];
          const P1 = [HX + HR * Math.cos((a1 * Math.PI) / 180), HY + HR * Math.sin((a1 * Math.PI) / 180)];
          return <path d={`M ${P0[0]} ${P0[1]} A ${HR} ${HR} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${P1[0]} ${P1[1]}`} fill="none" stroke={L} strokeWidth={sw} strokeLinecap="round" />;
        })()}
        {lk.hat === 'cap' && (() => {
          // short temples under a peaked cap
          return [-1, 1].map((s2) => <path key={s2} d={`M ${s2 * (HR - 2)} ${HY - 70} L ${s2 * (HR - 30)} ${HY - 70} L ${s2 * (HR - 14)} ${HY + 10} Z`} fill={o.hair} stroke={L} strokeWidth={sw * 0.6} />);
        })()}
        {blush}
        {brows}
        {eyes}
        {mouth}
        {sweat}
        {wrinkles(ctx, eyeSp, fx, eyeY, mx, my)}
        {glasses(ctx, eyeSp, fx, eyeY)}
        {hat(c)}
      </g>
    );
  }
  // long hair behind the back: before the body from the front, over the back of the torso from behind
  const hairDown = hairBehindBody(ctx);
  const node = (
    <g>
      <defs>
        <linearGradient id={`hairB${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={scaleHex(o.hair, 1.5)} />
          <stop offset="1" stopColor={o.hair} />
        </linearGradient>
        <clipPath id={`hc${uid}`}>
          <circle cx={HX} cy={HY} r={HR + 5} />
        </clipPath>
      </defs>
      {back && hairDown}
      {cowlickHair && cowlick}
      {cowlickHair && !lk.glasses ? head : headLook}
    </g>
  );
  return {behind: back ? null : hairDown, head: node, chin: HY + HR};
}
