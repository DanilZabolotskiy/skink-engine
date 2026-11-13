// A channel plugs into the engine as a module: channels/<channel>/chapter/index.tsx exports a ChannelModule, and
// remotion/channels.ts lists the modules. remotion/Root.tsx registers the chapter compositions of every channel
// (<id>-chapter, <id>-chapter-stage, <id>-chapter-hands, <id>-chapter-poses) and wraps them in ChannelCtx, so the
// shared chapter code (lib/chapter) reads the channel's kits, cast, colour grades and HUD from the context. Kits and the roles of an
// episode are files found by folder (lib/chapter/registry.ts): a chapter adds files instead of editing the module (docs/PARALLEL.md).
import React from 'react';
import type {Outfit} from '../character/Character';
import type {Look} from '../character/looks';
import type {HudTheme} from '../hud/hud';
import type {GradeFn} from './grade';
import type {KitDef} from './registry';
import type {KitProps} from './types';

/** A role on screen: colours, look and height in metres. hero — keeps its own colours under a colour grade and takes the preset palette's
 *  skin, top and hair (FigurePalette); style — a drawing style (lib/styles) other than the chapter's (channel.json → style). */
export type Person = {outfit: Outfit; look?: Look; h: number; hero?: boolean; style?: string};

export type ChannelModule = {
  /** Channel folder name (channels/<id>/); also the composition prefix: <id>-chapter. */
  id: string;
  /** Location kit by id (channel.json → locations.<place>.kit): the component and the TEXT it draws itself; undefined — no such kit. A kit
   *  draws the background, figures and effects of one shot. Usually kitsOf(require.context('./kits', …)) of lib/chapter/registry.ts. */
  kit: (id: string) => KitDef | undefined;
  /** Drawing for a location without a kit (kit: null in channel.json); default — lib/chapter/stub.tsx StubKit. */
  stub?: React.FC<KitProps & {about?: string}>;
  /** Colour grades: preset → colour function (lib/chapter/grade.ts). The kit layer of a shot with such a preset is graded in the DOM. */
  grades?: Record<string, GradeFn>;
  /** Role → person (lib/chapter/figure.tsx Figure); the roles of an episode may come from a folder (rolesOf, lib/chapter/registry.ts).
   *  null — unknown role: a neutral stand-in figure with a stub tag. */
  personFor?: (who: string) => Person | null;
  /** HUD: brand — a small line over the episode plate; counterLabel — the label before the counter cells of the title bar; theme —
   *  colours over lib/hud/hud.tsx HUD_DEFAULT. */
  hud?: {brand?: string; counterLabel?: string; theme?: Partial<HudTheme>};
  /** Extra compositions of the channel (cast lineup, face sheets…): a component that renders <Composition> elements. */
  Compositions?: React.FC;
};

export const ChannelCtx = React.createContext<ChannelModule | null>(null);

export function useChannel(): ChannelModule {
  const ch = React.useContext(ChannelCtx);
  if (!ch) throw new Error('no ChannelCtx: wrap the composition in <ChannelCtx.Provider value={channel}> (remotion/Root.tsx)');
  return ch;
}
