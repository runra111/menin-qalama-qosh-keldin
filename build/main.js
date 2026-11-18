import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import * as SH from './shaders.js';
import { Sfx } from './sfx.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const $ = (s) => document.querySelector(s);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  in: (k) => k * k * k,
  out: (k) => 1 - Math.pow(1 - k, 3),
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
};
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const sfx = new Sfx();

const ASSETS = JSON.parse($('#assets').textContent);
function b64buf(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

// ---------- renderer & post ----------
const canvas = $('#gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('#loader').classList.add('err');
  $('#loaderText').textContent = 'WebGL қосылмаған. Презентацияны Chrome немесе Edge браузерінде ашыңыз';
  throw e;
}
const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.3, 250000);
const space = new THREE.Scene();
const lensScene = new THREE.Scene();
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(space, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.4, 1.4);
composer.addPass(bloom);
const fx = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uRes: { value: new THREE.Vector2(1, 1) },
    uShake: { value: new THREE.Vector2() }, uZoom: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 }, uGrain: { value: 0.012 },
    uVig: { value: 0.55 }, uGlitch: { value: 0 }, uFadeCol: { value: new THREE.Color(0, 0, 0) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: SH.fxFrag,
});
composer.addPass(fx);
composer.addPass(new OutputPass());
let quality = 1;

// scene as the camera sees it, fed to the black-hole lens
const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const cubeRT = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const cubeCam = new THREE.CubeCamera(0.3, 250000, cubeRT);

// ---------- world ----------
const SUN = V(-0.55, 0.38, 0.74).normalize();
const SAT = { c: V(0, 0, 0), R: 10 };
const NEP = { c: V(-1200, 150, -2600), R: 4.2 };
const GAL = { c: V(-3300, -40, 1600), S: 40 };
const RS = 1.6; // Schwarzschild radius of the black hole in world units
const BH = (() => {
  // just behind and to the left of Neptune as seen from its slide camera
  const az = 0.72, el = 0.1, d = 21;
  const cam = V(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d).add(NEP.c);
  const fwd = NEP.c.clone().sub(cam).normalize();
  const right = fwd.clone().cross(V(0, 1, 0)).normalize();
  return NEP.c.clone().addScaledVector(fwd, 20).addScaledVector(right, -6);
})();
// hero shot: camera between the hole and the galactic centre, looking outward at a darker sky
const BH_AZ = (() => { const d = GAL.c.clone().sub(BH); return Math.atan2(d.x, d.z) + 0.5; })();

// light for the glTF characters (planets use their own shaders)
{
  const sunLight = new THREE.DirectionalLight(0xfff2e6, 3.2);
  sunLight.position.copy(SUN).multiplyScalar(100);
  space.add(sunLight, new THREE.AmbientLight(0x8a96b8, 0.35), new THREE.HemisphereLight(0xc4cee8, 0x262a36, 1.1));
}

// ---------- loaders ----------
const texLoader = new THREE.TextureLoader();
async function tex(name, srgb = true) {
  const t = await texLoader.loadAsync(ASSETS[name]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
function planetGeometry(buf) {
  const dv = new DataView(buf);
  const nv = dv.getUint32(0, true), ni = dv.getUint32(4, true);
  let o = 8;
  const P = new Float32Array(buf, o, nv * 3); o += nv * 12;
  const N = new Float32Array(buf, o, nv * 3); o += nv * 12;
  const U = new Float32Array(buf, o, nv * 2); o += nv * 8;
  const I = new Uint16Array(buf, o, ni);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  return g;
}
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- builders ----------
const updaters = [];
function makePlanet({ geo, map, ringTex, R, center, parent = space, tilt, atmo, rIn, rOut, ringOpacity = 1, ringTint = V(1, 1, 1), spin, limbK = 0.45, haloEdge = 0.22, haloScale = 1.035 }) {
  const group = new THREE.Group();
  if (parent === space) group.position.copy(center);
  group.quaternion.setFromUnitVectors(V(0, 1, 0), tilt.clone().normalize());
  parent.add(group);
  const ringN = tilt.clone().normalize();
  const uni = {
    map: { value: map }, ringTex: { value: ringTex }, sunDir: { value: SUN }, center: { value: center }, ringN: { value: ringN },
    atmo: { value: atmo }, radius: { value: R }, rIn: { value: rIn }, rOut: { value: rOut }, ringOn: { value: ringTex ? 1 : 0 },
    sunPower: { value: 2.3 }, limbK: { value: limbK }, night: { value: 0.006 },
  };
  const body = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: uni, vertexShader: SH.planetVert, fragmentShader: SH.planetFrag }));
  body.scale.setScalar(R);
  group.add(body);
  const halo = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: SUN }, atmo: { value: atmo }, edge: { value: haloEdge } },
    vertexShader: SH.planetVert, fragmentShader: SH.haloFrag, side: THREE.BackSide, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.setScalar(R * haloScale);
  group.add(halo);
  if (ringTex) {
    const rg = new THREE.RingGeometry(rIn, rOut, 384, 3);
    rg.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(rg, new THREE.ShaderMaterial({
      uniforms: {
        ringTex: { value: ringTex }, sunDir: { value: SUN }, center: { value: center }, ringN: { value: ringN }, radius: { value: R },
        rIn: { value: rIn }, rOut: { value: rOut }, opacity: { value: ringOpacity }, sunPower: { value: 2.4 }, tint: { value: ringTint },
      },
      vertexShader: SH.ringVert, fragmentShader: SH.ringFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    ring.scale.setScalar(R);
    ring.renderOrder = 2;
    group.add(ring);
  }
  updaters.push((t) => { body.rotation.y = t * spin; });
  return group;
}

function makeMoon(map, r, group, R, orbitR, theta) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map }, ringTex: { value: null }, sunDir: { value: SUN }, center: { value: new THREE.Vector3() }, ringN: { value: V(0, 1, 0) },
      atmo: { value: V(0, 0, 0) }, radius: { value: r }, rIn: { value: 0 }, rOut: { value: 0 }, ringOn: { value: 0 },
      sunPower: { value: 2.9 }, limbK: { value: 0.0 }, night: { value: 0.0 },
    },
    vertexShader: SH.planetVert, fragmentShader: SH.planetFrag,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
  m.scale.setScalar(r / R);
  m.position.set(Math.cos(theta) * orbitR, 0, Math.sin(theta) * orbitR);
  group.add(m);
}

const pointsVertFade = SH.pointsVert
  .replace('* clamp(uMax / max(s, 1e-3), 0.0, 1.0)', '* mix(1.0, clamp(uMax / max(s, 1e-3), 0.0, 1.0), uFadeBig)')
  .replace('uniform float uPx;', 'uniform float uPx; uniform float uFadeBig;');
function pointsMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 }, uPx: { value: DPR }, ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { value: v }])) },
    vertexShader: pointsVertFade, fragmentShader: SH.pointsFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function makeSky() {
  const n = 9000, rng = mulberry(7);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([s * Math.cos(a) * 1e5, u * 1e5, s * Math.sin(a) * 1e5], i * 3);
    const t = rng();
    const c = t < 0.12 ? [0.62, 0.72, 1.0] : t < 0.7 ? [0.95, 0.96, 1.0] : t < 0.9 ? [1.0, 0.9, 0.74] : [1.0, 0.74, 0.5];
    const m = Math.pow(rng(), 7), b = 0.08 + m * 1.6;
    col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    size[i] = 1.4 + m * 2.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({ uniforms: { uPx: { value: DPR } }, vertexShader: SH.skyVert, fragmentShader: SH.skyFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false; p.renderOrder = -1;
  space.add(p);
  return p;
}

function makeGalaxy(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const raw = new Float32Array(buf, 4, n * 3);
  const rgb = new Uint8Array(buf, 4 + n * 12, n * 3);
  const rng = mulberry(11);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = raw[i * 3] * GAL.S; pos[i * 3 + 1] = raw[i * 3 + 2] * GAL.S; pos[i * 3 + 2] = raw[i * 3 + 1] * GAL.S;
    const m = 0.35 + Math.pow(rng(), 4) * 1.6;
    col.set([Math.pow(rgb[i * 3] / 255, 2.2) * m, Math.pow(rgb[i * 3 + 1] / 255, 2.2) * m, Math.pow(rgb[i * 3 + 2] / 255, 2.2) * m], i * 3);
    size[i] = 0.7 + rng() * 0.9;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const starsMat = pointsMaterial({ uBright: 1.6, uMin: 1.1, uMax: 3.2, uSharp: 12, uFadeBig: 0, base: 9 });
  const stars = new THREE.Points(g, starsMat);
  const m = Math.floor(n / 3);
  const gp = new Float32Array(m * 3), gc = new Float32Array(m * 3), gs = new Float32Array(m);
  for (let i = 0; i < m; i++) { gp.set(pos.subarray(i * 9, i * 9 + 3), i * 3); gc.set(col.subarray(i * 9, i * 9 + 3), i * 3); gs[i] = 0.6 + rng() * 0.8; }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  gg.setAttribute('aSize', new THREE.BufferAttribute(gs, 1));
  const glowMat = pointsMaterial({ uBright: 0.012, uMin: 2, uMax: 40, uSharp: 7, uFadeBig: 1, base: 300 });
  const glow = new THREE.Points(gg, glowMat);
  const grp = new THREE.Group();
  grp.add(glow, stars);
  grp.position.copy(GAL.c);
  grp.rotation.y = 0.6;
  stars.frustumCulled = glow.frustumCulled = false;
  space.add(grp);
  return { mats: [starsMat, glowMat] };
}

// gas torn off Neptune, spiralling into the hole and heating up
function makeDebris() {
  const n = 2600, rng = mulberry(5);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const seeds = [];
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = NEP.R * (0.6 + rng() * 0.5);
    seeds.push({ off: V(s * Math.cos(a) * r, u * r * 0.6, s * Math.sin(a) * r), delay: rng(), spin: 3 + rng() * 3, b: 0.4 + rng() * 1.2 });
    size[i] = 0.8 + rng() * 1.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = pointsMaterial({ uBright: 1.0, uMin: 1.0, uMax: 5.0, uSharp: 9, uFadeBig: 0, base: 0.35 });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  space.add(pts);
  const cold = new THREE.Color(0.35, 0.55, 1.0), hot = new THREE.Color(1.0, 0.62, 0.3);
  const tmp = new THREE.Vector3(), c = new THREE.Color();
  function set(progress, srcPos) {
    pts.visible = progress > 0 && progress < 1;
    if (!pts.visible) return;
    for (let i = 0; i < n; i++) {
      const sd = seeds[i];
      const tau = clamp01((progress - sd.delay * 0.55) / 0.45);
      tmp.copy(srcPos).add(sd.off).sub(BH);
      const r0 = Math.hypot(tmp.x, tmp.z), a0 = Math.atan2(tmp.z, tmp.x);
      const r = THREE.MathUtils.lerp(r0, RS * 3.2, Math.pow(tau, 0.8));
      const a = a0 + sd.spin * tau * tau;
      const y = tmp.y * Math.pow(1 - tau, 2);
      pos[i * 3] = BH.x + Math.cos(a) * r; pos[i * 3 + 1] = BH.y + y; pos[i * 3 + 2] = BH.z + Math.sin(a) * r;
      c.copy(cold).lerp(hot, tau);
      const vis = smooth(0, 0.08, tau) * (1 - smooth(0.85, 1, tau)) * sd.b * (0.4 + 1.6 * tau);
      col[i * 3] = c.r * vis; col[i * 3 + 1] = c.g * vis; col[i * 3 + 2] = c.b * vis;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
  return { mats: [mat], set };
}

function setPointScale(mats, heightPx, fovDeg, px) {
  const k = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  for (const m of mats) { m.uniforms.uScale.value = k * m.uniforms.base.value; m.uniforms.uPx.value = px; }
}

// ---------- camera ----------
let shot = null, flying = false, shake = 0;
const curTgt = new THREE.Vector3();
function setCam(pos, tgt) {
  camera.position.copy(pos);
  curTgt.copy(tgt);
  camera.lookAt(tgt);
}
function orbitShot(center, dist, az0, el, shift, drift = 0.004) {
  const t0 = performance.now() / 1000;
  return (now) => {
    const az = az0 + (now - t0) * drift;
    const pos = V(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(center);
    const fwd = center.clone().sub(pos).normalize();
    const right = fwd.clone().cross(V(0, 1, 0)).normalize();
    return { pos, tgt: center.clone().addScaledVector(right, -shift * dist) };
  };
}
function driftShot(from, to, speed) {
  const t0 = performance.now() / 1000;
  return (now) => ({ pos: from.clone().lerp(to, Math.min(1, (now - t0) * speed)), tgt: to.clone() });
}
const shots = {
  saturn: () => orbitShot(SAT.c, 82, 0.45, 0.2, 0.26, 0.004),
  neptune: () => orbitShot(NEP.c, 21, 0.72, 0.1, 0.3, 0.0),
  bh: () => orbitShot(BH, 26 * RS, BH_AZ, 0.115, 0.25, 0.0),
  galaxy: () => driftShot(GAL.c.clone().add(V(2600, 9800, 11500)), GAL.c, 0.006),
};

const tweens = [];
function tween(dur, fn, e = ease.inOut) {
  return new Promise((res) => { tweens.push({ t0: performance.now(), dur: dur * 1000, fn, e, res }); });
}
function flyTo(next, dur, via = [], { zoom = 0, ez = ease.inOut, focus = null, onK = null } = {}) {
  flying = true;
  const fromPos = camera.position.clone(), fromTgt = curTgt.clone();
  const end0 = next(performance.now() / 1000 + dur);
  const curve = new THREE.CatmullRomCurve3([fromPos, ...via, end0.pos], false, 'centripetal');
  return tween(dur, (k) => {
    const e = next(performance.now() / 1000);
    const pos = curve.getPoint(k).lerp(e.pos, smooth(0.85, 1, k));
    const ahead = curve.getPoint(Math.min(1, k + 0.04));
    const tgt = focus
      ? fromTgt.clone().lerp(focus, smooth(0.0, 0.3, k)).lerp(e.tgt, smooth(0.6, 1.0, k))
      : ahead.clone().lerp(fromTgt, 1 - smooth(0.08, 0.35, k)).lerp(e.tgt, smooth(0.55, 0.97, k));
    setCam(pos, tgt);
    if (onK) onK(k);
    if (zoom) fx.uniforms.uZoom.value = zoom * Math.pow(Math.sin(Math.PI * k), 2);
  }, ez).then(() => { shot = next; flying = false; if (zoom) fx.uniforms.uZoom.value = 0; });
}

// ---------- black hole lens ----------
const lensMat = new THREE.ShaderMaterial({
  uniforms: {
    uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uFov: { value: THREE.MathUtils.degToRad(camera.fov) },
    uRs: { value: 0 }, uDisk: { value: 0 }, uExposure: { value: 1 }, uCamPos: { value: new THREE.Vector3() }, uBH: { value: BH },
    uCamRot: { value: new THREE.Matrix3() }, uViewProj: { value: new THREE.Matrix4() },
    uSky: { value: cubeRT.texture }, uScene: { value: sceneRT.texture }, uDiskGain: { value: 1.15 }, uGlow: { value: 0.007 }, uMirror: { value: 0 },
  },
  vertexShader: SH.quadVert, fragmentShader: SH.bhFrag, depthTest: false, depthWrite: false,
});
{ const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMat); q.frustumCulled = false; lensScene.add(q); }

// ---------- Almaty photo inside WebGL (for the launch) ----------
const photoMat = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: null }, uImgA: { value: 2000 / 1334 }, uScrA: { value: innerWidth / innerHeight }, uScale: { value: 1.12 },
    uCenter: { value: new THREE.Vector2(0.5, 0.55) }, uBright: { value: 0.3 }, uOpacity: { value: 1 }, uDark: { value: 0 },
  },
  vertexShader: SH.photoVert, fragmentShader: SH.photoFrag, transparent: true, depthTest: false, depthWrite: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
});
const photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), photoMat);
photoMesh.frustumCulled = false; photoMesh.renderOrder = 1000; photoMesh.visible = false;
space.add(photoMesh);

// ---------- characters: astronaut, pig, Bart ----------
const gltfLoader = new GLTFLoader();
const mixers = [];
function parseGLB(name) { return new Promise((res, rej) => gltfLoader.parse(b64buf(ASSETS[name]), '', res, rej)); }
function instance(gltf, height, anchor = 'mid') {
  const root = SkeletonUtils.clone(gltf.scene);
  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); } });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const k = height / size.y;
  root.scale.multiplyScalar(k);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
  root.position.set(-c.x, anchor === 'feet' ? -box.min.y * k : -c.y, -c.z);
  const holder = new THREE.Group();
  holder.add(root);
  const mixer = new THREE.AnimationMixer(root);
  mixers.push(mixer);
  const actions = {};
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  const find = (part) => actions[Object.keys(actions).find((n) => n.toLowerCase().includes(part))] || Object.values(actions)[0];
  return { holder, root, mixer, actions, find };
}
const camBasis = () => {
  const m = camera.matrixWorld.elements;
  return { right: V(m[0], m[1], m[2]), up: V(m[4], m[5], m[6]), fwd: V(-m[8], -m[9], -m[10]) };
};

let astro = null, pig = null, bart = null;
const astroState = { mode: 'off', d: 13 };
function astroFollow(d) { astroState.mode = 'follow'; astroState.d = d; astro.holder.visible = true; }
function astroWave() {
  const fl = astro.find('float'), wv = astro.find('wave');
  if (!wv || wv === fl) return;
  fl.fadeOut(0.4);
  wv.reset().setLoop(THREE.LoopOnce, 1); wv.clampWhenFinished = true; wv.fadeIn(0.4).play();
  const done = (e) => { if (e.action !== wv) return; astro.mixer.removeEventListener('finished', done); wv.fadeOut(0.6); fl.reset().fadeIn(0.6).play(); };
  astro.mixer.addEventListener('finished', done);
}
// floats diagonally across the frame, bottom-left to top-right, a fair way in front of Saturn
const ASTRO_DUR = 18, ASTRO_D = 22;
function astroPass() {
  camera.updateMatrixWorld();
  const { right, up, fwd } = camBasis();
  const hh = ASTRO_D * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), hw = hh * camera.aspect;
  const at = (x, y) => camera.position.clone().addScaledVector(fwd, ASTRO_D).addScaledVector(right, x * hw).addScaledVector(up, y * hh);
  astroState.p0 = at(-0.62, -1.25);
  astroState.p1 = at(0.66, 1.25);
  astroState.t0 = performance.now() / 1000 + 1.2;
  astroState.mode = 'pass';
  astro.holder.visible = false;
  astro.find('wave') && astro.find('wave').stop();
  astro.find('float').reset().play();
}
const tmpO = new THREE.Object3D();
updaters.push((t) => {
  if (!astro || astroState.mode !== 'pass') return;
  const k = (performance.now() / 1000 - astroState.t0) / ASTRO_DUR;
  if (k < 0) return;
  if (k >= 1) { astroState.mode = 'off'; astro.holder.visible = false; return; }
  astro.holder.visible = true;
  const pos = astroState.p0.clone().lerp(astroState.p1, k);
  astro.holder.position.copy(pos);
  // body faces where he is heading, with a slow drifting roll
  tmpO.position.copy(pos); tmpO.lookAt(astroState.p1);
  astro.holder.quaternion.copy(tmpO.quaternion);
  astro.holder.rotateY(-0.6);
  astro.holder.rotateZ(0.25 * Math.sin(t * 0.4));
  astro.holder.rotateX(0.15 * Math.sin(t * 0.27));
});

// a character tumbles across the frame, from off-screen left to off-screen right
function flyby(inst, dur, d, y0, y1, spin) {
  camera.updateMatrixWorld();
  const { right, up, fwd } = camBasis();
  const base = camera.position.clone().addScaledVector(fwd, d);
  const p0 = base.clone().addScaledVector(right, -d * 0.85).addScaledVector(up, d * y0);
  const p1 = base.clone().addScaledVector(right, d * 0.85).addScaledVector(up, d * y1);
  const axis = V(Math.random() - 0.5, 1, Math.random() - 0.5).normalize();
  const q0 = camera.quaternion.clone();
  inst.holder.visible = true;
  return tween(dur, (k) => {
    inst.holder.position.lerpVectors(p0, p1, k);
    inst.holder.quaternion.copy(q0);
    inst.holder.rotateOnAxis(axis, spin * k * Math.PI * 2);
  }, ease.linear).then(() => { inst.holder.visible = false; });
}
let flybyGen = 0;
async function neptuneVisitors() {
  const gen = ++flybyGen;
  const alive = () => gen === flybyGen && cur === 3;
  await wait(2.5);
  while (alive()) {
    if (!busy) { sfx.whoosh(2.2, 300, 2400, 0.25); flyby(pig, 6, 10, 0.05, -0.12, 1.4); }
    await wait(7);
    if (!alive()) break;
    if (!busy) { sfx.whoosh(2.2, 250, 2000, 0.25); flyby(bart, 7.5, 9, -0.2, 0.12, -0.8); }
    await wait(11);
  }
}
function stopVisitors() { flybyGen++; if (pig) pig.holder.visible = false; if (bart) bart.holder.visible = false; }

// ---------- easter egg: Bart and the pig dance in front of KBTU ----------
const eggScene = new THREE.Scene();
const eggCam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
eggCam.position.set(0, 1.45, 6.4); eggCam.lookAt(0, 1.45, 0);
const eggPhoto = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.clone(photoMat.uniforms),
  vertexShader: SH.photoVert, fragmentShader: SH.photoFrag, depthTest: false, depthWrite: false,
});
{ const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), eggPhoto); q.frustumCulled = false; q.renderOrder = -10; eggScene.add(q); }
eggScene.add(new THREE.HemisphereLight(0xdfe8ff, 0x403830, 1.3));
const eggKey = new THREE.DirectionalLight(0xffffff, 2.2); eggKey.position.set(-2, 4, 5); eggScene.add(eggKey);
const party = [new THREE.PointLight(0xff3d9a, 0, 0, 0), new THREE.PointLight(0x2ee6ff, 0, 0, 0)];
party.forEach((l) => eggScene.add(l));
let bartE = null, pigE = null, eggT0 = 0;
function shadowBlob(r) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.005;
  return m;
}
function beatPhase() {
  const p = sfx.party;
  if (p && sfx.ctx) return (sfx.t - p.t0) / (p.step * 2);
  return performance.now() / 1000 * 118 / 60;
}
function bounce(k) {
  const n = 7.5625, d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
  return n * (k -= 2.625 / d) * k + 0.984375;
}
updaters.push(() => {
  if (mode !== 'egg' || !bartE) return;
  const t = performance.now() / 1000 - eggT0;
  const b = beatPhase(), f = b - Math.floor(b), hit = Math.pow(1 - f, 4);
  const drop = (delay) => { const k = clamp01((t - delay) / 0.9); return 4 * (1 - bounce(k)); };
  bartE.holder.position.y = drop(0.15);
  const hop = Math.abs(Math.sin(Math.PI * b));
  pigE.holder.position.y = drop(0.45) + hop * 0.35;
  const sq = 1 - 0.14 * hit;
  pigE.holder.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  pigE.holder.rotation.y = pigYaw + 0.5 * Math.sin(Math.PI * b * 0.5);
  pigE.holder.rotation.z = 0.12 * Math.sin(Math.PI * b);
  eggPhoto.uniforms.uBright.value = 0.36 + 0.1 * hit;
  party[0].position.set(Math.sin(t * 1.3) * 2.5, 2.2, 1.5 + Math.cos(t * 1.3));
  party[1].position.set(Math.sin(t * 1.3 + Math.PI) * 2.5, 2.2, 1.5 + Math.cos(t * 1.3 + Math.PI));
  party.forEach((l) => { l.intensity = 0.8 + 1.6 * hit; });
});
let pigYaw = 0;
function startEgg() {
  eggPhoto.uniforms.map.value = photoMat.uniforms.map.value;
  eggPhoto.uniforms.uScrA.value = innerWidth / innerHeight;
  eggPhoto.uniforms.uScale.value = 1.1; eggPhoto.uniforms.uCenter.value.set(0.5, 0.55);
  eggPhoto.uniforms.uOpacity.value = 1; eggPhoto.uniforms.uDark.value = 0;
  eggT0 = performance.now() / 1000;
  const dance = bartE.find('mixamo');
  if (dance) dance.reset().play();
  const idle = pigE.find('idle');
  if (idle) idle.reset().play();
  setMode('egg');
  sfx.partyOn();
}

// ---------- modes ----------
let mode = 'space';
function setMode(m) {
  mode = m;
  if (m === 'egg') {
    renderPass.scene = eggScene; renderPass.camera = eggCam;
    bloom.strength = 0.3; bloom.radius = 0.4; bloom.threshold = 1.2;
  } else if (m === 'lens') {
    renderPass.scene = lensScene; renderPass.camera = orthoCam;
    bloom.strength = 0.85; bloom.radius = 0.55; bloom.threshold = 0.75;
  } else {
    renderPass.scene = space; renderPass.camera = camera;
    bloom.strength = 0.35; bloom.radius = 0.4; bloom.threshold = 1.4;
  }
  applyQuality();
}
function applyQuality() {
  const pr = mode === 'lens' ? DPR * quality * 0.85 : DPR;
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr);
  sceneRT.setSize(w, h);
  lensMat.uniforms.uRes.value.set(w, h);
  fx.uniforms.uRes.value.set(w, h);
}

// ---------- Neptune being torn apart ----------
let nepHolder, nepCenter, debris;
const nepState = { e: 0 };
function placeNeptune(e) {
  nepState.e = e;
  if (e >= 0.985) { nepHolder.visible = false; nepCenter.copy(BH); return BH.clone(); }
  const rel = NEP.c.clone().sub(BH);
  const phi = 2.4 * e * e;
  rel.applyAxisAngle(V(0, 1, 0), phi).multiplyScalar(Math.pow(1 - e, 1.1));
  const p = BH.clone().add(rel);
  const u = BH.clone().sub(p).normalize();
  const s = 1 + 3.2 * e * e, q = (1 - 0.75 * e) / Math.sqrt(s);
  // stretch along the line to the hole, squeeze across it
  const m3 = new THREE.Matrix3().set(
    q + (s - q) * u.x * u.x, (s - q) * u.x * u.y, (s - q) * u.x * u.z,
    (s - q) * u.y * u.x, q + (s - q) * u.y * u.y, (s - q) * u.y * u.z,
    (s - q) * u.z * u.x, (s - q) * u.z * u.y, q + (s - q) * u.z * u.z,
  );
  const m4 = new THREE.Matrix4().setFromMatrix3(m3);
  m4.setPosition(p);
  nepHolder.matrix.copy(m4);
  nepHolder.matrixWorldNeedsUpdate = true;
  nepCenter.copy(p);
  nepHolder.visible = e < 0.985;
  return p;
}

// ---------- DOM state ----------
const photoWrap = $('#photo'), photoImg = $('#photoImg'), scrim = $('#scrim'), place = $('#place'), caption = $('#caption'), flash = $('#flash');
const slides = [...document.querySelectorAll('.slide')];
const PHOTO = {
  intro: { tf: 'scale(1.04)', fl: 'brightness(.96) saturate(1.02)', op: 1 },
  plan: { tf: 'scale(1.12) translateY(2%)', fl: 'brightness(.5) saturate(.85) blur(2px)', op: 1 },
  home: { tf: 'scale(1.07)', fl: 'brightness(.55) saturate(.9) blur(1px)', op: 1 },
  thanks: { tf: 'scale(1.16)', fl: 'brightness(.32) saturate(.8) blur(4px)', op: 1 },
  hidden: { tf: 'scale(1.04)', fl: 'brightness(.96)', op: 0 },
};
let photoOpaque = true;
function photo(state, dur = 2.4, opDur = 1.2, opDelay = 0, fromTf = null) {
  const s = PHOTO[state];
  if (fromTf || dur < 0.05) {
    photoImg.style.transition = 'none';
    photoImg.style.transform = fromTf || s.tf;
    photoImg.style.filter = s.fl;
    void photoImg.offsetWidth;
    photoImg.style.transition = '';
  }
  photoImg.style.transitionDuration = `${dur}s, ${dur}s`;
  photoImg.style.transform = s.tf;
  photoImg.style.filter = s.fl;
  if (opDur < 0.05) { photoWrap.style.transition = 'none'; photoWrap.style.opacity = s.op; void photoWrap.offsetWidth; }
  photoWrap.style.transition = `opacity ${opDur}s cubic-bezier(.22,1,.36,1) ${opDelay}s`;
  photoWrap.style.opacity = s.op;
  photoOpaque = s.op === 1;
}
function showPanel(i) { slides.forEach((s, j) => { s.classList.toggle('on', j === i); s.classList.remove('glitching'); }); }
function hidePanels() { slides.forEach((s) => s.classList.remove('on')); }
function setFlash(color, op, dur) { flash.style.background = color; flash.style.transition = `opacity ${dur}s ease`; flash.style.opacity = op; }
function ambience(i) {
  if (i !== 7) sfx.partyOff();
  if (i >= 2 && i <= 4) sfx.droneOn(i === 4 ? 0.035 : 0.06); else sfx.droneOff();
  if (i === 4) { sfx.rumbleOn(); sfx.rumbleLevel(0.12, 1); } else sfx.rumbleOff();
}

const N_SLIDES = slides.length;
const TOTAL = N_SLIDES + 1; // the last step is the easter egg
let cur = -1, busy = false;
function hud() {
  const shown = Math.min(cur + 1, N_SLIDES);
  $('#count').textContent = `${shown} / ${N_SLIDES}`;
  $('#bar i').style.transform = `scaleX(${shown / N_SLIDES})`;
  $('#notesBody').textContent = slides[cur] ? slides[cur].dataset.notes || '' : '';
}

function applyState(i) {
  fx.uniforms.uZoom.value = 0; fx.uniforms.uFade.value = 0; fx.uniforms.uGlitch.value = 0; shake = 0;
  photoMesh.visible = false;
  caption.classList.remove('on');
  const photoState = { 0: 'intro', 1: 'plan', 5: 'home', 6: 'thanks' }[i];
  photo(photoState || 'hidden', 0.01, 0.01);
  place.classList.toggle('on', i <= 1 || i === 5);
  scrim.classList.toggle('on', i !== 6);
  placeNeptune(i >= 4 ? 1 : 0);
  debris.set(0, NEP.c);
  lensMat.uniforms.uMirror.value = 0; lensMat.uniforms.uBH.value = BH;
  lensMat.uniforms.uRs.value = i >= 4 ? RS : 0;
  lensMat.uniforms.uDisk.value = i >= 4 ? 1 : 0;
  if (photoState) { setMode('space'); shot = null; }
  if (i === 2) { setMode('space'); shot = shots.saturn(); }
  if (i === 3) { setMode('space'); shot = shots.neptune(); }
  if (i === 4) { setMode('lens'); shot = shots.bh(); cubeDirty = 2; }
  stopVisitors();
  astroState.mode = 'off'; astro.holder.visible = false;
  if (i === 3) neptuneVisitors();
  if (i === 7) { photo('hidden', 0.01, 0.01); place.classList.remove('on'); scrim.classList.remove('on'); startEgg(); }
  if (shot) { const s = shot(performance.now() / 1000); setCam(s.pos, s.tgt); }
  if (i === 2) astroPass();
  ambience(i);
  showPanel(i);
}

async function forward(i) {
  if (i === 1) {
    hidePanels();
    photo('plan', 1.6, 0.1);
    await wait(0.5);
    showPanel(1);
    return;
  }
  if (i === 2) return launch();
  if (i === 3) {
    hidePanels(); scrim.classList.remove('on');
    astroState.mode = 'world';
    sfx.whoosh(6.5, 140, 2600, 0.4);
    await flyTo(shots.neptune(), 7, [SAT.c.clone().add(V(40, 22, 150)), V(-420, 260, -900), NEP.c.clone().add(V(160, 40, 220))], { zoom: 0.75 });
    sfx.thud();
    astro.holder.visible = false;
    scrim.classList.add('on');
    showPanel(3);
    neptuneVisitors();
    return;
  }
  if (i === 4) { stopVisitors(); return blackHoleForms(); }
  if (i === 7) {
    sfx.scratch();
    setFlash('#fff', 0.85, 0.06);
    await wait(0.12);
    hidePanels(); place.classList.remove('on'); scrim.classList.remove('on');
    photo('hidden', 0.01, 0.01);
    startEgg();
    setFlash('#fff', 0, 0.5);
    return;
  }
  if (i === 5) return fallIn();
  if (i === 6) {
    hidePanels(); place.classList.remove('on'); scrim.classList.remove('on');
    photo('thanks', 2.0, 0.1);
    await wait(0.6);
    showPanel(6);
  }
}

// Almaty -> glitch -> impact -> straight up through the sky -> galaxy -> Saturn
async function launch() {
  const sl = slides[1];
  sl.classList.add('glitching');
  sfx.glitch(0.9);
  setMode('space');
  shot = shots.galaxy();
  { const s = shot(performance.now() / 1000); setCam(s.pos, s.tgt); }
  photoMat.uniforms.uScrA.value = innerWidth / innerHeight;
  photoMat.uniforms.uScale.value = 1.12; photoMat.uniforms.uCenter.value.set(0.5, 0.55);
  photoMat.uniforms.uBright.value = 0.3; photoMat.uniforms.uOpacity.value = 1; photoMat.uniforms.uDark.value = 0;
  photoMesh.visible = true;
  photo('hidden', 0.01, 0.01);
  place.classList.remove('on');
  await tween(0.9, (k) => { fx.uniforms.uGlitch.value = 0.3 + 0.55 * Math.abs(Math.sin(k * 11)) * k; }, ease.linear);
  hidePanels(); scrim.classList.remove('on');
  fx.uniforms.uGlitch.value = 0;
  // impact
  sfx.boom(1);
  sfx.riser(3.2);
  fx.uniforms.uFadeCol.value.set(1, 1, 1);
  tween(0.7, (k) => { fx.uniforms.uFade.value = 1 - k; }, ease.out);
  shake = 0.02;
  const f = photoMat.uniforms;
  await tween(3.4, (k) => {
    const sc = 1.12 * Math.pow(7, ease.in(k));
    f.uScale.value = sc;
    const fy = Math.min(1, (2000 / 1334) / (innerWidth / innerHeight));
    const cy = Math.min(THREE.MathUtils.lerp(0.55, 0.95, ease.out(k)), 1 - (0.5 * fy) / sc);
    f.uCenter.value.set(0.5, cy);
    f.uBright.value = THREE.MathUtils.lerp(0.42, 0.6, k);
    f.uDark.value = smooth(0.1, 0.8, k);
    f.uOpacity.value = 1 - smooth(0.62, 1.0, k);
    fx.uniforms.uZoom.value = 0.95 * Math.sin(Math.PI * Math.min(1, k * 1.1));
    shake = 0.02 * (1 - k) + 0.004;
  }, ease.linear);
  photoMesh.visible = false;
  photoOpaque = false;
  shake = 0;
  fx.uniforms.uZoom.value = 0;
  sfx.droneOn(0.05);
  await wait(1.2);
  sfx.whoosh(7, 100, 3200, 0.5, 0.4);
  astro.find('float').reset().play();
  await flyTo(shots.saturn(), 7.5, [GAL.c.clone().add(V(1600, 4200, 7400)), V(700, 900, 2600), V(80, 40, 300)], {
    zoom: 0.9, ez: ease.inOutSine,
  });
  sfx.thud();
  astroPass();
  scrim.classList.add('on');
  showPanel(2);
}

// a black hole is born beside Neptune and eats it
async function blackHoleForms() {
  hidePanels(); scrim.classList.remove('on');
  setMode('lens');
  cubeDirty = 2;
  const u = lensMat.uniforms;
  u.uRs.value = 0; u.uDisk.value = 0;
  sfx.rumbleOn();
  let roared = false, captioned = false, swung = null;
  await tween(9.0, (k) => {
    u.uRs.value = RS * Math.pow(smooth(0.0, 0.42, k), 1.4);
    const e = ease.in(smooth(0.16, 0.66, k));
    const p = placeNeptune(e);
    debris.set(smooth(0.22, 0.86, k), p);
    u.uDisk.value = smooth(0.5, 0.72, k);
    shake = 0.006 * smooth(0.08, 0.5, k) * (1 - smooth(0.62, 0.85, k)) + 0.012 * smooth(0.5, 0.56, k) * (1 - smooth(0.56, 0.7, k));
    sfx.rumbleLevel(0.08 + 0.75 * smooth(0.05, 0.55, k) - 0.55 * smooth(0.7, 1, k));
    if (!captioned && k > 0.1) { captioned = true; caption.classList.add('on'); }
    if (captioned && k > 0.48) caption.classList.remove('on');
    if (!roared && k > 0.52) { roared = true; sfx.roar(); bloom.strength = 1.15; }
    if (roared) bloom.strength = THREE.MathUtils.lerp(1.15, 0.85, smooth(0.52, 0.8, k));
    if (!swung && k > 0.62) {
      const d = 26 * RS, el = 0.115;
      const pt = (az, dd, e2) => V(Math.sin(az) * Math.cos(e2), Math.sin(e2), Math.cos(az) * Math.cos(e2)).multiplyScalar(dd).add(BH);
      const az0 = Math.atan2(camera.position.x - BH.x, camera.position.z - BH.z);
      const via = [0.3, 0.55, 0.8].map((t) => pt(THREE.MathUtils.lerp(az0, BH_AZ, t), d * (1.05 + 0.25 * Math.sin(Math.PI * t)), el + 0.12 * Math.sin(Math.PI * t)));
      swung = flyTo(shots.bh(), 5.2, via, { ez: ease.inOutSine, focus: BH });
    }
  }, ease.linear);
  if (swung) await swung;
  shake = 0;
  debris.set(1, BH);
  cubeDirty = 2;
  scrim.classList.add('on');
  showPanel(4);
}

// fall through the horizon and come out at home
async function fallIn() {
  hidePanels(); scrim.classList.remove('on');
  flying = true;
  sfx.rumbleLevel(0.5, 1.5);
  sfx.sink(4.4);
  const p0 = camera.position.clone().sub(BH), t0 = curTgt.clone();
  await tween(4.6, (k) => {
    const e = ease.in(k);
    const pos = p0.clone().multiplyScalar(1 - e * 0.955).add(BH);
    const tgt = t0.clone().lerp(BH, ease.inOut(Math.min(1, k * 1.6)));
    setCam(pos, tgt);
    fx.uniforms.uFadeCol.value.set(0, 0, 0);
    fx.uniforms.uFade.value = smooth(0.78, 1.0, k);
    fx.uniforms.uZoom.value = 0.5 * smooth(0.3, 0.9, k);
    shake = 0.006 * smooth(0.2, 0.8, k);
  }, ease.linear);
  flying = false; shot = null; shake = 0;
  sfx.rumbleOff(0.6); sfx.droneOff(0.6);
  await wait(0.6);
  setFlash('#fff', 1, 0.25);
  sfx.chime();
  await wait(0.3);
  fx.uniforms.uZoom.value = 0; fx.uniforms.uFade.value = 0;
  photo('home', 3.0, 0.01, 0, 'scale(1.3)');
  setMode('space');
  setFlash('#fff', 0, 1.6);
  place.classList.add('on');
  await wait(0.9);
  scrim.classList.add('on');
  showPanel(5);
}

async function jump(i) {
  setFlash('#000', 1, 0.35);
  await wait(0.4);
  applyState(i);
  await wait(0.05);
  setFlash('#000', 0, 0.6);
}

async function go(i) {
  if (busy || i < 0 || i >= TOTAL || i === cur) return;
  busy = true;
  const from = cur;
  cur = i;
  hud();
  try {
    if (from >= 0 && i === from + 1) await forward(i); else await jump(i);
  } finally { busy = false; }
}

// ---------- input ----------
function unlockAudio() { if (sfx.ensure()) ambience(cur); }
addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const k = e.key;
  const fresh = !sfx.ctx;
  if (fresh) unlockAudio(); else sfx.ensure();
  if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(k)) { e.preventDefault(); go(cur + 1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); go(cur - 1); }
  else if (k === 'Home') go(0);
  else if (k === 'End') go(N_SLIDES - 1);
  else if ('nNтТ'.includes(k)) toggleNotes();
  else if ('fFаА'.includes(k)) toggleFs();
  else if ('mMьЬ'.includes(k)) toggleSound();
});
$('#stage').addEventListener('click', (e) => {
  if (e.target.closest('button, #notes')) return;
  if (!sfx.ctx) unlockAudio(); else sfx.ensure();
  go(cur + 1);
});
$('#btnNotes').addEventListener('click', toggleNotes);
$('#btnFs').addEventListener('click', toggleFs);
$('#btnSound').addEventListener('click', toggleSound);
function toggleNotes() { const n = $('#notes'); n.hidden = !n.hidden; $('#btnNotes').setAttribute('aria-pressed', String(!n.hidden)); }
function toggleSound() {
  if (!sfx.ctx) unlockAudio();
  sfx.setMuted(!sfx.muted);
  $('#btnSound').setAttribute('aria-pressed', String(!sfx.muted));
  $('#btnSound .lbl').textContent = sfx.muted ? 'Sound off' : 'Sound';
}
function toggleFs() {
  try {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  } catch (e) { /* fullscreen not available here */ }
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  photoMat.uniforms.uScrA.value = innerWidth / innerHeight;
  eggPhoto.uniforms.uScrA.value = innerWidth / innerHeight;
  eggCam.aspect = innerWidth / innerHeight; eggCam.updateProjectionMatrix();
  applyQuality();
  setPointScale(pointMats, innerHeight, camera.fov, DPR);
});

// ---------- loop ----------
let sky, pointMats = [], cubeDirty = 0, frameNo = 0;
const clock0 = performance.now();
let frameTimes = [], lastFrame = performance.now();
const vp = new THREE.Matrix4();
function renderCube() {
  cubeCam.position.copy(camera.position);
  sky.position.copy(camera.position);
  // keep stars the same angular size in the cube as on screen
  setPointScale(pointMats, 1024, 90, 0.5);
  sky.material.uniforms.uPx.value = 0.5;
  photoMesh.visible = false;
  cubeCam.update(renderer, space);
  setPointScale(pointMats, innerHeight, camera.fov, DPR);
  sky.material.uniforms.uPx.value = DPR;
}
function frame() {
  requestAnimationFrame(frame);
  const nowMs = performance.now();
  const now = nowMs / 1000;
  const dtMs = nowMs - lastFrame; lastFrame = nowMs;
  frameNo++;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const k = Math.min(1, (nowMs - tw.t0) / tw.dur);
    tw.fn(tw.e(k));
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
  const t = (nowMs - clock0) / 1000;
  if (!flying && shot) { const s = shot(now); setCam(s.pos, s.tgt); }
  for (const m of mixers) m.update(Math.min(dtMs, 100) / 1000);
  for (const u of updaters) u(t);
  fx.uniforms.uTime.value = t;
  fx.uniforms.uShake.value.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  if (photoOpaque && !busy) return; // the photo covers the canvas
  sky.position.copy(camera.position);
  camera.updateMatrixWorld();
  if (mode === 'lens') {
    // live view of the scene for the lens: the frame itself plus a cube for light bent in from off-screen
    if (lensMat.uniforms.uMirror.value < 0.5 && (busy ? frameNo % 3 === 0 : cubeDirty > 0)) { renderCube(); if (cubeDirty > 0) cubeDirty--; }
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(space, camera);
    renderer.setRenderTarget(null);
    const L = lensMat.uniforms;
    L.uTime.value = t;
    L.uCamPos.value.copy(camera.position);
    L.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    L.uFov.value = THREE.MathUtils.degToRad(camera.fov);
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    L.uViewProj.value.copy(vp);
    frameTimes.push(dtMs);
    if (frameTimes.length > 40) {
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      frameTimes = [];
      if (avg > 30 && quality > 0.5) { quality = Math.max(0.5, quality - 0.15); applyQuality(); }
    }
  }
  composer.render();
}

// ---------- init ----------
async function init() {
  const [satMap, satRing, nepMap, nepRing, encMap, mimMap, kbtu] = await Promise.all([
    tex('saturn_diff'), tex('saturn_ring'), tex('neptune_diff'), tex('neptune_ring'), tex('enceladus'), tex('mimas'), tex('kbtu'),
  ]);
  for (const r of [satRing, nepRing]) { r.wrapS = r.wrapT = THREE.ClampToEdgeWrapping; r.generateMipmaps = false; r.minFilter = THREE.LinearFilter; }
  photoMat.uniforms.map.value = kbtu;
  photoImg.src = ASSETS.kbtu;
  await Promise.race([photoImg.decode().catch(() => {}), wait(1.5)]);

  sky = makeSky();
  const galaxy = makeGalaxy(b64buf(ASSETS.stars));
  debris = makeDebris();
  pointMats = [...galaxy.mats, ...debris.mats];
  setPointScale(pointMats, innerHeight, camera.fov, DPR);

  const satGroup = makePlanet({
    geo: planetGeometry(b64buf(ASSETS.saturn)), map: satMap, ringTex: satRing, R: SAT.R, center: SAT.c, tilt: V(0.35, 0.92, 0.12),
    atmo: V(0.42, 0.34, 0.22).multiplyScalar(0.18), rIn: 1.2341, rOut: 2.3985, spin: 0.012, limbK: 0.5, haloEdge: 0.12, haloScale: 1.02,
  });
  makeMoon(encMap, 0.09, satGroup, SAT.R, 3.95 * SAT.R, 2.25);
  makeMoon(mimMap, 0.07, satGroup, SAT.R, 3.08 * SAT.R, -2.5);
  nepHolder = new THREE.Object3D();
  nepHolder.matrixAutoUpdate = false;
  space.add(nepHolder);
  nepCenter = NEP.c.clone();
  makePlanet({
    geo: planetGeometry(b64buf(ASSETS.neptune)), map: nepMap, ringTex: nepRing, R: NEP.R, center: nepCenter, parent: nepHolder, tilt: V(0.05, 0.9, 0.35),
    atmo: V(0.25, 0.45, 1.0).multiplyScalar(0.55), rIn: 1.6743, rOut: 2.4331, ringOpacity: 0.32, ringTint: V(0.55, 0.62, 0.78), spin: 0.02, limbK: 0.55, haloEdge: 0.3, haloScale: 1.05,
  });
  placeNeptune(0);

  const [gAstro, gPig, gBart] = await Promise.all([parseGLB('astronaut'), parseGLB('pig'), parseGLB('bart')]);
  astro = instance(gAstro, 1.8); astro.holder.visible = false; space.add(astro.holder);
  pig = instance(gPig, 1.4); pig.holder.visible = false; space.add(pig.holder);
  pig.find('idle').play();
  bart = instance(gBart, 1.6); bart.holder.visible = false; space.add(bart.holder);
  bart.find('mixamo').play();
  bartE = instance(gBart, 1.9, 'feet'); bartE.holder.position.set(-0.95, 0, 0); bartE.holder.rotation.y = 0.25; eggScene.add(bartE.holder);
  pigE = instance(gPig, 1.15, 'feet'); pigE.holder.position.set(1.05, 0, 0.2); eggScene.add(pigE.holder);
  { const s1 = shadowBlob(0.5); s1.position.x = -0.95; const s2 = shadowBlob(0.6); s2.position.set(1.05, 0.005, 0.2); eggScene.add(s1, s2); }

  // compile everything up front so no slide stutters the first time
  setMode('space');
  shot = shots.saturn(); { const s = shot(performance.now() / 1000); setCam(s.pos, s.tgt); }
  photoMesh.visible = true; composer.render(); photoMesh.visible = false;
  setMode('lens'); shot = shots.bh(); { const s = shot(performance.now() / 1000); setCam(s.pos, s.tgt); }
  lensMat.uniforms.uRs.value = RS; lensMat.uniforms.uDisk.value = 1;
  camera.updateMatrixWorld();
  lensMat.uniforms.uCamPos.value.copy(camera.position);
  lensMat.uniforms.uCamRot.value.setFromMatrix4(camera.matrixWorld);
  renderCube();
  renderer.setRenderTarget(sceneRT); renderer.render(space, camera); renderer.setRenderTarget(null);
  composer.render();
  setMode('space'); shot = null;

  requestAnimationFrame(frame);
  const L = $('#loader');
  L.style.opacity = 0;
  setTimeout(() => L.remove(), 900);
  const start = Number((location.hash.match(/^#s(\d)$/) || [])[1] || 0);
  cur = start; hud(); applyState(start);
  window.__deck = { go, get cur() { return cur; }, get busy() { return busy; }, fx, lensMat, camera, sfx, chars: () => ({ astro, pig, bart, bartE, pigE }), THREE };
}
init().catch((e) => {
  console.error(e);
  $('#loader').classList.add('err');
  $('#loaderText').textContent = 'Жүктеу кезінде қате шықты: ' + e.message;
});
