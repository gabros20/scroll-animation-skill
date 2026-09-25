// journal/kiln-loop: the open kiln at the end of a firing. Only the heat moves: haze rising out of
// the doorway and warping the brick arch above it, the interior glow breathing (and the room's
// light with it), and a few sparks lifting off. Everything else is the still plate.
//
// Periodicity: the noise lattice wraps in y (720 px) and in time; the haze climbs exactly one
// y-period per loop and the lattice cycles through a whole number of time-periods, so the last
// frame flows into the first. Sparks use fract(seed + m·phase) with integer m.

import { createPlateRenderer } from '../plate.js'

export const defaultFrames = 180 // 6 s at 30 fps

const FRAGMENT = /* glsl */ `
uniform vec2 opening; // centre of the kiln doorway, uv

// Value noise on a lattice that wraps with 'period' cells in each axis.
float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float pnoise(vec3 p, vec3 period) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = hash3(mod(i, period));
  float n100 = hash3(mod(i + vec3(1, 0, 0), period));
  float n010 = hash3(mod(i + vec3(0, 1, 0), period));
  float n110 = hash3(mod(i + vec3(1, 1, 0), period));
  float n001 = hash3(mod(i + vec3(0, 0, 1), period));
  float n101 = hash3(mod(i + vec3(1, 0, 1), period));
  float n011 = hash3(mod(i + vec3(0, 1, 1), period));
  float n111 = hash3(mod(i + vec3(1, 1, 1), period));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z) * 2.0 - 1.0;
}

// Rising haze: two octaves, each climbing exactly one full y-period per loop.
vec2 haze(vec2 px, float ph) {
  vec2 d = vec2(0.0);
  // octave 1: 24 px cells, 30 cells tall (= 720 px); 3 time-periods of evolution per loop
  vec3 q1 = vec3(px.x / 24.0, px.y / 24.0 - ph * 30.0, ph * 3.0);
  vec3 per1 = vec3(1024.0, 30.0, 3.0);
  d.x += pnoise(q1, per1);
  d.y += pnoise(q1 + vec3(17.0, 0.0, 0.0), per1) * 0.5;
  // octave 2: 12 px cells, 60 cells tall; climbs 60 cells (the same 720 px) per loop
  vec3 q2 = vec3(px.x / 12.0, px.y / 12.0 - ph * 60.0, ph * 5.0);
  vec3 per2 = vec3(1024.0, 60.0, 5.0);
  d.x += 0.5 * pnoise(q2, per2);
  d.y += 0.25 * pnoise(q2 + vec3(41.0, 0.0, 0.0), per2);
  return d;
}

// Where the kiln interior glows: bright, orange, sampled from a blurred mip so it's a soft region.
float glowAt(vec2 uv, float lod) {
  vec3 c = textureLod(plate, uv, lod).rgb;
  return smoothstep(0.55, 0.85, c.r) * smoothstep(0.08, 0.3, c.r - c.b);
}

void main() {
  vec2 uv = vUv;
  vec2 px = uv * resolution;
  float ph = phase;

  // Heat: inside the doorway, plus a plume that has left through the top of the arch and thins
  // as it climbs (the glow mask sampled from progressively further below).
  float inside = glowAt(uv, 3.0);
  float plume = 0.0;
  for (int k = 1; k <= 5; k++) {
    float fk = float(k);
    plume += glowAt(uv - vec2(0.0, 0.055 * fk), 4.0) * (1.0 - fk * 0.16);
  }
  plume = clamp(plume * 0.5, 0.0, 1.0) * (1.0 - inside);
  float amount = inside * 1.3 + plume * 2.4; // px
  vec2 disp = haze(px, ph) * amount / resolution;
  vec3 col = plateLinear(uv + disp);

  // The fire breathes: a slow shared swell plus drifting local variation, all whole-cycle.
  float t = ph * TAU;
  float breath = 0.05 * sin(2.0 * t + 0.4) + 0.03 * sin(5.0 * t + 1.3) + 0.015 * sin(11.0 * t + 2.2);
  float local = 0.06 * pnoise(vec3(px.x / 90.0, px.y / 90.0 - ph * 8.0, ph * 4.0), vec3(1024.0, 8.0, 4.0));
  float hot = glowAt(uv + disp, 2.0);
  col *= 1.0 + (breath + local) * hot * 1.5;
  // Light spilling into the studio rises and falls with it, weaker with distance.
  vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
  float spill = exp(-1.6 * distance(uv * aspect, opening * aspect));
  col *= 1.0 + breath * 0.55 * spill * (1.0 - hot);

  // Sparks: a few embers lifting off the load and drifting up past the arch.
  vec3 sparks = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float seed = hash11(fi * 7.13 + 1.0);
    float m = 1.0 + floor(hash11(fi * 3.71 + 2.0) * 2.0); // 1 or 2 flights per loop
    float life = fract(seed + m * ph);
    vec2 start = opening + vec2((hash11(fi * 1.93 + 3.0) - 0.5) * 0.2, (hash11(fi * 2.37 + 4.0) - 0.2) * 0.3);
    float rise = 0.5 + 0.35 * hash11(fi * 5.11 + 5.0);
    vec2 pos = start + vec2(0.02 * sin(TAU * (life * 1.3 + seed)) + 0.05 * life * (hash11(fi * 9.1) - 0.5), rise * life);
    float fade = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.35, 0.9, life));
    float radius = 0.9 + 1.1 * hash11(fi * 4.47 + 6.0);
    vec2 d = (uv - pos) * resolution;
    sparks += vec3(1.0, 0.5, 0.16) * exp(-dot(d, d) / (radius * radius)) * fade * (1.5 + 2.0 * hash11(fi * 8.83));
  }
  emit(col + sparks);
}
`

export async function setup({ width, height, frames, params }) {
  const plate = await createPlateRenderer({
    width,
    height,
    plateUrl: params.plate ?? '/work/stills/plates/kiln-plate.png',
    fragment: FRAGMENT,
    uniforms: { opening: { value: [Number(params.openingX ?? 0.373), Number(params.openingY ?? 0.5)] } }
  })
  return {
    frames,
    canvas: plate.canvas,
    info: { loopSeconds: frames / 30 },
    render: (i) => plate.draw(i / frames)
  }
}
