// Colours of the example channel per preset (channel.json → presets). Kits draw with these; the engine itself has no palette.
export type Pal = {
  wall: string; wallSide: string; floor: string; ceil: string; trim: string; tile: string; wood: string; woodTop: string; shelf: string;
  sky: string; skyLow: string; doorway: string; light: string; pool: number; outline: string; paper: string; ink: string; brand: string;
};

const PALETTES: Record<string, Pal> = {
  day: {
    wall: '#EFE3CF', wallSide: '#E2D2B8', floor: '#8A6448', ceil: '#F5ECDD', trim: '#5E4634', tile: '#D9EDE8', wood: '#8B5E3C', woodTop: '#C79F74',
    shelf: '#6E4B33', sky: '#A9D8EC', skyLow: '#E2F1F6', doorway: '#3A3330', light: '#FFE6B8', pool: 0.22, outline: '#1E1A17', paper: '#FFFDF7',
    ink: '#2A2420', brand: '#2A9D8F',
  },
  night: {
    wall: '#4A4054', wallSide: '#3F3648', floor: '#3A2C26', ceil: '#3A3242', trim: '#241C1A', tile: '#3E5A5A', wood: '#5A3E2C', woodTop: '#7A5A40',
    shelf: '#3A2A22', sky: '#1B2442', skyLow: '#2D3A66', doorway: '#0E0F14', light: '#FFD39A', pool: 0.45, outline: '#0C0A0A', paper: '#EDE6D6',
    ink: '#1A1614', brand: '#3FB8A8',
  },
};

export const palOf = (preset: string): Pal => PALETTES[preset] ?? PALETTES.day;
