// Type of timeline.json — the input of the chapter composition (written by tools/pipeline/timeline.py). Time — seconds from the chapter start.
import type {Stage} from '../staging/stage';
import type {Counter} from '../hud/hud';

/** A role in a shot: emo — emotions over the shot (spread evenly); facing — towards the camera or away from it; stub — the channel has
 *  no figure for it yet; hold — items in the figure's own hands [right, left] (facing the camera the right hand is on the left of the
 *  frame, from behind on the right); walk — stepping; at — place in the kit (metres or a point name, staging.json); talk — syllables of
 *  the role's own line [start, end], s from the shot start: the mouth opens on every syllable; path — the walk path over the shot; shoe
 *  — shoes for the step sound. */
export type CastMember = {who: string; emo: string[]; facing: 'front' | 'back'; stub?: boolean; hold?: string[]; walk?: boolean; at?: string | number[];
  talk?: [number, number][];
  path?: [number, number, [number, number], [number, number]][]; // [u0, u1, [x0, z0], [x1, z1]] (lib/staging/walk.ts)
  shoe?: string; // soft / slipper / heel …: the step sound id is step_<shoe>
};

export type Shot = {
  id: string;
  scene: string;
  start: number;
  end: number;
  from: number; // frames
  to: number;
  location: string;
  about?: string; // location description (channel.json) — for the stub
  kit: string | null; // location kit; null — stub
  preset: string;
  category: string;
  view: string; // kit view: wide / close / ots …
  move: 'push' | 'pull' | 'pan' | 'shake' | 'static';
  camera: string;
  on_screen: string;
  cast: CastMember[];
  flicker: [number, number][];
  lampOff: number | null;
  bar: string | null; // title bar text (script TEXT: title bar "…"); null — no bar
  counter: Counter | null; // counter cells of the title bar (script TEXT: counter 1–5, 2 lit)
  stamp?: string | null;
  place: string[] | null;
  cards: {label: string; text: string; at?: string; from?: number}[]; // at, from — place and moment of the card (staging.json → cards)
  dipIn?: number;
  dipOut?: number;
  episodePlate?: string;
  prev?: {id: string; view: string; kit: string | null}; // previous shot of the same scene: the kit continues its framing (timeline.py)
  stage?: Stage; // staging layer: shot events and prop states (lib/staging/stage.ts, docs/STAGING.md)
  cardsAt?: 'bottom'; // text cards at the bottom (staging.json) when at the top they would cover a head
};

export type Cue = {from: number; to: number; text: string};

export type Timeline = {
  channel?: string; // channel id: composition <channel>-chapter (remotion/Root.tsx)
  style?: string; // drawing style of the figures: a style id of lib/styles (channel.json → style, run.py --style)
  fps: number;
  width: number;
  height: number;
  frames: number;
  duration: number;
  title: string;
  shots: Shot[];
  cues: Cue[];
};

export type KitProps = {shot: Shot; t: number; lt: number; f: number};
