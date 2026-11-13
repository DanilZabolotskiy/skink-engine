# Channels

A channel is a pluggable folder: the engine knows nothing about a channel's stories, places or cast. `channels/example/` is a complete small channel to copy.

```
channels/<id>/
  pipeline/channel.json     locations (kit, views, ambience), presets, roles, drawing style, HUD texts, timing, check thresholds
  pipeline/voices.json      speaker → ElevenLabs voice
  pipeline/sfx.json         sound library (ready files and planned ones)
  pipeline/music.json       music tracks and moods
  pipeline/colors.json      optional: colour references per preset for the colour check
  pipeline/parts/*.json     what an episode adds to the config (places, guest roles, words, actions, aliases, sounds)
  accepted/<episode>.txt    optional: accepted chapters for the guard step
  chapter/index.tsx         the channel module (default export)
  chapter/cast.tsx          the regulars: roles → people (outfit, look, height)
  chapter/roles/*.tsx       the roles of an episode (export ROLES), found by folder
  chapter/kits/*.tsx        location kits (export KIT), found by folder
  assets/sound/, assets/music/   media files (not in git)
  seasons/s01/ep01/ch01/script.md, staging.json
  episodes/                 work folders (not in git)
```

## The channel module

`chapter/index.tsx` exports a `ChannelModule` (`lib/chapter/channel.ts`):

```ts
const channel: ChannelModule = {
  id: 'example',                           // = folder name; compositions example-chapter, example-chapter-stage, …
  kit: kitsOf(require.context('./kits', false, /\.tsx$/)),  // kit id → {id, Kit, cards}: every kits/*.tsx with an export KIT
  personFor,                               // role → {outfit, look, h, hero?, style?} or null (a stand-in with a stub tag)
  grades: {day: mutedDayRgb},              // optional colour grades per preset (lib/chapter/grade.ts)
  hud: {brand: 'SKINK DEMO', counterLabel: 'PART', theme: {accent: '#2A9D8F', round: true}},
  Compositions: LineupCompositions,        // optional extra compositions (cast lineup…)
};
export default channel;
```

Kits and the roles of an episode are found by folder (`lib/chapter/registry.ts`): a chapter adds a file instead of editing a shared list, so two sessions working on different episodes do not edit the same file ([PARALLEL.md](PARALLEL.md)). `require.context` is webpack's: the call must be written literally in the channel's own file, with `declare const require: {context: RequireContext};` for TypeScript. The same kit id or role in two files is an error in the frame.

```ts
// kits/cafe.tsx — the last lines of a kit file
export const KIT: KitDef = {id: 'cafe', Kit: CafeKit};                              // id = channel.json → locations.<place>.kit
// kits/counter.tsx — a kit that draws a TEXT card itself
export const KIT: KitDef = {id: 'counter', Kit: CounterKit, cards: counterCards};   // label → true: no HUD card for it
```

Register it in `remotion/channels.ts`:

```ts
import example from '../channels/example/chapter';
import mychannel from '../channels/mychannel/chapter';
export const CHANNELS: ChannelModule[] = [example, mychannel];
```

`remotion/Root.tsx` then registers `<id>-chapter` (the chapter by `timeline.json`), `<id>-chapter-stage` (frame journal), `<id>-chapter-hands` and `<id>-chapter-poses` (service compositions for the hand checks). The pipeline writes the channel id into `timeline.json → channel` and picks the composition by it.

## A kit

A kit is a React component `({shot, t, lt, f}: KitProps) => JSX` that draws one shot: background, figures, props, effects. Rules:

- Describe a room once in metres with `lib/chapter/room.tsx` (`wallX`, `wallZ`, `flatY`, `box`, `textOn`, `floorPool`, `draw`); a view is a `Cam` chosen by `shot.view`; a camera move over the whole shot is computed from `lt / dur` and marked `// cam: …`.
- Place roles with `Figure` (`lib/chapter/figure.tsx`) at `pt(cam, [x, 0, z])` with `ppm = focal(cam) / depth`; walking figures take their position from `pathAt(member.path, u, dur)`; gaze with `gazeBy(...)` and named target points.
- Every other motion comes from events: `beat`, `propAt`, `eventOf` (`lib/staging/stage.ts`). No shot fractions or seconds in kit code.
- Mark props for the frame journal with `propMark(id, state)`, texts the shot must show with `read`, hands the kit draws itself with `handMark(...)`.
- Text drawn by the kit goes into `KIT.cards` so the chapter does not repeat it as a card.

## A role

`chapter/cast.tsx` maps the regulars of the channel to a `Person`; the roles of an episode go to `chapter/roles/<episode>.tsx` (`export const ROLES: Record<string, Person>`), which `cast.tsx` adds with `rolesOf(require.context('./roles', false, /\.tsx$/))`. A person:

- `outfit` — colours: skin, hair, top, shirt, trousers, shoes, lanyard, folder, line (`Outfit` of `lib/character/Character.tsx`; missing ones come from `OUTFIT_DEFAULT`);
- `look` — `lib/character/looks.ts`: `build` (man, woman or child: proportions and face type; default — man), hair, top, bottom, a cap, glasses, age, width, head size, items in the hands, a lanyard with a badge (only when `lanyard` is set), individual face features (`features`);
- `h` — height in metres; `hero` — keeps its own colours under a colour grade;
- `style` — a drawing style (a folder of `lib/styles`) other than the chapter's (`channel.json → style`).

In `channel.json` (for a role of an episode — in `pipeline/parts/<episode>.json` → `channel`): `cast` (roles with a figure), `names` (regexes that find the role in script lines), `lead`, `cast_pron`, `extras` (roles without a figure, drawn as stand-ins); in `voices.json`: a speaker (a role of an episode may take an existing voice by `voices.aliases` of its part file).

## Drawing styles

`channel.json → style` names the style of the channel's chapters (`run.py --style` overrides it for a run); a role can take another with `Person.style`. The styles are engine add-ons registered in `lib/styles/registered.ts`; an unknown id is an error. How the core and the styles split the work and how to add a style: [STYLES.md](STYLES.md).

## HUD

`ChannelModule.hud` sets the brand line over the episode plate, the label before the counter cells and the colour theme (`HudTheme` of `lib/hud/hud.tsx`, over `HUD_DEFAULT`). What the bar shows comes from the script (`TEXT: title bar "…"; counter 1–5, 2 lit`, see [SCRIPT_FORMAT.md](SCRIPT_FORMAT.md)): no title bar line — no bar; no counter line — no cells. `channel.json → hud`: `stamp` (a stamp under the right end of the bar for every shot, optional) and `episode_plate` (`"Episode {ep}"`).
