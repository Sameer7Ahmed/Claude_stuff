# Neon Tides

An original open-world driving and crime sandbox that runs in the browser. You arrive in **Port Solano**, a neon-lit island city with a beach, a pier and a downtown full of glass towers. You can steal cars, take jobs from a fixer called Dex, outrun the police and hunt for hidden collectibles.

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
| Left click / E | Punch |
| H | Horn |
| R | Change radio station |
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
- **Story missions**: five jobs from Dex, covering a respray, a timed delivery, a beach race, a heat test and a bank job that ends with an escape by boat.
- **Collectibles**: 12 hidden neon shells. Finding them all pays a bonus.
- **Audio**: synthesized engine, tyres, sirens, helicopter rotor and impacts, plus two generative radio stations.
- **HUD**: a rotating minimap with blips, a full map, money, wanted stars, a speedometer, vehicle and player health, mission objectives and timers.
- Progress (money, missions and collectibles) is saved in `localStorage`.

## Code layout

| File | Responsibility |
| --- | --- |
| `src/main.js` | Bootstrap, game state, main loop, respawns, Paint & Pay |
| `src/world.js` | City generation, colliders, road graph, ground height |
| `src/env.js` | Sky, ocean, sun/moon lighting, day/night |
| `src/vehicle.js` | Car physics and car-vs-car collisions |
| `src/ai.js` | Lane-following driver for traffic and police |
| `src/traffic.js` | Spawning traffic and parked cars |
| `src/peds.js` | Pedestrians |
| `src/player.js` | On-foot movement, punching, entering and exiting cars |
| `src/wanted.js` | Wanted level, police spawning, arrests, helicopter |
| `src/missions.js` | Mission scripts and the step engine that runs them |
| `src/hud.js` | HUD, minimap and full map |
| `src/camera.js` | Third-person camera |
| `src/models.js` | Procedural meshes for cars, people, palms, helicopter and boat |
| `src/textures.js` | Canvas-generated textures |
| `src/effects.js` | GPU particle effects |
| `src/audio.js` | WebAudio synthesis and radio |
| `src/input.js` | Keyboard, mouse and touch input |
