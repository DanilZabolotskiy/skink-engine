# Stack

| Layer | What | Where |
|---|---|---|
| Composition and render | **Remotion 4** (TypeScript / React), pinned to 4.0.541 | `remotion/`, `lib/` |
| Locations | A model in metres → a camera → flat SVG polygons: light pools, glows, comic outline by depth; any view of one room | `lib/persp/`, `lib/chapter/room.tsx`, kits in the channel folder |
| Characters | Entirely in code (SVG). The core solves the figure: emotion as a set of numbers, head turn, gaze, blinking, breathing, trembling, arm IK with constant lengths, grips; drawing styles draw it (`webtoon`, `western`, your own) | `lib/character/`, `lib/styles/`, `lib/props/` |
| Staging | Events of a shot → prop states, paths, sounds; frame journal for layout checks | `lib/staging/`, `tools/pipeline/staging.py` |
| Effects | Lamp flicker, dust with parallax, haze, vignette, glow | `lib/fx/` |
| Interface | A themeable title bar with an optional counter and stamp, place tag, episode plate, cards, subtitles; fonts Noto Sans KR and Mono (OFL) | `lib/hud/`, `lib/chapter/Chapter.tsx`, `public/fonts/` |
| Voice | ElevenLabs TTS with character timings (`/with-timestamps`), speech recognition for the check | `lib/eleven.py`, `tools/pipeline/voice.py` |
| Pipeline and checks | Python 3 + ffmpeg | `tools/pipeline/` |

Why Remotion: a scene is code and data, so an agent can write it; every browser effect works; it renders on the CPU without a GPU. Mind its license (see the README).

## Render — on the CPU

Flags: `--gl=swangle --concurrency=4 --pixel-format=yuv420p --color-space=bt709`. Without the last two Remotion gives yuvj420p (full range).

**Rasterisation by the CPU in every tab.** With `swangle` all tabs draw through one SwiftShader GPU process, and it becomes the bottleneck. With `--disable-gpu-rasterization` every tab draws by itself: 120 frames took 6.4 s instead of 43 s at 16 tabs. Remotion adds this flag only when `__RESERVED_IS_INSIDE_REMOTION_LAMBDA=true`; the node tools set it in `tools/remotion.mjs`, for a plain `npx remotion render` set the variable by hand.

Measured on an 8-core desktop CPU: about 0.9–2.4 s of render per 1 s of video depending on the kit; a single still ≈ 0.5–1 s.

**Render from a copy of the code.** On some Windows machines rendering from the project folder was ~7 times slower than from the temp folder (likely antivirus file scanning). `tools/mirror.py` copies the code and fonts to `<temp>/skink-engine-mirror` (`SKINK_MIRROR` — another folder) and links `node_modules`; all pipeline tools render from there. A repeated sync copies only what changed.

Remotion renders no sound: ffmpeg mixes and muxes it (`tools/pipeline/audio.py`).
