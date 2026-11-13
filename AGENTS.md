# Working with the Skink engine (for LLM agents)

Read this file, then [docs/PIPELINE.md](docs/PIPELINE.md), [docs/STAGING.md](docs/STAGING.md), [docs/SCRIPT_FORMAT.md](docs/SCRIPT_FORMAT.md), [docs/CHANNEL.md](docs/CHANNEL.md), [docs/STYLES.md](docs/STYLES.md) and [docs/PRODUCTION_RULES.md](docs/PRODUCTION_RULES.md). Use the existing modules in `lib/` and the scripts in `tools/` instead of writing new ones.

## Map

| Path | What it is |
|---|---|
| `remotion/` | Remotion entry: `Root.tsx` registers the compositions of every channel listed in `channels.ts` |
| `lib/chapter/` | The chapter composition (`Chapter.tsx` draws `timeline.json`), timeline types, `channel.ts` (the channel module contract), `figure.tsx` (a role in a kit), `room.tsx` (rooms in metres → SVG), `grade.ts` (colour grades), `stub.tsx` |
| `lib/character/` | The character core: `Character.tsx` (head on the neck, journals), `body.ts` (body skeleton: proportions, posture, arm poses and grips), `arm.ts` (arm IK), `hand.ts` (the hand frame), `walk.ts`, `emotions.ts`, `looks.ts`, `style.ts` (the drawing style interface) |
| `lib/styles/` | Drawing-style add-ons: `webtoon/` and `western/` (head, body, hands), registered in `registered.ts` — see [docs/STYLES.md](docs/STYLES.md) |
| `lib/props/` | Props in hands shared by every style (`props.tsx`: folder, phone, cup, pen, box, keys…) |
| `lib/staging/` | Staging layer: `actions.json` (actions, poses, the "line → event" verb dictionary), `stage.ts` (what kits read: `beat`, `propAt`, `eventOf`, `lookK`…), `walk.ts`, `journal.tsx` (frame journal for layout checks) |
| `lib/persp/`, `lib/fx/`, `lib/hud/`, `lib/anim.ts` | Perspective, effects, HUD (title bar with a counter, place tag, episode plate, subtitles, fonts), animation helpers |
| `lib/eleven.py`, `lib/env.py` | ElevenLabs client (TTS, STT, sound effects, music), keys from the environment or `.env` |
| `tools/pipeline/` | The chapter pipeline: `run.py` and its steps `parse`, `voice`, `timeline`, `precheck`, `render`, `audio`, `check` (+ `staging.py`, `stage_check.py`, `color_check.py`, `sheets.py`, `sfx_list.py`) |
| `tools/` | `render.mjs`, `stills.mjs` (frames without a video), `stage_layout.mjs` (frame journal), `hands_check.mjs` (arm pose check), `remotion.mjs` (shared bundle and browser helpers), `mirror.py` (code copy for rendering), `guard.py` (accepted chapters vs their videos), `sheet.py`, `hands_sheet.py`, `color_stats.py`, `grid.py`, `frames.sh` |
| `channels/example/` | A small neutral channel: two kits (`cafe`, `counter`), two roles in both drawing styles, a cast lineup, an 18-second chapter |
| `channels/<id>/episodes/` | Work folders of chapters (not in git): voice, timeline, renders, reports |

## Setup

```
npm ci
pip install -r requirements.txt
cp .env.example .env        # only if paid ElevenLabs calls are allowed; never print the key
```

## Commands

```
# whole chapter without TTS (durations from the text, silent speech)
python tools/pipeline/run.py channels/example/seasons/s01/ep01/ch01/script.md --estimate --no-stt

# the same chapter in another drawing style, in its own work folder
python tools/pipeline/run.py channels/example/seasons/s01/ep01/ch01/script.md --estimate --no-stt --style western --work <folder>

# the edit loop: staging and arm poses on stills from code, no render
python tools/pipeline/run.py <script.md> --estimate --no-stt --steps parse,timeline,precheck --scenes 01,02

# look at frames without a video (mid-shot stills, sheets of 4)
python tools/pipeline/sheets.py <work folder> --scenes 01 [--at 0.3] [--clean]

# single frames of any composition, from the code copy (absolute paths: the command runs in another folder)
cd "$(python tools/mirror.py)" && node tools/stills.mjs example-chapter <out prefix> 40,200 <work folder>/timeline.json
cd "$(python tools/mirror.py)" && node tools/stills.mjs example-lineup <out prefix> 0,1,2      # the cast in both styles

# with TTS (paid, only with the owner's consent): prints the estimate and stops without --go
python tools/pipeline/run.py <script.md>            # estimate only
python tools/pipeline/run.py <script.md> --go       # voices new lines, then runs all steps
```

Work folder of a chapter `channels/<id>/seasons/s01/ep01/ch01/script.md` → `channels/<id>/episodes/s01e01/<lang>/ch01/`, the video `ch01.mp4` in it. With `--work <folder>` the video is `<folder>/chapter.mp4` (or `chNN.mp4` for a folder named `chNN`); the standalone tools (`staging.py verbs`, `stage_check.py`, `color_check.py`, `guard.py`, `sheets.py`) take such a folder too: the channel comes from `timeline.json → channel`.

The code copy is shared by every run on the machine; two runs at once (say, two drawing styles) each need their own: set `SKINK_MIRROR=<folder>` for one of them.

## The loop

1. Edit the script (`script.md`), the staging (`staging.json`) or the code (kit, cast, `lib/`). After a code edit: `npm run typecheck`.
2. `run.py … --steps parse,timeline,precheck --scenes NN` until `precheck: no staging errors`. Read `check/precheck/report.md` (it links the staging report and `arms/report.txt` with arm poses). Use `sheets.py` or `stills.mjs` to look at the frames.
3. Run precheck over the whole chapter (`--steps parse,timeline,precheck`), then the full run: `run.py <script.md> --estimate --no-stt` (or `--go` when voice-over is allowed). The pipeline stops before render if precheck finds errors.
4. Read `check/report.md` and `check/staging/report.md`: checks on the video (jumps, jitter, drift, camera jerk, sound on a still frame, ambience dropouts, quiet lines, speech recognition with `--go` and without `--no-stt`) and the frame sheets `check/sheet_*.jpg`.
5. Fix the cause, not the threshold. If errors survive two full renders, change the approach.

Lines starting with `ENVIRONMENT` are browser or machine failures, not staging errors: repeat the run.

## Rules

- **No paid calls without consent.** TTS runs only with `--go`; sound effects and music (the functions `sfx` and `music` of `lib/eleven.py`, for the `planned` entries of `sfx.json` and `music.json`) only on an explicit request. Without a key use `--estimate --no-stt`. Voiced lines are cached in the work folder and are not paid twice.
- **CPU rendering.** All tools render with `--gl=swangle` from the code copy made by `tools/mirror.py`; the default `--concurrency 4` leaves room for other work on a shared machine.
- **Motion only by events.** A kit has no timing of its own: no shot fractions or seconds in kit code (`stage_check` lints `u - 0.42`, `0.2 * dur`…). Motion and its sound come from one event in `staging.json`; a camera move over the whole shot is marked `// cam: …` (see [docs/STAGING.md](docs/STAGING.md)).
- **The shot does what the script line says.** Every action verb in `ON SCREEN` / `camera` needs an event of the one who acts; otherwise fix the line or add `"verbs_ok"` with a reason.
- **Continuity.** Prop states, looks, gestures and emotions carry across cuts within a scene; a change at a cut needs an event or `"cut": "<why>"`.
- **Text in the frame** stays readable: not under the title bar, not cut by the frame edge, not on a head.
- **Secrets and media** never go into git: `.env`, renders, voice, sounds, music (`.gitignore`).

## Extending

- **New location:** a kit component in `channels/<id>/chapter/kits/`, a line in the channel module `kits`, a location in `pipeline/channel.json` (`kit`, `views`, `ambience`). Kits use `lib/chapter/room.tsx` (rooms in metres), `Figure` for roles and `lib/staging/stage.ts` for events.
- **New role:** an entry in the channel cast (`personFor`: outfit colours, look, height, optionally its own drawing style), the role in `channel.json → cast` (and `names` / `cast_words` to find it in script lines), a voice in `voices.json`.
- **New drawing style:** a folder `lib/styles/<id>/` with a `CharacterStyle` and one line in `lib/styles/registered.ts` — see [docs/STYLES.md](docs/STYLES.md); the core does not change.
- **New emotion:** a line in `lib/character/emotions.ts → EMOTIONS` (and a script word in `tools/pipeline/timeline.py → EMO_WORDS`).
- **New action:** `channel.json → actions` (same format as `lib/staging/actions.json`); the kit reads it with `beat` / `propAt`. New verbs → `channel.json → action_verbs`.
- **New gesture pose:** solved in the skeleton `lib/character/body.ts` (and a hand shape in `lib/character/hand.ts` if it needs one, drawn by every style), listed in `actions.json → poses`; check it with `tools/hands_check.mjs` (runs inside precheck) in every style the channel uses.
- **Shared code changed and accepted chapters exist:** list them in `channels/<id>/accepted.txt`; the `guard` step compares their frames drawn by the current code with their accepted videos.
