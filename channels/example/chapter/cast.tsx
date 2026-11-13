// Cast of the example channel: role → person (outfit colours, look, height). The look fields — lib/character/looks.ts (look.build — the
// body and face type, look.features — individual face features).
// The channel's regulars are here (CAST). The roles of an episode live in their own file roles/<episode>.tsx with an export ROLES, found by
// folder (lib/chapter/registry.ts): a chapter adds its roles without editing this file (docs/PARALLEL.md). A new role — a person here or in
// the episode file, and the role in pipeline/channel.json → cast (or in the episode's pipeline/parts/<episode>.json → channel.cast).
import {outfitOf, Person} from '../../../lib/chapter/figure';
import {RequireContext, rolesOf} from '../../../lib/chapter/registry';

declare const require: {context: RequireContext};

const CAST: Record<string, Person> = {
  // the barista: a ponytail, a rust T-shirt, olive trousers, a cup in the hand
  MIRA: {
    outfit: outfitOf('#B5532F', '#4A5240', '#5A2E1E', {skin: '#E0AC85', shoes: '#3B2A22'}),
    look: {build: 'woman', hair: 'ponytail', top: 'tshirt', w: 0.95, hold: ['none', 'cup'], features: {eyeW: 1.06, round: 0.55, lip: 0.6, tilt: 0.5, long: -2}},
    h: 1.64,
  },
};

const episodeRoles = rolesOf(require.context('./roles', false, /\.tsx$/));

export const personFor = (who: string): Person | null => CAST[who] ?? episodeRoles(who) ?? null;
