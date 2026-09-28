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
//                  progress bar not drawn, and no text or image left hidden.
//
// Pages are prerendered, so a build made before `pnpm media` holds placeholders: missing media is fetched first,
// and the build is made when there is none or the media just arrived. Starts `next start` on a free port and always
// stops it.
//
//   node scripts/verify-scenes.mjs [--browsers chromium,webkit,firefox]

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const ROUTES = { "/": 2, [ARTICLE]: 0, "/blocks": 3 };
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
      const hidden = [...document.querySelectorAll("article :is(h1, p, figcaption, img, video)")].filter((el) => {
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
        content: document.querySelectorAll("article :is(h1, p, figcaption, img, video)").length,
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
    await checkHeroHtml(server.base, lineFor("html"));
    for (const name of args.browsers) {
      const line = lineFor(name);
      if (!FULL.has(name)) {
        runVerifyMotion(name, ARTICLE, server.base + ARTICLE, line);
        browser = await ENGINES[name].launch();
        for (const vp of VIEWPORTS) await checkStaticFallback(browser, server.base, vp, line);
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
