import * as THREE from 'three';

import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { damp, smoothstep } from '../utils/math.js';
import { mergeParts, placed } from './props.js';
import { createHologramMaterial, sharedUniforms } from './shaderLib.js';
import { inspectStatus, makeChapterSprite, makeLabelSprite, unlockedStatus } from './signage.js';

const ARCH_RADIUS = 7.3;
const HOLOGRAM_Y = 4.75;

let sharedAssets = null;

/** Geometry shared by all monuments: built once, reused 8 times. */
function getSharedAssets() {
  if (sharedAssets) {
    return sharedAssets;
  }

  const octagon = [0, Math.PI / 8, 0];
  const base = mergeParts([
    placed(new THREE.CylinderGeometry(3.0, 3.2, 0.36, 8), { position: [0, 0.18, 0], rotation: octagon }),
    placed(new THREE.CylinderGeometry(2.45, 2.65, 0.34, 8), { position: [0, 0.53, 0], rotation: octagon }),
    placed(new THREE.CylinderGeometry(1.85, 2.05, 0.3, 8), { position: [0, 0.85, 0], rotation: octagon }),
    placed(new THREE.CylinderGeometry(0.72, 0.92, 2.3, 6), { position: [0, 2.15, 0] }),
    placed(new THREE.CylinderGeometry(1.05, 0.78, 0.26, 6), { position: [0, 3.43, 0] }),
  ]);

  const accentParts = [
    placed(new THREE.CylinderGeometry(3.04, 3.04, 0.06, 8, 1, true), { position: [0, 0.33, 0], rotation: octagon }),
    placed(new THREE.CylinderGeometry(2.49, 2.49, 0.06, 8, 1, true), { position: [0, 0.68, 0], rotation: octagon }),
    placed(new THREE.CylinderGeometry(1.08, 1.08, 0.05, 6, 1, true), { position: [0, 3.57, 0] }),
  ];

  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    accentParts.push(
      placed(new THREE.BoxGeometry(0.07, 1.9, 0.07), {
        position: [Math.sin(angle) * 0.84, 2.15, Math.cos(angle) * 0.84],
        rotation: [0, angle, 0],
      }),
    );
  }

  const accent = mergeParts(accentParts);

  const rings = mergeParts([
    placed(new THREE.TorusGeometry(1.32, 0.022, 6, 72), { rotation: [Math.PI / 2 + 0.35, 0, 0] }),
    placed(new THREE.TorusGeometry(1.58, 0.016, 6, 72), { rotation: [Math.PI / 2 - 0.5, 0.4, 0] }),
    placed(new THREE.SphereGeometry(0.07, 10, 8), { position: [1.32, 0, 0] }),
  ]);

  const briefcase = mergeParts([
    new RoundedBoxGeometry(1.25, 0.88, 0.4, 3, 0.1),
    placed(new THREE.TorusGeometry(0.22, 0.05, 8, 20, Math.PI), { position: [0, 0.44, 0] }),
    placed(new THREE.BoxGeometry(1.27, 0.05, 0.42), { position: [0, 0.12, 0] }),
    placed(new THREE.BoxGeometry(0.16, 0.14, 0.44), { position: [0, 0.12, 0] }),
  ]);

  const gradCap = mergeParts([
    placed(new THREE.BoxGeometry(1.45, 0.07, 1.45), { position: [0, 0.28, 0], rotation: [0, Math.PI / 4, 0] }),
    placed(new THREE.CylinderGeometry(0.5, 0.58, 0.42, 20), { position: [0, 0.03, 0] }),
    placed(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 10), { position: [0, 0.34, 0] }),
    placed(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), { position: [1.0, 0.0, 0] }),
    placed(new THREE.CylinderGeometry(0.07, 0.03, 0.2, 8), { position: [1.0, -0.36, 0] }),
  ]);

  const beam = new THREE.CylinderGeometry(0.45, 0.95, 46, 20, 1, true);
  beam.translate(0, 23, 0);

  const glow = new THREE.CircleGeometry(4.6, 48);
  glow.rotateX(-Math.PI / 2);

  const arch = new THREE.TorusGeometry(ARCH_RADIUS, 0.13, 8, 96, Math.PI);
  const archInner = new THREE.TorusGeometry(ARCH_RADIUS - 0.45, 0.04, 6, 96, Math.PI);
  const archBase = mergeParts([
    placed(new THREE.BoxGeometry(0.7, 1.2, 0.7), { position: [ARCH_RADIUS, 0.6, 0] }),
    placed(new THREE.BoxGeometry(0.7, 1.2, 0.7), { position: [-ARCH_RADIUS, 0.6, 0] }),
  ]);

  sharedAssets = {
    base,
    accent,
    rings,
    briefcase,
    gradCap,
    beam,
    glow,
    arch: mergeParts([arch, archInner]),
    archBase,
    baseMaterial: new THREE.MeshStandardMaterial({ color: 0x182133, metalness: 0.78, roughness: 0.3 }),
  };

  return sharedAssets;
}

function createBeamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: 0.4 },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * normal);
        vFacing = abs(dot(n, normalize(cameraPosition - world.xyz)));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        float core = pow(clamp(vFacing, 0.0, 1.0), 2.5);
        float fade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.4) * smoothstep(0.0, 0.02, vUv.y);
        float streaks = 0.6 + 0.4 * sin(vUv.x * 37.7 + uTime * 1.3) * sin(vUv.y * 46.0 - uTime * 3.2);
        gl_FragColor = vec4(uColor * core * fade * streaks * uStrength, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function createGroundGlowMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: 0.5 },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        // Square explicitly: pow() with a negative base is undefined in GLSL
        // and the resulting NaNs get smeared across the screen by bloom.
        float ringDist = (r - 0.78) / 0.04;
        float ring = exp(-ringDist * ringDist);
        float ripple = pow(0.5 + 0.5 * sin(r * 22.0 - uTime * 2.4), 6.0) * smoothstep(1.0, 0.7, r) * 0.25;
        float inner = (1.0 - smoothstep(0.55, 1.0, r)) * 0.18;
        gl_FragColor = vec4(uColor * (ring + ripple + inner) * uStrength, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const LOCKED = { accent: 0.9, hologram: 0.55, beam: 0.32, glow: 0.45 };
const NEXT = { accent: 1.5, hologram: 1.0, beam: 0.85, glow: 1.0 };
const UNLOCKED = { accent: 2.6, hologram: 1.35, beam: 1.25, glow: 1.4 };

export class Monument {
  constructor(item, { x, z, total }) {
    const assets = getSharedAssets();
    this.item = item;
    this.total = total;
    this.flash = 0;
    this.focus = 0;
    this.levels = { ...LOCKED };
    this.isNext = false;

    const accent = new THREE.Color(item.accent);
    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: accent.clone().multiplyScalar(0.25),
      emissive: accent,
      emissiveIntensity: LOCKED.accent,
      metalness: 0.4,
      roughness: 0.3,
    });

    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.group.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;

    const base = new THREE.Mesh(assets.base, assets.baseMaterial);
    base.castShadow = true;
    base.receiveShadow = true;
    const trims = new THREE.Mesh(assets.accent, this.accentMaterial);
    this.group.add(base, trims);

    this.hologramMaterial = createHologramMaterial(accent, LOCKED.hologram);
    this.hologram = new THREE.Mesh(item.category === 'education' ? assets.gradCap : assets.briefcase, this.hologramMaterial);
    this.hologram.position.y = HOLOGRAM_Y;
    this.group.add(this.hologram);

    this.rings = new THREE.Mesh(assets.rings, this.accentMaterial);
    this.rings.position.y = HOLOGRAM_Y;
    this.group.add(this.rings);

    this.beamMaterial = createBeamMaterial(accent);
    this.beam = new THREE.Mesh(assets.beam, this.beamMaterial);
    this.beam.position.y = 3.6;
    this.group.add(this.beam);

    this.glowMaterial = createGroundGlowMaterial(accent);
    const glow = new THREE.Mesh(assets.glow, this.glowMaterial);
    glow.position.y = 0.04;
    glow.renderOrder = 1;
    this.group.add(glow);

    this.label = makeLabelSprite(this.getLabelContent(false));
    this.label.position.y = 7.6;
    this.group.add(this.label);

    // Chapter arch spanning the road just before the monument.
    this.arch = new THREE.Group();
    this.arch.position.set(0, 0, z - 6);
    // The arch is big and close to the camera, so it glows at a fraction of
    // the monument trim's intensity to avoid blowing out under bloom.
    this.archMaterial = this.accentMaterial.clone();
    const archRing = new THREE.Mesh(assets.arch, this.archMaterial);
    archRing.castShadow = true;
    const archBase = new THREE.Mesh(assets.archBase, assets.baseMaterial);
    archBase.castShadow = true;
    const chapter = makeChapterSprite(`CHAPTER ${String(item.index + 1).padStart(2, '0')}`, item.accent);
    chapter.position.y = ARCH_RADIUS + 0.9;
    this.arch.add(archRing, archBase, chapter);

    this.group.userData = {
      type: 'milestone',
      item,
      interactionRadius: 5,
      monument: this,
    };

    this.colliders = [
      { x, z, r: 3.15 },
      { x: ARCH_RADIUS, z: z - 6, r: 0.55 },
      { x: -ARCH_RADIUS, z: z - 6, r: 0.55 },
    ];
    this.lightAnchor = new THREE.Vector3(x, HOLOGRAM_Y, z);
  }

  getLabelContent(unlocked) {
    const { item, total } = this;
    return {
      eyebrow: `${item.category} · ${String(item.index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`,
      title: item.title,
      subtitle: `${item.place} · ${item.period}`,
      accent: item.accent,
      status: unlocked ? unlockedStatus() : inspectStatus(),
    };
  }

  setNext(isNext) {
    this.isNext = isNext;
  }

  unlock() {
    this.flash = 1;
    this.label.userData.update(this.getLabelContent(true));
  }

  reset() {
    this.flash = 0;
    this.label.userData.update(this.getLabelContent(false));
  }

  /** 0..1 how strongly the pooled point light should shine here. */
  getLightStrength() {
    return this.item.unlocked ? 1 : this.isNext ? 0.8 : 0.45;
  }

  update(time, dt, cameraPosition) {
    const target = this.item.unlocked ? UNLOCKED : this.isNext ? NEXT : LOCKED;
    const levels = this.levels;

    for (const key of Object.keys(levels)) {
      levels[key] = damp(levels[key], target[key], 3, dt);
    }

    this.flash = Math.max(0, this.flash - dt * 0.8);
    const flash = this.flash * this.flash;
    const pulse = this.isNext && !this.item.unlocked ? 0.75 + 0.25 * Math.sin(time * 3.2) : 1;

    this.accentMaterial.emissiveIntensity = levels.accent * (1 + flash * 1.1);
    this.archMaterial.emissiveIntensity = levels.accent * 0.42 * (1 + flash * 0.8);
    this.hologramMaterial.uniforms.uStrength.value = levels.hologram * pulse + flash * 1.2;
    this.beamMaterial.uniforms.uStrength.value = levels.beam * pulse + flash * 0.9;
    this.glowMaterial.uniforms.uStrength.value = levels.glow * pulse + flash * 0.6;

    const phase = time + this.item.index * 0.7;
    const spin = this.item.unlocked ? 1.1 : 0.45;
    this.hologram.rotation.y += dt * spin;
    this.hologram.position.y = HOLOGRAM_Y + Math.sin(phase * 1.6) * 0.12 + flash * 0.6;
    this.hologram.scale.setScalar(1 + flash * 0.35);
    this.rings.rotation.y -= dt * spin * 1.6;
    this.rings.rotation.z = Math.sin(phase * 0.7) * 0.2;
    this.label.position.y = 7.6 + Math.sin(phase * 1.3) * 0.1;

    const distance = cameraPosition.distanceTo(this.group.position);
    this.label.material.opacity = smoothstep(78, 42, distance);
    this.label.visible = this.label.material.opacity > 0.01;
  }
}
