# Neon Tides

An original open-world driving and crime sandbox that runs in the browser. You arrive in **Port Solano**, a neon-lit island city with a beach, a pier and a downtown full of glass towers. Steal cars, take jobs from a fixer called Dex, buy guns, property and upgrades, and pull off a full bank heist.

Built with [three.js](https://threejs.org) (vendored in `vendor/`, MIT licence). There's no build step, and every model, texture and sound is generated in code.

## Play

ES modules need to be served over HTTP, so start any static file server from the repo root:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move, or drive (throttle, brake/reverse, steer) |
| Mouse | Look. Click the game to lock the cursor; if it won't lock, drag with the right button |
| F | Enter, exit or steal a vehicle |
| Space | Jump on foot, handbrake in a car |
| Shift | Sprint |
| Right mouse | Aim (over-the-shoulder; drive-by with the pistol or SMG) |
| Left mouse | Fire, or punch with fists (E also punches) |
| 1–5, Q, mouse wheel | Choose a weapon |
| R | Reload on foot; change radio station in a car |
| Shift (in a car) | Nitro, once fitted |
| F (hold) | Some actions are held: bagging cash, the gold |
| H | Horn |
| M | Full map |
| P / Esc | Pause |
| N | Mute |
| Enter | Skip dialogue |

On touch devices an on-screen joystick and buttons appear automatically, and you drag on the screen to look around.

## What's in it

- **Procedural island city**: a 7×7 grid of blocks with glass towers downtown, pastel low-rises, neon signs, parks, parking lots, a beach with palms and umbrellas, stunt ramps, a pier and lifeguard towers.
- **Day/night cycle**: a full day takes 12 minutes. The sky and ocean are drawn by shaders, building windows light up at night, street lamps cast pools of light, cars turn on their headlights and stars come out.
- **Arcade car physics**: six vehicle types with grip and drift, handbrake slides, softer handling on sand, ramp jumps with airtime bonuses, crash damage, smoke, fire and explosions.
- **Traffic AI**: cars drive in lanes on the road graph, turn at intersections, brake for cars and pedestrians, and back out when they get stuck.
- **Pedestrians**: they walk the sidewalks, cross at corners, dodge speeding cars, flee from trouble, get knocked down and sometimes drop cash.
- **Wanted system**: up to five stars. Police cars chase you along the road grid and box you in to arrest you, and a helicopter with a searchlight joins at four stars. To lose them, stay out of sight until the stars stop flashing, or pay for a respray at **Paint & Pay**.
- **Economy**: cash comes from missions, stunts, robbing Late Mart, selling cars at Dex's lockup, the Neon Arcade's income, scratch cards and the Lucky Tides machine. You spend it on guns, ammo, armor and gear at Iron Palm Arms, on engine, armor, tyre and nitro upgrades at Paint & Pay Customs, and on property. Every gain or loss pops up next to your cash.
- **Property**: Seabreeze Room 6 is a safehouse where you can sleep to save, heal and skip time. It has a daily armor locker and a lot where your upgraded personal car waits. The Neon Arcade is a business that earns money every in-game hour into its office safe.
- **Guns and combat**: four weapons with their own damage, fire rate, spread, recoil, range and sound (pistol, SMG, shotgun, rifle), plus a suppressor. There's over-the-shoulder aiming, a crosshair that reacts to targets, hit markers, headshots, tracers, muzzle flashes, ejected shells, impact sparks, a damage-direction indicator and drive-by shooting.
- **Police response**: patrol cars box you in at 1★. From 2★ officers get out, and from 3★ they shoot. A helicopter you can shoot down arrives at 4★, and tactical units at 5★. Hide in a building and they come through the door. Killing police escalates the heat, and they drop ammo when downed.
- **Interiors**: five enterable buildings, each with its own layout, lighting and staff. Solano Bank has a lobby, teller line, manager's office, staff gate and vault. Iron Palm Arms has a counter, gun racks and a shooting range with pop-up targets. Then there's Late Mart, the motel safehouse, and the Neon Arcade with glowing cabinets and a back office.
- **The Solano Job**: hold up the manager for the vault keycard, or take it off a guard. Swipe through the staff gate, set a thermal drill on the vault (it jams, and you have to restart it), and hold off police waves storming the lobby. Then bag the cash trolleys and the heavy gold, walk out into a 4–5★ cordon, and escape to the boat or lose the cops and reach Dex's lockup. The payout screen splits the take. The bank stays closed for a while afterwards and can be robbed again later.
- **Story missions**: six jobs from Dex: a respray, a timed delivery, a beach race, a gun lesson at the range, a heat test, and the bank heist.
- **Collectibles**: 12 hidden neon shells. Finding them all pays a bonus.
- **Audio**: synthesized engine, tyres, sirens, helicopter rotor and impacts, plus two generative radio stations.
- **HUD**: a rotating minimap with blips, a full map, money, wanted stars, a speedometer, vehicle and player health, mission objectives and timers.
- Progress (money, missions and collectibles) is saved in `localStorage`.

## Code layout

| File | Responsibility |
| --- | --- |
| `src/main.js` | Bootstrap, game state, main loop, world events (gunfire, explosions), respawns, saving |
| `src/world.js` | City generation, colliders, road graph, ground height |
| `src/env.js` | Sky, ocean, sun/moon lighting, day/night |
| `src/vehicle.js` | Car physics and car-vs-car collisions |
| `src/ai.js` | Lane-following driver for traffic and police |
| `src/traffic.js` | Spawning traffic and parked cars |
| `src/peds.js` | Pedestrians |
| `src/player.js` | On-foot movement, punching, entering and exiting cars |
| `src/wanted.js` | Wanted level, police spawning, arrests, helicopter |
| `src/missions.js` | Mission scripts and the step engine that runs them |
| `src/weapons.js` | Weapon stats, the player's arsenal, 3D raycasts, player and NPC fire |
| `src/npc.js` | Armed and unarmed NPCs: customers, staff, guards, police, SWAT |
| `src/interiors.js` | Interior builder, layouts and the enter/exit manager |
| `src/economy.js` | Shops, Customs, chop shop, properties, robberies, range, gambling |
| `src/heist.js` | The bank heist state machine |
| `src/interact.js` | The single "press or hold F" prompt system |
| `src/ui.js` | Shop overlay and heist payout screen |
| `src/hud.js` | HUD, minimap and full map |
| `src/camera.js` | Third-person camera |
| `src/models.js` | Procedural meshes for cars, people, palms, helicopter and boat |
| `src/textures.js` | Canvas-generated textures |
| `src/effects.js` | GPU particle effects |
| `src/audio.js` | WebAudio synthesis and radio |
| `src/input.js` | Keyboard, mouse and touch input |
