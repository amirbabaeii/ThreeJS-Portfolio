import * as THREE from 'three';

import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { angleDelta, clamp, dampFactor, lerp, smoothstep } from '../utils/math.js';
import { mergeParts, placed } from '../world/props.js';

const HIP_HEIGHT = 1.0;
const CORE_COLOR = new THREE.Color(0x4fd8ff);

function createMaterials() {
  return {
    armor: new THREE.MeshPhysicalMaterial({
      color: 0xe8f0fa,
      roughness: 0.3,
      metalness: 0.05,
      clearcoat: 0.85,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.7,
    }),
    suit: new THREE.MeshStandardMaterial({ color: 0x1d2739, roughness: 0.75, metalness: 0.12 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x343f55, roughness: 0.3, metalness: 0.9 }),
    glow: new THREE.MeshStandardMaterial({
      color: 0x06202c,
      emissive: CORE_COLOR.clone(),
      emissiveIntensity: 2.4,
      roughness: 0.4,
    }),
    visor: new THREE.MeshPhysicalMaterial({
      color: 0x04070d,
      roughness: 0.05,
      metalness: 0.5,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      emissive: 0x0a2f55,
      emissiveIntensity: 0.6,
    }),
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9ff6ff).multiplyScalar(4) }),
    flame: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x67e8f9).multiplyScalar(3),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    flameCore: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xf0fdff).multiplyScalar(4),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
}

/**
 * Collects static parts per (bone, material) and merges them, so the whole
 * character is ~25 draw calls instead of ~70 separate meshes.
 */
class PartBuilder {
  constructor() {
    this.buckets = new Map();
  }

  add(bone, geometry, material, transform = {}) {
    const key = `${bone.uuid}:${material.uuid}`;

    if (!this.buckets.has(key)) {
      this.buckets.set(key, { bone, material, geometries: [] });
    }

    this.buckets.get(key).geometries.push(placed(geometry, transform));
  }

  build() {
    for (const { bone, material, geometries } of this.buckets.values()) {
      const merged = geometries.length === 1 ? geometries[0] : mergeParts(geometries);
      const parts = merged ? [merged] : geometries;

      for (const geometry of parts) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        bone.add(mesh);
      }
    }
  }
}

export class CharacterRig {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.materials = createMaterials();
    this.bones = {};
    this.flames = [];

    this.time = 0;
    this.phase = 0;
    this.lastStep = -1;
    this.moveW = 0;
    this.sprintW = 0;
    this.airW = 0;
    this.land = 0;
    this.bank = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.thrust = 0;
    this.blinkTimer = 2;
    this.blink = 0;
    this.flash = 0;
    this.flashColor = new THREE.Color();

    this.build();
  }

  bone(name, parent, position) {
    const bone = new THREE.Group();
    bone.name = name;
    bone.position.set(...position);
    parent.add(bone);
    this.bones[name] = bone;
    return bone;
  }

  build() {
    const m = this.materials;
    const pb = new PartBuilder();

    const hips = this.bone('hips', this.body, [0, HIP_HEIGHT, 0]);
    const spine = this.bone('spine', hips, [0, 0.1, 0]);
    const neck = this.bone('neck', spine, [0, 0.64, 0]);
    const head = this.bone('head', neck, [0, 0.2, 0.02]);

    // Pelvis + belt light.
    pb.add(hips, new RoundedBoxGeometry(0.42, 0.22, 0.27, 2, 0.07), m.suit);
    pb.add(hips, new THREE.BoxGeometry(0.44, 0.035, 0.29), m.glow, { position: [0, 0.07, 0] });

    // Torso: abdomen, chest plate, reactor core, collar.
    pb.add(spine, new THREE.CapsuleGeometry(0.17, 0.14, 4, 12), m.suit, { position: [0, 0.12, 0] });
    pb.add(spine, new RoundedBoxGeometry(0.6, 0.46, 0.36, 3, 0.13), m.armor, { position: [0, 0.4, 0] });
    pb.add(spine, new RoundedBoxGeometry(0.5, 0.12, 0.3, 2, 0.05), m.metal, { position: [0, 0.18, 0] });
    pb.add(spine, new THREE.CylinderGeometry(0.08, 0.08, 0.05, 20), m.glow, { position: [0, 0.42, 0.18], rotation: [Math.PI / 2, 0, 0] });
    pb.add(spine, new THREE.TorusGeometry(0.1, 0.018, 8, 24), m.metal, { position: [0, 0.42, 0.188] });
    pb.add(spine, new THREE.CylinderGeometry(0.15, 0.19, 0.08, 16), m.metal, { position: [0, 0.64, 0] });

    // Backpack with twin thrusters.
    pb.add(spine, new RoundedBoxGeometry(0.42, 0.46, 0.18, 2, 0.06), m.metal, { position: [0, 0.4, -0.25] });
    pb.add(spine, new THREE.BoxGeometry(0.28, 0.035, 0.02), m.glow, { position: [0, 0.53, -0.345] });
    pb.add(spine, new THREE.BoxGeometry(0.28, 0.035, 0.02), m.glow, { position: [0, 0.46, -0.345] });

    for (const sx of [-0.12, 0.12]) {
      pb.add(spine, new THREE.CylinderGeometry(0.065, 0.085, 0.16, 14), m.metal, { position: [sx, 0.13, -0.27] });
      pb.add(spine, new THREE.CylinderGeometry(0.056, 0.056, 0.02, 14), m.glow, { position: [sx, 0.045, -0.27] });

      const flame = new THREE.Group();
      flame.position.set(sx, 0.04, -0.27);
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.44, 12, 1, true), m.flame);
      outer.rotation.x = Math.PI;
      outer.position.y = -0.22;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.26, 10, 1, true), m.flameCore);
      inner.rotation.x = Math.PI;
      inner.position.y = -0.13;
      flame.add(outer, inner);
      flame.visible = false;
      spine.add(flame);
      this.flames.push(flame);
    }

    // Neck + helmet.
    pb.add(neck, new THREE.CylinderGeometry(0.07, 0.09, 0.14, 12), m.suit, { position: [0, 0.06, 0] });
    pb.add(head, new THREE.SphereGeometry(0.27, 32, 24), m.armor, { scale: [1, 0.94, 1.02] });
    pb.add(head, new THREE.SphereGeometry(0.282, 32, 16, Math.PI / 2 - 0.95, 1.9, 0.95, 1.05), m.visor, {
      scale: [1, 0.94, 1.03],
    });
    pb.add(head, new THREE.CylinderGeometry(0.012, 0.016, 0.24, 6), m.metal, { position: [0.16, 0.25, -0.06], rotation: [0, 0, -0.35] });
    pb.add(head, new THREE.SphereGeometry(0.034, 10, 8), m.glow, { position: [0.201, 0.365, -0.06] });

    for (const sx of [-1, 1]) {
      pb.add(head, new THREE.CylinderGeometry(0.075, 0.075, 0.07, 16), m.metal, { position: [sx * 0.262, 0, 0], rotation: [0, 0, Math.PI / 2] });
      pb.add(head, new THREE.TorusGeometry(0.052, 0.012, 6, 20), m.glow, { position: [sx * 0.3, 0, 0], rotation: [0, Math.PI / 2, 0] });
    }

    // Eyes live in their own mesh so they can blink.
    this.eyes = new THREE.Mesh(
      mergeParts([-1, 1].map((sx) => placed(new THREE.CapsuleGeometry(0.028, 0.055, 4, 8), {
        position: [sx * 0.085, 0.02, 0.283],
        rotation: [0, 0, Math.PI / 2],
      }))),
      m.eye,
    );
    head.add(this.eyes);

    // Arms and legs, mirrored.
    for (const [side, sx] of [['L', -1], ['R', 1]]) {
      const shoulder = this.bone(`shoulder${side}`, spine, [sx * 0.37, 0.5, 0]);
      const elbow = this.bone(`elbow${side}`, shoulder, [0, -0.3, 0]);
      const hand = this.bone(`hand${side}`, elbow, [0, -0.27, 0]);

      pb.add(shoulder, new THREE.SphereGeometry(0.14, 16, 12), m.armor, { position: [sx * 0.02, 0.02, 0], scale: [1.15, 0.9, 1.05] });
      pb.add(shoulder, new THREE.CapsuleGeometry(0.065, 0.16, 4, 10), m.suit, { position: [0, -0.15, 0] });
      pb.add(shoulder, new THREE.CapsuleGeometry(0.078, 0.05, 4, 10), m.armor, { position: [0, -0.13, 0] });
      pb.add(elbow, new THREE.SphereGeometry(0.068, 12, 10), m.metal);
      pb.add(elbow, new THREE.CapsuleGeometry(0.074, 0.13, 4, 10), m.armor, { position: [0, -0.13, 0] });
      pb.add(elbow, new THREE.TorusGeometry(0.072, 0.014, 6, 18), m.glow, { position: [0, -0.22, 0], rotation: [Math.PI / 2, 0, 0] });
      pb.add(hand, new RoundedBoxGeometry(0.1, 0.12, 0.09, 2, 0.035), m.metal, { position: [0, -0.03, 0.01] });

      const hip = this.bone(`hip${side}`, hips, [sx * 0.13, -0.05, 0]);
      const knee = this.bone(`knee${side}`, hip, [0, -0.45, 0]);
      const ankle = this.bone(`ankle${side}`, knee, [0, -0.44, 0]);

      pb.add(hip, new THREE.CapsuleGeometry(0.09, 0.26, 4, 10), m.suit, { position: [0, -0.22, 0] });
      pb.add(hip, new RoundedBoxGeometry(0.17, 0.24, 0.17, 2, 0.06), m.armor, { position: [sx * 0.01, -0.2, 0.015] });
      pb.add(knee, new THREE.SphereGeometry(0.085, 12, 10), m.armor, { position: [0, 0, 0.025] });
      pb.add(knee, new THREE.CapsuleGeometry(0.085, 0.24, 4, 10), m.armor, { position: [0, -0.22, 0] });
      pb.add(knee, new THREE.BoxGeometry(0.03, 0.17, 0.012), m.glow, { position: [0, -0.2, 0.088] });
      pb.add(ankle, new RoundedBoxGeometry(0.15, 0.1, 0.3, 2, 0.04), m.metal, { position: [0, -0.01, 0.05] });
      pb.add(ankle, new THREE.BoxGeometry(0.156, 0.018, 0.306), m.glow, { position: [0, -0.04, 0.05] });
    }

    pb.build();
  }

  /** Briefly tints the reactor lights (used when a milestone unlocks). */
  pulse(color) {
    this.flash = 1;
    this.flashColor.set(color);
  }

  onLand(intensity) {
    this.land = Math.max(this.land, clamp(intensity, 0.25, 1));
  }

  reset() {
    this.phase = 0;
    this.moveW = 0;
    this.sprintW = 0;
    this.airW = 0;
    this.land = 0;
    this.bank = 0;
    this.thrust = 0;
    this.body.rotation.set(0, 0, 0);
  }

  getFootPosition(side, target) {
    return this.bones[side === 'left' ? 'ankleL' : 'ankleR'].getWorldPosition(target);
  }

  legPose(s, c, mw, sw) {
    const stride = lerp(0.55, 0.85, sw) * mw;
    const kneeAmp = lerp(1.0, 1.45, sw) * mw;
    const thigh = -s * stride - 0.1 * mw;
    const knee = 0.08 + Math.max(0, c) ** 1.5 * kneeAmp + 0.12 * mw;
    return { thigh, knee, ankle: -(thigh + knee) * 0.7 };
  }

  /**
   * Procedural animation. `state` carries the controller's physics: planar
   * speed, sprint flag, grounded flag, vertical velocity, turn rate,
   * acceleration, facing and an optional look target.
   * Returns 'left' / 'right' on the frame a foot strikes the ground.
   */
  update(dt, state) {
    const b = this.bones;
    this.time += dt;
    const t = this.time;

    this.moveW += (clamp(state.speed / 3, 0, 1) - this.moveW) * dampFactor(10, dt);
    this.sprintW += ((state.sprinting && state.speed > 6 ? 1 : 0) - this.sprintW) * dampFactor(6, dt);
    this.airW += ((state.onGround ? 0 : 1) - this.airW) * dampFactor(state.onGround ? 20 : 9, dt);
    this.land = Math.max(0, this.land - dt * 3.2);

    const mw = this.moveW;
    const sw = this.sprintW;
    const aw = this.airW;
    const land = this.land * this.land;
    const idle = (1 - mw) * (1 - aw);

    // Gait phase advances with speed so feet don't skate.
    const cadence = 0.95 + state.speed * 0.085;
    this.phase += dt * cadence * Math.PI * 2 * (state.onGround ? 1 : 0.25);

    let footstep = null;
    const stepIndex = Math.floor((this.phase - Math.PI / 2) / Math.PI);

    if (stepIndex !== this.lastStep) {
      if (state.onGround && mw > 0.45) {
        footstep = Math.abs(stepIndex) % 2 === 0 ? 'left' : 'right';
      }

      this.lastStep = stepIndex;
    }

    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const rising = smoothstep(-3, 3, state.verticalVelocity);
    const breathe = Math.sin(t * 1.9);

    // Legs: blend ground gait -> airborne tuck, then add landing squash.
    const groundL = this.legPose(s, c, mw, sw);
    const groundR = this.legPose(-s, -c, mw, sw);
    const airL = { thigh: lerp(-0.35, -1.0, rising), knee: lerp(0.35, 1.45, rising), ankle: 0.2 };
    const airR = { thigh: lerp(0.12, 0.3, rising), knee: lerp(0.25, 0.75, rising), ankle: 0.3 };

    b.hipL.rotation.x = lerp(groundL.thigh, airL.thigh, aw) - 0.55 * land;
    b.kneeL.rotation.x = lerp(groundL.knee, airL.knee, aw) + 0.95 * land;
    b.ankleL.rotation.x = lerp(groundL.ankle, airL.ankle, aw) - 0.4 * land;
    b.hipR.rotation.x = lerp(groundR.thigh, airR.thigh, aw) - 0.55 * land;
    b.kneeR.rotation.x = lerp(groundR.knee, airR.knee, aw) + 0.95 * land;
    b.ankleR.rotation.x = lerp(groundR.ankle, airR.ankle, aw) - 0.4 * land;
    b.hipL.rotation.z = -0.03 - 0.06 * aw;
    b.hipR.rotation.z = 0.03 + 0.06 * aw;

    // Arms swing opposite to legs; they lift outward in the air.
    const armAmp = lerp(0.5, 0.95, sw) * mw;
    const idleSway = Math.sin(t * 1.3) * 0.04 * idle;
    b.shoulderL.rotation.x = lerp(s * armAmp + idleSway, -0.25 - 0.55 * rising, aw);
    b.shoulderR.rotation.x = lerp(-s * armAmp - idleSway, -0.25 - 0.55 * rising, aw);
    b.shoulderL.rotation.z = -lerp(0.1 + 0.06 * mw + 0.02 * breathe * idle, 0.55 + 0.3 * rising, aw) - 0.35 * land;
    b.shoulderR.rotation.z = lerp(0.1 + 0.06 * mw + 0.02 * breathe * idle, 0.55 + 0.3 * rising, aw) + 0.35 * land;

    const elbowBase = 0.22 + 0.55 * mw + 0.45 * sw * mw;
    b.elbowL.rotation.x = -lerp(elbowBase + Math.max(0, -s) * 0.4 * mw, 0.95, aw);
    b.elbowR.rotation.x = -lerp(elbowBase + Math.max(0, s) * 0.4 * mw, 0.95, aw);

    // Hips bob twice per cycle and counter-rotate against the shoulders.
    const bob = (1 - Math.abs(c)) * (0.05 + 0.06 * sw) * mw;
    b.hips.position.y = HIP_HEIGHT - 0.05 * mw + bob - 0.24 * land - 0.06 * aw * rising + breathe * 0.006 * idle;
    b.hips.position.x = Math.sin(t * 0.7) * 0.014 * idle;
    b.hips.rotation.y = s * 0.14 * mw;
    b.hips.rotation.z = c * 0.04 * mw;

    const accelLean = clamp(state.accel * 0.014, -0.12, 0.2);
    b.spine.rotation.y = -s * 0.22 * mw;
    b.spine.rotation.x = 0.04 + 0.1 * mw + 0.14 * sw * mw + accelLean * (1 - aw) + 0.32 * land - 0.12 * aw * rising + breathe * 0.02 * idle;
    b.spine.scale.y = 1 + breathe * 0.01 * idle;

    // Bank into turns.
    const bankTarget = clamp(-state.turnRate * 0.07, -0.32, 0.32) * mw;
    this.bank += (bankTarget - this.bank) * dampFactor(6, dt);
    this.body.rotation.z = this.bank;

    // Head: look at nearby points of interest, otherwise glance around.
    let yawTarget = Math.sin(t * 0.45) * 0.4 * idle;
    let pitchTarget = Math.sin(t * 0.31) * 0.06 * idle;

    if (state.lookTarget) {
      const dx = state.lookTarget.x - state.position.x;
      const dz = state.lookTarget.z - state.position.z;
      const distance = Math.hypot(dx, dz);

      if (distance < 16 && distance > 0.6) {
        yawTarget = clamp(angleDelta(state.facing, Math.atan2(dx, dz)), -1.05, 1.05);
        pitchTarget = -clamp(Math.atan2(state.lookTarget.y - (state.position.y + 1.95), distance), -0.35, 0.5);
      }
    }

    this.lookYaw += (yawTarget - this.lookYaw) * dampFactor(5, dt);
    this.lookPitch += (pitchTarget - this.lookPitch) * dampFactor(5, dt);
    b.neck.rotation.x = -b.spine.rotation.x * 0.7 + this.lookPitch;
    b.neck.rotation.y = this.lookYaw - b.spine.rotation.y * 0.8 - b.hips.rotation.y * 0.5;
    b.neck.rotation.z = -this.bank * 0.5;

    // Blink.
    this.blinkTimer -= dt;

    if (this.blinkTimer <= 0) {
      this.blink = 0.14;
      this.blinkTimer = 2.2 + Math.random() * 3.5;
    }

    this.blink = Math.max(0, this.blink - dt);
    this.eyes.scale.y = this.blink > 0 ? 0.15 : 1;

    // Jet flames while airborne.
    const thrustTarget = aw * (state.verticalVelocity > -1.5 ? 1 : 0.35);
    this.thrust += (thrustTarget - this.thrust) * dampFactor(12, dt);

    for (const flame of this.flames) {
      flame.visible = this.thrust > 0.03;
      flame.scale.set(1, this.thrust * (0.75 + Math.random() * 0.5), 1);
    }

    // Reactor glow: gentle pulse, flashes the milestone colour on unlock.
    this.flash = Math.max(0, this.flash - dt * 0.9);
    const glow = this.materials.glow;
    glow.emissive.copy(CORE_COLOR).lerp(this.flashColor, this.flash);
    glow.emissiveIntensity = 2.2 + Math.sin(t * 2.6) * 0.35 + this.flash * 3 + sw * mw * 0.8;

    return footstep;
  }
}
