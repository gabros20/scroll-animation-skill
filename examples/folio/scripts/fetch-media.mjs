#!/usr/bin/env node
// Downloads the `media-v1` GitHub Release asset for gabros20/scroll-animation-skill,
// verifies its SHA-256 against media/manifest.sha256, and unpacks it into
// public/media/ (gitignored). Run as `pnpm media`, then build: the pages are
// prerendered, and a build made without the media renders CSS-gradient
// placeholders (src/components/media-slot.tsx) in its place. The shot list is
// in docs/designs/folio-art-direction.md; media-src/ is what made it.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = "gabros20";
const REPO = "scroll-animation-skill";
const TAG = "media-v1";
const ASSET = "media-v1.tar.gz";
const DOWNLOAD_URL = `https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/${ASSET}`;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const manifestPath = path.join(projectRoot, "media", "manifest.sha256");
const publicMediaDir = path.join(projectRoot, "public", "media");

const SHA256_LINE = /^([a-f0-9]{64})(?:\s+\S+)?$/i;

/** Returns the lowercase expected hash, or null if the manifest has no hash line. */
function readExpectedHash() {
  const raw = readFileSync(manifestPath, "utf8");
  const line = raw
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && !entry.startsWith("#"));

  const match = line ? SHA256_LINE.exec(line) : null;
  return match ? match[1].toLowerCase() : null;
}

async function main() {
  const expectedHash = readExpectedHash();
  if (!expectedHash) {
    console.error(`media/manifest.sha256 has no SHA-256 line for ${ASSET}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Fetching ${DOWNLOAD_URL}`);

  let response;
  try {
    response = await fetch(DOWNLOAD_URL);
  } catch (cause) {
    console.error(`Could not download ${DOWNLOAD_URL}`);
    console.error(`  network error: ${cause instanceof Error ? cause.message : cause}`);
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    console.error(`Could not download ${DOWNLOAD_URL}`);
    console.error(`  GitHub responded ${response.status} ${response.statusText}`);
    process.exitCode = 1;
    return;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHash = createHash("sha256").update(bytes).digest("hex");

  if (actualHash !== expectedHash) {
    console.error(
      `SHA-256 mismatch for ${ASSET}.\n  expected ${expectedHash}\n  got      ${actualHash}\nNot unpacking.`,
    );
    process.exitCode = 1;
    return;
  }

  mkdirSync(publicMediaDir, { recursive: true });
  const tmpFile = path.join(tmpdir(), ASSET);
  writeFileSync(tmpFile, bytes);

  try {
    execFileSync("tar", ["-xzf", tmpFile, "-C", publicMediaDir], { stdio: "inherit" });
  } catch (cause) {
    console.error(
      `Downloaded and verified ${ASSET}, but could not unpack it. Is "tar" on PATH?`,
    );
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
    return;
  } finally {
    rmSync(tmpFile, { force: true });
  }

  console.log(`Unpacked ${ASSET} (${bytes.byteLength} bytes) into ${publicMediaDir}`);
}

main();
