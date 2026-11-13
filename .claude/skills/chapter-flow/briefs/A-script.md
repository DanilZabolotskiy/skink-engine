Stage A — the script and the voice-over of chapter {NN} ({STORY}). The worktree of episode {EP}: `{ROOT}` — every command runs in it (`cd {ROOT} && …`), paths are relative to it.

- The script: `{SRC}/script.md` (and `{SRC}/script.<lang>.md` if the channel speaks another language than the draft). The work folder: `{CH}`.
- The rules of the role: `python tools/read_role.py A`.
- The season plan — only these parts: {PLAN}. Do not take earlier chapters as samples.
- Places and views: `docs/API.md` — the contents, the sections of the kits you will use (§1) and "shot line → event" (§4).

Do:
1. The script of the chapter by the plan and `docs/SCRIPT_FORMAT.md`. Camera and ON SCREEN — in words the kits understand. The verbs of the lines — such that stage B can stage them as events.
2. The translation of the same structure, if the channel needs one.
3. The voice-over — only the lines of this chapter: `python tools/pipeline/run.py {SRC}/script.md --steps parse,voice,timeline --go` (only if the owner allows paid voice-over for chapters; otherwise `--estimate`).
4. New places, roles and kits that `docs/API.md` does not have — a list in the note for stage B (B makes their files: `chapter/roles/{EP}.tsx`, `pipeline/parts/{EP}.json`, `chapter/kits/<kit>.tsx`).

{EXTRA}

The end: the note `{CH}/check/notes/A.md` (the template — in the output of `read_role.py`) and a report of up to 10 lines.
