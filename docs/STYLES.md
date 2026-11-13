# Drawing styles

The engine is a core plus drawing-style add-ons.

- **The core** (`lib/character/`) solves the figure: body proportions and posture, the arms (IK with constant lengths), hands and grips, the gait, the emotion as numbers, the gaze, where the head sits on the neck. It draws nothing.
- **A style** (`lib/styles/<id>/`) draws the solved figure: the head with the face and the hair, the torso, the legs, the clothes, the sleeves and the hands, its outlines and shading. A style folder imports only the core (`lib/character`, `lib/props`, `lib/anim`), never another style.
- **The registry** `lib/styles/registered.ts` lists the styles, one line each: `export {webtoon} from './webtoon';`. A chapter takes its style from `channel.json → style` (`run.py --style <id>` for one run), a role from `Person.style`; an unknown id is an error.

Props in hands (a cup, a phone, a folder…) are shared: the core places an item at the grip point of a hand, a style draws it with `drawItem(item, {line, sw, folder})` from `lib/props/props.tsx`. Because the core owns the pose, every style gets the same arm lengths, grips and pose journal, so the arm checks (`tools/hands_check.mjs`) and the staging checks apply to every style unchanged.

| Id | Look |
|---|---|
| `webtoon` | Webtoon proportions (5–6 heads tall), an egg-shaped face with a jaw, iris eyes, thin brows, hair as a mass of strands, a thin outline, flat fills with one step of shade, a drawn hand for every grip |
| `western` | A round-headed cartoon: a big round head, dot eyes, simple brows, a thick outline, gradient clothes, thick rounded arms, mitten hands |

## Adding a style

1. Create `lib/styles/<id>/index.tsx` exporting a `CharacterStyle` (start from the template below). The folder name is the id.
2. Add one line to `lib/styles/registered.ts`: `export {plain} from './plain';` (for the template below).
3. Use it: `"style": "<id>"` in `channel.json`, or `run.py <script.md> --estimate --no-stt --style <id> --work <folder>` for a try, or `Person.style` for one role.
4. Check it: `--steps parse,timeline,precheck` must give 0 errors (the arm poses and "gesture without a change" run on your drawing), then look at the frames (`tools/stills.mjs`, the `example-lineup` composition).

Nothing in `lib/character`, `lib/chapter` or the pipeline changes. A new pose, grip or prop is not a style matter: it goes to the core (`body.ts`, `hand.ts`) or to `lib/props`, so every style gets it and the checks cover it.

## The interface

`lib/character/style.ts`:

```ts
export type CharacterStyle = {
  id: string;                         // the folder name: channel.json → style, Person.style, run.py --style
  headScale: number;                  // head units → body units: the head is scaled around the crown
  pivot: number;                      // y of the head–neck joint, head units: the head tilts around it
  head: (p: HeadIn) => HeadOut;
  body: (p: BodyIn) => BodyOut;
};
```

- **`head(HeadIn) → HeadOut`.** The head is drawn at full size in head units, the crown at about `y = −1006`. The input: outfit colours, the look, the emotion (`Face` of `emotions.ts`), blinking, the head turn −1..1, the gaze, whether the figure is seen from behind, `ppu` (frame pixels per head unit). The output: `head` and `chin` (the bottom of the chin at rest) are required; optional layers are `behind` (hair behind the back), `under` (hair behind the neck), `neck` (the neck from behind), `front` (a visible front neck: the core lifts the head until it is not a wedge and writes it to the pose journal) and `back` (the head-from-behind journal).
- **`body(BodyIn) → BodyOut`.** The input has the solved pose `Body` (`lib/character/body.ts`): half-widths of the shoulders, chest, waist and hips, the shoulder height, stoop, running, the bounce, foot lifts and the arms. Every arm is a list of layers, bottom to top: `{t: 'arm', S, E, W, part, one}` (shoulder, elbow, wrist in 3D), `{t: 'hand', h, back}` (a hand frame: wrist `W`, fingers along `f`, thumb or palm along `u`, scale `k`, shape, view and `q` — the progress of a live shape such as counting fingers; `back` — the part behind a prop) and `{t: 'item', item}` (a prop to draw with `drawItem`). The output: `legs`, `torso`, `arms`, `over` (arms over the head, such as a phone at the ear) and `neck` (where the neck enters the clothes; the core fits the head to it).
- **Hands** are drawn in the hand frame of `lib/character/hand.ts` (the wrist at the origin, the fingers along +y), placed with `handMatrix`. A style may draw every shape (`webtoon`) or one mitten (`western`), but live shapes must move: a count with frozen fingers fails the "gesture without a change" check.

## Template

The smallest complete style; it passes the precheck of the example chapter.

```tsx
// The plain style: the smallest complete drawing style — a round head with dot eyes, a box torso, stick arms and legs, round hands.
import React from 'react';
import {clamp} from '../../anim';
import {HIP, Layer} from '../../character/body';
import {handMatrix} from '../../character/hand';
import type {BodyIn, BodyOut, CharacterStyle, HeadIn, HeadOut} from '../../character/style';
import {drawItem} from '../../props/props';

const LINE = 8; // outline width, figure units

/** The head in head units: the crown at y = −1006 (the core scales the head around it by headScale). */
function head({o, face, blink, turn, gx, gy, back}: HeadIn): HeadOut {
  const eyes = back ? null : [-1, 1].map((s) => (
    <ellipse key={s} cx={s * 48 + turn * 40 + gx * 8} cy={-880 + gy * 8} rx={11} ry={11 * Math.max(0.1, 1 - blink)} fill={o.line} />
  ));
  const mouth = back ? null : <path d={`M ${-30 + turn * 40} -800 Q ${turn * 40} ${-800 + 30 * face.mouthCurve} ${30 + turn * 40} -800`} stroke={o.line} strokeWidth={LINE} fill="none" strokeLinecap="round" />;
  return {head: <g><circle cx={0} cy={-870} r={136} fill={o.skin} stroke={o.line} strokeWidth={LINE} />{eyes}{mouth}</g>, chin: -734};
}

/** The body in figure units (feet at y = 0): every arm layer the core solved, in its order. */
function body({o, body: b}: BodyIn): BodyOut {
  const layer = (l: Layer, key: string): React.ReactNode => {
    if (l.t === 'arm') {
      const d = `M ${l.S[0]} ${l.S[1]} L ${l.E[0]} ${l.E[1]}` + (l.part === 'full' ? ` L ${l.W[0]} ${l.W[1]}` : '');
      return <path key={key} d={d} stroke={o.top} strokeWidth={b.armW} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
    }
    if (l.t === 'item') return <g key={key}>{drawItem(l.item, {line: o.line, sw: LINE, folder: o.folder})}</g>;
    if (l.back) return null; // the part of a hand behind a prop: a simple style draws the hand once, in front
    const h = l.h; // the hand frame: the wrist at (0, 0), the fingers along +y; q of count — how many fingers are raised (smoothly)
    const fingers = h.shape === 'count' ? [0, 1, 2, 3].map((i) => (
      <rect key={i} x={-15 + i * 8} y={28} width={7} height={12 + 28 * clamp(h.q - i)} rx={3.5} fill={o.skin} stroke={o.line} strokeWidth={LINE / h.k / 2} />
    )) : null;
    return (
      <g key={key} transform={handMatrix(h.W, h.f, h.u, h.k)}>
        {fingers}
        <circle cx={0} cy={24} r={20} fill={o.skin} stroke={o.line} strokeWidth={LINE / h.k} />
      </g>
    );
  };
  const arms = (over: boolean) => b.arms.filter((a) => a.over === over).map((a, i) => <g key={i}>{a.layers.map((l, j) => layer(l, `${i}.${j}`))}</g>);
  const legs = [-1, 1].map((s, i) => (
    <path key={s} d={`M ${s * 40 * b.w} ${HIP} L ${s * 40 * b.w} ${-b.liftH * b.lift[i]}`} stroke={o.trousers} strokeWidth={56} strokeLinecap="round" />
  ));
  const torso = <rect x={-b.sx * b.w} y={b.shY} width={2 * b.sx * b.w} height={HIP + 30 - b.shY} rx={40} fill={o.top} stroke={o.line} strokeWidth={LINE} />;
  return {legs: <g>{legs}</g>, torso, arms: <g>{arms(false)}</g>, over: <g>{arms(true)}</g>, neck: {y: b.shY, y0: b.shY, stoop: 0, open: false}};
}

export const plain: CharacterStyle = {id: 'plain', headScale: 0.8, pivot: -740, head, body};
```
