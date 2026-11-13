// Channels of this project: each one is a folder channels/<id>/ with pipeline/*.json (config) and chapter/index.tsx (a ChannelModule).
// A new channel — one import and one entry here (docs/CHANNEL.md).
import type {ChannelModule} from '../lib/chapter/channel';
import example from '../channels/example/chapter';

export const CHANNELS: ChannelModule[] = [example];
