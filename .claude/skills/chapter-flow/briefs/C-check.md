Stage {MODE} — the video check of chapter {NN} ({STORY}). The worktree of episode {EP}: `{ROOT}` — every command runs in it (`cd {ROOT} && …`), paths are relative to it.

- The video: `{CH}/ch{NN}.mp4` (render {RENDER} of the budget of 2). The script: `{SRC}/script.md`. The work folder: `{CH}`.
- Input: the notes `{CH}/check/notes/` — {NOTES}.
- The rules of the role: `python tools/read_role.py C`. The frame checklist — `docs/REVIEW.md`.

Do:
1. The machine:
   - `{CH}/check/staging/report.md` — 0 errors; manual sound bindings (`cue`) — check by the frame;
   - `{CH}/check/report.md` — speech, lengths, colour;
   - `{CH}/check/arms/report.txt` — 0 violations;
   - `{CH}/check/guard/*/report.md` — 0.
2. The eye: the shot sheets (`python tools/review_pack.py {CH} --out {CH}/check/c_pack` — grids at 1 frame per second and key frames), 1:1 crops by the checklist. Pictures — 2–4 per request.
3. Small things — fix them yourself and confirm by precheck by scenes. Do not start the render.

Mode C' (after the fix round):
- every "fixed" of `{CH}/check/notes/fix-*.md` — a crop "before | after": before — `{CH}/check/review/pack/partN/full/`, after — the new video;
- not fixed — into the list for the owner.

{EXTRA}

The end: the note `{CH}/check/notes/{NOTE}.md`. Its last line is the result: "to the reviewers" (C) / "to acceptance" (C') or "a render is needed: scenes …". A report of up to 10 lines.
