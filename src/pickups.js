import * as THREE from '../vendor/three.module.min.js';
import { beamFadeTexture, ringTexture } from './textures.js';

const cashGeo = new THREE.BoxGeometry(0.7, 0.35, 0.35);
const cashMat = new THREE.MeshStandardMaterial({ color: '#3ddc84', emissive: '#1a7a45', emissiveIntensity: 0.6, roughness: 0.4 });
const tokenGeo = new THREE.OctahedronGeometry(0.55, 0);
const tokenMat = new THREE.MeshBasicMaterial({ color: '#5ff6ff' });
const heartGeo = new THREE.BoxGeometry(0.9, 0.3, 0.3);
const heartMat = new THREE.MeshStandardMaterial({ color: '#ff3b5c', emissive: '#a0102a', emissiveIntensity: 0.7 });

export class Pickups {
  constructor(G) {
    this.G = G;
    this.items = [];
    this.t = 0;
  }

  add(type, x, z, data = {}) {
    const G = this.G;
    let mesh;
    if (type === 'cash') mesh = new THREE.Mesh(cashGeo, cashMat);
    else if (type === 'token') mesh = new THREE.Mesh(tokenGeo, tokenMat);
    else {
      mesh = new THREE.Group();
      const a = new THREE.Mesh(heartGeo, heartMat), b = new THREE.Mesh(heartGeo, heartMat);
      b.rotation.z = Math.PI / 2;
      mesh.add(a, b);
    }
    const y = G.world.groundY(x, z) + 0.9;
    mesh.position.set(x, y, z);
    G.scene.add(mesh);
    const it = { type, x, z, y, mesh, ...data, life: type === 'cash' ? 40 : Infinity, respawn: 0 };
    this.items.push(it);
    return it;
  }

  spawnCash(x, z, amount) { this.add('cash', x, z, { amount }); }

  update(dt) {
    const G = this.G;
    this.t += dt;
    const P = G.player.pos;
    const inCar = !!G.player.vehicle;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.respawn > 0) {
        it.respawn -= dt;
        if (it.respawn <= 0) it.mesh.visible = true;
        continue;
      }
      it.life -= dt;
      if (it.life <= 0) { G.scene.remove(it.mesh); this.items.splice(i, 1); continue; }
      it.mesh.rotation.y += dt * 2.2;
      it.mesh.position.y = it.y + Math.sin(this.t * 3 + it.x) * 0.15;
      const d = Math.hypot(P.x - it.x, P.z - it.z);
      if (d > (inCar ? 3.2 : 1.5) || Math.abs(P.y + 0.9 - it.y) > 2.5 || !G.player.alive) continue;
      if (it.type === 'cash') {
        G.addMoney(it.amount);
        G.audio.cash();
        G.effects.sparkle(it.x, it.y, it.z, '#3ddc84', 10);
        G.scene.remove(it.mesh);
        this.items.splice(i, 1);
      } else if (it.type === 'health') {
        if (G.player.health >= 100) continue;
        G.player.health = 100;
        G.notify('Health restored', 1.5);
        G.audio.cash();
        G.effects.sparkle(it.x, it.y, it.z, '#ff3b5c', 12);
        it.mesh.visible = false;
        it.respawn = 60;
      } else if (it.type === 'token') {
        G.collectToken(it.id);
        G.audio.token();
        G.effects.sparkle(it.x, it.y, it.z, '#5ff6ff', 24);
        G.scene.remove(it.mesh);
        this.items.splice(i, 1);
      }
    }
  }
}

// Glowing column + ground ring used for mission objectives and shops.
const beamTex = beamFadeTexture();
const ringTex = ringTexture();
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

export class Marker {
  constructor(G, color, radius = 3, height = 22) {
    this.G = G;
    this.radius = radius;
    this.group = new THREE.Group();
    this.beamMat = new THREE.MeshBasicMaterial({ color, map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.55 });
    const beam = new THREE.Mesh(beamGeo, this.beamMat);
    beam.scale.set(radius * 0.8, height, radius * 0.8);
    this.ringMat = new THREE.MeshBasicMaterial({ color, map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.scale.setScalar(radius);
    this.ring.position.y = 0.08;
    this.group.add(beam, this.ring);
    this.group.visible = false;
    beam.renderOrder = 3;
    this.ring.renderOrder = 3;
    G.scene.add(this.group);
    this.x = 0; this.z = 0;
    this.t = Math.random() * 10;
  }
  show(x, z) {
    this.x = x; this.z = z;
    this.group.position.set(x, this.G.world.groundY(x, z), z);
    this.group.visible = true;
  }
  hide() { this.group.visible = false; }
  get visible() { return this.group.visible; }
  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    const s = 1 + Math.sin(this.t * 3) * 0.06;
    this.ring.scale.set(this.radius * s, 1, this.radius * s);
    this.ring.rotation.y += dt;
  }
  inside(x, z, pad = 0) { return this.group.visible && Math.hypot(x - this.x, z - this.z) < this.radius + pad; }
}
