// Shared Remotion helpers of the node tools (render.mjs, stills.mjs, stage_layout.mjs, hands_check.mjs): CPU rasterisation, the project
// bundle and a shared browser for stills.
// renderStill without its own browser opens and closes Chrome for every frame (hundreds of launches for a frame journal) and now and then
// fails to connect to it. Here one browser per scale serves the whole run: it starts with one retry; if it does not start even after the
// retry, that is an environment error — a line "ENVIRONMENT: …" and exit code ENV_EXIT (stage_check.py and precheck.py print it apart
// from the staging errors).
import {bundle} from '@remotion/bundler';
import {openBrowser} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';

// rasterisation on the CPU in every tab instead of one SwiftShader GPU process for all tabs: Remotion adds --disable-gpu-rasterization only
// under this flag (docs/STACK.md); Remotion reads it at render time
process.env.__RESERVED_IS_INSIDE_REMOTION_LAMBDA = 'true';

/** Bundles remotion/index.ts of the current folder (the code copy, tools/mirror.py) into its own folder .bundle-<name>-<pid> there, not
 *  into the shared %TEMP%/remotion-webpack-bundle-* that another process may clean up mid-run; the folder (~46 MB) is removed on exit. */
export async function bundleProject(name) {
  const outDir = path.resolve(`.bundle-${name}-${process.pid}`);
  process.on('exit', () => fs.rmSync(outDir, {recursive: true, force: true}));
  return bundle({entryPoint: path.resolve('remotion/index.ts'), outDir});
}

export const ENV_EXIT = 3;
// ports Chrome does not open (net::ERR_UNSAFE_PORT): a frame server port 3100 + pid % … could land on 6000; the list — Chromium
// net/base/port_util.cc, from 3000
const UNSAFE = new Set([3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);
/** The first port of a block of n in a row where Chrome opens all of them: base, base + n, base + 2n… */
export function safePorts(base, n = 1) {
  let p = base;
  while (Array.from({length: n}, (_, k) => p + k).some((x) => UNSAFE.has(x))) p += n;
  return p;
}
const isEnv = (e) => /connect to the browser|Failed to launch the browser|Target closed|Session closed|Protocol error|browser has disconnected|ECONNREFUSED|ECONNRESET|socket hang up/i.test(String(e?.message ?? e));

/** Browsers by frame scale (forceDeviceScaleFactor — as renderStill does without its own browser: the frames are the same pixel for pixel). */
export function browsers(gl = 'swangle', openFn = openBrowser) {
  const open = new Map();
  const launch = async (scale) => {
    for (let k = 0; ; k++) {
      try {
        return await openFn('chrome', {chromiumOptions: {gl}, forceDeviceScaleFactor: scale});
      } catch (e) {
        if (k || !isEnv(e)) throw e;
        console.log(`the browser did not start (${String(e.message).split('\n')[0].slice(0, 160)}) — retrying`);
      }
    }
  };
  const get = (scale) => {
    if (!open.has(scale)) open.set(scale, launch(scale));
    return open.get(scale);
  };
  /** A renderStill frame on the shared browser; the browser dropped mid-run — a new browser and one retry of the frame. */
  const still = async (renderStill, opts) => {
    for (let k = 0; ; k++) {
      try {
        return await renderStill({...opts, puppeteerInstance: await get(opts.scale ?? 1)});
      } catch (e) {
        if (k || !isEnv(e)) throw e;
        console.log(`frame ${opts.frame}: browser connection (${String(e.message).split('\n')[0].slice(0, 160)}) — a new browser, retrying`);
        const b = open.get(opts.scale ?? 1);
        open.delete(opts.scale ?? 1);
        b?.then((x) => x.close({silent: true})).catch(() => {});
      }
    }
  };
  const close = async () => {
    for (const b of open.values()) await b.then((x) => x.close({silent: true})).catch(() => {});
    open.clear();
  };
  return {get, still, close};
}

/** Environment error (the browser did not start even after a retry) — a line "ENVIRONMENT: …" and code ENV_EXIT; otherwise
 *  — rethrown as is. */
export function envExit(e) {
  if (!isEnv(e)) throw e;
  console.log(`ENVIRONMENT: browser — ${String(e.message).split('\n')[0].slice(0, 300)}`);
  process.exit(ENV_EXIT);
}
