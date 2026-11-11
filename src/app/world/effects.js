import * as THREE from 'three';
import { mulberry32 } from '../utils/noise.js';
import { SOFT_POINT_FRAGMENT, sharedUniforms } from './shaderLib.js';
import { TRACK } from './terrain.js';

/** Drifting fireflies / data motes. Fully animated on the GPU. */
export function createMotes({ count = 900, seed = 9 }) {
  const random = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const palette = [new THREE.Color(0x8be9ff), new THREE.Color(0x5eead4), new THREE.Color(0xc4b5fd), new THREE.Color(0xfde68a)];

  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * 70;
    positions[index * 3 + 1] = 0.3 + random() * 9;
    positions[index * 3 + 2] = TRACK.startZ + random() * (TRACK.endZ - TRACK.startZ + 10);
    seeds[index] = random();
    const color = palette[random() < 0.7 ? Math.floor(random() * 2) : 2 + Math.floor(random() * 2)];
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uPixelRatio: sharedUniforms.uPixelRatio,
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = uTime * (0.25 + aSeed * 0.35) + aSeed * 50.0;
        p.x += sin(t * 0.9) * 1.4 + sin(t * 2.3) * 0.3;
        p.z += cos(t * 0.7) * 1.4;
        p.y = 0.3 + mod(p.y + uTime * (0.08 + aSeed * 0.18), 9.0) + sin(t * 1.7) * 0.25;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float blink = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 20.0);
        float distanceFade = 1.0 - smoothstep(45.0, 80.0, -mvPosition.z);
        float heightFade = smoothstep(0.3, 1.0, p.y) * (1.0 - smoothstep(7.5, 9.2, p.y));
        vAlpha = (0.35 + 0.65 * blink * blink) * distanceFade * heightFade;
        vColor = aColor;
        gl_PointSize = (2.0 + aSeed * 3.5) * uPixelRatio * (24.0 / max(-mvPosition.z, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      ${SOFT_POINT_FRAGMENT}
      void main() {
        gl_FragColor = vec4(vColor * 2.2 * softPoint() * vAlpha, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'motes';
  points.userData.setDensity = (density) => {
    geometry.setDrawRange(0, Math.floor(count * density));
  };
  return points;
}

/**
 * A ring-buffer particle system: emit() writes a few particles into the
 * buffer and the vertex shader animates them from their spawn time, so the
 * CPU never touches live particles.
 */
class BurstParticles {
  constructor({ capacity, blending = THREE.AdditiveBlending, gravity = -2, drag = 1.6, size = 6 }) {
    this.capacity = capacity;
    this.cursor = 0;
    this.origins = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.meta = new Float32Array(capacity * 4).fill(-1000); // spawn, life, size, kind
    this.colors = new Float32Array(capacity * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.origins, 3));
    this.geometry.setAttribute('aVelocity', new THREE.BufferAttribute(this.velocities, 3));
    this.geometry.setAttribute('aMeta', new THREE.BufferAttribute(this.meta, 4));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));

    const additive = blending === THREE.AdditiveBlending;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uTime,
        uPixelRatio: sharedUniforms.uPixelRatio,
        uGravity: { value: gravity },
        uDrag: { value: drag },
        uSize: { value: size },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aVelocity;
        attribute vec4 aMeta;
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uGravity;
        uniform float uDrag;
        uniform float uSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float age = uTime - aMeta.x;
          float life = aMeta.y;
          float alive = step(0.0, age) * step(age, life);
          float k = (1.0 - exp(-uDrag * age)) / uDrag;
          vec3 p = position + aVelocity * k + vec3(0.0, 0.5 * uGravity * age * age, 0.0);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float t = clamp(age / life, 0.0, 1.0);
          vAlpha = alive * (1.0 - t) * smoothstep(0.0, 0.08, t);
          vColor = aColor;
          gl_PointSize = alive * aMeta.z * uSize * uPixelRatio * (1.0 + t * aMeta.w) * (20.0 / max(-mvPosition.z, 1.0));
          if (alive < 0.5) {
            // Park dead particles outside the clip volume (size 0 is not
            // guaranteed to cull on every driver).
            gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
          }
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        ${SOFT_POINT_FRAGMENT}
        void main() {
          float a = softPoint() * vAlpha;
          ${additive ? 'gl_FragColor = vec4(vColor * a, 1.0);' : 'gl_FragColor = vec4(vColor, a * 0.55);'}
        }
      `,
      transparent: true,
      depthWrite: false,
      blending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  emit({ origin, velocity, life, size = 1, grow = 0, color }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.origins.set([origin.x, origin.y, origin.z], i * 3);
    this.velocities.set([velocity.x, velocity.y, velocity.z], i * 3);
    this.meta.set([sharedUniforms.uTime.value, life, size, grow], i * 4);
    this.colors.set([color.r, color.g, color.b], i * 3);
  }

  commit() {
    for (const name of ['position', 'aVelocity', 'aMeta', 'aColor']) {
      this.geometry.attributes[name].needsUpdate = true;
    }
  }
}

/** Unlock celebration: a particle fountain plus an expanding ground ring. */
export class UnlockEffect {
  constructor(scene) {
    this.random = mulberry32(31);
    this.sparks = new BurstParticles({ capacity: 320, gravity: -3.2, drag: 1.1, size: 7 });
    scene.add(this.sparks.points);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 96),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
    this.ringAge = Infinity;
    this.tmpOrigin = new THREE.Vector3();
    this.tmpVelocity = new THREE.Vector3();
    this.tmpColor = new THREE.Color();
    this.white = new THREE.Color(0xffffff);
  }

  play(position, accent) {
    const base = new THREE.Color(accent);

    for (let index = 0; index < 160; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const spread = 1.5 + this.random() * 5.5;
      const up = 4 + this.random() * 11;
      this.tmpOrigin.set(position.x + Math.cos(angle) * 0.6, 3.5 + this.random() * 1.5, position.z + Math.sin(angle) * 0.6);
      this.tmpVelocity.set(Math.cos(angle) * spread, up, Math.sin(angle) * spread);
      this.tmpColor.copy(base).lerp(this.white, this.random() * 0.5).multiplyScalar(1 + this.random() * 1.2);
      this.sparks.emit({
        origin: this.tmpOrigin,
        velocity: this.tmpVelocity,
        life: 1.2 + this.random() * 1.4,
        size: 0.5 + this.random() * 0.9,
        color: this.tmpColor,
      });
    }

    this.sparks.commit();
    this.ring.position.set(position.x, 0.08, position.z);
    this.ring.material.color.copy(base).multiplyScalar(1.6);
    this.ring.visible = true;
    this.ringAge = 0;
  }

  update(dt) {
    if (!this.ring.visible) {
      return;
    }

    this.ringAge += dt;
    const t = this.ringAge / 1.4;

    if (t >= 1) {
      this.ring.visible = false;
      return;
    }

    const eased = 1 - (1 - t) ** 3;
    this.ring.scale.setScalar(1 + eased * 16);
    this.ring.material.opacity = (1 - t) * (1 - t);
  }
}

/** Footstep / landing dust kicked up from the ground. */
export class DustEffect {
  constructor(scene) {
    this.random = mulberry32(57);
    this.dust = new BurstParticles({
      capacity: 160,
      blending: THREE.NormalBlending,
      gravity: 0.6,
      drag: 3.2,
      size: 9,
    });
    scene.add(this.dust.points);
    this.color = new THREE.Color(0x6f86a8);
    this.glow = new BurstParticles({ capacity: 96, gravity: 0.4, drag: 2.5, size: 4 });
    scene.add(this.glow.points);
    this.glowColor = new THREE.Color(0x5eead4).multiplyScalar(2.2);
    this.tmpOrigin = new THREE.Vector3();
    this.tmpVelocity = new THREE.Vector3();
  }

  footstep(position, strength = 1) {
    const count = 3 + Math.round(strength * 2);

    for (let index = 0; index < count; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const speed = (0.5 + this.random() * 1.1) * strength;
      this.tmpOrigin.set(position.x, position.y + 0.06, position.z);
      this.tmpVelocity.set(Math.cos(angle) * speed, 0.4 + this.random() * 0.6, Math.sin(angle) * speed);
      this.dust.emit({ origin: this.tmpOrigin, velocity: this.tmpVelocity, life: 0.6 + this.random() * 0.4, size: 0.6 + this.random() * 0.5, grow: 1.4, color: this.color });
    }

    this.tmpVelocity.set(0, 0.6, 0);
    this.glow.emit({ origin: this.tmpOrigin, velocity: this.tmpVelocity, life: 0.45, size: 0.8, grow: 0.5, color: this.glowColor });
    this.dust.commit();
    this.glow.commit();
  }

  landing(position, intensity = 1) {
    const count = 10 + Math.round(intensity * 10);

    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + this.random() * 0.3;
      const speed = (2.2 + this.random() * 1.6) * intensity;
      this.tmpOrigin.set(position.x, position.y + 0.08, position.z);
      this.tmpVelocity.set(Math.cos(angle) * speed, 0.3 + this.random() * 0.5, Math.sin(angle) * speed);
      this.dust.emit({ origin: this.tmpOrigin, velocity: this.tmpVelocity, life: 0.7 + this.random() * 0.4, size: 0.8 + this.random() * 0.6, grow: 1.8, color: this.color });

      if (index % 2 === 0) {
        this.glow.emit({ origin: this.tmpOrigin, velocity: this.tmpVelocity, life: 0.5, size: 0.6, grow: 0.3, color: this.glowColor });
      }
    }

    this.dust.commit();
    this.glow.commit();
  }
}
