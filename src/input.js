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
    this.touch = { x: 0, y: 0, enter: false, punch: false, jump: false, brake: false, sprint: false, map: false, lookDX: 0, lookDY: 0 };

    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.clicked = true;
      if (e.button === 2 || !this.locked) this.dragging = e.button === 2;
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.dragging = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
  }

  requestLock() {
    if (this.isTouch) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock unavailable: right-drag still works */ }
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
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
    const t = this.touch;
    t.enter = t.punch = t.jump = t.map = false;
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
    btn('#t-enter', () => { this.touch.enter = true; });
    btn('#t-punch', () => { this.touch.punch = true; this.touch.brake = true; }, () => { this.touch.brake = false; });
    btn('#t-jump', () => { this.touch.jump = true; });
    btn('#t-map', () => { this.touch.map = true; });
  }
}
