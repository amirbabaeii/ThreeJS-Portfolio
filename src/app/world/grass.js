import * as THREE from 'three';
import { createValueNoise2D, mulberry32 } from '../utils/noise.js';
import { isBlocked } from './props.js';
import { sharedUniforms } from './shaderLib.js';
import { getTerrainHeight, TRACK } from './terrain.js';

const CHUNK_LENGTH = 30;

function createBladeGeometry() {
  // A tapered 3-segment blade; y runs 0 -> 1 so the shader can use it as
  // the bend weight.
  const positions = new Float32Array([
    -0.06, 0, 0,
    0.06, 0, 0,
    -0.045, 0.4, 0,
    0.045, 0.4, 0,
    -0.022, 0.75, 0,
    0.022, 0.75, 0,
    0, 1, 0,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6]);
  return geometry;
}

function createGrassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uBase: { value: new THREE.Color(0x06121a) },
        uMid: { value: new THREE.Color(0x0b3b45) },
        uTip: { value: new THREE.Color(0x2ee6c8) },
        uTipAlt: { value: new THREE.Color(0x7c5cff) },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform vec3 uPlayerPos;
      attribute vec4 aOffset; // xyz position, w rotation
      attribute vec2 aParams; // x height, y seed
      varying float vHeight;
      varying float vSeed;
      varying float vLight;

      void main() {
        float height = aParams.x;
        float seed = aParams.y;
        vec3 p = position;
        p.x *= 0.8 + seed * 0.6;
        p.y *= height;
        float c = cos(aOffset.w);
        float s = sin(aOffset.w);
        p = vec3(p.x * c, p.y, p.x * s);

        vec3 world = aOffset.xyz + p;
        float bend = position.y * position.y;

        float gust = sin(uTime * 1.3 + aOffset.x * 0.09 + aOffset.z * 0.06);
        float wind = sin(uTime * 2.1 + aOffset.x * 0.35 + aOffset.z * 0.27 + seed * 3.0) * 0.5 + gust * 0.6;
        vec2 sway = vec2(0.22, 0.1) * wind;

        vec2 away = aOffset.xz - uPlayerPos.xz;
        float dist = length(away);
        float push = smoothstep(2.1, 0.2, dist);
        sway += (away / max(dist, 0.001)) * push * 0.95;

        world.xz += sway * bend * height;
        world.y -= (push * 0.4 + abs(wind) * 0.05) * bend * height;

        vHeight = position.y;
        vSeed = seed;
        vLight = 0.75 + 0.25 * gust;

        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uBase;
      uniform vec3 uMid;
      uniform vec3 uTip;
      uniform vec3 uTipAlt;
      varying float vHeight;
      varying float vSeed;
      varying float vLight;

      void main() {
        vec3 tip = mix(uTip, uTipAlt, step(0.82, vSeed));
        vec3 color = mix(uBase, uMid, smoothstep(0.0, 0.55, vHeight));
        float glow = smoothstep(0.6, 1.0, vHeight) * (0.35 + 0.65 * vSeed);
        color = mix(color, tip * (0.6 + 0.9 * vSeed * vSeed), glow);
        gl_FragColor = vec4(color * vLight, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/**
 * Instanced grass split into chunks along the track so blades behind the
 * camera are frustum-culled. Density is adjustable at runtime by trimming
 * each chunk's instance count (instances are pre-shuffled).
 */
export function createGrassField({ blockers, bladeCount = 26000, seed = 3 }) {
  const random = mulberry32(seed);
  const clump = createValueNoise2D(808);
  const bladeGeometry = createBladeGeometry();
  const material = createGrassMaterial();
  material.uniforms.uTime = sharedUniforms.uTime;
  material.uniforms.uPlayerPos = sharedUniforms.uPlayerPos;

  const group = new THREE.Group();
  group.name = 'grass';
  const chunks = [];
  const startZ = TRACK.startZ - 6;
  const endZ = TRACK.endZ + 8;
  const chunkCount = Math.ceil((endZ - startZ) / CHUNK_LENGTH);
  const perChunk = Math.ceil(bladeCount / chunkCount);

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const z0 = startZ + chunkIndex * CHUNK_LENGTH;
    const offsets = [];
    const params = [];
    let guard = 0;

    while (offsets.length / 4 < perChunk && guard < perChunk * 6) {
      guard += 1;
      const side = random() < 0.5 ? -1 : 1;
      const x = side * (6.9 + random() ** 1.25 * 27);
      const z = z0 + random() * CHUNK_LENGTH;
      const density = clump(x * 0.09, z * 0.09) * 0.5 + 0.5;

      if (random() > 0.25 + density * 0.9 || isBlocked(x, z, blockers, 0.2)) {
        continue;
      }

      const y = getTerrainHeight(x, z);

      if (y > 4) {
        continue;
      }

      offsets.push(x, y - 0.02, z, random() * Math.PI);
      params.push(0.35 + random() * 0.55 + density * 0.45, random());
    }

    const count = offsets.length / 4;

    if (count === 0) {
      continue;
    }

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = bladeGeometry.index;
    geometry.setAttribute('position', bladeGeometry.attributes.position);
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 4));
    geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(new Float32Array(params), 2));
    geometry.instanceCount = count;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, z0 + CHUNK_LENGTH / 2), 38);
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-35, -1, z0 - 1),
      new THREE.Vector3(35, 6, z0 + CHUNK_LENGTH + 1),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.maxCount = count;
    group.add(mesh);
    chunks.push(mesh);
  }

  group.userData.setDensity = (density) => {
    for (const chunk of chunks) {
      chunk.geometry.instanceCount = Math.max(1, Math.floor(chunk.userData.maxCount * density));
    }
  };

  return group;
}
