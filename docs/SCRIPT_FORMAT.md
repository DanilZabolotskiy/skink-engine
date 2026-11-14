# Script format — shared by the script writer and the pipeline

One Markdown file per chapter: `channels/<channel>/seasons/s01/ep01/ch01/script.md` (and optionally a translation `script.<lang>.md` with the same structure). Every field line starts with a fixed label so the parser can read it (`tools/pipeline/parse.py`).

```
# EP01 · CH01 — The Tenth Stamp
meta: target_duration 0:20 | locations: cafe, counter | presets: day | voices: NARRATOR, MIRA, OSCAR

## SCENE 01 — The counter | location: cafe | preset: day | time: 08:30

### SHOT 01.01 | 5.0s | camera: wide from the door, slow push-in
ON SCREEN: the door stands open; Oscar (calm) walks from the door to the counter; Mira (curious) behind the counter
TEXT: title bar "Corner Café — The Tenth Stamp"; counter 1–2, 1 lit; place caption "Corner Café · 8:30"
VO (NARRATOR): "Every morning, the same order."
SFX: amb_cafe (loop)
NOTE: anything the animator must know
```

- `#` title — `EP<n> · CH<n>` gives the episode and chapter numbers (chapter 1 gets the episode plate).
- `##` SCENE: number, title, `location:` (a location of `channel.json → locations`), `preset:` (a preset of `channel.json → presets` or an alias), `time:`.
- `###` SHOT: `NN.MM`, planned duration in seconds, `camera:` — the view (by `locations.<place>.views`) and the move (`push-in`, `pull back`, `pan`, `shake`; otherwise static).
- `ON SCREEN:` who and what is visible, emotions in brackets (`Oscar (calm → relieved)`), actions. Every action verb needs a staging event ([STAGING.md](STAGING.md)).
- `TEXT:` on-screen text exactly as it will appear: `title bar "…"`, `counter 1–5, 2 lit` (`crossed`; `2 crossed, 3 lit` keeps 2 crossed while 3 is lit; `counter off`), `stamp "…"`, `place caption "…"`, `episode "…"`, and cards (`card "…"`, `sign "…"`; " / " splits lines). Every HUD element is optional. Subtitles come from the speech, do not repeat them here.
- `VO (SPEAKER, [tags]):` narration. `DIALOGUE (SPEAKER, [tags]):` lines spoken in the scene. Speakers are keys of `voices.json → speakers` (or `aliases`). Tags are ElevenLabs delivery tags: `[dry]`, `[nervous]`, `[pause]` …
- `SFX:` sounds in order, `(loop)` for beds, `(stop)` to end a loop, `@N` — second from the shot start (a manual binding). Only sound ids or `match`es of the channel library (`pipeline/sfx.json`); anything else is silence. A shot without sounds has no SFX line. Music inserts go here too: `MUSIC: <mood>, <seconds>s`.
- `NOTE:` optional; words of a NOTE can choose the processing of a voice copy (`voices.json → voice_suffix`).
- A shot can have several VO / DIALOGUE lines; the pipeline stretches the shot to the speech if the speech is longer than the planned duration.
