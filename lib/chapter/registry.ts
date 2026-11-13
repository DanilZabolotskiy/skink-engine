// Registries by folder: a chapter only adds files and does not edit shared lists (docs/PARALLEL.md), so two sessions working on different
// episodes do not touch the same file.
//   channels/<channel>/chapter/kits/*.tsx  — a location kit exports KIT: KitDef (or a list of them); a file without KIT is a kit helper;
//   channels/<channel>/chapter/roles/*.tsx — roles of an episode (or of a story) export ROLES: role → Person.
// The channel module finds the files with webpack's require.context (the call must be written literally in the channel's own file, see
// channels/example/chapter/index.tsx) and passes the context here. The modules are loaded lazily, on the first lookup from a frame: kit
// and role modules may import the channel's cast or helpers without an import cycle. The order is by file name; the same kit id or role in
// two files is an error.
import type React from 'react';
import type {Person} from './channel';
import type {KitProps, Shot} from './types';

/** The modules of a folder as webpack gives them: require.context(dir, false, /\.tsx$/). */
export type FolderModules = {keys(): string[]; (key: string): Record<string, unknown>};
/** The type of webpack's require.context, to declare it in a channel module: declare const require: {context: RequireContext}. */
export type RequireContext = (dir: string, deep: boolean, re: RegExp) => FolderModules;

/** A location kit: id (channel.json → locations.<place>.kit), the component, and the on-screen text (script TEXT) the kit draws itself —
 *  label → true: Chapter does not repeat it as a card. */
export type KitDef = {id: string; Kit: React.FC<KitProps>; cards?: (label: string, shot: Shot) => boolean};

/** [file name, module] of a folder, by file name (webpack also lists every file under its full path: only the "./name" keys count). */
const modules = (ctx: FolderModules): [string, Record<string, unknown>][] =>
  ctx.keys().filter((k) => k.startsWith('./')).sort().map((k) => [k.slice(2), ctx(k)]);

/** One record of the exports `name` of a folder: `entries` turns the export of a file into [key, value] pairs; a key in two files — an
 *  error. */
function collect<T>(ctx: FolderModules, name: string, entries: (v: unknown) => [string, T][], what: string): Record<string, T> {
  const out: Record<string, T> = {};
  const from: Record<string, string> = {};
  for (const [file, m] of modules(ctx)) {
    if (m[name] === undefined) continue;
    for (const [key, v] of entries(m[name])) {
      if (from[key]) throw new Error(`${what} "${key}" is declared twice: ${from[key]} and ${file}`);
      out[key] = v;
      from[key] = file;
    }
  }
  return out;
}

/** Kits of a folder (exports KIT): id → kit. */
export function kitsOf(ctx: FolderModules): (id: string) => KitDef | undefined {
  let all: Record<string, KitDef> | null = null;
  return (id) => {
    all ??= collect<KitDef>(ctx, 'KIT', (v) => (Array.isArray(v) ? v : [v]).map((d: KitDef) => [d.id, d]), 'kit');
    return all[id];
  };
}

/** Roles of a folder (exports ROLES): role → person. */
export function rolesOf(ctx: FolderModules): (who: string) => Person | undefined {
  let all: Record<string, Person> | null = null;
  return (who) => {
    all ??= collect<Person>(ctx, 'ROLES', (v) => Object.entries(v as Record<string, Person>), 'role');
    return all[who];
  };
}
