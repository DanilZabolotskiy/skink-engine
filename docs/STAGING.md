# Staging layer

The layer between the script and Remotion. Its job: sound out of sync, props jumping, walking on the spot, a door without a hand and text under the title bar must be impossible by construction or caught by a machine, not by the eye.

## Rules of the layer

1. **One event — both motion and sound.** An event is written once in `staging.json`. The kit draws by it, the sound lands by it.
2. **No timing in kit code.** No shot fractions, no seconds from the shot start. A kit reads `beat`, `lookK`, `eventOf`, `propAt`, `cutIndexAt`, `gestAt` (`lib/staging/stage.ts`). No event — no motion. The check "timing in kit code" reads the sources.
   - A camera move over the whole shot is not an event: the line is marked `// cam: …`. An insert fading in from the shot start — `// stage-ok: …`.
3. **One progress curve — `smooth`.** The event sound lands by the fraction of the **progress**, not of time: `["door", "end", 0]` — the leaf within 0.5 % of its range from the final value, visibly closed (`"start"` — visibly started; the same for any event length); `["paper", 0.1, 0]` — the sheet visibly started moving.
4. **A prop moves with a cause.** An action with `"hand": true` (door, window) needs `who` and their `gesture` at the start of the motion. Otherwise — `"hand": "<why the hand is not visible>"` or `"by": "<what moves it>"`.
5. **`cue` — only an out-of-frame sound** (`"offscreen": true`) and starting a loop. Visible motion is set by a library action.
6. **At least two steps per segment:** a step and a closing step. No steps sound inside an `offscreen` window of a path; the frame journal checks the window against what is visible.
7. **Ambience by place.** A place has a default bed (`channel.json → locations.<place>.ambience`) that runs without a script line. The same bed is not interrupted at a cut; different ones crossfade over 0.6 s.
8. **A shot line is an event.** Every action verb of ON SCREEN and camera is performed by an event of the one who acts: "he pulls the door shut" — `door.close` + `gesture pull` of this role, "counts on his fingers" — `gesture count`, "a bell rings" — a sound in the shot. A state description (stands, holds, frozen, looking) is not an action. Otherwise — fix the line or `verbs_ok` with a reason.
9. **The same figure across a cut.** The look and gesture a figure ended a shot with, and its emotion, carry into the next shot of the scene until a new event changes them. Another emotion from the first frame — only with a reason (`emo_cut`).
10. **A loop with a visible source.** A sound with `needs` in `sfx.json` (running water) starts in a shot where its source is visible: an event or a staging prop, or `offscreen_sfx` with a reason.

## Format — `staging.json` next to the script

```json
{
 "01.01": {"events": [
  {"do": "walk", "who": "OSCAR", "u": [0.08, 0.72], "from": [2.0, 5.6], "to": [0.95, 3.4], "shoe": "soft"}
 ]},
 "01.02": {"events": [
  {"do": "look", "who": "MIRA", "to": "oscar", "u": [0.12, 0.6], "stay": true}
 ]},
 "01.03": {"cards": [{"at": "br", "on": "count"}], "events": [
  {"do": "gesture", "who": "OSCAR", "pose": "count", "n": 3, "u": [0.12, 0.88]}
 ]},
 "02.02": {"events": [
  {"do": "stamp.press", "obj": "card:loyalty", "u": [0.2, 0.42]},
  {"do": "stamp.lift", "obj": "card:loyalty", "u": [0.5, 0.68]}
 ]}
}
```

- **Time:** `"u": [start, end]` — shot fractions; `"t"` — seconds (negative — from the end). One number — the start, the length comes from the library.
- **`do`** — an action of `lib/staging/actions.json` (a channel adds its own in `channel.json → actions`, `poses`):

  | Action | What it does | Sound |
  |---|---|---|
  | `set` | prop state at the shot start | — |
  | `door.open` / `door.close`, `window.close` | `open` of a prop; needs a hand (rule 4) | `door` at the visible start / end of the motion |
  | `lamp.flicker`, `lamp.on`, `lamp.off`, `lamp.burst` | a lamp `obj` | flicker, click, hit |
  | `walk` | path `from → to`, m; `pace`: `slow` (0.9–1.6 steps/s) / `walk` (0.9–2.6) / `run` (2–4.4); `offscreen`: `[u0, u1]` — the figure is not visible; `"at": "<prop>"` — the path ends at the prop | steps by foot contacts, `shoe` |
  | `gesture` | pose `pose` of `who` (poses — `actions.json → poses`); `"stay": true` — the pose stays | by the entry |
  | `look` | look and head turn of `who`, `to` — a target point of the kit; `in` / `out`, s; `stay` | — |
  | `paper.slide`, `paper.open`, `paper.unfold` | a sheet slides in, opens, unfolds | `paper` at 10 % of the progress |
  | `stamp.press`, `box.set` | a stamp, a box: a hit at the end of the motion | `stamp`, `box_thud` |
  | `pen.mark`, `keypad.light`, `drop.run`, `hand.grab`, `hand.out`, `beam.sweep` | pen, lock, drop, hand, torch beam | — |
  | `prop.fall`, `prop.roll`, `prop.stop`, `prop.spin` | prop `obj` falls, rolls, stops, spins: `down` / `roll` / `spin` 0 → 1 | by the entry |
  | `cut` | a cut inside the shot (`why` required) | — |
  | `cue` | sound `sfx` out of frame; `see` required | `sfx` |

  Gesture poses: `push`, `pull`, `press`, `write`, `dial`, `tap`, `hangup`, `rail`, `count`, `straighten`, `point`, `knock` (see `actions.json → poses`). Gesture fields: `side` — the figure's own hand (`R` / `L`), `n` — fingers of `count` or hits of `knock`, `grip: "fist"` — a fist on the handle, `stay`, `in` / `out`, s; `ramp` — the entry share of `tap` (`0.001` — the figure is in the phone from the first frame of a long shot).
- On an event: `"sfx": false` — no sound; `"sfx": ["id"]` — an own sound; `"offscreen": true` — the source is out of frame.
- On a shot:
  - `"view"`, `"move"`, `"cast"` — override what the script words give (`cast`: `{"who", "emo", "facing", "hold", "shoe"}`; `hold` — the figure's hands [right, left]);
  - `"sfx": {"paper": null}` — no script sound in the shot;
  - `"cards": [{"at": "top|bottom|tl|tr|bl|br", "on": "<action or pose>"}]` — place and moment of the TEXT cards in order; `"on": "line:N"` — with the start of the N-th line of the shot (a caption of an off-screen voice); `"cardsAt": "bottom"`;
  - `"lead": 1.5` — pause before the first line, s (action before speech);
  - `"effects": {"0": "phone"}` — processing of a line of the shot (a phone voice);
  - `"voice_cut": {"0": {"file": "<take>.mp3", "head": 1.0, "why": "…"}}` — an extra sound at the start of a take (the TTS voiced "…" as a word): the clip voice starts at `head` s, a cut in the silence before the speech (`onset`); the clip place and the mouth stay, no re-render — steps `parse,timeline,audio,assemble,check`. The entry belongs to its take: another file, no `why` or `head` ≥ `onset` — a staging error;
  - `"bed": false` — silence by design; `"shake": "<why>"` — frame shake;
  - `"verbs_ok": {"<phrase>": "<why the frame shows it without an event>"}`;
  - `"emo_cut": {"<who>": "<why>"}` (or `"cut"` in a `cast` entry) — another emotion from the first frame;
  - `"offscreen_sfx": {"<id>": "<why the source is clear without the frame>"}`;
  - `"cut_in": "<why>"` on the first shot of a scene — a hard cut between scenes without a dip;
  - `{"do": "set", "obj": "gaze:<role>", "ray": 1}` — the look of a figure facing the camera goes where its target is seen in the frame: a target farther than the head is taken on the camera ray 0.5 m in front of the head (`gazeBy`, `lib/chapter/room.tsx`). For a target behind the figure or right above its head (otherwise a turn through 180° with a random sign, a look to the side).
  - `{"do": "set", "obj": "hud", "stamp": 1}` — the stamp of the title bar in a light colour on the bar backing: the background under it is dark or busy and the dim stamp merges with it.
- At the top level of `staging.json`: `"lip_raw": "<why>"` — the mouth follows the aligned syllables as they are, without stretching short ones (for a chapter accepted before that rule: its rebuilt timeline keeps the mouth of the accepted video).

## What the pipeline does

`tools/pipeline/staging.py` (called by `timeline.py`):

- **States.** An event writes a state track of a prop. The state carries from shot to shot of a scene; another value at a cut is an error without `"cut": "<why>"`.
- **Walking.** `walk` → a figure path: acceleration 0.45 s, a steady part, a stop; a whole number of steps, at least two; a pace outside `pace` is an error.
- **Sound.** Event sounds land by the event progress. A script `SFX` covered by an event is not duplicated. A one-shot sound without an event is an error. A loop with `needs` without a source in its first shot is an error.
- **Across a cut.** `look` / `gesture` held to the end of a shot become a `"carried"` event at the start of the next shot of the scene for the same figure; an emotion not named continues, another one named at a cut is an error.
- **Line → event** (`verb_issues`). Dictionary — `actions.json → verbs` and `channel.json → action_verbs` (first): `re` — the verb, `need` — event variants (`door.close+gesture:pull@`: `@` — an event of the one who acts; `walk!at@` — with the field `at`; `sfx:<id>` — a sound of the shot; `line@` / `line:any` / `line:who` — a line). The subject is the nearest role before the verb (a name, `cast_words`, "he / she" by `cast_pron` and previous shots). Negations ("does not move", "as if …") and camera moves do not count.
- **Beds.** `shot.bed` — the bed of a shot; `bed_segments` merges equal neighbours into one track (`audio/amb.wav`).
- In `timeline.json`: `shot.stage = {events, props}`, a sound has `event`.

## In a kit

```ts
const open = propAt(shot.stage, 'door:main', 'open', lt);   // state; null — the shot says nothing about the prop
const k = beat(shot.stage, 'paper.slide', lt);              // event progress 0..1; no event — 0
const turn = lookK(shot.stage, 'OSCAR', lt, 'door');        // look with a return
const j = cutIndexAt(shot.stage, lt);                       // how many in-shot cuts have passed
const g = gazeBy(cam, shot.stage, 'MIRA', lt, head, 'front', POINTS, 'cam');  // head turn and gaze to a kit point (lib/chapter/room.tsx)
const p = pathAt(member.path, u, dur);                      // where a walking figure is and its step phase
```

A kit does not pass the gesture to a figure: `Figure` (`lib/chapter/figure.tsx`) takes it from the shot context (`StageCtx`), the skeleton (`lib/character/body.ts`) solves the pose and the drawing style draws it. See `channels/example/chapter/kits/` for two complete kits.

## Frame journal

`tools/stage_layout.mjs` renders the service composition `<channel>-chapter-stage` and collects what stands where in the finished frame by the `data-stage` marks (`lib/staging/journal.tsx`):

| Mark | What it is |
|---|---|
| `bar` | the title bar |
| `card` | a text card |
| `head`, `fig` (+ `data-who`) | a head and a figure; `fig` (`Character.tsx`) has `data-facing`, `data-pose`, `data-turn`, `data-tilt`, `data-gaze`, `data-arms` |
| texts | **all** SVG `<text>` and HTML text of the kit layer — no manual mark: letter box, size, rotation, squeeze, visibility, the sign under the letters. An intended cut — `data-cut-ok="<why>"` |
| `line` | non-text at the title bar and the edge: a frame edge, a clip, a lamp shade |
| `read` (+ `data-read`) | a text the shot must show in full: a room number, a sign, a display |
| `prop` | a place or story prop: `<PropMark id state needs />` or `{...propMark(id, state, needs)}` on the element itself (then the journal knows its box too) |
| `hand` | a hand drawn by the kit: `{...handMark('pen.mark', who)}` |
| `hit` | a figure stands inside a prop (set by the kit: `HitMark`) |

Journal frames: start, middle and end of a shot, every step, the end of every gesture; for `look` and `gesture` the frame before the event and the peak (also saved as 960×540 pixels), for door and hand events ±2 frames at the start and end and the progress every 0.1 s.

## Checks

`tools/pipeline/stage_check.py` → `check/staging/report.md` (and `check/precheck/staging/report.md` in precheck), `sounds.md`, `events.json`.

| Check | By | precheck |
|---|---|---|
| sound without an event; sound on a cut; cue on visible motion; motion without a cause | timeline | yes |
| prop state jump at a cut; emotion jump at a cut; step pace; shot without ambience; action without an event; emotion not in the dictionary | timeline | yes |
| card on a head; card / text under the title bar; text cut by the edge or its box, rotated, squeezed, out of its sign; required text not readable; text long under the title bar | journal | yes |
| event without a visible change (look, gesture, a frozen hand, an event hand, a hand at a leaf); view not as in cast; path not at the prop; prop jump at a cut; place prop changed; prop without a cause; appearing / vanishing within one frame | journal + event pixels | yes |
| step of an invisible figure; figure walks without steps; path through a prop | journal | yes |
| figure jump at a cut in the same view; look reset by an insert; hard cut with a dip; day ambience at night; the impression in the bar badge (in a `stamp.press` shot the badge is not the one of the chapter start: TEXT `stamp "…"` sets the bar badge) | timeline + scenes | yes |
| voice not in band (phone) | voice files | yes |
| timing in kit code | kit sources | yes |
| arm poses: lengths, elbow, wrist, thumb side, palm rotation, grip, "wing", stump, hand without an arm, kink, neck wedge; fingers (the joints of the skeleton pose; with the hand self-check of the style — a finger torn off the palm), fingers apart, wrap, prop through the arm; `--motion` — jump between neighbouring frames of a gesture; `--sweep` — every engine pose without a chapter: jump, mirror | `tools/hands_check.mjs` | yes |
| jump in frame; small jump; jitter, drift of a static shot; camera jerk; sound on a still frame | video frames | no |
| ambience dropout at a cut; line quieter than its neighbours | the mix | no |

Standalone: `python tools/pipeline/stage_check.py <work folder> [--shots 04.01,04.02] [--no-video] [--no-layout] [--out folder] [--keep-png]`. Thresholds and their reasons are in the constants at the top of `stage_check.py`.

## What the layer does not check

The meaning of a pose beyond the arm rules, framing between shots, the drawing of a prop, whether a sound matches its description — by eye, see [PRODUCTION_RULES.md](PRODUCTION_RULES.md).
