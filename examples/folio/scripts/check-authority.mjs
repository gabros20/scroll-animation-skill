#!/usr/bin/env node
// check-authority.mjs — the per-route scroll authority, end to end, against the production build:
//
//   /          stamps <html data-scroll-authority="lenis"> and runs exactly one Lenis
//   /journal   stamps native and runs no Lenis
//   <Link>     / -> /journal -> / (client-side) flips the stamp each way, with one Lenis on the
//              lenis route and none on the native one, and no "one scroll authority" warning
//   reload     mid-page on / keeps the scroll position, and Lenis carries on from it
//
// Live Lenis instances are counted from outside: each one adds a single non-passive `wheel`
// listener on window and removes it in destroy().
//
// Run `pnpm build` first. Starts `next start` on a free port and always stops it.
//
//   node scripts/check-authority.mjs [--browsers chromium,webkit]

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { startServer, stopServer } from "./lib/next-server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINES = { chromium, webkit };
const VIEWPORT = { width: 1280, height: 800 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const out = { browsers: Object.keys(ENGINES) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--browsers") out.browsers = argv[++i].split(",");
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  for (const b of out.browsers) if (!ENGINES[b]) throw new Error(`unknown browser: ${b}`);
  return out;
}

// ── in the page ─────────────────────────────────────────────────────────

// Installed before any page script, on every document (reloads too).
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
}

const readState = (page) =>
  page.evaluate(() => ({
    path: location.pathname,
    stamp: document.documentElement.dataset.scrollAuthority ?? null,
    stamps: document.querySelectorAll("[data-scroll-authority]").length,
    lenisClass: document.documentElement.classList.contains("lenis"),
    lenis: window.__liveLenis,
    marker: window.__sameDocument === true,
  }));

const show = (s) => `${s.path}: stamp=${s.stamp} (${s.stamps} stamped) html.lenis=${s.lenisClass} live Lenis=${s.lenis}`;
const isLenis = (s) => s.stamp === "lenis" && s.stamps === 1 && s.lenisClass && s.lenis === 1;
const isNative = (s) => s.stamp === "native" && s.stamps === 1 && !s.lenisClass && s.lenis === 0;

/** Waits (up to 10 s) for `path` to be showing with `stamp` on <html>, then reads the state either way. */
async function settleOn(page, path, stamp) {
  await page
    .waitForFunction(
      ([p, a]) => location.pathname === p && document.documentElement.dataset.scrollAuthority === a,
      [path, stamp],
      { timeout: 10000 },
    )
    .catch(() => {});
  await sleep(200);
  return readState(page);
}

/** scrollY once it has held still for 30 frames. */
const restingY = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = -1;
        let still = 0;
        const step = () => {
          const y = window.scrollY;
          still = y === last ? still + 1 : 0;
          last = y;
          if (still >= 30) resolve(y);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );

async function wheel(page, notches, delta = 100) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, delta);
    await sleep(40);
  }
}

// ── checks ──────────────────────────────────────────────────────────────

async function checkBrowser(browser, base, line) {
  const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: "no-preference" });
  await context.addInitScript(countLenis);
  const problems = [];
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`error: ${e.message}`));
  page.on("console", (m) => {
    if (m.text().includes("scroll authority")) problems.push(`${m.type()}: ${m.text()}`);
  });

  try {
    await page.goto(`${base}/`);
    const home = await settleOn(page, "/", "lenis");
    line(isLenis(home), "/ stamps lenis and runs one Lenis", show(home));

    await page.goto(`${base}/journal`);
    const journal = await settleOn(page, "/journal", "native");
    line(isNative(journal), "/journal stamps native and runs no Lenis", show(journal));

    await page.goto(`${base}/`);
    await settleOn(page, "/", "lenis");
    await page.evaluate(() => (window.__sameDocument = true));
    await page.click('header nav a[href="/journal"]');
    const there = await settleOn(page, "/journal", "native");
    await page.click('header a[href="/"]');
    const back = await settleOn(page, "/", "lenis");
    line(
      there.marker && back.marker && isNative(there) && isLenis(back),
      "<Link> / -> /journal -> / flips the stamp each way, one Lenis only on /",
      `${show(there)} · ${show(back)}${there.marker && back.marker ? "" : " · a full page load happened, not a client navigation"}`,
    );

    await page.goto(`${base}/`);
    await settleOn(page, "/", "lenis");
    await wheel(page, 8);
    const before = await restingY(page);
    await page.reload();
    const reloaded = await settleOn(page, "/", "lenis");
    const after = await restingY(page);
    await wheel(page, 1);
    const next = await restingY(page);
    line(
      before > 400 && Math.abs(after - before) <= 2 && Math.abs(next - (after + 100)) <= 2 && isLenis(reloaded),
      "reload mid-page on / keeps the scroll position, and Lenis carries on from it",
      `scrollY ${before} before reload, ${after} after; one wheel notch then -> ${next} · ${show(reloaded)}`,
    );

    line(problems.length === 0, "no uncaught errors or scroll-authority warnings", problems.slice(0, 3).join(" | "));
  } finally {
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(join(root, ".next", "BUILD_ID"))) {
    console.error("[check-authority] no production build in .next: run `pnpm build` first");
    return 2;
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
  try {
    server = await startServer(root);
    for (const name of args.browsers) {
      browser = await ENGINES[name].launch();
      await checkBrowser(browser, server.base, (ok, what, detail) => {
        if (!ok) failures++;
        console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(8)}  ${what}${detail ? `  (${detail})` : ""}`);
      });
      await browser.close();
      browser = null;
    }
  } finally {
    await shutdown();
  }
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
