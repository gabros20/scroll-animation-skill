// journal/rust-loop: rain on the weathering-steel wall. Water runs down fixed tracks (it keeps to
// the same paths on a real wall), starting above the frame or where it spills off a plate seam.
// Each track is a darker wet line with glints that flow down it; beads slide down the tracks and
// leave them wetter behind them; faint rain falls in front. The plate is the wall with its frozen
// raindrops painted out beforehand (scripts/stills.mjs plates).
//
// Periodicity: beads and raindrops sit at fract(seed + m·phase) with integer m, and the flowing
// glints come from a noise lattice that wraps every 60 cells and shifts a whole number of periods
// per loop, so the last frame flows into the first.

import { createPlateRenderer } from '../plate.js'

export const defaultFrames = 180 // 6 s at 30 fps

const FRAGMENT = /* glsl */ `
const int TRACKS = 11;
const int BEADS = 2;
const vec3 SKY = vec3(0.82, 0.85, 0.88); // overcast sky, reflected in the water
const float SEAMS[3] = float[3](1.03, 0.785, 0.507); // above the frame, then two plate seams (uv.y)

// 1D value noise; periodic with 'period' lattice cells.
float vnoise(float x, float period) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(mod(i, period)), hash11(mod(i + 1.0, period)), u);
}

void main() {
  vec2 uv = vUv;
  vec2 px = uv * resolution;
  vec2 bend = vec2(0.0); // refraction through the beads
  float wet = 0.0;
  float glint = 0.0;
  float bead = 0.0;
  float rim = 0.0;

  for (int k = 0; k < TRACKS; k++) {
    float fk = float(k);
    // A fixed track: a slow drift plus small irregular kinks where the surface steers it.
    float x0 = (fk + 0.5 + (hash11(fk * 3.1 + 0.7) - 0.5) * 0.8) / float(TRACKS);
    float drift = (1.5 + 3.5 * hash11(fk * 5.7)) * sin(TAU * ((0.6 + 1.2 * hash11(fk * 7.3)) * uv.y + hash11(fk * 4.1)));
    float kinks = (vnoise(uv.y * 38.0 + fk * 13.0, 4096.0) - 0.5) * 2.4;
    float dx = (uv.x - x0) * resolution.x - drift - kinks;
    if (abs(dx) > 16.0) continue;
    float halfWidth = 0.8 + 0.9 * hash11(fk * 8.1);
    float top = SEAMS[int(floor(hash11(fk * 9.7) * 2.999))];
    float along = smoothstep(top + 0.003, top - 0.012, uv.y);
    if (along <= 0.0) continue;
    float travel = top + 0.05;
    float s = (top - uv.y) / travel; // 0 where the track starts, 1 below the frame

    float trail = 0.0;
    for (int j = 0; j < BEADS; j++) {
      float fj = float(j);
      float seed = hash11(fk * 13.7 + fj * 3.3);
      float m = 1.0 + floor(hash11(fk * 2.3 + fj * 7.9) * 3.0); // 1–3 trips per loop
      float at = fract(seed + m * phase);
      trail = max(trail, exp(-fract(at - s) * 6.0)); // freshly wet behind the bead
      float radius = halfWidth * 2.0 + 1.4;
      vec2 d = vec2(dx, (uv.y - (top - at * travel)) * resolution.y);
      d.y = d.y > 0.0 ? d.y / 2.4 : d.y; // a tail above, round below
      float r = length(d) / radius;
      if (r < 1.0) {
        vec3 n = vec3(d / radius, sqrt(1.0 - r * r));
        bead = max(bead, pow(max(dot(n, normalize(vec3(-0.35, 0.6, 1.0))), 0.0), 30.0));
        rim = max(rim, smoothstep(0.5, 1.0, r));
        bend += n.xy * 1.8 * (1.0 - r);
        wet = 1.0;
      }
    }

    // The film: darker steel along the track, a soft wet halo either side, and glints that flow
    // down it (lattice 60 cells per frame height, shifted 60·m cells per loop).
    float film = along * (1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.7, abs(dx)));
    float halo = along * exp(-pow(dx / (halfWidth * 4.0), 2.0));
    wet = max(wet, max(film * (0.55 + 0.45 * trail), halo * (0.2 + 0.5 * trail)));
    float flow = 1.0 + floor(hash11(fk * 6.1) * 2.0);
    float sparkle = smoothstep(0.62, 0.92, vnoise(uv.y * 60.0 + phase * 60.0 * flow + fk * 17.0, 60.0));
    float c = clamp(dx / halfWidth, -1.0, 1.0);
    float facing = pow(max(dot(vec2(c, sqrt(max(1.0 - c * c, 0.0))), normalize(vec2(-0.35, 1.0))), 0.0), 16.0);
    glint = max(glint, film * facing * sparkle);
  }

  vec3 steel = plateLinear(uv + bend / resolution);
  vec3 col = steel * mix(1.0, 0.6, clamp(wet, 0.0, 1.0));
  col *= 1.0 - 0.4 * rim;
  col += SKY * (glint * 0.16 + bead * 0.5);

  // Rain falling in front of the wall: sparse streaks, sheared by a little wind.
  float rain = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float cell = mix(23.0, 41.0, fl);
    float trips = mix(16.0, 11.0, fl); // frame heights per loop: an integer, so it wraps
    float len = mix(44.0, 70.0, fl);
    vec2 p = vec2(px.x + (resolution.y - px.y) * 0.07, px.y);
    float column = floor(p.x / cell);
    if (hash11(column * 1.37 + fl * 11.0) > 0.5) continue;
    float cx = (column + 0.2 + 0.6 * hash11(column * 2.11 + fl * 5.0)) * cell;
    float span = resolution.y + len;
    float head = fract(hash11(column * 3.3 + fl * 7.0) + trips * phase) * span;
    float d = head - (resolution.y - px.y); // px above the streak's head
    float body = step(0.0, d) * smoothstep(0.0, 5.0, d) * (1.0 - smoothstep(len * 0.5, len, d));
    float across = 1.0 - smoothstep(0.3, 1.0, abs(p.x - cx));
    rain += body * across * mix(0.1, 0.06, fl);
  }
  col += SKY * rain * 0.45;

  emit(col);
}
`

export async function setup({ width, height, frames, params }) {
  const plate = await createPlateRenderer({ width, height, plateUrl: params.plate ?? '/work/stills/plates/rust-plate.png', fragment: FRAGMENT })
  return {
    frames,
    canvas: plate.canvas,
    info: { loopSeconds: frames / 30 },
    render: (i) => plate.draw(i / frames)
  }
}
