# Production rules

Rules for staging, animation and sound of any shot. The code and the checks refer to them by number ("production rule 12"). Most of them are enforced by the machine checks ([STAGING.md](STAGING.md), "Checks"); the rest are checked by eye on the finished video — every second, with sound.

## Camera and editing

1. **A change of shot and framing is motivated.** The camera does not jump without a reason or too often. Two shots in a row on the same part of a document with different framing — a defect; prefer a smooth camera move. A push-in or a ride over paper runs over the whole shot from the framing of the previous shot; the frame edge moves no faster than ~40 px per frame. What is below the title bar at the start and the end of a move stays below it in the middle. Shots of a scene stay on one side of the line between two characters. In the same static view a figure does not change side or the prop in its hands at a cut. A "hard switch" in the script is a cut without a dip. The main subject of a wide shot is not small in a corner; two figures are not stacked one behind the other.
2. **A static shot is static.** Frame or figure shake only by the story (a hit, a fright). A character at rest does not tremble; breathing in a close-up moves the head by a few pixels at most; papers do not drift. A figure moves by sub-pixels together with the background.

## Characters and motion

3. **Parts of a figure do not vanish or appear abruptly:** ears, hair, hands, a sweat drop; the mouth and the nose change smoothly through full face.
4. **Steps.** The step phase is the travelled path: no walking on the spot; at least two steps per segment; the pace is within the range of `walk` / `slow` / `run`.
   - 4a. **No instant jumps.** A figure does not change its place within one frame.
   - 4b. **A character does not vanish from a shot without a reason.**
   - 4c. **The mouth opens by the syllables of the line** of the one who speaks in the frame.
   - 4d. **Arms, grips, a prop in a hand:** constant arm lengths, a natural elbow and wrist, the thumb on the right side, the hand continues the forearm; a pose is accepted only after `tools/hands_check.mjs`.

## Props

5. **A prop moves only with a cause** — a hand of a figure (a gesture) or a stated cause (`"by"`, `"hand"`).
6. **A sheet, a sign, a memo** does not slide away, vanish or appear without a reason; its state carries across cuts.
7. **Doors** open by a hand or a stated cause; a door state carries across cuts. Text on a plane seen at a steep angle is not drawn.
   - 7a. **Numbers and texts on walls** do not change abruptly inside a shot.
8. **Props are not transparent.**
9. **Every shape is recognisable** at the size it has in the frame; a crop by the frame edge does not turn a prop into something else.
   - 9a. **The shot does what its script line says.** If a pose or an action is impossible, the line is changed explicitly in every language version.

## Text in the frame

10. **A text is centred in its sign and inside it.**
11. **A number, a digit, a text is fully in the frame** unless cut on purpose; not under the title bar, not on a head; a card does not cover a face.
   - 11a. **The place tag and the plates are readable:** a large font, contrast with the background.

## Sound

12. **A sound matches what is visible in time and in meaning.** A one-shot sound lands on its event (the door closes — the click), not on a guess; a step sounds only while the figure is visible; a phone voice sounds through a phone band.
13. **The background sound is explained by the place.** Every shot has an ambience bed of its place (or silence by design); the same bed is not interrupted at a cut, different beds crossfade.
   - 13a. **A sound matches its description.** Listen to every sound before using it in a chapter.
   - 13b. **Delivery tags only when the script asks for them.**

## Review

14. **A chapter is reviewed as a video, not as stills:** every second with sound, plus every shot at full resolution at its events. The machine reports (`check/precheck/report.md`, `check/report.md`) come first; the eye checks what they cannot see.
