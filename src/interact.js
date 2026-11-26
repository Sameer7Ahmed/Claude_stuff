// One prompt at a time: the nearest thing the player can use with F.
// Interactables: { x, z | pos(), r, label(G) -> string|null, onPress?(G), hold?: seconds, onHold?(G) }
export class Interactions {
  constructor(G) {
    this.G = G;
    this.holdT = 0;
    this.holding = null;
  }

  update(dt) {
    const G = this.G, P = G.player, inp = G.input, hud = G.hud;
    if (!P.alive || G.sequence || G.ui.open || G.transitioning) { hud.prompt(''); this.release(); return; }
    if (P.vehicle) {
      hud.prompt(G.economy.zonePrompt || '');
      this.release();
      return;
    }
    const list = P.space === G.world ? G.worldInteractables : P.space.interactables;
    let best = null, bestLabel = null, bd = Infinity;
    for (const it of list) {
      const p = it.pos ? it.pos() : it;
      if (!p) continue;
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d > it.r || d >= bd) continue;
      const label = it.label(G);
      if (!label) continue;
      best = it; bestLabel = label; bd = d;
    }
    // cars compete with fixed interactables; fixed things win when you're right on top of them
    const car = P.nearestVehicle();
    const useCar = car && (!best || bd > 1.4);
    const key = G.input.isTouch ? 'ENTER' : 'F';
    if (useCar) {
      hud.prompt(`<kbd>${key}</kbd> ${car.driver === 'ai' ? 'Steal' : 'Enter'} ${car.spec.name}`);
      this.release();
      if (inp.hit('KeyF') || inp.touch.enter) { inp.consume('KeyF'); P.enterVehicle(car); }
      return;
    }
    if (!best) { hud.prompt(''); this.release(); return; }
    if (best.hold) {
      hud.prompt(`Hold <kbd>${key}</kbd> ${bestLabel}`);
      if (inp.interactHeld()) {
        if (this.holding !== best) { this.holding = best; this.holdT = 0; }
        this.holdT += dt;
        hud.hold(this.holdT / best.hold, bestLabel);
        if (this.holdT >= best.hold) { this.release(); best.onHold(G); }
      } else this.release();
      return;
    }
    this.release();
    hud.prompt(`<kbd>${key}</kbd> ${bestLabel}`);
    if (inp.hit('KeyF') || inp.touch.enter) { inp.consume('KeyF'); best.onPress?.(G); }
  }

  release() {
    if (this.holding) this.G.hud.hold(null);
    this.holding = null;
    this.holdT = 0;
  }
}
