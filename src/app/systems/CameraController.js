import * as THREE from 'three';
import { CAMERA_DEFAULTS } from '../config.js';
import { clamp, dampVec } from '../utils/math.js';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.yaw = CAMERA_DEFAULTS.yaw;
    this.pitch = CAMERA_DEFAULTS.pitch;
    this.distance = CAMERA_DEFAULTS.distance;
    this.target = new THREE.Vector3();
    this.desiredTarget = new THREE.Vector3();
    this.position = new THREE.Vector3(0, 5, 8);
    this.desiredPosition = new THREE.Vector3();
    this.offset = new THREE.Vector3();
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
    this.yaw -= dx * CAMERA_DEFAULTS.orbitSensitivity.x;
    this.pitch = clamp(
      this.pitch - dy * CAMERA_DEFAULTS.orbitSensitivity.y,
      CAMERA_DEFAULTS.minPitch,
      CAMERA_DEFAULTS.maxPitch,
    );
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
    this.yaw = CAMERA_DEFAULTS.yaw;
    this.pitch = CAMERA_DEFAULTS.pitch;
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

  update(playerPosition, dt) {
    this.desiredTarget.set(
      playerPosition.x,
      playerPosition.y + CAMERA_DEFAULTS.targetHeight,
      playerPosition.z,
    );
    dampVec(this.target, this.desiredTarget, 10, dt);
    dampVec(this.position, this.computeDesiredPosition(this.target), 8, dt);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
  }
}
