# Production rules

Rules for the staging, animation and sound of every shot. They are numbered: the code, the checks, the reviewer memo ([REVIEW.md](REVIEW.md)) and the reading lists of the chapter agents refer to them by number ("production rule 12"); `python tools/read_role.py --sec docs/PRODUCTION_RULES.md "rules 4d, 7"` prints single rules. "Machine: …" names the automatic check that catches a violation ([STAGING.md](STAGING.md), "Checks"); the rest is checked by eye on the finished video.

- **The check by these rules is part of production:** before a chapter goes to the owner, every rule is checked over the whole video, second by second, with sound, by the scheme of rule 14.
- **One fix round:** the machine and the reviewers → one round of fixes → a new render and the machine checks → to the owner with the list of what is not fixed.
- **A problem found becomes a rule:** one or two lines under the right rule here (a channel keeps its own rules in its own file), so that the next chapter does not repeat it.

## Camera and editing

1. **A change of shot and framing is motivated.**
   - The camera does not jump without a reason or too often; a smooth move instead of a hard change where possible.
   - Two shots in a row on the same part of a document with different framing — a defect; from a wide shot of a form to one line of it — a push-in, not a cut; the text of a document does not change at a cut.
   - "Same" or "same axis" in the script — the first frame comes from the camera of the previous shot, the size changes by a push-in.
   - A beat inside a shot (another floor, another moment) — a hard cut, the event `cut` with a reason; not a dip into black for a few frames (it reads as a flicker). A camera that cannot pass a figure — a `cut` too.
   - A "hard switch" of the script — `"cut_in": "<why>"` on the first shot of the scene, a join without a dip. Machine: "hard cut with a dip".
   - In the same static view a figure does not change its side or the prop in its hands at a cut — otherwise another view or a motion in the frame. Machine: "figure jump at a cut in the same view".
   - The shots of a scene stay on one side of the line between two characters; if a face is seen only from the other side, the script line gives the look no sideways direction.
   - **A camera move** — acceleration, a steady part, deceleration; a static shot has no camera move at all. A push-in or a ride over paper runs over the whole shot from the frame of the previous shot, straight on the screen (what is below the title bar at the start and at the end stays below it in the middle); the frame edge moves no faster than ~40 px per frame. Machine: "camera jerk".
   - A push-in only on a shot with `move: push`, and the kit applies `shot.move`. A push-in from one place is a scale of the whole frame from its centre, not a change of the field of view at the same camera point: line widths rounded to 0.5 px would change over the whole frame within one frame.
   - **Under the title bar** (translucent; texts at it — rule 11) — an empty wall, ceiling or table. A document is framed by the rectangle of everything at its top edge, or the edge of the bar falls into a gap between the props. A per-chapter change of a shared framing is an option the staging of the chapter switches on, not an edit of the shared code: that would move accepted chapters (guard).
   - The last frame of a push-in keeps the header of the document; a line of a document and a sign of a kit are whole below the bar or out of the frame — the machine checks the start and the end of the shot.
   - A line leaving the top edge while the camera moves passes the bar for no more than 0.6 s: the push-in starts from a frame where the bar edge lies in an empty strip above the target; another part of the sheet — a cut. Machine: "text long under the title bar".
   - Motion in the frame starts and ends below the bar, and leaves by the lower or a side edge or by a cut.
   - A figure from behind fills the frame with the head and the shoulders: not a nape at the frame edge ("a head without a body") and not a small head on a huge back. A climb seen from behind starts at the first step (the figure from the hips), not at a landing next to the camera.
   - The camera follows the main subject of the shot. Two figures — across the line between them; one standing behind another sitting — apart in the frame by half a body or more, not one above the other. After any change of a figure's place every view of the scene is checked for overlapping figures.
   - A card of the script is not on the main prop of the shot (`cards → at`); a shot with a face at the top edge — the card at the bottom (`at: bottom`).
   - A figure in a doorway — at full height, the prop of the action whole in the frame. "At the door" — right at the door; the prop of the line is not behind the figure.
   - A change of a screen (a phone, a monitor) is an event (a card slides in, the list moves), not a jump at a cut.
2. **A static shot is static.** Frame or figure shake only by the story (a hit, a fright). A character at rest does not tremble.
   - No "handheld" noise of the camera turn on static shots, no drift or turn of a sheet, no hand tremor on a sheet; the trembling of fear is not a fast noise of many pixels per frame; an animal at rest has no noise.
   - A figure does not move by whole pixels apart from a smooth background.
   - Papers have no `drift`; the background moves by no more than ~1 px over a static shot. Machine: "drift of a static shot".
   - Breathing scales with the size of the figure in the frame (`Figure breath`): a head in a close-up moves by ±4 px at most. Machine: "jitter of a static shot".

## Characters and motion

3. **Parts of a figure do not vanish or appear abruptly:** ears, hair, hands.
   - An ear is one shape clipped by the silhouette, without transparency: the far one does not vanish at a turn, the near one is not covered by a strand of the back hair. The nose does not switch sides within a frame when the head turns through full face.
   - A small detail of a face grows from zero and goes to zero; a sweat drop — one per emotion, at the temple on the skin, it grows with the emotion and stays. Machine: "small jump".
   - A detail of a turn grows from zero by the angle; the points of a contour are not thinned by the turn (a chain of curls would renumber).
   - Something leaves by narrowing or fading over 0.25 s or longer. A shadow coming from behind a corner is clipped by the plane of the corner.
   - The far eye and brow stay inside the face silhouette and under the hair; they narrow from the outer corner and go.
   - The skin tone is constant at any emotion for every role, fear shows as shadows under the eyes; the mouth changes smoothly, an open mouth grows from a closed line. At least 2 s between blinks.
   - **An emotion** is a face name of `lib/character/emotions.ts` or a script word of `EMO_WORDS` (`tools/pipeline/timeline.py`); a name outside the dictionary would silently draw a calm face. Machine: "emotion not in the dictionary". The fright of a line starts with the line, not after it.
   - **From behind** — the back of the head in three quarters: the cheek, the jaw, the ear, the temple of the glasses; the head turn is visible. A turn from behind is a living head, not a skin-coloured oval: a small one — the back of the head, the ear, the cheek down to the jaw angle; a large one — a lost profile with the features at the cheek contour. Machine: `hands_check` "turn from behind without features".
   - **A look up or down:** the pupils to the lid, the lid lower, the head nods with it (a kit gives a figure facing the camera `headTilt` from `gazeY`); the pupils alone do not read.
   - **The direction of a look** comes from the position of the target in the place (`gazeTo` / `gazeBy`), not from a sign in kit code; "in front of him" for a figure facing the camera — towards the camera.
   - A target behind the figure or right above its head — the look goes where the target is seen in the frame: the state `{"do": "set", "obj": "gaze:<role>", "ray": 1}` makes `gazeBy` take the target on the camera ray 0.5 m in front of the head (otherwise a turn through 180° with a random sign, or a look to the side).
   - A target out of the frame nearer to the camera than the head — the look into the side of the frame where it is; on a close-up the target is on the side of the frame where it is on the wide shot of the scene, so the side does not flip at a cut.
   - The initial look of a shot is set by the kit (`cast → gaze`): an event from the first frame is not seen.
   - **Across a cut** what a figure ended the shot with (a look, a gesture) stays in the next shot of the scene until its new event (`carried`), also across an insert without people. Machine: "look reset by an insert".
   - The emotion continues across a cut; another one from the first frame — only with `emo_cut` and a reason; a kit takes the emotion only from the staging (`shot.cast[].emo`). Machine: "emotion jump at a cut".
   - A role with a collared shirt has a longer neck (`look.neck`); someone sitting at a table — `hold rest`: the forearms on the table.
4. **Steps.**
   - The legs step along the direction of motion, do not cross and do not swing sideways in the frame plane ("scissors").
   - No walking on the spot: the body speed matches the step.
   - The pace is within the walk: 0.9–2.6 steps per second, running up to 4.4, `slow` no slower than 0.9; the pace follows the body speed. Machine: "step pace".
   - An even motion: acceleration, a constant speed, a stop (not ease-in-out with a peak three times the mean speed); at least two steps per segment.
   - `pace: run` — the knee forward, a bounce, bent arms swinging, a bag swinging; not a glide on straight legs.
   - Someone climbing away from the camera is not drawn facing it (a "moonwalk").
   - A path does not go through a prop. Machine: "path through a prop".
   - Walking into the dark means darkening and vanishing: past the last lit lamp the figure darkens to a silhouette and disappears, and its steps are not heard then (`offscreen` from that step).
   - A path to a prop — `walk … "at": "<prop>"`; a figure with a gesture at a prop stands within reach (≤ 0.95 of the arm).
   - The next view starts where the figure ended the previous shot.
   - A figure whose reaction is the point of the shot faces the camera; a look at the source is a `look` event.
   - A body has no side view: a turn by 180° is a head turn over the shoulder or a cut that makes the turn clear.
   - While the voice-over talks about walking, the figure walks (a climb to the next flight is a `cut` beat inside the shot, not a figure standing on a landing).
   - A look at the feet does not read from behind (the head does not nod from behind): a view from above, the figure walking towards the camera.
4a. **No instant jumps.** A figure or an animal does not change its place within one frame: only by an animation or by a cut that makes sense. Machine: "appearing / vanishing within one frame".
4b. **A character does not vanish from a shot without a reason.** A figure does not get stuck at the frame edge and does not leave as a big cut-off head: the beat ends by a cut earlier.
4c. **The mouth opens by the syllables of the line** of the one who speaks in the frame; a still mouth during speech is a defect.
   - A syllable is stretched to 0.1 s but not past the next one (a short aligned syllable would open the mouth for one frame); a syllable before a pause — up to 0.3 s (`timeline.py`). A chapter accepted before that — `"lip_raw"` in its staging ([STAGING.md](STAGING.md)).
4d. **Arms, grips, a prop in a hand** (a pose is accepted only after `tools/hands_check.mjs`).
   - **An arm is one visible chain:** the sleeve from the shoulder joint on the shoulder line (not from the chest) to the elbow at the side at the waist, the forearm diagonally in the frame to the hand (at least 0.6 of its length visible), the hand continues it (a bend up to ~25°). Defects: a hand without a visible forearm in mid-frame; a raised arm out of the chest; a "stump" (the forearm towards the viewer); a "wing" (the elbow out of the silhouette). Allowed: the arm leaves the frame with its hand; the whole arm behind a prop or the body. The skeleton sets an arm in the frame (`byPlane`, `unfold` of `lib/character/body.ts`); a gesture enters and leaves in the frame, the forearm turning around the elbow through the side. Machine: `hands_check` "hand without an arm", "wing"; by eye — the sheet `python tools/hands_sheet.py arms`.
   - A prop at the chest is drawn after the other arm. A folder is held by its near edge: the elbow at the waist, the forearm over the folder, the back of the hand on the cover, the thumb behind it.
   - `hold` is the figure's own hands, `[right, left]`: a prop stays in the same hand facing the camera and from behind, and in every shot of the scene.
   - From behind an arm holding something in front is a sleeve bent at an angle with the forearm going behind the back; a prop in a lowered hand is seen at the side by the hand; with a kit point (`reach`) the palm lies on that point.
   - A palm on a wall — the back of the hand towards the viewer; a palm towards the viewer at the head reads as a greeting.
   - While a hero is busy with a hand (presses, writes, dials) or is `focused`, it does not blink.
   - A thumb has a rounded tip and a nail; hands of inserts and first-person hands come from the hand library too, in the perspective of a kit — by similarity (a turn and one scale), not squeezed along an axis.
   - **A door is moved by a gesture** `pull` / `push`: the hand at the kit's `reach` point follows the handle or the leaf, a point beyond reach is let go smoothly; the arm is visible through the whole motion; without a hand — only `by` (a closer) or `who` out of the frame. The prop goes into the hand farther from the leaf, the near free hand moves the leaf, the figure stands at the threshold. Machine: "event without a visible change" (a hand at a leaf).
   - **A phone:** dialling — `tap` (the phone on the palm screen up, the thumb taps); a gesture that carries a prop to a target starts from `hold`; the end of a call — `hangup`. A repeating gesture (`dial`, `tap`, `write`, `count`, `rail`) moves the whole time. A phone at the ear on a medium shot of two — `hold phoneEar` without a gesture. A phone in a hand — `tap` over the whole shot or `stay`, otherwise it hangs at the collarbone; the thumb lifts (`tapLift`), the length of `tap` is (n + 0.5) / 0.64 s; in the phone from the first frame of a long shot — `ramp: 0.001`.
   - A hand of an insert enters from the edge and leaves the same way along its forearm by events (`gesture` — in, `hand.out` — out), it does not appear within a frame. A line drawn by a pen follows the hand (`pen.mark`); the hand of a stamp leaves by `hand.out` after `stamp.press` ends, so the print stays under the stamp.
   - **A neck from the front** is a column from the collar to the head joint, of one width; `headTilt` turns around that joint. Machine: `hands_check` "neck wedge", "neck slanted", "head not over the neck", "neck width"; by eye — `python tools/hands_sheet.py necks`.
   - The gender and the age of a role read on a wide shot by a sign of the clothes or the face (`look.build`, a collar, a print, a lip tone).
   - A prop in a hand is drawn the same as on the floor; a dark bag strap over dark trousers — `look.bagStrap`. A long tool — `hold mop`; knocking with it — `gesture knock`, then `mopRaised` while the figure waits.

## Props

5. **A prop moves only with a cause.**
   - A door and a window are moved by a hand: the door event has `who` with a gesture at the start of the motion, or a named cause — `hand` (the hand is not visible) or `by` (a closer). Machine: "motion without a cause", "prop without a cause".
   - A hand and a prop enter and leave by motion, not by transparency.
6. **A sheet, a sign, a memo** does not slide away, vanish or appear without a reason.
   - No hand — no event: a button does not light up without a press, a badge does not turn over by itself.
   - A window closes by the motion of its sash, not by a change of the drawing.
   - **The motion and the sound of a prop come from one event** ([STAGING.md](STAGING.md)): a kit reads only the progress of the event; no times in kit code and no hand-written sound times; the state of a prop carries from shot to shot of a scene. Machine: "timing in kit code".
   - A motion of a prop is an event (`prop.spin`, `prop.fall`, `prop.roll`, `prop.stop`, `hand.out`), not an exponent of the shot time or a constant; a fallen prop lies on the floor in the next shots of the scene.
   - The props of a place are one state: a kit does not add or remove them by the words of a shot; another preset changes only their tone. Machine: "place prop changed", "prop jump at a cut".
   - A prop follows the story and the time: food only while it is cooked or served; the time on a clock is a state of the staging; a prop in a hand comes from the `cast` of the shot.
   - A story state across a cut — `set` in the first shot where the prop is seen again; the id of `propMark` is the `obj` of the event; a story change between scenes — `set` with `cut`.
   - A story sign of a prop is the same in every view (the same face in 3D and in an insert); a machine made of parts is one model in metres in every view.
7. **Doors.**
   - A door opens and closes continuously, the leaf does not jump: at the start and the end of the motion it matches the closed door. The hinges on one jamb, the handle and the lock on the free edge.
   - Whoever closes a door ends up on the side it makes sense for.
   - An open door at rest is a plane in perspective with the opening, the threshold and what is behind it; the leaf does not hang flat in front of the opening or stand edge-on; the script says "open", not "half open".
   - A sign on a leaf lives in the plane of the leaf and moves with it; the colour of a moving leaf changes smoothly. A hand on the handle of a leaf going away lets it go smoothly (`out` ≥ 0.5 s).
   - Someone standing in a doorway is in the opening, not in front of the leaf; a leaf opening inwards is drawn before the wall around the opening and is seen only in it.
   - A door in any view follows its state (`door:<id>`).
7a. **Numbers and texts on walls** (a floor, a flat) do not change abruptly inside a shot.
8. **Props are not transparent.** What lies flat is drawn before what stands.
   - What lies on a wall is drawn before what hangs on it; standing props after the light on the surfaces; a prop, then a puff, then the near hand.
   - A line width follows the depth of its visible part.
   - A prop moving over a prop made of pieces is drawn after all of them.
   - The drawing at the start of a motion matches the drawing before the event; contents are clipped by their box.
   - A prop is drawn by its depth; "draw last" only for what is surely in front of everything.
   - A figure in a bed or on a sofa — after the furniture, clipped by the blanket or the seat; the far background (the sky, the house opposite) — first.
9. **Every shape is recognisable** at the size it has in the frame; an unclear blot or a deformed shape is a defect. A small far prop that matters for the story reads; a fallen prop is recognised by its proportions and signs, not by its colour.
   - **Crop and view.** A prop at the edge is whole in the frame or out of it; a crop by the frame edge does not turn it into something else; a prop along a corridor is turned to the camera by its plane; a small prop of a wall is recognisable by a sign, or it is removed.
   - **Steam** — two or three ribbons of one wave thinning away; a ribbon is born and goes with zero length and width; no steam without a source in the frame.
   - **Water** — a film slightly darker than the floor with a soft edge, the floor seen through it; the highlights are rare strokes across the look.
   - **Dust** — a flat opaque puff that shrinks away; a trace in dust is one tone without an outline; dust falling from a ceiling is a stream of grains and flakes from the seam, not a chain of circles.
   - **Hair** — a line of even width in one wave, without a loop.
   - **Light** lies only within its surface: a flat step on a wall, a pool on the floor, no halo or wedge in the air; a lamp is a flat disc; in the dark both the props and the figure darken. The shadow of a figure grows from zero as it leaves the plane of the wall.
   - **A reflection:** no text in a mirror; brushed steel gives a dark smear of the hero's colours without a face.
   - A place is given by its scene: a document of another place is its own scene, not a card over the kit of a place.
   - An action that neither the pose library nor the sound library can show — the line changes to an action they can.
   - A renumbering of the shots after the voice-over is a paid re-voicing (the voice cache is named by the shot ids): a new shot after the voice-over goes last in its scene.
9a. **The shot does what its script line says:** who is in the frame, what is in the hands, where they look. If a pose or an action is impossible, the line is changed explicitly, in every language version, and the report says so. Machine: "action without an event".

## Text in the frame

10. **A text is centred in its sign and inside it:** the size by the width and the height of its strip, buttons outside the text. Machine: "text out of its sign".
11. **A number, a digit, a text is whole in the frame** unless cut on purpose. Machine: "text cut by the edge or its box".
   - **At the title bar** no line is cut in half; a close-up of a line is framed by its neighbouring lines; the header of a sheet in an insert is not cut by the edge; a single medium shot — the head below the bar. Machine: "card / text under the title bar".
   - A record goes in its column: not across the column line, not squeezed below a readable size, wrapped into the width of the column.
   - A text on a plane squeezed by the view more than twice, rotated more than 30° or cut by the frame edge or the bar is not drawn (`legible` of the frame journal); on a push-in — by the start and the end of the shot. An intended cut — `data-cut-ok` with a reason. Machine: "text rotated", "text squeezed".
   - A card is not on a head. Machine: "card on a head".
11a. **The place tag and the plates read:** a large font, contrast with the background. The title bar and the counter are right; a crossed-out cell is whole and crossed once.

## Sound

12. **A sound matches what is visible, in time and in meaning.**
   - A one-shot sound lands on its event: a door — at the visible start or end of its motion, a lamp going out — the click then. No sound without an event or before it. Machine: "sound without an event".
   - A step sounds only while walking is seen, by the shoes.
   - A sound at a cut does not fall into the wrong shot. Machine: "sound on a cut".
   - The source of an event sound is in the frame of its shot (checked by the projection of the shot camera, not by the plan of the room); an unseen step — `cue` with `offscreen`. Machine: "sound on a still frame".
   - A manual binding (`cue`) is checked by the frame at that second; a source out of the frame is clear.
13. **The background sound is explained by the place.** No unclear noise; running water only where the viewer knows where it comes from.
   - A place has a default bed that runs without a script line. Machine: "shot without ambience". A copied kit takes the bed of its own place, not of the neighbouring location.
   - The same bed across a cut is one track, different beds crossfade; no dropout at a cut. Machine: "ambience dropout at a cut".
   - Music — inserts of 3–15 s, no more than the channel allows per chapter.
   - The key sound of a shot is heard: its own level and processing if it must sound "behind a door" or "through a phone".
   - The TTS seed is constant and the same line gives the same take: a re-voicing needs a change of the text or the punctuation.
   - Line loudness: within ±2 LU of the target; a phone voice is duller by design. Machine: "line quieter than its neighbours".
13a. **A sound matches its description.** Listen to every sound before using it in a chapter; the number of hits and buzzes is as described.
13b. **No whisper and no delivery tags** unless the script asks for them.

## Review

14. **A chapter is reviewed as a video, not as stills.**
   - **The scheme** ([REVIEW.md](REVIEW.md), `tools/review_pack.py`):
     1. A 4×4 grid — a frame every second over the whole length: motion, jumps, missing parts, framing.
     2. Full resolution — every shot: a static one — the middle frame; with motion or events — the start, after every event (a door, a gesture, an emotion, a card, the title bar) and the end; a push-in — the start and the end. A small detail of a wide shot — a 1:1 crop.
     3. The video is split into 8 parts by shots, the parts are reviewed in parallel by 8 reviewers; the orchestrator only merges their findings into one list.
   - Both layers are needed: a few stills per shot miss motion and desync, the grid misses small drawing.
   - A table of all sounds: the time, the id, the shot and what is seen in the frame at that second; every row is checked.
   - **Colour** is compared with the accepted reference of its preset by the same measurement (`tools/pipeline/color_check.py`); the norm is the median over the shots of a chapter, not one shot. A camera edit of a shot of papers — measure the colour of its frame before the render (`color_stats` on a frame of `sheets.py`).
   - A new machine check catches its earlier finding on the code and the video where it was, and gives no false errors on accepted shots.
   - **The machine checks** in the `check` step everything of the table of [STAGING.md](STAGING.md), "Checks", and the colour against the reference; the poses — `tools/hands_check.mjs`. A check error — the video does not go to the owner. The rest — by eye; manual sound bindings (`cue`) — by the list of the report.
