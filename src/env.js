import * as THREE from '../vendor/three.module.min.js';
import { LAND, WATER_Y } from './config.js';
import { clamp, smoothstep, lerp } from './util.js';

// Sky colour keyframes by sun elevation: [elevation, zenith, horizon]
const KEYS = [
  [-1.0, '#02030a', '#070a1c'],
  [-0.25, '#04061a', '#120c2e'],
  [-0.08, '#140f3d', '#4a1f5c'],
  [0.0, '#2b2a72', '#ff6a5e'],
  [0.1, '#3d62b8', '#ffad78'],
  [0.3, '#2f7fdc', '#a6d6ff'],
  [1.0, '#1c68d0', '#cde8ff'],
].map(([e, a, b]) => [e, new THREE.Color(a), new THREE.Color(b)]);

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}`;
const skyFrag = /* glsl */`
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35 + pow(s, 3.0) * 0.08) * (1.0 - uNight);
  vec3 m = -uSunDir;
  float ms = max(dot(d, m), 0.0);
  col += vec3(0.75, 0.8, 1.0) * (pow(ms, 1600.0) * 3.0 + pow(ms, 40.0) * 0.06) * uNight;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const oceanVert = /* glsl */`
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const oceanFrag = /* glsl */`
#include <fog_pars_fragment>
uniform float uTime; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uDeep; uniform vec3 uShallow;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec4 uLand; uniform float uNight;
varying vec3 vWorld;
vec2 wave(vec2 p, vec2 dir, float k, float w, float a, float t) {
  float ph = dot(dir, p) * k + t * w;
  return dir * (a * k * cos(ph));
}
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  vec2 g = vec2(0.0);
  g += wave(p, normalize(vec2(1.0, 0.3)), 0.08, 1.1, 0.9, t);
  g += wave(p, normalize(vec2(-0.4, 1.0)), 0.13, 1.6, 0.5, t);
  g += wave(p, normalize(vec2(0.7, -0.8)), 0.31, 2.3, 0.18, t);
  g += wave(p, normalize(vec2(-0.9, -0.2)), 0.67, 3.1, 0.07, t);
  g += wave(p, normalize(vec2(0.2, 0.9)), 1.4, 4.3, 0.03, t);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec2 dd = max(max(uLand.xy - p, p - uLand.zw), 0.0);
  float dist = length(dd);
  vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 70.0, dist));
  vec3 R = reflect(-V, n);
  vec3 refl = mix(uHorizon, uTop, clamp(R.y * 1.5, 0.0, 1.0));
  vec3 col = mix(water, refl, clamp(fres, 0.0, 1.0));
  vec3 L = uNight > 0.5 ? -uSunDir : uSunDir;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 240.0) * (uNight > 0.5 ? 0.6 : 3.0);
  col += (uNight > 0.5 ? vec3(0.6, 0.7, 1.0) : uSunColor) * spec;
  float foam = smoothstep(5.0, 0.0, dist) * (0.55 + 0.45 * sin(dist * 1.7 - t * 2.2 + p.x * 0.05 + p.y * 0.07));
  col = mix(col, vec3(0.95, 0.97, 1.0) * (1.0 - uNight * 0.7), clamp(foam, 0.0, 1.0) * 0.75);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Environment {
  constructor(scene, quality) {
    this.scene = scene;
    this.time = 17.6; // hours; start in golden hour
    this.hoursPerSecond = 24 / (12 * 60); // full day in 12 minutes
    this.night = 0;
    this.sunDir = new THREE.Vector3();

    this.hemi = new THREE.HemisphereLight('#cfe3ff', '#8a7a5e', 1.0);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sun.castShadow = quality.shadows;
    const s = this.sun.shadow;
    s.mapSize.set(quality.shadowSize, quality.shadowSize);
    s.camera.left = -75; s.camera.right = 75; s.camera.top = 75; s.camera.bottom = -75;
    s.camera.near = 10; s.camera.far = 600;
    s.bias = -0.0004;
    s.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);

    scene.fog = new THREE.Fog('#a6d6ff', 90, 720);

    this.skyU = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color('#fff0d0') }, uNight: { value: 0 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyU, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // stars
    const sp = [];
    for (let i = 0; i < 1400; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 0.95;
      const r = 1400;
      sp.push(Math.cos(u) * Math.sqrt(1 - v * v) * r, v * r, Math.sin(u) * Math.sqrt(1 - v * v) * r);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.oceanU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color('#0b4f7a') }, uShallow: { value: new THREE.Color('#1fb5b8') },
      uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
      uLand: { value: new THREE.Vector4(LAND.minX, LAND.minZ, LAND.maxX, LAND.maxZ) }, uNight: { value: 0 },
    }]);
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: this.oceanU, vertexShader: oceanVert, fragmentShader: oceanFrag, fog: true,
    }));
    this.ocean.position.y = WATER_Y;
    scene.add(this.ocean);
    this.deepDay = new THREE.Color('#0b4f7a'); this.deepNight = new THREE.Color('#030b18');
    this.shallowDay = new THREE.Color('#22c1bd'); this.shallowNight = new THREE.Color('#06303a');

    this._top = new THREE.Color(); this._hor = new THREE.Color();
    this._sunCol = new THREE.Color();
    this._tmpC = new THREE.Color();
  }

  get clock() {
    const h = Math.floor(this.time) % 24, m = Math.floor((this.time % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt, focus, camera, world) {
    this.time = (this.time + dt * this.hoursPerSecond) % 24;
    const ang = ((this.time - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    const e = this.sunDir.y;

    // sky gradient
    let k = 0;
    while (k < KEYS.length - 2 && e > KEYS[k + 1][0]) k++;
    const a = KEYS[k], b = KEYS[k + 1];
    const t = clamp((e - a[0]) / (b[0] - a[0]), 0, 1);
    this._top.copy(a[1]).lerp(b[1], t);
    this._hor.copy(a[2]).lerp(b[2], t);
    this.night = smoothstep(0.06, -0.12, e);
    const night = this.night;

    this.skyU.uTop.value.copy(this._top);
    this.skyU.uHorizon.value.copy(this._hor);
    this.skyU.uSunDir.value.copy(this.sunDir);
    this.skyU.uNight.value = night;
    this._sunCol.set('#ff8f4a').lerp(this._tmpC.set('#fff3e2'), smoothstep(0.0, 0.35, e));
    this.skyU.uSunColor.value.copy(this._sunCol);
    this.scene.fog.color.copy(this._hor).lerp(this._top, 0.15);
    this.scene.fog.far = lerp(720, 520, night);

    // lights: sun by day, moon by night (same light, flipped direction)
    const sunI = smoothstep(-0.02, 0.22, e) * 2.7;
    const moonI = smoothstep(0.0, -0.2, e) * 0.7;
    const dir = this._lightDir || (this._lightDir = new THREE.Vector3());
    dir.copy(this.sunDir);
    if (e <= -0.02) dir.negate();
    this.sun.intensity = sunI + moonI;
    this.sun.color.copy(e > -0.02 ? this._sunCol : this._tmpC.set('#9fb3ff'));
    this.hemi.intensity = lerp(1.05, 0.5, night);
    this.hemi.color.set(night > 0.5 ? '#6f7cc8' : '#cfe3ff');
    this.hemi.groundColor.set(night > 0.5 ? '#3a2a4a' : '#8a7a5e');

    // shadow camera follows the player, snapped to texels to avoid shimmering
    const step = 150 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / step) * step, fz = Math.round(focus.z / step) * step;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + dir.x * 250, Math.max(dir.y, 0.15) * 250, fz + dir.z * 250);
    this.sun.target.updateMatrixWorld();

    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.starMat.opacity = night * 0.9;

    const o = this.oceanU;
    o.uTime.value += dt;
    o.uTop.value.copy(this._top);
    o.uHorizon.value.copy(this._hor);
    o.uSunDir.value.copy(this.sunDir);
    o.uSunColor.value.copy(this._sunCol);
    o.uNight.value = night;
    o.uDeep.value.copy(this.deepDay).lerp(this.deepNight, night);
    o.uShallow.value.copy(this.shallowDay).lerp(this.shallowNight, night);

    // city lights
    if (world) {
      world.buildingMats.forEach((m, i) => { m.emissiveIntensity = i < 2 ? 0.05 + night * 1.4 : 0.03 + night * 0.85; });
      world.lampHeadMat.color.setScalar(lerp(0.35, 1.0, night)).multiply(this._tmpC.set('#ffd9a0'));
      world.lampPoolMat.opacity = night * 0.95;
      for (const m of world.neonMats) {
        if (m.userData.base) m.color.copy(m.userData.base).multiplyScalar(lerp(0.75, 1.6, night));
        else m.color.setScalar(lerp(0.7, 1.35, night));
      }
    }
  }
}
