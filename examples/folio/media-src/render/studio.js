// An offline-quality still renderer on three.js, for frames that must hold up paused mid-scrub.
//
// Each frame is N passes. Every pass jitters the pixel grid (supersampling), moves the key light
// across a softbox-sized patch of sky (soft shadows) and, optionally, the lens across an aperture
// (depth of field); the passes average in a float target. The average is premultiplied linear
// colour + coverage, which the composite pass tone-maps and lays over flat Folio paper. The paper
// never goes through the tone curve, so every pixel the object and its shadow don't touch is
// exactly #f5f1e8 and the frame edges meet the page seamlessly.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

export const PAPER = '#f5f1e8'

/** Radical inverse in `base`: a low-discrepancy sequence, so N samples cover their domain evenly. */
export function halton(index, base) {
  let f = 1
  let r = 0
  while (index > 0) {
    f /= base
    r += f * (index % base)
    index = Math.floor(index / base)
  }
  return r
}

/** Point in the unit disk for sample s (concentric-ish mapping of two Halton dimensions). */
export function diskSample(s, baseA = 5, baseB = 7) {
  const r = Math.sqrt(halton(s + 1, baseA))
  const a = 2 * Math.PI * halton(s + 1, baseB)
  return [r * Math.cos(a), r * Math.sin(a)]
}

const QUAD_VERT = /* glsl */ `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const ACCUMULATE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D prev;
uniform sampler2D cur;
uniform float weight;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = texture(prev, vUv) + texture(cur, vUv) * weight;
}`

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D accum;
uniform vec3 paper;      // linear
uniform float exposure;
uniform int toneMap;     // 0 none, 1 Khronos PBR Neutral, 2 AgX
uniform vec3 grade;      // per-channel gain on the object after tone mapping (white balance)
in vec2 vUv;
out vec4 outColor;

vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

// AgX (Troy Sobotka), as three.js ships it: sRGB-linear in, sRGB-linear out.
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color) {
  const mat3 toRec2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
  const mat3 fromRec2020 = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
  const mat3 inset = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302321396049);
  const mat3 outset = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  color = toRec2020 * color;
  color = inset * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - minEv) / (maxEv - minEv);
  color = clamp(color, 0.0, 1.0);
  color = agxContrast(color);
  color = outset * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = fromRec2020 * color;
  return clamp(color, 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Interleaved gradient noise: a fixed, blue-ish dither so soft shadows don't band at 8 bits.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec4 a = texture(accum, vUv);
  float coverage = clamp(a.a, 0.0, 1.0);
  vec3 color = coverage > 1e-5 ? a.rgb / coverage : vec3(0.0);
  color *= exposure;
  if (toneMap == 1) color = neutral(color);
  else if (toneMap == 2) color = agx(color);
  color *= grade;
  vec3 linear = color * coverage + paper * (1.0 - coverage);
  vec3 srgb = toSRGB(linear) + (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(srgb, 1.0);
}`

const TONE_MAPS = { none: 0, neutral: 1, agx: 2 }

export class Studio {
  constructor({ width, height, samples = 64, paper = PAPER, toneMapping = 'neutral', exposure = 1, grade = [1, 1, 1], fov = 24 }) {
    this.width = width
    this.height = height
    this.samples = samples
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    document.body.append(this.canvas)

    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(1)
    renderer.setSize(width, height, false)
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace // the composite encodes sRGB itself
    renderer.toneMapping = THREE.NoToneMapping // …and tone-maps itself, object only
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer = renderer

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 400)

    this.sampleTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 })
    const accumOptions = { type: THREE.FloatType, depthBuffer: false }
    this.accum = [new THREE.WebGLRenderTarget(width, height, accumOptions), new THREE.WebGLRenderTarget(width, height, accumOptions)]

    this.accumulateQuad = new FullScreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: QUAD_VERT,
        fragmentShader: ACCUMULATE_FRAG,
        uniforms: { prev: { value: null }, cur: { value: null }, weight: { value: 1 } },
        depthTest: false,
        depthWrite: false
      })
    )
    const paperLinear = new THREE.Color(paper) // hex is sRGB; Color stores linear
    this.compositeQuad = new FullScreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: QUAD_VERT,
        fragmentShader: COMPOSITE_FRAG,
        uniforms: {
          accum: { value: null },
          paper: { value: new THREE.Vector3(paperLinear.r, paperLinear.g, paperLinear.b) },
          exposure: { value: exposure },
          toneMap: { value: TONE_MAPS[toneMapping] ?? 1 },
          grade: { value: new THREE.Vector3(...grade) }
        },
        depthTest: false,
        depthWrite: false
      })
    )

    /** Depth of field: when set, the lens wanders over a disk of `aperture` radius while every
     * pass stays aimed at `focus`, so only the focus plane stays sharp. */
    this.dof = null
  }

  /** Renders one frame. `pose(s, n)` sets up pass s of n (camera, lights) before it's drawn. */
  render(pose) {
    const { renderer, scene, camera, width, height, samples } = this
    const clear = (target) => {
      renderer.setRenderTarget(target)
      renderer.setClearColor(0x000000, 0)
      renderer.clear()
    }
    clear(this.accum[0])
    const aim = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    for (let s = 0; s < samples; s++) {
      pose(s, samples)
      if (this.dof) {
        const [dx, dy] = diskSample(s, 5, 7)
        camera.updateMatrixWorld()
        right.setFromMatrixColumn(camera.matrixWorld, 0)
        up.setFromMatrixColumn(camera.matrixWorld, 1)
        camera.position.addScaledVector(right, dx * this.dof.aperture).addScaledVector(up, dy * this.dof.aperture)
        aim.copy(this.dof.focus)
        camera.lookAt(aim)
      }
      camera.setViewOffset(width, height, halton(s + 1, 2) - 0.5, halton(s + 1, 3) - 0.5, width, height)
      clear(this.sampleTarget)
      renderer.render(scene, camera)

      const [prev, next] = this.accum
      const material = this.accumulateQuad.material
      material.uniforms.prev.value = prev.texture
      material.uniforms.cur.value = this.sampleTarget.texture
      material.uniforms.weight.value = 1 / samples
      renderer.setRenderTarget(next)
      this.accumulateQuad.render(renderer)
      this.accum = [next, prev]
    }
    camera.clearViewOffset()
    this.compositeQuad.material.uniforms.accum.value = this.accum[0].texture
    renderer.setRenderTarget(null)
    this.compositeQuad.render(renderer)
  }
}

/** A warm paper studio for image-based lighting: a paper-toned room, a paper floor, one large
 * key softbox upper left, a dim fill right and a thin rim strip behind. Brass and glass reflect
 * these shapes; the room keeps shadows from going dead. Returns a PMREM texture. */
export function paperStudioEnvironment(renderer, { key = 7, fill = 1.6, rim = 5, room = 0.55 } = {}) {
  const env = new THREE.Scene()
  const paper = new THREE.Color(PAPER)
  const basic = (color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
  env.add(new THREE.Mesh(new THREE.SphereGeometry(60, 64, 32), new THREE.MeshBasicMaterial({ color: paper.clone().multiplyScalar(room), side: THREE.BackSide })))
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), basic(paper.clone().multiplyScalar(room * 1.25)))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -6
  env.add(floor)
  const panel = (w, h, intensity, position, tint = 0xffffff) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic(new THREE.Color(tint).multiplyScalar(intensity)))
    mesh.position.set(...position)
    mesh.lookAt(0, 0, 0)
    env.add(mesh)
  }
  panel(22, 14, key, [-26, 24, 20], 0xfff6ea) // key softbox, a touch warm
  panel(16, 18, fill, [30, 6, 10], 0xf4f1ec) // fill, opposite side
  panel(3, 30, rim, [10, 10, -32]) // rim strip behind
  const pmrem = new THREE.PMREMGenerator(renderer)
  const texture = pmrem.fromScene(env, 0.035).texture
  pmrem.dispose()
  return texture
}

export async function loadModel(url, renderer) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync(url)
  const anisotropy = renderer.capabilities.getMaxAnisotropy()
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return
    node.castShadow = true
    node.receiveShadow = true
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (node.material[key]) node.material[key].anisotropy = anisotropy
  })
  return gltf.scene
}

/** An invisible floor that only shows shadow: premultiplied colour × coverage in the float
 * target, laid over paper by the composite like everything else. The shadow fades out between
 * `inner` and `outer` world units from `center` (x, z), so however the light falls, no shadow
 * reaches a frame edge and the frame always meets the page on flat paper. */
export function shadowCatcher({ y = 0, opacity = 0.32, color = 0x3b2f24, center = [0, 0], inner = 2.2, outer = 4 } = {}) {
  const material = new THREE.ShadowMaterial({ color, opacity })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.catcherCenter = { value: new THREE.Vector2(...center) }
    shader.uniforms.catcherRadii = { value: new THREE.Vector2(inner, outer) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCatcherWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvCatcherWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 catcherCenter;\nuniform vec2 catcherRadii;\nvarying vec3 vCatcherWorld;')
      .replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        'float catcherFade = 1.0 - smoothstep(catcherRadii.x, catcherRadii.y, distance(vCatcherWorld.xz, catcherCenter));\n\tgl_FragColor = vec4( color, opacity * catcherFade * ( 1.0 - getShadowMask() ) );'
      )
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = y
  floor.receiveShadow = true
  return floor
}

/** Waits until every texture in the scene has been uploaded, by rendering it once. */
export function warmUp(studio) {
  studio.renderer.compile(studio.scene, studio.camera)
  studio.renderer.setRenderTarget(studio.sampleTarget)
  studio.renderer.render(studio.scene, studio.camera)
  studio.renderer.setRenderTarget(null)
}
