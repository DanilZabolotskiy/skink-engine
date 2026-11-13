// Kit "counter": the café counter from above (flat 2D, no perspective). The loyalty card is drawn by the kit itself (KIT.cards →
// counterCards), so the TEXT of the shot is on the card, not on a card of the HUD. Movement comes only from events of the staging layer:
//   paper.slide — the card slides in from the right edge onto the counter (sound "paper" at 10 % of the progress, lib/staging/actions.json)
//   stamp.press — the stamp comes down from the top edge onto the tenth circle and lands at the end of the event (sound "stamp" on
//                 landing); the tenth circle is stamped from that moment
//   stamp.lift  — the stamp goes back up out of the frame (a channel action: pipeline/parts/s01e01.json → channel.actions)
// The camera moves only when the camera line asks for it (push-in over the whole shot).
import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {FONT_KR, FONT_MONO} from '../../../../lib/hud/hud';
import {KitProps, Shot} from '../../../../lib/chapter/types';
import {beat, eventOf, propAt} from '../../../../lib/staging/stage';
import {propMark} from '../../../../lib/staging/journal';
import {smooth} from '../../../../lib/anim';
import type {KitDef} from '../../../../lib/chapter/registry';
import {palOf} from '../palette';

const CARD_W = 1000;
const CARD_H = 600;
const CIRCLE = (i: number): [number, number] => [130 + (i % 5) * 185, 255 + Math.floor(i / 5) * 145]; // stamp circle i (0..9) on the card

/** Text cards this kit draws itself: the loyalty card. */
export const counterCards = (label: string) => /^card|^loyalty/i.test(label);

const cardOf = (shot: Shot) => shot.cards.find((c) => counterCards(c.label));

/** A coffee-cup stamp inside a circle. */
const CupStamp: React.FC<{c: [number, number]; color: string}> = ({c, color}) => (
  <g transform={`translate(${c[0]} ${c[1]})`} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
    <path d="M -26 -14 L 22 -14 L 16 24 L -20 24 Z" fill={color} />
    <path d="M 22 -6 Q 38 -6 36 8 Q 34 18 18 16" />
    <path d="M -12 -28 q 6 -8 0 -14 M 4 -28 q 6 -8 0 -14" strokeWidth={5} />
  </g>
);

export const CounterKit: React.FC<KitProps> = ({shot, lt}) => {
  const {width: W, height: H} = useVideoConfig();
  const o = palOf(shot.preset);
  const dur = shot.end - shot.start;
  const zoom = shot.move === 'push' ? 1 + 0.04 * smooth(dur > 0 ? lt / dur : 0) : 1; // cam: push-in over the whole shot
  // the card: off the right edge until paper.slide; a shot without the event — the card already lies on the counter
  const slide = eventOf(shot.stage, 'paper.slide') ? beat(shot.stage, 'paper.slide', lt) : 1;
  const cx = W * 0.54 + (1 - slide) * W * 0.62;
  const rot = -2 + (1 - slide) * 8;
  const pressEv = eventOf(shot.stage, 'stamp.press');
  const press = beat(shot.stage, 'stamp.press', lt);
  const lift = beat(shot.stage, 'stamp.lift', lt);
  // the tenth circle is stamped from the landing on; a shot without the press shows the state of the card (set card:loyalty stamped)
  const stamped = pressEv ? press >= 0.999 : (propAt(shot.stage, 'card:loyalty', 'stamped', lt) ?? 0) > 0.5;
  const doc = cardOf(shot);
  const lines = (doc?.text ?? 'LOYALTY CARD / Corner Café').split(' / ');
  // the stamp: from above the top edge down to the tenth circle (press), then back up out of the frame (lift)
  const stampDy = -H * (1 - press) - H * lift;
  const stampOn = pressEv !== null && press > 0 && lift < 0.999;
  const left = cx - CARD_W / 2;
  const top = (H - CARD_H) / 2 + 20;
  const [sx, sy] = CIRCLE(9);
  return (
    <AbsoluteFill style={{background: o.woodTop, overflow: 'hidden'}}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${zoom})`, transformOrigin: '55% 50%'}}>
        {/* counter boards, a saucer with a cup and a spoon */}
        <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0}}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={-20} y={i * 190 - 60} width={W + 40} height={186} fill={i % 2 ? o.woodTop : o.wood} stroke={o.outline} strokeWidth={4} />
          ))}
          <circle cx={250} cy={280} r={150} fill="#FFFFFF" stroke={o.outline} strokeWidth={7} />
          <circle cx={250} cy={280} r={96} fill="#F3EEE6" stroke={o.outline} strokeWidth={5} />
          <circle cx={250} cy={280} r={74} fill="#5A3622" stroke={o.outline} strokeWidth={5} />
          <ellipse cx={232} cy={262} rx={30} ry={18} fill="#C89A6C" opacity={0.8} />
          <g transform="translate(150 760) rotate(-18)">
            <rect x={0} y={0} width={300} height={24} rx={12} fill="#C4C9D1" stroke={o.outline} strokeWidth={5} />
            <ellipse cx={316} cy={12} rx={40} ry={26} fill="#C4C9D1" stroke={o.outline} strokeWidth={5} />
          </g>
        </svg>
        {/* the loyalty card */}
        <div {...propMark('card:loyalty', stamped ? 'stamped' : 'nine')} style={{position: 'absolute', left, top, width: CARD_W, height: CARD_H, background: o.paper,
          border: `6px solid ${o.outline}`, borderRadius: 28, boxShadow: '14px 16px 0 rgba(0,0,0,0.22)', transform: `rotate(${rot}deg)`, fontFamily: FONT_KR,
          color: o.ink, boxSizing: 'border-box', overflow: 'hidden'}}>
          <div style={{position: 'absolute', left: 0, top: 0, right: 0, height: 150, background: o.brand}} />
          <div style={{position: 'absolute', left: 56, top: 26, fontFamily: FONT_MONO, fontSize: 26, letterSpacing: 6, color: '#FFFFFF', opacity: 0.85}}>{lines[0]}</div>
          <div style={{position: 'absolute', left: 56, top: 60, fontSize: 60, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.1}}>{lines[1] ?? ''}</div>
          {lines[2] && <div style={{position: 'absolute', left: 56, bottom: 26, fontSize: 30, fontWeight: 700, opacity: 0.8}}>{lines[2]}</div>}
          <svg width={CARD_W} height={CARD_H} style={{position: 'absolute', left: -6, top: -6}}>
            {Array.from({length: 10}, (_, i) => {
              const c = CIRCLE(i);
              const done = i < 9 || stamped;
              return (
                <g key={i}>
                  <circle cx={c[0]} cy={c[1]} r={56} fill={done ? '#E8F4F1' : 'none'} stroke={o.brand} strokeWidth={6} strokeDasharray={done ? undefined : '14 10'} />
                  {done && <CupStamp c={c} color={i === 9 ? '#E76F51' : o.brand} />}
                </g>
              );
            })}
          </svg>
        </div>
        {/* the stamp, seen from above: a round wooden knob over its square base; it covers the tenth circle until it lifts */}
        {stampOn && (
          <div style={{position: 'absolute', left, top, width: CARD_W, height: CARD_H, transform: `rotate(${rot}deg) translateY(${stampDy}px)`}}>
            <div style={{position: 'absolute', left: sx - 100, top: sy - 100, width: 200, height: 200, background: '#6B4A33', border: `6px solid ${o.outline}`,
              borderRadius: 26, boxShadow: '12px 14px 0 rgba(0,0,0,0.25)'}}>
              <div style={{position: 'absolute', left: 40, top: 40, width: 108, height: 108, borderRadius: 54, background: '#8A6446', border: `6px solid ${o.outline}`}} />
            </div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** The kit in the channel's kit registry (lib/chapter/registry.ts; parts/s01e01.json → locations.counter.kit); the loyalty card is its own text. */
export const KIT: KitDef = {id: 'counter', Kit: CounterKit, cards: counterCards};
