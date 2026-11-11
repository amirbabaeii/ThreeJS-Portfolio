import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { POST_CONFIG, QUALITY_TIERS, RENDERER_CONFIG } from '../config.js';

const QUALITY_STORAGE_KEY = 'career-odyssey.quality';
const QUALITY_MODES = ['auto', 'high', 'medium', 'low'];

/** Vignette + film grain + a touch of chromatic aberration, in display space. */
const FinishingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: POST_CONFIG.vignette },
    uGrain: { value: POST_CONFIG.grain },
    uAberration: { value: POST_CONFIG.aberration },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    varying vec2 vUv;

    float grainHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);
      vec2 offset = centered * r2 * 4.0 * uAberration;

      vec3 color;
      color.r = texture2D(tDiffuse, vUv + offset).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - offset).b;

      float vignette = smoothstep(0.92, 0.18, length(centered * vec2(1.0, 0.82)));
      color *= mix(1.0 - uVignette, 1.0, vignette);

      float noise = grainHash(gl_FragCoord.xy + fract(uTime * 7.31) * 517.0) - 0.5;
      color += noise * uGrain;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

function readStoredMode() {
  try {
    const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    return QUALITY_MODES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeMode(mode) {
  try {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable (private mode); the setting just won't persist.
  }
}

function readGpuName() {
  // Probe on a throwaway canvas: context attributes (antialias etc.) are
  // locked by the first getContext call, so never probe the real canvas.
  try {
    const gl = document.createElement('canvas').getContext('webgl2');

    if (!gl) {
      return '';
    }

    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)).toLowerCase() : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

function detectTierId() {
  const forced = new URLSearchParams(window.location.search).get('quality');

  if (forced && QUALITY_TIERS[forced]) {
    return forced;
  }

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = navigator.deviceMemory ?? 4;
  const coarse = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
  const gpu = readGpuName();

  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) {
    return 'low';
  }

  if (coarse) {
    return cores >= 8 && memory >= 6 ? 'medium' : 'low';
  }

  if (cores <= 2 || memory <= 2) {
    return 'low';
  }

  if (/intel/.test(gpu) && !/iris xe|arc/.test(gpu)) {
    return 'medium';
  }

  return 'high';
}

/**
 * Owns the WebGL renderer and the post-processing chain, and adapts the
 * render resolution / feature set to keep the frame rate smooth.
 */
export class RenderPipeline {
  constructor(canvas) {
    const storedMode = readStoredMode();
    const autoTierId = detectTierId();

    this.mode = storedMode ?? 'auto';
    this.autoTierId = autoTierId;
    const initialTier = QUALITY_TIERS[this.mode === 'auto' ? autoTierId : this.mode];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // Post-processed tiers get MSAA through the composer's render target, so
      // the default framebuffer only needs it when we render straight to screen.
      antialias: !initialTier.post,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDERER_CONFIG.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.supportsFloatTargets = this.renderer.capabilities.isWebGL2 !== false
      && this.renderer.extensions.has('EXT_color_buffer_float');

    this.composer = null;
    this.bloomPass = null;
    this.finishingPass = null;
    this.scene = null;
    this.camera = null;
    this.tier = initialTier;
    this.pixelRatio = 1;
    this.pixelRatioCeiling = Infinity;
    this.listeners = new Set();

    this.frameTime = 0;
    this.frameCount = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.lastStepDown = 0;

    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height);
  }

  get usePost() {
    return Boolean(this.composer && this.tier.post && this.supportsFloatTargets);
  }

  attach(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    if (this.supportsFloatTargets) {
      const target = new THREE.WebGLRenderTarget(this.width, this.height, {
        type: THREE.HalfFloatType,
        samples: 0,
      });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(scene, camera));

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        POST_CONFIG.bloomStrength,
        POST_CONFIG.bloomRadius,
        POST_CONFIG.bloomThreshold,
      );
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());

      this.finishingPass = new ShaderPass(FinishingShader);
      this.composer.addPass(this.finishingPass);
    }

    this.applyTier(this.tier, { force: true });
  }

  onTierChange(listener) {
    this.listeners.add(listener);
    listener(this.tier);
    return () => this.listeners.delete(listener);
  }

  getModeLabel() {
    if (this.mode === 'auto') {
      return `Auto · ${this.tier.label}`;
    }

    return this.tier.label;
  }

  cycleMode() {
    const index = QUALITY_MODES.indexOf(this.mode);
    this.setMode(QUALITY_MODES[(index + 1) % QUALITY_MODES.length]);
    return this.getModeLabel();
  }

  setMode(mode) {
    if (!QUALITY_MODES.includes(mode)) {
      return;
    }

    this.mode = mode;
    storeMode(mode);
    this.pixelRatioCeiling = Infinity;
    this.applyTier(QUALITY_TIERS[mode === 'auto' ? this.autoTierId : mode]);
  }

  applyTier(tier, { force = false } = {}) {
    const changed = force || tier.id !== this.tier.id;
    this.tier = tier;

    if (this.composer) {
      const samples = Math.min(tier.msaa, this.renderer.capabilities.maxSamples ?? 0);

      for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        if (target.samples !== samples) {
          target.samples = samples;
          target.dispose();
        }
      }

      this.bloomPass.enabled = tier.bloom;
    }

    this.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.maxPixelRatio));

    if (changed) {
      for (const listener of this.listeners) {
        listener(tier);
      }
    }
  }

  setPixelRatio(value) {
    const next = Math.round(value * 100) / 100;

    if (next === this.pixelRatio) {
      return;
    }

    this.pixelRatio = next;
    this.renderer.setPixelRatio(next);

    if (this.composer) {
      this.composer.setPixelRatio(next);
    }

    for (const listener of this.listeners) {
      listener(this.tier, { pixelRatioOnly: true });
    }
  }

  resize(width = window.innerWidth, height = window.innerHeight) {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height);

    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }

  /**
   * Dynamic resolution: watch the average frame rate in short windows and
   * nudge the pixel ratio (and, in auto mode, the whole tier) up or down.
   */
  sampleFrame(dt) {
    if (dt <= 0 || dt > 0.2 || document.hidden) {
      return;
    }

    this.frameTime += dt;
    this.frameCount += 1;

    if (this.frameTime < 1.25) {
      return;
    }

    const fps = this.frameCount / this.frameTime;
    this.frameTime = 0;
    this.frameCount = 0;

    const tier = this.tier;
    const maxRatio = Math.min(window.devicePixelRatio || 1, tier.maxPixelRatio, this.pixelRatioCeiling);

    if (fps < 47) {
      this.fastWindows = 0;
      this.slowWindows += 1;

      if (this.pixelRatio > tier.minPixelRatio + 0.01) {
        this.pixelRatioCeiling = Math.max(tier.minPixelRatio, this.pixelRatio - 0.05);
        this.setPixelRatio(Math.max(tier.minPixelRatio, this.pixelRatio * 0.85));
        return;
      }

      const now = performance.now();

      if (this.mode === 'auto' && this.slowWindows >= 3 && fps < 38 && now - this.lastStepDown > 4000) {
        const next = tier.id === 'high' ? 'medium' : tier.id === 'medium' ? 'low' : null;

        if (next) {
          this.lastStepDown = now;
          this.slowWindows = 0;
          this.autoTierId = next;
          this.pixelRatioCeiling = Infinity;
          this.applyTier(QUALITY_TIERS[next]);
        }
      }

      return;
    }

    this.slowWindows = 0;

    if (fps > 57) {
      this.fastWindows += 1;

      if (this.fastWindows >= 4 && this.pixelRatio < maxRatio - 0.01) {
        this.fastWindows = 0;
        this.setPixelRatio(Math.min(maxRatio, this.pixelRatio + 0.1));
      }
    }
  }

  async precompile() {
    if (!this.scene || !this.camera) {
      return;
    }

    try {
      if (this.renderer.compileAsync) {
        await this.renderer.compileAsync(this.scene, this.camera);
      } else {
        this.renderer.compile(this.scene, this.camera);
      }
    } catch (error) {
      console.warn('Shader precompile skipped:', error);
    }

    // Warm up the post chain (and its shaders) with one throwaway frame.
    this.render(0);
  }

  render(dt) {
    if (this.usePost) {
      this.finishingPass.uniforms.uTime.value += dt;
      this.composer.render(dt);
      return;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
