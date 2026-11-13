// Channel module of the example channel: what the engine needs to draw a chapter of this channel (lib/chapter/channel.ts).
// remotion/channels.ts imports it; the pipeline config of the channel is in ../pipeline/*.json.
// Kits — every file kits/*.tsx with an export KIT, found by folder (lib/chapter/registry.ts): a new kit is a new file, this module does
// not change (docs/PARALLEL.md).
import type {ChannelModule} from '../../../lib/chapter/channel';
import {RequireContext, kitsOf} from '../../../lib/chapter/registry';
import {personFor} from './cast';
import {LineupCompositions} from './Lineup';

declare const require: {context: RequireContext};

const channel: ChannelModule = {
  id: 'example',
  kit: kitsOf(require.context('./kits', false, /\.tsx$/)),
  personFor,
  // a light HUD with a teal accent and round counter cells
  hud: {
    brand: 'SKINK DEMO', counterLabel: 'PART',
    theme: {bar: 'rgba(255,249,240,0.95)', barLine: '#E3D2B8', text: '#3B2A20', dim: '#9A8571', box: '#F4E9D8', boxLine: '#D9C4A4', accent: '#2A9D8F',
      panel: 'rgba(42,157,143,0.94)', panelText: '#FFFFFF', card: '#FFFDF8', cardText: '#3B2A20', round: true},
  },
  Compositions: LineupCompositions,
};

export default channel;
