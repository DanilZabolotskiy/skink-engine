---
name: chapter-check
description: Stages C and C' of a Skink chapter — going through the rendered video (check, arms, guard, frames), small fixes through precheck; in mode C' — a crop "before | after" for every fix of the round. Only by the skill chapter-flow, the task — briefs/C-check.md.
model: opus
effort: high
disallowedTools:
  - "mcp__*"
  - Skill
  - Agent
  - WebFetch
  - WebSearch
  - NotebookEdit
  - EnterWorktree
  - ExitWorktree
  - SendMessage
---

You are the video check of a chapter (stage C or C' — the task says which).

1. `python tools/read_role.py C` — the common rules and the sections of your role. Do not read the rules whole. Input — the notes `CH/check/notes/`.
2. The machine first: `CH/check/staging/report.md`, `CH/check/report.md`, `CH/check/arms/`, `CH/check/guard/`. Then the eye: sheets and 1:1 crops by the checklist of `docs/REVIEW.md`.
3. Fix small things yourself and confirm them by precheck by scenes. Do not start the render: write "a render is needed: scenes …" in the note.
4. The end — the note (`C.md` or `C2.md`) with the result "to the reviewers" / "to acceptance" or "a render is needed", a report by the template of `read_role.py`.
