// A cinemagraph renderer: one generated photograph (the plate) redrawn per frame through a
// fragment shader that moves only part of it (heat haze, rain).
//
// Seamless by construction: the shader only ever sees `phase` in [0, 1) and every moving term is
// periodic in it with an integer number of cycles (sin(2π·m·phase), fract(seed + m·phase)), so
// frame N would equal frame 0 exactly and the loop wraps with no crossfade.

import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

const VERT = /* glsl */ `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

/** Shared GLSL: colour conversions, hashing and a dither, prepended to every plate shader. */
export const COMMON = /* glsl */ `
precision highp float;
#define TAU 6.283185307179586
uniform sampler2D plate;
uniform vec2 resolution;
uniform float phase;
in vec2 vUv;
out vec4 outColor;

vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 plateLinear(vec2 uv) { return toLinear(texture(plate, uv).rgb); }
vec3 plateLinearLod(vec2 uv, float lod) { return toLinear(textureLod(plate, uv, lod).rgb); }
void emit(vec3 linear) { outColor = vec4(toSRGB(linear) + (ign(gl_FragCoord.xy) - 0.5) / 255.0, 1.0); }
`

export async function createPlateRenderer({ width, height, plateUrl, fragment, uniforms = {} }) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  document.body.append(canvas)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace

  const texture = await new THREE.TextureLoader().loadAsync(plateUrl)
  // Raw sRGB bytes; the shader linearises by hand so blends happen in light, not in gamma.
  texture.colorSpace = THREE.NoColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: COMMON + fragment,
    uniforms: {
      plate: { value: texture },
      resolution: { value: new THREE.Vector2(width, height) },
      phase: { value: 0 },
      ...uniforms
    },
    depthTest: false,
    depthWrite: false
  })
  const quad = new FullScreenQuad(material)

  return {
    canvas,
    material,
    /** Draws phase ∈ [0, 1). */
    draw(phase) {
      material.uniforms.phase.value = phase
      renderer.setRenderTarget(null)
      quad.render(renderer)
    }
  }
}
