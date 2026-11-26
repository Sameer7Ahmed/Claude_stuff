'use strict';
const Input = {
  keys: new Set(),
  pressedSet: new Set(),
  touchHeld: {},
  stick: { id: null, x: 0, y: 0, bx: 0, by: 0 },
  mouse: { x: 0, y: 0, down: false, active: false },
  isTouch: false,
  map: {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    swing: ['Space', 'KeyJ'],
    shoot: ['KeyF', 'KeyK'],
    dash: ['ShiftLeft', 'ShiftRight', 'KeyL'],
    potion: ['KeyQ'],
    recall: ['KeyR', 'KeyE'],
  },

  init(canvas) {
    addEventListener('keydown', (e) => {
      const a = this.actionFor(e.code);
      if (Game.mode === 'mine' && (a || e.code.startsWith('Arrow'))) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (a) this.pressedSet.add(a);
      if (e.code === 'Escape' || e.code === 'KeyP') Game.togglePause();
      if (e.code === 'KeyM') UI.toggleMute();
      Sfx.init();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; this.touchHeld = {}; this.stick.id = null; });

    canvas.addEventListener('pointerdown', (e) => {
      Sfx.init();
      if (e.pointerType !== 'mouse') return;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.active = true;
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.pressedSet.add('swing');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.active = true;
    });
    addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- touch controls ----
    const zone = document.getElementById('stick-zone');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    const R = 46;
    zone.addEventListener('pointerdown', (e) => {
      Sfx.init();
      if (this.stick.id !== null) return;
      this.stick.id = e.pointerId;
      this.stick.bx = e.clientX; this.stick.by = e.clientY;
      this.stick.x = 0; this.stick.y = 0;
      zone.setPointerCapture(e.pointerId);
      base.style.left = e.clientX + 'px'; base.style.top = e.clientY + 'px';
      base.classList.add('on');
      knob.style.transform = 'translate(-50%,-50%)';
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.bx, dy = e.clientY - this.stick.by;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const m = Math.min(1, l / R);
      if (m < 0.18) { this.stick.x = 0; this.stick.y = 0; }
      else { this.stick.x = (dx / (l || 1)) * Math.min(1, (m - 0.18) / 0.6); this.stick.y = (dy / (l || 1)) * Math.min(1, (m - 0.18) / 0.6); }
    });
    const endStick = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = null; this.stick.x = 0; this.stick.y = 0;
      base.classList.remove('on');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    document.querySelectorAll('#touch-btns [data-act]').forEach((btn) => {
      const act = btn.dataset.act;
      btn.addEventListener('pointerdown', (e) => {
        Sfx.init();
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        if (act === 'pause') { Game.togglePause(); return; }
        this.touchHeld[act] = true;
        this.pressedSet.add(act);
        btn.classList.add('down');
      });
      const up = () => { this.touchHeld[act] = false; btn.classList.remove('down'); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    });

    const enableTouch = () => {
      if (this.isTouch) return;
      this.isTouch = true;
      this.mouse.active = false;
      document.body.classList.add('touch');
    };
    addEventListener('touchstart', enableTouch, { passive: true });
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches) enableTouch();
  },

  actionFor(code) {
    for (const a in this.map) if (this.map[a].includes(code)) return a;
    return null;
  },
  held(a) {
    if (this.touchHeld[a]) return true;
    const ks = this.map[a];
    for (const k of ks) if (this.keys.has(k)) return true;
    return false;
  },
  pressed(a) { return this.pressedSet.has(a); },
  axis() {
    if (this.stick.id !== null) return { x: this.stick.x, y: this.stick.y };
    let x = 0, y = 0;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (this.held('up')) y -= 1;
    if (this.held('down')) y += 1;
    if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
    return { x, y };
  },
  endFrame() { this.pressedSet.clear(); },
};
