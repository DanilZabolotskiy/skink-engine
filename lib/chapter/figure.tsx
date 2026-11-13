// Figures of a channel's roles inside location kits: who is in the shot (timeline.json → shot.cast) → person (ChannelModule.personFor:
// outfit, look, height, drawing style) → Character (lib/character). The figure takes its gesture, walk pace and mouth from the shot's
// staging layer, so a kit only places it (feet point, pixels per metre) and aims its gaze.
import React from 'react';
import {Character, OUTFIT_DEFAULT, Outfit} from '../character/Character';
import {Hold, Look} from '../character/looks';
import {blinkAt, faceAt, talkAt} from '../character/emotions';
import type {BodyGest} from '../character/body';
import {CastMember} from './types';
import {GradeCtx, gradeStr} from './grade';
import {FONT_KR} from '../hud/hud';
import {StageCtx} from '../staging/journal';
import {Stage, StageEvent, eventsOf, hold as holdK, phaseOf} from '../staging/stage';
import {styleById} from '../styles';
import {Person, useChannel} from './channel';

export type {Person};

/** Outfit helper: top, trousers, hair and overrides; the other colours come from OUTFIT_DEFAULT. */
export const outfitOf = (top: string, trousers: string, hair: string, extra: Partial<Outfit> = {}): Outfit => ({...OUTFIT_DEFAULT, top, trousers, hair, ...extra});

/** Yellow stub tag over something the channel has not drawn yet (a role without a person, a location without a kit). */
export const StubTag: React.FC<{x: number; y: number; text: string}> = ({x, y, text}) => (
  <div style={{position: 'absolute', left: x, top: y, transform: 'translate(-50%, -100%)', fontFamily: FONT_KR, fontSize: 22, fontWeight: 700,
    color: '#111', background: '#FFE14D', border: '3px solid #111', padding: '2px 10px', whiteSpace: 'nowrap'}}>{text}</div>
);

/** Stand-in for a role the channel does not know: a neutral figure, top colour by a hash of the name. */
function standIn(who: string): Person {
  let h = 0;
  for (const c of who) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tops = ['#5B7DB1', '#B15B5B', '#6E9E5A', '#8A6BB8', '#C98A3A'];
  return {outfit: outfitOf(tops[h % tops.length], '#2f3240', '#1a1820'), look: {hair: 'short', top: 'hoodie', w: 0.98}, h: 1.74};
}

/** Person of a role: the channel's cast, else a stand-in (unknown — draw a stub tag). */
function usePerson(who: string): {per: Person; unknown: boolean} {
  const ch = useChannel();
  const per = ch.personFor?.(who) ?? null;
  return per ? {per, unknown: false} : {per: standIn(who), unknown: true};
}

/** Emotions over a shot: the list from the timeline, evenly over the shot length (frames from the shot start). */
function emoPlan(emo: string[], dur: number, fps: number): [number, string][] {
  const list = emo.length ? emo : ['calm'];
  return list.map((e, i) => [Math.round((i / list.length) * dur * fps), e]);
}

/** Preset palette parts a figure takes: the skin under the light of the preset; the top and the hair — only for a hero (Person.hero). */
export type FigurePalette = {skin?: string; top?: string; hair?: string};

export type FigureOpts = {
  m: CastMember;
  pal?: FigurePalette;
  x: number; // screen: the point between the feet
  y: number;
  ppm: number; // pixels per metre at this depth (figure height = ppm × role height)
  f: number; // chapter frame
  lt: number; // seconds from the shot start
  dur: number;
  light?: number;
  facing?: 'front' | 'back';
  headTurn?: number;
  headTilt?: number;
  gazeX?: number;
  gazeY?: number;
  hold?: Hold[];
  walk?: number; // step phase (0 — standing)
  style?: React.CSSProperties;
  tag?: boolean; // stub tag over a role the channel does not know
  reach?: [number, number]; // hand point of a gesture (door handle, rail, window sash) — px in the same coordinates as x, y
  gest?: BodyGest | null; // a gesture instead of the shot's event (pose labs)
  pace?: string; // walk pace instead of the walk event (pose labs)
  breath?: number; // breathing amplitude (Character.breath): smaller in close-ups
  tapLift?: number; // thumb lift in tap (Character.tapLift)
};

/** Gesture of who at lt with the event fields (side, n, grip, stay) — like gestAt (lib/staging/stage.ts), but among running gestures the
 *  latest started wins (a held "stay" does not cover the next gesture: dial at the ear → hangup); before the start — the initial state
 *  of the nearest gesture (k = 0, ph = 0). hangup stays after the event: the phone is lowered. A gesture carried over the cut (carried)
 *  is in its final phase. */
function gestOf(stage: Stage | undefined, who: string, lt: number): BodyGest | null {
  const of = (e: StageEvent, k: number, ph: number): BodyGest => ({pose: String(e.pose), k, ph, side: e.side as string | undefined, n: e.n as number | undefined,
    grip: e.grip as string | undefined, dur: e.t1 - e.t0, stay: e.stay === true || e.pose === 'hangup'});
  let best: BodyGest | null = null;
  let bestT0 = -Infinity;
  let next: StageEvent | null = null;
  for (const e of eventsOf(stage, 'gesture', undefined, who)) {
    const k = holdK(e.pose === 'hangup' && e.stay !== true ? {...e, stay: true} : e, lt, 0.35, 0.35);
    if (k > 0.0005 && (e.t0 > bestT0 || (e.t0 === bestT0 && k > (best?.k ?? 0)))) {
      best = of(e, k, e.carried ? 1 : phaseOf(e, lt));
      bestT0 = e.t0;
    }
    if (lt <= e.t0 && (!next || e.t0 < next.t0)) next = e;
  }
  return best ?? (next ? of(next, 0, 0) : null);
}

/** Figure of a role in the shot: Character in the role's drawing style (+ a stub tag for a role the channel does not know). */
export const Figure: React.FC<FigureOpts> = (o) => {
  const {per, unknown} = usePerson(o.m.who);
  const ch = useChannel();
  const pal = o.pal;
  // a preset with a colour grade (ChannelModule.grades): clothes are a colour accent; skin and outline stay as they are; a
  // hero keeps its colours
  const gradePreset = React.useContext(GradeCtx);
  const gfn = gradePreset ? ch.grades?.[gradePreset] : undefined;
  const graded = !!gfn && !per.hero;
  const g = (c: string | undefined) => (gfn !== undefined && graded && c && c.startsWith('#') ? gradeStr(c, 'accent', gfn) : c);
  const base: Outfit = {...per.outfit, ...(pal?.skin ? {skin: pal.skin} : {}), ...(per.hero && pal?.top ? {top: pal.top} : {}), ...(per.hero && pal?.hair ? {hair: pal.hair} : {})};
  const outfit: Outfit = graded
    ? (Object.fromEntries(Object.entries(base).map(([k, v]) => [k, k === 'skin' || k === 'line' ? v : g(v as string)])) as Outfit)
    : base;
  const hold = (o.hold ?? (o.m.hold as Hold[] | undefined)) as [Hold, Hold] | undefined;
  // the figure's gesture is a gesture event of the staging layer (docs/STAGING.md): the pose and its progress follow the event
  // time, not kit code
  const sc = React.useContext(StageCtx);
  const fps = sc?.fps ?? 30;
  const gest = o.gest !== undefined ? o.gest : sc ? gestOf(sc.stage, o.m.who, sc.lt) : null;
  // walk pace — from the running walk event of this figure (pace: run — running)
  const walkEv = sc && o.walk ? eventsOf(sc.stage, 'walk', undefined, o.m.who).find((e) => sc.lt >= e.t0 - 0.05 && sc.lt <= e.t1 + 0.05) : undefined;
  const pace = o.pace ?? (walkEv?.pace as string | undefined);
  const look0: Look | undefined = per.look
    ? {...per.look, ...(hold ? {hold} : {})}
    : undefined;
  const look: Look | undefined = graded && look0
    ? {...look0, ...(look0.hatColor ? {hatColor: g(look0.hatColor)} : {})}
    : look0;
  const face0 = faceAt(Math.round(o.lt * fps), emoPlan(o.m.emo, o.dur, fps), 7);
  const talk = talkAt(o.lt, o.m.talk); // the role's own line: the mouth opens by syllables
  const face = talk > 0 ? {...face0, mouthOpen: Math.max(face0.mouthOpen, talk)} : face0;
  const facing = o.facing ?? o.m.facing;
  const hpx = o.ppm * per.h;
  // hand point of a gesture: frame px → local figure units (feet at (0, 0), height 1010)
  const reach: [number, number] | undefined = o.reach ? [((o.reach[0] - o.x) * 1010) / hpx, ((o.reach[1] - o.y) * 1010) / hpx] : undefined;
  const fig = (
    <>
      <Character outfit={outfit} look={look} face={face} blink={blinkAt(o.f, o.m.who.toLowerCase(), fps)} t={o.lt} light={o.light ?? 1} drawing={per.style ? styleById(per.style) : undefined}
        seed={o.m.who.toLowerCase()} facing={facing} headTurn={o.headTurn} headTilt={o.headTilt} gazeX={o.gazeX} gazeY={o.gazeY} walk={o.walk} gest={gest} reach={reach} pace={pace} breath={o.breath} tapLift={o.tapLift}
        x={o.x} y={o.y} height={hpx} style={o.style} />
      {o.tag !== false && unknown && <StubTag x={o.x} y={o.y - hpx - 30} text={`${o.m.who} · stub figure`} />}
    </>
  );
  // the grade layer grades kit colours in the DOM; it leaves the figure alone (its colours are already graded here)
  return gradePreset ? <div data-grade="keep" style={{display: 'contents'}}>{fig}</div> : fig;
};
