// Channel module of the example channel: what the engine needs to draw a chapter of this channel (lib/chapter/channel.ts).
// remotion/channels.ts imports it; the pipeline config of the channel is in ../pipeline/*.json.
import type {ChannelModule} from '../../../lib/chapter/channel';
import {personFor} from './cast';
import {CafeKit} from './kits/cafe';
import {CounterKit, counterCards} from './kits/counter';
import {LineupCompositions} from './Lineup';

const channel: ChannelModule = {
  id: 'example',
  kits: {cafe: CafeKit, counter: CounterKit},
  kitCards: {counter: counterCards},
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
