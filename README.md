# Amir Babaei: Career Odyssey

A Three.js mini-game that turns my CV into an interactive career review: run down a neon valley, unlock a monument for each chapter of my experience and education, open my profile links, and step through the final gateway.

## Features

**World and graphics**
- Post-processing pipeline: HDR render target with MSAA, bloom, ACES tone mapping, vignette, film grain and subtle chromatic aberration
- Night sky baked once into a cubemap (gradient, nebula band, moon, layered mountain ranges) plus a field of twinkling stars
- Image-based lighting from a PMREM environment map, so metals and the character's clear-coat armor pick up neon reflections
- Sculpted valley terrain with a glowing grid, moonlit rim lighting on hills and rocks, and a hex-paved road whose rails light up behind your progress, with chevrons pointing to the next objective
- GPU-animated bioluminescent grass that sways in the wind and bends away from the player
- Crystal clusters, boulders, lamp posts, floating islands and a distant skyline
- Fireflies, unlock bursts with shockwaves, footstep and landing dust

**Career monuments**
- Stepped plinths with holographic briefcases (experience) or graduation caps (education), orbit rings and light beams
- A chapter arch over the road for each milestone
- Labels flip to "Unlocked" in place; beams, rings and arches brighten once a chapter is unlocked
- The finale gateway is visible (dormant) from the start and powers up once every chapter is unlocked

**Character**
- Articulated explorer bot (hips, spine, neck, arms with elbows, legs with knees and ankles) with a glowing reactor core, visor, blinking eyes and twin jet thrusters
- Procedural animation: speed-synced run and sprint cycles, idle breathing and glancing around, jump tuck, landing squash, banking into turns, and head tracking toward nearby monuments
- Collisions with monuments, terminals, lamp posts and arches; coyote time and jump buffering

**Camera, audio and UI**
- Third-person camera with look-ahead, sprint FOV kick, scroll-wheel zoom, terrain clearance, landing shake and a slow showcase orbit behind the start screen
- Generative soundtrack via the Web Audio API: a gliding pad, sub bass and an arpeggio that grows as you unlock chapters, plus reverb and delay. Sound effects are in the same key, and footsteps sync to the animation
- Live distance to the next objective, a graphics quality toggle, touch controls, and `prefers-reduced-motion` support

## Performance

- Adaptive quality: a tier (High / Medium / Low) is picked from device hints, the render resolution scales dynamically to hold the frame rate, and in Auto mode the tier steps down if the device keeps struggling
- A pool of 3 point lights is reassigned each frame to the nearest landmarks, replacing the previous 12 always-on point lights
- Instancing for grass, crystals, rocks, lamps and the skyline; grass is chunked so blades behind the camera are frustum-culled
- Static parts are merged per material (the character is ~35 draw calls; each monument is 7)
- Shared uniforms: one write per frame animates every shader
- Shaders are precompiled during loading to avoid stutters on first sight
- The shadow camera follows the player and snaps to texels, so the shadow map stays sharp and stable
- No per-frame allocations in the main loop
- Lighter `backdrop-filter` use, since blurring over a live canvas is expensive

## Controls

- `WASD` or `Arrow Keys`: Move
- `Shift`: Sprint
- `Space`: Jump
- `Mouse Drag`: Orbit camera
- `Scroll`: Zoom
- `Enter`: Interact / Open links / Finish the game
- `M`: Toggle music

On touch devices, use the joystick, the sprint and jump buttons, and the Inspect pill.

## Graphics options

- First visits start on **Low** (change `DEFAULT_QUALITY_MODE` in `src/app/config.js`)
- Click the **Graphics** chip in the HUD to cycle Low → Auto → High → Medium (remembered between visits)
- Or force a mode with a URL parameter: `?quality=low`, `?quality=medium`, `?quality=high`, `?quality=auto`
- `?debug` exposes the app instance as `window.__careerOdyssey` for inspection in the console

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Project structure

```text
src/
  app/
    CareerOdysseyApp.js      # boot sequence, game state, main loop
    config.js                # tiers, post settings, layout, tuning
    render/RenderPipeline.js # renderer, post chain, adaptive quality
    systems/                 # player, character rig, camera, input, music
    world/                   # sky, terrain, grass, props, monuments, portal, effects
    ui/AppUI.js
    utils/                   # math + deterministic noise
  cvData.js                  # the CV content
  main.js
  style.css
```

No external 3D assets are used: every mesh, texture and sound is generated in code.
