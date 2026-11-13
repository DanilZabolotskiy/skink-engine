// Chapter composition: draws timeline.json (tools/pipeline/timeline.py) shot by shot — the location kit of the channel, the title bar
// with its counter, the place tag, on-screen text cards, the episode plate, subtitles and dips between scenes. No sound: ffmpeg mixes the
// audio track (tools/pipeline/audio.py). Kits, cast, grades and the HUD theme come from the channel module (channel.ts), the drawing style from lib/styles.
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {BAR_H, EpisodePlate, FONT_KR, HUD_DEFAULT, HudTheme, PlaceTag, Subtitles, TitleBar, useFonts} from '../hud/hud';
import {clamp} from '../anim';
import {GradeCtx, gradeDom} from './grade';
import {Shot, Timeline} from './types';
import {StageCtx, StageJournal, StageLogCtx} from '../staging/journal';
import {HandMarkCtx} from '../character/hand';
import {PoseLogCtx} from '../character/arm';
import {StyleCtx} from '../character/style';
import {styleById} from '../styles';
import {useChannel} from './channel';
import {StubKit} from './stub';

function shotAt(shots: Shot[], f: number): Shot | null {
  let lo = 0;
  let hi = shots.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (f < shots[m].from) hi = m - 1;
    else if (f >= shots[m].to) lo = m + 1;
    else return shots[m];
  }
  return null;
}

// On-screen text of a shot (a document, a sign, a note…) as cards; lines separated by " / " become separate lines. The card label
// ("small caption card", "phone"…) is not shown, only the text for the viewer. Card place — at (staging.json → cards): top / bottom —
// stacked in the centre; tl / tr / bl / br — in a corner (the frame journal checks that it does not cover a head,
// tools/stage_layout.mjs); from — second of the shot when the card appears (an event), else the shot start.
// tools/pipeline/stage_check.py card_slots_free repeats these places.
type Card = {label: string; text: string; at?: string; from?: number};
const CARD_POS: Record<string, React.CSSProperties> = {
  top: {left: 0, right: 0, top: BAR_H + 60, alignItems: 'center'},
  bottom: {left: 0, right: 0, bottom: 60, alignItems: 'center'},
  tl: {left: 60, top: BAR_H + 60, alignItems: 'flex-start'},
  tr: {right: 60, top: BAR_H + 130, alignItems: 'flex-end'},
  bl: {left: 60, bottom: 70, alignItems: 'flex-start'},
  br: {right: 60, bottom: 70, alignItems: 'flex-end'},
};
const Cards: React.FC<{cards: Card[]; lt: number; dur: number; bottom?: boolean; theme: HudTheme}> = ({cards, lt, dur, bottom, theme: th}) => {
  const groups: Record<string, Card[]> = {};
  for (const c of cards) (groups[c.at && CARD_POS[c.at] ? c.at : bottom ? 'bottom' : 'top'] ??= []).push(c);
  return (
    <>
      {Object.entries(groups).map(([at, list]) => (
        <div key={at} style={{position: 'absolute', ...CARD_POS[at], display: 'flex', flexDirection: 'column', gap: 14}}>
          {list.map((c, i) => {
            const lines = c.text.split(' / ');
            const size = lines.length > 2 || c.text.length > 60 ? 30 : 44;
            const a = Math.min(clamp((lt - Math.max(0.2, c.from ?? 0)) / 0.3), clamp((dur - 0.1 - lt) / 0.3));
            return (
              <div key={i} data-stage="card" style={{background: th.card, color: th.cardText, border: `5px solid ${th.cardText}`, borderTop: `12px solid ${th.accent}`,
                padding: '12px 34px', fontFamily: FONT_KR, maxWidth: at === 'top' || at === 'bottom' ? 1400 : 760, boxShadow: `0 6px 0 ${th.cardText}`, opacity: a}}>
                {lines.map((l, k) => <div key={k} style={{fontSize: size, fontWeight: 800, lineHeight: 1.3, wordBreak: 'keep-all'}}>{l}</div>)}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
};

/** Kit layer for presets with a colour grade (ChannelModule.grades): after the frame is drawn, the kit colours are graded in the DOM.
 *  The key is the frame: the layer mounts anew every frame, so the grade starts from the kit's own colours, not from last frame's. */
const GradeLayer: React.FC<{preset: string; children: React.ReactNode}> = ({preset, children}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const {grades} = useChannel();
  React.useLayoutEffect(() => {
    if (ref.current && grades) gradeDom(ref.current, preset, grades);
  });
  return (
    <GradeCtx.Provider value={preset}>
      <div ref={ref} style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden'}}>{children}</div>
    </GradeCtx.Provider>
  );
};

/** clean — a clean frame for review sheets: no title bar, counter, place tag, cards, episode plate or subtitles.
 *  subs — burn subtitles into the frame (off by default: the pipeline writes a separate .srt). */
export const Chapter: React.FC<{timeline: Timeline; clean?: boolean; subs?: boolean}> = ({timeline, clean, subs = false}) => {
  useFonts();
  const ch = useChannel();
  const f = useCurrentFrame();
  const fps = timeline.fps;
  const t = f / fps;
  const shot = shotAt(timeline.shots, f);
  if (!shot) return <AbsoluteFill style={{background: '#000'}} />;
  const theme: HudTheme = {...HUD_DEFAULT, ...ch.hud?.theme};
  // the drawing style of the figures: timeline.json → style (channel.json → style or run.py --style); an unknown id is an error
  const style = styleById(timeline.style ?? '');
  const lt = t - shot.start;
  const def = shot.kit ? ch.kit(shot.kit) : undefined;
  const Kit = def?.Kit;
  const Stub = ch.stub ?? StubKit;
  const dur = shot.end - shot.start;
  // on-screen text that the kit draws itself (a document on the desk, a framed notice) is not repeated as a card
  const own = def?.cards;
  const cards = own ? shot.cards.filter((c) => !own(c.label, shot)) : shot.cards;
  const dip = Math.max(shot.dipIn ? 1 - clamp(lt / shot.dipIn) : 0, shot.dipOut ? 1 - clamp((dur - lt) / shot.dipOut) : 0);
  const kit0 = Kit ? <Kit shot={shot} t={t} lt={lt} f={f} /> : <Stub shot={shot} t={t} lt={lt} f={f} about={shot.about} />;
  // the staging layer of the shot goes into context: figures (figure.tsx Figure) take their gesture from it, kits — events and states
  const kitNode = (
    <StyleCtx.Provider value={style}>
      <StageCtx.Provider value={{stage: shot.stage, lt, fps}}>{kit0}</StageCtx.Provider>
    </StyleCtx.Provider>
  );
  return (
    <AbsoluteFill data-stage="root" style={{background: '#000', overflow: 'hidden'}}>
      {ch.grades?.[shot.preset] ? <GradeLayer key={f} preset={shot.preset}>{kitNode}</GradeLayer> : kitNode}
      {shot.kit && !def && <div style={{position: 'absolute', left: 40, top: 120, background: '#FFE14D', padding: 10, fontSize: 30}}>no kit "{shot.kit}"</div>}
      {!clean && cards.length > 0 && <Cards cards={cards} lt={lt} dur={dur} bottom={shot.cardsAt === 'bottom'} theme={theme} />}
      {!clean && shot.bar && (
        <TitleBar theme={theme} t={t} title={shot.bar} counter={shot.counter} counterLabel={ch.hud?.counterLabel} stamp={shot.stamp ?? undefined}
          emphasis={shot.counter?.crossed.length ? 0.5 + 0.5 * Math.sin(lt * 8) : 0} />
      )}
      {!clean && shot.place && (
        <PlaceTag theme={theme} lines={shot.place} f={f} from={shot.from + Math.round(0.4 * fps)} to={Math.min(shot.to - Math.round(0.2 * fps), shot.from + Math.round(5.6 * fps))}
          fade={Math.round(0.35 * fps)} />
      )}
      {!clean && shot.episodePlate && <EpisodePlate theme={theme} text={shot.episodePlate} brand={ch.hud?.brand} a={Math.min(clamp((lt - 0.2) / 0.3), clamp((3.2 - lt) / 0.4))} />}
      {dip > 0.001 && <AbsoluteFill style={{background: `rgba(0,0,0,${dip})`}} />}
      {subs && !clean && <Subtitles t={t} cues={timeline.cues} accent={theme.accent} />}
      <StageJournal frame={f} shot={shot.id} />
    </AbsoluteFill>
  );
};

/** Chapter with the frame journal (service composition): tools/stage_layout.mjs collects it for the layout checks (docs/STAGING.md). */
export const ChapterStage: React.FC<React.ComponentProps<typeof Chapter>> = (props) => (
  <StageLogCtx.Provider value={true}>
    <Chapter {...props} />
  </StageLogCtx.Provider>
);

/** Chapter with hands filled with a marker colour — service composition for the hand crop sheets (tools/hands_sheet.py). */
export const ChapterHands: React.FC<React.ComponentProps<typeof Chapter>> = (props) => (
  <HandMarkCtx.Provider value={true}>
    <Chapter {...props} />
  </HandMarkCtx.Provider>
);

/** Chapter with the arm pose journal in the browser console — service composition for the pose check (tools/hands_check.mjs). */
export const ChapterPoses: React.FC<React.ComponentProps<typeof Chapter>> = (props) => (
  <PoseLogCtx.Provider value={true}>
    <Chapter {...props} />
  </PoseLogCtx.Provider>
);

export const EMPTY_TIMELINE: Timeline = {fps: 30, width: 1920, height: 1080, frames: 30, duration: 1, title: '', shots: [], cues: []};
