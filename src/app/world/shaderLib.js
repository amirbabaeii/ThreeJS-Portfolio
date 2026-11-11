import * as THREE from 'three';

/**
 * Uniforms shared by many materials. Every material that animates references
 * these objects directly, so a single write per frame updates all of them.
 */
export const sharedUniforms = {
  uTime: { value: 0 },
  uPixelRatio: { value: 1 },
  uPlayerPos: { value: new THREE.Vector3() },
  uProgressZ: { value: -50 },
  uTargetZ: { value: 18 },
};

export const NOISE_GLSL = /* glsl */ `
  float n_hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float n_hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }

  float n_noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = n_hash12(i);
    float b = n_hash12(i + vec2(1.0, 0.0));
    float c = n_hash12(i + vec2(0.0, 1.0));
    float d = n_hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float n_noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = n_hash13(i);
    float n100 = n_hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = n_hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = n_hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = n_hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = n_hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = n_hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = n_hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
      mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
      u.z
    );
  }

  float n_fbm2(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * n_noise2(p);
      p = p * 2.03 + 17.1;
      amp *= 0.5;
    }
    return sum;
  }

  float n_fbm3(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * n_noise3(p);
      p = p * 2.02 + 11.7;
      amp *= 0.5;
    }
    return sum;
  }
`;

/**
 * Cool moonlit rim for silhouettes, injected after the emissive chunk of a
 * standard material (`normal` and `vViewPosition` are view-space there).
 */
export function rimLightGLSL({ color = 'vec3(0.35, 0.55, 1.0)', power = '3.0', strength = '0.35', mask = '1.0' } = {}) {
  return /* glsl */ `
    {
      float rimFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
      float rim = pow(clamp(1.0 - rimFacing, 0.0, 1.0), ${power});
      totalEmissiveRadiance += ${color} * rim * ${strength} * (${mask});
    }
  `;
}

/** Soft round point sprite used by every particle system. */
export const SOFT_POINT_FRAGMENT = /* glsl */ `
  float softPoint() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    return core * core;
  }
`;

/**
 * Additive hologram material: fresnel rim + moving scanlines + flicker.
 * `strength` is a per-instance uniform so a monument can flare on unlock.
 */
export function createHologramMaterial(color, strength = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vPosW;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vPosW = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTime;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vPosW;
      void main() {
        float facing = abs(dot(normalize(vNormalW), normalize(vViewDir)));
        float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), 2.2);
        float scan = 0.62 + 0.38 * sin(vPosW.y * 26.0 - uTime * 5.0);
        float flicker = 0.93 + 0.07 * sin(uTime * 41.0 + vPosW.y * 3.0);
        vec3 color = uColor * (0.18 + fresnel * 1.9) * scan * flicker * uStrength;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/**
 * Patch a built-in material: declares extra uniforms/varyings and injects GLSL
 * at the usual hook points. Keeps the onBeforeCompile boilerplate in one place.
 */
export function patchMaterial(material, {
  uniforms = {},
  vertexHeader = '',
  vertexMain = '',
  fragmentHeader = '',
  fragmentEmissive = '',
}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    if (vertexHeader || vertexMain) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vertexHeader}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${vertexMain}`);
    }

    if (fragmentHeader || fragmentEmissive) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragmentHeader}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${fragmentEmissive}`);
    }
  };

  // three.js keys programs by onBeforeCompile.toString(), which is identical
  // for every patched material. Key on the injected source instead so two
  // materials with different patches never share a program.
  const cacheKey = [vertexHeader, vertexMain, fragmentHeader, fragmentEmissive].join('|');
  material.customProgramCacheKey = () => cacheKey;

  return material;
}
