// node tools/stills.mjs <composition> <prefix> <frame,frame…> [props.json] — frames without assembling a video
// props.json — input props of the composition (for <channel>-chapter — the chapter timeline.json: {"timeline": …} or the timeline itself).
import {renderStill, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import {bundleProject} from './remotion.mjs';
const [comp, prefix, frames, propsFile] = process.argv.slice(2);
let inputProps = {};
if (propsFile) {
  const j = JSON.parse(fs.readFileSync(propsFile, 'utf-8'));
  inputProps = j.shots && j.fps ? {timeline: j} : j;
}
const serveUrl = await bundleProject('stills');
const composition = await selectComposition({serveUrl, id: comp, inputProps, chromiumOptions: {gl: 'swangle'}});
for (const fr of frames.split(',').map(Number)) {
  const t0 = Date.now();
  await renderStill({composition, serveUrl, output: `${prefix}_${fr}.png`, frame: fr, inputProps, chromiumOptions: {gl: 'swangle'}});
  console.log(fr, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
