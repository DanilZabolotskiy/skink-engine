// Drawing styles by id. Every style lives in its own folder lib/styles/<id>/ (the id is the folder name) and imports only the core
// (lib/character, lib/props, lib/anim), never another style; ./registered.ts lists them, one line per style. A new style is a new folder
// plus that line, the core does not change (docs/STYLES.md). channel.json → style picks the style of a chapter, Person.style of a role.
import type {CharacterStyle} from '../character/style';
import * as registered from './registered';

export const STYLES: Record<string, CharacterStyle> = Object.fromEntries(Object.values(registered).map((st) => [st.id, st]));

/** A registered style by id; an unknown id is an error, not a silent fallback. */
export function styleById(id: string): CharacterStyle {
  const st = STYLES[id];
  if (!st) throw new Error(`no drawing style "${id}": registered ${Object.keys(STYLES).join(', ')} (lib/styles/registered.ts)`);
  return st;
}
