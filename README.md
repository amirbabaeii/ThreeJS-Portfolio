# Amir Babaei: Career Odyssey

A Three.js mini-game that turns my CV into an interactive career review.

## Features

- Modular Three.js architecture with dedicated app, world, player, camera, input, audio, and UI layers
- Smooth third-person movement with camera-relative controls
- Responsive sprint, jump, interaction, and orbit camera handling
- Lightweight synth soundtrack generated with the Web Audio API
- Loading screen with staged world boot-up
- Glowing CV monuments for experience and education
- Finale gateway after all milestones are unlocked
- No external 3D assets required

## Controls

- `WASD` or `Arrow Keys`: Move
- `Shift`: Sprint
- `Space`: Jump
- `Mouse Drag`: Orbit camera
- `Enter`: Interact / Open links / Finish the game

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
    CareerOdysseyApp.js
    config.js
    data/
    systems/
    ui/
    utils/
    world/
  cvData.js
  main.js
  style.css
```

## Notes

The original single-file scene bootstrap has been split into focused modules so gameplay and presentation logic can evolve independently. Runtime milestone state is now cloned from the static CV data instead of mutating the source dataset directly.
