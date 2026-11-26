import { fmtMoney } from './util.js';

const $ = (id) => document.getElementById(id);

// Modal overlays that pause the game: shops (buy lists) and the heist payout.
export class UI {
  constructor(G) {
    this.G = G;
    this.mode = null;
    this.cfg = null;
    this.sel = 0;
    this.el = {
      shop: $('shop'), kicker: $('shop-kicker'), title: $('shop-title'), sub: $('shop-sub'), list: $('shop-list'),
      money: $('shop-money'), msg: $('shop-msg'), close: $('shop-close'),
      payout: $('payout'), pKicker: $('payout-kicker'), pTitle: $('payout-title'), pNote: $('payout-note'),
      pLines: $('payout-lines'), pTotal: $('payout-total'), pOk: $('payout-ok'),
    };
    this.el.close.addEventListener('click', () => this.close());
    this.el.pOk.addEventListener('click', () => this.close());
    this.el.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (row) { this.sel = +row.dataset.i; this.buy(this.sel); }
    });
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get open() { return !!this.mode; }

  onKey(e) {
    if (!this.mode) return;
    e.stopPropagation();
    e.preventDefault();
    if (this.mode === 'payout') { if (['Enter', 'Space', 'Escape', 'KeyF'].includes(e.code)) this.close(); return; }
    const n = this.items.length;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { this.sel = (this.sel + 1) % n; this.render(); this.G.audio.click(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { this.sel = (this.sel - 1 + n) % n; this.render(); this.G.audio.click(); }
    else if (e.code === 'Enter' || e.code === 'Space') this.buy(this.sel);
    else if (e.code === 'Escape' || e.code === 'KeyF' || e.code === 'Backspace') this.close();
  }

  openShop(cfg) {
    const G = this.G;
    this.mode = 'shop';
    this.cfg = cfg;
    this.sel = 0;
    this.msg = '';
    G.input.release();
    this.el.shop.style.setProperty('--shop-accent', cfg.accent || '#ff3fa4');
    this.el.kicker.textContent = cfg.kicker || '';
    this.el.title.textContent = cfg.title;
    this.el.sub.textContent = cfg.sub || '';
    this.el.shop.hidden = false;
    this.render();
  }

  render() {
    const G = this.G;
    this.items = this.cfg.items();
    if (this.sel >= this.items.length) this.sel = 0;
    this.el.list.innerHTML = this.items.map((it, i) => {
      const stats = it.stats ? `<span class="stats">${Object.entries(it.stats).map(([k, v]) => `<span class="stat"><em>${k}</em><i style="--v:${Math.round(v * 100)}%"></i></span>`).join('')}</span>` : '';
      let right;
      if (it.tag) right = `<span class="tag">${it.tag}</span>`;
      else if (it.price === null || it.price === undefined) right = '';
      else if (it.price < 0) right = `<span class="price earn">+${fmtMoney(-it.price)}</span>`;
      else if (it.price === 0) right = '<span class="price">FREE</span>';
      else right = `<span class="price ${it.price > G.money ? 'short' : ''}">${fmtMoney(it.price)}</span>`;
      const off = it.disabled || it.price === null || it.price === undefined;
      return `<li data-i="${i}" class="${i === this.sel ? 'sel' : ''} ${off ? 'off' : ''}" role="option" aria-selected="${i === this.sel}">
        <span class="name">${it.name}<small>${it.disabled ? it.disabled : it.desc || ''}</small>${stats}</span>${right}</li>`;
    }).join('');
    this.el.money.textContent = fmtMoney(G.money);
    this.el.msg.textContent = this.msg;
  }

  buy(i) {
    const G = this.G, it = this.items[i];
    if (!it) return;
    if (it.disabled || it.price === null || it.price === undefined) { this.flash(it.disabled || 'Not available'); G.audio.deny(); return; }
    if (it.price > 0 && !G.spend(it.price)) { this.flash(`You need ${fmtMoney(it.price - G.money)} more.`); G.audio.deny(); return; }
    if (it.price > 0) G.audio.buy();
    const m = it.action();
    this.msg = m || 'Done.';
    G.save();
    if (this.mode === 'shop') this.render();
  }

  flash(text) {
    this.msg = text;
    this.el.msg.textContent = text;
    this.el.msg.classList.remove('shake');
    void this.el.msg.offsetWidth;
    this.el.msg.classList.add('shake');
  }

  payout(cfg) {
    const G = this.G;
    this.mode = 'payout';
    G.input.release();
    this.el.pKicker.textContent = cfg.kicker;
    this.el.pTitle.textContent = cfg.title;
    this.el.pNote.textContent = cfg.note || '';
    this.el.pLines.innerHTML = cfg.lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    this.el.pTotal.textContent = cfg.total;
    this.el.payout.hidden = false;
    G.audio.pass();
  }

  close() {
    if (!this.mode) return;
    const cfg = this.cfg;
    this.el.shop.hidden = true;
    this.el.payout.hidden = true;
    this.mode = null;
    this.cfg = null;
    this.G.input.reset();
    this.G.input.requestLock();
    cfg?.onClose?.();
  }
}
