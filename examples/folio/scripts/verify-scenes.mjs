#!/usr/bin/env node
// verify-scenes.mjs — the pinned scenes on / and /blocks, against the production build, in Chromium and WebKit:
//
//   verify-motion  the skill's scripts/tools/verify-motion.mjs --scenes --reveal on / and /blocks at 1440x900 and
//                  390x844, unmodified. Its scene check passes once any state is written; every scene here holds its
//                  ends, so each one is also held to head, scrub, scrub, scrub, tail at progress 0, 1/4, 1/2, 3/4, 1.
//   reduced        under emulated reduced motion, / shows the poster and no pin: the pin is released and scrolls with
//                  the page, and the video sits on its poster, never played, while the scene stays in head.
//   playhead       with motion, the video on / follows its band: the first frame, the middle, the last frame, from
//                  the tier the viewport picks (window.__scrub() under ?motion-debug).
//
// verify-motion only launches Chromium. For WebKit it runs from a scratch directory whose `playwright` is a shim
// handing it WebKit under the name it asks for.
//
// Pages are prerendered, so a build made before `pnpm media` holds placeholders: missing media is fetched first,
// and the build is made when there is none or the media just arrived. Starts `next start` on a free port and always
// stops it.
//
//   node scripts/verify-scenes.mjs [--browsers chromium,webkit]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, webkit } from "playwright";
import { nextBuild, startServer, stopServer } from "./lib/next-server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINES = { chromium, webkit };
const VERIFY_MOTION = join(root, "..", "..", "skills", "scroll-animation", "scripts", "tools", "verify-motion.mjs");
const OUT = join(root, "test-results", "verify-scenes");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844, isMobile: true, hasTouch: true },
];
// Each route and the scenes it must have: verify-motion passes a page with none.
const ROUTES = { "/": 1, "/blocks": 2 };
const HELD = ["head", "scrub", "scrub", "scrub", "tail"];
const MEDIA = [
  "hero/scrub-camera-1920.mp4",
  "hero/scrub-camera-1080.mp4",
  "hero/scrub-camera-poster.avif",
  "blocks/camera-sequence/manifest.json",
  "blocks/camera-sequence/mobile/manifest.json",
  "journal/rust-loop.mp4",
  "journal/rust-loop-poster.avif",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const size = (vp) => `${vp.width}x${vp.height}`;

function parseArgs(argv) {
  const out = { browsers: Object.keys(ENGINES) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--browsers") out.browsers = argv[++i].split(",");
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  for (const b of out.browsers) if (!ENGINES[b]) throw new Error(`unknown browser: ${b}`);
  return out;
}

// ── media and build ─────────────────────────────────────────────────────

const missingMedia = () => MEDIA.filter((rel) => !existsSync(join(root, "public", "media", rel)));

/** Fetches the media if any is missing; true when it did. */
function ensureMedia() {
  const missing = missingMedia();
  if (!missing.length) return false;
  console.log(`[verify-scenes] media missing (${missing.join(", ")}): fetching it`);
  const res = spawnSync(process.execPath, [join(root, "scripts", "fetch-media.mjs")], { cwd: root, stdio: "inherit" });
  if (res.status !== 0 || missingMedia().length) throw new Error("pnpm media failed; see its output above");
  return true;
}

/** Throws unless the served pages reference the media (a build from before `pnpm media` doesn't). */
async function assertBuildHasMedia(base) {
  const html = await (await fetch(`${base}/`)).text();
  if (!html.includes('data-src="/media/hero/scrub-camera-1920.mp4"')) {
    throw new Error("the build shows media placeholders (built before `pnpm media`?): run `pnpm build` again");
  }
}

// ── verify-motion ───────────────────────────────────────────────────────

/** A scratch cwd whose `playwright` hands verify-motion WebKit when it asks for chromium. */
function webkitShim() {
  const dir = mkdtempSync(join(tmpdir(), "verify-scenes-webkit-"));
  const pkg = join(dir, "node_modules", "playwright");
  mkdirSync(pkg, { recursive: true });
  const real = pathToFileURL(createRequire(import.meta.url).resolve("playwright")).href;
  writeFileSync(join(dir, "package.json"), "{}\n");
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "playwright", type: "module", main: "index.js" }));
  writeFileSync(
    join(pkg, "index.js"),
    `import playwright from ${JSON.stringify(real)};\n` +
      `console.log("[verify-scenes] playwright shim: verify-motion's chromium is " + playwright.webkit.name());\n` +
      `export const chromium = playwright.webkit;\n`,
  );
  return dir;
}

function runVerifyMotion(name, route, url, cwd, line) {
  const out = join(OUT, name, route === "/" ? "home" : route.slice(1));
  rmSync(out, { recursive: true, force: true });
  const viewports = VIEWPORTS.map(size).join(",");
  console.log(`\n── verify-motion ${name} ${route} ─────────────────────────────────`);
  const res = spawnSync(
    process.execPath,
    [VERIFY_MOTION, url, "--scenes", "--reveal", "--viewports", viewports, "--out", out],
    { cwd, stdio: "inherit" },
  );
  line(res.status === 0, `verify-motion ${route} --scenes --reveal (${viewports})`, `exit ${res.status}`);
  if (!existsSync(join(out, "report.json"))) return;

  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  for (const v of report.viewports) {
    const { scenes, reveal } = v.checks;
    const sequences = scenes.scenes.map((s) => s.steps.map((step) => step.motionState));
    line(
      scenes.total === ROUTES[route] && sequences.every((seq) => seq.join() === HELD.join()),
      `${route} ${v.width}x${v.height}: ${ROUTES[route]} scene(s), each ${HELD.join(" > ")}`,
      `${scenes.total} found: ${sequences.map((seq) => seq.join(" > ")).join(" | ")} · reveal items ${reveal.total}`,
    );
  }
}

// ── in the page ─────────────────────────────────────────────────────────

/** Reduced motion on /: the pin released, the poster held. */
async function checkReduced(browser, base, vp, line) {
  const { isMobile, hasTouch, ...viewport } = vp;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    window.__played = 0;
    document.addEventListener("playing", () => window.__played++, true);
  });
  let posterLoaded = false;
  let videoBytes = 0;
  const page = await context.newPage();
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path === "/media/hero/scrub-camera-poster.avif" && r.ok()) posterLoaded = true;
    if (/^\/media\/hero\/scrub-camera-\d+\.mp4$/.test(path)) videoBytes += Number(r.headers()["content-length"] ?? 0);
  });
  try {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const r = await page.evaluate(async () => {
      const settle = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100)));
      const scene = document.querySelector("[data-scene-root]");
      const pin = scene.querySelector("[data-scene-pin]");
      const video = scene.querySelector("video[data-scene-media]");
      const top = scene.getBoundingClientRect().top + scrollY;
      const states = new Set([scene.dataset.sceneState]);
      // Half a viewport into the scene, a pinned scene holds its pin at the top of the viewport.
      scrollTo(0, top + innerHeight / 2);
      await settle();
      const pinTop = pin.getBoundingClientRect().top;
      for (let y = top; y <= top + scene.offsetHeight; y += innerHeight / 2) {
        scrollTo(0, y);
        await settle();
        states.add(scene.dataset.sceneState);
      }
      scrollTo(0, top);
      await settle();
      return {
        position: getComputedStyle(pin).position,
        runway: getComputedStyle(scene.querySelector("[data-scene-content]")).marginTop,
        pinTop: Math.round(pinTop),
        expectedTop: Math.round(-innerHeight / 2),
        states: [...states],
        poster: video?.getAttribute("poster") ?? null,
        paused: video?.paused ?? null,
        time: video?.currentTime ?? null,
        played: window.__played,
      };
    });
    line(
      r.position !== "sticky" && Math.abs(r.pinTop - r.expectedTop) <= 2 && r.runway === "0px",
      `/ ${size(vp)} reduced motion: no pin`,
      `pin ${r.position}, top ${r.pinTop} half a viewport in (pinned: 0, released: ${r.expectedTop}), content margin ${r.runway}`,
    );
    line(
      posterLoaded &&
        r.poster?.endsWith("/scrub-camera-poster.avif") &&
        r.paused === true &&
        r.time === 0 &&
        r.played === 0 &&
        r.states.join() === "head",
      `/ ${size(vp)} reduced motion: shows the poster`,
      `poster ${r.poster} ${posterLoaded ? "loaded" : "NOT loaded"}, video paused=${r.paused} t=${r.time} played ${r.played}x, states ${r.states.join(",")}; ${(videoBytes / 1e6).toFixed(1)} MB of video fetched anyway`,
    );
  } finally {
    await context.close();
  }
}

/** With motion, the video on / lands on the band's frame at progress 0, 1/2 and 1. */
async function checkPlayhead(browser, base, vp, line) {
  const { isMobile, hasTouch, ...viewport } = vp;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, reducedMotion: "no-preference" });
  try {
    const page = await context.newPage();
    await page.goto(`${base}/?motion-debug`, { waitUntil: "networkidle" });
    const samples = [];
    for (const p of [0, 0.5, 1]) {
      await page.evaluate((p) => {
        const scene = document.querySelector("[data-scene-root]");
        const top = scene.getBoundingClientRect().top + scrollY;
        scrollTo(0, top + (scene.offsetHeight - innerHeight) * p);
      }, p);
      // The glide settles within half a frame of its target; give it up to 5 s.
      let snap = null;
      for (let waited = 0; waited < 5000; waited += 100) {
        await sleep(100);
        snap = await page.evaluate(() => {
          const [s] = window.__scrub?.() ?? [];
          const src = document.querySelector("[data-scene-root] video")?.currentSrc ?? "";
          return s ? { mode: s.video.mode, tier: s.video.tier, target: s.video.target, time: s.video.time, duration: s.video.duration, src: src.split("/").pop() } : null;
        });
        if (snap?.duration && Math.abs(snap.time - snap.target) < 1 / 30) break;
      }
      samples.push({ p, ...snap });
    }
    const [head, mid, tail] = samples;
    const frame = 1 / 30;
    const tier = vp.width >= 1024 ? "desktop" : "mobile";
    const file = tier === "desktop" ? "scrub-camera-1920.mp4" : "scrub-camera-1080.mp4";
    const ok =
      samples.every((s) => s.duration && Math.abs(s.time - s.target) <= frame && s.tier === tier && s.src === file) &&
      head.mode === "head" &&
      head.target === 0 &&
      mid.mode === "scrub" &&
      mid.target > 0.25 * mid.duration &&
      mid.target < 0.75 * mid.duration &&
      tail.mode === "tail" &&
      Math.abs(tail.target - (tail.duration - frame)) <= frame;
    line(
      ok,
      `/ ${size(vp)} the playhead follows the band`,
      `${samples.map((s) => `p ${s.p}: ${s.mode} ${s.time}s (target ${s.target}s)`).join(", ")} of ${head.duration}s · ${head.tier} ${head.src}`,
    );
  } finally {
    await context.close();
  }
}

// ── main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fetched = ensureMedia();
  if (fetched || !existsSync(join(root, ".next", "BUILD_ID"))) {
    console.log("[verify-scenes] next build");
    if (nextBuild(root) !== 0) throw new Error("next build failed");
  }

  let failures = 0;
  let server = null;
  let browser = null;
  let shim = null;
  const shutdown = async () => {
    await browser?.close().catch(() => {});
    await stopServer(server?.child);
    if (shim) rmSync(shim, { recursive: true, force: true });
  };
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      await shutdown();
      process.exit(130);
    });
  }
  const results = [];
  try {
    server = await startServer(root);
    await assertBuildHasMedia(server.base);
    for (const name of args.browsers) {
      const line = (ok, what, detail) => {
        if (!ok) failures++;
        results.push(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(8)}  ${what}${detail ? `  (${detail})` : ""}`);
      };
      const cwd = name === "webkit" ? (shim ??= webkitShim()) : root;
      for (const route of Object.keys(ROUTES)) runVerifyMotion(name, route, server.base + route, cwd, line);

      browser = await ENGINES[name].launch();
      for (const vp of VIEWPORTS) {
        await checkReduced(browser, server.base, vp, line);
        await checkPlayhead(browser, server.base, vp, line);
      }
      await browser.close();
      browser = null;
    }
  } finally {
    await shutdown();
  }
  console.log(`\n── verify-scenes ─────────────────────────────────────────────────`);
  for (const r of results) console.log(r);
  console.log(`\nscreenshots and reports: ${OUT}`);
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[verify-scenes] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
