#!/usr/bin/env node
// verify-scenes.mjs — the motion on /, /journal/<slug> and /blocks, against the production build, in Chromium and
// WebKit at 1440x900 and 390x844, plus Firefox on the article:
//
//   verify-motion  the skill's scripts/tools/verify-motion.mjs --scenes --reveal --browser <name> on /, the article and
//                  /blocks, unmodified. It checks the states run head > scrub > tail in order and every reveal item
//                  ends visible; every scene here holds its ends, so each one is also held to the exact head, scrub,
//                  scrub, scrub, tail at progress 0, 1/4, 1/2, 3/4, 1 (the orbit and the rail on /; the rail, the
//                  sequence and the scrub fixtures on /blocks).
//   hero           the served HTML of / holds the split headline (word spans, the sentence in a visually hidden copy),
//                  its accessible name is the sentence, and with JavaScript off the words still rise and land (and
//                  the rail's track is a native scroller with every panel in reach); with it on, the load shifts
//                  nothing: CLS under 0.01 (Chromium's Layout Instability API) and the content below the headline
//                  never moves (every engine).
//   entrances      on / and the article, every Reveal item is shown, opaque and untransformed after a step-scroll
//                  through the page; under reduced motion everything is visible and still from the start (items
//                  shown, no word animations, nothing running at any step of the scroll).
//   rail           on /, the rail's track moves with scroll (0 at its start, half its travel mid-way, flush with the
//                  pin at its end, the pin held at the top); under reduced motion there is no pin and no runway, and
//                  the track is a focusable native horizontal snap scroller.
//   header ink     on /, the header's ink is dark-paper over the dark section and ink again once it is back above it.
//   progress       on the article, the reading-progress bar's scale follows the scroll at 0, 1/4, 1/2, 3/4 and 1.
//   reduced        under emulated reduced motion, / shows the poster and no pin: the pin is released and scrolls with
//                  the page, the video sits on its poster, never played, while the scene stays in head, and not one
//                  byte of video is fetched.
//   playhead       with motion, the video on / follows its band: the first frame, the middle, the last frame, from
//                  the tier the viewport picks (window.__scrub() under ?motion-debug).
//   firefox        the article in Firefox, which has no scroll-driven animations: verify-motion --reveal, then the
//                  static fallback: every entrance shown, the parallax image in place with nothing attached, the
//                  progress bar not drawn, and no text or image left hidden (but the scrolly states not shown); and
//                  the scrolly section as below.
//   scrolly        the article's scrolly-steps section: sticky at 1440, each step activating its own state, the two
//                  detail steps panning to their own frames, back up to the first, a pan left for a frameless step
//                  still landing, a reload on a step landing on its frame without a pan (the pan's transform read
//                  two frames apart: Motion's JS-driven pan isn't in getAnimations()), no picture the page doesn't already load; stacked at 390 with each step's
//                  figure in flow; under reduced motion still sticky, the swap and the pan instant.
//   transition     at 1440, client-side: / -> /journal -> the rust card (a "forward" view transition with the
//                  cover's ::view-transition-group, the header's group named and never animated, the article at the
//                  top) -> the browser's back (no transition, the index where it was left) -> the card again -> the
//                  article's "Journal" breadcrumb (a "back" transition: the cover morphs back, vt-back slides) -> /, the live
//                  ScrollTriggers back to their first count (window.__triggers under ?motion-debug), one authority
//                  at every step.
//   lab            /lab's real-time scene (Chromium + SwiftShader; WebKit and Firefox without WebGL): the poster as
//                  LCP and three after it, the chapters on the scroll, every frame that moves the scene drawn in that
//                  frame (on load, and after reduced motion on and off re-creates Lenis), 0 renders at rest, off
//                  screen and hidden, back/forward and reload, reduced motion live, a lost context, no WebGL.
//
// Pages are prerendered, so a build made before `pnpm media` holds placeholders: missing media is fetched first,
// and the build is made when there is none or the media just arrived. Starts `next start` on a free port and always
// stops it.
//
//   node scripts/verify-scenes.mjs [--browsers chromium,webkit,firefox] [--only lab]

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium, firefox, webkit } from "playwright";
import { nextBuild, startServer, stopServer } from "./lib/next-server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINES = { chromium, webkit, firefox };
// Firefox runs the article only: it is the engine without scroll-driven animations, so it shows the static fallback.
const FULL = new Set(["chromium", "webkit"]);
const VERIFY_MOTION = join(root, "..", "..", "skills", "scroll-animation", "scripts", "tools", "verify-motion.mjs");
const OUT = join(root, "test-results", "verify-scenes");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844, isMobile: true, hasTouch: true },
];
const ARTICLE = "/journal/what-rust-is-for";
// Each route and the scenes it must have: verify-motion passes a page with none.
const ROUTES = { "/": 2, [ARTICLE]: 0, "/lab": 1, "/blocks": 3 };
const HEADLINE = "Things, made well.";
// #211d18 and #f4f0e9 (globals.css): the header's ink over paper and over the dark section.
const INK = "rgb(33, 29, 24)";
const DARK_PAPER = "rgb(244, 240, 233)";
const HELD = ["head", "scrub", "scrub", "scrub", "tail"];
const MEDIA = [
  "hero/scrub-camera-1920.mp4",
  "hero/scrub-camera-1080.mp4",
  "hero/scrub-camera-poster.avif",
  "blocks/camera-sequence/manifest.json",
  "blocks/camera-sequence/mobile/manifest.json",
  "journal/rust-loop.mp4",
  "journal/rust-loop-poster.avif",
  "journal/rust-cover.avif",
  "journal/rust-detail.avif",
  "objects/stoneware-vessel.avif",
  "objects/glass-shade.avif",
  "lab/camera-poster.avif",
  "lab/antique-camera.glb",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const size = (vp) => `${vp.width}x${vp.height}`;

function parseArgs(argv) {
  const out = { browsers: Object.keys(ENGINES), only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--browsers") out.browsers = argv[++i].split(",");
    else if (argv[i] === "--only" && argv[i + 1] === "lab") out.only = argv[++i];
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

function runVerifyMotion(name, route, url, line) {
  const out = join(OUT, name, route === "/" ? "home" : route.slice(1).replaceAll("/", "-"));
  rmSync(out, { recursive: true, force: true });
  const viewports = VIEWPORTS.map(size).join(",");
  console.log(`\n── verify-motion ${name} ${route} ─────────────────────────────────`);
  const res = spawnSync(
    process.execPath,
    [VERIFY_MOTION, url, "--scenes", "--reveal", "--browser", name, "--viewports", viewports, "--out", out],
    { cwd: root, stdio: "inherit" },
  );
  line(res.status === 0, `verify-motion ${route} --scenes --reveal (${viewports})`, `exit ${res.status}`);
  if (!existsSync(join(out, "report.json"))) return;

  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  for (const v of report.viewports) {
    const { scenes, reveal } = v.checks;
    const sequences = scenes.scenes.map((s) => s.steps.map((step) => step.motionState));
    line(
      scenes.total === ROUTES[route] &&
        sequences.every((seq) => seq.join() === HELD.join()) &&
        reveal.verdict !== "fail",
      `${route} ${v.width}x${v.height}: ${ROUTES[route] ? `${ROUTES[route]} scene(s), each ${HELD.join(" > ")}` : "no scenes"}; reveals end visible`,
      `${scenes.total} found${sequences.length ? `: ${sequences.map((seq) => seq.join(" > ")).join(" | ")}` : ""} · reveal ${reveal.verdict}, ${reveal.total} items${reveal.hidden?.length ? `, hidden: ${reveal.hidden.map((h) => h.selector).join(" ")}` : ""}`,
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
        r.states.join() === "head" &&
        videoBytes === 0,
      `/ ${size(vp)} reduced motion: shows the poster and fetches no video`,
      `poster ${r.poster} ${posterLoaded ? "loaded" : "NOT loaded"}, video paused=${r.paused} t=${r.time} played ${r.played}x, states ${r.states.join(",")}; ${videoBytes} B of video fetched`,
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

// ── Phase 3: text, entrances, rail, header ink, progress ─────────────────

/** A page in its own context. `motion`: "reduce" or "no-preference"; `js`: false turns JavaScript off. */
async function openPage(browser, vp, { motion = "no-preference", js = true, init } = {}) {
  const { isMobile, hasTouch, ...viewport } = vp;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, reducedMotion: motion, javaScriptEnabled: js });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, errors };
}

/** Steps down the whole page at 60% of a viewport, a frame and 200 ms a step (IntersectionObserver needs both), then
 * lets the last entrances land. `onStep` runs in the page after every step; its results come back as a list. */
async function scrollThrough(page, onStep) {
  const steps = await page.evaluate(async (onStepSource) => {
    const onStep = onStepSource ? new Function(`return (${onStepSource})`)() : null;
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 200)));
    const results = [];
    const max = () => document.documentElement.scrollHeight - innerHeight;
    for (let y = 0; y < max(); y += Math.round(innerHeight * 0.6)) {
      scrollTo(0, y);
      await settle();
      if (onStep) results.push(onStep());
    }
    scrollTo(0, max());
    await settle();
    if (onStep) results.push(onStep());
    return results;
  }, onStep ? onStep.toString() : null);
  await sleep(1600);
  return steps;
}

/** Every Reveal item: shown, opaque and untransformed, or listed. */
const readReveals = (page) =>
  page.evaluate(() => {
    const items = [...document.querySelectorAll("[data-reveal-item]")];
    const bad = [];
    for (const el of items) {
      const cs = getComputedStyle(el);
      const still = cs.transform === "none" || cs.transform === "matrix(1, 0, 0, 1, 0, 0)";
      const clipped = cs.clipPath !== "none";
      if (el.getAttribute("data-reveal-state") !== "shown" || Number(cs.opacity) < 0.999 || !still || clipped) {
        const name = el.id ? `#${el.id}` : `"${el.textContent.trim().slice(0, 24)}"`;
        bad.push(`${el.tagName.toLowerCase()}${name} state=${el.getAttribute("data-reveal-state")} opacity=${cs.opacity} ${cs.transform}`);
      }
    }
    return { total: items.length, bad };
  });

/** The headline's words: animations still attached, and any not at rest. */
const readWords = (page) =>
  page.evaluate(() => {
    const words = [...document.querySelectorAll("[data-split-word]")];
    return {
      total: words.length,
      animations: words.reduce((n, w) => n + w.getAnimations().length, 0),
      unsettled: words.filter((w) => {
        const cs = getComputedStyle(w);
        return Number(cs.opacity) < 0.999 || (cs.transform !== "none" && cs.transform !== "matrix(1, 0, 0, 1, 0, 0)");
      }).length,
    };
  });

/** The served HTML of /: the headline split on the server, the sentence kept whole for its name. Browser-independent. */
async function checkHeroHtml(base, line) {
  const html = await (await fetch(`${base}/`)).text();
  const h1 = /<h1\b[^>]*\bdata-split-words=""[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
  const copy = /<span data-split-copy="">([^<]*)<\/span>/.exec(h1)?.[1];
  const hidden = /<span aria-hidden="true">([\s\S]*)<\/span>$/.exec(h1)?.[1] ?? "";
  const words = [...hidden.matchAll(/<span data-split-word="" style="--i:(\d+)">([^<]*)<\/span>/g)];
  const expected = HEADLINE.split(" ");
  line(
    copy === HEADLINE &&
      words.length === expected.length &&
      words.every(([, i, word], k) => Number(i) === k && word === expected[k]),
    "served HTML of /: the headline split into word spans, the sentence whole in its copy",
    `copy "${copy}", words ${words.map(([, i, w]) => `${i}:${w}`).join(" ") || "none"}`,
  );
}

/** With JavaScript off, the headline still rises and lands, and the hero's entrances have no hidden state. */
async function checkHeroNoJs(browser, base, vp, line) {
  const { context, page } = await openPage(browser, vp, { js: false });
  try {
    await page.goto(`${base}/`, { waitUntil: "load" });
    const early = await page.evaluate(() =>
      document.getAnimations().filter((a) => /^split-word-/.test(a.animationName)).length,
    );
    await sleep(2200);
    const words = await readWords(page);
    const name = await page.locator("h1").ariaSnapshot();
    const hero = await page.evaluate(() =>
      [...document.querySelectorAll('[data-reveal="mount"] [data-reveal-item]')].map((el) => getComputedStyle(el).opacity),
    );
    line(
      early > 0 &&
        words.total === 3 &&
        words.unsettled === 0 &&
        name.includes(`heading "${HEADLINE}" [level=1]`) &&
        hero.length === 2 &&
        hero.every((o) => o === "1"),
      `/ ${size(vp)} JavaScript off: the headline rises by CSS alone and lands, named "${HEADLINE}"`,
      `${early} word animations at load, ${words.unsettled}/${words.total} words not at rest after 2.2 s · ${name.trim()} · eyebrow and standfirst opacity ${hero.join(", ")}`,
    );
    // No rail runs, so no runway and no translate: the track itself has to scroll, or the last panels are cut off.
    // Wait in Node, not in the page: with JavaScript off, a timer set by evaluated code never fires.
    await page.evaluate(() => {
      const track = document.querySelector("[data-rail] [data-rail-track]");
      track.scrollLeft = track.scrollWidth;
    });
    await sleep(300);
    const rail = await page.evaluate(() => {
      const track = document.querySelector("[data-rail] [data-rail-track]");
      const panels = track.querySelectorAll("[data-rail-panel]");
      const cs = getComputedStyle(track);
      return {
        overflowX: cs.overflowX,
        overflow: Math.round(track.scrollWidth - track.clientWidth),
        scrolled: Math.round(track.scrollLeft),
        lastOut: panels[panels.length - 1].getBoundingClientRect().right - track.getBoundingClientRect().right,
      };
    });
    line(
      rail.overflowX === "auto" && rail.overflow > 100 && rail.scrolled > 0 && rail.lastOut <= 1,
      `/ ${size(vp)} JavaScript off: the rail's track is a native scroller with every panel in reach`,
      `overflow-x ${rail.overflowX}, ${rail.overflow} px to scroll, scrolled to ${rail.scrolled} · last panel past the track's edge by ${rail.lastOut.toFixed(1)} px`,
    );
  } finally {
    await context.close();
  }
}

/** The load of / shifts nothing: CLS (Chromium) and, in every engine, how far the headline and the scene under it move. */
async function checkHeroShift(browser, base, vp, line) {
  const init = () => {
    window.__cls = null;
    if (PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    }
    // Layout positions, every frame from the first: offsetTop ignores the words' and the entrances' transforms.
    const seen = { h1: [], below: [] };
    window.__moved = seen;
    const t0 = performance.now();
    const sample = () => {
      const h1 = document.querySelector("h1[data-split-words]");
      const below = document.querySelector("[data-scene-root]");
      if (h1) seen.h1.push(h1.getBoundingClientRect().top + scrollY);
      if (below) seen.below.push(below.getBoundingClientRect().top + scrollY);
      if (performance.now() - t0 < 3000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  };
  const { context, page, errors } = await openPage(browser, vp, { init });
  try {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await sleep(3200);
    const r = await page.evaluate(() => {
      const span = (v) => (v.length ? Math.max(...v) - Math.min(...v) : null);
      return { cls: window.__cls, h1: span(window.__moved.h1), below: span(window.__moved.below), frames: window.__moved.below.length };
    });
    const clsOk = r.cls === null || r.cls < 0.01;
    line(
      clsOk && r.h1 !== null && r.h1 <= 0.5 && r.below !== null && r.below <= 0.5 && errors.length === 0,
      `/ ${size(vp)} the load shifts nothing: ${r.cls === null ? "no Layout Instability API here, so" : "CLS < 0.01, and"} the headline and the scene below stay put`,
      `CLS ${r.cls === null ? "n/a" : r.cls.toFixed(4)} · headline moved ${r.h1} px, scene below ${r.below} px over ${r.frames} frames${errors.length ? ` · errors: ${errors.join(" | ")}` : ""}`,
    );
  } finally {
    await context.close();
  }
}

/** Every entrance on a route waits below the fold, then reaches its shown state after a scroll through the page. */
async function checkEntrances(browser, base, route, vp, line) {
  const { context, page, errors } = await openPage(browser, vp);
  try {
    await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
    // Content arrives by trigger: before any scroll, every item below the reveal line rests hidden.
    const waiting = await page.evaluate(() => {
      const below = [...document.querySelectorAll("[data-reveal-item]")].filter(
        (el) => el.getBoundingClientRect().top > innerHeight,
      );
      return {
        below: below.length,
        hidden: below.filter((el) => !el.hasAttribute("data-reveal-state") && getComputedStyle(el).opacity === "0").length,
      };
    });
    await scrollThrough(page);
    const r = await readReveals(page);
    const words = await readWords(page);
    line(
      waiting.below > 0 &&
        waiting.hidden === waiting.below &&
        r.total > 0 &&
        r.bad.length === 0 &&
        words.unsettled === 0 &&
        errors.length === 0,
      `${route} ${size(vp)} entrances wait below the fold, then are all shown after a scroll through the page`,
      `${waiting.hidden}/${waiting.below} below the fold hidden at load · after: ${r.total - r.bad.length}/${r.total} reveal items shown, opaque, untransformed · ${words.total - words.unsettled}/${words.total} words at rest${r.bad.length ? ` · ${r.bad.slice(0, 3).join(" | ")}` : ""}${errors.length ? ` · errors: ${errors.join(" | ")}` : ""}`,
    );
  } finally {
    await context.close();
  }
}

/** Under reduced motion a route is visible and still from the start, and nothing runs anywhere down the page. */
async function checkEntrancesReduced(browser, base, route, vp, line) {
  const { context, page, errors } = await openPage(browser, vp, { motion: "reduce" });
  try {
    await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => "animationReady" in document.documentElement.dataset, null, { timeout: 10000 });
    await sleep(300);
    const r = await readReveals(page);
    const words = await readWords(page);
    // Transitions and animations, CSS or Motion's WAAPI, still moving at any step (finished ones don't count).
    const running = await scrollThrough(page, () =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => `${a.effect?.target?.tagName?.toLowerCase() ?? "?"}:${a.animationName ?? a.transitionProperty ?? "waapi"}`),
    );
    const moving = [...new Set(running.flat())];
    line(
      r.total > 0 && r.bad.length === 0 && words.animations === 0 && words.unsettled === 0 && moving.length === 0 && errors.length === 0,
      `${route} ${size(vp)} reduced motion: everything visible and still`,
      `${r.total - r.bad.length}/${r.total} reveal items shown at load · ${words.animations} word animations · running at any of ${running.length} steps: ${moving.length ? moving.join(", ") : "none"}${r.bad.length ? ` · ${r.bad.slice(0, 3).join(" | ")}` : ""}`,
    );
  } finally {
    await context.close();
  }
}

/** The rail on /: the track follows the scroll across its travel with the pin held, and lands flush with the pin. */
async function checkRail(browser, base, vp, line) {
  const { context, page, errors } = await openPage(browser, vp);
  try {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const samples = [];
    for (const p of [0, 0.5, 1]) {
      await page.evaluate((p) => {
        const rail = document.querySelector("[data-rail]");
        const top = rail.getBoundingClientRect().top + scrollY;
        scrollTo(0, top + (rail.offsetHeight - innerHeight) * p);
      }, p);
      await sleep(600);
      samples.push(
        await page.evaluate(() => {
          const rail = document.querySelector("[data-rail]");
          const pin = rail.querySelector("[data-scene-pin]");
          const track = rail.querySelector("[data-rail-track]");
          const panels = track.querySelectorAll("[data-rail-panel]");
          const cs = getComputedStyle(track);
          const pinBox = pin.getBoundingClientRect();
          const end = panels[panels.length - 1].getBoundingClientRect().right + parseFloat(cs.paddingRight);
          return {
            x: cs.translate === "none" ? 0 : parseFloat(cs.translate),
            // The travel the layout asks for: the panels' far edge plus the end gutter, less the pin, at rest.
            travel: end - (cs.translate === "none" ? 0 : parseFloat(cs.translate)) - pinBox.right,
            flush: end - pinBox.right,
            pinTop: pinBox.top,
            spacer: rail.querySelector("[data-scene-spacer]").offsetHeight,
            state: rail.dataset.sceneState,
          };
        }),
      );
    }
    const [start, mid, end] = samples;
    const travel = start.travel;
    const ok =
      travel > 100 &&
      Math.abs(start.spacer - travel) <= 1 &&
      Math.abs(start.x) < 0.5 &&
      start.state === "head" &&
      mid.x < -0.3 * travel &&
      mid.x > -0.7 * travel &&
      Math.abs(mid.pinTop) < 0.5 &&
      Math.abs(end.x + travel) <= 1 &&
      Math.abs(end.flush) <= 1 &&
      end.state === "tail" &&
      errors.length === 0;
    line(
      ok,
      `/ ${size(vp)} the rail's track moves with scroll and lands flush`,
      `travel ${travel.toFixed(1)} px (runway ${start.spacer}) · translate ${samples.map((s) => `${s.state} ${s.x.toFixed(1)}`).join(", ")} · pin top mid-way ${mid.pinTop.toFixed(1)} · last panel off the pin's edge by ${end.flush.toFixed(2)} px`,
    );
  } finally {
    await context.close();
  }
}

/** The rail on / under reduced motion: no pin, no runway, and the track is a native horizontal snap scroller. */
async function checkRailReduced(browser, base, vp, line) {
  const { context, page } = await openPage(browser, vp, { motion: "reduce" });
  try {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("[data-rail-track]")?.tabIndex === 0, null, { timeout: 10000 }).catch(() => {});
    const r = await page.evaluate(async () => {
      const rail = document.querySelector("[data-rail]");
      const track = rail.querySelector("[data-rail-track]");
      const cs = getComputedStyle(track);
      track.scrollLeft = 300;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        pin: getComputedStyle(rail.querySelector("[data-scene-pin]")).position,
        spacer: rail.querySelector("[data-scene-spacer]").offsetHeight,
        overflowX: cs.overflowX,
        snap: cs.scrollSnapType,
        tabIndex: track.tabIndex,
        overflow: track.scrollWidth - track.clientWidth,
        scrolled: track.scrollLeft,
        translate: cs.translate,
      };
    });
    line(
      r.pin !== "sticky" &&
        r.spacer === 0 &&
        r.overflowX === "auto" &&
        r.snap.startsWith("x mandatory") &&
        r.tabIndex === 0 &&
        r.overflow > 100 &&
        r.scrolled > 0 &&
        r.translate === "none",
      `/ ${size(vp)} reduced motion: the rail is a native horizontal scroller`,
      `pin ${r.pin}, runway ${r.spacer} px · track overflow-x ${r.overflowX}, snap "${r.snap}", tabindex ${r.tabIndex}, ${r.overflow} px to scroll, scrollLeft 300 -> ${r.scrolled}, translate ${r.translate}`,
    );
  } finally {
    await context.close();
  }
}

/** The header's ink on /: dark-paper over the dark section, ink again once the section is back below the header. */
async function checkHeaderInk(browser, base, vp, line) {
  const { context, page } = await openPage(browser, vp);
  try {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    // `offset`: where the dark section's top sits against the header's bottom edge, px (negative: above it). Scrolls
    // there, counts the frames until the ink flips, waits until no transition runs in the header (a link inheriting
    // the header's colour restarts its own transition on every frame of the header's, so each one is replaced, never
    // finished) and reads the colour.
    const at = (offset) =>
      page.evaluate(async (offset) => {
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        const dark = document.querySelector('[data-header-theme="dark"]');
        const header = document.querySelector("[data-header]");
        const before = header.dataset.headerInk;
        const top = dark.getBoundingClientRect().top + scrollY;
        scrollTo(0, top - header.offsetHeight - offset);
        let frames = 0;
        while (header.dataset.headerInk === before && frames < 60) {
          await frame();
          frames++;
        }
        const flipped = performance.now();
        await frame();
        while (header.getAnimations({ subtree: true }).length && performance.now() - flipped < 3000) await frame();
        return {
          ink: header.dataset.headerInk,
          color: getComputedStyle(header.querySelector("nav a")).color,
          frames,
          settled: Math.round(performance.now() - flipped),
        };
      }, offset);
    const top = await page.evaluate(() => {
      const header = document.querySelector("[data-header]");
      return { ink: header.dataset.headerInk, color: getComputedStyle(header.querySelector("nav a")).color };
    });
    const over = await at(-120);
    const back = await at(120);
    line(
      top.ink === "light" &&
        top.color === INK &&
        over.ink === "dark" &&
        over.color === DARK_PAPER &&
        back.ink === "light" &&
        back.color === INK,
      `/ ${size(vp)} the header's ink flips over the dark section and back`,
      `top: ${top.ink} ${top.color} · over the section: ${over.ink} ${over.color}, flipped after ${over.frames} frame(s), colour settled in ${over.settled} ms · above it again: ${back.ink} ${back.color}, after ${back.frames} frame(s), ${back.settled} ms`,
    );
  } finally {
    await context.close();
  }
}

/** The article's reading-progress bar: its scale is the scroll's progress. */
async function checkProgress(browser, base, vp, line) {
  const { context, page } = await openPage(browser, vp);
  try {
    await page.goto(`${base}${ARTICLE}`, { waitUntil: "networkidle" });
    const samples = [];
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      samples.push(
        await page.evaluate(async (p) => {
          scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * p);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const scale = getComputedStyle(document.querySelector('[data-scroll-fx~="progress"]')).scale;
          const max = document.documentElement.scrollHeight - innerHeight;
          return { p: scrollY / max, sx: scale === "none" ? 1 : parseFloat(scale) };
        }, p),
      );
    }
    line(
      samples.every((s) => Math.abs(s.sx - s.p) <= 0.01),
      `${ARTICLE} ${size(vp)} the reading-progress bar tracks scroll`,
      samples.map((s) => `scroll ${s.p.toFixed(3)} -> scale ${s.sx.toFixed(3)}`).join(", "),
    );
  } finally {
    await context.close();
  }
}

/** Firefox on the article: no scroll-driven animations, so the static fallback. Everything shown, nothing hidden. */
async function checkStaticFallback(browser, base, vp, line) {
  const { context, page, errors } = await openPage(browser, vp);
  try {
    await page.goto(`${base}${ARTICLE}`, { waitUntil: "networkidle" });
    await scrollThrough(page);
    const reveals = await readReveals(page);
    const words = await readWords(page);
    const r = await page.evaluate(() => {
      const parallax = document.querySelector('[data-scroll-fx~="parallax"]');
      const bar = document.querySelector('[data-scroll-fx~="progress"]');
      // Effective opacity up the tree, and visibility, for every piece of content in the article.
      // The scrolly section hides on purpose: the states not shown (inert, aria-hidden) beside the steps, or the
      // graphic itself when stacked, and the steps' own figures when sticky. checkScrolly covers it.
      const mode = document.querySelector("[data-scrolly]")?.dataset.scrollyMode;
      const meant = (el) =>
        el.closest('[data-scrolly-state][aria-hidden="true"]') ||
        (mode === "sticky" && el.closest("[data-scrolly-inline]")) ||
        (mode !== "sticky" && el.closest("[data-scrolly-graphic]"));
      const content = [...document.querySelectorAll("article :is(h1, p, figcaption, img, video)")].filter((el) => !meant(el));
      const hidden = content.filter((el) => {
        let opacity = 1;
        for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
          opacity *= Number(getComputedStyle(node).opacity);
        }
        return opacity < 0.999 || getComputedStyle(el).visibility !== "visible" || el.getBoundingClientRect().width === 0;
      });
      return {
        supports: CSS.supports("animation-timeline: view()"),
        parallax: { animations: parallax.getAnimations().length, translate: getComputedStyle(parallax).translate },
        bar: { animations: bar.getAnimations().length, scale: getComputedStyle(bar).scale },
        hidden: hidden.map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("alt") || "").trim().slice(0, 24)}"`),
        content: content.length,
      };
    });
    line(
      !r.supports &&
        reveals.total > 0 &&
        reveals.bad.length === 0 &&
        words.unsettled === 0 &&
        r.parallax.animations === 0 &&
        r.parallax.translate === "none" &&
        r.bar.animations === 0 &&
        r.hidden.length === 0 &&
        errors.length === 0,
      `${ARTICLE} ${size(vp)} Firefox, the static fallback: content visible, nothing stuck hidden`,
      `view() supported: ${r.supports} · ${reveals.total - reveals.bad.length}/${reveals.total} reveals shown · parallax ${r.parallax.animations} animations, translate ${r.parallax.translate} · progress bar ${r.bar.animations} animations, scale ${r.bar.scale} (not drawn) · ${r.content - r.hidden.length}/${r.content} content elements visible${r.hidden.length ? `: hidden ${r.hidden.join(", ")}` : ""}${reveals.bad.length ? ` · ${reveals.bad.join(" | ")}` : ""}`,
    );
  } finally {
    await context.close();
  }
}

// ── Phase 4: scrollytelling, the cover transition, the route contract ───

/** Jumps the scrolly section's step `i` 20 px past the trigger line (the middle of the viewport under the header). */
const toStep = (page, i) =>
  page.evaluate(async (i) => {
    const root = document.querySelector("[data-scrolly]");
    const step = root.querySelectorAll("[data-scrolly-step]")[i];
    const header = parseFloat(getComputedStyle(root.querySelector("[data-scrolly-graphic]")).scrollMarginTop) || 0;
    scrollTo(0, step.getBoundingClientRect().top + scrollY - (header + (innerHeight - header) / 2) + 20);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, i);

/**
 * The section as the reader sees it: mode, active step, the shown state and its opacity, the pan's transform.
 * `running` counts the CSS and WAAPI animations (the crossfade); Motion drives the pan's x/y/scale from JavaScript,
 * which getAnimations() never lists, so `panMoving` reads the pan's transform two frames apart.
 */
const readScrolly = (page) =>
  page.evaluate(async () => {
    const root = document.querySelector("[data-scrolly]");
    const shown = root.querySelector("[data-scrolly-state][data-state-active]");
    const pan = root.querySelector('[data-scrolly-state="detail"] > div');
    const states = [...root.querySelectorAll("[data-scrolly-state]")];
    const before = pan ? getComputedStyle(pan).transform : null;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      panMoving: pan ? getComputedStyle(pan).transform !== before : false,
      mode: root.dataset.scrollyMode,
      active: Number(root.dataset.scrollyActive),
      shows: [...root.querySelectorAll("[data-scrolly-step]")].map((s) => s.dataset.scrollyShow),
      shown: shown?.dataset.scrollyState ?? null,
      opacities: states.map((s) => `${s.dataset.scrollyState}=${getComputedStyle(s).opacity}`).join(" "),
      opacity: shown ? getComputedStyle(shown).opacity : null,
      pan: pan ? getComputedStyle(pan).transform : null,
      running: root.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
    };
  });

/** The scale in a matrix() transform, or 1. */
const scaleOf = (t) => (t && t.startsWith("matrix(") ? Number(t.slice(7).split(",")[0]) : 1);

/**
 * The article's scrolly section. Desktop: sticky; each step, jumped to, activates its own state (the two detail
 * steps pan across one still, to their own frames); scrolling back up returns to the first; a reload on the second
 * step lands on its frame without panning; every picture it shows is one the page already loads. Phones: stacked,
 * no graphic, the steps' own figures in flow and no step states.
 */
async function checkScrolly(browser, base, vp, line) {
  const { context, page, errors } = await openPage(browser, vp);
  try {
    await page.goto(`${base}${ARTICLE}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("[data-scrolly]")?.dataset.scrollyMode, null, { timeout: 10000 });
    if (vp.width < 1024) {
      const r = await page.evaluate(() => {
        const root = document.querySelector("[data-scrolly]");
        const steps = [...root.querySelectorAll("[data-scrolly-step]")];
        const inline = [...root.querySelectorAll("[data-scrolly-inline]")];
        return {
          mode: root.dataset.scrollyMode,
          graphic: getComputedStyle(root.querySelector("[data-scrolly-graphic]")).display,
          inline: inline.filter((f) => f.getBoundingClientRect().width > 0 && f.querySelector("img")).length,
          wanted: inline.length,
          lefts: new Set(steps.map((s) => Math.round(s.getBoundingClientRect().left))).size,
          states: steps.filter((s) => s.hasAttribute("data-step-state")).length,
        };
      });
      line(
        r.mode === "stacked" && r.graphic === "none" && r.wanted > 0 && r.inline === r.wanted && r.lefts === 1 && r.states === 0 && errors.length === 0,
        `${ARTICLE} ${size(vp)} scrolly: stacked, each step's picture in flow`,
        `mode ${r.mode}, graphic display ${r.graphic}, ${r.inline}/${r.wanted} inline figures shown, steps in ${r.lefts} column(s), ${r.states} step states${errors.length ? ` · errors: ${errors.join(" | ")}` : ""}`,
      );
      return;
    }
    const seen = [];
    for (let i = 0; i < 4; i++) {
      await toStep(page, i);
      await sleep(1600); // the pan's MOTION.entrance (1.3 s) and the crossfade land
      seen.push(await readScrolly(page));
    }
    await toStep(page, 0);
    await sleep(1600);
    const up = await readScrolly(page);
    const steps = seen.map((s, i) => s.active === i && s.shown === s.shows[i] && s.opacity === "1");
    const pans = [scaleOf(seen[0].pan), scaleOf(seen[1].pan)];
    // Every picture in the section is one the page already requests: the same srcset as an image outside it, or the
    // loop's poster URL.
    const reuse = await page.evaluate(() => {
      const root = document.querySelector("[data-scrolly]");
      const outside = [...document.querySelectorAll("img, video")].filter((el) => !root.contains(el));
      const known = new Set(outside.flatMap((el) => [el.getAttribute("srcset"), el.getAttribute("poster") && new URL(el.getAttribute("poster"), location.href).href]).filter(Boolean));
      return [...root.querySelectorAll("img")].filter((img) => !known.has(img.getAttribute("srcset") ?? img.src)).map((img) => img.getAttribute("src"));
    });
    // Left mid-pan for a step with no frame (the state crossfade is shorter than the pan): the pan still lands.
    await toStep(page, 0);
    await sleep(1600);
    await toStep(page, 1);
    await sleep(300);
    const midPan = await readScrolly(page);
    await toStep(page, 2);
    await sleep(1600);
    const leftMidPan = await readScrolly(page);
    // A reload on the second step: the core's first report has direction null, so the pan jumps to its frame.
    await toStep(page, 1);
    await sleep(1600);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("[data-scrolly]")?.dataset.scrollyActive === "1", null, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const reloaded = await readScrolly(page);
    line(
      seen.every((s) => s.mode === "sticky") && steps.every(Boolean) && up.active === 0 && up.shown === up.shows[0] && errors.length === 0,
      `${ARTICLE} ${size(vp)} scrolly: sticky, each step shows its own state, and back up to the first`,
      `${seen.map((s, i) => `step ${i}: active ${s.active}, shows ${s.shown} (${s.opacities})`).join(" · ")} · back up: active ${up.active}, ${up.shown}${errors.length ? ` · errors: ${errors.join(" | ")}` : ""}`,
    );
    line(
      Math.abs(pans[0] - 1.5) < 0.01 && Math.abs(pans[1] - 1.6) < 0.01 && seen[0].pan !== seen[1].pan,
      `${ARTICLE} ${size(vp)} scrolly: the two detail steps pan to their own frames`,
      `step 0 ${seen[0].pan} · step 1 ${seen[1].pan}`,
    );
    line(
      midPan.panMoving && leftMidPan.active === 2 && leftMidPan.pan === seen[1].pan && !leftMidPan.panMoving,
      `${ARTICLE} ${size(vp)} scrolly: a step without a frame lets a pan in flight land`,
      `300 ms into the pan ${midPan.pan} (moving ${midPan.panMoving}) · then step 2: ${leftMidPan.pan}, moving ${leftMidPan.panMoving} (step 1's frame ${seen[1].pan})`,
    );
    line(
      reloaded.active === 1 && reloaded.pan === seen[1].pan && reloaded.running === 0 && !reloaded.panMoving,
      `${ARTICLE} ${size(vp)} scrolly: a reload on a step lands on its frame without panning`,
      `active ${reloaded.active}, pan ${reloaded.pan}, ${reloaded.running} animation(s) running, pan moving ${reloaded.panMoving}`,
    );
    line(reuse.length === 0, `${ARTICLE} ${size(vp)} scrolly: every picture is one the page already loads`, reuse.length ? `new: ${reuse.join(", ")}` : "");
  } finally {
    await context.close();
  }
}

/** Under reduced motion the section stays sticky and every change is instant: the swap and the pan. */
async function checkScrollyReduced(browser, base, vp, line) {
  const { context, page, errors } = await openPage(browser, vp, { motion: "reduce" });
  try {
    await page.goto(`${base}${ARTICLE}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("[data-scrolly]")?.dataset.scrollyMode, null, { timeout: 10000 });
    await toStep(page, 1);
    await sleep(300);
    const pan1 = await readScrolly(page);
    await toStep(page, 2);
    const swap = await readScrolly(page); // two frames after the jump
    await toStep(page, 0);
    const pan0 = await readScrolly(page);
    line(
      pan1.mode === "sticky" &&
        swap.active === 2 &&
        swap.opacity === "1" &&
        swap.running === 0 &&
        !swap.panMoving &&
        pan0.active === 0 &&
        Math.abs(scaleOf(pan0.pan) - 1.5) < 0.01 &&
        Math.abs(scaleOf(pan1.pan) - 1.6) < 0.01 &&
        pan0.running === 0 &&
        !pan0.panMoving &&
        errors.length === 0,
      `${ARTICLE} ${size(vp)} scrolly, reduced motion: sticky, the swap and the pan are instant`,
      `mode ${pan1.mode} · two frames after step 1 -> 2: ${swap.shown} (${swap.opacities}), ${swap.running} running · two frames after 2 -> 0: pan ${pan0.pan}, ${pan0.running} running, pan moving ${pan0.panMoving}`,
    );
  } finally {
    await context.close();
  }
}

// Installed before any page script: each live Lenis adds one non-passive window `wheel` listener (check-authority.mjs).
function countLenis() {
  const live = new Set();
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (this === window && type === "wheel" && options?.passive === false) live.add(listener);
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    if (this === window && type === "wheel") live.delete(listener);
    return remove.call(this, type, listener, options);
  };
  Object.defineProperty(window, "__liveLenis", { get: () => live.size });
  // Every view transition, with its types and the pseudo-elements animating once it is ready.
  window.__vt = [];
  const start = Document.prototype.startViewTransition;
  if (start) {
    Document.prototype.startViewTransition = function (arg) {
      const t = start.call(this, arg);
      const record = { types: [], animating: [], names: [], header: null };
      window.__vt.push(record);
      t.ready
        .then(() => {
          record.types = [...(t.types ?? [])];
          record.animating = document.getAnimations().map((a) => a.effect?.pseudoElement).filter(Boolean);
          record.names = document.getAnimations().map((a) => a.animationName).filter(Boolean);
          record.header = getComputedStyle(document.querySelector("[data-header]")).viewTransitionName;
        })
        .catch((e) => (record.error = String(e)));
      return t;
    };
  }
}

/**
 * The journal's shared element and the route contract, client-side all the way: / -> /journal (header link) -> the
 * rust card (a "forward" transition: the cover's group morphs, the header's group never animates, the article lands
 * at the top) -> the browser's back (no transition: the index comes back where it was) -> the card again -> the
 * "Journal" breadcrumb (a "back" transition: the hero morphs back, the pages slide vt-back) -> / again, where the live
 * triggers are as many as on the first load. At every step one authority: the route's stamp, one Lenis on /, none on
 * the journal.
 */
async function checkCoverTransition(browser, base, vp, line) {
  const { context, page, errors } = await openPage(browser, vp, { init: countLenis });
  const state = () =>
    page.evaluate(() => ({
      path: location.pathname,
      stamp: document.documentElement.dataset.scrollAuthority ?? null,
      stamps: document.querySelectorAll("[data-scroll-authority]").length,
      lenis: window.__liveLenis,
      y: Math.round(scrollY),
      vts: window.__vt.length,
      triggers: window.__triggers?.() ?? null,
    }));
  const settle = async (path, stamp) => {
    await page.waitForFunction(
      ([p, a]) => location.pathname === p && document.documentElement.dataset.scrollAuthority === a && !document.activeViewTransition,
      [path, stamp],
      { timeout: 10000 },
    ).catch(() => {});
    await sleep(600);
    return state();
  };
  const authority = (s, stamp, lenis) => s.stamp === stamp && s.stamps === 1 && s.lenis === lenis;
  try {
    await page.goto(`${base}/?motion-debug`, { waitUntil: "networkidle" });
    await page.evaluate(() => (window.__sameDocument = true));
    const home = await settle("/", "lenis");
    await page.click('header nav a[href="/journal"]');
    const index = await settle("/journal", "native");
    await page.evaluate(() => scrollTo(0, 280));
    await sleep(300);
    const card = page.locator('a[href="/journal/what-rust-is-for"]').first();
    await card.scrollIntoViewIfNeeded();
    const left = (await state()).y;
    await card.click();
    const article = await settle(ARTICLE, "native");
    const vt = await page.evaluate(() => window.__vt.at(-1) ?? null);
    await page.goBack();
    const back = await settle("/journal", "native");
    // Again into the article, and out through its "Journal" breadcrumb: a "back" transition.
    await page.locator('a[href="/journal/what-rust-is-for"]').first().click();
    await settle(ARTICLE, "native");
    await page.locator('main header a[href="/journal"]').click();
    const crumb = await settle("/journal", "native");
    const vtBack = await page.evaluate(() => window.__vt.at(-1) ?? null);
    await page.click('header a[href="/"]');
    const again = await settle("/", "lenis");
    const same = await page.evaluate(() => window.__sameDocument === true);

    const cover = "::view-transition-group(cover-what-rust-is-for)";
    line(
      vt !== null && vt.types.join() === "forward" && vt.animating.includes(cover) && vt.header === "site-header" && !vt.animating.some((p) => p.includes("site-header")),
      `/journal -> ${ARTICLE} ${size(vp)} the cover morphs (a forward transition) under an anchored header`,
      vt ? `types [${vt.types}] · ${vt.animating.includes(cover) ? "cover group animating" : "no cover group"} · header named ${vt.header}, ${vt.animating.filter((p) => p.includes("site-header")).length} header animations${vt.error ? ` · ${vt.error}` : ""}` : "no view transition ran",
    );
    line(article.y === 0, `${ARTICLE} ${size(vp)} the article lands at the top`, `scrollY ${article.y}`);
    const slides = ["vt-slide-out-back", "vt-slide-in-back"];
    line(
      vtBack !== null &&
        crumb.vts === back.vts + 2 && // the card again, then the breadcrumb: one transition each
        vtBack.types.join() === "back" &&
        vtBack.animating.includes(cover) &&
        slides.every((n) => vtBack.names.includes(n)) &&
        !vtBack.animating.some((p) => p.includes("site-header")) &&
        crumb.y === 0,
      `${ARTICLE} -> /journal ${size(vp)} the "Journal" breadcrumb: a back transition, the hero morphs back into its card and the pages slide vt-back`,
      vtBack ? `types [${vtBack.types}] · ${vtBack.animating.includes(cover) ? "cover group animating" : "no cover group"} · animations ${[...new Set(vtBack.names)].join(", ")} · view transitions ${back.vts} -> ${crumb.vts} · index at ${crumb.y}${vtBack.error ? ` · ${vtBack.error}` : ""}` : "no view transition ran",
    );
    line(
      Math.abs(back.y - left) <= 2 && back.vts === article.vts,
      `/journal ${size(vp)} the browser's back restores the index where it was left, with no transition`,
      `left at ${left}, back at ${back.y} · view transitions ${article.vts} -> ${back.vts}`,
    );
    line(
      same && home.triggers !== null && again.triggers === home.triggers,
      `/ -> /journal -> ${ARTICLE} -> back -> / ${size(vp)} the live ScrollTriggers come back to the same count`,
      `${home.triggers} on the first load, ${again.triggers} after the round trip${same ? "" : " · a full page load happened"}`,
    );
    line(
      authority(home, "lenis", 1) && authority(index, "native", 0) && authority(article, "native", 0) && authority(back, "native", 0) && authority(crumb, "native", 0) && authority(again, "lenis", 1) && errors.length === 0,
      `${size(vp)} one scroll authority at every step: lenis on /, native on the journal`,
      [home, index, article, back, crumb, again].map((s) => `${s.path} ${s.stamp}×${s.stamps} Lenis ${s.lenis}`).join(" · ") + (errors.length ? ` · errors: ${errors.join(" | ")}` : ""),
    );
  } finally {
    await context.close();
  }
}

// ── Phase 5: /lab ───────────────────────────────────────────────────────

const LAB = "/lab";
const LAB_CHAPTERS = ["The body", "The bellows", "The lens", "The tripod", "The whole object"];
// Headless Chromium has WebGL only through SwiftShader with these switches (spike S11).
const GL_LAUNCH = { args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] };
// A minified three.js build keeps its console prefixes: the marker for a chunk that carries three.
const THREE_MARK = "THREE.WebGLRenderer";

/** Records every WebGL context the page creates (__liveGl(): how many aren't lost). */
const glRecorder = () => {
  window.__gl = [];
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !window.__gl.some((e) => e.ctx === ctx)) window.__gl.push({ ctx, canvas: this });
    return ctx;
  };
  window.__liveGl = () => window.__gl.filter((e) => !e.ctx.isContextLost()).length;
  window.__lcp = null;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__lcp = entry.element;
  }).observe({ type: "largest-contentful-paint", buffered: true });
};

/** A browser without WebGL: every webgl context request fails. */
const noWebgl = () => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    return /webgl/.test(type) ? null : getContext.call(this, type, ...rest);
  };
};

/** Scrolls /lab's scene to progress p and lets it settle. */
async function labJump(page, p) {
  await page.evaluate((p) => {
    const scene = document.querySelector(".lab-scene");
    const top = scene.getBoundingClientRect().top + scrollY;
    scrollTo(0, Math.round(top + (scene.offsetHeight - innerHeight) * p));
  }, p);
  await sleep(700);
}

/** The scene, the conductor, the acts, the canvas and the poster, as the reader would find them. */
const labState = (page) =>
  page.evaluate(() => {
    const lab = window.__lab ?? null;
    const scene = lab?.scene() ?? null;
    const root = document.querySelector(".lab-scene");
    const acts = [...root.querySelectorAll("[data-scene-act]")];
    const poster = root.querySelector("img[data-scene-poster]");
    const slot = root.querySelector("[data-scene-canvas]");
    const posterCs = poster && getComputedStyle(poster);
    const slotCs = getComputedStyle(slot);
    const canvas = slot.querySelector("canvas");
    const rects = acts.map((a) => a.getBoundingClientRect());
    return {
      act: scene?.act ?? null,
      awake: scene?.awake ?? null,
      index: lab?.state().index ?? null,
      exact: lab ? +lab.state().exact.toFixed(3) : null,
      inert: acts.map((a) => a.inert),
      opacity: acts.map((a) => +getComputedStyle(a).opacity),
      visible: acts.map((a) => getComputedStyle(a).visibility === "visible" && +getComputedStyle(a).opacity > 0.99),
      inFlow: rects.every((r, i) => i === 0 || r.top >= rects[i - 1].bottom - 1),
      renders: lab?.renders ?? 0,
      draws: lab?.draws ?? 0,
      drawnAt: lab?.drawnAt ?? null,
      posterAt: lab?.posterAt ?? null,
      mountedAt: lab?.mountedAt ?? null,
      lost: lab?.lost ?? 0,
      mode: slot.querySelector("[data-scene-mode]")?.getAttribute("data-scene-mode") ?? null,
      canvas: !!canvas,
      // The poster is what the reader sees when no canvas covers it.
      posterShown:
        !!poster && poster.complete && poster.naturalWidth > 0 && posterCs.visibility === "visible" && +posterCs.opacity === 1 &&
        (!canvas || slotCs.visibility === "hidden" || +slotCs.opacity === 0),
      pin: getComputedStyle(root.querySelector("[data-scene-pin]")).position,
      liveGl: window.__liveGl?.() ?? null,
      lcpPoster: window.__lcp ? window.__lcp.hasAttribute("data-scene-poster") : null,
    };
  });

/** Bridge render calls and canvas draws over `ms`, optionally while `during` runs. */
async function labRendersOver(page, ms, during) {
  const a = await labState(page);
  const started = Date.now();
  if (during) await during();
  const left = ms - (Date.now() - started);
  if (left > 0) await sleep(left);
  const b = await labState(page);
  const secs = Math.max(ms, Date.now() - started) / 1000;
  return { renders: Math.round((b.renders - a.renders) / secs), draws: Math.round((b.draws - a.draws) / secs) };
}

/** Wheel-scrolls `notches` × 100 px, one notch every 50 ms (Lenis glides each one). */
async function labWheel(page, notches, dy = 100) {
  await page.mouse.move(200, 400);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, dy);
    await sleep(50);
  }
}

/** From the scene's first placement, the lowest opacity the shown act has over 12 frames (1: it landed, no fade). */
async function labLanding(page) {
  await page.waitForSelector(".lab-scene[data-lab-placed]", { timeout: 30000 });
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        let low = 1;
        let n = 0;
        const sample = () => {
          const act = [...document.querySelectorAll(".lab-scene [data-scene-act]")].find((a) => !a.inert);
          low = Math.min(low, act ? +getComputedStyle(act).opacity : 0);
          if (++n < 12) requestAnimationFrame(sample);
          else resolve(Math.round(low * 100) / 100);
        };
        sample();
      }),
  );
}

/**
 * A wheel run through the scene, recorded at the end of every frame (a ResizeObserver callback is the last script
 * before paint): over the frames where the scene moves inside its range, did the bridge render in that frame, with
 * that frame's progress (the rect's, within 1 px of the range)? Lenis glides, so the scroll moves for many frames.
 */
async function labLag(page) {
  await page.evaluate(() => {
    const rows = [];
    const root = document.querySelector(".lab-scene");
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0;contain:strict";
    document.body.appendChild(probe);
    let on = true;
    let flip = false;
    new ResizeObserver(() => {
      if (!on) return;
      const r = root.getBoundingClientRect();
      const range = r.height - innerHeight;
      rows.push({ y: scrollY, truth: range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : null, range, rn: window.__lab.renders, e: window.__lab.exact });
    }).observe(probe);
    const tick = () => {
      if (!on) return probe.remove();
      flip = !flip;
      probe.style.width = flip ? "2px" : "1px";
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__labLagStop = () => ((on = false), rows);
  });
  await labWheel(page, 12);
  await sleep(1200);
  await labWheel(page, 6, -100);
  await sleep(1200);
  const rows = await page.evaluate(() => window.__labLagStop());
  let moving = 0;
  let inFrame = 0;
  let worst = 0;
  const late = [];
  for (let n = 1; n < rows.length; n++) {
    const r = rows[n];
    if (Math.abs(r.y - rows[n - 1].y) <= 0.5 || r.truth === null || r.truth <= 0 || r.truth >= 1) continue;
    moving++;
    const err = r.e === null ? Infinity : Math.abs(r.e - r.truth) * r.range;
    worst = Math.max(worst, err);
    if (r.rn > rows[n - 1].rn && err <= 1.01) inFrame++;
    else if (late.length < 2) late.push({ n, errPx: Math.round(err * 10) / 10 });
  }
  return { moving, inFrame, worstPx: Math.round(worst * 10) / 10, late };
}

/** Headless pages are never hidden: override the visibility getters and fire the event (the bridge's gate reads them). */
const fakeHidden = (page, hidden) =>
  page.evaluate((hidden) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

const nearly = (a, b, tol = 0.01) => a !== null && Math.abs(a - b) <= tol;
const onlyAct = (s, k) => s.act === k && s.index === k && s.inert.every((v, i) => v === (i !== k)) && s.opacity[k] === 1;

/** The served HTML of /lab, and three in no route's initial JavaScript. */
async function checkLabHtml(base, line) {
  const html = await (await fetch(`${base}${LAB}`)).text();
  const titles = LAB_CHAPTERS.filter((t) => html.includes(`>${t}</h2>`));
  line(
    /<h1\b[^>]*>Lab<\/h1>/.test(html) && titles.length === 5 && /<img[^>]*data-scene-poster=""[^>]*camera-poster/.test(html),
    "served HTML of /lab: the heading, the five chapters and the poster",
    `${titles.length}/5 chapters${/data-scene-poster/.test(html) ? ", poster" : ", NO poster"}`,
  );
  const sizes = [];
  const carriers = [];
  for (const route of ["/", "/journal", ARTICLE, LAB, "/blocks"]) {
    const page = await (await fetch(`${base}${route}`)).text();
    const srcs = [...new Set([...page.matchAll(/(?:src|href)="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]))];
    let raw = 0;
    let gz = 0;
    for (const src of srcs) {
      const body = Buffer.from(await (await fetch(`${base}${src}`)).arrayBuffer());
      raw += body.length;
      gz += gzipSync(body).length;
      if (body.includes(THREE_MARK)) carriers.push(`${route} ${src}`);
    }
    sizes.push(`${route} ${Math.round(raw / 1024)} KB (${Math.round(gz / 1024)} KB gz)`);
  }
  line(carriers.length === 0, "three.js is in no route's initial JavaScript", `${carriers.join(", ") || sizes.join(" · ")}`);
}

/** With WebGL (Chromium + SwiftShader): the poster first, then the canvas, ticked by the bridge only when it must. */
async function checkLabWebgl(browser, base, vp, line) {
  const { context, page, errors } = await openPage(browser, vp, { init: glRecorder });
  const at = `${LAB} ${size(vp)}`;
  try {
    await page.goto(`${base}${LAB}?motion-debug`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__lab?.drawnAt, null, { timeout: 30000 });
    await sleep(800);
    const first = await labState(page);
    const net = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource");
      const poster = entries.find((e) => e.name.includes("camera-poster"));
      const glb = entries.find((e) => e.name.includes("antique-camera.glb"));
      const late = entries.filter((e) => e.initiatorType === "script" && poster && e.startTime >= poster.responseEnd);
      return {
        posterEnd: poster ? Math.round(poster.responseEnd) : null,
        glbStart: glb ? Math.round(glb.startTime) : null,
        lazyKB: Math.round(late.reduce((n, e) => n + (e.encodedBodySize || 0), 0) / 1024),
      };
    });
    const ink = await page.evaluate(() => window.__lab.sample());
    line(
      first.lcpPoster === true && net.posterEnd !== null && net.glbStart >= net.posterEnd && first.mountedAt >= first.posterAt,
      `${at} the poster is the LCP element; three and the model load after it`,
      `LCP ${first.lcpPoster ? "poster" : "not the poster"} · poster in at ${net.posterEnd} ms, model requested at ${net.glbStart} ms, ${net.lazyKB} KB of JS after the poster`,
    );
    line(
      ink !== null && ink > 0.02 && first.canvas && first.mode === "live" && first.liveGl === 1,
      `${at} renders a frame of the model`,
      `${ink === null ? "no canvas" : `${Math.round(ink * 100)}% of the canvas is the model`} · first frame ${Math.round(first.drawnAt - first.posterAt)} ms after the poster · ${first.liveGl} live context(s)`,
    );

    const steps = [];
    for (let k = 0; k < 5; k++) {
      await labJump(page, k / 4);
      steps.push(await labState(page));
    }
    line(
      steps.every((s, k) => onlyAct(s, k) && nearly(s.exact, k / 4)),
      `${at} the chapters follow the scroll: one act shown, the others inert, the camera on the same chapter`,
      steps.map((s, k) => `p ${k / 4}: act ${s.act}, chapter ${s.index}, exact ${s.exact}`).join(" · "),
    );

    await labJump(page, 0.4);
    await sleep(1000);
    const rest = await labRendersOver(page, 1000);
    const scrolling = await labRendersOver(page, 1200, () => labWheel(page, 20));
    await sleep(1500);
    const after = await labRendersOver(page, 1000);
    line(
      rest.renders === 0 && after.renders === 0 && scrolling.draws > 0,
      `${at} draws only while the scroll moves: 0 renders/s at rest`,
      `at rest ${rest.renders}/s · scrolling ${scrolling.renders} renders/s, ${scrolling.draws} draws/s · settled again ${after.renders}/s`,
    );

    // The bridge draws after Lenis and ScrollTrigger in every tick, though its useGSAP ran before the layout started
    // Lenis: every frame that moves the scene draws that frame's progress.
    await labJump(page, 0.1);
    const lag = await labLag(page);
    line(
      lag.moving >= 20 && lag.inFrame === lag.moving,
      `${at} every frame that moves the scene draws in that frame, at its progress (0 frames late)`,
      `${lag.inFrame}/${lag.moving} in frame, worst ${lag.worstPx} px${lag.late.length ? `, late: ${JSON.stringify(lag.late)}` : ""}`,
    );

    // Off-screen: two viewports of page appended after the scene, scrolled to.
    await page.evaluate(() => {
      const tail = document.createElement("div");
      tail.id = "verify-tail";
      tail.style.height = "250vh";
      document.querySelector(".lab-scene").after(tail);
    });
    await sleep(600);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await sleep(1200);
    const away = await labState(page);
    const offscreen = await labRendersOver(page, 1000, () => labWheel(page, 5, -100));
    await page.evaluate(() => document.getElementById("verify-tail").remove());
    await sleep(600);
    await labJump(page, 0.25);
    await sleep(800);
    const back = await labState(page);
    line(
      away.awake === false && offscreen.renders === 0 && onlyAct(back, 1) && back.draws > away.draws,
      `${at} 0 renders off-screen, and back in view it draws the scroll's chapter`,
      `asleep ${!away.awake}, ${offscreen.renders} renders/s off-screen · back: act ${back.act}, chapter ${back.index}, ${back.draws - away.draws} draws`,
    );

    await fakeHidden(page, true);
    await sleep(200);
    const hiddenBefore = await labState(page);
    await labJump(page, 0.75);
    const hidden = await labRendersOver(page, 1000);
    await fakeHidden(page, false);
    await sleep(1000);
    const shown = await labState(page);
    line(
      hidden.renders === 0 && shown.draws > hiddenBefore.draws && onlyAct(shown, 3) && nearly(shown.exact, 0.75),
      `${at} 0 renders while the tab is hidden, even as the scroll moves; shown again at the scroll's chapter`,
      `hidden ${hidden.renders}/s · shown: chapter ${shown.index}, exact ${shown.exact}`,
    );

    // Leaving the route releases the context; the browser's back lands on the same chapter.
    await labJump(page, 0.5);
    await page.click('header a[href="/journal"]');
    await page.waitForURL(`${base}/journal`);
    await sleep(1200);
    const gone = await page.evaluate(() => window.__liveGl());
    await page.goBack();
    await page.waitForURL(/\/lab/);
    const backLow = await labLanding(page);
    await page.waitForFunction(() => window.__lab?.drawnAt, null, { timeout: 30000 });
    await sleep(800);
    const returned = await labState(page);
    line(
      gone === 0 && returned.liveGl === 1 && onlyAct(returned, 2) && nearly(returned.exact, 0.5, 0.02) && backLow === 1,
      `${at} leaving releases the WebGL context; back/forward lands on the same chapter, shown at once (no fade in)`,
      `${gone} live context(s) on /journal · back on /lab: act ${returned.act}, chapter ${returned.index}, exact ${returned.exact}, lowest opacity ${backLow}, ${returned.liveGl} live context(s)`,
    );

    await labJump(page, 0.75);
    await page.reload({ waitUntil: "load" });
    const reloadLow = await labLanding(page);
    await page.waitForFunction(() => window.__lab?.drawnAt, null, { timeout: 30000 });
    await sleep(800);
    const reloaded = await labState(page);
    line(
      onlyAct(reloaded, 3) && nearly(reloaded.exact, 0.75, 0.02) && reloadLow === 1,
      `${at} a reload mid-scene draws the same chapter, shown at once (no fade in)`,
      `act ${reloaded.act}, chapter ${reloaded.index}, exact ${reloaded.exact}, lowest opacity ${reloadLow}`,
    );

    // Reduced motion, switched on live: the canvas goes, the poster and every chapter stay.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await sleep(1000);
    const reduced = await labState(page);
    const reducedDraws = await labRendersOver(page, 1000, () => labWheel(page, 5));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await labJump(page, 0.5);
    await page.waitForFunction(() => window.__lab?.drawnAt, null, { timeout: 30000 });
    await sleep(1000);
    const motion = await labState(page);
    line(
      !reduced.canvas && reduced.posterShown && reduced.visible.every(Boolean) && reduced.inert.every((v) => !v) && reducedDraws.draws === 0 &&
        motion.canvas && onlyAct(motion, 2),
      `${at} reduced motion, live: the canvas unmounts, the poster and all five chapters show; off again, the canvas returns on the chapter`,
      `reduced: canvas ${reduced.canvas}, poster ${reduced.posterShown}, ${reduced.visible.filter(Boolean).length}/5 chapters shown, ${reducedDraws.draws} draws/s scrolling · motion: canvas ${motion.canvas}, chapter ${motion.index}`,
    );

    // Lenis was re-created behind the bridge's ticker callback: still drawn in the frame.
    await labJump(page, 0.1);
    const lagBack = await labLag(page);
    line(
      lagBack.moving >= 20 && lagBack.inFrame === lagBack.moving,
      `${at} after reduced motion on and off, every frame that moves the scene still draws in that frame`,
      `${lagBack.inFrame}/${lagBack.moving} in frame, worst ${lagBack.worstPx} px${lagBack.late.length ? `, late: ${JSON.stringify(lagBack.late)}` : ""}`,
    );

    // A lost context: the poster takes over and nothing draws. (SceneCanvas also reports the context it drops itself
    // when it unmounts, as on the reduced-motion switch above: count from here.)
    const lostBefore = (await labState(page)).lost;
    await page.evaluate(() => {
      const entry = window.__gl.find((e) => !e.ctx.isContextLost() && e.canvas.closest("[data-scene-canvas]"));
      entry?.ctx.getExtension("WEBGL_lose_context")?.loseContext();
    });
    await sleep(1000);
    const lost = await labState(page);
    const lostDraws = await labRendersOver(page, 1000, () => labWheel(page, 5));
    line(
      lost.lost === lostBefore + 1 && lost.mode === "poster" && !lost.canvas && lost.posterShown && lostDraws.draws === 0,
      `${at} after WEBGL_lose_context the poster stands and nothing draws`,
      `${lost.lost - lostBefore} loss reported, mode ${lost.mode}, canvas ${lost.canvas}, poster ${lost.posterShown}, ${lostDraws.draws} draws/s scrolling`,
    );
    line(errors.length === 0, `${at} no page errors`, errors.join(" | "));
  } finally {
    await context.close();
  }
}

/** Every engine: reduced motion from the start, no WebGL, no JavaScript. */
async function checkLabFallbacks(browser, base, vp, line) {
  const at = `${LAB} ${size(vp)}`;
  {
    const { context, page } = await openPage(browser, vp, { motion: "reduce", init: glRecorder });
    let model = 0;
    page.on("request", (r) => r.url().includes("antique-camera.glb") && model++);
    try {
      await page.goto(`${base}${LAB}?motion-debug`, { waitUntil: "load" });
      await sleep(1500);
      const s = await labState(page);
      line(
        s.posterShown && !s.canvas && s.liveGl === 0 && model === 0 && s.pin !== "sticky" && s.visible.every(Boolean) && s.inert.every((v) => !v) && s.inFlow,
        `${at} reduced motion: the poster, every chapter in flow, no canvas, no model fetched`,
        `poster ${s.posterShown}, canvas ${s.canvas}, ${s.liveGl} context(s), model requests ${model}, pin ${s.pin}, ${s.visible.filter(Boolean).length}/5 chapters shown${s.inFlow ? " in flow" : ", overlapping"}`,
      );
    } finally {
      await context.close();
    }
  }
  {
    const { context, page } = await openPage(browser, vp, { init: noWebgl });
    let model = 0;
    page.on("request", (r) => r.url().includes("antique-camera.glb") && model++);
    try {
      await page.goto(`${base}${LAB}?motion-debug`, { waitUntil: "load" });
      await sleep(1500);
      const head = await labState(page);
      const steps = [];
      for (let k = 0; k < 5; k++) {
        await labJump(page, k / 4);
        steps.push(await labState(page));
      }
      line(
        head.posterShown && head.mode === "poster" && !head.canvas && model === 0 && steps.every((s, k) => s.act === k && s.inert.every((v, i) => v === (i !== k)) && s.posterShown),
        `${at} no WebGL: the poster stands, no model fetched, and the chapters still follow the scroll`,
        `mode ${head.mode}, model requests ${model}, acts ${steps.map((s) => s.act).join(",")}`,
      );
    } finally {
      await context.close();
    }
  }
  {
    const { context, page } = await openPage(browser, vp, { js: false });
    try {
      await page.goto(`${base}${LAB}`, { waitUntil: "load" });
      await sleep(500);
      const s = await page.evaluate(() => {
        const root = document.querySelector(".lab-scene");
        const titles = [...root.querySelectorAll("[data-scene-act] h2")];
        const rects = titles.map((h) => h.getBoundingClientRect());
        const poster = root.querySelector("img[data-scene-poster]");
        return {
          h1: document.querySelector("h1")?.textContent,
          titles: titles.filter((h) => getComputedStyle(h).visibility === "visible" && +getComputedStyle(h.closest("[data-scene-act]")).opacity === 1).length,
          inFlow: rects.every((r, i) => i === 0 || r.top >= rects[i - 1].bottom),
          poster: !!poster && poster.complete && poster.naturalWidth > 0 && poster.getBoundingClientRect().height > 0,
          pin: getComputedStyle(root.querySelector("[data-scene-pin]")).position,
        };
      });
      line(
        s.h1 === "Lab" && s.titles === 5 && s.inFlow && s.poster && s.pin !== "sticky",
        `${at} without JavaScript: the heading, the poster and all five chapters in flow`,
        `h1 "${s.h1}", ${s.titles}/5 chapters shown${s.inFlow ? " in flow" : ", overlapping"}, poster ${s.poster}, pin ${s.pin}`,
      );
    } finally {
      await context.close();
    }
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
  const shutdown = async () => {
    await browser?.close().catch(() => {});
    await stopServer(server?.child);
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
    const lineFor = (name) => (ok, what, detail) => {
      if (!ok) failures++;
      results.push(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(8)}  ${what}${detail ? `  (${detail})` : ""}`);
    };
    if (!args.only) await checkHeroHtml(server.base, lineFor("html"));
    await checkLabHtml(server.base, lineFor("html"));
    for (const name of args.browsers) {
      const line = lineFor(name);
      // /lab: the WebGL path in Chromium (SwiftShader), the fallbacks in every engine.
      if (name === "chromium") {
        browser = await chromium.launch(GL_LAUNCH);
        for (const vp of VIEWPORTS) await checkLabWebgl(browser, server.base, vp, line);
        await browser.close();
        browser = null;
      }
      browser = await ENGINES[name].launch();
      for (const vp of VIEWPORTS) await checkLabFallbacks(browser, server.base, vp, line);
      await browser.close();
      browser = null;
      if (args.only) continue;
      if (!FULL.has(name)) {
        runVerifyMotion(name, ARTICLE, server.base + ARTICLE, line);
        browser = await ENGINES[name].launch();
        for (const vp of VIEWPORTS) {
          await checkStaticFallback(browser, server.base, vp, line);
          await checkScrolly(browser, server.base, vp, line);
        }
        await browser.close();
        browser = null;
        continue;
      }
      for (const route of Object.keys(ROUTES)) runVerifyMotion(name, route, server.base + route, line);

      browser = await ENGINES[name].launch();
      for (const vp of VIEWPORTS) {
        await checkHeroNoJs(browser, server.base, vp, line);
        await checkHeroShift(browser, server.base, vp, line);
        for (const route of ["/", ARTICLE]) {
          await checkEntrances(browser, server.base, route, vp, line);
          await checkEntrancesReduced(browser, server.base, route, vp, line);
        }
        await checkRail(browser, server.base, vp, line);
        await checkRailReduced(browser, server.base, vp, line);
        await checkHeaderInk(browser, server.base, vp, line);
        await checkProgress(browser, server.base, vp, line);
        await checkReduced(browser, server.base, vp, line);
        await checkPlayhead(browser, server.base, vp, line);
        await checkScrolly(browser, server.base, vp, line);
      }
      await checkScrollyReduced(browser, server.base, VIEWPORTS[0], line);
      await checkCoverTransition(browser, server.base, VIEWPORTS[0], line);
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
