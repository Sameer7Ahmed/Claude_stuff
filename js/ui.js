'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function gearStatText(key, t) {
  switch (key) {
    case 'pick': {
      const best = ROCKS.filter((r) => r.tier <= t.tier).pop();
      return `Power ${t.power} · Mines up to ${best.name} · Melee ${t.dmg}`;
    }
    case 'armor': return `${t.hp} HP · ${Math.round(t.def * 100)}% damage reduction`;
    case 'boots': return `Speed ${t.speed} · Dash every ${t.dash}s`;
    case 'sling': return t.dmg ? `${t.dmg} dmg · ${(1 / t.cd).toFixed(1)} shots/s` : 'No ranged attack';
    case 'lamp': return `Light radius ${t.radius} tiles`;
    case 'bag': return `Holds ${t.cap} gems`;
    case 'amulet': return `${t.slots} gem socket${t.slots > 1 ? 's' : ''}`;
  }
  return '';
}

const UI = {
  tab: 'descend',

  init() {
    $('town').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || b.disabled) return;
      this.action(b.dataset.a, b.dataset.v);
    });
    $('modal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      Sfx.play('click');
      this.modalAction(b.dataset.m);
    });
  },

  // ================= TOASTS =================
  toast(text, kind = '', secs = 3.4) {
    const box = $('toasts');
    if (!text) { box.innerHTML = ''; return; }
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > (innerWidth < 760 ? 3 : 4)) box.removeChild(box.firstChild);
    setTimeout(() => d.classList.add('out'), secs * 1000);
    setTimeout(() => d.remove(), secs * 1000 + 400);
  },
  bigFind(id, isNew) {
    const g = GEMS[id], rar = RARITY[g.r];
    const box = $('bigfind');
    box.innerHTML = `<img src="${gemIcon(id, 96)}" alt=""><div><div class="bf-r" style="color:${rar.color}">${isNew ? 'NEW ' : ''}${g.boss ? 'BOSS HEART' : rar.name.toUpperCase() + ' FIND'}</div><div class="bf-n">${esc(g.name)}</div><div class="bf-b">${esc(gemBonusText(id))} · ${fmt(g.value)}¢</div></div>`;
    box.style.setProperty('--rc', rar.color);
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    clearTimeout(this._bfT);
    this._bfT = setTimeout(() => box.classList.remove('show'), 2600);
  },
  toggleMute() {
    const m = Sfx.toggle();
    this.toast(m ? '🔇 Sound off' : '🔊 Sound on');
    if (Game.mode === 'town') this.render();
  },

  // ================= MODALS =================
  modal(html) {
    $('modal').innerHTML = `<div class="modal-card">${html}</div>`;
    $('modal').classList.remove('hidden');
  },
  closeModal() { $('modal').classList.add('hidden'); $('modal').innerHTML = ''; },
  get modalOpen() { return !$('modal').classList.contains('hidden'); },
  modalAction(a) {
    switch (a) {
      case 'close': this.closeModal(); if (Game.paused) Game.paused = false; break;
      case 'help': this.help(); break;
      case 'mute': this.toggleMute(); this.closeModal(); Game.paused = false; break;
      case 'quit':
        this.closeModal(); Game.paused = false;
        if (Game.mine) {
          if (Game.mine.bossNear()) { this.toast("⚠️ You can't flee to camp while a living gem hunts you!", 'warn'); return; }
          Game.mine.exit('recall');
        }
        break;
      case 'reset':
        if (confirm('Erase all progress and start over?')) { Store.del(SAVE_KEY); S = newState(); this.closeModal(); Game.goTown(); this.toast('Progress reset. Good luck, miner!'); }
        break;
    }
  },
  help() {
    this.modal(`
      <h2>How to play</h2>
      <ol class="help-list">
        <li><b>Mine</b> by walking into rock. Gems glint inside the walls — your lantern shows them.</li>
        <li><b>Recall</b> to camp, <b>sell</b> your gems and <b>buy better gear</b>. Harder rock needs better pickaxes.</li>
        <li><b>Socket</b> rare gems into your amulet for permanent bonuses — rarer gems give much bigger boosts.</li>
        <li>Each floor hides a <b>living gemstone</b>. It fights back, and when hurt it <b>flees</b> through the rock. Chase it! If it gets too far for too long it escapes and heals.</li>
        <li>Corner it or let it tire out — an <b>exhausted</b> gem takes extra damage. Beat it to open the next floor and claim its Heart.</li>
      </ol>
      <div class="keys">
        <div><kbd>WASD</kbd>/<kbd>Arrows</kbd> move &amp; mine</div>
        <div><kbd>Space</kbd>/<kbd>J</kbd> swing pickaxe</div>
        <div><kbd>Click</kbd> shoot at cursor · <kbd>F</kbd> auto-aim shot</div>
        <div><kbd>Shift</kbd> dash (brief invulnerability)</div>
        <div><kbd>Q</kbd> drink potion · <kbd>R</kbd> recall to camp</div>
        <div><kbd>Esc</kbd> pause · <kbd>M</kbd> mute</div>
      </div>
      <p class="muted small">On touch screens: drag the left side to move, use the buttons on the right.</p>
      <button class="btn primary" data-m="close">Got it</button>`);
  },
  pauseMenu() {
    this.modal(`
      <h2>Paused</h2>
      <div class="menu-col">
        <button class="btn primary" data-m="close">▶ Resume</button>
        <button class="btn" data-m="help">❔ How to play</button>
        <button class="btn" data-m="mute">${Sfx.muted ? '🔊 Sound on' : '🔇 Sound off'}</button>
        <button class="btn" data-m="quit">⛺ Return to camp</button>
      </div>`);
  },
  settings() {
    this.modal(`
      <h2>Menu</h2>
      <div class="menu-col">
        <button class="btn" data-m="help">❔ How to play</button>
        <button class="btn" data-m="mute">${Sfx.muted ? '🔊 Turn sound on' : '🔇 Turn sound off'}</button>
        <button class="btn danger" data-m="reset">🗑 Reset progress</button>
        <button class="btn primary" data-m="close">Close</button>
      </div>`);
  },
  victory() {
    const found = GEM_IDS.filter((id) => S.found[id]).length;
    this.modal(`
      <div class="victory-gem"><img src="${gemIcon('h_diamond', 128)}" alt=""></div>
      <h2>The Deep is Yours!</h2>
      <p>You defeated the Heart Diamond, the oldest living gem in the mountain.</p>
      <p class="muted">Gems discovered: ${found}/${GEM_IDS.length} · Coins earned: ${fmt(S.totalEarned)}¢ · Faints: ${S.deaths}</p>
      <p>Keep delving to complete your Gem Book and max out your gear!</p>
      <button class="btn primary" data-m="close">Keep mining</button>`);
  },

  // ================= TOWN =================
  showTown() {
    $('town').classList.remove('hidden');
    if (S.bag.length) this.tab = 'sell';
    this.render();
  },
  hideTown() { $('town').classList.add('hidden'); },

  action(a, v) {
    const st = getStats();
    switch (a) {
      case 'tab': this.tab = v; Sfx.play('click'); break;
      case 'menu': Sfx.play('click'); this.settings(); return;
      case 'sell1': sellGems((id) => id === v, 1); break;
      case 'sellId':
        if (GEMS[v].boss && !confirm(`Sell the unique ${GEMS[v].name}? Boss hearts give big amulet bonuses.`)) return;
        sellGems((id) => id === v); break;
      case 'sellLow': sellGems((id) => GEMS[id].r <= 1); break;
      case 'sellAll': sellGems((id) => !GEMS[id].boss); break;
      case 'buy': buyGear(v); break;
      case 'potion': buyPotion(); break;
      case 'socket': socketGem(v); break;
      case 'unsocket': unsocketGem(+v); break;
      case 'enter': Sfx.play('click'); Game.enterMine(+v); return;
    }
    save();
    this.render();
    void st;
  },

  render() {
    const body = $('town-body');
    const scroll = body ? body.scrollTop : 0;
    const st = getStats();
    const tabs = [
      ['descend', '<span class="ti">⛏️ </span>Mine'],
      ['sell', `<span class="ti">💰 </span>Sell${S.bag.length ? ` <span class="badge">${S.bag.length}</span>` : ''}`],
      ['shop', '<span class="ti">🛒 </span>Gear'],
      ['amulet', '<span class="ti">📿 </span>Amulet'],
      ['book', '<span class="ti">📖 </span>Gems'],
    ];
    $('town').innerHTML = `
      <div class="town-wrap">
        <header class="town-head">
          <div class="brand">⛺ Miner's Camp</div>
          <div class="wallet" title="Coins"><span class="coin"></span>${fmt(S.coins)}</div>
          <button class="icon-btn" data-a="menu" aria-label="Menu">⚙️</button>
        </header>
        <div class="statline">
          <span>❤️ ${st.maxHp}</span><span>🛡️ ${Math.round(st.def * 100)}%</span><span>⛏️ ${st.power.toFixed(1)}</span>
          <span>⚔️ ${st.meleeDmg}${st.slingDmg ? ' / 🏹 ' + st.slingDmg : ''}</span><span>👢 ${st.speed.toFixed(1)}</span>
          <span>🍀 ${st.luck}%</span><span>🧪 ${S.potions}</span>
        </div>
        <nav class="tabs">${tabs.map(([k, l]) => `<button class="tab ${this.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('')}</nav>
        <section class="tab-body" id="town-body">${this['tab_' + this.tab](st)}</section>
      </div>`;
    $('town-body').scrollTop = scroll;
  },

  tab_descend(st) {
    return `<div class="floors">${FLOORS.map((F, i) => {
      const locked = i + 1 > S.unlocked;
      const B = BOSSES[F.boss];
      const hard = ROCKS[F.rocks[1]];
      const maxR = F.rarity.reduce((m, w, r) => (w > 0 ? r : m), 0);
      const warnPick = hard.tier > st.tier ? `<div class="warn">⚠️ ${esc(hard.name)} needs a ${esc(pickNameForTier(hard.tier))}</div>` : '';
      const spdWarn = st.speed < B.fleeSpeed - 0.6 ? 'warn-txt' : st.speed < B.fleeSpeed ? 'mid-txt' : 'ok-txt';
      return `
        <div class="floor-card ${locked ? 'locked' : ''} ${S.bosses[i] ? 'cleared' : ''}">
          <div class="fc-top"><span class="fl-num">Floor ${i + 1}</span>${S.bosses[i] ? '<span class="tag ok">Boss defeated ✓</span>' : ''}</div>
          <h3>${esc(F.name)}</h3>
          <div class="fc-row">🪨 ${esc(ROCKS[F.rocks[0]].name)} &amp; ${esc(hard.name)}</div>
          <div class="fc-row">💎 Gems up to <b style="color:${RARITY[maxR].color}">${RARITY[maxR].name}</b></div>
          <div class="fc-boss">
            <img src="${gemIcon(B.heart, 48)}" alt="" class="${locked && !S.bosses[i] ? 'unknown' : ''}">
            <div><b>${locked ? '???' : esc(B.name)}</b>
            <small>${S.bosses[i] ? 'Defeated' : locked ? 'Defeat the previous living gem' : `Flee speed <span class="${spdWarn}">${B.fleeSpeed}</span> · yours ${st.speed.toFixed(1)}`}</small></div>
          </div>
          ${locked ? '' : warnPick}
          <button class="btn primary wide" data-a="enter" data-v="${i}" ${locked ? 'disabled' : ''}>${locked ? '🔒 Locked' : 'Descend ▶'}</button>
        </div>`;
    }).join('')}</div>
    <p class="hint">Each descent generates a fresh cave. The living gem of each floor guards the way deeper.</p>`;
  },

  tab_sell(st) {
    if (!S.bag.length) return `<div class="empty">🎒 Your backpack is empty.<br><small>Descend into the mine and dig up some gems!</small></div>`;
    const counts = {};
    for (const id of S.bag) counts[id] = (counts[id] || 0) + 1;
    const ids = Object.keys(counts).sort((a, b) => GEMS[b].r - GEMS[a].r || GEMS[b].value - GEMS[a].value);
    const price = (id) => Math.round(GEMS[id].value * st.valueMult);
    const total = S.bag.filter((id) => !GEMS[id].boss).reduce((s, id) => s + price(id), 0);
    const low = S.bag.filter((id) => GEMS[id].r <= 1 && !GEMS[id].boss).reduce((s, id) => s + price(id), 0);
    return `
      <div class="sell-top">
        <div>Backpack <b>${S.bag.length}/${st.cap}</b> · worth <b class="gold">${fmt(total)}¢</b>${st.valueMult > 1 ? ` <small class="muted">(+${Math.round((st.valueMult - 1) * 100)}% sell bonus)</small>` : ''}</div>
        <div class="btn-row">
          <button class="btn" data-a="sellLow" ${low ? '' : 'disabled'}>Sell Common &amp; Uncommon (${fmt(low)}¢)</button>
          <button class="btn primary" data-a="sellAll" ${total ? '' : 'disabled'}>Sell all (${fmt(total)}¢)</button>
        </div>
      </div>
      <p class="hint">💡 Rare gems can be socketed into your amulet for permanent bonuses instead of sold.</p>
      <div class="gem-list">${ids.map((id) => {
        const g = GEMS[id], rar = RARITY[g.r];
        return `<div class="gem-row" style="--rc:${rar.color}">
          <img src="${gemIcon(id)}" alt="">
          <div class="gi"><b style="color:${rar.color}">${esc(g.name)}</b><small>${g.boss ? 'Boss Heart' : rar.name} · ${esc(gemBonusText(id))}</small></div>
          <div class="qty">×${counts[id]}</div>
          <div class="price">${fmt(price(id))}¢</div>
          <div class="btn-row tight">
            ${g.boss ? '' : `<button class="btn sm" data-a="sell1" data-v="${id}">Sell 1</button>`}
            <button class="btn sm" data-a="sellId" data-v="${id}">${g.boss ? 'Sell' : 'All'}</button>
          </div>
        </div>`;
      }).join('')}</div>`;
  },

  tab_shop() {
    const cards = GEAR_ORDER.map((key) => {
      const line = GEAR[key], lv = S.gear[key], cur = line.tiers[lv], next = line.tiers[lv + 1];
      return `<div class="card">
        <div class="card-head"><span class="ic">${line.icon}</span><b>${line.label}</b><small>Lv ${lv + 1}/${line.tiers.length}</small></div>
        <div class="cur"><span class="lbl">Now</span><b>${esc(cur.name)}</b><small>${esc(gearStatText(key, cur))}</small></div>
        ${next ? `<div class="nxt"><span class="lbl">Next</span><b>${esc(next.name)}</b><small>${esc(gearStatText(key, next))}</small></div>
          <button class="btn buy ${S.coins >= next.price ? 'primary' : ''}" data-a="buy" data-v="${key}" ${S.coins >= next.price ? '' : 'disabled'}>Buy · ${fmt(next.price)}¢</button>`
          : `<div class="maxed">★ Maxed out</div>`}
      </div>`;
    });
    cards.push(`<div class="card">
      <div class="card-head"><span class="ic">🧪</span><b>Health Potion</b><small>${S.potions}/${POTION_MAX}</small></div>
      <div class="cur"><small>Restores 45% HP. Press Q (or 🧪) in the mine.</small></div>
      <button class="btn buy ${S.coins >= POTION_PRICE && S.potions < POTION_MAX ? 'primary' : ''}" data-a="potion" ${S.coins >= POTION_PRICE && S.potions < POTION_MAX ? '' : 'disabled'}>${S.potions >= POTION_MAX ? 'Full' : `Buy · ${POTION_PRICE}¢`}</button>
    </div>`);
    return `<div class="cards">${cards.join('')}</div>`;
  },

  tab_amulet(st) {
    const slots = S.sockets.map((id, i) => id
      ? `<button class="slot full" data-a="unsocket" data-v="${i}" style="--rc:${RARITY[GEMS[id].r].color}"><img src="${gemIcon(id, 64)}" alt=""><b>${esc(GEMS[id].name)}</b><small>${esc(gemBonusText(id))}</small><span class="rm">Remove</span></button>`
      : `<div class="slot"><div class="empty-slot">◇</div><small>Empty socket</small></div>`).join('');
    const b = st.b;
    const sum = Object.keys(b).filter((k) => b[k]).map((k) => `<span>${esc(statLine(k, +b[k].toFixed(1)))}</span>`).join('') || '<span class="muted">No bonuses yet</span>';
    const uniq = [...new Set(S.bag)].sort((x, y) => GEMS[y].r - GEMS[x].r);
    const free = S.sockets.includes(null);
    return `
      <p class="hint">Socket gems into your amulet for permanent bonuses. Rarer gems give much stronger boosts — a Legendary gem is worth 8× a Common one!</p>
      <div class="slots">${slots}</div>
      <div class="bonus-sum"><b>Active bonuses:</b> ${sum}</div>
      <h3 class="sub">Socket from backpack</h3>
      ${uniq.length ? `<div class="gem-list">${uniq.map((id) => {
        const g = GEMS[id], rar = RARITY[g.r];
        return `<div class="gem-row" style="--rc:${rar.color}"><img src="${gemIcon(id)}" alt="">
          <div class="gi"><b style="color:${rar.color}">${esc(g.name)}</b><small>${g.boss ? 'Boss Heart' : rar.name}</small></div>
          <div class="bonus">${esc(gemBonusText(id))}</div>
          <button class="btn sm ${free ? 'primary' : ''}" data-a="socket" data-v="${id}" ${free ? '' : 'disabled'}>Socket</button></div>`;
      }).join('')}</div>` : '<div class="empty small">No gems in your backpack.</div>'}
      ${free ? '' : '<p class="hint">All sockets are full — remove a gem or buy a bigger amulet.</p>'}`;
  },

  tab_book() {
    const found = GEM_IDS.filter((id) => S.found[id]).length;
    return `<div class="book-head">Discovered <b>${found}/${GEM_IDS.length}</b> gemstones</div>
      <div class="book">${GEM_IDS.map((id) => {
        const g = GEMS[id], rar = RARITY[g.r], n = S.found[id] || 0;
        return `<div class="book-card ${n ? '' : 'unknown'}" style="--rc:${rar.color}">
          <img src="${gemIcon(id, 72)}" alt="">
          <b>${n ? esc(g.name) : '???'}</b>
          <small style="color:${rar.color}">${g.boss ? 'Boss Heart' : rar.name}</small>
          ${n ? `<small>${fmt(g.value)}¢ · ${esc(gemBonusText(id))}</small><small class="muted">Found ×${n}</small>` : `<small class="muted">${g.boss ? 'Defeat a living gem' : 'Not yet found'}</small>`}
        </div>`;
      }).join('')}</div>`;
  },
};

// ================= HUD =================
const HUD = {
  init() {
    this.el = {
      hud: $('hud'), hpFill: $('hp-fill'), hpText: $('hp-text'), coins: $('hud-coins'), bag: $('hud-bag'),
      pot: $('hud-potions'), floor: $('hud-floor'), boss: $('boss-ui'), bossName: $('boss-name'),
      bossFill: $('boss-fill'), escWrap: $('escape-wrap'), escFill: $('escape-fill'), bossState: $('boss-state'),
      dash: $('cd-dash'), shoot: $('cd-shoot'), mm: $('minimap'),
    };
    this.mmCtx = this.el.mm.getContext('2d');
    this.last = {};
  },
  show() { this.el.hud.classList.remove('hidden'); if (Input.isTouch) $('touch').classList.remove('hidden'); },
  hide() { this.el.hud.classList.add('hidden'); $('touch').classList.add('hidden'); },
  set(key, el, prop, val) {
    if (this.last[key] === val) return;
    this.last[key] = val;
    if (prop === 'text') el.textContent = val; else if (prop === 'html') el.innerHTML = val; else el.style[prop] = val;
  },
  update(m, dt) {
    const p = m.player, st = m.st, E = this.el;
    this.set('hpw', E.hpFill, 'width', (clamp(p.hp / st.maxHp, 0, 1) * 100).toFixed(1) + '%');
    this.set('hpt', E.hpText, 'text', `${Math.ceil(Math.max(0, p.hp))} / ${st.maxHp}`);
    this.set('coins', E.coins, 'text', fmt(S.coins));
    this.set('bag', E.bag, 'text', `${S.bag.length}/${st.cap}`);
    E.bag.parentElement.classList.toggle('full', S.bag.length >= st.cap);
    this.set('pot', E.pot, 'text', String(S.potions));
    this.set('floor', E.floor, 'text', `Floor ${m.fi + 1} · ${m.F.name}`);
    this.set('cdd', E.dash, 'width', (clamp(1 - p.dashCd / st.dashCd, 0, 1) * 100).toFixed(0) + '%');
    this.set('cds', E.shoot, 'width', st.slingDmg ? (clamp(1 - p.shootCd / st.slingCd, 0, 1) * 100).toFixed(0) + '%' : '0%');
    const b = m.boss;
    const showBoss = b && b.active;
    E.boss.classList.toggle('hidden', !showBoss);
    if (showBoss) {
      this.set('bn', E.bossName, 'text', b.B.name);
      this.set('bf', E.bossFill, 'width', (clamp(b.hp / b.maxHp, 0, 1) * 100).toFixed(1) + '%');
      E.bossFill.style.background = b.B.color;
      const showEsc = b.state === 'flee';
      E.escWrap.classList.toggle('hidden', !showEsc);
      if (showEsc) {
        this.set('ef', E.escFill, 'width', (clamp(b.escape, 0, 1) * 100).toFixed(0) + '%');
        E.escWrap.classList.toggle('far', b.escape > 1);
      }
      const txt = b.state === 'flee'
        ? `💨 FLEEING — stay in range! It tires in ${Math.max(0, b.fleeT).toFixed(1)}s`
        : b.state === 'rest' ? '😵 EXHAUSTED — STRIKE NOW! (+50% dmg)' : '⚔️ FIGHTING';
      this.set('bs', E.bossState, 'text', txt);
      E.bossState.className = 'state-' + b.state;
    }
    this.mmT = (this.mmT || 0) - dt;
    if (this.mmT <= 0) { this.mmT = 0.15; this.drawMinimap(m); }
  },
  drawMinimap(m) {
    const w = m.world, c = this.el.mm, g = this.mmCtx;
    if (!this.mmImg || this.mmImg.width !== w.W || this.mmImg.height !== w.H) {
      this.mmCanvas = makeCanvas(w.W, w.H);
      this.mmImg = this.mmCanvas.getContext('2d').createImageData(w.W, w.H);
    }
    const d = this.mmImg.data;
    const ground = hexToRgb(FLOORS[m.fi].ground).map((v) => Math.min(255, v + 40));
    for (let i = 0; i < w.W * w.H; i++) {
      const o = i * 4;
      if (!w.seen[i]) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0; continue; }
      const t = w.t[i];
      let r, gg, bb;
      if (w.gem[i]) [r, gg, bb] = hexToRgb(RARITY[GEMS[w.gem[i]].r].color);
      else if (t === 0) [r, gg, bb] = ground;
      else if (t === BEDROCK) { r = 20; gg = 16; bb = 26; }
      else [r, gg, bb] = hexToRgb(ROCKS[t - 1].color).map((v) => v * 0.6);
      d[o] = r; d[o + 1] = gg; d[o + 2] = bb; d[o + 3] = 255;
    }
    this.mmCanvas.getContext('2d').putImageData(this.mmImg, 0, 0);
    const cw = c.width, ch = c.height;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.mmCanvas, 0, 0, cw, ch);
    const kx = cw / w.W, ky = ch / w.H;
    const dot = (x, y, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(x * kx, y * ky, r, 0, TAU); g.fill(); };
    dot(w.spawn.x, w.spawn.y, '#f5c542', 3);
    const b = m.boss;
    if (b && b.state !== 'dead') {
      const pulse = 3 + Math.sin(m.time * 6) * 1.2;
      dot(b.x, b.y, b.active ? '#ff5a6e' : b.B.color, pulse);
    }
    dot(m.player.x, m.player.y, '#ffffff', 3);
  },
};

// ================= ECONOMY ACTIONS =================
function sellGems(filter, limit = Infinity) {
  const st = getStats();
  let earned = 0, n = 0;
  const keep = [];
  for (const id of S.bag) {
    if (n < limit && filter(id)) { earned += Math.round(GEMS[id].value * st.valueMult); n++; }
    else keep.push(id);
  }
  if (!n) return;
  S.bag = keep;
  S.coins += earned; S.totalEarned += earned;
  Sfx.play('sell');
  UI.toast(`💰 Sold ${n} gem${n > 1 ? 's' : ''} for ${fmt(earned)}¢`);
}
function buyGear(key) {
  const line = GEAR[key], next = line.tiers[S.gear[key] + 1];
  if (!next || S.coins < next.price) { Sfx.play('deny'); return; }
  S.coins -= next.price;
  S.gear[key]++;
  if (key === 'amulet') while (S.sockets.length < next.slots) S.sockets.push(null);
  Sfx.play('buy');
  UI.toast(`${line.icon} Bought ${next.name}!`);
}
function buyPotion() {
  if (S.coins < POTION_PRICE || S.potions >= POTION_MAX) { Sfx.play('deny'); return; }
  S.coins -= POTION_PRICE; S.potions++;
  Sfx.play('buy');
}
function socketGem(id) {
  const i = S.sockets.indexOf(null), bi = S.bag.indexOf(id);
  if (i < 0 || bi < 0) { Sfx.play('deny'); return; }
  S.bag.splice(bi, 1);
  S.sockets[i] = id;
  Sfx.play('socket');
  UI.toast(`📿 Socketed ${GEMS[id].name}: ${gemBonusText(id)}`);
}
function unsocketGem(i) {
  const id = S.sockets[i];
  if (!id) return;
  S.sockets[i] = null;
  S.bag.push(id);
  Sfx.play('click');
}
