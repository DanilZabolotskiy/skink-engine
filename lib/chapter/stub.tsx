// The default kit for a location the channel has not drawn yet (kit: null in channel.json).
import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {FONT_KR} from '../hud/hud';
import {Figure, StubTag} from './figure';
import {KitProps} from './types';

/** Location without a kit: a grey wall and floor, a large "STUB" mark, the shot description, the cast as figures with name tags. */
export const StubKit: React.FC<KitProps & {about?: string}> = ({shot, lt, f, about}) => {
  const {width: W, height: H} = useVideoConfig();
  const dur = shot.end - shot.start;
  const n = shot.cast.length;
  const ppm = H / 3;
  return (
    <AbsoluteFill style={{background: '#4A4C52', overflow: 'hidden'}}>
      <div style={{position: 'absolute', left: 0, right: 0, top: H * 0.64, bottom: 0, background: '#2A2B30', borderTop: '8px solid #0A0C10'}} />
      {shot.cast.map((m, k) => {
        const x = W * (n === 1 ? 0.5 : 0.3 + (0.4 * k) / Math.max(1, n - 1));
        const y = H * 0.89;
        return (
          <React.Fragment key={m.who}>
            <Figure m={m} x={x} y={y} ppm={ppm} f={f} lt={lt} dur={dur} gazeY={0.3} tag={false} />
            <StubTag x={x} y={y - ppm * 1.78} text={m.stub ? `${m.who} · stub figure` : m.who} />
          </React.Fragment>
        );
      })}
      <div style={{position: 'absolute', left: 40, bottom: 200, maxWidth: W * 0.57, fontFamily: FONT_KR, color: '#F2F2F2'}}>
        <div style={{display: 'inline-block', background: '#FFE14D', color: '#111', border: '4px solid #111', fontSize: 40, fontWeight: 900, padding: '4px 18px'}}>
          STUB · location "{shot.location}"
        </div>
        {about && <div style={{fontSize: 26, marginTop: 10, opacity: 0.85}}>{about}</div>}
        <div style={{fontSize: 24, marginTop: 14, opacity: 0.75, lineHeight: 1.35}}>{shot.id} · {shot.camera}<br />{shot.on_screen}</div>
      </div>
    </AbsoluteFill>
  );
};
