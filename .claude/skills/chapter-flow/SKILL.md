---
name: chapter-flow
description: Orchestrator playbook of the Skink engine — produce one chapter of an episode in stages with fresh agents (script → staging → render → video check → 8 reviewers → one round of fixes → final render → acceptance), in the worktree of its episode (docs/PARALLEL.md). Use when the main session makes or continues a chapter ("make chapter 3", "start episode 2", "continue the chapter", "the fix round of the chapter").
argument-hint: "[episode and chapter, for example s01e02 01]"
---

# A chapter in stages

The goal — a chapter of the same quality for about half the tokens of one long session.

How the tokens are saved:
- **A fresh agent for every stage.** The stages hand the work over by a short note `CH/check/notes/<stage>.md`; the state of the chapter lives in files.
- **The orchestrator waits for renders and long runs.** Its prompt cache lives longer than an agent's: an agent finishes its stage before the render.
- **Agents read only their own part.** Rules — `python tools/read_role.py <role>`, the API — the contents of `docs/API.md`.

## Notation

| | |
|---|---|
| `EP` | the episode: `s01e02` (season `s01`, episode folder `ep02`) |
| `ROOT` | the worktree of the episode (`python tools/episode_ws.py new {EP}` → `../<repo>-{EP}`); every command runs in it |
| `NN` | the chapter number: `01` |
| `LANG` | the language of the voice-over (`channel.json → language`) |
| `SRC` | the script folder: `channels/<channel>/seasons/s01/ep02/chNN` (`script.md`, `script.<lang>.md` if translated, `staging.json`) |
| `CH` | the work folder, not in git: `channels/<channel>/episodes/{EP}/{LANG}/chNN` (shared by every worktree — a link to the main checkout) |
| `STORY` | what the chapter is about — its line of the season plan (the channel's own plan document) |
| notes | `CH/check/notes/`: `A.md`, `B.md`, `C.md`, `fix-<theme>.md`, `C2.md`, the journal `journal.md`; the episode journal — `channels/<channel>/episodes/{EP}/journal.md` |
| task fields | shared `{ROOT}`, `{EP}`, `{NN}`, `{SRC}`, `{CH}`, `{STORY}`, `{EXTRA}` (2–5 lines beyond the notes, or empty); A — `{PLAN}` (the parts of the season plan to read); B — `{FROM_A}`, `{KITS}`; C — `{MODE}` (C / C'), `{RENDER}`, `{NOTES}`, `{NOTE}` (C / C2); review — `{N}`, `{SHOTS}`, `{T0}`, `{T1}`, `{KNOWN}`; fix — `{THEME}`, `{SLUG}`, `{ITEMS}`, `{FILES}`, `{OTHERS}`, `{PREV_FIX}`, `{FINDINGS}`, `{FULL_PRECHECK}` (the last agent of the round: "Then precheck of the whole chapter — 0.") |
| tasks | `briefs/*.md` next to this file. Fill in the fields and give the agent the text. Do not give earlier chapters as samples — only the rules and the docs |

## Stages

| # | Stage | Who (`subagent_type`) | Input | Output |
|---|---|---|---|---|
| 0 | preparation | orchestrator | the plan, `main` | `sync`, `CH/check/notes/journal.md`, a fresh `docs/API.md` |
| A | script and voice-over | `chapter-script` | `briefs/A-script.md` | `SRC/script.md` (and its translation), `CH/voice/`, `A.md` |
| B | kits, staging, precheck | `chapter-stage` | `briefs/B-stage.md`, `A.md` | kits, `SRC/staging.json`, precheck of the chapter 0, `B.md` |
| R1 | render | orchestrator | precheck 0 | `CH/chNN.mp4`, the check and guard reports |
| C | video check | `chapter-check` | `briefs/C-check.md`, `B.md` | `C.md`: "to the reviewers" or "a render is needed" |
| R2 | another render (if needed) | orchestrator | `C.md` | a new video |
| P | 8 reviewers | `chapter-review` ×8 | `review_pack.py`, `briefs/review.md` | `CH/check/review/partN.md` |
| S | summary | orchestrator | 8 tables | `CH/check/review/SUMMARY.md` and the fix themes |
| F | fix round | `chapter-fix` ×2–3 | `briefs/fix.md`, a theme of the summary | edits, precheck 0, `fix-<theme>.md` |
| R3 | final render | orchestrator | precheck of the chapter 0 | the video |
| C' | check of the fixes | `chapter-check` | `briefs/C-check.md`, mode C' | `C2.md` |
| ✓ | acceptance | orchestrator | `C2.md` | `accepted/{EP}.txt`, commits, `land --push`, a report to the owner |

Do not start the next stage before the conditions of the previous one are met (below). Start every agent fresh: a new Agent call, not a message to an old one. The exception — an agent returned a "continuation" note.

### 0. Preparation
1. The worktree of the episode — `ROOT` ("Parallel episodes" below). None yet — `python tools/episode_ws.py new {EP}` from the main checkout.
2. `python tools/episode_ws.py sync` — what was accepted and the engine changes from `main`; guard of what came — 0.
3. `python tools/api_ref.py --check || python tools/api_ref.py` — the API reference by the current code (`docs/API.md` is not in git, every worktree has its own).
4. `python tools/read_role.py --check` — the reading lists find their sections. Exit code 1 — fix `reading.md`.
5. Create `CH/check/notes/journal.md` (the format — "Journal" below).
6. Find the line of the chapter in the season plan: the story, the places, the cast.

### A → B
- **Condition:** `A.md` says "done"; the script parses without errors; only the lines of this chapter are voiced.
- Decisions of A that matter for the staging (new places, roles) go into the task of B as `{FROM_A}` — 2–5 lines.

### B → render
- **Condition:** `CH/check/precheck/report.md` — 0 errors over the whole chapter (`grep -m3 -i "error" CH/check/precheck/report.md`); the note of B says "precheck of the chapter 0".

### Render — only the orchestrator
- Start it with Bash and `run_in_background: true`:
  ```
  cd ROOT && python tools/pipeline/run.py SRC/script.md --go > CH/check/run<k>.log 2>&1
  ```
- The render waits for its turn in the CPU queue of the machine (`tools/cpu_queue.py`): a line "CPU queue: … waits" in the log is not a failure.
- Then end the turn and **wait for the notification**. Do not poll.
- `--go` runs precheck, render, audio, assemble, check and guard. Unchanged scenes come from the cache. Guard — only the accepted chapters whose frames the uncommitted edit touches (`CH/check/guard/report.md` — who was checked); new files of a chapter touch nobody.
  - Precheck not 0 — the run stops before the render. That is an error of the stage: give it back (B, C or F) to a new agent with the note.
- The result: `tail -15 CH/check/run<k>.log` and the error counts in `CH/check/staging/report.md`, `CH/check/report.md`, `CH/check/guard/*/report.md`.
- **Budget:** before the reviewers — 2 full renders (R1, R2); in the fix round — 2 (R3 and one spare). If errors remain after the budget, change the approach (a pose, an event, a shot), not the thresholds; the decision goes into the task of the next agent.
- Count the renders in the journal.

### C → the reviewers
- C goes through the video: the machine reports, the arms, guard, the frames. Small things it fixes itself, through precheck.
- `C.md` ends with one of:
  - **"to the reviewers"** — go on to the reviewers;
  - **"a render is needed: scenes …"** — make R2 and check its reports yourself (grep the errors). Do not start C again unless C asked to look at the frames after the render.

### The reviewers
1. Build the pack: `python tools/review_pack.py CH --parts 8` — output `CH/check/review/pack/`; the parts and their times — in `pack/pack.md`.
2. Fill `briefs/review.md` for every part: `{N}`, `{SHOTS}`, `{T0}`, `{T1}`, `{KNOWN}` (the known leftovers of the notes of B and C, the same for every part).
3. Start 8 `chapter-review` agents **in one message**: 8 Agent calls.
4. Wait for 8 notifications. The answers hold only paths and finding counts.

### Summary — the orchestrator
1. Read only the tables, not the files whole: `grep -h "^| [0-9]" CH/check/review/part*.md`.
2. Write `CH/check/review/SUMMARY.md`: the totals by severity; **themes** — one cause, one row with the list of shots and the crop paths; defects first.
3. Mark what is not fixed in this round and why. That goes to the owner.
4. Themes of the fixes — 2–3 agents. Usually: **staging and camera** (`staging.json`, kits, views, gaze); **characters and arms** (`lib/character/*`, roles, poses); **text, sound, script** (`script*.md`, TEXT, sfx of `staging.json`, voices).
5. For every theme list the files it will touch.
   - The files of the themes **do not overlap** — the agents can run in parallel (one message). The full precheck of the chapter is then made by the last agent or by you before R3.
   - They **overlap** — the agents run one after another; the next one gets the note of the previous one.
   - The engine lane (`lib/`, the channel module, the kits of accepted chapters — `python tools/lane.py usage <file>`) is edited by one theme at a time: `lane.py guard`.

### Fix round → final render
- **Condition of R3:** every `fix-*.md` says "done"; precheck of the whole chapter 0; guard 0 after engine-lane edits (`python tools/lane.py guard` — only the touched accepted chapters; the agent of the theme runs it).
- R3 and its reports — as in "Render".

### C' — check of the fixes
- `chapter-check` with the mode C' in the task.
- Every "fixed" of `fix-*.md` is checked by a crop "before | after": before — the frames of the pack `CH/check/review/pack/partN/full/`, after — the new video.
- The machine reports 0. Small things — through precheck. Another render — only within the budget.

### Acceptance — the orchestrator
1. **Before handing in:** `python tools/lane.py guard --base main --events` — in the background, wait for the notification; the result — 0 differences. Only the accepted chapters the episode branch touches against `main` are checked: a chapter that only added files needs no guard; a touched core — all of them. A difference is a regression: give it back to a theme of F, or show the owner the pair "accepted | new".
2. Check the machine reports: `CH/check/staging/report.md` — 0 errors; `CH/check/report.md` — no errors; no background processes.
3. The line `episodes/{EP}/{LANG}/chNN` for `channels/<channel>/accepted/{EP}.txt` (no file — create it: a `#` line and the chapter lines) — **after the chapter commit** (step 5): a chapter on the accepted list is frozen, and `lane.py` would put its own files into the engine lane.
4. Refresh `docs/API.md` (`python tools/api_ref.py`) if the code changed. It is not in git.
5. **Commits by lanes** (docs/PARALLEL.md):
   - `python tools/lane.py check` — the lane of every file. Do not take edits of others.
   - The engine lane, if any — a separate commit after `lane.py guard` (the hook checks the stamp).
   - The chapter — a commit of the chapter lane: the script, the staging, the episode files, a new kit (without `accepted/{EP}.txt`).
   - Then the line of the chapter in `accepted/{EP}.txt` — a separate commit (lane `any`).
   - `python tools/episode_ws.py land --push` — `main` fast-forwards to the episode branch, then push (only if the owner wants pushes).
6. The journal — close the line of the chapter and add the result to the episode journal.
7. **To the owner — briefly:** the path to `CH/chNN.mp4`; the time of the stages and the number of renders; what is not fixed (from SUMMARY and the notes of C').

## Journal — `CH/check/notes/journal.md` and the episode journal

```
# Chapter NN · <story> — journal
| stage | agent | start | end | min | result |
|---|---|---|---|---|---|
| A | chapter-script | 21:05 | 21:40 | 35 | done, 61 lines |
| R1 | orchestrator | 22:40 | 23:02 | 22 | render 1, check 0, guard 0 |
Renders: before the reviewers 1/2, in the fix round 0/2.
```

The episode journal `channels/<channel>/episodes/{EP}/journal.md` — a row per chapter: `| 01 | <story> | 21:05 | 03:40 | 6.6 | 3 | accepted, commit abc1234 |`.

## Parallel episodes

- **One session = one episode = one worktree** (docs/PARALLEL.md). Two episodes at once — two sessions, each in its own `ROOT`.
- The main checkout is only the merge point (`main`). Nobody works in it.
- Everything the session does — commands, agents, commits — happens in `ROOT`. A session opened in another folder runs every command as `cd ROOT && …` and gives agents `{ROOT}`.
- A chapter only adds files: the script and the staging; the episode files `chapter/roles/{EP}.tsx` and `pipeline/parts/{EP}.json`; a new kit `chapter/kits/<kit>.tsx` with `KIT`. Shared lists are not edited.
- The engine lane — a separate commit after `lane.py guard`. Into `main` — by `land`, into another episode — by its `sync`.
- Render, precheck and guard go through the shared CPU queue (`tools/cpu_queue.py`); a wait is in the run log.
- Accepted chapters are frozen: their script, their episode files once the episode is complete, their work folder. An edit — only by the owner's decision.

## Rules of the orchestrator
- You do not edit the chapter and do not analyse pictures yourself. The exception — a doubt in a note; then 1–2 crops.
- You read the notes, the agents' reports and the tails of logs. Large files — grep.
- A task to an agent — the filled template plus 2–5 lines that are not in the notes. Do not copy rules into a task: the agent reads them itself with `read_role.py`.
- The project rules hold: precheck before render; guard 0 (by the touched chapters — `tools/lane.py`); paid voice-over and sound generation only as the owner allows (the voice-over of the lines of this chapter at stage A — if the owner said so once for chapters); the render on the CPU; keys are never printed.
- The chapter agents run without MCP servers and skills (`disallowedTools` in `.claude/agents/chapter-*.md`).

## Files
- `briefs/A-script.md`, `briefs/B-stage.md`, `briefs/C-check.md` (C and C'), `briefs/review.md`, `briefs/fix.md` — the tasks of the stages.
- `reading.md` — the reading lists of the roles for `tools/read_role.py`.
- Tools: `tools/episode_ws.py` (the workplace of an episode: `new`, `sync`, `land`, `remove`); `tools/lane.py` (lanes, frozen chapters, guard of the touched ones, the commit hook); `tools/cpu_queue.py` (the CPU queue of the machine); `tools/review_pack.py` (the reviewers' pack); `tools/api_ref.py` (`docs/API.md`); `tools/read_role.py` (rules by role); `docs/REVIEW.md` (the reviewer memo).
