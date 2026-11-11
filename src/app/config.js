export const RENDERER_CONFIG = {
  toneMappingExposure: 1.0,
};

/**
 * Graphics mode used on a first visit (before the visitor picks one with the
 * HUD button): 'low' | 'medium' | 'high' | 'auto'.
 */
export const DEFAULT_QUALITY_MODE = 'low';

/**
 * Graphics tiers. The QualityManager picks one at boot from device hints and
 * can step down at runtime when the frame rate stays low. Players can also
 * force a tier from the HUD.
 */
export const QUALITY_TIERS = {
  high: {
    id: 'high',
    label: 'High',
    maxPixelRatio: 2,
    minPixelRatio: 1,
    msaa: 4,
    post: true,
    bloom: true,
    shadows: true,
    shadowMapSize: 2048,
    grassDensity: 1,
    particleDensity: 1,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    maxPixelRatio: 1.5,
    minPixelRatio: 0.85,
    msaa: 2,
    post: true,
    bloom: true,
    shadows: true,
    shadowMapSize: 1024,
    grassDensity: 0.6,
    particleDensity: 0.65,
  },
  low: {
    id: 'low',
    label: 'Low',
    maxPixelRatio: 1,
    minPixelRatio: 0.65,
    msaa: 0,
    post: false,
    bloom: false,
    shadows: false,
    shadowMapSize: 512,
    grassDensity: 0.3,
    particleDensity: 0.4,
  },
};

// Tuned so High has the same average brightness as Low (no bloom) and only
// genuinely hot emissives glow, in a tight halo rather than a screen-wide haze.
export const POST_CONFIG = {
  bloomStrength: 0.35,
  bloomRadius: 0.2,
  bloomThreshold: 1.1,
  vignette: 0.38,
  grain: 0.015,
  aberration: 0.0016,
};

export const SCENE_CONFIG = {
  fogColor: 0x0b1530,
  fogDensity: 0.0098,
  camera: {
    fov: 58,
    near: 0.1,
    far: 900,
  },
};

export const PLAYER_DEFAULTS = {
  startPosition: { x: 0, y: 0, z: 0 },
  facingAngle: 0,
  radius: 0.45,
  height: 2.2,
  maxWalkSpeed: 7.4,
  maxSprintSpeed: 12.2,
  acceleration: 14,
  sprintAcceleration: 16,
  drag: 10,
  jumpSpeed: 8.6,
  gravity: 24,
  coyoteTime: 0.12,
};

export const CAMERA_DEFAULTS = {
  yaw: Math.PI,
  pitch: -0.3,
  minPitch: -0.95,
  maxPitch: -0.04,
  distance: 8.2,
  minDistance: 4.5,
  maxDistance: 13,
  targetHeight: 1.6,
  sprintFovBoost: 7,
  lookAhead: 1.4,
  orbitSensitivity: {
    x: 0.006,
    y: 0.004,
  },
};

export const RESTART_CINEMATIC = {
  duration: 3.6,
  arcHeight: 15,
  driftX: 5.5,
  targetLift: 4.2,
};

export const WORLD_LAYOUT = {
  roadHalfWidth: 6.5,
  playHalfWidth: 19,
  minPlayerZ: -8,
  maxPlayerZPadding: 10,
  monumentSpacing: 24,
  monumentOffsetX: 10,
  firstMonumentZ: 18,
  contactStationZ: 4.4,
  contactStationX: 4.4,
  finishPortalOffset: 16,
  lampSpacing: 12,
  lampOffsetX: 7.4,
};
