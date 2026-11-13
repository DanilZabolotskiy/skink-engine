// Frame journal of the staging layer (docs/STAGING.md, "Frame journal"): what stands where in the finished frame, for the automatic layout
// checks. The frame list and the rules are in tools/pipeline/stage_check.py (layout_jobs, layout_checks); the check and precheck steps run
// this script.
//
// node tools/stage_layout.mjs <layout_jobs.json>      (run from the code copy: cd "$(python tools/mirror.py)")
//   layout_jobs.json: {"timeline": "<path to timeline.json>", "out": "<path to layout.json>", "jobs": [{"shot": "02.01", "frame": 160,
//   "why": ["mid"]}, …], "png_dir": "<folder>", "png_scale": 0.5, "workers": 2}
// Renders frames of the service composition <channel>-chapter-stage (the chapter with the journal: lib/staging/journal.tsx writes
// "STAGE …" lines to the browser console by the data-stage marks) at a small scale — the journal coordinates stay in frame pixels — and
// collects the journal into layout.json: [{frame, shot, why, bar, cards, heads, figs, lines, reads, hits, …}, …].
// --png <folder> — also save the frames themselves at full size, to look at what the check complains about. Frames of jobs with "png":
// true are saved to png_dir (f_<frame>.png, scale png_scale): pixels for the "event without a visible change" check; the rest are
// rendered small. One browser per scale for the whole run (tools/remotion.mjs), frames in "workers" pages at once (default 1).
// Exit code: 0 — the whole journal, 1 — some frames without a journal, 3 — the browser did not start even after a retry (the
// environment, not staging).
import {renderStill, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browsers, bundleProject, envExit, safePorts} from './remotion.mjs';

const args = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(args[0], 'utf-8'));
const pngDir = args.includes('--png') ? path.resolve(args[args.indexOf('--png') + 1]) : null;
if (pngDir) fs.mkdirSync(pngDir, {recursive: true});
const jobPng = spec.png_dir ? path.resolve(spec.png_dir) : null;
if (jobPng) fs.mkdirSync(jobPng, {recursive: true});
const timeline = JSON.parse(fs.readFileSync(spec.timeline, 'utf-8'));
const inputProps = {timeline};
const t0 = Date.now();
const serveUrl = await bundleProject('stage');
// an own frame server port for every page (spec.workers, up to 4): parallel journals and renders on the same port break each other's
// connections, and renderStill starts a server per frame, so two pages cannot share one port
const workers = Math.min(4, Math.max(1, spec.workers ?? 1));
const port = safePorts(3100 + (process.pid % 500) * 4, workers);
// one browser per scale for the whole run (tools/remotion.mjs): a launch with a retry; if it does not start — an environment error, code 3
const br = browsers('swangle');
const journal = [];
let fails = 0;
try {
const composition = await selectComposition({serveUrl, id: `${timeline.channel}-chapter-stage`, inputProps, chromiumOptions: {gl: 'swangle'}, port, puppeteerInstance: await br.get(0.2)});
// frames — in turn in workers pages (spec.workers, default 1); the journal of each frame — from the console of its page
const res = new Array(spec.jobs.length);
let next = 0;
const one = async (w) => {
  const tmp = path.join(os.tmpdir(), `skink-stage-layout-${process.pid}-${w}.png`);
  for (let i = next++; i < spec.jobs.length; i = next++) {
    const job = spec.jobs[i];
    const parts = {chunks: [], n: 0};
    const onBrowserLog = (log) => {
      const m = log.text.match(/^STAGE (\d+) (\d+)\/(\d+) ([\s\S]*)$/);
      if (!m || Number(m[1]) !== job.frame) return;
      if (Number(m[2]) === 1) parts.chunks = []; // a repeated render of the same frame — the journal starts over
      parts.chunks[Number(m[2]) - 1] = m[4];
      parts.n = Number(m[3]);
    };
    const keep = jobPng && job.png && !pngDir;
    const output = pngDir ? path.join(pngDir, `l_${job.shot.replace('.', '_')}_${job.frame}.png`) : keep ? path.join(jobPng, `f_${job.frame}.png`) : tmp;
    const scale = pngDir ? 1 : keep ? (spec.png_scale ?? 0.5) : 0.2;
    await br.still(renderStill, {composition, serveUrl, output, frame: job.frame, inputProps, chromiumOptions: {gl: 'swangle'}, port: port + w, onBrowserLog, scale});
    try {
      if (!parts.n || parts.chunks.filter(Boolean).length !== parts.n) throw new Error('the frame journal did not arrive in full');
      res[i] = {...JSON.parse(parts.chunks.join('')), why: job.why};
    } catch (e) {
      fails++;
      console.log(`frame ${job.frame} (${job.shot}): ${e.message}`);
    }
  }
  if (!pngDir) fs.rmSync(tmp, {force: true});
};
await Promise.all(Array.from({length: workers}, (_, w) => one(w)));
journal.push(...res.filter(Boolean));
} catch (e) {
  await br.close();
  envExit(e);
} finally {
  await br.close();
}
fs.writeFileSync(spec.out, JSON.stringify(journal));
console.log(`frame journal: ${journal.length} frames of ${spec.jobs.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s → ${spec.out}`);
process.exit(fails ? 1 : 0);
