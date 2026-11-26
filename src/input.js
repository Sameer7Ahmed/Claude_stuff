// Keyboard, mouse (pointer lock with right-drag fallback) and touch controls.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.clicked = false;
    this.locked = false;
    this.dragging = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.lmb = false;
    this.rmb = false;
    this.wheel = 0;
    this.touch = { x: 0, y: 0, enter: false, enterHeld: false, punch: false, fire: false, jump: false, brake: false, sprint: false, map: false, gun: false, lookDX: 0, lookDY: 0 };
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.wantLock = false;   // set once the game starts
    this.lockFailed = false; // browsers/frames without pointer lock: clicks act normally
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    canvas.addEventListener('mousedown', (e) => {
      // the first click on an unlocked canvas only captures the mouse (so it can't fire a gun)
      if (e.button === 0 && this.wantLock && !this.locked && !this.lockFailed && !this.isTouch) { this.requestLock(); return; }
      if (e.button === 0) { this.clicked = true; this.lmb = true; }
      if (e.button === 2) { this.rmb = true; this.dragging = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) { this.rmb = false; this.dragging = false; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
  }

  requestLock() {
    if (this.isTouch) return;
    try {
      if (!this.canvas.requestPointerLock) { this.lockFailed = true; return; }
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockFailed = true; });
    } catch { this.lockFailed = true; /* pointer lock unavailable: right-drag still works */ }
  }

  // free the cursor for menus
  release() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignore */ }
    this.reset();
  }
  // forget held buttons so nothing carries over after a menu closes
  reset() {
    this.keys.clear();
    this.pressed.clear();
    this.lmb = this.rmb = this.dragging = false;
    this.clicked = false;
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  // mark a press as handled so a second system doesn't also act on it this frame
  consume(code = 'KeyF') { this.pressed.delete(code); if (code === 'KeyF') this.touch.enter = false; }
  aimHeld() { return this.rmb || this.touch.fire; }
  fireHeld() { return this.lmb || this.touch.fire; }
  firePressed() { return this.clicked || this.touch.punch; }
  interactHeld() { return this.down('KeyF') || this.touch.enterHeld; }
  axisX() {
    return (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0) + this.touch.x;
  }
  axisY() {
    return (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0) + this.touch.y;
  }
  lookDX() { return this.mouseDX + this.touch.lookDX; }
  lookDY() { return this.mouseDY + this.touch.lookDY; }

  endFrame() {
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.clicked = false;
    this.wheel = 0;
    const t = this.touch;
    t.enter = t.punch = t.jump = t.map = t.gun = false;
    t.lookDX = t.lookDY = 0;
  }

  // Build the on-screen touch controls.
  setupTouch(root) {
    root.hidden = false;
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#knob');
    let stickId = null, cx = 0, cy = 0;
    const R = 50;
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      e.preventDefault();
    }, { passive: false });
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        let dx = t.clientX - cx, dy = t.clientY - cy;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.touch.x = dx / R;
        this.touch.y = -dy / R;
        this.touch.sprint = l > R * 0.95;
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        stickId = null;
        knob.style.transform = '';
        this.touch.x = this.touch.y = 0;
        this.touch.sprint = false;
      }
    };
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);

    // drag anywhere else on the canvas to look around
    let lookId = null, lx = 0, ly = 0;
    this.canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        this.touch.lookDX += (t.clientX - lx) * 1.6;
        this.touch.lookDY += (t.clientY - ly) * 1.6;
        lx = t.clientX; ly = t.clientY;
      }
    }, { passive: true });
    const lookEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
    this.canvas.addEventListener('touchend', lookEnd);
    this.canvas.addEventListener('touchcancel', lookEnd);

    const btn = (id, onDown, onUp) => {
      const el = root.querySelector(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); el.classList.add('on'); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); onUp?.(); el.classList.remove('on'); }, { passive: false });
    };
    btn('#t-enter', () => { this.touch.enter = true; this.touch.enterHeld = true; }, () => { this.touch.enterHeld = false; });
    btn('#t-punch', () => { this.touch.punch = true; this.touch.fire = true; this.touch.brake = true; }, () => { this.touch.fire = false; this.touch.brake = false; });
    btn('#t-jump', () => { this.touch.jump = true; this.touch.sprint = true; }, () => { this.touch.sprint = false; });
    btn('#t-gun', () => { this.touch.gun = true; });
    btn('#t-map', () => { this.touch.map = true; });
  }
}
