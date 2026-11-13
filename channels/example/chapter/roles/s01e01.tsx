// Roles of episode s01e01 of the example channel (found by folder, lib/chapter/registry.ts → rolesOf; the config side of the role —
// pipeline/parts/s01e01.json → channel.cast and names).
import {outfitOf, Person} from '../../../../lib/chapter/figure';

export const ROLES: Record<string, Person> = {
  // the regular: an older man with grey side-parted hair, square glasses, a teal padded jacket, stubble
  OSCAR: {
    outfit: outfitOf('#2C6E78', '#3A3B42', '#B9B3AA', {skin: '#EFC7A4', shirt: '#D9D4CA', shoes: '#22201F'}),
    look: {hair: 'side', glasses: 'square', top: 'padded', age: 0.6, w: 1.06, hold: ['none', 'none'], features: {jaw: 3, ang: 0.6, stubble: 0.45, eyeH: 0.85, brow: 1.1}},
    h: 1.76,
  },
};
