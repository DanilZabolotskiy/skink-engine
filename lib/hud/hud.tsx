// Interface over the frame: the title bar with an optional counter and stamp, the place tag, the episode plate, subtitles. Colours come
// from a HudTheme (a channel sets its own in ChannelModule.hud.theme). Fonts are local files (OFL).
import React from 'react';
import {AbsoluteFill, continueRender, delayRender, staticFile} from 'remotion';
import {clamp, windowFade} from '../anim';

export const FONT_KR = 'NotoSansKR';
export const FONT_MONO = 'NotoSansMono';

let fontsPromise: Promise<void> | null = null;
function loadFonts(): Promise<void> {
  if (!fontsPromise) {
    const faces = [
      new FontFace(FONT_KR, `url(${staticFile('fonts/NotoSansKR.ttf')})`, {weight: '100 900'}),
      new FontFace(FONT_MONO, `url(${staticFile('fonts/NotoSansMono.ttf')})`, {weight: '100 900'}),
    ];
    fontsPromise = Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff)))).then(() => undefined);
  }
  return fontsPromise;
}

export function useFonts() {
  const [handle] = React.useState(() => delayRender('fonts'));
  React.useEffect(() => {
    loadFonts().then(() => continueRender(handle));
  }, [handle]);
}

/** HUD colours (CSS colours). bar, barLine — the title bar and its bottom line; text, dim — the title and the secondary text (counter label,
 *  inactive cells, stamp); box, boxLine — counter cells; accent — the current and crossed cells, the stripe of the place tag, the episode
 *  plate and the cards, the highlight in subtitles; panel, panelText — the place tag and the episode plate; card, cardText — text cards;
 *  dot — a pulsing dot before the title (null — none); round — round counter cells. */
export type HudTheme = {
  bar: string; barLine: string; text: string; dim: string; box: string; boxLine: string; accent: string;
  panel: string; panelText: string; card: string; cardText: string; dot: string | null; round: boolean;
};
/** The default theme: a dark slate bar, a blue accent, square cells, no dot. */
export const HUD_DEFAULT: HudTheme = {
  bar: 'rgba(26,30,38,0.92)', barLine: '#3A414D', text: '#F2F4F7', dim: '#98A1AE', box: '#232934', boxLine: '#3A414D', accent: '#3D8BFD',
  panel: 'rgba(26,30,38,0.9)', panelText: '#FFFFFF', card: '#F4F6F9', cardText: '#151820', dot: null, round: false,
};

/** Height of the title bar, px: the layout checks keep texts out of this band (tools/pipeline/stage_check.py BAR_H). */
export const BAR_H = 50;

/** A counter in the title bar: total cells, current — the highlighted one, crossed — crossed out. */
export type Counter = {total: number; current: number; crossed: number[]};

export type TitleBarProps = {
  theme: HudTheme;
  t: number;
  title: string;
  counter?: Counter | null; // none — no cells
  counterLabel?: string; // a label before the cells
  stamp?: string; // a rotated stamp under the right end of the bar
  stampBack?: boolean; // the stamp on a dark backing in a light colour: the background under it is dark or busy (staging: set hud stamp 1)
  opacity?: number;
  emphasis?: number; // 0..1 — a flash of the current cell (when a cell is crossed out)
};

/** Title bar at the top: an optional pulsing dot, the title, an optional counter; an optional stamp under it. */
export const TitleBar: React.FC<TitleBarProps> = ({theme: th, t, title, counter, counterLabel, stamp, stampBack = false, opacity = 1, emphasis = 0}) => {
  const dot = 0.55 + 0.45 * Math.round(0.5 + 0.5 * Math.sin(t * Math.PI));
  const pulse = 0.75 + 0.25 * Math.sin(t * 4);
  return (
    <AbsoluteFill style={{pointerEvents: 'none', opacity}}>
      <div data-stage="bar" style={{
        position: 'absolute', left: 0, top: 0, width: '100%', height: BAR_H, background: th.bar, borderBottom: `2px solid ${th.barLine}`,
        display: 'flex', alignItems: 'center', padding: '0 28px', boxSizing: 'border-box',
        fontFamily: `${FONT_KR}, ${FONT_MONO}`, color: th.text, fontSize: 21, letterSpacing: 3, fontWeight: 500,
      }}>
        {th.dot && <span style={{color: th.dot, fontSize: 18, marginRight: 16, opacity: dot}}>●</span>}
        <span style={{whiteSpace: 'pre'}}>{title}</span>
        <div style={{flex: 1}} />
        {counter && counterLabel && <span style={{fontSize: 17, marginRight: 14, color: th.dim, letterSpacing: 4}}>{counterLabel}</span>}
        {counter && new Array(counter.total).fill(0).map((_, i) => {
          const n = i + 1;
          const off = counter.crossed.includes(n);
          const on = n === counter.current && !off;
          // a crossed-out cell reads at a glance: a frame of the accent colour and one clear diagonal line over it; the digit stays whole
          // over the line (with an outline of the bar colour) and the cell does not blink
          const edge = th.box;
          return (
            <div key={n} data-cell={off ? 'crossed' : on ? 'on' : undefined} style={{
              width: 30, height: 30, marginLeft: 6, boxSizing: 'border-box', position: 'relative', borderRadius: th.round ? 15 : 0,
              border: `2px solid ${on || off ? th.accent : th.boxLine}`,
              background: on ? th.accent : th.box, opacity: on ? 0.75 + 0.25 * pulse : 1,
              color: on ? th.panelText : off ? th.text : th.dim, fontFamily: FONT_MONO, fontWeight: 700, fontSize: 17, letterSpacing: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: on ? `0 0 ${10 * pulse + 20 * emphasis}px ${th.accent}` : 'none',
              transform: on ? `scale(${1 + 0.35 * emphasis})` : undefined, zIndex: on || off ? 2 : 1,
            }}>
              {off && (
                <svg width={38} height={38} viewBox="-4 -4 38 38" style={{position: 'absolute', left: -6, top: -6, overflow: 'visible'}}>
                  <path d="M -2 32 L 32 -2" stroke={edge} strokeWidth={6} strokeLinecap="round" />
                  <path d="M -2 32 L 32 -2" stroke={th.accent} strokeWidth={3.4} strokeLinecap="round" />
                </svg>
              )}
              <span style={{position: 'relative', textShadow: off ? `-2px 0 ${edge}, 2px 0 ${edge}, 0 -2px ${edge}, 0 2px ${edge}` : undefined}}>{n}</span>
            </div>
          );
        })}
      </div>
      {stamp && (
        <div style={{
          position: 'absolute', right: 30, top: BAR_H + 12, padding: '2px 12px', border: `3px solid ${stampBack ? th.text : th.dim}`,
          color: stampBack ? th.text : th.dim, fontFamily: FONT_KR, fontWeight: 900, fontSize: 24, letterSpacing: 6, transform: 'rotate(-6deg)', borderRadius: 4,
          // a dim stamp merges with a dark or busy background: a light stamp on the bar colour — only by staging (set hud stamp 1)
          background: stampBack ? th.bar : undefined,
        }}>{stamp}</div>
      )}
    </AbsoluteFill>
  );
};

/** Place and time tag in the corner (the first shot of a scene): a panel with large lines that read on any background (production rule
 *  11a). from, to — frames; fade — frames of the fade in and out. */
export const PlaceTag: React.FC<{theme: HudTheme; lines: string[]; f: number; from: number; to: number; fade: number}> = ({theme: th, lines, f, from, to, fade}) => {
  const a = windowFade(f, from, to, fade, fade);
  if (a <= 0) return null;
  return (
    <div style={{position: 'absolute', left: 44, bottom: 150, opacity: a, fontFamily: FONT_KR, color: th.panelText, background: th.panel,
      borderLeft: `8px solid ${th.accent}`, padding: '10px 24px 12px 18px'}}>
      {lines.map((l, i) => (
        <div key={i} style={{fontSize: i ? 32 : 36, fontWeight: i ? 700 : 800, letterSpacing: 1.5, marginTop: i ? 4 : 0, lineHeight: 1.25, opacity: i ? 0.92 : 1}}>{l}</div>
      ))}
    </div>
  );
};

/** Episode plate at the top left: an optional brand line over the episode text. a — opacity. */
export const EpisodePlate: React.FC<{theme: HudTheme; text: string; brand?: string; a: number}> = ({theme: th, text, brand, a}) => (
  <div style={{position: 'absolute', left: 40, top: BAR_H + 26, opacity: a}}>
    <div style={{background: th.panel, borderLeft: `12px solid ${th.accent}`, padding: '10px 30px', fontFamily: FONT_KR, color: th.panelText}}>
      {brand && !text.includes(brand) && <div style={{fontSize: 20, letterSpacing: 5, opacity: 0.7}}>{brand}</div>}
      <div style={{fontSize: 54, fontWeight: 900, letterSpacing: 3, lineHeight: 1.1}}>{text}</div>
    </div>
  </div>
);

export type Cue = {from: number; to: number; text: string}; // seconds

/** Subtitles by timings; {…} in the text is drawn in the accent colour (channel.json → subtitles.highlight). */
export const Subtitles: React.FC<{t: number; cues: Cue[]; size?: number; accent: string}> = ({t, cues, size = 50, accent}) => {
  const cue = cues.find((c) => t >= c.from && t <= c.to);
  if (!cue) return null;
  const a = Math.min(clamp((t - cue.from) / 0.15), clamp((cue.to - t) / 0.15));
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 74, display: 'flex', justifyContent: 'center', pointerEvents: 'none', opacity: a}}>
      <div style={{
        maxWidth: 1500, textAlign: 'center', fontFamily: FONT_KR, fontWeight: 700, fontSize: size, lineHeight: 1.35,
        color: '#FFFFFF', letterSpacing: 0.5, padding: '8px 26px', borderRadius: 10,
        background: 'rgba(0,0,0,0.65)',
        textShadow: '0 0 3px #000, 0 2px 8px rgba(0,0,0,0.9)',
        wordBreak: 'keep-all',
      }}>{cue.text.split(/(\{[^}]*\})/).map((p, i) => p.startsWith('{') ? <span key={i} style={{color: accent}}>{p.slice(1, -1)}</span> : p)}</div>
    </div>
  );
};
