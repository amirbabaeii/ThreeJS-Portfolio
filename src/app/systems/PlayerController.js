import * as THREE from 'three';
import { PLAYER_DEFAULTS, WORLD_LAYOUT } from '../config.js';
import { clamp, damp } from '../utils/math.js';

export class PlayerController {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.visual = new THREE.Group();
    this.body = null;
    this.head = null;
    this.leftArm = null;
    this.rightArm = null;
    this.leftLeg = null;
    this.rightLeg = null;
    this.shadow = null;
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
    this.onGround = true;
  }

  build() {
    const materialBody = new THREE.MeshStandardMaterial({
      color: 0xf5fbff,
      roughness: 0.22,
      metalness: 0.08,
      emissive: 0x183246,
      emissiveIntensity: 0.18,
    });
    const materialAccent = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      roughness: 0.18,
      metalness: 0.35,
      emissive: 0x7dd3fc,
      emissiveIntensity: 0.42,
    });
    const materialDark = new THREE.MeshStandardMaterial({
      color: 0x0d1724,
      roughness: 0.6,
      metalness: 0.2,
    });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 1.1, 5, 10), materialBody);
    torso.castShadow = true;
    torso.position.y = 1.45;
    this.body = torso;
    this.visual.add(torso);

    const chestCore = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.08), materialAccent);
    chestCore.position.set(0, 1.55, 0.42);
    chestCore.castShadow = true;
    this.visual.add(chestCore);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), materialBody);
    head.position.y = 2.4;
    head.castShadow = true;
    this.head = head;
    this.visual.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.28), materialAccent);
    visor.position.set(0, 2.4, 0.14);
    visor.castShadow = true;
    this.visual.add(visor);

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.75, 0.22), materialDark);
    backpack.position.set(0, 1.5, -0.34);
    backpack.castShadow = true;
    this.visual.add(backpack);

    const armGeo = new THREE.CapsuleGeometry(0.12, 0.72, 5, 8);
    const legGeo = new THREE.CapsuleGeometry(0.14, 0.92, 5, 8);

    this.leftArm = new THREE.Group();
    this.rightArm = new THREE.Group();
    this.leftLeg = new THREE.Group();
    this.rightLeg = new THREE.Group();

    const leftArmMesh = new THREE.Mesh(armGeo, materialBody);
    leftArmMesh.position.y = -0.4;
    leftArmMesh.castShadow = true;
    this.leftArm.add(leftArmMesh);
    this.leftArm.position.set(-0.52, 1.92, 0);

    const rightArmMesh = new THREE.Mesh(armGeo, materialBody);
    rightArmMesh.position.y = -0.4;
    rightArmMesh.castShadow = true;
    this.rightArm.add(rightArmMesh);
    this.rightArm.position.set(0.52, 1.92, 0);

    const leftLegMesh = new THREE.Mesh(legGeo, materialDark);
    leftLegMesh.position.y = -0.5;
    leftLegMesh.castShadow = true;
    this.leftLeg.add(leftLegMesh);
    this.leftLeg.position.set(-0.2, 0.95, 0);

    const rightLegMesh = new THREE.Mesh(legGeo, materialDark);
    rightLegMesh.position.y = -0.5;
    rightLegMesh.castShadow = true;
    this.rightLeg.add(rightLegMesh);
    this.rightLeg.position.set(0.2, 0.95, 0);

    this.visual.add(this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.04, 12, 40), materialAccent);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    ring.castShadow = true;
    this.visual.add(ring);

    this.group.add(this.visual);
    this.group.position.copy(this.position);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    this.shadow = shadow;
    this.group.add(shadow);

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
    this.onGround = true;
    this.group.position.copy(this.position);
    this.visual.rotation.y = this.facingAngle;
    this.visual.position.y = 0;
    this.leftArm.rotation.x = 0;
    this.rightArm.rotation.x = 0;
    this.leftLeg.rotation.x = 0;
    this.rightLeg.rotation.x = 0;
    this.head.rotation.y = 0;
    this.shadow.material.opacity = 0.16;
    this.shadow.scale.setScalar(1);
  }

  getPlanarSpeed() {
    return Math.hypot(this.planarVelocity.x, this.planarVelocity.z);
  }

  update({ dt, input, cameraYaw, elapsedTime, maxPlayerZ, onJump, onLand }) {
    const wasOnGround = this.onGround;
    const preGroundVelocityY = this.velocity.y;

    this.forwardDirection.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    // Camera-relative strafe should follow the camera's local +X axis.
    this.rightDirection.set(-this.forwardDirection.z, 0, this.forwardDirection.x);

    this.desiredVelocity.set(0, 0, 0);
    this.desiredVelocity.addScaledVector(this.forwardDirection, input.forward);
    this.desiredVelocity.addScaledVector(this.rightDirection, input.strafe);

    if (this.desiredVelocity.lengthSq() > 0.0001) {
      this.desiredVelocity.normalize();
    }

    const speed = input.sprint ? PLAYER_DEFAULTS.maxSprintSpeed : PLAYER_DEFAULTS.maxWalkSpeed;
    const acceleration = input.sprint ? PLAYER_DEFAULTS.sprintAcceleration : PLAYER_DEFAULTS.acceleration;

    this.desiredVelocity.multiplyScalar(speed);
    this.planarVelocity.x = damp(this.planarVelocity.x, this.desiredVelocity.x, acceleration, dt);
    this.planarVelocity.z = damp(this.planarVelocity.z, this.desiredVelocity.z, acceleration, dt);

    if (Math.abs(input.forward) < 0.01 && Math.abs(input.strafe) < 0.01) {
      this.planarVelocity.x = damp(this.planarVelocity.x, 0, PLAYER_DEFAULTS.drag, dt);
      this.planarVelocity.z = damp(this.planarVelocity.z, 0, PLAYER_DEFAULTS.drag, dt);
    }

    if (input.consumeJump() && this.onGround) {
      this.velocity.y = PLAYER_DEFAULTS.jumpSpeed;
      this.onGround = false;
      onJump?.();
    }

    this.velocity.y -= PLAYER_DEFAULTS.gravity * dt;
    this.position.x += this.planarVelocity.x * dt;
    this.position.z += this.planarVelocity.z * dt;
    this.position.y += this.velocity.y * dt;

    this.position.x = clamp(this.position.x, -WORLD_LAYOUT.roadHalfWidth, WORLD_LAYOUT.roadHalfWidth);
    this.position.z = clamp(this.position.z, WORLD_LAYOUT.minPlayerZ, maxPlayerZ + WORLD_LAYOUT.maxPlayerZPadding);

    const groundHeight = PLAYER_DEFAULTS.startPosition.y + Math.sin(this.position.z * 0.08) * 0.04;

    if (this.position.y <= groundHeight) {
      this.position.y = groundHeight;
      this.velocity.y = 0;
      this.onGround = true;

      if (!wasOnGround && preGroundVelocityY < -2.4) {
        onLand?.(Math.min(1.35, Math.abs(preGroundVelocityY) / 8));
      }
    }

    const movementMagnitude = this.getPlanarSpeed();

    if (movementMagnitude > 0.12) {
      const desiredAngle = Math.atan2(this.planarVelocity.x, this.planarVelocity.z);
      const angleDelta =
        THREE.MathUtils.euclideanModulo(desiredAngle - this.facingAngle + Math.PI, Math.PI * 2) - Math.PI;
      this.facingAngle += angleDelta * Math.min(1, dt * 12);
    }

    this.group.position.copy(this.position);
    this.visual.rotation.y = this.facingAngle;

    const runCycle = elapsedTime * (input.sprint ? 13 : 8.5);
    const swing =
      movementMagnitude > 0.18 ? Math.sin(runCycle) * Math.min(0.8, movementMagnitude * 0.08) : 0;
    const bounce =
      movementMagnitude > 0.18
        ? Math.abs(Math.sin(runCycle * 1.2)) * (input.sprint ? 0.12 : 0.06)
        : 0;

    this.visual.position.y = bounce;
    this.leftArm.rotation.x = swing;
    this.rightArm.rotation.x = -swing;
    this.leftLeg.rotation.x = -swing;
    this.rightLeg.rotation.x = swing;
    this.head.rotation.y = Math.sin(elapsedTime * 1.8) * 0.03;
    this.shadow.material.opacity = 0.16 + movementMagnitude * 0.006;
    this.shadow.scale.setScalar(1 - bounce * 0.5);
  }
}
