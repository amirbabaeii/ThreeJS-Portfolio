import * as THREE from 'three';
import { CAMERA_DEFAULTS, PLAYER_DEFAULTS } from '../config.js';
import { clamp, damp, dampFactor, dampVec } from '../utils/math.js';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.baseFov = camera.fov;
    this.yaw = CAMERA_DEFAULTS.yaw;
    this.pitch = CAMERA_DEFAULTS.pitch;
    this.distance = CAMERA_DEFAULTS.distance;
    this.targetDistance = CAMERA_DEFAULTS.distance;
    this.target = new THREE.Vector3();
    this.desiredTarget = new THREE.Vector3();
    this.position = new THREE.Vector3(0, 5, 8);
    this.desiredPosition = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.lookAhead = new THREE.Vector3();
    this.desiredLookAhead = new THREE.Vector3();
    this.framing = 0;
    this.shake = 0;
    this.shakeOffset = new THREE.Vector3();
    this.idleOrbit = false;
    this.returning = false;
    this.reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  getDefaultPose(playerPosition) {
    const target = new THREE.Vector3(
      playerPosition.x,
      playerPosition.y + CAMERA_DEFAULTS.targetHeight,
      playerPosition.z,
    );
    const position = this.computeDesiredPosition(target, {
      yaw: CAMERA_DEFAULTS.yaw,
      pitch: CAMERA_DEFAULTS.pitch,
      distance: CAMERA_DEFAULTS.distance,
    }).clone();

    return { position, target };
  }

  applyOrbit(dx, dy) {
    this.returning = false;
    this.yaw -= dx * CAMERA_DEFAULTS.orbitSensitivity.x;
    this.pitch = clamp(
      this.pitch - dy * CAMERA_DEFAULTS.orbitSensitivity.y,
      CAMERA_DEFAULTS.minPitch,
      CAMERA_DEFAULTS.maxPitch,
    );
  }

  applyZoom(delta) {
    this.targetDistance = clamp(
      this.targetDistance * (1 + delta * 0.0011),
      CAMERA_DEFAULTS.minDistance,
      CAMERA_DEFAULTS.maxDistance,
    );
  }

  addShake(amount) {
    if (this.reducedMotion) {
      return;
    }

    this.shake = Math.min(1, this.shake + amount);
  }

  /** Slow showcase orbit used behind the start screen. */
  setIdleOrbit(enabled) {
    this.idleOrbit = enabled;

    if (!enabled) {
      // Ease back to the gameplay framing, taking the short way round.
      this.yaw = CAMERA_DEFAULTS.yaw + THREE.MathUtils.euclideanModulo(this.yaw - CAMERA_DEFAULTS.yaw + Math.PI, Math.PI * 2) - Math.PI;
      this.returning = true;
    }
  }

  computeDesiredPosition(target, override = null) {
    const yaw = override?.yaw ?? this.yaw;
    const distance = override?.distance ?? this.distance;
    const pitch = clamp(
      override?.pitch ?? this.pitch,
      CAMERA_DEFAULTS.minPitch,
      CAMERA_DEFAULTS.maxPitch,
    );

    this.offset.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(-pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(distance);

    return this.desiredPosition.copy(target).add(this.offset);
  }

  reset(playerPosition) {
    this.returning = false;
    this.yaw = CAMERA_DEFAULTS.yaw;
    this.pitch = CAMERA_DEFAULTS.pitch;
    this.distance = this.targetDistance;
    this.lookAhead.set(0, 0, 0);
    this.framing = 0;
    this.desiredTarget.set(
      playerPosition.x,
      playerPosition.y + CAMERA_DEFAULTS.targetHeight,
      playerPosition.z,
    );
    this.target.copy(this.desiredTarget);
    this.position.copy(this.computeDesiredPosition(this.target));
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
  }

  update(playerPosition, dt, { velocity = null, sprinting = false, getGroundHeight = null, wideFraming = false } = {}) {
    if (this.idleOrbit) {
      this.yaw += dt * 0.11;
      this.pitch = damp(this.pitch, -0.16, 2, dt);
      this.distance = damp(this.distance, 9.6, 2, dt);
    } else {
      if (this.returning) {
        this.yaw = damp(this.yaw, CAMERA_DEFAULTS.yaw, 2.6, dt);
        this.pitch = damp(this.pitch, CAMERA_DEFAULTS.pitch, 2.6, dt);

        if (Math.abs(this.yaw - CAMERA_DEFAULTS.yaw) < 0.002) {
          this.returning = false;
        }
      }

      this.distance = damp(this.distance, this.targetDistance, 6, dt);
    }

    // Lead the camera slightly in the direction of travel.
    if (velocity) {
      this.desiredLookAhead.set(velocity.x, 0, velocity.z).multiplyScalar(CAMERA_DEFAULTS.lookAhead / PLAYER_DEFAULTS.maxSprintSpeed);
    } else {
      this.desiredLookAhead.set(0, 0, 0);
    }

    dampVec(this.lookAhead, this.desiredLookAhead, 2.5, dt);

    // On wide screens the start card sits on the left, so frame the hero
    // on the right third by shifting the look target to the camera's left.
    this.framing = damp(this.framing, this.idleOrbit && wideFraming ? 2.4 : 0, 2.5, dt);

    this.desiredTarget.set(
      playerPosition.x + this.lookAhead.x - Math.cos(this.yaw) * this.framing,
      playerPosition.y + CAMERA_DEFAULTS.targetHeight,
      playerPosition.z + this.lookAhead.z + Math.sin(this.yaw) * this.framing,
    );

    const followXZ = dampFactor(10, dt);
    this.target.x += (this.desiredTarget.x - this.target.x) * followXZ;
    this.target.z += (this.desiredTarget.z - this.target.z) * followXZ;
    // Follow height more lazily so jumps don't jolt the view.
    this.target.y += (this.desiredTarget.y - this.target.y) * dampFactor(5, dt);

    const desired = this.computeDesiredPosition(this.target);

    if (getGroundHeight) {
      const floor = getGroundHeight(desired.x, desired.z) + 0.6;

      if (desired.y < floor) {
        desired.y = floor;
      }
    }

    dampVec(this.position, desired, 9, dt);
    this.camera.position.copy(this.position);

    if (this.shake > 0.001) {
      const amount = this.shake * this.shake * 0.22;
      this.shakeOffset.set(
        (Math.random() - 0.5) * amount,
        (Math.random() - 0.5) * amount,
        (Math.random() - 0.5) * amount,
      );
      this.camera.position.add(this.shakeOffset);
      this.shake = Math.max(0, this.shake - dt * 2.6);
    }

    this.camera.lookAt(this.target);

    const speed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;
    const boost = this.reducedMotion ? 0 : CAMERA_DEFAULTS.sprintFovBoost;
    const fovTarget = this.baseFov + (sprinting && speed > 6 ? boost : 0);

    if (Math.abs(this.camera.fov - fovTarget) > 0.01) {
      this.camera.fov = damp(this.camera.fov, fovTarget, 4, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
