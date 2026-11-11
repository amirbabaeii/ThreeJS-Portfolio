import * as THREE from 'three';
import { smoothstep } from '../utils/math.js';
import { createValueNoise2D, fbm2 } from '../utils/noise.js';
import { NOISE_GLSL, patchMaterial, rimLightGLSL, sharedUniforms } from './shaderLib.js';

const terrainNoise = createValueNoise2D(1337);
const ridgeNoise = createValueNoise2D(4242);

export const TRACK = {
  startZ: -30,
  endZ: 262,
  flatHalfWidth: 20,
};

/**
 * Height of the world at (x, z). The play valley is perfectly flat; hills rise
 * on both sides and close the valley behind the start and past the finale.
 */
export function getTerrainHeight(x, z) {
  const ax = Math.abs(x);
  const side = smoothstep(TRACK.flatHalfWidth, TRACK.flatHalfWidth + 28, ax);
  const back = smoothstep(TRACK.startZ + 8, TRACK.startZ - 32, z);
  const front = smoothstep(TRACK.endZ - 4, TRACK.endZ + 36, z);
  const ramp = Math.max(side, back, front);

  if (ramp <= 0) {
    return 0;
  }

  const n = fbm2(terrainNoise, x * 0.017, z * 0.017, 4);
  const r = 1 - Math.abs(ridgeNoise(x * 0.03 + 40, z * 0.03 - 12));
  const distance = Math.max(ax - TRACK.flatHalfWidth, 0) + Math.max(TRACK.startZ - z, 0) + Math.max(z - TRACK.endZ, 0);
  const height = (5 + n * 9 + r * r * 9) * ramp + ramp * ramp * distance * 0.32;
  return Math.max(0, height);
}

export function createGround() {
  const width = 380;
  const depth = 520;
  const centerZ = (TRACK.startZ + TRACK.endZ) / 2;
  const geometry = new THREE.PlaneGeometry(width, depth, 152, 208);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, centerZ);

  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const low = new THREE.Color(0x0a111f);
  const high = new THREE.Color(0x1a2338);
  const peak = new THREE.Color(0x2a3550);
  const color = new THREE.Color();

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const y = getTerrainHeight(x, z);
    positions.setY(index, y);

    const t = smoothstep(0, 26, y);
    color.copy(low).lerp(high, t).lerp(peak, smoothstep(26, 48, y));
    const variation = 0.88 + 0.24 * (fbm2(terrainNoise, x * 0.08, z * 0.08, 2) * 0.5 + 0.5);
    colors[index * 3] = color.r * variation;
    colors[index * 3 + 1] = color.g * variation;
    colors[index * 3 + 2] = color.b * variation;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = patchMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
    }),
    {
      uniforms: {
        uTime: sharedUniforms.uTime,
        uPlayerPos: sharedUniforms.uPlayerPos,
      },
      vertexHeader: 'varying vec3 vGroundPos;',
      vertexMain: 'vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      fragmentHeader: `
        varying vec3 vGroundPos;
        uniform float uTime;
        uniform vec3 uPlayerPos;
      `,
      fragmentEmissive: /* glsl */ `
        {
          vec2 gp = vGroundPos.xz;
          float flatMask = 1.0 - smoothstep(0.05, 0.9, vGroundPos.y);
          vec2 cell = gp / 3.0;
          vec2 width = fwidth(cell);
          vec2 grid = abs(fract(cell - 0.5) - 0.5) / max(width, vec2(1e-4));
          float line = 1.0 - min(min(grid.x, grid.y), 1.0);
          float lod = 1.0 - smoothstep(0.18, 0.6, max(width.x, width.y));
          float camDist = length(gp - cameraPosition.xz);
          float pulse = pow(0.5 + 0.5 * sin(gp.y * 0.11 - uTime * 1.4), 8.0);
          vec2 toPlayer = gp - uPlayerPos.xz;
          float nearPlayer = exp(-dot(toPlayer, toPlayer) / 26.0);
          float offRoad = smoothstep(6.6, 7.4, abs(gp.x));
          vec3 gridColor = vec3(0.1, 0.42, 0.95);
          float intensity = 0.05 + 0.2 * pulse * (1.0 - smoothstep(18.0, 70.0, camDist)) + 0.55 * nearPlayer;
          totalEmissiveRadiance += gridColor * line * lod * flatMask * offRoad * intensity;
        }
        ${rimLightGLSL({ strength: '0.22', power: '4.0', mask: 'smoothstep(1.0, 6.0, vGroundPos.y)' })}
      `,
    },
  );

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

const HEX_GLSL = /* glsl */ `
  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
  }

  // xy: (unused, distance to edge), zw: tile id
  vec4 hexCoords(vec2 uv) {
    const vec2 r = vec2(1.0, 1.7320508);
    const vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return vec4(0.0, 0.5 - hexDist(gv), uv - gv);
  }
`;

export function createRoad() {
  const length = TRACK.endZ - TRACK.startZ + 6;
  // The rail sits right on the slab's edge, so the hard material boundary
  // reads as a lit kerb instead of needing a transparent blend.
  const geometry = new THREE.PlaneGeometry(12.7, length, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0.012, (TRACK.startZ + TRACK.endZ) / 2);

  const material = patchMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x111a2a,
      metalness: 0.5,
      roughness: 0.48,
      // Keep neon reflections as a hint; full strength washed the road out.
      envMapIntensity: 0.55,
    }),
    {
      uniforms: {
        uTime: sharedUniforms.uTime,
        uProgressZ: sharedUniforms.uProgressZ,
        uTargetZ: sharedUniforms.uTargetZ,
      },
      vertexHeader: 'varying vec3 vRoadPos;',
      vertexMain: 'vRoadPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      fragmentHeader: `
        varying vec3 vRoadPos;
        uniform float uTime;
        uniform float uProgressZ;
        uniform float uTargetZ;
        ${NOISE_GLSL}
        ${HEX_GLSL}
      `,
      fragmentEmissive: /* glsl */ `
        {
          vec2 rp = vRoadPos.xz;
          float ax = abs(rp.x);
          float camDist = length(rp - cameraPosition.xz);
          float near = 1.0 - smoothstep(30.0, 85.0, camDist);

          // Hex paving with per-tile tint and roughness variation.
          vec4 hx = hexCoords(rp * 0.85);
          float edgeWidth = fwidth(hx.y) * 1.5;
          float hexEdge = 1.0 - smoothstep(0.025, 0.025 + edgeWidth, hx.y);
          float tileRnd = n_hash12(hx.zw);
          diffuseColor.rgb *= (0.8 + 0.4 * tileRnd) * mix(1.0, 0.3, hexEdge);
          roughnessFactor = clamp(roughnessFactor + (tileRnd - 0.5) * 0.3 + hexEdge * 0.4, 0.08, 1.0);
          float tileWave = smoothstep(0.85, 1.0, sin(uTime * 0.9 + tileRnd * 6.2831 - rp.y * 0.08));

          vec3 cyan = vec3(0.22, 0.72, 1.0);
          vec3 mint = vec3(0.3, 1.0, 0.78);
          // Soft gradient (not a hard edge) where unlocked progress ends.
          float unlocked = 1.0 - smoothstep(uProgressZ - 8.0, uProgressZ + 8.0, rp.y);
          vec3 trail = mix(cyan, mint, unlocked);
          totalEmissiveRadiance += trail * hexEdge * near * (0.012 + 0.12 * tileWave + 0.035 * unlocked);

          // Glowing rails along both edges. They glow evenly along the whole
          // road so they never seem to switch off; unlocked stretches turn
          // mint and get only slightly brighter.
          float railDist = abs(ax - 6.2);
          float rail = 1.0 - smoothstep(0.05, 0.1 + fwidth(ax), railDist);
          float railHalo = exp(-railDist * railDist / 0.12);
          float railPulse = pow(0.5 + 0.5 * sin(rp.y * 0.32 - uTime * 4.0), 12.0);
          float railLevel = mix(0.75, 1.05, unlocked) + railPulse * 0.5;
          totalEmissiveRadiance += trail * (rail * railLevel + railHalo * 0.04);

          // Thin chevrons streaming toward the next objective.
          float ahead = 1.0 - smoothstep(uTargetZ - 6.0, uTargetZ - 2.0, rp.y);
          float chevCoord = (rp.y + ax * 0.9) * 0.22 - uTime * 0.85;
          float chev = fract(chevCoord);
          float chevWidth = fwidth(chevCoord);
          float chevMask = smoothstep(0.0, chevWidth + 0.01, chev) * (1.0 - smoothstep(0.045, 0.055 + chevWidth, chev));
          chevMask *= 1.0 - smoothstep(0.45, 0.7, ax);
          totalEmissiveRadiance += cyan * chevMask * ahead * near * 0.32;

          // Fake light pools under the lamp posts.
          float dz = mod(rp.y, 12.0) - 6.0;
          float dx = ax - 7.4;
          float pool = exp(-(dz * dz * 0.05 + dx * dx * 0.07));
          totalEmissiveRadiance += vec3(0.2, 0.45, 0.9) * pool * 0.1;
        }
      `,
    },
  );

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  return mesh;
}
