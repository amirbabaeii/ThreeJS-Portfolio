import * as THREE from 'three';

import { WORLD_LAYOUT } from '../config.js';
import { damp, dampFactor, smoothstep } from '../utils/math.js';
import { DustEffect, UnlockEffect, createMotes } from './effects.js';
import { createGrassField } from './grass.js';
import { Monument, createGroundGlowMaterial } from './monuments.js';
import { FinishPortal } from './portal.js';
import {
  createCrystalField,
  createFloatingIslands,
  createLampPosts,
  createRockField,
  createSkyline,
  mergeParts,
  placed,
} from './props.js';
import { createHologramMaterial, sharedUniforms } from './shaderLib.js';
import { make3DIconBadge, makeLabelSprite } from './signage.js';
import { bakeSkyBackground, createEnvironmentMap, createStarField } from './sky.js';
import { TRACK, createGround, createRoad, getTerrainHeight } from './terrain.js';

const LIGHT_POOL_SIZE = 3;
const POOL_INTENSITY = 32;
const MOON_OFFSET = new THREE.Vector3(-12, 30, -8);
const SHADOW_EXTENT = 20;
// Road position treated as "progress" before any chapter is unlocked: far
// enough behind the start that no part of the visible road reads as unlocked.
const NO_PROGRESS_Z = TRACK.startZ - 20;

export class CareerWorld {
  constructor({ scene, heroProfile, milestones }) {
    this.scene = scene;
    this.heroProfile = heroProfile;
    this.milestones = milestones;
    this.interactives = [];
    this.monuments = [];
    this.monumentById = new Map();
    this.contactStations = [];
    this.colliders = [];
    this.platforms = [];
    this.lightEmitters = [];
    this.lightPool = [];
    this.finishPortal = null;
    this.beacon = null;
    this.grass = null;
    this.motes = null;
    this.islands = null;
    this.tier = null;
    this.completed = false;
    this.progressTarget = NO_PROGRESS_Z;
    this.tmpVec = new THREE.Vector3();
    this.beaconTarget = new THREE.Vector3();
    this.portalZ =
      WORLD_LAYOUT.firstMonumentZ +
      milestones.length * WORLD_LAYOUT.monumentSpacing +
      WORLD_LAYOUT.finishPortalOffset;
    this.blockers = this.computeBlockers();
  }

  monumentPosition(index) {
    const side = index % 2 === 0 ? -1 : 1;
    return {
      x: side * WORLD_LAYOUT.monumentOffsetX,
      z: WORLD_LAYOUT.firstMonumentZ + index * WORLD_LAYOUT.monumentSpacing,
    };
  }

  /** Areas that scatter passes (grass, crystals, lamps) must keep clear. */
  computeBlockers() {
    const blockers = [{ x: 0, z: 0, r: 2.5 }];

    this.milestones.forEach((_, index) => {
      const { x, z } = this.monumentPosition(index);
      blockers.push({ x, z, r: 3.9 });
      blockers.push({ x: 7.3, z: z - 6, r: 0.9 }, { x: -7.3, z: z - 6, r: 0.9 });
    });

    for (const side of [-1, 1]) {
      blockers.push({ x: side * WORLD_LAYOUT.contactStationX, z: WORLD_LAYOUT.contactStationZ, r: 2.1 });
    }

    blockers.push({ x: 0, z: this.portalZ, r: 6.8 });
    return blockers;
  }

  // ---------------------------------------------------------------------------
  // Construction (called in stages by the loading screen)
  // ---------------------------------------------------------------------------

  createSky(renderer, tier) {
    this.skyTarget = bakeSkyBackground(renderer, tier?.id === 'high' ? 1024 : 512);
    this.scene.background = this.skyTarget.texture;
    this.envTarget = createEnvironmentMap(renderer);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.85;
    this.stars = createStarField();
    this.scene.add(this.stars);
  }

  createLights() {
    this.hemisphere = new THREE.HemisphereLight(0x6d8fd0, 0x0a0e18, 0.5);
    this.scene.add(this.hemisphere);

    this.moon = new THREE.DirectionalLight(0xc4d4ff, 1.75);
    this.moon.position.copy(MOON_OFFSET);
    this.moon.castShadow = true;
    const shadow = this.moon.shadow;
    shadow.mapSize.set(2048, 2048);
    shadow.camera.left = -SHADOW_EXTENT;
    shadow.camera.right = SHADOW_EXTENT;
    shadow.camera.top = SHADOW_EXTENT;
    shadow.camera.bottom = -SHADOW_EXTENT;
    shadow.camera.near = 1;
    shadow.camera.far = 90;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.03;
    this.scene.add(this.moon, this.moon.target);

    // A fixed-size pool of point lights is re-assigned every frame to the
    // glowing landmarks nearest to the player. A constant light count keeps
    // shader programs stable, and 3 lights cost far less than one per prop.
    for (let index = 0; index < LIGHT_POOL_SIZE; index += 1) {
      const light = new THREE.PointLight(0xffffff, 0, 22, 2);
      this.lightPool.push(light);
      this.scene.add(light);
    }
  }

  createTerrain() {
    this.ground = createGround();
    this.road = createRoad();
    this.scene.add(this.ground, this.road);
  }

  createVegetation() {
    this.grass = createGrassField({ blockers: this.blockers });
    this.scene.add(this.grass);
  }

  createProps() {
    this.crystals = createCrystalField({ blockers: this.blockers });
    this.rocks = createRockField({ blockers: this.blockers });
    this.lamps = createLampPosts({ blockers: this.blockers, colliders: this.colliders });
    this.skyline = createSkyline({});
    this.islands = createFloatingIslands({});
    this.scene.add(this.crystals, this.rocks, this.lamps, this.skyline, this.islands);
  }

  createParticleField() {
    this.motes = createMotes({});
    this.scene.add(this.motes);
    this.unlockEffect = new UnlockEffect(this.scene);
    this.dust = new DustEffect(this.scene);
  }

  createMonuments() {
    this.milestones.forEach((item, index) => {
      const { x, z } = this.monumentPosition(index);
      const monument = new Monument(item, { x, z, total: this.milestones.length });
      this.scene.add(monument.group, monument.arch);
      this.monuments.push(monument);
      this.monumentById.set(item.id, monument);
      this.interactives.push(monument.group);
      this.colliders.push(...monument.colliders);
      this.lightEmitters.push({
        anchor: monument.lightAnchor,
        color: new THREE.Color(item.accent),
        strength: () => monument.getLightStrength(),
        d2: 0,
      });
    });

    const beacon = new THREE.Group();
    const diamondGeometry = new THREE.OctahedronGeometry(0.42, 0);
    diamondGeometry.scale(1, 1.7, 1);
    const diamond = new THREE.Mesh(diamondGeometry, createHologramMaterial(0x9be8ff, 1.6));
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.03, 6, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dd3fc).multiplyScalar(3) }),
    );
    halo.rotation.x = Math.PI / 2;
    beacon.add(diamond, halo);
    beacon.userData = { diamond, halo };
    beacon.position.set(0, 12, WORLD_LAYOUT.firstMonumentZ);
    this.beacon = beacon;
    this.scene.add(beacon);
  }

  createContactStations() {
    const plinthGeometry = mergeParts([
      placed(new THREE.CylinderGeometry(1.25, 1.5, 0.5, 8), { position: [0, 0.25, 0], rotation: [0, Math.PI / 8, 0] }),
      placed(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 8), { position: [0, 0.75, 0], rotation: [0, Math.PI / 8, 0] }),
    ]);
    const trimGeometry = mergeParts([
      placed(new THREE.TorusGeometry(1.29, 0.04, 6, 64), { position: [0, 0.52, 0], rotation: [Math.PI / 2, 0, 0] }),
      placed(new THREE.TorusGeometry(0.93, 0.035, 6, 64), { position: [0, 1.02, 0], rotation: [Math.PI / 2, 0, 0] }),
    ]);
    const glowGeometry = new THREE.CircleGeometry(2.6, 40);
    glowGeometry.rotateX(-Math.PI / 2);
    const plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x182133, metalness: 0.78, roughness: 0.3 });

    this.heroProfile.links.forEach((link, index) => {
      const group = new THREE.Group();
      const side = index === 0 ? -1 : 1;
      group.position.set(side * WORLD_LAYOUT.contactStationX, 0, WORLD_LAYOUT.contactStationZ);
      const accent = new THREE.Color(link.accent);

      const plinth = new THREE.Mesh(plinthGeometry, plinthMaterial);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      group.add(plinth);

      const trimMaterial = new THREE.MeshStandardMaterial({
        color: accent.clone().multiplyScalar(0.3),
        emissive: accent,
        emissiveIntensity: 1.3,
      });
      group.add(new THREE.Mesh(trimGeometry, trimMaterial));

      const badge = make3DIconBadge(link);
      badge.position.set(0, 2.38, 0);
      badge.rotation.y = Math.PI - side * 0.25;
      group.add(badge);

      const label = makeLabelSprite({
        eyebrow: 'Profile terminal',
        title: link.label,
        subtitle: link.description,
        accent: link.accent,
        status: { text: '↗ Open link', filled: false },
      });
      label.scale.multiplyScalar(0.72);
      label.position.set(0, 4.35, 0);
      group.add(label);

      const glowMaterial = createGroundGlowMaterial(accent);
      glowMaterial.uniforms.uStrength.value = 1;
      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.position.y = 0.04;
      group.add(glow);

      group.userData = {
        type: 'link',
        link,
        interactionRadius: 3.3,
        badge,
        label,
        badgeBaseY: badge.position.y,
        baseRotationY: badge.rotation.y,
        glowMaterial,
        trimMaterial,
      };

      this.scene.add(group);
      this.contactStations.push(group);
      this.interactives.push(group);
      this.colliders.push({ x: group.position.x, z: group.position.z, r: 1.5 });
      this.lightEmitters.push({
        anchor: new THREE.Vector3(group.position.x, 2.4, group.position.z - 1.2),
        color: accent,
        strength: () => 0.55,
        d2: 0,
      });
    });
  }

  createFinishPortal() {
    const portal = new FinishPortal(this.portalZ);
    this.finishPortal = portal;
    this.scene.add(portal.group);
    this.interactives.push(portal.group);
    this.colliders.push(...portal.colliders);
    this.platforms.push(portal.platform);
    this.lightEmitters.push({
      anchor: portal.lightAnchor,
      color: new THREE.Color(0xc084fc),
      strength: () => portal.getLightStrength(),
      d2: 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Quality
  // ---------------------------------------------------------------------------

  applyQuality(tier) {
    this.tier = tier;

    if (this.moon) {
      this.moon.castShadow = tier.shadows;

      if (this.moon.shadow.mapSize.x !== tier.shadowMapSize) {
        this.moon.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
        this.moon.shadow.map?.dispose();
        this.moon.shadow.map = null;
      }
    }

    this.grass?.userData.setDensity(tier.grassDensity);
    this.motes?.userData.setDensity(tier.particleDensity);
  }

  // ---------------------------------------------------------------------------
  // Gameplay queries
  // ---------------------------------------------------------------------------

  getGroundHeight(x, z) {
    let height = getTerrainHeight(x, z);

    for (const platform of this.platforms) {
      const dx = x - platform.x;
      const dz = z - platform.z;

      if (dx * dx + dz * dz < platform.r * platform.r) {
        height = Math.max(height, platform.height);
      }
    }

    return height;
  }

  getUnlockedCount() {
    return this.milestones.filter((item) => item.unlocked).length;
  }

  getNextMilestone() {
    return this.milestones.find((item) => !item.unlocked) ?? null;
  }

  getMilestonePosition(item) {
    return this.monumentById.get(item.id)?.group.position ?? null;
  }

  getObjectivePosition() {
    const next = this.getNextMilestone();

    if (next) {
      return this.getMilestonePosition(next);
    }

    return this.finishPortal?.group.position ?? null;
  }

  getMaxPlayerZ() {
    return this.portalZ;
  }

  isFinishActive() {
    return Boolean(this.finishPortal?.active);
  }

  unlockMilestone(target) {
    const monument = target.userData.monument;
    const milestone = target.userData.item;

    if (milestone.unlocked) {
      return false;
    }

    milestone.unlocked = true;
    monument.unlock();
    this.unlockEffect.play(monument.group.position, milestone.accent);
    this.refreshProgressTarget();
    return true;
  }

  refreshProgressTarget() {
    const unlocked = this.monuments.filter((monument) => monument.item.unlocked);

    if (unlocked.length === this.monuments.length) {
      this.progressTarget = this.portalZ + 40;
      return;
    }

    this.progressTarget = unlocked.reduce((max, monument) => Math.max(max, monument.group.position.z + 4), NO_PROGRESS_Z);
  }

  setFinishPortalActive(active) {
    this.finishPortal?.setActive(active);
  }

  setCompleted(completed) {
    this.completed = completed;
  }

  reset() {
    this.milestones.forEach((item) => {
      item.unlocked = false;
    });
    this.monuments.forEach((monument) => monument.reset());
    this.setFinishPortalActive(false);
    this.completed = false;
    this.refreshProgressTarget();
  }

  getNearestInteractive(position) {
    let nearest = null;
    let bestDistanceSquared = Infinity;

    for (const target of this.interactives) {
      if (target.userData.type === 'finish' && !this.isFinishActive()) {
        continue;
      }

      const radius = target.userData.interactionRadius;
      const dx = target.position.x - position.x;
      const dz = target.position.z - position.z;
      const distanceSquared = dx * dx + dz * dz;

      if (distanceSquared < radius * radius && distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        nearest = target;
      }
    }

    return nearest;
  }

  emitFootstep(position, strength) {
    this.dust?.footstep(position, strength);
  }

  emitLanding(position, intensity) {
    this.dust?.landing(position, intensity);
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  updateShadowFollow(focus) {
    if (!this.moon) {
      return;
    }

    // Snap to shadow texels so the shadow map doesn't shimmer while moving.
    const texel = (SHADOW_EXTENT * 2) / this.moon.shadow.mapSize.x;
    const x = Math.round(focus.x / texel) * texel;
    const z = Math.round(focus.z / texel) * texel;
    this.moon.target.position.set(x, 0, z);
    this.moon.position.set(x + MOON_OFFSET.x, MOON_OFFSET.y, z + MOON_OFFSET.z);
  }

  updateLightPool(focus) {
    const emitters = this.lightEmitters;

    for (const emitter of emitters) {
      emitter.d2 = emitter.anchor.distanceToSquared(focus);
    }

    emitters.sort((a, b) => a.d2 - b.d2);

    this.lightPool.forEach((light, index) => {
      const emitter = emitters[index];

      if (!emitter) {
        light.intensity = 0;
        return;
      }

      const distance = Math.sqrt(emitter.d2);
      light.position.copy(emitter.anchor);
      light.color.copy(emitter.color);
      light.intensity = POOL_INTENSITY * emitter.strength() * smoothstep(42, 16, distance);
    });
  }

  updateBeacon(dt, time, nextMilestone) {
    if (!this.beacon) {
      return;
    }

    let target = null;

    if (nextMilestone) {
      const position = this.getMilestonePosition(nextMilestone);

      if (position) {
        target = this.beaconTarget.set(position.x, 10.4, position.z);
      }
    } else if (this.isFinishActive() && !this.completed) {
      const position = this.finishPortal.group.position;
      target = this.beaconTarget.set(position.x, 9.6, position.z);
    }

    this.beacon.visible = Boolean(target);

    if (!target) {
      return;
    }

    this.beacon.position.lerp(target, dampFactor(4, dt));
    const { diamond, halo } = this.beacon.userData;
    diamond.rotation.y += dt * 2.2;
    diamond.position.y = Math.sin(time * 2.4) * 0.25;
    halo.scale.setScalar(1 + Math.sin(time * 3.2) * 0.12);
    halo.position.y = diamond.position.y - 0.9;
  }

  updateStations(time) {
    for (const station of this.contactStations) {
      const data = station.userData;
      const phase = time + station.position.x;
      data.badge.position.y = data.badgeBaseY + Math.sin(phase * 1.6) * 0.07;
      data.badge.rotation.y = data.baseRotationY + Math.sin(phase * 0.8) * 0.12;
      data.label.position.y = 4.35 + Math.sin(phase * 1.9) * 0.08;
      data.glowMaterial.uniforms.uStrength.value = 0.9 + Math.sin(phase * 3) * 0.2;
    }
  }

  updateAnimations({ time, dt, nextMilestone, camera, playerPosition }) {
    sharedUniforms.uPlayerPos.value.copy(playerPosition);
    sharedUniforms.uProgressZ.value = damp(sharedUniforms.uProgressZ.value, this.progressTarget, 1.4, dt);

    const objective = this.getObjectivePosition();
    const targetZ = objective ? objective.z : this.portalZ;
    sharedUniforms.uTargetZ.value = damp(sharedUniforms.uTargetZ.value, targetZ, 2.5, dt);

    if (this.stars) {
      this.stars.position.copy(camera.position);
    }

    this.updateShadowFollow(playerPosition);

    for (const monument of this.monuments) {
      monument.setNext(monument.item === nextMilestone);
      monument.update(time, dt, camera.position);
    }

    this.updateStations(time);
    this.finishPortal?.update(time, dt);
    this.islands?.userData.update(time, dt);
    this.unlockEffect?.update(dt);
    this.updateBeacon(dt, time, nextMilestone);
    this.updateLightPool(playerPosition);
  }
}
