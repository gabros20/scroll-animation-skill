// next-server.mjs — `next build` and `next start` for the check scripts: a free port, its own process group,
// always stopped.
//
//   const server = await startServer(root)   // { child, base }
//   …
//   await stopServer(server.child)

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const NEXT_BIN = createRequire(import.meta.url).resolve("next/dist/bin/next");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** `next build` in `root`, output inherited; returns its exit status. */
export function nextBuild(root) {
  return spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: root, stdio: "inherit" }).status ?? 1;
}

// Its own process group off Windows, so stopping it also stops anything it spawned.
const GROUP = process.platform !== "win32";

/** Starts `next start` for the production build in `root` and waits until it answers. */
export async function startServer(root) {
  const port = await freePort();
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    detached: GROUP,
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}:\n${log}`);
    try {
      if ((await fetch(base)).ok) return { child, base };
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await stopServer(child);
      throw new Error(`next start did not answer within 30 s:\n${log}`);
    }
    await sleep(200);
  }
}

export function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    const kill = (signal) => {
      try {
        if (GROUP) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // already gone
      }
    };
    kill("SIGTERM");
    setTimeout(() => kill("SIGKILL"), 5000).unref();
  });
}
