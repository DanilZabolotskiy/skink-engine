// Look of a figure on top of Character: hairstyle, headwear, glasses, type of top and bottom, proportions, age, items in hands.
// Colours are in Outfit. A figure without a look is drawn with DEFAULT_LOOK.

/** An item in a hand. phoneEar — the phone at the ear; box — with both hands at the waist. Poses without an item: rest — sits at a
 *  table, forearms on the table (hands at the table edge, elbows at the sides); point — the arm stretched up and to the side, an open
 *  hand points at something high; carry — both forearms under something carried at the chest (the kit draws what is carried); cup — a
 *  cup at the chest; count — the palm at the chest, the fingers count 1–4 over time; reach — the arm forward and up to a wall (a framed
 *  sheet, a button; from behind with a kit point — the palm on that point). mop — a mop upright in the fist of a lowered hand, the handle at
 *  the shoulder, the rag on the floor; the knock gesture raises it and jabs the handle up (at the ceiling); mopRaised — the mop held over
 *  the head (the end pose of knock: waits for an answer). */
export type Hold = 'none' | 'carry' | 'point' | 'folder' | 'flashlight' | 'phone' | 'phoneEar' | 'stamp' | 'box' | 'tote' | 'bag' | 'keys' | 'pen' | 'cup' | 'count' | 'reach' | 'rest' | 'mop' | 'mopRaised';

export type Look = {
  build?: 'man' | 'woman' | 'child'; // body and face type: proportions, hands, the face of the style; default — man
  hair: 'cowlick' | 'bob' | 'perm' | 'short' | 'shaggy' | 'side' | 'long' | 'ponytail' | 'bun' | 'bald' | 'kid'; // shaggy — longer, uneven (western: as short)
  hat?: 'cap'; // a peaked cap
  hatColor?: string;
  glasses?: 'round' | 'square';
  top: 'jacket' | 'cardigan' | 'padded' | 'hoodie' | 'undershirt' | 'tshirt' | 'blouse';
  bottom?: 'trousers' | 'skirt';
  lanyard?: boolean; // a lanyard with a badge
  age?: number; // 0..1 — wrinkles at the eyes and the mouth; elderly figures stoop a little
  w?: number; // body width (1 — the default figure)
  head?: number; // head size (1 — the default figure)
  neck?: number; // a longer neck, body units: the head sits higher above the collar (otherwise a collared shirt can touch the chin)
  hold?: [Hold, Hold]; // [right, left] — the figure's own hands: facing the camera the right hand is on the left of the frame
  bagStrap?: string; // the colour of the strap of a held bag, drawn over an outline: a dark strap over dark trousers does not read
  features?: FaceFeatures; // individual face features of the role; a style draws those it supports
};

/** The look of a figure that has none: short hair, a hoodie, empty hands. */
export const DEFAULT_LOOK: Look = {hair: 'short', top: 'hoodie'};

/** Individual face features of a role: adjustments to the face type (Look.build). The webtoon style draws all of them, the
 *  western style none (its faces are simpler). */
export type FaceFeatures = {
  jaw?: number; // jaw width, ± figure units
  ang?: number; // jaw angularity 0..1
  long?: number; // face length, ± units (the chin lower)
  cheek?: number; // cheekbones 0..1
  eyeW?: number; // eye width, multiplier
  eyeH?: number; // eye opening, multiplier (narrower for men)
  brow?: number; // brow thickness, multiplier
  arch?: number; // brow arch, multiplier
  lip?: number; // lip tone 0..1 (women)
  stubble?: number; // stubble 0..1
  tan?: number; // skin tan 0..1
  tilt?: number; // eye tilt: outer corner higher (+) or lower (−), figure units
  round?: number; // eye roundness 0..1
  mono?: boolean; // single eyelid (no crease), the upper line thicker and flatter
};
