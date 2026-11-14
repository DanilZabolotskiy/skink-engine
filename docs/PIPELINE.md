# Chapter pipeline: script → video

Input — a chapter script in the format of [SCRIPT_FORMAT.md](SCRIPT_FORMAT.md) and its `staging.json` ([STAGING.md](STAGING.md)). Output — an mp4 of the chapter (frame size and fps from `channel.json`; the example: 1920×1080, 30 fps) with speech, sounds and music, an `.srt` next to it, and reports. An episode is a join of chapters.

## Commands

Node 24+, Python 3.11+ with numpy, Pillow and scipy, ffmpeg and ffprobe.

```
python tools/pipeline/run.py <script.md | chapter folder> --go           # the whole chapter; --go — allow paid TTS of new lines
python tools/pipeline/run.py <script.md> --estimate --no-stt              # no TTS: durations from the text, silent speech
python tools/pipeline/run.py <script.md> --estimate --no-stt --style western --work <folder>   # another drawing style
python tools/pipeline/run.py <script.md> --steps parse,timeline,precheck --scenes 01,02   # the edit loop: staging before render
python tools/pipeline/run.py <script.md> --until 120 --go                 # only the first ~2 minutes
python tools/pipeline/run.py <script.md> --scenes 01,02 --go              # only these scenes
python tools/pipeline/run.py <script.md> --steps render,assemble          # by steps
python tools/pipeline/run.py episode channels/<channel>/episodes/s01e01/en   # the episode master 1080; --4k — 3840×2160 (below, "Episode master")
python tools/pipeline/sfx_list.py <script.md>                             # chapter sounds, the generation estimate → audio/sfx_needed.md
python tools/pipeline/sheets.py <work folder> --scenes 05,08 [--at 0.2]   # sheets from stills without rendering a video
python tools/pipeline/staging.py verbs <work folder> [--shots 04.02]      # "line → event" check alone
python tools/guard.py --accepted [--events]                               # accepted chapters against their videos (below)
python tools/lane.py guard [--events]                                     # the same — only the chapters an edit touches (docs/PARALLEL.md)
python tools/pipeline/stage_check.py <work folder> [--shots 04.01] [--no-video]   # staging checks alone
```

Without `--go` the pipeline prints the estimate of new lines (characters and credits) and stops. Voiced lines are cached in the work folder and are not paid twice.

Flags: `--lang en` — speech language (default: `channel.json → language`), `--model eleven_v4` — another TTS model, `--style <id>` — the drawing style of the figures instead of `channel.json → style`, `--concurrency 4` — render threads (the default; other work may share the CPU), `--no-stt` — no speech recognition, `--force-render` — render without the cache, `--work <folder>` — a work folder instead of `episodes/` (the video is `<folder>/chapter.mp4`, or `chNN.mp4` for a folder named `chNN`; the standalone tools below take such a folder too), `--no-precheck` — no staging check before render, `--no-hands` — precheck without arm poses, `--no-guard` — no accepted chapters guard.

## Steps

| Step | What it does | Code | Output in the work folder |
|---|---|---|---|
| parse | Script → scenes, shots, lines, text, sounds, music. Errors with a line number and a hint: unknown location, preset, speaker; a Korean line without Hangul | `parse.py` | `scenes.json` |
| voice | Lines → ElevenLabs `/with-timestamps`: mp3 and character timings. Cache by "model + voice + settings + text". `--estimate` — no API | `voice.py`, `lib/eleven.py` | `voice/*.mp3`, `*.json` |
| timeline | Shot times (a shot stretches to its speech: lead-in, gaps, tail from `channel.json → timing`), staging events → prop states, paths, sounds, mouth syllables, cards, title bar and counter, beds, music | `timeline.py`, `staging.py` | `timeline.json` |
| precheck | Staging **before render** on stills from code: the same `stage_check.run` as the check step without the video and mix checks (data checks, frame journal, events without a visible change, view, props, timing in kit code) plus arm poses (`tools/hands_check.mjs`). Errors stop the pipeline before render. With `--scenes` and without render — the timeline of the whole chapter, the check only on the shots of these scenes | `precheck.py`, `stage_check.py`, `tools/stage_layout.mjs`, `tools/hands_check.mjs` | `check/precheck/report.md`, `staging/`, `arms/` |
| render | Remotion, composition `<channel>-chapter`, scene by scene from the code copy; cache by the hash of code and scene data | `render.py`, `tools/render.mjs`, `tools/mirror.py` | `render/sNN.mp4`, `video.mp4` |
| audio | Mix of speech, beds, sounds and music; master loudness | `audio.py` | `audio/mix.wav`, `speech.wav`, `amb.wav`, `sfx_missing.md` |
| assemble | Video without re-encoding + AAC 192k; `.srt` | `audio.py` | `chNN.mp4`, `chNN.srt` |
| check | Frame sheets, speech recognition, speech vs frames, lengths, preset shares, music, colour, staging on the video (jumps, jitter, drift, camera jerk, sound on a still frame, ambience dropout, voice band, quiet line) | `check.py`, `stage_check.py`, `color_check.py` | `check/report.md`, `check/sheet_*.jpg`, `check/staging/report.md`, `sounds.md` |
| guard | Accepted chapters (`accepted/<episode>.txt`) against their videos: control frames drawn by the current code — only the chapters whose frames the uncommitted edit touches (`tools/lane.py`: shared code — all, a kit — the chapters with it; new files of a chapter — none, the step is skipped). Not run in trial runs (`--until`, `--scenes`, `--estimate`) | `tools/guard.py`, `tools/lane.py` | `check/guard/report.md`, `<chapter>/report.md`, `pairs/` |

Work folder (not in git): `channels/<channel>/episodes/<s01e01>/<lang>/<chNN>/` for `seasons/s01/ep01/chNN/script.md`; for drafts — `episodes/_test/<folder>/<lang>/`. The work folder of an accepted chapter is the guard reference: the pipeline does not write into it (an error; an edit of an accepted chapter — the owner's decision, `SKINK_UNFREEZE=1`).

The heavy steps — precheck, render, the frame journal of the check step, guard chunks, sheets — go through the CPU queue of the machine (`tools/cpu_queue.py`, [PARALLEL.md](PARALLEL.md), "CPU queue"); a wait is written to the log: `CPU queue: … waits`.

## Edit loop

1. Edit → `--steps parse,timeline,precheck --scenes NN,MM` (or `sheets.py` to look) → until 0 errors.
2. Precheck of the whole chapter (`--steps parse,timeline,precheck`) — 0 errors.
3. Full run; read `check/report.md` and `check/staging/report.md`.

An `ENVIRONMENT` line in precheck is a browser failure, not staging: repeat the run.

## Channel config — `channels/<channel>/pipeline/`

- **Part files** `pipeline/parts/<name>.json` (an episode usually has one: `parts/s01e02.json`) are merged into the files below on load (`tools/pipeline/common.py` → `Channel`): `{"episode": "s01e02", "channel": {…}, "voices": {…}, "sfx": {…}, "music": {…}}`. New keys are added, dicts merge deeply, `cast_words` and `action_verbs` are appended; a file with `episode` is merged only into the chapters of that episode (all its keys), a file without it — into every chapter; a key already set to another value is an error (shared settings change in the engine lane). A chapter writes its places, roles, words, aliases and sounds there and does not edit the shared files ([PARALLEL.md](PARALLEL.md)).
- `channel.json`:
  - `language` — speech language (`en`, `ko`…); `fps`, `width`, `height` — the frame of the chapter; `style` — the drawing style of the figures (a folder of `lib/styles`; required).
  - `presets` — preset → class (`day` / `night` / `climax`…), `preset_aliases`, `preset_share` (share of an episode per class), `climax_seconds` (optional: `[min, max]` seconds of the climax class per chapter).
  - `locations.<place>` — `kit` (the id of a kit — a file `chapter/kits/<file>.tsx` with an export `KIT`, or `null` — a stub), `about`, `views` (`[{"cam": regex, "on": regex, "view": name}]` — the first match over the camera line and ON SCREEN gives the kit view; otherwise `close` if the camera line says close, else `wide`), `ambience` (id of a loop in `sfx.json` or `{preset class: id}`), `drift` (the kit always moves the camera).
  - `names` — `{"ROLE": [regex…]}` — roles found by name in script lines; `lead` — the main role (a clause without a name gives it the emotion); `cast` — roles with a ready figure; `cast_words` — `[{"re", "who", "not"}]` — roles found by words ("the guard"); `cast_pron` — pronouns of roles (`she`, `it`; the rest — `he`); `extras` — roles without a figure: `prefix` of their ids in ON SCREEN and `words` that find them in a line (drawn as stand-ins with a stub tag).
  - `actions`, `poses`, `action_verbs` — channel additions to `lib/staging/actions.json`.
  - `hud` — `stamp` (optional: a stamp under the title bar in every shot), `episode_plate` (`"Episode {ep}"`).
  - `timing` — `lead_in`, `gap`, `tail`, `min_shot`, `scene_dip`, `est_syllables_per_sec` (speech rate for `--estimate`: letters per second).
  - `subtitles` — `max_chars`, `min_dur`, `highlight` (`[[regex, replacement]]`, `{…}` is drawn in the accent colour), `ytt` (`colors` per speaker, `others`, `highlight`, `font` — the YouTube subtitles, below); `check` — thresholds.
- `voices.json` — speaker → `voice_id`, loudness (`lufs`), `model`, `settings`, `aliases`; `voice_suffix` — a speaker `<NAME>_VOICE` imitates `<NAME>` with an ffmpeg effect; `effects.phone` — the phone band (`"quiet": true` — the loudness check does not flag these lines as quiet).
- `music.json` — tracks, moods (keys → track and segment), loudness, ducking.
- `sfx.json` — the sound library: `sounds` (ready files `assets/sound/<id>.mp3`), `planned` (to be generated: prompt, length, loop), `match`, `needs` / `see` (a loop that needs a visible source), `ignore`. A sound not in the library is silence.
- `colors.json` (optional) — reference colour stats per preset for the colour check (`tools/pipeline/color_check.py`).
- `../accepted/<episode>.txt` (optional; the older single `../accepted.txt` works too) — accepted chapters for the guard step, a file per episode.

## Script: what the pipeline understands

- **Translation.** A draft can be written in English (`script.md`) and spoken in another language: the agent translates it into `script.<lang>.md` with the same structure (lines and `TEXT` translated). If it exists, the pipeline takes it; for `ko` a line without Hangul is an error.
- **Speech tags.** `VO (NARRATOR, [dry])` — the tag is repeated before every phrase, because a tag works only until the first pause.
- **Staging by script words.** The camera line gives the view (`views` of the location) and the move (`push-in`, `pull back`, `pan`, `shake`; without them the shot is static). Who is in the frame — `ON SCREEN` and the camera line by `names` / `cast_words`. Emotions — `calm`, `wary`, `scared`, `relieved` and synonyms (`timeline.py → EMO_WORDS`) or face names of `lib/character/emotions.ts`; a chain `calm → wary` spreads evenly over the shot.
- **Motion and its sound come from events in `staging.json`** ([STAGING.md](STAGING.md)), not from words.
- **TEXT.** `title bar "…"` — the title bar (stays until changed; no title bar — no bar); `counter 1–5, 2 lit` (`crossed` — crossed out, `counter off` — no cells); `stamp "…"` — a stamp under the bar; `place caption "place · time"` — a place tag for 5 s; `episode "…"` — the episode plate (chapter 1 gets "Episode N" automatically); anything else (`document "…"`, `sign "…"`) — a text card, unless the kit draws it itself (`KIT.cards`).
- **SFX.** Sounds separated by `;`. `(loop)` — a loop until the end of the scene or `(stop)`; `@2.5` — second from the shot start (a manual binding). A one-shot sound without an event is a check error.
- **Mouth.** A figure in the frame opens its mouth by the syllables of its own line (character timings).
- **MUSIC.** In the SFX line: `MUSIC: <mood>, <seconds>s` — 3–15 s; a manual mark `MUSIC: hit, 6s, A@41.5`.

## Render

- Remotion on the CPU, `--gl=swangle`, h264 CRF 18 yuv420p bt709, scene by scene with a cache.
- Working chapter renders (checks, guard, edit rounds, the chapter mp4) — the frame size of the timeline (the example: 1920×1080), CRF 18 (`render.CRF`). 4K — only the episode master with `--4k` (below).
- The code is copied to `<temp>/<project folder>-mirror` (`tools/mirror.py`, `node_modules` as a link; an episode worktree gets its own copy; `SKINK_MIRROR` — another folder). See [STACK.md](STACK.md).
- The render goes through the CPU queue: one render per machine, next to it only a chunk of stills ([PARALLEL.md](PARALLEL.md), "CPU queue").
- Remotion renders no sound; ffmpeg mixes it.

## Episode master

The episode master is 1080 with CRF 18 by default; 4K — by a flag. Working chapter renders stay 1080, CRF 18.

```
python tools/pipeline/run.py episode channels/<channel>/episodes/s01e01/en             # 1080 master → s01e01_en.mp4 and .srt
python tools/pipeline/run.py episode channels/<channel>/episodes/s01e01/en --4k        # a 3840×2160 master
python tools/pipeline/run.py episode <episode folder> --4k --chapters 01,02            # only the 4K render of these chapters, no joining
python tools/pipeline/run.py episode <episode folder> --out <file>.mp4                 # the master into another file
```

- The chapters of an episode — `chNN/chNN.mp4` in the language folder, in order.
- **1080** (default): the chapter videos `render/video.mp4` are joined without re-encoding.
- **4K** (`--4k`): every chapter is rendered anew by the same compositions and `timeline.json` with scale 2 (Remotion `scale`): the vector frame is drawn at 3840×2160, not an upscale of 1080.
  - The cache is per scene, as for a chapter, in `<episode folder>/master4k/chNN/`: the folders of accepted chapters are not touched. A 4K chapter has as many frames as its `render/video.mp4`, otherwise an error.
  - The render goes in chunks of `--batch` frames (default 5400, 3 min of video), each chunk with its own place in the CPU queue: renders of other sessions pass between chunks.
  - Render from an own code snapshot, so that chapter edits in the same checkout do not land in the middle of the run: `SKINK_MIRROR=<temp>/<project folder>-master-mirror python tools/mirror.py`, then the master command with the same `SKINK_MIRROR` and `SKINK_MIRROR_FROZEN=1`.
  - A measurement (8 cores / 16 threads, `--concurrency 12`, a 40 min episode): 4K takes 1.8–2.9 s of render per 1 s of video, 2.0 on average, 3–5 times longer than 1080. The bitrate is 3.0 Mbit/s against 1.3 for 1080 at the same CRF: a flat vector picture compresses well.
- Sound — `audio/mix.wav` of the chapters: AAC 192k, the master loudness is the same.
- The master is written to `<episode>_<language>.tmp.mp4` and replaces `<episode>_<language>.mp4` only as a whole. With `--out` — right into that file.

## Episode subtitles for YouTube — `tools/ytt.py`

```
python tools/ytt.py channels/<channel>/episodes/s01e01/en [--journal]     # → s01e01_en.ytt and .ttml next to the master
python tools/ytt_check.py channels/<channel>/episodes/s01e01/en          # a sheet of the pages over the frames, overlaps, timing against the speech
python tools/ytt_burn.py --ytt <file>.ytt --video <master>.mp4 --frames 9.5,20   # stills as the YouTube player draws them (Chrome)
```

- The same cues as the `.srt` of the master, as `.ytt` (srv3): one line at the bottom centre, white with a dark edge and a 59 % background, a colour per speaker (`channel.json → subtitles.ytt.colors`, the rest — `others`), `{…}` of `subtitles.highlight` — the `highlight` colour.
- A page moves off what the frame shows there — the place tag, a card, a head, a read sign (the frame journal of the check step; `--journal` takes it at the frames of the pages): up, to the top under the title bar, to the side; the next page of the same line stays in place. A world text is soft: a page on a document filling the frame stays at the bottom.
- The time follows the voice (`audio/speech.wav`): a page starts with the voice and covers short pauses; a page is never shorter than `subtitles.min_dur`.
- Upload the `.ytt` as the subtitle file of the video; the TTML is a fallback with colours and regions only.

## Sound

- Speech — to its own loudness (`voices.json`, narrator −17 LUFS, others −18).
- Sounds from `sfx.json`: loops −32 LUFS, one-shots −24 unless the entry says otherwise. A place bed runs by itself (named by the script — for the scene, else the `ambience` of the place); the same bed across a cut is one track, different beds crossfade over 0.6 s.
- Generating sounds without the owner's command is not allowed: a sound without a file is silence and goes to `audio/sfx_missing.md`. `sfx_list.py` prints the full list with the cost estimate.
- Music — a piece of a track at −24 LUFS, ducked −9 dB under speech. Master — two-pass loudnorm to −16 LUFS, true peak ≤ −1.5 dBTP.

## Checks — `check/report.md`

- Sheets: the middle of every shot, ≤ 4 frames per sheet, by scene.
- Speech recognition (ElevenLabs STT over the speech track): similarity ≥ 0.8, start offset ≤ 0.35 s.
- Speech outside its shot — an error; shots without speech longer than 5 s — a list. Lengths of the video, the sound and the timeline match.
- Preset shares by class, climax seconds, music inserts, missing sounds, colour against `colors.json`.
- Staging — [STAGING.md](STAGING.md), "Checks".

## Accepted chapters guard — `tools/guard.py`

An edit of shared code must not change accepted chapters. The reference is the accepted video `chNN.mp4` and its `timeline.json`; the lists — `channels/<channel>/accepted/<episode>.txt`, a file per episode (a line — a chapter work folder relative to the channel folder, `#` — a comment).

Which accepted chapters an edit touches — `tools/lane.py` ([PARALLEL.md](PARALLEL.md)): the core (the static imports of `remotion/index.ts`, the render path) — all of them; a kit or a role file — the chapters that use it; the config and `tools/pipeline/*.py` change no frames — for them the rebuild `lane.py retime` (the timelines of the accepted chapters stay the same). `python tools/lane.py guard [--events]` — guard of the touched chapters only and a stamp for an engine-lane commit; `python tools/lane.py usage <file>` — who uses a file.

```
python tools/guard.py --accepted                  # the middle of every shot of all accepted chapters against their videos
python tools/guard.py --accepted --events         # plus 35 % and 75 % of every staging event — before handing a chapter over
python tools/guard.py <chapter folder> --shots 23.01
python tools/guard.py --accepted --out <base>     # before an edit — a base…
python tools/guard.py --accepted --base <base>    # …after it — against the base (stricter) and against the video
```

Output: `report.md`, `report.json`, `pairs/<shot>_<frame>.jpg` ("accepted | new" and 1:1 crops of the differences); exit code 1 — differences found. A difference is a regression of an accepted chapter: fix the code, or rebuild and re-accept the chapter if the new look is wanted.

**Known noise** — `channels/<channel>/guard_known.json`: differences that were there before the edit (for example, a thin coloured edge the current code draws a little differently from the accepted video, on a clean commit too). The file:

```json
{"known": [{"chapter": "episodes/s01e01/en/ch02", "shot": "03.02", "frame": 1450, "box": [612, 388, 660, 396], "tol": 6,
            "max_blob": 100, "why": "thin edge of a door frame", "date": "2026-01-31", "commit": "abc1234"}]}
```

`chapter` — the path as in `accepted/<episode>.txt`; `shot`; `box` — the patch box from the guard report `[x0, y0, x1, y1]`; `tol` — the box tolerance in px; `max_blob` — the largest patch in px; `why`, `date`, `commit` — the cause, the date and the commit it was reproduced on; `frame` — for reference. A frame whose patches above the threshold all fall into entries (the same shot, the box inside the entry box ± `tol`, the patch ≤ `max_blob`) is shown on a separate line "known (guard_known.json)" and does not count: the total, the exit code, the `lane.py` stamp and the hook do not see it. Any other patch in the same shot is a difference. Only against the video (not against `--base`). `--known <file>` — another list, `--no-known` — everything counts.

Only the **orchestrator** adds an entry, and only after checking on a clean commit (before the edit: an own `SKINK_MIRROR` from a `git worktree` or a clone of that commit, `guard.py <chapter> --shots <shot> --no-known`) that the noise was there before the edit. Executors and the chapter lane do not edit the list: a patch that is not in it is a regression until the orchestrator proves otherwise. The file is the engine lane.
