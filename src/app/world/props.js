import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_LAYOUT } from '../config.js';
import { createValueNoise2D, mulberry32 } from '../utils/noise.js';
import { NOISE_GLSL, patchMaterial, rimLightGLSL } from './shaderLib.js';
import { getTerrainHeight, TRACK } from './terrain.js';

export function isBlocked(x, z, blockers, padding = 0) {
  for (const blocker of blockers) {
    const dx = x - blocker.x;
    const dz = z - blocker.z;
    const radius = blocker.r + padding;

    if (dx * dx + dz * dz < radius * radius) {
      return true;
    }
  }

  return false;
}

const MERGE_ATTRIBUTES = ['position', 'normal', 'uv'];

/**
 * mergeGeometries() that tolerates mixing indexed and non-indexed inputs
 * (e.g. RoundedBoxGeometry is non-indexed) and stray extra attributes.
 */
export function mergeParts(geometries) {
  const mixed = geometries.some((geometry) => geometry.index) && geometries.some((geometry) => !geometry.index);
  const list = mixed ? geometries.map((geometry) => (geometry.index ? geometry.toNonIndexed() : geometry)) : geometries;

  for (const geometry of list) {
    for (const name of Object.keys(geometry.attributes)) {
      if (!MERGE_ATTRIBUTES.includes(name)) {
        geometry.deleteAttribute(name);
      }
    }
  }

  return mergeGeometries(list);
}

/** Bakes a transform into a geometry (used before merging static parts). */
export function placed(geometry, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  return geometry.applyMatrix4(matrix);
}

/** Glowing crystal clusters scattered on the valley slopes (one draw call). */
export function createCrystalField({ blockers, count = 240, seed = 7 }) {
  const random = mulberry32(seed);
  const geometry = new THREE.OctahedronGeometry(1, 0);
  geometry.scale(0.42, 1.55, 0.42);
  geometry.translate(0, 1.15, 0);

  const material = patchMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x1e2c40,
      emissive: 0xffffff,
      emissiveIntensity: 1.15,
      roughness: 0.16,
      metalness: 0.25,
      flatShading: true,
    }),
    {
      fragmentEmissive: `
        #ifdef USE_COLOR
          totalEmissiveRadiance *= vColor.rgb;
        #endif
      `,
    },
  );

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = [0x2de2c4, 0x38bdf8, 0x8b5cf6, 0x22d3ee, 0x5eead4, 0xf472b6];
  let index = 0;
  let guard = 0;

  while (index < count && guard < count * 30) {
    guard += 1;
    const side = random() < 0.5 ? -1 : 1;
    // Stay outside the walkable strip (|x| <= playHalfWidth) so the player
    // never runs through scenery that has no collider.
    const cx = side * (WORLD_LAYOUT.playHalfWidth + 2.5 + random() ** 1.4 * 58);
    const cz = TRACK.startZ - 20 + random() * (TRACK.endZ - TRACK.startZ + 50);

    if (isBlocked(cx, cz, blockers, 2.5)) {
      continue;
    }

    const clusterSize = 2 + Math.floor(random() * 5);
    const baseScale = 0.45 + random() * (Math.abs(cx) > 30 ? 2.8 : 1.1);
    const hue = palette[Math.floor(random() * palette.length)];

    for (let item = 0; item < clusterSize && index < count; item += 1) {
      const x = cx + (random() - 0.5) * 2.6 * baseScale;
      const z = cz + (random() - 0.5) * 2.6 * baseScale;

      if (Math.abs(x) < WORLD_LAYOUT.playHalfWidth + 1 || isBlocked(x, z, blockers, 0.8)) {
        continue;
      }

      const scale = baseScale * (0.45 + random() * 0.75);
      dummy.position.set(x, getTerrainHeight(x, z) - 0.45 * scale, z);
      dummy.rotation.set((random() - 0.5) * 0.8, random() * Math.PI, (random() - 0.5) * 0.8);
      dummy.scale.set(scale, scale * (0.75 + random() * 0.7), scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.set(hue).multiplyScalar(0.45 + random() * 1.1);
      mesh.setColorAt(index, color);
      index += 1;
    }
  }

  mesh.count = index;
  mesh.name = 'crystals';
  return mesh;
}

/** Low-poly boulders, jittered once and instanced. */
export function createRockField({ blockers, count = 170, seed = 11 }) {
  const random = mulberry32(seed);
  const jitter = createValueNoise2D(99);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.attributes.position;

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    // Offsets depend only on the original vertex position, so the duplicated
    // vertices of this non-indexed geometry move together (no cracks).
    const n = jitter(x * 1.9 + z * 0.7, y * 2.1 - z * 1.3);
    const scale = 1 + n * 0.28;
    position.setXYZ(index, x * scale, y * scale * 0.72, z * scale);
  }

  geometry.computeVertexNormals();

  const material = patchMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x242e42,
      roughness: 0.86,
      metalness: 0.12,
      flatShading: true,
    }),
    { fragmentEmissive: rimLightGLSL({ strength: '0.3' }) },
  );

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let index = 0;
  let guard = 0;

  while (index < count && guard < count * 20) {
    guard += 1;
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (WORLD_LAYOUT.playHalfWidth + 1.5 + random() ** 1.3 * 115);
    const z = TRACK.startZ - 50 + random() * (TRACK.endZ - TRACK.startZ + 110);

    if (isBlocked(x, z, blockers, 1.5)) {
      continue;
    }

    const far = Math.abs(x) > 40;
    const scale = far ? 1.5 + random() * 5 : 0.35 + random() * 1.4;
    dummy.position.set(x, getTerrainHeight(x, z) - scale * 0.25, z);
    dummy.rotation.set(random() * 0.5, random() * Math.PI * 2, random() * 0.5);
    dummy.scale.set(scale * (0.8 + random() * 0.5), scale, scale * (0.8 + random() * 0.5));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    color.setScalar(0.75 + random() * 0.5);
    mesh.setColorAt(index, color);
    index += 1;
  }

  mesh.count = index;
  mesh.receiveShadow = true;
  mesh.name = 'rocks';
  return mesh;
}

/** Street lamps along the road: poles cast shadows, heads glow via bloom. */
export function createLampPosts({ blockers, colliders }) {
  const spots = [];

  for (let z = 6; z <= TRACK.endZ - 20; z += WORLD_LAYOUT.lampSpacing) {
    for (const side of [-1, 1]) {
      const x = side * WORLD_LAYOUT.lampOffsetX;

      if (!isBlocked(x, z, blockers, 1.2)) {
        spots.push({ x, z, side });
      }
    }
  }

  const poleGeometry = mergeParts([
    placed(new THREE.CylinderGeometry(0.24, 0.32, 0.3, 10), { position: [0, 0.15, 0] }),
    placed(new THREE.CylinderGeometry(0.06, 0.085, 3.5, 8), { position: [0, 1.95, 0] }),
    placed(new THREE.CylinderGeometry(0.26, 0.1, 0.16, 10), { position: [0, 3.82, 0] }),
    placed(new THREE.TorusGeometry(0.2, 0.025, 6, 20), { position: [0, 3.36, 0], rotation: [Math.PI / 2, 0, 0] }),
  ]);
  const headGeometry = new THREE.SphereGeometry(0.17, 16, 12);
  headGeometry.translate(0, 3.6, 0);

  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2638, metalness: 0.8, roughness: 0.32 });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b1a26,
    emissive: 0x8be3ff,
    emissiveIntensity: 1.9,
    roughness: 0.3,
  });

  const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, spots.length);
  const heads = new THREE.InstancedMesh(headGeometry, headMaterial, spots.length);
  const dummy = new THREE.Object3D();

  spots.forEach((spot, index) => {
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(index, dummy.matrix);
    heads.setMatrixAt(index, dummy.matrix);
    colliders.push({ x: spot.x, z: spot.z, r: 0.32 });
  });

  poles.castShadow = true;
  poles.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'lamps';
  group.add(poles, heads);
  return group;
}

/** Distant spires with glowing floor bands: a hazy skyline in the fog. */
export function createSkyline({ count = 70, seed = 23 }) {
  const random = mulberry32(seed);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);

  const material = patchMaterial(
    new THREE.MeshStandardMaterial({ color: 0x0a1120, roughness: 0.6, metalness: 0.5 }),
    {
      vertexHeader: 'varying vec3 vTowerPos; varying float vLocalY; varying float vSeed;',
      vertexMain: `
        #ifdef USE_INSTANCING
          vTowerPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.071);
        #else
          vTowerPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vSeed = 0.5;
        #endif
        vLocalY = position.y;
      `,
      fragmentHeader: `
        varying vec3 vTowerPos;
        varying float vLocalY;
        varying float vSeed;
        ${NOISE_GLSL}
      `,
      fragmentEmissive: /* glsl */ `
        {
          float coord = vTowerPos.y * 0.14 + vSeed * 7.0;
          float band = fract(coord);
          float width = fwidth(coord) * 1.5;
          float line = smoothstep(0.0, width, band) * (1.0 - smoothstep(0.07, 0.07 + width, band));
          float lit = step(0.5, n_hash12(vec2(floor(coord), vSeed * 91.0)));
          vec3 tint = mix(vec3(0.2, 0.62, 1.0), vec3(0.72, 0.42, 1.0), step(0.6, vSeed));
          float top = smoothstep(0.975, 0.995, vLocalY);
          totalEmissiveRadiance += tint * (line * lit * 0.85 + top * 2.2);
        }
      `,
    },
  );

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();

  for (let index = 0; index < count; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const x = side * (75 + random() * 95);
    const z = TRACK.startZ - 70 + random() * (TRACK.endZ - TRACK.startZ + 160);
    const height = 14 + random() ** 1.6 * 60;
    const width = 3 + random() * 7;
    dummy.position.set(x, getTerrainHeight(x, z) - 3, z);
    dummy.rotation.set(0, random() * Math.PI, 0);
    dummy.scale.set(width, height, width * (0.6 + random() * 0.8));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }

  mesh.name = 'skyline';
  return mesh;
}

/** Floating rock islands with glowing crystals hanging beneath them. */
export function createFloatingIslands({ count = 9, seed = 5 }) {
  const random = mulberry32(seed);
  const group = new THREE.Group();
  group.name = 'islands';

  const rockGeometry = new THREE.ConeGeometry(1, 2.4, 7, 3);
  rockGeometry.rotateX(Math.PI);
  rockGeometry.translate(0, -1.2, 0);
  const rockPositions = rockGeometry.attributes.position;
  const jitter = createValueNoise2D(77);

  for (let index = 0; index < rockPositions.count; index += 1) {
    const x = rockPositions.getX(index);
    const y = rockPositions.getY(index);
    const z = rockPositions.getZ(index);
    const n = jitter(x * 2.3 + y, z * 2.1 - y);
    rockPositions.setXYZ(index, x * (1 + n * 0.22), y, z * (1 + n * 0.22));
  }

  rockGeometry.computeVertexNormals();
  const topGeometry = new THREE.CylinderGeometry(1.02, 0.98, 0.22, 7);
  topGeometry.translate(0, 0.05, 0);
  const crystalGeometry = new THREE.OctahedronGeometry(0.32, 0);
  crystalGeometry.scale(1, 2.4, 1);

  const rockMaterial = patchMaterial(
    new THREE.MeshStandardMaterial({ color: 0x242e42, roughness: 0.85, metalness: 0.1, flatShading: true }),
    { fragmentEmissive: rimLightGLSL({ color: 'vec3(0.45, 0.5, 1.0)', strength: '0.45', power: '2.5' }) },
  );
  const topMaterial = new THREE.MeshStandardMaterial({
    color: 0x0f2a2a,
    roughness: 0.9,
    emissive: 0x0d9488,
    emissiveIntensity: 0.25,
    flatShading: true,
  });
  const crystalMaterials = [0x5eead4, 0xa78bfa, 0x38bdf8].map(
    (hex) => new THREE.MeshStandardMaterial({ color: 0x10202c, emissive: hex, emissiveIntensity: 2.6, flatShading: true }),
  );

  for (let index = 0; index < count; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const x = side * (28 + random() * 40);
    const z = TRACK.startZ + 10 + (index / count) * (TRACK.endZ - TRACK.startZ) + random() * 18;
    const scale = 2.6 + random() * 3.6;
    const island = new THREE.Group();
    island.position.set(x, getTerrainHeight(x, z) + 12 + random() * 16, z);
    island.rotation.y = random() * Math.PI * 2;
    island.scale.setScalar(scale);

    island.add(new THREE.Mesh(rockGeometry, rockMaterial));
    island.add(new THREE.Mesh(topGeometry, topMaterial));

    const crystal = new THREE.Mesh(crystalGeometry, crystalMaterials[index % crystalMaterials.length]);
    crystal.position.y = -2.75;
    island.add(crystal);

    for (let shard = 0; shard < 3; shard += 1) {
      const small = new THREE.Mesh(crystalGeometry, crystalMaterials[(index + shard + 1) % crystalMaterials.length]);
      const angle = random() * Math.PI * 2;
      small.position.set(Math.cos(angle) * 0.55, 0.3, Math.sin(angle) * 0.55);
      small.scale.setScalar(0.35 + random() * 0.3);
      small.rotation.z = (random() - 0.5) * 0.5;
      island.add(small);
    }

    island.userData = { baseY: island.position.y, phase: random() * Math.PI * 2, spin: (random() - 0.5) * 0.06 };
    group.add(island);
  }

  group.userData.update = (time, dt) => {
    for (const island of group.children) {
      const { baseY, phase, spin } = island.userData;
      island.position.y = baseY + Math.sin(time * 0.35 + phase) * 0.9;
      island.rotation.y += spin * dt;
    }
  };

  return group;
}
