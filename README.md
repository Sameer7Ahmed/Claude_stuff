# Gemdelver

A browser mining game about finding pretty gemstones. Dig through procedurally generated caves for gems, sell them at camp to buy better gear, and hunt the **living gemstones**: bosses that fight back and then **run away through the rock**, so you have to chase them down.

No build step and no dependencies. Open `index.html` in any modern browser (desktop or phone). Progress saves automatically in the browser.

## Gameplay loop

1. **Mine.** Walk into rock to dig. Gems glint inside the walls, and your lantern catches distant sparkles.
2. **Sell.** Recall to camp (`R`, or stand on the elevator) and sell your haul.
3. **Upgrade.** Buy better pickaxes (harder rock), armor, boots, a ranged weapon, lanterns, bigger backpacks and amulets.
4. **Socket.** Instead of selling a gem, socket it into your amulet for a permanent bonus. Rarer gems give much bigger bonuses (Common +3% … Mythic +40%).
5. **Hunt.** Each floor hides a living gem. Beat it to unlock the next floor and claim its unique **Heart** gem.

### Gem rarities

| Rarity | Gems | Socket bonus |
|---|---|---|
| Common | Quartz, Red Jasper | +3% |
| Uncommon | Amethyst, Citrine | +6% |
| Rare | Topaz, Aquamarine | +10% |
| Epic | Sapphire, Emerald | +16% |
| Legendary | Ruby, Diamond | +25% |
| Mythic | Starfire Opal, Void Alexandrite | +40% |
| Boss Hearts | 5 unique gems | multi-stat bonuses |

Deeper floors have harder rock, which needs a better pickaxe, and much better odds of rare gems. The **Gem Luck** stat pushes the odds further.

### Boss fights: the living gems

| Floor | Boss | Style |
|---|---|---|
| 1 Shallow Caves | The Rogue Amethyst | aimed shard bursts |
| 2 Glimmer Grotto | The Topaz Sprinter | wide spreads, very fast |
| 3 Sapphire Depths | The Tidal Sapphire | rings of shards |
| 4 Magma Veins | The Ruby Inferno | spirals + burning trail |
| 5 The Diamond Heart | The Heart Diamond | everything |

- At 75%, 50% and 25% HP the gem **flees**, bursting out shards and burrowing through the rock. Any gems in its path spill out.
- Stay within range (the **DISTANCE** bar) until it tires out. If you're too far behind when it stops, **it escapes and heals** back in its lair.
- Catch up (corner it) or outlast it, and it becomes **Exhausted** for a moment and takes +50% damage.
- Faster boots, dashing, and ranged hits (which briefly slow it) are what let you keep up. Under-geared miners get outrun.

## Controls

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Move / mine | WASD or arrows | drag the left side |
| Swing pickaxe | Space / J / right-click | ⛏️ |
| Shoot | hold left-click (aims at cursor), or F (auto-aim) | 🎯 (auto-aim) |
| Dash (brief invulnerability) | Shift / L | 💨 |
| Potion | Q | 🧪 |
| Recall to camp | R / E | ⤴ |
| Pause / mute | Esc / M | ⏸ |

## Code layout

```
index.html        page shell, HUD and touch controls
css/style.css     all styling
js/util.js        math, colors, safe storage, synth sound effects
js/data.js        gems, rocks, floors, bosses, gear tables, balance numbers
js/gfx.js         faceted gem renderer, tile textures
js/world.js       cave generation (cellular automata + noise), gem placement
js/input.js       keyboard, mouse, touch joystick/buttons
js/game.js        player, enemies, living-gem bosses, mining, rendering, lighting
js/ui.js          camp screens (sell, gear, amulet, gem book), HUD, minimap, toasts
js/main.js        game state, save/load, stats, main loop
```

To rebalance the game, edit the tables in `js/data.js`.
