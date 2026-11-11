import * as THREE from 'three';
import { mulberry32 } from '../utils/noise.js';
import { NOISE_GLSL, SOFT_POINT_FRAGMENT, sharedUniforms } from './shaderLib.js';

export const SKY_COLORS = {
  zenith: 0x02040d,
  horizon: 0x0b1530,
  ground: 0x03060c,
  glowEnd: 0x7a2fd0,
  glowStart: 0x0e6f8f,
  mountainFar: 0x0a1226,
  mountainNear: 0x050a16,
};

export const MOON_DIRECTION = new THREE.Vector3(-0.42, 0.3, 0.86).normalize();

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uGlowEnd;
  uniform vec3 uGlowStart;
  uniform vec3 uMountainFar;
  uniform vec3 uMountainNear;
  uniform vec3 uMoonDir;
  varying vec3 vDir;

  ${NOISE_GLSL}

  float ridgeNoise(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 6; i++) {
      float n = 1.0 - abs(n_noise2(p) * 2.0 - 1.0);
      sum += amp * n * n;
      p = p * 2.1 + 3.7;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec2 flatDir = normalize(dir.xz + vec2(1e-5));

    // Base gradient.
    vec3 color = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
    color = mix(color, uGround, smoothstep(0.0, -0.15, h));

    // Horizon glows: violet toward the finale, teal back toward the start.
    float horizonBand = exp(-abs(h) * 7.0);
    float towardEnd = max(dot(flatDir, vec2(0.0, 1.0)), 0.0);
    float towardStart = max(-flatDir.y, 0.0);
    color += uGlowEnd * pow(towardEnd, 3.0) * horizonBand * 0.9;
    color += uGlowStart * pow(towardStart, 2.5) * horizonBand * 0.45;

    // Milky-way style nebula band.
    vec3 bandNormal = normalize(vec3(0.42, 0.22, -0.88));
    float bandDist = dot(dir, bandNormal);
    float band = exp(-bandDist * bandDist / 0.04);
    float neb = n_fbm3(dir * 3.4 + 4.0);
    float tint = n_fbm3(dir * 6.5 - 2.0);
    vec3 nebColor = mix(vec3(0.18, 0.07, 0.42), vec3(0.03, 0.26, 0.48), tint);
    float above = smoothstep(-0.02, 0.3, h);
    color += nebColor * smoothstep(0.32, 0.8, neb) * band * 0.55 * above;
    color *= 1.0 - 0.45 * smoothstep(0.52, 0.72, tint) * band * above;

    // Faint star dust (the bright twinkling stars are real points).
    vec3 starCell = floor(dir * 700.0);
    float starSeed = n_hash13(starCell);
    color += vec3(0.75, 0.82, 1.0) * step(0.9965, starSeed) * (0.25 + 0.6 * band) * smoothstep(0.08, 0.3, h);

    // Moon with a soft halo.
    float md = dot(dir, uMoonDir);
    float disc = smoothstep(0.99935, 0.9996, md);
    float craters = 0.78 + 0.22 * n_fbm3(dir * 160.0);
    color += vec3(0.32, 0.4, 0.75) * pow(max(md, 0.0), 900.0) * 0.9;
    color += vec3(0.12, 0.16, 0.36) * pow(max(md, 0.0), 30.0) * 0.35;
    color = mix(color, vec3(1.0, 0.98, 0.94) * 3.2 * craters, disc);

    // Distant mountain ranges, sampled on a circle so they wrap seamlessly.
    float az = atan(dir.x, dir.z);
    vec2 circle = vec2(cos(az), sin(az));
    float farH = 0.018 + 0.085 * ridgeNoise(circle * 2.3 + 10.0);
    float nearH = -0.012 + 0.07 * pow(ridgeNoise(circle * 3.6 - 7.0), 1.4);

    float farMask = smoothstep(farH + 0.0015, farH - 0.0015, h);
    vec3 farColor = mix(uMountainFar, uHorizon, smoothstep(farH, -0.02, h) * 0.65);
    color = mix(color, farColor, farMask);
    color += uGlowEnd * smoothstep(0.006, 0.0, abs(h - farH)) * pow(towardEnd, 2.0) * 0.45;

    float nearMask = smoothstep(nearH + 0.0015, nearH - 0.0015, h);
    vec3 nearColor = mix(uMountainNear, uHorizon, smoothstep(nearH, -0.03, h) * 0.5);
    color = mix(color, nearColor, nearMask);
    color += uGlowStart * smoothstep(0.005, 0.0, abs(h - nearH)) * 0.12;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(SKY_COLORS.zenith) },
      uHorizon: { value: new THREE.Color(SKY_COLORS.horizon) },
      uGround: { value: new THREE.Color(SKY_COLORS.ground) },
      uGlowEnd: { value: new THREE.Color(SKY_COLORS.glowEnd) },
      uGlowStart: { value: new THREE.Color(SKY_COLORS.glowStart) },
      uMountainFar: { value: new THREE.Color(SKY_COLORS.mountainFar) },
      uMountainNear: { value: new THREE.Color(SKY_COLORS.mountainNear) },
      uMoonDir: { value: MOON_DIRECTION.clone() },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/**
 * Renders the sky shader into a cubemap once. Drawing the background each
 * frame is then a single texture fetch per pixel instead of ~60 noise lookups.
 */
export function bakeSkyBackground(renderer, size = 1024) {
  const bakeScene = new THREE.Scene();
  const material = createSkyMaterial();
  const geometry = new THREE.SphereGeometry(100, 64, 32);
  bakeScene.add(new THREE.Mesh(geometry, material));

  const target = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(1, 500, target);
  cubeCamera.update(renderer, bakeScene);

  geometry.dispose();
  material.dispose();
  return target;
}

/**
 * Builds the image-based lighting: the same sky plus a few bright neon
 * "light panels" so metals and the character's clear-coat get reflections.
 */
export function createEnvironmentMap(renderer) {
  const envScene = new THREE.Scene();
  const skyMaterial = createSkyMaterial();
  const skyGeometry = new THREE.SphereGeometry(50, 48, 24);
  envScene.add(new THREE.Mesh(skyGeometry, skyMaterial));

  const panels = [
    { color: 0x38bdf8, intensity: 5, position: [-30, 8, 18], size: [26, 3] },
    { color: 0xc084fc, intensity: 4.5, position: [26, 12, 30], size: [22, 4] },
    { color: 0x5eead4, intensity: 3.5, position: [18, 6, -30], size: [20, 2.5] },
    { color: 0xdbeafe, intensity: 2.2, position: [0, 40, 0], size: [30, 30] },
  ];
  const panelGeometry = new THREE.PlaneGeometry(1, 1);
  const disposables = [skyGeometry, skyMaterial, panelGeometry];

  for (const panel of panels) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(panel.color).multiplyScalar(panel.intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(panelGeometry, material);
    mesh.position.set(...panel.position);
    mesh.scale.set(panel.size[0], panel.size[1], 1);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
    disposables.push(material);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(envScene, 0.035, 0.1, 100);
  pmrem.dispose();
  disposables.forEach((item) => item.dispose());
  return envTarget;
}

/** Twinkling stars as real points so they stay crisp at any resolution. */
export function createStarField({ count = 1100, radius = 600 } = {}) {
  const random = mulberry32(42);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const palette = [
    new THREE.Color(0xdbeafe),
    new THREE.Color(0xbfdbfe),
    new THREE.Color(0xfef3c7),
    new THREE.Color(0xe9d5ff),
  ];

  for (let index = 0; index < count; index += 1) {
    const y = 0.13 + random() ** 1.6 * 0.87;
    const theta = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - y * y);
    positions[index * 3] = Math.cos(theta) * ring * radius;
    positions[index * 3 + 1] = y * radius;
    positions[index * 3 + 2] = Math.sin(theta) * ring * radius;

    const big = random() > 0.95;
    sizes[index] = big ? 3.2 + random() * 1.8 : 1.1 + random() * 1.4;
    seeds[index] = random();

    const color = palette[Math.floor(random() * palette.length)];
    const brightness = big ? 1.6 : 0.7 + random() * 0.5;
    colors[index * 3] = color.r * brightness;
    colors[index * 3 + 1] = color.g * brightness;
    colors[index * 3 + 2] = color.b * brightness;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uPixelRatio: sharedUniforms.uPixelRatio,
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aSeed;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float twinkle = 0.6 + 0.4 * sin(uTime * (0.7 + aSeed * 2.6) + aSeed * 40.0);
        float horizonFade = smoothstep(0.13, 0.25, normalize(position).y);
        vColor = aColor * twinkle * horizonFade;
        gl_PointSize = aSize * uPixelRatio * (0.85 + 0.3 * twinkle);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      ${SOFT_POINT_FRAGMENT}
      void main() {
        gl_FragColor = vec4(vColor * softPoint() * 1.5, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -10;
  return points;
}
