// Chapter render in pieces (scenes) without sound: node tools/render.mjs <jobs.json>
// jobs.json: {"composition": "<channel>-chapter", "timeline": "<path>", "concurrency": 8, "crf": 18, "scale": 1,
//             "jobs": [{"name": "s01", "from": 0, "to": 188, "out": "<path>.mp4"}, …]}
// Run from the project copy in %TEMP% (tools/mirror.py; docs/STACK.md, "Render").
// One bundle for all pieces; each piece is a separate mp4 h264 yuv420p bt709 CRF 18, frames [from, to] inclusive.
// scale 2 — the 3840×2160 episode master: the frame is drawn anew at double resolution (sharp vectors), not an upscale of 1080.
import {renderMedia, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import {bundleProject} from './remotion.mjs';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const timeline = JSON.parse(fs.readFileSync(spec.timeline, 'utf8'));
const inputProps = {timeline};
const t0 = Date.now();
const serveUrl = await bundleProject('render');
console.log(`bundle ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const composition = await selectComposition({serveUrl, id: spec.composition ?? `${timeline.channel}-chapter`, inputProps, chromiumOptions: {gl: 'swangle'}});
for (const job of spec.jobs) {
  const t1 = Date.now();
  const tmp = job.out + '.part.mp4';
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: tmp, frameRange: [job.from, job.to], muted: true,
    pixelFormat: 'yuv420p', colorSpace: 'bt709', crf: spec.crf ?? 18, scale: spec.scale ?? 1, concurrency: spec.concurrency ?? 4,
    chromiumOptions: {gl: 'swangle'}, logLevel: 'error',
  });
  fs.renameSync(tmp, job.out);
  const n = job.to - job.from + 1;
  const s = (Date.now() - t1) / 1000;
  console.log(`${job.name}: ${n} frames, ${s.toFixed(1)}s (${(s / (n / composition.fps)).toFixed(2)} s per 1 s)`);
}
