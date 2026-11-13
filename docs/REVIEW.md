# Reviewer memo

For the reviewers of a chapter video (production rule 14: the machine checks first, then reviewers, each on one part of the chapter). The memo **replaces reading [PRODUCTION_RULES.md](PRODUCTION_RULES.md) whole**: what to look at, in which order, and which rule to check against. A disputed finding — read only that rule: `python tools/read_role.py --sec docs/PRODUCTION_RULES.md "rules 12"`.

"Rule N" below is a numbered item of [PRODUCTION_RULES.md](PRODUCTION_RULES.md).

## Input

- The task: the part number, its shots and time, the known leftovers.
- The pack of the part — `CH/check/review/pack/partN/` (made by `tools/review_pack.py`):
  - `pack.md` — the shots of the part: camera, ON SCREEN, VO, who is in the frame, staging events with absolute time, key frames; tables of the sounds, of the bed at the cuts and of the line loudness. Read it once, whole.
  - `grid_K.jpg` — a 4×4 grid, a frame every second, 1280 px: the second and the shot on every cell, the label colour changes at a cut.
  - `shots/<shot>.jpg` — key frames of a shot, 640 px: the middle of a static shot; the start, a frame after every event, emotion and card, and the end.
  - `sounds_K.jpg` — a frame at the moment of every sound and music insert.
  - `full/*.jpg` — the same frames at full size, only for crops.
- The chapter video `CH/chNN.mp4`, if a frame is needed that the pack does not have.

## Order

1. `pack.md` of the part.
2. **Grids — motion.** Neighbouring cells: jitter and drift of a static shot, framing jumps, missing body parts, props and doors changing their look, walking on the spot, props moving without a cause. The first layer of rule 14.
3. **Shot sheets — readability and the script.** On a 640 px frame name every figure and every prop within a second. Compare with the shot line in `pack.md`: who is in the frame, what is in the hands, where they look, whether the action of the line is visible. The second layer of rule 14.
4. **1:1 crops — small things.** Hands, faces, necks, props in hands, doors, edges, texts, the edge of the title bar. Confirm every finding with a crop.
5. **Sound** — by the tables of `pack.md` and `sounds_K.jpg`.
6. The result — the file of the part and a short answer.

## Pictures — sparingly

- **2–4 pictures per request**: several Read calls in one answer. One picture per request doubles the requests.
- Do not open a full-size frame whole: a sheet gives the overview, a crop gives the detail (a 400×300 crop costs a fraction of a full frame).
- A 1:1 crop: `python tools/review_pack.py crop pack/partN/full/<frame>.jpg x,y,w,h [x,y,w,h …] -o pack/partN/crops/<shot>_<what>.png`.
  - Numbers ≤ 1 are frame fractions: the place is seen on the shot sheet, x and y are fractions of its width and height (`0.45,0.15,0.2,0.3` — a hand near the middle). Numbers > 1 are pixels of the full frame.
  - Several boxes go into one row — one picture.
- A frame at any moment: `bash tools/frames.sh CH/chNN.mp4 pack/partN/full <second> [<second> …]` — one ffmpeg at a time.
- A motion frame by frame (a door, a gesture, a step): frames every 0.1 s with `frames.sh`, then a sheet — `python tools/sheet.py <sheet>.jpg "<shot>" <frame>=<label> … --cols 4 --w 480`, or crops of one place.

## Checklist

**Grid — motion and cuts**
- A static shot stands: no handheld camera, no drift; a figure at rest does not tremble (rule 2).
- Parts of a figure do not vanish or appear abruptly: ears, hair, hands, the shadow, a sweat drop; the nose does not jump at a turn (rule 3; the shadow of a figure — rule 9).
- The look and the head turn go where the target is in the frame, smoothly (rule 3).
- A step: the legs along the motion, no walking on the spot or moonwalk; the pace within the walk; at least two steps; the path does not go through a prop and ends at the prop of the line (rule 4).
- A figure does not jump or vanish within a frame; it leaves the frame whole, not as a big cut-off head (rules 4a, 4b).
- A prop moves with a cause: a visible hand moves a door or a window from the start to the end of the motion; a sheet, a sign, a button do not change by themselves (rules 5, 6, 7). A door moves continuously, without a jump of its look (rule 7); numbers and signs on walls do not jump (rule 7a).
- The camera: no jump without a reason; a push-in is even, over the whole shot, without a jerk; two shots in a row on one part of a document are not at different sizes; lines and headers do not pass under the title bar while the camera moves (rule 1).
- Across a cut: the same clothes, the prop in the same hand, the same door state and preset; the side of a figure in the same view, the axis kept; the look and the emotion continue; the text of a document is not swapped (rules 1, 3).
- The mouth moves by the syllables of the one who speaks in the frame; blinking is there (rule 4c).

**Shot sheet — readability and the script line**
- Every figure and prop can be named: no unclear blots, no deformed figures, no translucent figures. A prop cut by the frame edge does not read as something else: it is either whole in the frame or out of it (rule 9).
- The shot does what its script line says: who, what is in the hands, where they look; the action of the line is visible (rule 9a). The VO does not contradict the frame.
- Framing: the head is not cut without intent; from behind — the head and the shoulders; the main subject is not small in a corner; furniture does not cover the foreground (rule 1).
- The gender and the age of a role read on a wide shot; the colours of a hero stay the same (rule 4d).
- Doors: the hinges on one jamb, the handle on the free edge; an open door — a plane with the opening and the threshold; what stands at the door of the shot is visible (rule 7).
- Nothing hangs in the air or is transparent; the scale of a figure matches the door and the furniture (rule 8).
- The story props, animals, water, glass are recognisable (rule 9).
- Colour: no halos or haze; a lamp is a flat disc; light lies only on surfaces; in the dark both the props and the figure darken (rule 9).

**1:1 crop — hands, faces, texts**
- An arm is one visible chain: shoulder, forearm, hand. No hand without a forearm in mid-frame, no stump, no "wing" at the chest; the elbow is not broken; the wrist is not bent back; the arm length is constant (rule 4d).
- A hand comes from the library: a mitten with a thumb with a rounded tip; no "sausages", "claws" or "rakes"; a fist wraps the prop; a folder is held by its near edge; a phone at the ear — the palm at the cheek (rule 4d).
- A gesture does not read as something else: a rude finger, "stop", "please", a thumbs-up.
- A neck from the front is a column from the collar under the head; from behind it comes out of the collar; a head turn from behind shows the features of the face, not an empty oval (rules 3, 4d).
- Texts: no typos; centred in their sign and inside it; whole in the frame, rotated no more than 30° and squeezed no more than twice; nothing cut in half at the title bar; a card does not cover a head (rules 10, 11, 11a).
- The title bar and the counter are right; a crossed-out cell is whole and crossed once (rule 11a).

**Sound — the tables of the pack**
- Every sound lands on its event in the frame: a door at the visible start or end of its motion, a lamp goes out — the click at that moment (rule 12). No sound without an event or before it; steps sound only while walking is visible; a sound at a cut does not fall into the wrong shot.
- A manual binding (`cue` in the table) — check the frame at that second; a source out of frame is clear (rule 12).
- The bed: by the place and the time of day; a loop with a source — where the source is visible (rule 13).
- The cuts — the "amb" column: ⚠ is a bed dropout, a finding (rule 13). A minimum in the "mix" column at a cut is usually a speech pause.
- Line loudness: Δ beyond ±2 LU of the target, or a line clearly quieter than its neighbours — a finding; a phone voice is duller by design (rule 13).
- No whisper unless the script asks for it (rule 13b); the number of hits and buzzes — as the sound description says (rule 13a); music — inserts of 3–15 s, no more than the channel allows per chapter (rule 13).

## A finding

- Only what is seen in the frame or measured. Each one with a crop.
- Severity:
  - **defect** — a viewer notices it at once, or the meaning breaks;
  - **noticeable** — seen with an attentive look;
  - **minor**.
- The known leftovers of the task — marked "known", not as new ones.
- One cause over many shots (for example a wrong look in every view of a kit) — one row with a list of shots.

## Working rules

- Fix nothing: neither the code, nor the video, nor the rules.
- Write only into `pack/partN/crops/` and the result file. Do not commit, do not start subagents.
- At most one ffmpeg at a time. Do not render, do not touch the GPU. No background processes at the end.

## The result

The file `CH/check/review/partN.md`:

```
# Chapter N, part K: shots AA.BB–CC.DD, T0–T1 s

| Time, s | Shot | Rule | What is wrong | Severity | Crop |
|---|---|---|---|---|---|
| 233.4 | 11.01 | 9 | the shadow under the figure appears within one frame at full size | defect | `pack/part6/crops/1101_shadow.png` |

Checked: grids 4, shots 7 (frames 21), sounds 9, cuts 7, lines 12; crops 18. Minutes: 9.
```

The answer to the orchestrator — 3–5 lines: the path to the file; the number of findings by severity; the three most visible, one line each.
