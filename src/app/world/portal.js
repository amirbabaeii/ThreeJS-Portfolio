import * as THREE from 'three';

import { damp, easeOutBack } from '../utils/math.js';
import { mulberry32 } from '../utils/noise.js';
import { mergeParts, placed } from './props.js';
import { NOISE_GLSL, SOFT_POINT_FRAGMENT, sharedUniforms } from './shaderLib.js';

const RING_Y = 4.1;
const RING_RADIUS = 3.4;

function createVortexMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uActive: { value: 0 },
      uColorA: { value: new THREE.Color(0xa855f7) },
      uColorB: { value: new THREE.Color(0x22d3ee) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uActive;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        vec2 c = (vUv - 0.5) * 2.0;
        float r = length(c);
        float a = atan(c.y, c.x);
        float swirl = a + r * 5.0 - uTime * (0.6 + uActive * 1.4);
        vec2 polar = vec2(cos(swirl), sin(swirl)) * (1.5 + r * 2.0);
        float n = n_fbm2(polar + vec2(r * 3.0 - uTime * 0.7, 0.0));
        float arms = pow(0.5 + 0.5 * sin(swirl * 3.0 + n * 4.0), 3.0);
        float edge = 1.0 - smoothstep(0.86, 1.0, r);
        float core = exp(-r * r * 9.0);
        vec3 color = mix(uColorA, uColorB, n);
        color *= (0.18 + arms * 1.1) * edge * smoothstep(0.0, 0.45, r);
        color += vec3(0.75, 0.85, 1.0) * core * 0.9;
        float strength = mix(0.1, 0.85, uActive);
        gl_FragColor = vec4(color * strength, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function createInfallParticles(count = 260) {
  const random = mulberry32(19);
  const seeds = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    seeds[index * 3] = random();
    seeds[index * 3 + 1] = random();
    seeds[index * 3 + 2] = random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uPixelRatio: sharedUniforms.uPixelRatio,
      uActive: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uActive;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float t = fract(aSeed.x - uTime * (0.12 + aSeed.y * 0.1));
        float radius = mix(0.2, 7.5, t);
        float angle = aSeed.z * 6.2831 + t * 9.0;
        vec3 p = vec3(cos(angle) * radius, sin(angle) * radius, (aSeed.y - 0.5) * 2.0 * t);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vAlpha = uActive * smoothstep(1.0, 0.7, t) * smoothstep(0.0, 0.12, t);
        vColor = mix(vec3(0.75, 0.45, 1.0), vec3(0.4, 0.95, 1.0), aSeed.y);
        gl_PointSize = (2.0 + aSeed.z * 4.0) * uPixelRatio * (22.0 / max(-mvPosition.z, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vColor;
      ${SOFT_POINT_FRAGMENT}
      void main() {
        gl_FragColor = vec4(vColor * 2.5 * softPoint() * vAlpha, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/**
 * The finale gateway. Visible (dormant) from the start so players can see
 * the goal; it powers up once every monument is unlocked.
 */
export class FinishPortal {
  constructor(z) {
    this.active = false;
    this.activation = 0;
    this.activationClock = 0;
    this.group = new THREE.Group();
    this.group.position.set(0, 0, z);

    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x161127, metalness: 0.85, roughness: 0.26 });
    this.ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x241038,
      emissive: 0xc084fc,
      emissiveIntensity: 0.25,
      metalness: 0.6,
      roughness: 0.3,
    });
    this.innerMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b2a33,
      emissive: 0x67e8f9,
      emissiveIntensity: 0.2,
    });

    const pad = new THREE.Mesh(
      mergeParts([
        placed(new THREE.CylinderGeometry(4.8, 5.2, 0.24, 48), { position: [0, 0.12, 0] }),
        placed(new THREE.CylinderGeometry(3.6, 3.8, 0.12, 48), { position: [0, 0.3, 0] }),
      ]),
      darkMetal,
    );
    pad.receiveShadow = true;
    pad.castShadow = true;
    this.group.add(pad);

    const padTrim = new THREE.Mesh(
      mergeParts([
        placed(new THREE.TorusGeometry(4.95, 0.05, 6, 96), { position: [0, 0.25, 0], rotation: [Math.PI / 2, 0, 0] }),
        placed(new THREE.TorusGeometry(3.7, 0.04, 6, 96), { position: [0, 0.37, 0], rotation: [Math.PI / 2, 0, 0] }),
      ]),
      this.ringMaterial,
    );
    this.group.add(padTrim);

    const chevrons = [];

    for (let index = 0; index < 9; index += 1) {
      const angle = (index / 9) * Math.PI * 2 + Math.PI / 2;
      chevrons.push(
        placed(new THREE.BoxGeometry(0.42, 0.55, 0.62), {
          position: [Math.cos(angle) * RING_RADIUS, Math.sin(angle) * RING_RADIUS, 0],
          rotation: [0, 0, angle],
        }),
      );
    }

    this.ring = new THREE.Mesh(
      mergeParts([new THREE.TorusGeometry(RING_RADIUS, 0.26, 20, 120), ...chevrons]),
      this.ringMaterial,
    );
    this.ring.position.y = RING_Y;
    this.ring.castShadow = true;
    this.group.add(this.ring);

    this.innerRing = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS - 0.42, 0.05, 8, 120), this.innerMaterial);
    this.innerRing.position.y = RING_Y;
    this.group.add(this.innerRing);

    this.vortexMaterial = createVortexMaterial();
    this.vortex = new THREE.Mesh(new THREE.CircleGeometry(RING_RADIUS - 0.3, 64), this.vortexMaterial);
    this.vortex.position.y = RING_Y;
    this.group.add(this.vortex);

    this.particles = createInfallParticles();
    this.particles.position.y = RING_Y;
    this.group.add(this.particles);

    const pylonGeometry = mergeParts([
      placed(new THREE.BoxGeometry(0.9, 6.4, 0.9), { position: [0, 3.2, 0] }),
      placed(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 6), { position: [0, 6.55, 0] }),
    ]);
    const stripGeometry = new THREE.BoxGeometry(0.08, 5.6, 0.92);
    stripGeometry.translate(0, 3.2, 0);

    for (const side of [-1, 1]) {
      const pylon = new THREE.Mesh(pylonGeometry, darkMetal);
      pylon.position.x = side * 5.6;
      pylon.castShadow = true;
      const strip = new THREE.Mesh(stripGeometry, this.ringMaterial);
      strip.position.x = side * 5.6 - side * 0.46;
      this.group.add(pylon, strip);
    }

    this.group.userData = {
      type: 'finish',
      interactionRadius: 5,
      portal: this,
    };

    this.colliders = [
      { x: -5.6, z, r: 0.75 },
      { x: 5.6, z, r: 0.75 },
    ];
    this.platform = { x: 0, z, r: 5.1, height: 0.36 };
    this.lightAnchor = new THREE.Vector3(0, RING_Y, z);
  }

  setActive(active) {
    if (active && !this.active) {
      this.activationClock = 0;
    }

    this.active = active;
  }

  getLightStrength() {
    return 0.25 + this.activation * 1.2;
  }

  update(time, dt) {
    this.activation = damp(this.activation, this.active ? 1 : 0, 2.2, dt);
    const a = this.activation;

    this.activationClock = Math.min(this.activationClock + dt, 1.2);
    const pop = this.active ? easeOutBack(Math.min(this.activationClock / 1.2, 1)) : 1;

    this.ring.rotation.z += dt * (0.08 + a * 0.5);
    this.ring.scale.setScalar(0.9 + 0.1 * pop);
    this.innerRing.rotation.z -= dt * (0.2 + a * 1.6);
    this.innerRing.scale.setScalar(1 + Math.sin(time * 3) * 0.02 * a);
    this.ringMaterial.emissiveIntensity = 0.25 + a * (2.2 + Math.sin(time * 2.4) * 0.4);
    this.innerMaterial.emissiveIntensity = 0.2 + a * 3;
    this.vortexMaterial.uniforms.uActive.value = a;
    this.particles.material.uniforms.uActive.value = a;
    this.particles.visible = a > 0.02;
  }
}
