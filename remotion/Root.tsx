// Compositions of the project. For every channel in remotion/channels.ts:
//   <id>-chapter        — the chapter by timeline.json (tools/pipeline); length — from props
//   <id>-chapter-stage  — the chapter with the frame journal (service): tools/stage_layout.mjs, staging layout checks
//   <id>-chapter-hands  — the chapter with hands filled with a marker colour (service): hand crop sheets, tools/hands_sheet.py
//   <id>-chapter-poses  — the chapter with the arm pose journal (service): tools/hands_check.mjs
// plus the channel's own compositions (ChannelModule.Compositions: cast lineup, face sheets…).
import React from 'react';
import {Composition, Folder} from 'remotion';
import {Chapter, ChapterHands, ChapterPoses, ChapterStage, EMPTY_TIMELINE} from '../lib/chapter/Chapter';
import {ChannelCtx, ChannelModule} from '../lib/chapter/channel';
import {Timeline} from '../lib/chapter/types';
import {CHANNELS} from './channels';

type ChapterProps = React.ComponentProps<typeof Chapter>;

const wrap = (ch: ChannelModule, C: React.FC<ChapterProps>): React.FC<ChapterProps> => {
  const W: React.FC<ChapterProps> = (props) => (
    <ChannelCtx.Provider value={ch}>
      <C {...props} />
    </ChannelCtx.Provider>
  );
  W.displayName = `${ch.id}:${C.displayName ?? C.name}`;
  return W;
};

const KINDS: [string, React.FC<ChapterProps>][] = [['chapter', Chapter], ['chapter-stage', ChapterStage], ['chapter-hands', ChapterHands], ['chapter-poses', ChapterPoses]];

// components are made once per channel: Remotion expects stable component references
const PER_CHANNEL = CHANNELS.map((ch) => ({ch, kinds: KINDS.map(([kind, C]) => [kind, wrap(ch, C)] as const)}));

const meta = ({props}: {props: Record<string, unknown>}) => {
  const tl = props.timeline as Timeline;
  return {durationInFrames: Math.max(1, tl.frames), fps: tl.fps, width: tl.width || 1920, height: tl.height || 1080};
};

export const Root: React.FC = () => (
  <>
    {PER_CHANNEL.map(({ch, kinds}) => (
      <Folder key={ch.id} name={ch.id}>
        {kinds.map(([kind, C]) => (
          <Composition key={kind} id={`${ch.id}-${kind}`} component={C} defaultProps={{timeline: EMPTY_TIMELINE}} fps={30} width={1920} height={1080}
            durationInFrames={30} calculateMetadata={meta} />
        ))}
        {/* a composition component renders outside this tree: channel compositions wrap themselves in ChannelCtx */}
        {ch.Compositions && <ch.Compositions />}
      </Folder>
    ))}
  </>
);
