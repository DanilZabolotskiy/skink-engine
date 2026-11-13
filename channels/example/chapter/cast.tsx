// Cast of the example channel: role → person (outfit colours, look, height). The look fields — lib/character/looks.ts (look.build — the
// body and face type, look.features — individual face features). A new role — a line here and in pipeline/channel.json → cast.
import {outfitOf, Person} from '../../../lib/chapter/figure';

export const CAST: Record<string, Person> = {
  // the barista: a ponytail, a rust T-shirt, olive trousers, a cup in the hand
  MIRA: {
    outfit: outfitOf('#B5532F', '#4A5240', '#5A2E1E', {skin: '#E0AC85', shoes: '#3B2A22'}),
    look: {build: 'woman', hair: 'ponytail', top: 'tshirt', w: 0.95, hold: ['none', 'cup'], features: {eyeW: 1.06, round: 0.55, lip: 0.6, tilt: 0.5, long: -2}},
    h: 1.64,
  },
  // the regular: an older man with grey side-parted hair, square glasses, a teal padded jacket, stubble
  OSCAR: {
    outfit: outfitOf('#2C6E78', '#3A3B42', '#B9B3AA', {skin: '#EFC7A4', shirt: '#D9D4CA', shoes: '#22201F'}),
    look: {hair: 'side', glasses: 'square', top: 'padded', age: 0.6, w: 1.06, hold: ['none', 'none'], features: {jaw: 3, ang: 0.6, stubble: 0.45, eyeH: 0.85, brow: 1.1}},
    h: 1.76,
  },
};

export const personFor = (who: string): Person | null => CAST[who] ?? null;
