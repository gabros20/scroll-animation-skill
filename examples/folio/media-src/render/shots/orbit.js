// The scrub clip: one full, constant-speed turn around the antique camera on Folio paper.
//
// A whole turn in `frames` steps makes frame N ≡ frame 0, so the clip loops seamlessly from any
// frame back to frame 0 (ScrubVideo's head/tail loops can use the whole clip), and a linear scroll
// maps to a linear turn. The model and lights stay put; the lens orbits, so highlights travel
// across the brass and glass the way they would on a real turntable under fixed studio lights.
//
// Composition parameters are URL params (see DEFAULTS) so a still can be re-framed without edits.

import * as THREE from 'three'
import { Studio, diskSample, halton, loadModel, paperStudioEnvironment, shadowCatcher, warmUp } from '../studio.js'

export const defaultFrames = 240

export const DEFAULTS = {
  az0: -32, // degrees; where the turn starts (frame 0 = the poster): three-quarter front, lens facing right
  turn: 360, // degrees covered by the whole clip
  elev: 9, // lens elevation above the target, degrees
  fov: 22, // vertical field of view, degrees (a long lens: little perspective distortion)
  fill: 0.78, // object height as a fraction of frame height
  aimY: 0.46, // aim point, as a fraction of object height from the floor (leaves room for the shadow)
  keyAz: -48, // key light azimuth relative to the start view (negative = camera left), degrees
  keyEl: 62, // key light elevation, degrees: high enough that no shadow reaches a frame edge
  keyCone: 11, // softbox angular radius, degrees
  keyI: 3, // key intensity
  domeShare: 0.25, // fraction of passes spent on the broad sky shadow (ambient occlusion on the floor)
  envKey: 11, // image-based light: key softbox, fill, rim strip, and the room around them
  envFill: 3,
  envRim: 9,
  envRoom: 0.18, // a dim room gives the chrome some black to reflect, so it reads as metal
  envIntensity: 1,
  shadow: 0.34, // floor shadow opacity
  shadowInner: 0.3, // floor shadow fades out between these radii from the axis (× object height)
  shadowOuter: 0.56,
  aperture: 0, // lens radius in world units (0 = no depth of field)
  exposure: 1.5,
  tone: 'neutral' // Khronos PBR Neutral: keeps the wood and leather hues true
}

export async function setup({ width, height, frames, samples, params }) {
  const p = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) if (params[key] !== undefined) p[key] = typeof DEFAULTS[key] === 'number' ? Number(params[key]) : params[key]
  const deg = THREE.MathUtils.degToRad

  const studio = new Studio({ width, height, samples, toneMapping: p.tone, exposure: p.exposure, fov: p.fov })
  const { scene, camera, renderer } = studio

  const model = await loadModel(params.model ?? '/work/model/antique-camera.glb', renderer)
  scene.add(model)

  // The turntable axis is the tripod's centre column, which the camera body sits on.
  const bounds = new THREE.Box3().setFromObject(model)
  const body = new THREE.Box3().setFromObject(model.getObjectByName('camera') ?? model)
  const axis = body.getCenter(new THREE.Vector3())
  const floorY = bounds.min.y
  const objectHeight = bounds.max.y - floorY
  const target = new THREE.Vector3(axis.x, floorY + objectHeight * p.aimY, axis.z)
  const distance = (objectHeight / p.fill / 2) / Math.tan(deg(p.fov) / 2)

  // Everything that lights the object is placed relative to the start view, so "key upper left"
  // means upper left in frame 0.
  scene.environment = paperStudioEnvironment(renderer, { key: p.envKey, fill: p.envFill, rim: p.envRim, room: p.envRoom })
  scene.environmentIntensity = p.envIntensity
  scene.environmentRotation = new THREE.Euler(0, deg(p.az0), 0)

  scene.add(shadowCatcher({ y: floorY, opacity: p.shadow, center: [axis.x, axis.z], inner: objectHeight * p.shadowInner, outer: objectHeight * p.shadowOuter }))

  const key = new THREE.DirectionalLight(0xfff4e6, p.keyI)
  key.castShadow = true
  key.shadow.mapSize.set(4096, 4096)
  const reach = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, objectHeight) * 1.6
  Object.assign(key.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.5, far: reach * 6 })
  key.shadow.bias = -0.0002
  key.shadow.normalBias = 0.015
  key.shadow.radius = 2
  key.target.position.copy(target)
  scene.add(key, key.target)

  /** Direction for pass s: most passes sample the softbox (a cone around the key), the rest the
   * upper sky (only for the floor's ambient shadow; they carry no light onto the object). */
  const domeEvery = p.domeShare > 0 ? Math.round(1 / p.domeShare) : Infinity
  const lightDir = (s) => {
    const dome = Number.isFinite(domeEvery) && s % domeEvery === 0
    if (dome) {
      // Own Halton bases, indexed within the dome subset, so sky directions don't correlate with
      // the pixel jitter. High elevations only: short, soft pools under the object.
      const d = s / domeEvery + 1
      const az = 2 * Math.PI * halton(d, 17)
      const el = deg(50 + 38 * halton(d, 19))
      return { dir: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)), dome }
    }
    const [u, v] = diskSample(s, 11, 13)
    const az = deg(p.az0 + p.keyAz + u * p.keyCone)
    const el = deg(p.keyEl + v * p.keyCone)
    return { dir: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)), dome }
  }
  const domePasses = (n) => Array.from({ length: n }, (_, s) => lightDir(s).dome).filter(Boolean).length

  const pose = (i) => {
    const az = deg(p.az0 + (p.turn * i) / frames)
    const el = deg(p.elev)
    camera.position.set(target.x + distance * Math.sin(az) * Math.cos(el), target.y + distance * Math.sin(el), target.z + distance * Math.cos(az) * Math.cos(el))
    camera.up.set(0, 1, 0)
    camera.lookAt(target)
  }

  studio.dof = p.aperture > 0 ? { aperture: p.aperture, focus: target } : null
  pose(0)
  warmUp(studio)

  return {
    frames,
    canvas: studio.canvas,
    info: { bounds: [bounds.min.toArray(), bounds.max.toArray()], axis: axis.toArray(), distance, params: p },
    render: (i) => {
      const n = studio.samples
      const keyPasses = n - domePasses(n)
      studio.render((s) => {
        pose(i)
        const { dir, dome } = lightDir(s)
        key.position.copy(target).addScaledVector(dir, reach * 3)
        // Dome passes cast floor shadow only; key passes carry the light, scaled so the average
        // over all passes equals keyI.
        key.intensity = dome ? 0 : (p.keyI * n) / keyPasses
      })
    }
  }
}
