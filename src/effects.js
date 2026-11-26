import * as THREE from '../vendor/three.module.min.js';
import { rand } from './util.js';

const vert = /* glsl */`
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */`
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * vColor.a;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(scene, max, blending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.buoy = new Float32Array(max);
    this.idx = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    this.uniforms = { uScale: { value: 600 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.alive = 0;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, color, a0, buoy = 0) {
    const i = this.idx;
    this.idx = (this.idx + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0; this.buoy[i] = buoy;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b;
  }
  update(dt) {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; } continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] += this.buoy[i] * dt;
      const drag = Math.exp(-1.5 * dt);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, t * 2.5);
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
  }
}

// Bullet tracers: one instanced unit box stretched between muzzle and impact.
class Tracers {
  constructor(scene, max = 40) {
    this.max = max;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.life = new Float32Array(max);
    this.cols = Array.from({ length: max }, () => new THREE.Color());
    this.idx = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, new THREE.Color(0, 0, 0)); }
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(); this._d = new THREE.Vector3(); this._z = new THREE.Vector3(0, 0, 1);
    this._black = new THREE.Color(0, 0, 0);
  }
  add(ax, ay, az, bx, by, bz, color) {
    const i = this.idx;
    this.idx = (this.idx + 1) % this.max;
    this._d.set(bx - ax, by - ay, bz - az);
    const len = this._d.length();
    if (len < 0.01) return;
    this._q.setFromUnitVectors(this._z, this._d.multiplyScalar(1 / len));
    this._m.compose(this._p.set(ax, ay, az), this._q, this._s.set(0.035, 0.035, len));
    this.mesh.setMatrixAt(i, this._m);
    this.cols[i].set(color);
    this.mesh.setColorAt(i, this.cols[i]);
    this.life[i] = 0.07;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / 0.07);
      this.mesh.setColorAt(i, this._black.copy(this.cols[i]).multiplyScalar(k));
      dirty = true;
    }
    if (dirty) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.normal = new Particles(scene, 700, THREE.NormalBlending);
    this.glow = new Particles(scene, 500, THREE.AdditiveBlending);
    this.flash = new THREE.PointLight('#ff9a4a', 0, 60, 1.5);
    scene.add(this.flash);
    this.muzzleLight = new THREE.PointLight('#ffc070', 0, 14, 1.6);
    scene.add(this.muzzleLight);
    this.tracers = new Tracers(scene);
    this.c = new THREE.Color();
  }
  tracer(ax, ay, az, bx, by, bz, color = 0xffe2a0) { this.tracers.add(ax, ay, az, bx, by, bz, color); }
  muzzle(x, y, z, suppressed = false, light = true) {
    this.c.setRGB(1, 0.8, 0.4);
    const n = suppressed ? 1 : 3;
    for (let i = 0; i < n; i++) this.glow.emit(x, y, z, rand(-0.5, 0.5), rand(-0.2, 0.6), rand(-0.5, 0.5), 0.05, suppressed ? 0.25 : 0.6, 0.1, this.c, 1, 0);
    if (light && !suppressed) {
      this.muzzleLight.position.set(x, y, z);
      this.muzzleLight.intensity = 30;
    }
  }
  shell(x, y, z) {
    this.c.set('#d4a24a');
    this.normal.emit(x, y, z, rand(0.8, 1.6), rand(1.5, 2.5), rand(-0.8, 0.8), 0.55, 0.12, 0.1, this.c, 1, -14);
  }
  impact(x, y, z, kind = 'wall') {
    if (kind === 'metal') {
      this.c.setRGB(1, 0.75, 0.35);
      for (let i = 0; i < 6; i++) this.glow.emit(x, y, z, rand(-3, 3), rand(0.5, 4), rand(-3, 3), rand(0.15, 0.3), 0.18, 0.04, this.c, 1, -14);
    } else {
      this.c.set(kind === 'dust' ? '#cdbb94' : '#b8b2a8');
      for (let i = 0; i < 3; i++) this.normal.emit(x, y, z, rand(-0.6, 0.6), rand(0.4, 1.4), rand(-0.6, 0.6), rand(0.35, 0.6), 0.25, 0.9, this.c, 0.6, -1);
      this.c.setRGB(1, 0.85, 0.5);
      this.glow.emit(x, y, z, 0, 0, 0, 0.05, 0.3, 0.05, this.c, 0.8, 0);
    }
  }
  // brief fabric-coloured puff when a person is hit (kept deliberately non-graphic)
  puff(x, y, z) {
    this.c.set('#8a3b3b');
    for (let i = 0; i < 3; i++) this.normal.emit(x, y, z, rand(-0.5, 0.5), rand(0, 0.8), rand(-0.5, 0.5), 0.25, 0.2, 0.45, this.c, 0.55, -2);
  }
  nitro(x, y, z) {
    this.c.setRGB(0.35, 0.6, 1);
    this.glow.emit(x + rand(-0.1, 0.1), y, z + rand(-0.1, 0.1), rand(-0.3, 0.3), rand(0, 0.3), rand(-0.3, 0.3), 0.12, 0.7, 0.15, this.c, 1, 0);
  }
  drillSparks(x, y, z) {
    this.c.setRGB(1, 0.7, 0.3);
    for (let i = 0; i < 3; i++) this.glow.emit(x, y, z, rand(-2.5, 2.5), rand(0.5, 3), rand(0.5, 3), rand(0.2, 0.4), 0.15, 0.03, this.c, 1, -12);
  }
  setScale(height, fov) {
    const s = height / (2 * Math.tan((fov * Math.PI) / 360));
    this.normal.uniforms.uScale.value = s;
    this.glow.uniforms.uScale.value = s;
  }
  smoke(x, y, z, shade = 0.5, size = 1) {
    this.c.setRGB(shade, shade, shade * 1.02);
    this.normal.emit(x + rand(-0.2, 0.2), y, z + rand(-0.2, 0.2), rand(-0.4, 0.4), rand(0.8, 1.6), rand(-0.4, 0.4), rand(1.2, 2.2), 0.6 * size, 2.6 * size, this.c, 0.45, 0.6);
  }
  dust(x, y, z) {
    this.c.set('#d9c49a');
    this.normal.emit(x + rand(-0.5, 0.5), y, z + rand(-0.5, 0.5), rand(-1, 1), rand(0.5, 1.5), rand(-1, 1), rand(0.6, 1.1), 0.8, 2.4, this.c, 0.35, 0);
  }
  fire(x, y, z) {
    this.c.setRGB(1, rand(0.35, 0.6), 0.12);
    this.glow.emit(x + rand(-0.4, 0.4), y, z + rand(-0.4, 0.4), rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), rand(0.35, 0.7), 1.3, 0.3, this.c, 0.9, 1);
  }
  sparkle(x, y, z, color = '#7fffd4', n = 14) {
    this.c.set(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.emit(x, y, z, Math.cos(a) * rand(1, 3), rand(1, 4), Math.sin(a) * rand(1, 3), rand(0.4, 0.8), 0.5, 0.05, this.c, 1, -4);
    }
  }
  splash(x, y, z) {
    this.c.set('#e6f6ff');
    for (let i = 0; i < 30; i++) this.normal.emit(x, y, z, rand(-3, 3), rand(3, 7), rand(-3, 3), rand(0.6, 1.0), 0.5, 1.2, this.c, 0.7, -12);
  }
  explosion(x, y, z) {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, s = rand(4, 14);
      this.c.setRGB(1, rand(0.3, 0.75), rand(0.05, 0.2));
      this.glow.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, rand(0.4, 0.9), rand(2, 4), 0.5, this.c, 1, -2);
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(1, 5);
      const sh = rand(0.08, 0.25);
      this.c.setRGB(sh, sh, sh);
      this.normal.emit(x, y, z, Math.cos(a) * s, rand(2, 6), Math.sin(a) * s, rand(1.8, 3.2), 2, 7, this.c, 0.7, 0.5);
    }
    this.flash.position.set(x, y + 2, z);
    this.flash.intensity = 4000;
  }
  update(dt) {
    this.normal.update(dt);
    this.glow.update(dt);
    this.tracers.update(dt);
    if (this.flash.intensity > 0) this.flash.intensity = Math.max(0, this.flash.intensity - dt * 9000);
    if (this.muzzleLight.intensity > 0) this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 600);
  }
}
