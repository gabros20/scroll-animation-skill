#!/usr/bin/env node
// The one object: Khronos glTF-Sample-Assets "AntiqueCamera", pinned to a commit.
//
//   1. download the separate-file glTF + its licence files into $WORK/model/src/
//   2. refuse to continue unless metadata.json still says CC0-1.0 for "Everything"
//   3. paint the UX3D logo off the tripod leg (base colour + metallic-roughness). The logo is a
//      trademark the CC0 grant excludes, and Folio shows no real brands.
//   4. gltf-transform optimize → $WORK/model/antique-camera.glb (meshopt geometry, WebP textures;
//      no KTX2: the `ktx` CLI isn't part of this toolchain). Named meshes stay separate so /lab's
//      chapters can still find "camera" and "tripod".
//
// usage: node scripts/model.mjs [--texture-size 2048]

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SRC, ensureDir, mb, paths, sh } from './lib/work.mjs'

export const MODEL_COMMIT = '81e8b567643b5166e6ff40024e4ff71ad4b18676'
const BASE = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${MODEL_COMMIT}`
const DIR = `${BASE}/Models/AntiqueCamera`
const FILES = [
  'LICENSE.md',
  'README.md',
  'metadata.json',
  'glTF/AntiqueCamera.gltf',
  'glTF/AntiqueCamera.bin',
  'glTF/camera_camera_BaseColor.png',
  'glTF/camera_camera_Normal.png',
  'glTF/camera_camera_Roughness.png',
  'glTF/camera_tripod_BaseColor.png',
  'glTF/camera_tripod_Normal.png',
  'glTF/camera_tripod_Roughness.png'
]
export const BUDGET_BYTES = 3 * 1024 * 1024

const args = process.argv.slice(2)
const sizeArg = args.indexOf('--texture-size')
const textureSize = sizeArg === -1 ? 2048 : Number(args[sizeArg + 1])

const src = ensureDir(join(paths.model, 'src'))
const clean = ensureDir(join(paths.model, 'debranded'))
const out = join(paths.model, 'antique-camera.glb')

// 1. download (skips files already present)
async function download() {
  for (const file of [...FILES.map((f) => [`${DIR}/${f}`, f]), [`${BASE}/LICENSES/LicenseRef-LegalMark-UX3D.txt`, 'LicenseRef-LegalMark-UX3D.txt']]) {
    const [url, rel] = file
    const dest = join(src, rel)
    if (existsSync(dest)) continue
    ensureDir(join(dest, '..'))
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    console.log(`downloaded ${rel}`)
  }
}

// 2. licence gate
function checkLicence() {
  const meta = JSON.parse(readFileSync(join(src, 'metadata.json'), 'utf8'))
  const model = meta.legal.find((l) => l.what === 'Everything')
  if (model?.spdx !== 'CC0-1.0') throw new Error(`AntiqueCamera licence changed: ${JSON.stringify(model)}`)
  console.log(`licence: ${model.text} (${model.spdx}), © ${model.year} ${model.owner}, artist ${model.artist}`)
  return model
}

// 3. debrand: the logo sits on one leg strip of the tripod atlas (x 1084–1135, y 820–1027 at
// 2048²). Clone the same strip from 280 px further down over it through a feathered mask, in
// both textures that carry it (the normal map doesn't).
function debrand() {
  for (const f of FILES.filter((f) => f.startsWith('glTF/'))) copyFileSync(join(src, f), join(clean, f.slice(5)))
  for (const tex of ['camera_tripod_BaseColor.png', 'camera_tripod_Roughness.png']) {
    const file = join(clean, tex)
    const patch = join(paths.model, `patch-${tex}`)
    sh('magick', [join(src, 'glTF', tex), '-crop', '102x270+1062+1070', '+repage', '(', '-size', '102x270', 'xc:black', '-fill', 'white', '-draw', 'rectangle 16,26 85,243', '-blur', '0x5', ')', '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', patch])
    sh('magick', [join(src, 'glTF', tex), patch, '-geometry', '+1062+790', '-compose', 'over', '-composite', file])
  }
}

// 4. optimize
function optimize() {
  sh('npx', ['gltf-transform', 'optimize', join(clean, 'AntiqueCamera.gltf'), out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(textureSize), '--join-named', 'false'], { cwd: SRC })
  const bytes = statSync(out).size
  const source = FILES.filter((f) => f.startsWith('glTF/')).reduce((sum, f) => sum + statSync(join(src, f)).size, 0)
  console.log(`antique-camera.glb: ${mb(bytes)} MB (source glTF + PNGs: ${mb(source)} MB; budget ${mb(BUDGET_BYTES)} MB)`)
  if (bytes > BUDGET_BYTES) throw new Error('over the /lab budget; rerun with --texture-size 1024')
}

await download()
checkLicence()
debrand()
optimize()
