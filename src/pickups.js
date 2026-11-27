import * as THREE from '../vendor/three.module.min.js';
import { beamFadeTexture, ringTexture } from './textures.js';

const cashGeo = new THREE.BoxGeometry(0.7, 0.35, 0.35);
const cashMat = new THREE.MeshStandardMaterial({ color: '#3ddc84', emissive: '#1a7a45', emissiveIntensity: 0.6, roughness: 0.4 });
const tokenGeo = new THREE.OctahedronGeometry(0.55, 0);
const tokenMat = new THREE.MeshBasicMaterial({ color: '#5ff6ff' });
const heartGeo = new THREE.BoxGeometry(0.9, 0.3, 0.3);
const heartMat = new THREE.MeshStandardMaterial({ color: '#ff3b5c', emissive: '#a0102a', emissiveIntensity: 0.7 });
const ammoGeo = new THREE.BoxGeometry(0.55, 0.32, 0.36);
const ammoMat = new THREE.MeshStandardMaterial({ color: '#a16207', emissive: '#5a3500', emissiveIntensity: 0.6, roughness: 0.6 });
const cardGeo = new THREE.BoxGeometry(0.5, 0.04, 0.32);
const cardMat = new THREE.MeshBasicMaterial({ color: '#4dd2ff' });

export class Pickups {
  constructor(G) {
    this.G = G;
    this.items = [];
    this.t = 0;
  }

  // space: an Interior, or null for the outdoor world
  add(type, x, z, data = {}, space = null) {
    const G = this.G;
    let mesh;
    if (type === 'cash') mesh = new THREE.Mesh(cashGeo, cashMat);
    else if (type === 'token') mesh = new THREE.Mesh(tokenGeo, tokenMat);
    else if (type === 'ammo') mesh = new THREE.Mesh(ammoGeo, ammoMat);
    else if (type === 'keycard') mesh = new THREE.Mesh(cardGeo, cardMat);
    else {
      mesh = new THREE.Group();
      const a = new THREE.Mesh(heartGeo, heartMat), b = new THREE.Mesh(heartGeo, heartMat);
      b.rotation.z = Math.PI / 2;
      mesh.add(a, b);
    }
    const y = (space ? space.floorY : G.world.groundY(x, z)) + 0.9;
    mesh.position.set(x, y, z);
    (space ? space.group : G.scene).add(mesh);
    const life = type === 'cash' || type === 'ammo' ? 45 : Infinity;
    const it = { type, x, z, y, mesh, ...data, space, life, respawn: 0 };
    this.items.push(it);
    return it;
  }

  remove(it) {
    it.mesh.parent?.remove(it.mesh);
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
  }

  // drop interior items when leaving a space
  clearSpace(space) {
    for (const it of [...this.items]) if (it.space === space && it.type !== 'keycard') this.remove(it);
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
      if (it.life <= 0) { this.remove(it); continue; }
      it.mesh.rotation.y += dt * 2.2;
      it.mesh.position.y = it.y + Math.sin(this.t * 3 + it.x) * 0.15;
      if ((it.space || G.world) !== G.player.space) continue;
      const d = Math.hypot(P.x - it.x, P.z - it.z);
      if (d > (inCar ? 3.2 : 1.5) || Math.abs(P.y + 0.9 - it.y) > 2.5 || !G.player.alive) continue;
      if (it.type === 'cash') {
        G.addMoney(it.amount);
        G.audio.cash();
        G.effects.sparkle(it.x, it.y, it.z, '#3ddc84', 10);
        this.remove(it);
      } else if (it.type === 'ammo') {
        const A = G.arsenal;
        if (A.has(it.weapon)) { A.addAmmo(it.weapon, it.rounds); G.notify(`+${it.rounds} rounds`, 1.2); }
        else { A.give(it.weapon, it.rounds); G.notify(`Picked up a ${G.weaponName(it.weapon)}`, 2); }
        G.audio.equip();
        this.remove(it);
      } else if (it.type === 'keycard') {
        G.heist.pickKeycard();
        this.remove(it);
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
        this.remove(it);
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
    this.beamMat = new THREE.MeshBasicMaterial({ color, map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.55, fog: height < 30 });
    const beam = new THREE.Mesh(beamGeo, this.beamMat);
    beam.scale.set(radius * 0.8, height, radius * 0.8);
    // tall beacons (seen across the coast) drop to a short ground beam while the guide is off
    this.beam = beam;
    this.tallH = height;
    this.lowH = Math.min(height, 10);
    this.tall = true;
    this.h = height;
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
    if (!this.group.visible) { this.h = this.tall ? this.tallH : this.lowH; this.beam.scale.y = this.h; }
    this.x = x; this.z = z;
    this.group.position.set(x, this.G.world.groundY(x, z), z);
    this.group.visible = true;
  }
  hide() { this.group.visible = false; }
  get visible() { return this.group.visible; }
  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    const want = this.tall ? this.tallH : this.lowH;
    if (this.h !== want) {
      this.h += (want - this.h) * Math.min(1, dt * 5);
      if (Math.abs(want - this.h) < 0.05) this.h = want;
      this.beam.scale.y = this.h;
    }
    const s = 1 + Math.sin(this.t * 3) * 0.06;
    this.ring.scale.set(this.radius * s, 1, this.radius * s);
    this.ring.rotation.y += dt;
  }
  inside(x, z, pad = 0) { return this.group.visible && Math.hypot(x - this.x, z - this.z) < this.radius + pad; }
}
