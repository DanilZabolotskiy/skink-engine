# Reading lists by role — the chapter agents

An agent gets its list with `python tools/read_role.py <code>`: first the section "All", then the section of its role. The line format is described in the header of `tools/read_role.py`. After an edit of the rules or the docs run `python tools/read_role.py --check`: it finds missing sections and items, exit code 1.

Add the channel's own rules (its style, its colours, its season plan) as lines of the roles that need them, for example `- `channels/<channel>/rules.md` § Sound`.

## All — common to the chapter agents

**Common rules of the chapter agents**

- The project is 2D video drawn by code in Remotion (the Skink engine). The pipeline — `tools/pipeline/run.py`.
- What matters most is the task of the orchestrator. The notes of earlier stages are in `CH/check/notes/*.md`.
- Work in the worktree of the episode `{ROOT}` of the task (`docs/PARALLEL.md`): every command is `cd {ROOT} && …`, paths are relative to it.
  - A chapter only adds files: the script and the staging, the episode files `chapter/roles/<episode>.tsx` and `pipeline/parts/<episode>.json`, a new kit `chapter/kits/<kit>.tsx`. The shared lists (the channel module, `cast.tsx`, `channel.json`, `voices.json`, `sfx.json`) are not edited.
  - An edit of the engine lane (`lib/`, the channel module, files of accepted chapters) — `python tools/lane.py check`, then `python tools/lane.py guard`: 0.
  - The state of the chapter is in files. Read the notes and continue the work, do not redo it.
- The API of the kits, the staging and the characters — `docs/API.md`.
  - Read its contents first: the first ~30 lines.
  - Then read only the sections you need: Read with offset and limit by the line numbers.
  - Read the source of a kit only if you edit or copy it.
  - If you need a file in pieces more than twice, read it once whole.
- **Do not:**
  - print or copy keys (`.env`);
  - generate sounds — only on the owner's request;
  - voice anything but the lines of this chapter;
  - render the chapter (a `run.py … --go` without `--steps`, or the render step) — the orchestrator does it;
  - load the GPU;
  - start subagents;
  - commit;
  - change accepted chapters: guard must stay 0; the script, the staging and the episode files of an accepted chapter are frozen;
  - run heavy steps in parallel: one precheck, ffmpeg or stills at a time; stills by hand — through the CPU queue: `python tools/cpu_queue.py run -- node tools/stills.mjs …`.
- **Precheck before render.**
  1. The edit.
  2. `python tools/pipeline/run.py <script.md> --steps parse,timeline,precheck --scenes NN,MM` — repeat until 0 errors.
  3. At the end of the stage — the same for the whole chapter, without `--scenes`.
  - A line "ENVIRONMENT" is a browser failure, not a staging error: repeat the run.
- **Do not wait idle.** A run longer than 4 minutes — in the background, do the next work meanwhile. Read logs by their last lines.
- **Pictures.**
  - Look at 2–4 pictures per request, several Read calls in one answer.
  - An overview — by sheets: `tools/pipeline/sheets.py`, frames up to 1280 px.
  - A detail — a 1:1 crop: `python tools/review_pack.py crop <frame> x,y,w,h -o <crop>.png`.
  - Do not open a full-size frame whole without a need.
- **A newly found defect** becomes a rule in the right item of `docs/PRODUCTION_RULES.md` (or of the channel's rules), one or two lines. Say so in the note.
- **Context.** If it grows beyond ~300k tokens, stop at a clean point, write a "continuation" note and report.
- **The end of the stage:**
  - a note `CH/check/notes/<stage>.md` — up to 60 lines, by the template below;
  - a report to the orchestrator — up to 10 lines: done or not; the check numbers (precheck, guard, errors); the path to the note; what the orchestrator has to decide.

The note template:

```
# <stage> · chapter NN · <date time>
## Done
## Decisions and why
## Left and known problems
## Where things are — files, reports, sheets
## Checks — precheck: N errors (chapter / scenes); guard: N; renders: N
## New rules — if any
```

## A — script and voice-over

- `docs/SCRIPT_FORMAT.md`
- `docs/PIPELINE.md` § Commands; Script: what the pipeline understands; Sound
- `docs/STAGING.md` § Rules of the layer
- `docs/PRODUCTION_RULES.md` rules 1, 9a, 12, 13, 13b — a change of shot, a line is an event, sound

## B — kits, staging, precheck

- `docs/STAGING.md` § Rules of the layer; Format; What the pipeline does; In a kit
- `docs/PIPELINE.md` § Commands; Edit loop; Channel config; Render
- `docs/CHANNEL.md` § A kit; A role
- `docs/PARALLEL.md` § Where things are; A chapter only adds files
- `docs/PRODUCTION_RULES.md` rules 1–11 — camera, motion, arms, props, text

## C — video check (C and C')

- `docs/PIPELINE.md` § Edit loop; Checks; Accepted chapters guard
- `docs/STAGING.md` § Checks
- `docs/REVIEW.md` § Pictures — sparingly; Checklist
- `docs/PRODUCTION_RULES.md` rules 14 — the review scheme, the machine checks

## R — reviewer (no common)

- `docs/REVIEW.md`

## F — fix round

- `docs/STAGING.md` § Rules of the layer; Format
- `docs/PIPELINE.md` § Edit loop; Accepted chapters guard

The rules named in the findings of the theme — read them with `python tools/read_role.py --sec docs/PRODUCTION_RULES.md "rules …"`. The task lists them.
