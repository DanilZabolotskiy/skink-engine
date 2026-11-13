// Lineup of the example cast in both built-in drawing styles (lib/styles: webtoon, western). Composition example-lineup:
//   frame 0 — the two roles in both styles, facing the camera and from behind;
//   frame 1 — the same skeleton drawn by both styles: the same holds and the same gesture side by side (webtoon | western);
//   frame 2 — a row of emotions (lib/character/emotions.ts);
//   frame 3 — a mop in both styles: at the side, the knock gesture mid-hit, raised over the head from behind.
import React from 'react';
import {AbsoluteFill, Composition, useCurrentFrame} from 'remotion';
import {Character} from '../../../lib/character/Character';
import {EMOTIONS} from '../../../lib/character/emotions';
import type {BodyGest} from '../../../lib/character/body';
import type {Hold} from '../../../lib/character/looks';
import type {CharacterStyle} from '../../../lib/character/style';
import {FONT_KR, useFonts} from '../../../lib/hud/hud';
import {STYLES} from '../../../lib/styles';
import {CAST} from './cast';

const {webtoon, western} = STYLES;

const Label: React.FC<{x: number; y: number; text: string}> = ({x, y, text}) => (
  <div style={{position: 'absolute', left: x, top: y, transform: 'translateX(-50%)', fontFamily: FONT_KR, fontSize: 28, fontWeight: 800, color: '#3B2A20',
    whiteSpace: 'nowrap'}}>{text}</div>
);

type Cell = {who: string; style: CharacterStyle; facing?: 'front' | 'back'; turn?: number; hold?: [Hold, Hold]; gest?: BodyGest; text: string};

const Lineup: React.FC = () => {
  useFonts();
  const f = useCurrentFrame();
  const floor = <div style={{position: 'absolute', left: 0, right: 0, top: 860, bottom: 0, background: '#E3D2B8', borderTop: '6px solid #1E1A17'}} />;
  const count: BodyGest = {pose: 'count', k: 1, ph: 0.9, n: 3};
  const knock: BodyGest = {pose: 'knock', k: 1, ph: 0.25, dur: 2, n: 3}; // 0.5 s into the event: the first hit
  const cells: Cell[] = f === 1 ? [
    {who: 'MIRA', style: webtoon, hold: ['phoneEar', 'cup'], text: 'phone · cup'},
    {who: 'MIRA', style: western, hold: ['phoneEar', 'cup'], text: 'phone · cup'},
    {who: 'OSCAR', style: webtoon, hold: ['pen', 'folder'], text: 'pen · folder'},
    {who: 'OSCAR', style: western, hold: ['pen', 'folder'], text: 'pen · folder'},
    {who: 'MIRA', style: webtoon, gest: count, text: 'counts to 3'},
    {who: 'MIRA', style: western, gest: count, text: 'counts to 3'},
  ] : f === 2 ? ['calm', 'curious', 'alert', 'scared', 'relief', 'sad', 'surprised', 'amused', 'angry', 'asleep'].map((e, i): Cell => (
    {who: i % 2 ? 'OSCAR' : 'MIRA', style: webtoon, text: e}
  )) : f === 3 ? [
    {who: 'OSCAR', style: webtoon, hold: ['mop', 'none'], text: 'mop'},
    {who: 'OSCAR', style: western, hold: ['mop', 'none'], text: 'mop'},
    {who: 'MIRA', style: webtoon, hold: ['mop', 'none'], gest: knock, text: 'knock'},
    {who: 'MIRA', style: western, hold: ['mop', 'none'], gest: knock, text: 'knock'},
    {who: 'OSCAR', style: webtoon, facing: 'back', hold: ['mopRaised', 'none'], text: 'raised, from behind'},
    {who: 'OSCAR', style: western, facing: 'back', hold: ['mopRaised', 'none'], text: 'raised, from behind'},
  ] : [
    {who: 'MIRA', style: webtoon, turn: 0.2, text: 'MIRA · webtoon'},
    {who: 'OSCAR', style: webtoon, turn: -0.3, text: 'OSCAR · webtoon'},
    {who: 'OSCAR', style: webtoon, facing: 'back', turn: 0.4, text: 'from behind'},
    {who: 'MIRA', style: western, turn: 0.2, text: 'MIRA · western'},
    {who: 'OSCAR', style: western, turn: -0.3, text: 'OSCAR · western'},
    {who: 'MIRA', style: western, facing: 'back', text: 'from behind'},
  ];
  const step = 1920 / cells.length;
  const emo = f === 2;
  return (
    <AbsoluteFill style={{background: '#F6EEDF'}}>
      {floor}
      {cells.map((c, i) => {
        const x = step * (i + 0.5);
        const p = CAST[c.who];
        const look = c.hold && p.look ? {...p.look, hold: c.hold} : p.look;
        return (
          <React.Fragment key={i}>
            <Character x={x} y={900} height={(emo ? 560 : 680) * p.h / 1.72} face={emo ? EMOTIONS[c.text] : EMOTIONS.calm} t={0.4} outfit={p.outfit} look={look}
              seed={c.who.toLowerCase()} drawing={c.style} facing={c.facing} headTurn={c.turn} gazeX={c.turn} gest={c.gest} />
            <Label x={x} y={940} text={c.text} />
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

export const LineupCompositions: React.FC = () => (
  <Composition id="example-lineup" component={Lineup} fps={30} width={1920} height={1080} durationInFrames={4} />
);
