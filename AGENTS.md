# Working with the Skink engine (for LLM agents)

Read this file, then [docs/PIPELINE.md](docs/PIPELINE.md), [docs/STAGING.md](docs/STAGING.md), [docs/SCRIPT_FORMAT.md](docs/SCRIPT_FORMAT.md), [docs/CHANNEL.md](docs/CHANNEL.md), [docs/STYLES.md](docs/STYLES.md) and [docs/PRODUCTION_RULES.md](docs/PRODUCTION_RULES.md); for parallel episodes — [docs/PARALLEL.md](docs/PARALLEL.md), for the reviewers of a chapter — [docs/REVIEW.md](docs/REVIEW.md). Use the existing modules in `lib/` and the scripts in `tools/` instead of writing new ones.

## Map

| Path | What it is |
|---|---|
| `remotion/` | Remotion entry: `Root.tsx` registers the compositions of every channel listed in `channels.ts` |
| `lib/chapter/` | The chapter composition (`Chapter.tsx` draws `timeline.json`), timeline types, `channel.ts` (the channel module contract), `registry.ts` (kits and roles found by folder), `figure.tsx` (a role in a kit), `room.tsx` (rooms in metres → SVG), `grade.ts` (colour grades), `stub.tsx` |
| `lib/character/` | The character core: `Character.tsx` (head on the neck, journals), `body.ts` (body skeleton: proportions, posture, arm poses and grips), `arm.ts` (arm IK), `hand.ts` (the hand frame), `walk.ts`, `emotions.ts`, `looks.ts`, `style.ts` (the drawing style interface) |
| `lib/styles/` | Drawing-style add-ons: `webtoon/` and `western/` (head, body, hands), registered in `registered.ts` — see [docs/STYLES.md](docs/STYLES.md) |
| `lib/props/` | Props in hands shared by every style (`props.tsx`: folder, phone, cup, pen, box, keys…) |
| `lib/staging/` | Staging layer: `actions.json` (actions, poses, the "line → event" verb dictionary), `stage.ts` (what kits read: `beat`, `propAt`, `eventOf`, `lookK`…), `walk.ts`, `journal.tsx` (frame journal for layout checks) |
| `lib/persp/`, `lib/fx/`, `lib/hud/`, `lib/anim.ts` | Perspective, effects, HUD (title bar with a counter, place tag, episode plate, subtitles, fonts), animation helpers |
| `lib/eleven.py`, `lib/env.py` | ElevenLabs client (TTS, STT, sound effects, music), keys from the environment or `.env` (in an episode worktree — the `.env` of the main checkout) |
| `tools/pipeline/` | The chapter pipeline: `run.py` and its steps `parse`, `voice`, `timeline`, `precheck`, `render`, `audio`, `check` (+ `staging.py`, `stage_check.py`, `color_check.py`, `sheets.py`, `sfx_list.py`) |
| `tools/` | `render.mjs`, `stills.mjs` (frames without a video), `stage_layout.mjs` (frame journal), `hands_check.mjs` (arm pose check), `remotion.mjs` (shared bundle and browser helpers), `mirror.py` (code copy for rendering), `guard.py` (accepted chapters vs their videos), `sheet.py`, `hands_sheet.py`, `color_stats.py`, `grid.py`, `frames.sh` |
| `tools/` (parallel work) | `episode_ws.py` (the git worktree of an episode: `new`, `sync`, `land`, `remove`), `lane.py` (which accepted chapters an edit touches, frozen files, guard of the touched ones, the commit hook `hooks/pre-commit`), `cpu_queue.py` (one queue of heavy CPU steps per machine) |
| `tools/` (chapter production) | `api_ref.py` (`docs/API.md` — the API of the kits and the staging, generated per checkout), `read_role.py` (the rules of a role in one print), `review_pack.py` (the pack of the chapter reviewers: grids, key frames, sound tables, 1:1 crops) |
| `.claude/` | An example Claude Code setup for multi-agent chapter production: the skill `skills/chapter-flow/` (the orchestrator playbook, stage tasks, reading lists) and the agents `agents/chapter-*.md` |
| `channels/example/` | A small neutral channel: two kits (`cafe`, `counter`), a regular role and an episode role in both drawing styles, the episode part file `pipeline/parts/s01e01.json`, a cast lineup, an 18-second chapter |
| `channels/<id>/episodes/` | Work folders of chapters (not in git): voice, timeline, renders, reports |

## Setup

```
npm ci
pip install -r requirements.txt
git config core.hooksPath tools/hooks   # the lane hook: frozen accepted chapters, guard stamps (docs/PARALLEL.md)
cp .env.example .env        # only if paid ElevenLabs calls are allowed; never print the key
```

The hook matters once a channel has accepted chapters: without it a committed edit of shared code is never guarded, so the `guard` step of the pipeline checks every accepted chapter.

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

The code copy is per checkout (`<temp>/<folder name>-mirror`); two runs of one checkout at once (say, two drawing styles) each need their own: set `SKINK_MIRROR=<folder>` for one of them. Heavy steps of every run on the machine share one CPU queue (`python tools/cpu_queue.py` shows it).

## The loop

1. Edit the script (`script.md`), the staging (`staging.json`) or the code (kit, cast, `lib/`). After a code edit: `npm run typecheck`.
2. `run.py … --steps parse,timeline,precheck --scenes NN` until `precheck: no staging errors`. Read `check/precheck/report.md` (it links the staging report and `arms/report.txt` with arm poses). Use `sheets.py` or `stills.mjs` to look at the frames.
3. Run precheck over the whole chapter (`--steps parse,timeline,precheck`), then the full run: `run.py <script.md> --estimate --no-stt` (or `--go` when voice-over is allowed). The pipeline stops before render if precheck finds errors.
4. Read `check/report.md` and `check/staging/report.md`: checks on the video (jumps, jitter, drift, camera jerk, sound on a still frame, ambience dropouts, quiet lines, speech recognition with `--go` and without `--no-stt`) and the frame sheets `check/sheet_*.jpg`.
5. Fix the cause, not the threshold. If errors survive two full renders, change the approach.

Lines starting with `ENVIRONMENT` are browser or machine failures, not staging errors: repeat the run. Lines `CPU queue: … waits` mean that another run holds the CPU: wait.

## Rules

- **No paid calls without consent.** TTS runs only with `--go`; sound effects and music (the functions `sfx` and `music` of `lib/eleven.py`, for the `planned` entries of `sfx.json` and `music.json`) only on an explicit request. Without a key use `--estimate --no-stt`. Voiced lines are cached in the work folder and are not paid twice.
- **CPU rendering.** All tools render with `--gl=swangle` from the code copy made by `tools/mirror.py`; the default `--concurrency 4` leaves room for other work on a shared machine.
- **Motion only by events.** A kit has no timing of its own: no shot fractions or seconds in kit code (`stage_check` lints `u - 0.42`, `0.2 * dur`…). Motion and its sound come from one event in `staging.json`; a camera move over the whole shot is marked `// cam: …` (see [docs/STAGING.md](docs/STAGING.md)).
- **The shot does what the script line says.** Every action verb in `ON SCREEN` / `camera` needs an event of the one who acts; otherwise fix the line or add `"verbs_ok"` with a reason.
- **Continuity.** Prop states, looks, gestures and emotions carry across cuts within a scene; a change at a cut needs an event or `"cut": "<why>"`.
- **Text in the frame** stays readable: not under the title bar, not cut by the frame edge, not on a head.
- **Secrets and media** never go into git: `.env`, renders, voice, sounds, music (`.gitignore`).

## Extending

- **New location:** a kit file `channels/<id>/chapter/kits/<kit>.tsx` with `export const KIT: KitDef = {id, Kit, cards}` (found by folder, the channel module does not change), a location in `pipeline/channel.json` or in the episode file `pipeline/parts/<episode>.json` (`kit`, `views`, `ambience`). Kits use `lib/chapter/room.tsx` (rooms in metres), `Figure` for roles and `lib/staging/stage.ts` for events.
- **New role:** a regular — an entry in `chapter/cast.tsx`; a role of an episode — in `chapter/roles/<episode>.tsx` (`ROLES`): outfit colours, look, height, optionally its own drawing style. The role in `channel.json` or in the episode part file → `cast` (and `names` / `cast_words` to find it in script lines), a voice in `voices.json` (or an alias of an existing voice in the part file).
- **New drawing style:** a folder `lib/styles/<id>/` with a `CharacterStyle` and one line in `lib/styles/registered.ts` — see [docs/STYLES.md](docs/STYLES.md); the core does not change.
- **New emotion:** a line in `lib/character/emotions.ts → EMOTIONS` (and a script word in `tools/pipeline/timeline.py → EMO_WORDS`).
- **New action:** `channel.json → actions` (same format as `lib/staging/actions.json`); the kit reads it with `beat` / `propAt`. New verbs → `channel.json → action_verbs`.
- **New gesture pose:** solved in the skeleton `lib/character/body.ts` (and a hand shape in `lib/character/hand.ts` if it needs one, drawn by every style), listed in `actions.json → poses`; check it with `tools/hands_check.mjs` (runs inside precheck) in every style the channel uses.
- **Shared code changed and accepted chapters exist:** list them in `channels/<id>/accepted/<episode>.txt`; `python tools/lane.py check` shows which of them an edit touches, `python tools/lane.py guard` compares their frames drawn by the current code with their accepted videos (the `guard` step of the pipeline does the same for the uncommitted edit).

## Parallel episodes

Several episodes at once on one machine — one Claude Code session per episode, each in its own git worktree made by `python tools/episode_ws.py new s01e02`. A chapter only adds files (its script, its staging, kits, the episode files `chapter/roles/<episode>.tsx` and `pipeline/parts/<episode>.json`); shared edits go into separate "engine lane" commits checked by `tools/lane.py`; accepted chapters are frozen; the renders and the checks of every session share one CPU queue. The whole procedure: [docs/PARALLEL.md](docs/PARALLEL.md).

## Multi-agent chapter production

A long chapter is cheaper and steadier when the main session only orchestrates and every stage is a fresh agent with a narrow task. The example setup is in `.claude/` (copy or adapt it; it holds no channel specifics):

- **The skill** `.claude/skills/chapter-flow/SKILL.md` — the playbook of the orchestrator: stage A (script and voice-over) → B (kits, staging, precheck 0) → render → C (the video check) → 8 reviewers in parallel → a summary → one fix round by themes → the final render → C' (every fix checked by a crop "before | after") → acceptance and commits by lanes. Render budgets, a time journal, the conditions between the stages.
- **The stage tasks** `briefs/*.md` — templates with fields (`{ROOT}`, `{EP}`, `{SRC}`, `{CH}`…) the orchestrator fills in; never earlier chapters as samples.
- **Rules by role:** `reading.md` lists what each role reads; `python tools/read_role.py <role>` prints exactly those sections and rules, `--check` finds lists broken by an edit of the docs.
- **The agents** `.claude/agents/chapter-*.md` — script, stage, check, review, fix; no MCP servers or skills, no subagents, no commits, no renders (the orchestrator renders and waits for the notification).
- **The reviewers' pack** — `python tools/review_pack.py <work folder> --parts 8`: per part a 4×4 grid at one frame per second, key frames of every shot, a frame at every sound, the bed around the cuts and the loudness of every line; `crop` makes 1:1 crops. Reviewers read only [docs/REVIEW.md](docs/REVIEW.md) and write a table of findings with crops.
- **The API reference** — `python tools/api_ref.py` writes `docs/API.md` (kits with their views, events, states and look targets; actions, poses and verbs; roles, looks and emotions; the merged channel config; sounds; the exports of the shared modules) with line numbers in its contents, so agents read sections instead of sources.
