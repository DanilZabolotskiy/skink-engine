Stage B — the kits, the staging and the precheck of chapter {NN} ({STORY}). The worktree of episode {EP}: `{ROOT}` — every command runs in it (`cd {ROOT} && …`), paths are relative to it.

- The script: `{SRC}/script.md` (voiced). The staging: `{SRC}/staging.json`. The work folder: `{CH}`.
- Input: the note `{CH}/check/notes/A.md`. From stage A: {FROM_A}
- The rules of the role: `python tools/read_role.py B`. The API: `docs/API.md` — the contents and the sections of the kits of the chapter: {KITS}.

Do:
1. The kits and the roles that do not exist yet (by the note of A) — as new files, the shared lists are not edited (`docs/PARALLEL.md`, "Where things are"):
   - a new kit — a copy of the nearest one: `chapter/kits/<kit>.tsx` with `KIT`;
   - the roles of the episode — `chapter/roles/{EP}.tsx` → `ROLES`;
   - places, roles, role words, verbs, voice aliases — `pipeline/parts/{EP}.json` with `"episode": "{EP}"`.
2. `staging.json`: every line of a shot — an event; sound — from the events; cards — not on a head.
3. Precheck by scenes until 0, then over the whole chapter: `python tools/pipeline/run.py {SRC}/script.md --steps parse,timeline,precheck`. A look at the frames — `python tools/pipeline/sheets.py {CH} --scenes …`.
4. If you touched the engine lane (`python tools/lane.py check`: a file of accepted chapters, `lib/`, the channel module) — `python tools/lane.py guard`: 0 differences. A chapter only adds files (`docs/PARALLEL.md`).
5. Do not start the render.

{EXTRA}

The end: the note `{CH}/check/notes/B.md` (with "precheck of the chapter 0" and the known leftovers) and a report of up to 10 lines.
