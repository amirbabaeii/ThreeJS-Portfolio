export const RENDERER_CONFIG = {
  maxPixelRatio: 1.5,
  toneMappingExposure: 1.12,
};

export const SCENE_CONFIG = {
  background: 0x030812,
  fogColor: 0x07111b,
  fogDensity: 0.0135,
  camera: {
    fov: 58,
    near: 0.1,
    far: 320,
  },
};

export const PLAYER_DEFAULTS = {
  startPosition: { x: 0, y: 1.2, z: 0 },
  facingAngle: Math.PI,
  radius: 0.55,
  height: 1.8,
  maxWalkSpeed: 7.4,
  maxSprintSpeed: 12.2,
  acceleration: 26,
  sprintAcceleration: 30,
  drag: 12,
  jumpSpeed: 8.2,
  gravity: 24,
};

export const CAMERA_DEFAULTS = {
  yaw: Math.PI,
  pitch: -0.28,
  minPitch: -0.58,
  maxPitch: -0.1,
  distance: 8.2,
  targetHeight: 1.55,
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
  roadHalfWidth: 18,
  minPlayerZ: -6,
  maxPlayerZPadding: 10,
  monumentSpacing: 24,
  firstMonumentZ: 18,
  contactStationZ: 4.4,
  finishPortalOffset: 16,
};
