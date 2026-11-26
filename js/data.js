'use strict';
// ================= RARITIES =================
const RARITY = [
  { name: 'Common', color: '#c9d1d9' },
  { name: 'Uncommon', color: '#5ee26b' },
  { name: 'Rare', color: '#4ea8ff' },
  { name: 'Epic', color: '#c07bff' },
  { name: 'Legendary', color: '#ffb340' },
  { name: 'Mythic', color: '#ff5fb7' },
];
// Socket bonus size per rarity: higher rarity = much stronger bonus.
const PCT = [3, 6, 10, 16, 25, 40];
const REGEN = [0.2, 0.4, 0.8, 1.4, 2.2, 3.5];

const STAT_NAMES = {
  mine: 'Mining Speed',
  luck: 'Gem Luck',
  speed: 'Move Speed',
  hp: 'Max HP',
  dmg: 'Damage',
  regen: 'HP Regen',
  def: 'Defense',
  value: 'Sell Value',
};

// ================= GEMS =================
// r = rarity index, value = coin value, stat = socket bonus type
const GEMS = {
  quartz:      { name: 'Quartz', r: 0, color: '#eef3fa', cut: 'round', value: 6, stat: 'mine' },
  jasper:      { name: 'Red Jasper', r: 0, color: '#c8603c', cut: 'cushion', value: 9, stat: 'hp' },
  amethyst:    { name: 'Amethyst', r: 1, color: '#a463f2', cut: 'trillion', value: 24, stat: 'luck' },
  citrine:     { name: 'Citrine', r: 1, color: '#f5c542', cut: 'cushion', value: 32, stat: 'value' },
  topaz:       { name: 'Topaz', r: 2, color: '#ff9a3c', cut: 'pear', value: 85, stat: 'speed' },
  aquamarine:  { name: 'Aquamarine', r: 2, color: '#5fe0d8', cut: 'emerald', value: 110, stat: 'regen' },
  sapphire:    { name: 'Sapphire', r: 3, color: '#2f6bff', cut: 'oval', value: 260, stat: 'def' },
  emerald:     { name: 'Emerald', r: 3, color: '#2fd47a', cut: 'emerald', value: 330, stat: 'luck' },
  ruby:        { name: 'Ruby', r: 4, color: '#ff2d55', cut: 'heart', value: 850, stat: 'dmg' },
  diamond:     { name: 'Diamond', r: 4, color: '#dff6ff', cut: 'round', value: 1200, stat: 'mine' },
  opal:        { name: 'Starfire Opal', r: 5, color: '#ff8ad8', cut: 'marquise', value: 3200, stat: 'value', rainbow: true },
  alexandrite: { name: 'Void Alexandrite', r: 5, color: '#7a3cff', cut: 'star', value: 4800, stat: 'dmg', rainbow: true },
  // ---- Boss hearts: unique drops from living gems ----
  h_amethyst: { name: 'Amethyst Heart', r: 5, boss: true, color: '#c58cff', cut: 'heart', value: 500, stats: { luck: 20, speed: 8 } },
  h_topaz:    { name: 'Sunrunner Topaz', r: 5, boss: true, color: '#ffb347', cut: 'pear', value: 1800, stats: { speed: 20, def: 8 } },
  h_sapphire: { name: 'Tidecore Sapphire', r: 5, boss: true, color: '#4f86ff', cut: 'oval', value: 6000, stats: { regen: 3, hp: 25 } },
  h_ruby:     { name: 'Inferno Heart', r: 5, boss: true, color: '#ff3b5c', cut: 'heart', value: 18000, stats: { dmg: 35, mine: 20 } },
  h_diamond:  { name: 'Heart of the Deep', r: 5, boss: true, color: '#eafaff', cut: 'star', value: 60000, stats: { luck: 40, value: 30, dmg: 20 }, rainbow: true },
};
const GEM_IDS = Object.keys(GEMS);
const GEMS_BY_RARITY = [[], [], [], [], [], []];
for (const id of GEM_IDS) if (!GEMS[id].boss) GEMS_BY_RARITY[GEMS[id].r].push(id);

function gemStats(id) {
  const g = GEMS[id];
  if (g.stats) return g.stats;
  return { [g.stat]: g.stat === 'regen' ? REGEN[g.r] : PCT[g.r] };
}
function statLine(stat, v) {
  if (stat === 'regen') return `+${v} HP/s regen`;
  return `+${v}% ${STAT_NAMES[stat]}`;
}
function gemBonusText(id) {
  const s = gemStats(id);
  return Object.keys(s).map((k) => statLine(k, s[k])).join(', ');
}

// ================= ROCKS =================
// hp = seconds to mine with power 1; tier = pickaxe tier required
const ROCKS = [
  { name: 'Packed Dirt', hp: 0.6, tier: 1, color: '#7a5534' },
  { name: 'Stone', hp: 1.4, tier: 1, color: '#6f7079' },
  { name: 'Granite', hp: 3.2, tier: 2, color: '#9a7f78' },
  { name: 'Basalt', hp: 6, tier: 3, color: '#4a4f5e' },
  { name: 'Obsidian', hp: 11, tier: 4, color: '#3a2a4d' },
  { name: 'Adamantite', hp: 20, tier: 5, color: '#2e6670' },
];

// ================= FLOORS =================
const FLOORS = [
  {
    name: 'Shallow Caves', rocks: [0, 1], ground: '#2b2219', density: 0.03,
    rarity: [70, 25, 4.5, 0.5, 0, 0], enemies: 9,
    enemy: { name: 'Cave Beetle', hp: 14, dmg: 6, speed: 1.7, color: '#8a6a3a', crystal: '#e8eef5', coins: [2, 5] },
    boss: 'amethyst',
  },
  {
    name: 'Glimmer Grotto', rocks: [1, 2], ground: '#20222e', density: 0.034,
    rarity: [45, 34, 15, 5, 1, 0], enemies: 12,
    enemy: { name: 'Glimmer Crawler', hp: 36, dmg: 11, speed: 2.2, color: '#5a4a7a', crystal: '#a463f2', coins: [6, 12] },
    boss: 'topaz',
  },
  {
    name: 'Sapphire Depths', rocks: [2, 3], ground: '#132231', density: 0.038,
    rarity: [25, 33, 25, 12, 4.5, 0.5], enemies: 15,
    enemy: { name: 'Deep Crab', hp: 85, dmg: 18, speed: 2.6, color: '#2e5a7a', crystal: '#5fe0d8', coins: [15, 30] },
    boss: 'sapphire',
  },
  {
    name: 'Magma Veins', rocks: [3, 4], ground: '#2a1510', density: 0.042,
    rarity: [12, 24, 28, 22, 11, 3], enemies: 17,
    enemy: { name: 'Magma Slug', hp: 180, dmg: 28, speed: 3.0, color: '#7a2e1e', crystal: '#ff7a3c', coins: [40, 80] },
    boss: 'ruby',
  },
  {
    name: 'The Diamond Heart', rocks: [4, 5], ground: '#171a28', density: 0.046,
    rarity: [5, 14, 24, 28, 21, 8], enemies: 19,
    enemy: { name: 'Crystal Wraith', hp: 360, dmg: 42, speed: 3.4, color: '#3a4a6a', crystal: '#dff6ff', coins: [100, 200] },
    boss: 'diamond',
  },
];

// ================= BOSSES (living gemstones) =================
const BOSSES = {
  amethyst: {
    name: 'The Rogue Amethyst', color: '#b06bff', cut: 'trillion', hp: 150, dmg: 6, contact: 10,
    speed: 1.7, fleeSpeed: 4.1, fleeTime: 7, fireCd: 1.5, pattern: 'aimed', bulletSpeed: 4.2,
    heart: 'h_amethyst', reward: 250,
  },
  topaz: {
    name: 'The Topaz Sprinter', color: '#ffa53c', cut: 'pear', hp: 400, dmg: 9, contact: 14,
    speed: 2.1, fleeSpeed: 4.8, fleeTime: 7.5, fireCd: 1.35, pattern: 'spread', bulletSpeed: 4.8,
    heart: 'h_topaz', reward: 900,
  },
  sapphire: {
    name: 'The Tidal Sapphire', color: '#3d74ff', cut: 'oval', hp: 950, dmg: 13, contact: 20,
    speed: 2.4, fleeSpeed: 5.6, fleeTime: 7.5, fireCd: 1.7, pattern: 'ring', bulletSpeed: 4.6,
    heart: 'h_sapphire', reward: 3000,
  },
  ruby: {
    name: 'The Ruby Inferno', color: '#ff2d55', cut: 'heart', hp: 2100, dmg: 19, contact: 28,
    speed: 2.7, fleeSpeed: 6.3, fleeTime: 8, fireCd: 2.2, pattern: 'spiral', bulletSpeed: 4.4,
    heart: 'h_ruby', reward: 9000, fireTrail: true,
  },
  diamond: {
    name: 'The Heart Diamond', color: '#dff6ff', cut: 'round', hp: 4400, dmg: 27, contact: 38,
    speed: 3.0, fleeSpeed: 7.0, fleeTime: 8, fireCd: 1.6, pattern: 'all', bulletSpeed: 5.0,
    heart: 'h_diamond', reward: 30000, fireTrail: true, rainbow: true,
  },
};

// ================= GEAR =================
const GEAR = {
  pick: {
    label: 'Pickaxe', icon: '⛏️', tiers: [
      { name: 'Rusty Pick', price: 0, power: 1, tier: 1, dmg: 4 },
      { name: 'Copper Pick', price: 150, power: 1.7, tier: 2, dmg: 7 },
      { name: 'Iron Pick', price: 650, power: 2.8, tier: 3, dmg: 12 },
      { name: 'Steel Pick', price: 2400, power: 4.6, tier: 4, dmg: 20 },
      { name: 'Mithril Pick', price: 8000, power: 7.5, tier: 5, dmg: 33 },
      { name: 'Starforged Pick', price: 24000, power: 12, tier: 6, dmg: 54 },
    ],
  },
  armor: {
    label: 'Armor', icon: '🛡️', tiers: [
      { name: 'Cloth Tunic', price: 0, hp: 50, def: 0 },
      { name: 'Leather Vest', price: 140, hp: 80, def: 0.05 },
      { name: 'Chainmail', price: 600, hp: 120, def: 0.1 },
      { name: 'Plate Armor', price: 2200, hp: 180, def: 0.15 },
      { name: 'Crystal Plate', price: 7500, hp: 260, def: 0.2 },
      { name: 'Celestial Aegis', price: 22000, hp: 370, def: 0.25 },
    ],
  },
  boots: {
    label: 'Boots', icon: '👢', tiers: [
      { name: 'Worn Boots', price: 0, speed: 3.2, dash: 3.0 },
      { name: "Runner's Boots", price: 120, speed: 3.8, dash: 2.8 },
      { name: 'Swift Striders', price: 550, speed: 4.4, dash: 2.6 },
      { name: 'Gale Boots', price: 2000, speed: 5.0, dash: 2.4 },
      { name: 'Comet Treads', price: 7000, speed: 5.7, dash: 2.2 },
      { name: 'Lightning Greaves', price: 21000, speed: 6.5, dash: 2.0 },
    ],
  },
  sling: {
    label: 'Ranged', icon: '🏹', tiers: [
      { name: 'None', price: 0, dmg: 0, cd: 1 },
      { name: 'Slingshot', price: 100, dmg: 5, cd: 0.8 },
      { name: 'Crossbow', price: 500, dmg: 9, cd: 0.65 },
      { name: 'Crystal Wand', price: 2000, dmg: 16, cd: 0.5 },
      { name: 'Prism Cannon', price: 7000, dmg: 28, cd: 0.42 },
      { name: 'Star Lance', price: 22000, dmg: 46, cd: 0.33 },
    ],
  },
  lamp: {
    label: 'Lantern', icon: '🏮', tiers: [
      { name: 'Candle', price: 0, radius: 4.5 },
      { name: 'Oil Lamp', price: 90, radius: 5.5 },
      { name: "Miner's Lamp", price: 450, radius: 6.5 },
      { name: 'Crystal Lamp', price: 1800, radius: 7.8 },
      { name: 'Sunstone Lantern', price: 6500, radius: 9.5 },
    ],
  },
  bag: {
    label: 'Backpack', icon: '🎒', tiers: [
      { name: 'Pouch', price: 0, cap: 10 },
      { name: 'Satchel', price: 100, cap: 20 },
      { name: 'Rucksack', price: 450, cap: 35 },
      { name: 'Hauler Pack', price: 1800, cap: 55 },
      { name: 'Bottomless Bag', price: 6500, cap: 85 },
      { name: 'Void Pocket', price: 20000, cap: 120 },
    ],
  },
  amulet: {
    label: 'Amulet', icon: '📿', tiers: [
      { name: 'Simple Cord', price: 0, slots: 1 },
      { name: 'Silver Chain', price: 300, slots: 2 },
      { name: 'Gold Locket', price: 3000, slots: 3 },
      { name: 'Star Pendant', price: 15000, slots: 4 },
    ],
  },
};
const GEAR_ORDER = ['pick', 'armor', 'boots', 'sling', 'lamp', 'bag', 'amulet'];
const POTION_PRICE = 25;
const POTION_MAX = 5;

function pickNameForTier(tier) {
  const t = GEAR.pick.tiers.find((p) => p.tier >= tier);
  return t ? t.name : 'better pickaxe';
}
function rollGem(fi, luck, R) {
  const w = FLOORS[fi].rarity.slice();
  const m = 1 + luck / 100;
  for (let r = 1; r < w.length; r++) w[r] *= Math.pow(m, r);
  const rar = pickWeighted(w, R());
  const list = GEMS_BY_RARITY[rar];
  return list[Math.floor(R() * list.length)];
}
