// Shared GLSL: our own hash-based gradient noise + the body's large-scale "lobes".
// `lobes` must stay identical to lobes() in body.js: eyes are placed on the surface from JS.

export const NOISE_GLSL = /* glsl */ `
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

// Gradient noise in [-1, 1].
float gnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
                     dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                     dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                     dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                     dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z) * 1.6;
}

float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * gnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

// Large, slow deformation of the unit direction n, plus a few bulges that swell and subside.
// Mirrors lobes() in shoggoth.js.
const vec3 BUMP_D0 = vec3(0.707, 0.707, 0.0);
const vec3 BUMP_D1 = vec3(-0.894, 0.447, 0.0);
const vec3 BUMP_D2 = vec3(0.928, -0.371, 0.0);
const vec3 BUMP_D3 = vec3(-0.6, -0.6, 0.529);
const vec3 BUMP_D4 = vec3(-0.196, 0.981, 0.0);

float bump(vec3 n, vec3 d, float t, float i) {
  return 0.17 * (0.35 + 0.65 * (0.5 + 0.5 * sin(t * 0.45 + i * 1.9))) * exp(-7.0 * (1.0 - dot(n, d)));
}

float lobes(vec3 n, float t, float ripple) {
  return 0.19 * sin(2.1 * n.x + 0.7 * t) * sin(1.7 * n.y + 0.5 * t + 1.3)
       + 0.14 * sin(2.7 * n.z + 0.9 * t + 2.1) * sin(1.3 * n.x - 0.6 * t)
       + 0.10 * sin(3.1 * n.y + 1.1 * t + 0.4)
       + ripple * 0.05 * sin(9.0 * n.y - 5.0 * t)
       + bump(n, BUMP_D0, t, 0.0) + bump(n, BUMP_D1, t, 1.0) + bump(n, BUMP_D2, t, 2.0)
       + bump(n, BUMP_D3, t, 3.0) + bump(n, BUMP_D4, t, 4.0);
}
`;

// Oil-slick skin shared by body and tendrils: near-black and wet, iridescent only at
// grazing angles, with rare thin veins of light that brighten with [pulse].
export const SKIN_GLSL = /* glsl */ `
uniform vec3 uVeinTint;   // emotion color for the veins
uniform float uVeinMix;   // 0 = natural teal/violet, 1 = fully tinted
vec3 skin(vec3 N, vec3 V, vec3 p, float t, float pulse) {
  vec3 L = normalize(vec3(0.45, 0.85, 0.55));
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 3.2);
  float swirl = fbm(p * 1.3 + vec3(0.0, t * 0.04, 0.0));
  vec3 irid = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + fres * 1.3 + swirl * 0.9 + t * 0.01));
  vec3 col = vec3(0.0035, 0.003, 0.006);
  col += irid * fres * 0.32;
  col += vec3(0.012, 0.011, 0.018) * max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  col += vec3(0.85, 0.92, 1.0) * pow(max(dot(N, H), 0.0), 140.0) * 0.9;      // wet highlight
  vec3 H2 = normalize(normalize(vec3(-0.7, 0.1, 0.6)) + V);
  col += vec3(0.4, 0.3, 0.7) * pow(max(dot(N, H2), 0.0), 50.0) * 0.12;        // cold fill
  // Veins: thin ridges of one noise octave, only where a slower mask noise allows.
  float ridge = pow(1.0 - abs(gnoise(p * 2.6 + vec3(0.0, 0.0, t * 0.03))), 48.0);
  float where = smoothstep(0.05, 0.35, gnoise(p * 0.9 + vec3(7.1)));
  vec3 vein = mix(vec3(0.05, 0.9, 0.8), vec3(0.6, 0.25, 1.0), 0.5 + 0.5 * sin(t * 0.3 + p.y * 2.0));
  vein = mix(vein, uVeinTint, uVeinMix);
  col += vein * ridge * where * (0.25 + 2.2 * pulse);
  return col;
}
`;
