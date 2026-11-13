// Staging layer (docs/STAGING.md): shot events and prop states from timeline.json → shot.stage.
// Written by tools/pipeline/staging.py from staging.json; a location kit only reads it: motion and sound come from one event.
// Time — seconds from the shot start. A state track is keys [t, value], smooth between keys: no jump is possible.
// One progress curve per layer: smooth(time fraction). The pipeline places the event sound by it too (staging.py inv_smooth):
// a kit writes no times and curves of its own — only beat / hold / propAt.
import {clamp, smooth} from '../anim';

export type StageEvent = {do: string; obj?: string; who?: string; t0: number; t1: number; [k: string]: unknown};
export type Track = [number, number][];
export type Stage = {events: StageEvent[]; props: Record<string, Record<string, Track>>};
type Sel = {obj?: string; who?: string; pose?: string};

function trackAt(keys: Track, lt: number): number {
  if (lt <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (lt <= t1) return v0 + (v1 - v0) * smooth((lt - t0) / Math.max(1e-6, t1 - t0));
  }
  return keys[keys.length - 1][1];
}

/** State of prop obj.key at lt; null — the shot staging says nothing about the prop. */
export function propAt(stage: Stage | undefined, obj: string, key: string, lt: number): number | null {
  const tr = stage?.props?.[obj]?.[key];
  return tr?.length ? trackAt(tr, lt) : null;
}

/** Shot events: the action by the start of its name ("door.", "lamp.on"), the prop, who. */
export function eventsOf(stage: Stage | undefined, act: string, obj?: string, who?: string): StageEvent[] {
  return (stage?.events ?? []).filter((e) => e.do.startsWith(act) && (!obj || e.obj === obj) && (!who || e.who === who));
}

/** Event fraction 0..1 at lt (before the start — 0, after the end — 1). A hold from the previous shot ("carried") — the final phase: the
 *  phone is already at the ear. */
export const phaseOf = (e: StageEvent, lt: number) => (e.carried ? 1 : clamp((lt - e.t0) / Math.max(1e-6, e.t1 - e.t0)));

/** The first event of an action (or null): a kit needs its t0 / t1 — "the hand comes in 0.8 s before the leaf moves". */
export const eventOf = (stage: Stage | undefined, act: string, sel: Sel = {}): StageEvent | null =>
  eventsOf(stage, act, sel.obj, sel.who).find((x) => !sel.pose || x.pose === sel.pose) ?? null;

/** Event progress 0..1 (smooth): before the start — 0, after the end — 1. No event — 0: without an event a kit moves nothing. */
export function beat(stage: Stage | undefined, act: string, lt: number, sel: Sel = {}): number {
  const e = eventOf(stage, act, sel);
  return e ? smooth(phaseOf(e, lt)) : 0;
}

/** Hold 0..1: comes in over tin s from the event start, holds, goes out over tout s towards its end or stays ("stay": true).
 *  A head turn "looked round and back", a gesture "raised a hand — lowered it". The event fields "in" / "out" — own times, s. */
export function hold(e: StageEvent | null | undefined, lt: number, tin = 0.5, tout = 0.5): number {
  if (!e) return 0;
  // "carried": a look or a gesture a figure ended the previous shot of the scene with (staging.py carry_in): fully from the first frame,
  // goes out over out towards t1 — to meet a new event of the same figure; without a new one — "stay": true, it holds the whole shot
  if (e.carried) return e.stay === true ? 1 : smooth((e.t1 - lt) / Math.max(1e-6, (e.out as number | undefined) ?? tout));
  const len = Math.max(1e-6, e.t1 - e.t0);
  // "stay": true without "in" — the pose builds over the whole event and stays
  const a = smooth((lt - e.t0) / Math.max(1e-6, (e.in as number | undefined) ?? (e.stay === true ? len : Math.min(tin, len))));
  const b = e.stay === true ? 1 : smooth((e.t1 - lt) / Math.max(1e-6, (e.out as number | undefined) ?? Math.min(tout, len)));
  return Math.min(a, b);
}

/** Gesture of figure who at lt: pose, hold k (entry at the event start, exit towards the end; "stay": true — the pose stays) and event
 *  fraction ph. No gesture — null: the arm is in the pose of its item. The skeleton (lib/character/body.ts) solves the gesture pose, the
 *  drawing style draws it. */
export type Gest = {pose: string; k: number; ph: number};
export function gestAt(stage: Stage | undefined, who: string, lt: number): Gest | null {
  let best: Gest | null = null;
  let next: StageEvent | null = null;
  for (const e of eventsOf(stage, 'gesture', undefined, who)) {
    const k = hold(e, lt, 0.35, 0.35);
    if (k > (best?.k ?? 0.0005)) best = {pose: String(e.pose), k, ph: phaseOf(e, lt)};
    if (lt <= e.t0 && (!next || e.t0 < next.t0)) next = e;
  }
  // before the gesture starts — its initial state (k = 0, ph = 0): the phone is still in front, the palm has not slid yet
  return best ?? (next ? {pose: String(next.pose), k: 0, ph: 0} : null);
}

/** Look and head turn of who by a look event (to — where: the name of a kit target): 0..1, with a return unless "stay": true. */
export function lookK(stage: Stage | undefined, who: string, lt: number, to?: string): number {
  let k = 0;
  for (const e of eventsOf(stage, 'look', undefined, who)) if (!to || e.to === to) k = Math.max(k, hold(e, lt));
  return k;
}

/** Cuts inside a shot (cut events): the index of the part of the shot at lt — how many cuts have passed. */
export const cutIndexAt = (stage: Stage | undefined, lt: number) => eventsOf(stage, 'cut').filter((e) => lt >= e.t0).length;
