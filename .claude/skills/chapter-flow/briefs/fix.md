The fix round of chapter {NN} ({STORY}), the theme "{THEME}". The worktree of episode {EP}: `{ROOT}` — every command runs in it (`cd {ROOT} && …`), paths are relative to it.

- The script: `{SRC}/script.md`, `{SRC}/staging.json`. The video: `{CH}/ch{NN}.mp4`. The work folder: `{CH}`.
- The summary: `{CH}/check/review/SUMMARY.md`, your theme — the section "{THEME}".
- The rules of the role: `python tools/read_role.py F`. The rules of the theme: `python tools/read_role.py --sec docs/PRODUCTION_RULES.md "rules {ITEMS}"`.
- Your files: {FILES}. Do not touch the others. Themes running in parallel: {OTHERS}.
- The notes of the earlier agents of this round: {PREV_FIX}.

The findings:
{FINDINGS}

Do:
1. Fix the findings of the theme. What is not fixed — the reason in the note.
2. Every "fixed" — a crop "before | after".
3. Precheck by the scenes of the theme — 0. {FULL_PRECHECK}
4. If you touched the engine lane (`python tools/lane.py check`) — `python tools/lane.py guard`: 0.
5. Do not start the render.

The end: the note `{CH}/check/notes/fix-{SLUG}.md` and a report of up to 10 lines.
