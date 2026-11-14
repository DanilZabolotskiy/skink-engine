// Drawing styles of a character. The core (lib/character) solves the figure: body proportions and posture, arms, hands and grips (body.ts),
// the gait (walk.ts), the emotion as numbers (emotions.ts), the gaze, the head placement on the neck (Character.tsx). A style draws it: the
// head with the face and the hair, the torso, the legs and the clothes, the sleeves and the hands, its outlines and shading; props come
// from the shared library (lib/props). Styles are add-ons in lib/styles/<id>/, registered in lib/styles/registered.ts; channel.json → style
// picks the style of a chapter, Person.style the style of a role. docs/STYLES.md describes how to add a style.
import React from 'react';
import type {Outfit} from './Character';
import type {Face} from './emotions';
import type {Look} from './looks';
import type {Body, Hand} from './body';
import type {Pt} from './arm';

/** Input of the head: head units — the head is drawn at full size with the crown at about y = −1006 (body.ts CROWN_Y); the core scales it
 *  by headScale around the crown, tilts it around pivot and moves it with breathing and posture. turn −1..1 (1 — facing right on
 *  screen); gx, gy — gaze −1..1 (gy −1 — up); blink 0..1; ppu — frame pixels per head unit (for minimum line widths). */
export type HeadIn = {o: Outfit; look: Look; uid: string; t: number; face: Face; blink: number; turn: number; gx: number; gy: number; back: boolean; ppu: number};

/** Neck from the front, if the style draws a visible neck: jaw — the bottom of the head (jaw and chin, head units, with the nod);
 *  top — the neck edges under the head; edges — x of the neck edges at the collar (head units from the body middle: far and near
 *  edge); draw — the neck as a column from the collar (baseY, body units) to the head, with map taking head units to body units and
 *  sc the head scale. The core lifts the head until the visible neck is not a wedge and writes these points to the pose journal (the
 *  neck check of tools/hands_check.mjs). */
export type NeckFront = {jaw: Pt[]; top: [Pt, Pt]; edges: [number, number]; draw: (map: (q: Pt) => Pt, sc: number, baseY: number) => React.ReactNode};

/** The head, in head units: behind — drawn before the legs (hair behind the back); under — after the legs, before the torso (the hair
 *  mass behind the neck); neck — from behind, under the torso; head — the head itself (marked for the frame journal); front — a visible
 *  front neck (NeckFront); chin — the bottom of the chin at rest; back — from behind: the turn of the back of the head (rad) and the
 *  share of the lost-profile features 0..1 (the head journal). */
export type HeadOut = {behind?: React.ReactNode; under?: React.ReactNode; neck?: React.ReactNode; head: React.ReactNode; front?: NeckFront; chin: number;
  back?: {th: number; eye: number; ear: number}};

/** Input of the body: the solved pose (body.ts), breathing breathS (torso scale around the hips), mark — hands filled with a marker
 *  colour (hand crop sheets). */
export type BodyIn = {o: Outfit; look: Look; uid: string; t: number; back: boolean; body: Body; breathS: number; mark: boolean; seed: string};

/** The body, in figure units: legs, torso, arms (with hands and props; from behind they go under the torso), over — arms over the
 *  head (a phone at the ear); neck — where the neck enters the clothes at the front: y — the top of the collar with breathing, y0
 *  — without it, stoop — how much of the head drop comes from stooping, open — the collar is open and the neck shows as a strip
 *  (not a stand-up collar). */
export type BodyOut = {legs: React.ReactNode; torso: React.ReactNode; arms: React.ReactNode; over: React.ReactNode; neck: {y: number; y0: number; stoop: number; open: boolean}};

export type CharacterStyle = {
  /** Style id: the folder name in lib/styles (channel.json → style, Person.style, run.py --style). */
  id: string;
  /** Head units → body units: the head is scaled by this around the crown. */
  headScale: number;
  /** y of the head–neck joint, head units: the head tilts around it. */
  pivot: number;
  head: (p: HeadIn) => HeadOut;
  body: (p: BodyIn) => BodyOut;
  /** Optional self-check of the drawn hands for the pose journal (tools/hands_check.mjs): gap — how far a finger base is outside the palm
   *  outline, notch — the deepest notch between neighbouring fingers (hand frame units); with grip (the centre and the axis of a prop in the
   *  fist, hand frame) — wrap, how many fingers lie on the prop. A style without it skips the rules "finger", "fingers apart" and "wrap". */
  handAudit?: (h: Hand, grip?: {c: Pt; axis: Pt}) => {gap: number; notch: number; wrap?: number};
};

/** The style of every Character inside that does not set its own (Chapter.tsx provides the channel style). */
export const StyleCtx = React.createContext<CharacterStyle | null>(null);
