import * as THREE from 'three';
import { PLAYER_DEFAULTS, WORLD_LAYOUT } from '../config.js';
import { angleDelta, clamp, damp, dampFactor } from '../utils/math.js';
import { CharacterRig } from './CharacterRig.js';

function createBlobShadowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.4)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const NO_INPUT = {
  forward: 0,
  strafe: 0,
  sprint: false,
  consumeJump: () => false,
};

export class PlayerController {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.rig = null;
    this.blobShadow = null;
    this.velocity = new THREE.Vector3();
    this.planarVelocity = new THREE.Vector3();
    this.desiredVelocity = new THREE.Vector3();
    this.position = new THREE.Vector3(
      PLAYER_DEFAULTS.startPosition.x,
      PLAYER_DEFAULTS.startPosition.y,
      PLAYER_DEFAULTS.startPosition.z,
    );
    this.forwardDirection = new THREE.Vector3();
    this.rightDirection = new THREE.Vector3();
    this.facingAngle = PLAYER_DEFAULTS.facingAngle;
    this.turnRate = 0;
    this.accel = 0;
    this.lastSpeed = 0;
    this.onGround = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.groundHeight = 0;
    this.sprinting = false;
    this.footPosition = new THREE.Vector3();
    this.rigState = {
      speed: 0,
      sprinting: false,
      onGround: true,
      verticalVelocity: 0,
      turnRate: 0,
      accel: 0,
      facing: 0,
      position: this.position,
      lookTarget: null,
    };
  }

  build() {
    this.rig = new CharacterRig();
    this.group.add(this.rig.root);

    this.blobShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshBasicMaterial({
        map: createBlobShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.6,
      }),
    );
    this.blobShadow.rotation.x = -Math.PI / 2;
    this.blobShadow.renderOrder = 2;
    this.group.add(this.blobShadow);

    this.group.position.copy(this.position);
    this.rig.root.rotation.y = this.facingAngle;
    this.scene.add(this.group);
  }

  reset() {
    this.position.set(
      PLAYER_DEFAULTS.startPosition.x,
      PLAYER_DEFAULTS.startPosition.y,
      PLAYER_DEFAULTS.startPosition.z,
    );
    this.velocity.set(0, 0, 0);
    this.planarVelocity.set(0, 0, 0);
    this.desiredVelocity.set(0, 0, 0);
    this.facingAngle = PLAYER_DEFAULTS.facingAngle;
    this.turnRate = 0;
    this.accel = 0;
    this.lastSpeed = 0;
    this.onGround = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.group.position.copy(this.position);
    this.rig.root.rotation.y = this.facingAngle;
    this.rig.reset();
  }

  getPlanarSpeed() {
    return Math.hypot(this.planarVelocity.x, this.planarVelocity.z);
  }

  resolveCollisions(colliders) {
    const radius = PLAYER_DEFAULTS.radius;

    for (const collider of colliders) {
      const dz = this.position.z - collider.z;

      if (Math.abs(dz) > collider.r + radius) {
        continue;
      }

      const dx = this.position.x - collider.x;
      const minDistance = collider.r + radius;
      const distanceSquared = dx * dx + dz * dz;

      if (distanceSquared >= minDistance * minDistance || distanceSquared < 1e-8) {
        continue;
      }

      const distance = Math.sqrt(distanceSquared);
      const nx = dx / distance;
      const nz = dz / distance;
      this.position.x = collider.x + nx * minDistance;
      this.position.z = collider.z + nz * minDistance;

      // Remove the velocity component pushing into the obstacle so the
      // player slides around it instead of sticking.
      const inward = this.planarVelocity.x * nx + this.planarVelocity.z * nz;

      if (inward < 0) {
        this.planarVelocity.x -= inward * nx;
        this.planarVelocity.z -= inward * nz;
      }
    }
  }

  /**
   * @param {object} options
   * @param {boolean} options.frozen  idle in place (start screen / cinematics)
   */
  update({
    dt,
    input,
    cameraYaw,
    maxPlayerZ,
    world,
    lookTarget = null,
    frozen = false,
    onJump,
    onLand,
    onFootstep,
  }) {
    const controls = frozen ? NO_INPUT : input;
    const wasOnGround = this.onGround;
    const preVelocityY = this.velocity.y;

    this.forwardDirection.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    this.rightDirection.set(-this.forwardDirection.z, 0, this.forwardDirection.x);

    this.desiredVelocity.set(0, 0, 0);
    this.desiredVelocity.addScaledVector(this.forwardDirection, controls.forward);
    this.desiredVelocity.addScaledVector(this.rightDirection, controls.strafe);

    const inputAmount = Math.min(1, this.desiredVelocity.length());

    if (inputAmount > 0.0001) {
      this.desiredVelocity.normalize().multiplyScalar(inputAmount);
    }

    this.sprinting = Boolean(controls.sprint) && inputAmount > 0.1;
    const speed = this.sprinting ? PLAYER_DEFAULTS.maxSprintSpeed : PLAYER_DEFAULTS.maxWalkSpeed;
    const airControl = this.onGround ? 1 : 0.45;
    const acceleration = (inputAmount > 0.01
      ? this.sprinting ? PLAYER_DEFAULTS.sprintAcceleration : PLAYER_DEFAULTS.acceleration
      : PLAYER_DEFAULTS.drag) * airControl;

    this.desiredVelocity.multiplyScalar(speed);
    this.planarVelocity.x = damp(this.planarVelocity.x, this.desiredVelocity.x, acceleration, dt);
    this.planarVelocity.z = damp(this.planarVelocity.z, this.desiredVelocity.z, acceleration, dt);

    // Jump with coyote time and input buffering for forgiving timing.
    this.coyote = this.onGround ? PLAYER_DEFAULTS.coyoteTime : Math.max(0, this.coyote - dt);
    this.jumpBuffer = controls.consumeJump() ? 0.15 : Math.max(0, this.jumpBuffer - dt);

    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = PLAYER_DEFAULTS.jumpSpeed;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      onJump?.();
    }

    const gravityScale = this.velocity.y < 0 ? 1.35 : 1;
    this.velocity.y -= PLAYER_DEFAULTS.gravity * gravityScale * dt;

    this.position.x += this.planarVelocity.x * dt;
    this.position.z += this.planarVelocity.z * dt;
    this.position.y += this.velocity.y * dt;

    this.resolveCollisions(world.colliders);
    this.position.x = clamp(this.position.x, -WORLD_LAYOUT.playHalfWidth, WORLD_LAYOUT.playHalfWidth);
    this.position.z = clamp(this.position.z, WORLD_LAYOUT.minPlayerZ, maxPlayerZ + WORLD_LAYOUT.maxPlayerZPadding);

    const ground = world.getGroundHeight(this.position.x, this.position.z);
    this.groundHeight = ground;
    const snap = wasOnGround ? 0.4 : 0;

    if (this.velocity.y <= 0 && this.position.y <= ground + snap) {
      this.position.y = ground;
      this.velocity.y = 0;
      this.onGround = true;

      if (!wasOnGround && preVelocityY < -3) {
        const intensity = Math.min(1.35, Math.abs(preVelocityY) / 10);
        this.rig.onLand(intensity);
        onLand?.(intensity, this.position);
      }
    } else if (this.position.y > ground + snap) {
      this.onGround = false;
    }

    // Turn toward the movement direction; track turn rate for banking.
    const planarSpeed = this.getPlanarSpeed();
    let turn = 0;

    if (planarSpeed > 0.15) {
      const desiredAngle = Math.atan2(this.planarVelocity.x, this.planarVelocity.z);
      turn = angleDelta(this.facingAngle, desiredAngle) * Math.min(1, dt * 12);
      this.facingAngle += turn;
    }

    this.turnRate = damp(this.turnRate, dt > 0 ? turn / dt : 0, 10, dt);
    const accel = dt > 0 ? (planarSpeed - this.lastSpeed) / dt : 0;
    this.accel = damp(this.accel, accel, 8, dt);
    this.lastSpeed = planarSpeed;

    this.group.position.copy(this.position);
    this.rig.root.rotation.y = this.facingAngle;

    const state = this.rigState;
    state.speed = planarSpeed;
    state.sprinting = this.sprinting;
    state.onGround = this.onGround;
    state.verticalVelocity = this.velocity.y;
    state.turnRate = this.turnRate;
    state.accel = this.accel;
    state.facing = this.facingAngle;
    state.lookTarget = lookTarget;

    const footstep = this.rig.update(dt, state);

    if (footstep) {
      this.rig.getFootPosition(footstep, this.footPosition);
      this.footPosition.y = ground;
      onFootstep?.(this.footPosition, this.sprinting ? 1.2 : 0.8);
    }

    // Contact shadow stays on the ground and fades as the player rises.
    const height = Math.max(0, this.position.y - ground);
    const fade = clamp(1 - height / 3.5, 0, 1);
    this.blobShadow.position.y = ground - this.position.y + 0.03;
    this.blobShadow.scale.setScalar(0.65 + 0.35 * fade);
    this.blobShadow.material.opacity = 0.55 * fade;
  }

  /** Smoothly reorients the idle character (used by the start screen). */
  faceTowards(angle, dt) {
    this.facingAngle += angleDelta(this.facingAngle, angle) * dampFactor(3, dt);
  }
}
