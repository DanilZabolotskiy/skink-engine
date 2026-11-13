# Parallel episodes

Several episodes can be made at once on one machine: **one Claude Code session = one episode = one git worktree**. The main checkout (branch `main`) is the merge point: nobody works in it, its working tree stays clean, and `main` moves only by a fast-forward from an episode worktree (`land`).

The tools: `tools/episode_ws.py` (the workplace of an episode), `tools/lane.py` (lanes, frozen accepted chapters, guard of the touched chapters, the commit hook), `tools/cpu_queue.py` (one queue of heavy steps per machine), `tools/api_ref.py` (the API reference of a checkout).

## Starting an episode

1. In the main checkout: `git status` — no edits of tracked files.
2. `python tools/episode_ws.py new s01e02` → the worktree `../<repo>-s01e02` on the branch `ep/s01e02` from `main`. The script links the shared folders, writes `docs/API.md` of the episode and its time journal `channels/<channel>/episodes/s01e02/journal.md`, and sets the commit hook (`git config core.hooksPath tools/hooks`).
3. The session of the episode works in the worktree:
   - best — open Claude Code in `../<repo>-s01e02`;
   - if the session runs in another folder — every command is `cd <worktree> && …`, paths are absolute, agents get the worktree as `{ROOT}`;
   - Claude Code keeps its memory per project folder, so a worktree session starts without it: everything it needs is in git (`AGENTS.md`, this file, the skill).
4. Chapters — the skill `chapter-flow` with `{EP}` = `s01e02` (see [AGENTS.md](../AGENTS.md), "Multi-agent chapter production").
5. Before every chapter — `python tools/episode_ws.py sync`: what was accepted and the engine changes come from `main`.

`python tools/episode_ws.py list` — every workplace: the branch, how far behind and ahead of `main`, uncommitted edits.

## Where things are

| What | Where |
|---|---|
| the script and the staging of a chapter | `channels/<channel>/seasons/s01/ep02/chNN/` — `script.md` (and `script.<lang>.md`), `staging.json` |
| the roles of the episode (code) | `channels/<channel>/chapter/roles/s01e02.tsx` → `ROLES` (role → person) |
| the config of the episode | `channels/<channel>/pipeline/parts/s01e02.json`: `"episode": "s01e02"`, `channel` (`locations`, `cast`, `names`, `cast_words`, `action_verbs`, `actions`, `cast_pron`), `voices` (`aliases`), `sfx` (`sounds`) |
| a new kit | `channels/<channel>/chapter/kits/<kit>.tsx` with `export const KIT: KitDef = {id, Kit, cards}` |
| the work folder of a chapter | `channels/<channel>/episodes/s01e02/<lang>/chNN/` — shared by every worktree (a link) |
| accepted chapters | `channels/<channel>/accepted/s01e02.txt` — a file per episode |
| the time journal of the episode | `channels/<channel>/episodes/s01e02/journal.md` |
| the code copy for rendering | `<temp>/<repo>-s01e02-mirror` (`tools/mirror.py`) |
| the CPU queue | `%LOCALAPPDATA%/skink-cpu-queue` (`~/.cache/skink-cpu-queue` elsewhere) — one per machine |

The links of a worktree to the main checkout (junctions on Windows, symlinks elsewhere): `node_modules`, `channels/<channel>/episodes` (voice, the guard references), `channels/<channel>/assets/sound` and `assets/music` (the media libraries). Keys are not copied: `lib/env.py` reads the `.env` of the main checkout.

## A chapter only adds files

- Kits, roles and the config entries of a chapter go into their own files (the table above). The registries find them: `lib/chapter/registry.ts` by folder, `tools/pipeline/common.py` → `Channel` by merging `pipeline/parts/*.json`.
- A chapter does not edit the shared lists: the channel module, `cast.tsx`, `channel.json`, `voices.json`, `sfx.json`.
- `cast_words` and `action_verbs` of a part file with `episode` count only in the chapters of that episode. A key already set by the shared config or by another part file is a pipeline error: shared settings change in the engine lane.
- One role or one kit id in two files is an error in the frame. Two sessions may pick the same name: give a role a mark of its story (`CLERK_S01E02`, not `CLERK`), a kit — its place (`station-kiosk`).

## The engine lane

The engine lane is `lib/`, `tools/`, `remotion/`, the docs, the channel module and the shared files of a channel — and any file that accepted chapters use (for example the kit of an accepted chapter). Such edits go into a separate commit, never together with a chapter.

1. The edit — in the episode worktree.
2. `python tools/lane.py check` — the lane of every changed file, which accepted chapters use it, frozen files.
3. `python tools/lane.py guard` — guard of the touched accepted chapters only (shared code — all of them) and their rebuild (`retime`) — 0. Before handing a chapter in — with `--events`. The result is a stamp.
4. `git add <engine paths> && git commit` — the hook `tools/hooks/pre-commit` passes a commit of one lane whose files match the stamp.
5. The edit reaches `main` with the episode branch — `python tools/episode_ws.py land`. If another episode needs it sooner — `land` right after the commit.
6. Another episode takes it with `sync`.

## An accepted chapter → main

1. Acceptance by the skill. The line of the chapter goes to `accepted/s01e02.txt`.
2. A commit of the chapter lane: `git add <files of the chapter> && git commit`.
3. `python tools/episode_ws.py land --push`:
   - `git merge main` into the episode branch;
   - guard of what came from `main` — the touched accepted chapters, its own ones too;
   - `main` fast-forwards to the branch (`--ff-only`), then `push`;
   - if `main` moved ahead meanwhile — repeat `land`.

## The engine from main into an episode

`python tools/episode_ws.py sync` runs `git merge main` and then guard of what came (`lane.py guard --since <before the merge>`).

A conflict — resolve it in the worktree, `git commit` (the hook does not check a merge commit), then `python tools/lane.py guard --since <before the merge>`.

## Guard

- **The pipeline step** — only the chapters whose frames the uncommitted edit touches. New files of a chapter touch nobody: the step is skipped.
- **The engine lane** — `lane.py guard` before the commit.
- **After sync** — what came from `main`.
- **Before handing a chapter in** — `python tools/lane.py guard --base main --events`: everything the branch changes against `main`. If the core is touched, that is every accepted chapter; if the chapter only added files, guard is not needed.
- The reports — `channels/<channel>/episodes/_lane/<worktree>/guard/`. The pipeline does not write into the folder of an accepted chapter.
- Who uses a file: `python tools/lane.py usage <file>`.

## CPU queue

- Render, precheck, the frame journal of the check step, guard chunks and frame sheets go through `tools/cpu_queue.py`. The queue is shared by every session of the machine, strictly by arrival.
- Capacity — 4 units:

  | Step | Units |
  |---|---|
  | render | 3 |
  | precheck | 2 |
  | stills | 1 |

  Next to a render only one chunk of stills runs.
- A measurement on an 8-core / 16-thread CPU: a render of 1101 frames — 21 s alone, 23 s next to a guard chunk; two renders at once — each 1.6 times longer.
- A wait goes to the run log: `CPU queue: render … waits …, ahead …`.
- `python tools/cpu_queue.py` — who holds a place and who waits.
- A heavy command by hand: `python tools/cpu_queue.py run --kind stills -- node tools/stills.mjs …`.
- Another capacity — `SKINK_CPU_UNITS`; no queue — `SKINK_CPU_QUEUE=off`, only for work alone on the machine.

## Removing a workplace

`python tools/episode_ws.py remove s01e02` — after `land`:

- first the links (`rmdir`), then the worktree, its code copy and its branch;
- a branch not merged into `main` is removed only with `--force`.

## Do not

- Work in the main checkout or leave edits there: it stays clean, `main` changes only through `land`.
- Run two orchestrators in one worktree, or two worktrees of one episode.
- Edit what is frozen: the script and the staging of an accepted chapter, the part and role files of an episode whose chapters are all accepted. The pipeline does not write into the folder of an accepted chapter. An edit — only by the owner's decision: `SKINK_UNFREEZE=1`.
- Mix the engine lane and a chapter in one commit. Bypass the hook: `--no-verify`, `SKINK_LANE=off` — only by the owner's decision.
- Remove a worktree link recursively (`rm -rf`, `Remove-Item -Recurse`): that is the content of the main checkout. Only `rmdir` or `episode_ws.py remove`.
- Copy or print `.env`.
- Push from a worktree past `land`; force-push; rebase a published branch.
- Run heavy steps past the queue. Load the GPU.
