// GLSL shaders for planets, rings, stars, the black hole ray tracer and post FX.

export const planetVert = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const planetFrag = /* glsl */`
uniform sampler2D map; uniform sampler2D ringTex;
uniform vec3 sunDir; uniform vec3 center; uniform vec3 ringN; uniform vec3 atmo;
uniform float radius; uniform float rIn; uniform float rOut; uniform float ringOn;
uniform float sunPower; uniform float limbK; uniform float night;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = sunDir;
  vec3 alb = texture2D(map, vUv).rgb;
  float nl = dot(N, L);
  float diff = clamp((nl + 0.03) / 1.03, 0.0, 1.0);
  diff = diff * (0.82 + 0.18 * smoothstep(0.0, 0.5, nl));
  float mu = max(dot(N, V), 0.0);
  float limb = mix(1.0, pow(mu, 0.32), limbK);
  float sh = 1.0;
  if (ringOn > 0.5) {
    float dn = dot(L, ringN);
    if (abs(dn) > 1e-4) {
      float t = -dot(vW - center, ringN) / dn;
      if (t > 0.0) {
        vec3 hp = vW + L * t;
        float r = length(hp - center) / radius;
        if (r > rIn && r < rOut) {
          float a = texture2D(ringTex, vec2(0.5, (r - rIn) / (rOut - rIn))).a;
          sh = 1.0 - pow(a, 1.3) * 0.88;
        }
      }
    }
  }
  vec3 col = alb * diff * limb * sh * sunPower;
  // faint ringshine / night side
  col += alb * night * (1.0 - diff);
  float rim = pow(1.0 - mu, 2.5);
  col += atmo * rim * smoothstep(-0.25, 0.6, nl) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;

export const haloFrag = /* glsl */`
uniform vec3 sunDir; uniform vec3 atmo; uniform float edge;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float k = smoothstep(0.0, edge, -dot(N, V));
  float lit = smoothstep(-0.35, 0.5, dot(-N, sunDir) * -1.0);
  float g = pow(k, 1.6) * lit;
  gl_FragColor = vec4(atmo * g, 1.0);
}`;

export const ringVert = /* glsl */`
varying vec3 vW; varying vec3 vL;
void main(){
  vL = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const ringFrag = /* glsl */`
uniform sampler2D ringTex; uniform vec3 sunDir; uniform vec3 center; uniform vec3 ringN;
uniform float radius; uniform float rIn; uniform float rOut; uniform float opacity; uniform float sunPower;
uniform vec3 tint; uniform float uTime;
varying vec3 vW; varying vec3 vL;
float rh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rn(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rh(i), rh(i + vec3(1,0,0)), f.x), mix(rh(i + vec3(0,1,0)), rh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rh(i + vec3(0,0,1)), rh(i + vec3(1,0,1)), f.x), mix(rh(i + vec3(0,1,1)), rh(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main(){
  float r = length(vL.xz);
  if (r < rIn || r > rOut) discard;
  vec4 t = texture2D(ringTex, vec2(0.5, (r - rIn) / (rOut - rIn)));
  float ang = atan(vL.z, vL.x);
  float a2 = ang - uTime * 0.7 / pow(r, 1.5);
  float clump = 0.6 * rn(vec3(cos(a2) * 9.0, sin(a2) * 9.0, r * 60.0)) + 0.4 * rn(vec3(cos(a2) * 26.0, sin(a2) * 26.0, r * 150.0));
  float cm = 0.72 + 0.56 * clump;
  float a = clamp(pow(t.a, 1.25) * opacity * cm, 0.0, 1.0);
  vec3 V = normalize(cameraPosition - vW);
  float sl = dot(sunDir, ringN);
  float vl = dot(V, ringN);
  float sameSide = step(0.0, sl * vl);
  float lit = mix(0.18 + 0.5 * (1.0 - t.a), 1.0, sameSide);
  float scatter = pow(max(dot(-V, sunDir), 0.0), 6.0) * (1.0 - sameSide) * 1.5;
  vec3 oc = vW - center;
  float b = dot(oc, sunDir);
  float d = length(oc - sunDir * b);
  float sh = b < 0.0 ? smoothstep(radius * 0.96, radius * 1.01, d) : 1.0;
  vec3 col = t.rgb * tint * (lit + scatter) * sh * sunPower * (0.55 + 0.45 * abs(sl)) * (0.85 + 0.3 * clump);
  gl_FragColor = vec4(col * a, a);
}`;

export const pointsVert = /* glsl */`
attribute vec3 color; attribute float aSize;
uniform float uScale; uniform float uBright; uniform float uMin; uniform float uMax; uniform float uPx;
varying vec3 vC; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float z = max(-mv.z, 1e-3);
  float s = aSize * uScale / z;
  vA = uBright * clamp(s * s / (uMin * uMin), 0.0, 1.0) * clamp(uMax / max(s, 1e-3), 0.0, 1.0);
  gl_PointSize = clamp(s, uMin, uMax) * uPx;
  vC = color;
  gl_Position = projectionMatrix * mv;
}`;

export const pointsFrag = /* glsl */`
varying vec3 vC; varying float vA; uniform float uSharp;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float f = exp(-dot(d, d) * uSharp);
  gl_FragColor = vec4(vC * f * vA, 1.0);
}`;

export const skyVert = /* glsl */`
attribute vec3 color; attribute float aSize; uniform float uPx;
varying vec3 vC;
void main(){
  vC = color;
  gl_PointSize = aSize * uPx;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}`;

export const skyFrag = /* glsl */`
varying vec3 vC;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float f = exp(-dot(d, d) * 14.0);
  gl_FragColor = vec4(vC * f, 1.0);
}`;

export const quadVert = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Schwarzschild black hole: photons integrated with a = -1.5 h^2 r / |r|^5 (r_s = 1)
export const bhFrag = /* glsl */`
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uFov; uniform float uRs; uniform float uDisk; uniform float uExposure;
uniform vec3 uCamPos; uniform vec3 uBH; uniform mat3 uCamRot; uniform mat4 uViewProj;
uniform samplerCube uSky; uniform sampler2D uScene; uniform float uDiskGain; uniform float uGlow; uniform float uMirror;
varying vec2 vUv;
#define DIN 3.0
#define DOUT 14.0
#define STEPS 260

float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n3(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }

vec3 blackbody(float T){
  float t = T / 100.0; vec3 c;
  c.r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
  c.g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0) : clamp(1.129891 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0));
  return pow(c, vec3(2.2));
}

vec4 disk(vec3 hp, float r, vec3 dir){
  float ang = atan(hp.z, hp.x);
  float w = 0.55 * (0.5 + 0.5 * pow(DIN / r, 1.5));
  float a2 = ang - uTime * w;
  vec3 q = vec3(cos(a2) * 1.6, sin(a2) * 1.6, r * 1.9);
  float n = fbm(q * 1.3);
  float n2 = fbm(vec3(cos(a2) * 6.0, sin(a2) * 6.0, r * 9.0));
  float fine = 0.78 + 0.22 * sin(r * 11.0 + n * 9.0 + n2 * 6.0);
  float x = DIN / r;
  float prof = pow(x, 0.75) * pow(max(1.0 - sqrt(x) * 0.985, 0.0), 0.25);
  prof /= 0.488;
  vec3 vel = normalize(vec3(-hp.z, 0.0, hp.x)) * sqrt(0.5 / (r - 1.0));
  float gam = inversesqrt(1.0 - dot(vel, vel));
  float D = 1.0 / (gam * (1.0 + dot(vel, normalize(dir))));
  D = mix(1.0, D, 0.55);
  float g = D * sqrt(1.0 - 1.0 / r);
  float T = 4300.0 * prof * g + 1400.0;
  vec3 c = blackbody(T) * pow(g, 3.0) * prof * uDiskGain;
  float dens = smoothstep(DIN, DIN + 0.35, r) * smoothstep(DOUT, DOUT - 7.0, r);
  dens *= (0.45 + 0.75 * n) * fine * (0.8 + 0.4 * n2);
  float a = clamp(dens * 1.15, 0.0, 1.0) * uDisk;
  return vec4(c * (0.6 + 0.8 * n) * (0.85 + 0.3 * n2) * (1.0 + 1.2 * (1.0 - uDisk) * uDisk), a);
}

// what the camera would see in direction d without the hole: the live frame, or the live cube outside it
vec3 background(vec3 d){
  vec4 clip = uViewProj * vec4(d, 0.0);
  if (uMirror > 0.5){
    // the frame alone, mirror-tiled, so light bent in from off-screen still lands on the photo
    vec2 uv = clip.xy / (abs(clip.w) + 1e-4) * 0.5 + 0.5;
    uv = abs(mod(uv + 1.0, 2.0) - 1.0);
    return texture2D(uScene, uv).rgb;
  }
  vec3 cube = textureCube(uSky, d).rgb;
  if (clip.w <= 0.0) return cube;
  vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
  float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float w = smoothstep(0.0, 0.025, e);
  if (w <= 0.0) return cube;
  return mix(cube, texture2D(uScene, clamp(uv, 0.0, 1.0)).rgb, w);
}

void main(){
  vec2 suv = gl_FragCoord.xy / uRes;
  if (uRs < 1e-4){ gl_FragColor = vec4(texture2D(uScene, suv).rgb, 1.0); return; }
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 rd = normalize(uCamRot * vec3(p * 2.0 * tan(uFov * 0.5), -1.0));
  vec3 pos = (uCamPos - uBH) / uRs;
  vec3 dir = rd;
  vec3 hv = cross(pos, dir); float h2 = dot(hv, hv);
  vec3 col = vec3(0.0); float alpha = 0.0; float glow = 0.0;
  bool captured = false;
  float far = max(60.0, length(pos) * 1.2);
  for (int i = 0; i < STEPS; i++){
    float r = length(pos);
    float dt = clamp(r * 0.045, 0.02, 1e6);
    vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);
    dir += acc * dt;
    vec3 np = pos + dir * dt;
    if (uDisk > 0.0 && pos.y * np.y < 0.0){
      float t = pos.y / (pos.y - np.y);
      vec3 hp = mix(pos, np, t);
      float rr = length(hp.xz);
      if (rr > DIN && rr < DOUT){
        vec4 d = disk(hp, rr, dir);
        col += (1.0 - alpha) * d.rgb * d.a;
        alpha += (1.0 - alpha) * d.a;
      }
    }
    float rr2 = length(np.xz);
    if (rr2 > DIN * 0.9 && rr2 < DOUT) glow += exp(-abs(np.y) * 5.0) * dt * smoothstep(DOUT, DIN, rr2) * uGlow * uDisk;
    pos = np;
    float r2 = length(pos);
    if (r2 < 1.0){ captured = true; break; }
    if (r2 > far && dot(pos, dir) > 0.0) break;
    if (alpha > 0.995) break;
  }
  vec3 bg = captured ? vec3(0.0) : background(normalize(dir));
  col += (1.0 - alpha) * bg;
  col += vec3(1.0, 0.62, 0.32) * glow * (1.0 - alpha * 0.6);
  gl_FragColor = vec4(col * uExposure, 1.0);
}`;

export const fxFrag = /* glsl */`
uniform sampler2D tDiffuse; uniform vec2 uCenter; uniform vec2 uRes; uniform vec2 uShake;
uniform float uZoom; uniform float uFade; uniform float uTime; uniform float uGrain; uniform float uVig; uniform float uGlitch;
uniform vec3 uFadeCol;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 samp(vec2 uv){ return texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb; }
void main(){
  // shake: offset inside a slightly zoomed frame so no edge ever shows
  float sh = length(uShake);
  vec2 uv = (vUv - 0.5) * (1.0 - min(sh * 2.0, 0.06)) + 0.5 + uShake;
  if (uGlitch > 0.001){
    float fr = floor(uTime * 24.0);
    float row = floor(uv.y * 36.0);
    float n = hash(vec2(row, fr));
    uv.x += step(1.0 - uGlitch * 0.45, n) * (hash(vec2(row * 1.7, fr + 3.0)) - 0.5) * 0.14 * uGlitch;
    float band = step(0.93, hash(vec2(floor(uv.y * 9.0), fr + 7.0))) * uGlitch;
    uv.y += band * 0.02;
  }
  vec3 col;
  if (uZoom > 0.001){
    col = vec3(0.0);
    for (int i = 0; i < 20; i++){
      float f = 1.0 - uZoom * 0.3 * float(i) / 19.0;
      col += samp(uCenter + (uv - uCenter) * f);
    }
    col /= 20.0;
  } else col = samp(uv);
  if (uGlitch > 0.001){
    vec2 off = vec2(0.012 * uGlitch, 0.0);
    col.r = samp(uv + off).r;
    col.b = samp(uv - off).b;
    float blk = step(0.992, hash(floor(vUv * vec2(24.0, 14.0)) + floor(uTime * 18.0)));
    col = mix(col, vec3(dot(col, vec3(0.33))) * vec3(0.7, 1.2, 1.4), blk * uGlitch * 0.6);
    col *= 1.0 - 0.18 * uGlitch * step(0.5, fract(vUv.y * uRes.y * 0.25));
  }
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * uVig;
  col = mix(col, uFadeCol, uFade);
  col += (hash(vUv * uRes + fract(uTime) * 91.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

// Almaty photo drawn inside WebGL for the launch, so the post effects can act on it
export const photoVert = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const photoFrag = /* glsl */`
uniform sampler2D map; uniform float uImgA; uniform float uScrA; uniform float uScale; uniform vec2 uCenter;
uniform float uBright; uniform float uOpacity; uniform float uDark;
varying vec2 vUv;
void main(){
  vec2 f = uScrA > uImgA ? vec2(1.0, uImgA / uScrA) : vec2(uScrA / uImgA, 1.0);
  vec2 uv = uCenter + (vUv - 0.5) * f / uScale;
  vec3 c = texture2D(map, uv).rgb * uBright;
  // thinning atmosphere: the blue drains to black from the top of the frame
  float top = smoothstep(0.0, 1.0, vUv.y);
  vec3 deep = vec3(0.002, 0.005, 0.016);
  c = mix(c, deep + c * 0.08, clamp(uDark * (0.6 + 0.6 * top), 0.0, 1.0));
  gl_FragColor = vec4(c * uOpacity, uOpacity);
}`;
