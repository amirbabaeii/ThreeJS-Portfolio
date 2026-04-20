import './style.css';
import * as THREE from 'three';
import { heroProfile, milestones } from './cvData.js';

const canvas = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030812);
scene.fog = new THREE.FogExp2(0x07111b, 0.0135);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 320);

const ui = {
  loadingScreen: document.querySelector('#loadingScreen'),
  loadingBar: document.querySelector('#loadingBar'),
  loadingValue: document.querySelector('#loadingValue'),
  loadingLabel: document.querySelector('#loadingLabel'),
  startScreen: document.querySelector('#startScreen'),
  playButton: document.querySelector('#playButton'),
  finishScreen: document.querySelector('#finishScreen'),
  finishCopy: document.querySelector('#finishCopy'),
  restartButton: document.querySelector('#restartButton'),
  hud: document.querySelector('#hud'),
  progressValue: document.querySelector('#progressValue'),
  objectiveValue: document.querySelector('#objectiveValue'),
  detailEyebrow: document.querySelector('#detailEyebrow'),
  detailTitle: document.querySelector('#detailTitle'),
  detailMeta: document.querySelector('#detailMeta'),
  detailBullets: document.querySelector('#detailBullets'),
  interactionHint: document.querySelector('#interactionHint'),
  hintChip: document.querySelector('#hintChip'),
  toast: document.querySelector('#toast'),
  musicToggle: document.querySelector('#musicToggle'),
};

document.title = `${heroProfile.name} | Career Odyssey`;

const clock = new THREE.Clock();
const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const world = {
  interactives: [],
  monuments: [],
  contactStations: [],
  lights: [],
  pathPoints: [],
  beacon: null,
  finishPortal: null,
  finishGlow: null,
  particles: null,
  floorGrid: null,
};

const input = {
  forward: 0,
  strafe: 0,
  sprint: false,
  jumpQueued: false,
  interactQueued: false,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  keys: {
    KeyW: false,
    ArrowUp: false,
    KeyS: false,
    ArrowDown: false,
    KeyA: false,
    ArrowLeft: false,
    KeyD: false,
    ArrowRight: false,
  },
};

const state = {
  started: false,
  completed: false,
  nearest: null,
  hoveredMonument: null,
  nextIndex: 0,
  toastTimeout: null,
};

const player = {
  group: new THREE.Group(),
  visual: new THREE.Group(),
  body: null,
  head: null,
  leftArm: null,
  rightArm: null,
  leftLeg: null,
  rightLeg: null,
  shadow: null,
  velocity: new THREE.Vector3(),
  planarVelocity: new THREE.Vector3(),
  desiredVelocity: new THREE.Vector3(),
  position: new THREE.Vector3(0, 1.2, 0),
  facingAngle: Math.PI,
  onGround: true,
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

const cameraRig = {
  yaw: Math.PI,
  pitch: -0.28,
  distance: 8.2,
  desiredTarget: new THREE.Vector3(),
  target: new THREE.Vector3(),
  desiredPos: new THREE.Vector3(),
  pos: new THREE.Vector3(0, 5, 8),
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function dampVec(current, target, lambda, dt) {
  current.x = damp(current.x, target.x, lambda, dt);
  current.y = damp(current.y, target.y, lambda, dt);
  current.z = damp(current.z, target.z, lambda, dt);
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  if (state.toastTimeout) {
    clearTimeout(state.toastTimeout);
  }
  state.toastTimeout = window.setTimeout(() => {
    ui.toast.classList.remove('show');
  }, 1800);
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function makeCanvasTexture(drawFn, width = 1024, height = 512) {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  drawFn(ctx, width, height);
  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLabelSprite(title, subtitle, accent) {
  const texture = makeCanvasTexture((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(5, 10, 18, 0.88)';
    roundedRect(ctx, 18, 18, width - 36, height - 36, 36);
    ctx.fill();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    roundedRect(ctx, 18, 18, width - 36, height - 36, 36);
    ctx.stroke();

    ctx.fillStyle = '#eaf6ff';
    ctx.font = '700 60px Inter, Arial, sans-serif';
    ctx.fillText(title, 54, 120);

    ctx.fillStyle = '#a9c0d0';
    ctx.font = '500 30px Inter, Arial, sans-serif';
    ctx.fillText(subtitle, 54, 186);

    ctx.fillStyle = accent;
    ctx.font = '700 26px Inter, Arial, sans-serif';
    ctx.fillText('ENTER TO INSPECT', 54, 250);
  });

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6.6, 3.3, 1);
  return sprite;
}

const BRAND_MARKS = {
  linkedin: {
    viewBox: { width: 24, height: 24 },
    path: 'M21,21H17V14.25C17,13.19 15.81,12.31 14.75,12.31C13.69,12.31 13,13.19 13,14.25V21H9V9H13V11C13.66,9.93 15.36,9.24 16.5,9.24C19,9.24 21,11.28 21,13.75V21M7,21H3V9H7V21M5,3A2,2 0 0,1 7,5A2,2 0 0,1 5,7A2,2 0 0,1 3,5A2,2 0 0,1 5,3Z',
    background: '#0A66C2',
    foreground: '#FFFFFF',
    shape: 'square',
  },
  github: {
    viewBox: { width: 48, height: 48 },
    path: 'M23.928 1.15C11 1.15.514 11.638.514 24.566c0 10.343 6.75 19.105 15.945 22.265 1.148.144 1.58-.574 1.58-1.15v-4.02c-6.465 1.436-7.902-3.16-7.902-3.16-1.005-2.73-2.586-3.45-2.586-3.45-2.154-1.435.144-1.435.144-1.435 2.298.144 3.59 2.442 3.59 2.442 2.156 3.59 5.46 2.586 6.753 2.01.142-1.58.86-2.585 1.435-3.16-5.17-.574-10.63-2.585-10.63-11.635 0-2.585.862-4.596 2.442-6.32-.287-.575-1.005-3.017.288-6.177 0 0 2.01-.574 6.464 2.442 1.866-.574 3.877-.718 5.888-.718 2.01 0 4.022.286 5.89.717 4.453-3.016 6.464-2.442 6.464-2.442 1.293 3.16.43 5.602.287 6.177a9.29 9.29 0 0 1 2.44 6.32c0 9.05-5.458 10.918-10.63 11.492.863.718 1.58 2.155 1.58 4.31v6.464c0 .574.432 1.292 1.58 1.15 9.338-3.16 15.946-11.924 15.946-22.266-.143-12.785-10.63-23.27-23.558-23.27z',
    background: '#0D1117',
    foreground: '#FFFFFF',
    shape: 'circle',
  },
};

function drawBrandMark(ctx, spec, x, y, size) {
  const path = new Path2D(spec.path);
  const { width, height } = spec.viewBox;
  const scale = Math.min(size / width, size / height);
  const offsetX = x + (size - width * scale) * 0.5;
  const offsetY = y + (size - height * scale) * 0.5;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.fillStyle = spec.foreground;
  ctx.fill(path);
  ctx.restore();
}

function makeBrandIconTexture(link) {
  const spec = BRAND_MARKS[link.id];
  return makeCanvasTexture((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const halo = ctx.createRadialGradient(cx, cy, width * 0.06, cx, cy, width * 0.54);
    halo.addColorStop(0, 'rgba(255,255,255,0.16)');
    halo.addColorStop(0.45, 'rgba(255,255,255,0.04)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, width * 0.46, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 18;

    if (spec.shape === 'square') {
      ctx.fillStyle = spec.background;
      roundedRect(ctx, width * 0.16, height * 0.16, width * 0.68, height * 0.68, width * 0.14);
      ctx.fill();
      ctx.restore();

      drawBrandMark(ctx, spec, width * 0.26, height * 0.26, width * 0.48);
      return;
    }

    ctx.fillStyle = spec.background;
    ctx.beginPath();
    ctx.arc(cx, cy, width * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawBrandMark(ctx, spec, width * 0.24, height * 0.24, width * 0.52);
  }, 1024, 1024);
}

function make3DIconBadge(link) {
  const badge = new THREE.Group();
  const accent = new THREE.Color(link.accent);

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 1.82, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x111b2a, emissive: accent, emissiveIntensity: 0.18, metalness: 0.28, roughness: 0.34 }),
  );
  housing.castShadow = true;
  badge.add(housing);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.6, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x1b2a3d, emissive: accent, emissiveIntensity: 0.08, metalness: 0.32, roughness: 0.42 }),
  );
  bezel.position.z = 0.09;
  bezel.castShadow = true;
  badge.add(bezel);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.26, 1.46),
    new THREE.MeshBasicMaterial({ map: makeBrandIconTexture(link), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  screen.position.z = 0.123;
  badge.add(screen);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.24, 1.44),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }),
  );
  glass.position.z = 0.129;
  badge.add(glass);

  const backLight = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 1.32),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
  );
  backLight.position.z = -0.115;
  badge.add(backLight);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.56, 18),
    new THREE.MeshStandardMaterial({ color: 0x17253a, emissive: accent, emissiveIntensity: 0.12, metalness: 0.3, roughness: 0.4 }),
  );
  stem.position.set(0, -1.05, -0.03);
  stem.castShadow = true;
  badge.add(stem);

  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.5, 0.08, 28),
    new THREE.MeshStandardMaterial({ color: 0x0d1522, emissive: accent, emissiveIntensity: 0.18, metalness: 0.26, roughness: 0.35 }),
  );
  foot.position.set(0, -1.34, 0);
  foot.castShadow = true;
  badge.add(foot);

  const glow = new THREE.PointLight(accent, 3.6, 4.8, 2);
  glow.position.set(0, 0.18, 1.3);
  badge.add(glow);

  badge.rotation.x = -0.045;
  badge.userData = { glow, screen };
  return badge;
}

async function stage(progress, label, fn) {
  ui.loadingBar.style.width = `${progress}%`;
  ui.loadingValue.textContent = `${Math.round(progress)}%`;
  ui.loadingLabel.textContent = label;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  fn();
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function createSky() {
  const skyGeo = new THREE.SphereGeometry(180, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x16385c) },
      horizonColor: { value: new THREE.Color(0x091c31) },
      bottomColor: { value: new THREE.Color(0x02050b) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        float mid = smoothstep(-0.22, 0.25, h);
        vec3 color = mix(bottomColor, horizonColor, mid);
        color = mix(color, topColor, smoothstep(0.0, 0.9, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const starCount = 1500;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 250;
    positions[i * 3 + 1] = 12 + Math.random() * 90;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 250;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xe3f4ff, size: 0.34, opacity: 0.9, transparent: true, depthWrite: false });
  scene.add(new THREE.Points(starGeo, starMat));
}

function createLights() {
  const hemi = new THREE.HemisphereLight(0x8ccfff, 0x071016, 1.15);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xbfe3ff, 1.6);
  dir.position.set(8, 20, 10);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -34;
  dir.shadow.camera.right = 34;
  dir.shadow.camera.top = 34;
  dir.shadow.camera.bottom = -34;
  dir.shadow.camera.near = 0.1;
  dir.shadow.camera.far = 70;
  scene.add(dir);

  const rim = new THREE.PointLight(0x7dd3fc, 12, 80, 2);
  rim.position.set(0, 6, 26);
  scene.add(rim);
  world.lights.push(rim);
}

function createFloor() {
  const floorGeo = new THREE.CircleGeometry(90, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x07111a,
    metalness: 0.45,
    roughness: 0.74,
    emissive: 0x07111a,
    emissiveIntensity: 0.25,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(160, 80, 0x17334f, 0x0f1d2f);
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  scene.add(grid);
  world.floorGrid = grid;

  const roadGeo = new THREE.PlaneGeometry(12, 220, 1, 60);
  const positions = roadGeo.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = Math.sin(positions.getY(i) * 0.08) * 0.08 + Math.cos(x * 0.8) * 0.04;
    positions.setZ(i, y);
  }
  roadGeo.computeVertexNormals();

  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x0c1727,
    metalness: 0.35,
    roughness: 0.28,
    emissive: 0x10263c,
    emissiveIntensity: 0.28,
  });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.z = 100;
  road.receiveShadow = true;
  scene.add(road);

  const lineMat = new THREE.MeshBasicMaterial({ color: 0x79cfff, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 2; i += 1) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 200), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(i === 0 ? -3.15 : 3.15, 0.04, 100);
    scene.add(line);
  }

  const crystalGeo = new THREE.OctahedronGeometry(0.33, 0);
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x4dd3be, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.2 });
  const crystalGroup = new THREE.Group();
  for (let i = 0; i < 40; i += 1) {
    const mesh = new THREE.Mesh(crystalGeo, crystalMat);
    const side = i % 2 === 0 ? -1 : 1;
    mesh.position.set(side * (10 + Math.random() * 14), 0.65 + Math.random() * 2.8, 8 + i * 5.2 + Math.random() * 3);
    mesh.scale.setScalar(0.7 + Math.random() * 2.6);
    mesh.rotation.set(Math.random(), Math.random() * Math.PI, 0);
    crystalGroup.add(mesh);
  }
  scene.add(crystalGroup);
}

function createParticleField() {
  const count = 700;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 56;
    positions[i * 3 + 1] = 0.5 + Math.random() * 10;
    positions[i * 3 + 2] = Math.random() * 212;
    speeds[i] = 0.2 + Math.random() * 0.7;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
  const material = new THREE.PointsMaterial({
    color: 0x8ce2ff,
    size: 0.12,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  world.particles = points;
}

function createPlayer() {
  const materialBody = new THREE.MeshStandardMaterial({ color: 0xf5fbff, roughness: 0.22, metalness: 0.08, emissive: 0x183246, emissiveIntensity: 0.18 });
  const materialAccent = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.18, metalness: 0.35, emissive: 0x7dd3fc, emissiveIntensity: 0.42 });
  const materialDark = new THREE.MeshStandardMaterial({ color: 0x0d1724, roughness: 0.6, metalness: 0.2 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 1.1, 5, 10), materialBody);
  torso.castShadow = true;
  torso.position.y = 1.45;
  player.body = torso;
  player.visual.add(torso);

  const chestCore = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.08), materialAccent);
  chestCore.position.set(0, 1.55, 0.42);
  chestCore.castShadow = true;
  player.visual.add(chestCore);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), materialBody);
  head.position.y = 2.4;
  head.castShadow = true;
  player.head = head;
  player.visual.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.28), materialAccent);
  visor.position.set(0, 2.4, 0.14);
  visor.castShadow = true;
  player.visual.add(visor);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.75, 0.22), materialDark);
  backpack.position.set(0, 1.5, -0.34);
  backpack.castShadow = true;
  player.visual.add(backpack);

  const armGeo = new THREE.CapsuleGeometry(0.12, 0.72, 5, 8);
  const legGeo = new THREE.CapsuleGeometry(0.14, 0.92, 5, 8);

  player.leftArm = new THREE.Group();
  player.rightArm = new THREE.Group();
  player.leftLeg = new THREE.Group();
  player.rightLeg = new THREE.Group();

  const leftArmMesh = new THREE.Mesh(armGeo, materialBody);
  leftArmMesh.position.y = -0.4;
  leftArmMesh.castShadow = true;
  player.leftArm.add(leftArmMesh);
  player.leftArm.position.set(-0.52, 1.92, 0);

  const rightArmMesh = new THREE.Mesh(armGeo, materialBody);
  rightArmMesh.position.y = -0.4;
  rightArmMesh.castShadow = true;
  player.rightArm.add(rightArmMesh);
  player.rightArm.position.set(0.52, 1.92, 0);

  const leftLegMesh = new THREE.Mesh(legGeo, materialDark);
  leftLegMesh.position.y = -0.5;
  leftLegMesh.castShadow = true;
  player.leftLeg.add(leftLegMesh);
  player.leftLeg.position.set(-0.2, 0.95, 0);

  const rightLegMesh = new THREE.Mesh(legGeo, materialDark);
  rightLegMesh.position.y = -0.5;
  rightLegMesh.castShadow = true;
  player.rightLeg.add(rightLegMesh);
  player.rightLeg.position.set(0.2, 0.95, 0);

  player.visual.add(player.leftArm, player.rightArm, player.leftLeg, player.rightLeg);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.04, 12, 40), materialAccent);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.1;
  ring.castShadow = true;
  player.visual.add(ring);

  player.group.add(player.visual);
  player.group.position.copy(player.position);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.72, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  player.shadow = shadow;
  player.group.add(shadow);

  scene.add(player.group);
}

function createMonumentGeometry(category) {
  if (category === 'education') {
    return new THREE.CylinderGeometry(0.16, 0.46, 2.7, 5);
  }
  return new THREE.CapsuleGeometry(0.42, 1.5, 6, 10);
}

function createMonument(item, index) {
  const group = new THREE.Group();
  const side = index % 2 === 0 ? -1 : 1;
  const x = side * 7.7;
  const z = 18 + index * 24;
  group.position.set(x, 0, z);

  const accent = new THREE.Color(item.accent);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x132538, metalness: 0.45, roughness: 0.46 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6, roughness: 0.18, metalness: 0.22 });
  const statueMat = new THREE.MeshStandardMaterial({ color: 0xebf7ff, emissive: accent, emissiveIntensity: 0.15, roughness: 0.2, metalness: 0.08 });

  const dais = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.65, 1.05, 24), baseMat);
  dais.position.y = 0.52;
  dais.castShadow = true;
  dais.receiveShadow = true;
  group.add(dais);

  const trim = new THREE.Mesh(new THREE.TorusGeometry(1.58, 0.09, 12, 42), accentMat);
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 1.06;
  trim.castShadow = true;
  group.add(trim);

  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.1, 1.85, 6), baseMat);
  pillar.position.y = 1.5;
  pillar.castShadow = true;
  group.add(pillar);

  const statue = new THREE.Mesh(createMonumentGeometry(item.category), statueMat);
  statue.position.y = item.category === 'education' ? 3.55 : 3.35;
  statue.castShadow = true;
  group.add(statue);

  if (item.category === 'experience') {
    const crest = new THREE.Mesh(new THREE.TorusKnotGeometry(0.3, 0.09, 64, 8), accentMat);
    crest.position.set(0, 4.78, 0);
    crest.scale.setScalar(0.8);
    crest.castShadow = true;
    group.add(crest);
  } else {
    const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.44, 0), accentMat);
    crown.position.set(0, 5.1, 0);
    crown.castShadow = true;
    group.add(crown);
  }

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.85, 12, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 6.2;
  group.add(beam);

  const beacon = new THREE.PointLight(accent, 14, 18, 2);
  beacon.position.set(0, 5.8, 0);
  group.add(beacon);

  const label = makeLabelSprite(item.title, `${item.place} · ${item.period}`, item.accent);
  label.position.set(0, 7.8, 0);
  group.add(label);

  group.userData = {
    type: 'milestone',
    item,
    index,
    interactionRadius: 4.2,
    unlocked: false,
    beam,
    beacon,
    label,
    statue,
    homeY: statue.position.y,
  };

  scene.add(group);
  world.monuments.push(group);
  world.interactives.push(group);
}

function createContactStation(link, index) {
  const group = new THREE.Group();
  const x = index === 0 ? -5.2 : 5.2;
  const z = 4.4;
  group.position.set(x, 0, z);

  const accent = new THREE.Color(link.accent);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x101b2b, roughness: 0.28, metalness: 0.34, emissive: 0x0f1c2b, emissiveIntensity: 0.2 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.45, roughness: 0.15, metalness: 0.2 });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 1.02, 8), bodyMat);
  plinth.position.y = 0.52;
  plinth.castShadow = true;
  group.add(plinth);

  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.08, 16, 48), accentMat);
  trim.position.y = 1.02;
  trim.rotation.x = Math.PI / 2;
  trim.castShadow = true;
  group.add(trim);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(1.38, 1.65, 0.18), accentMat);
  screen.position.set(0, 1.95, 0.68);
  screen.castShadow = true;
  group.add(screen);

  const badge = make3DIconBadge(link);
  badge.position.set(0, 2.05, 0.98);
  group.add(badge);

  // Keep the stand orientation unchanged and simply mount the logo assembly on the front side.
  group.rotation.y = 0;

  const label = makeLabelSprite(link.label, link.description, link.accent);
  label.scale.set(4.6, 2.25, 1);
  label.position.set(0, 4.8, 0);
  group.add(label);

  const floorGlow = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 40),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = 0.03;
  group.add(floorGlow);

  group.userData = {
    type: 'link',
    label: link.label,
    url: link.url,
    description: link.description,
    interactionRadius: 3.2,
    labelSprite: label,
    holo: badge,
    floorGlow,
  };

  scene.add(group);
  world.contactStations.push(group);
  world.interactives.push(group);
}

function createFinishPortal() {
  const group = new THREE.Group();
  group.position.set(0, 0, 18 + milestones.length * 24 + 16);

  const ringMat = new THREE.MeshStandardMaterial({ color: 0xc084fc, emissive: 0xc084fc, emissiveIntensity: 0.6, roughness: 0.16, metalness: 0.3 });
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 16, 64), ringMat);
  outerRing.position.y = 3.5;
  outerRing.castShadow = true;
  group.add(outerRing);

  const innerPlane = new THREE.Mesh(
    new THREE.CircleGeometry(1.86, 40),
    new THREE.MeshBasicMaterial({ color: 0x91f3ff, transparent: true, opacity: 0.26, depthWrite: false }),
  );
  innerPlane.position.y = 3.5;
  group.add(innerPlane);

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 1, 32), new THREE.MeshStandardMaterial({ color: 0x111a28, emissive: 0x0e1623, emissiveIntensity: 0.24 }));
  pad.position.y = 0.5;
  pad.receiveShadow = true;
  pad.castShadow = true;
  group.add(pad);

  const glow = new THREE.PointLight(0xc084fc, 0, 18, 2);
  glow.position.y = 3.5;
  group.add(glow);

  group.visible = false;
  group.userData = {
    type: 'finish',
    interactionRadius: 4.6,
    outerRing,
    innerPlane,
  };

  scene.add(group);
  world.finishPortal = group;
  world.finishGlow = glow;
  world.interactives.push(group);
}

function buildWorld() {
  createSky();
  createLights();
  createFloor();
  createParticleField();
  createPlayer();
  milestones.forEach((item, index) => createMonument(item, index));
  heroProfile.links.forEach((link, index) => createContactStation(link, index));
  createFinishPortal();
}

function updateProgressText() {
  ui.progressValue.textContent = `${milestones.filter((item) => item.unlocked).length} / ${milestones.length}`;
}

function getUnlockedCount() {
  return milestones.filter((item) => item.unlocked).length;
}

function getNextMilestone() {
  return milestones.find((item) => !item.unlocked) || null;
}

function updateObjectiveText() {
  const next = getNextMilestone();
  if (next) {
    ui.objectiveValue.textContent = next.title;
    ui.hintChip.textContent = `Reach ${next.title} and press Enter.`;
    return;
  }
  ui.objectiveValue.textContent = state.completed ? 'Journey complete' : 'Enter the final gateway';
  ui.hintChip.textContent = state.completed ? 'Replay available from the end screen.' : 'The final gateway is active.';
}

function setDetailForSpawn() {
  ui.detailEyebrow.textContent = 'Spawn Point';
  ui.detailTitle.textContent = 'Launch Platform';
  ui.detailMeta.textContent = 'A cinematic review of Amir’s career. Move forward to begin.';
  ui.detailBullets.innerHTML = [
    'Inspect monuments to unlock chapters.',
    'Use Enter on the profile terminals to open LinkedIn or GitHub.',
    'Complete the journey and enter the final gateway.',
  ].map((item) => `<li>${item}</li>`).join('');
}

function setDetailForMilestone(item, index) {
  ui.detailEyebrow.textContent = item.category === 'education' ? 'Education Monument' : 'Experience Monument';
  ui.detailTitle.textContent = item.title;
  ui.detailMeta.textContent = `${item.place} · ${item.period} · Node ${index + 1}`;
  ui.detailBullets.innerHTML = item.bullets.map((bullet) => `<li>${bullet}</li>`).join('');
}

function setDetailForLink(target) {
  ui.detailEyebrow.textContent = 'Profile Terminal';
  ui.detailTitle.textContent = target.userData.label;
  ui.detailMeta.textContent = target.userData.description;
  ui.detailBullets.innerHTML = [`<li>Press Enter to open ${target.userData.label} in a new tab.</li>`];
}

function updateInteractionHint(target) {
  if (!target || !state.started || state.completed) {
    ui.interactionHint.classList.add('hidden');
    return;
  }
  if (target.userData.type === 'milestone' || target.userData.type === 'link' || target.userData.type === 'finish') {
    ui.interactionHint.classList.remove('hidden');
  } else {
    ui.interactionHint.classList.add('hidden');
  }
}

function unlockMilestone(target) {
  const item = target.userData.item;
  if (item.unlocked) {
    showToast(`${item.title} revisited`);
    return;
  }
  item.unlocked = true;
  target.userData.unlocked = true;
  music.playUnlock();
  showToast(`Unlocked: ${item.title}`);
  updateProgressText();
  updateObjectiveText();

  if (!getNextMilestone()) {
    world.finishPortal.visible = true;
    world.finishGlow.intensity = 22;
    music.playPortal();
    showToast('Final gateway unlocked');
  }
}

function interactWith(target) {
  if (!target) return;
  const type = target.userData.type;

  if (type === 'milestone') {
    setDetailForMilestone(target.userData.item, target.userData.index);
    unlockMilestone(target);
    return;
  }

  if (type === 'link') {
    setDetailForLink(target);
    music.playLink();
    window.open(target.userData.url, '_blank', 'noopener,noreferrer');
    showToast(`Opening ${target.userData.label}`);
    return;
  }

  if (type === 'finish' && world.finishPortal.visible) {
    state.completed = true;
    music.playPortal();
    ui.finishCopy.textContent = `${heroProfile.name}'s career route is fully unlocked. This world turns experience, education, and profile links into a memorable review instead of a flat PDF.`;
    ui.finishScreen.classList.remove('hidden');
    ui.finishScreen.classList.add('visible');
    ui.hud.classList.add('hidden');
    showToast('Journey complete');
  }
}

function findNearestInteractive() {
  let nearest = null;
  let bestDistSq = Infinity;
  for (const target of world.interactives) {
    if (target.userData.type === 'finish' && !world.finishPortal.visible) continue;
    const distSq = tmpVecA.copy(target.position).sub(player.position).lengthSq();
    const radius = target.userData.interactionRadius;
    if (distSq < radius * radius && distSq < bestDistSq) {
      bestDistSq = distSq;
      nearest = target;
    }
  }
  return nearest;
}

function updateNearestTarget() {
  const nearest = findNearestInteractive();
  state.nearest = nearest;
  updateInteractionHint(nearest);

  if (!nearest) {
    if (!state.hoveredMonument) setDetailForSpawn();
    return;
  }

  if (nearest.userData.type === 'milestone') {
    state.hoveredMonument = nearest;
    setDetailForMilestone(nearest.userData.item, nearest.userData.index);
  } else if (nearest.userData.type === 'link') {
    state.hoveredMonument = null;
    setDetailForLink(nearest);
  } else if (nearest.userData.type === 'finish') {
    state.hoveredMonument = null;
    ui.detailEyebrow.textContent = 'Final Gateway';
    ui.detailTitle.textContent = 'Exit Portal';
    ui.detailMeta.textContent = 'Press Enter to complete the experience.';
    ui.detailBullets.innerHTML = '<li>All monuments are cleared. Step through to finish.</li>';
  }
}

function updateBeacon(dt) {
  const next = getNextMilestone();
  if (!next) return;
  const target = world.monuments.find((group) => group.userData.item.id === next.id);
  if (!target) return;

  const beamTargetPos = tmpVecA.copy(target.position).add(new THREE.Vector3(0, 8.8, 0));
  if (!world.beacon) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 2.2, 16),
      new THREE.MeshBasicMaterial({ color: 0x90e9ff, transparent: true, opacity: 0.72, depthWrite: false }),
    );
    cone.rotation.x = Math.PI;
    scene.add(cone);
    world.beacon = cone;
  }
  world.beacon.position.lerp(beamTargetPos, 1 - Math.exp(-6 * dt));
  world.beacon.position.y += Math.sin(performance.now() * 0.0035) * 0.01;
}

function updateMonuments(time) {
  for (const group of world.monuments) {
    const { beacon, beam, label, statue, homeY, item } = group.userData;
    const t = time * 0.001 + group.userData.index * 0.4;
    beam.material.opacity = 0.12 + Math.sin(t * 1.8) * 0.03;
    beam.scale.y = 0.95 + Math.sin(t * 1.2) * 0.04;
    beacon.intensity = item.unlocked ? 18 : 12 + Math.sin(t * 3) * 2.4;
    label.position.y = 7.8 + Math.sin(t * 1.8) * 0.12;
    statue.position.y = homeY + Math.sin(t * 2.2) * 0.08;
    statue.rotation.y += 0.003;
  }

  for (const station of world.contactStations) {
    const t = time * 0.001;
    station.userData.holo.position.y = 2.02 + Math.sin(t * 1.6 + station.position.x) * 0.06;
    station.userData.holo.rotation.y = Math.sin(t * 0.8 + station.position.x * 0.1) * 0.14;
    station.userData.labelSprite.position.y = 4.8 + Math.sin(t * 2 + station.position.x) * 0.1;
    station.userData.floorGlow.material.opacity = 0.18 + Math.sin(t * 3 + station.position.x) * 0.05;
    if (station.userData.holo.userData?.glow) {
      station.userData.holo.userData.glow.intensity = 9 + Math.sin(t * 4 + station.position.x) * 2;
    }
  }

  if (world.finishPortal?.visible) {
    const t = time * 0.001;
    world.finishPortal.userData.outerRing.rotation.z = t * 0.9;
    world.finishPortal.userData.innerPlane.material.opacity = 0.22 + Math.sin(t * 4) * 0.06;
    world.finishGlow.intensity = 20 + Math.sin(t * 3) * 2;
  }
}

function updateParticles(dt) {
  if (!world.particles) return;
  const positions = world.particles.geometry.attributes.position;
  const speeds = world.particles.geometry.attributes.speed;
  for (let i = 0; i < positions.count; i += 1) {
    let y = positions.getY(i);
    y += speeds.array[i] * dt;
    if (y > 12) y = 0.6;
    positions.setY(i, y);
  }
  positions.needsUpdate = true;
}

function updatePlayer(dt) {
  const wasOnGround = player.onGround;
  const preGroundVelocityY = player.velocity.y;
  const forwardDir = new THREE.Vector3(Math.sin(cameraRig.yaw), 0, Math.cos(cameraRig.yaw));
  const rightDir = new THREE.Vector3(forwardDir.z, 0, -forwardDir.x);

  player.desiredVelocity.set(0, 0, 0);
  player.desiredVelocity.addScaledVector(forwardDir, input.forward);
  player.desiredVelocity.addScaledVector(rightDir, input.strafe);

  if (player.desiredVelocity.lengthSq() > 0.0001) {
    player.desiredVelocity.normalize();
  }

  const speed = input.sprint ? player.maxSprintSpeed : player.maxWalkSpeed;
  player.desiredVelocity.multiplyScalar(speed);
  const accel = input.sprint ? player.sprintAcceleration : player.acceleration;

  player.planarVelocity.x = damp(player.planarVelocity.x, player.desiredVelocity.x, accel, dt);
  player.planarVelocity.z = damp(player.planarVelocity.z, player.desiredVelocity.z, accel, dt);

  if (Math.abs(input.forward) < 0.01 && Math.abs(input.strafe) < 0.01) {
    player.planarVelocity.x = damp(player.planarVelocity.x, 0, player.drag, dt);
    player.planarVelocity.z = damp(player.planarVelocity.z, 0, player.drag, dt);
  }

  if (input.jumpQueued && player.onGround) {
    player.velocity.y = player.jumpSpeed;
    player.onGround = false;
    music.playJump();
  }
  input.jumpQueued = false;

  player.velocity.y -= player.gravity * dt;

  player.position.x += player.planarVelocity.x * dt;
  player.position.z += player.planarVelocity.z * dt;
  player.position.y += player.velocity.y * dt;

  const roadHalfWidth = 18;
  player.position.x = clamp(player.position.x, -roadHalfWidth, roadHalfWidth);
  player.position.z = clamp(player.position.z, -6, world.finishPortal.position.z + 10);

  const groundHeight = 1.2 + Math.sin(player.position.z * 0.08) * 0.04;
  if (player.position.y <= groundHeight) {
    player.position.y = groundHeight;
    player.velocity.y = 0;
    player.onGround = true;
    if (!wasOnGround && preGroundVelocityY < -2.4) {
      music.playLand(Math.min(1.35, Math.abs(preGroundVelocityY) / 8));
    }
  }

  const movementMag = Math.hypot(player.planarVelocity.x, player.planarVelocity.z);
  if (movementMag > 0.12) {
    const desiredAngle = Math.atan2(player.planarVelocity.x, player.planarVelocity.z);
    const delta = THREE.MathUtils.euclideanModulo(desiredAngle - player.facingAngle + Math.PI, Math.PI * 2) - Math.PI;
    player.facingAngle += delta * Math.min(1, dt * 12);
  }

  player.group.position.copy(player.position);
  player.visual.rotation.y = player.facingAngle;

  const runCycle = clock.elapsedTime * (input.sprint ? 13 : 8.5);
  const swing = movementMag > 0.18 ? Math.sin(runCycle) * Math.min(0.8, movementMag * 0.08) : 0;
  const bounce = movementMag > 0.18 ? Math.abs(Math.sin(runCycle * 1.2)) * (input.sprint ? 0.12 : 0.06) : 0;

  player.visual.position.y = bounce;
  player.leftArm.rotation.x = swing;
  player.rightArm.rotation.x = -swing;
  player.leftLeg.rotation.x = -swing;
  player.rightLeg.rotation.x = swing;
  player.head.rotation.y = Math.sin(clock.elapsedTime * 1.8) * 0.03;
  player.shadow.material.opacity = 0.16 + movementMag * 0.006;
  player.shadow.scale.setScalar(1 - bounce * 0.5);
}

function updateCamera(dt) {
  cameraRig.desiredTarget.set(player.position.x, player.position.y + 1.55, player.position.z);
  dampVec(cameraRig.target, cameraRig.desiredTarget, 10, dt);

  const pitch = clamp(cameraRig.pitch, -0.55, -0.12);
  const offset = new THREE.Vector3(
    Math.sin(cameraRig.yaw) * Math.cos(pitch),
    Math.sin(-pitch),
    Math.cos(cameraRig.yaw) * Math.cos(pitch),
  ).multiplyScalar(cameraRig.distance);

  cameraRig.desiredPos.copy(cameraRig.target).add(offset);
  dampVec(cameraRig.pos, cameraRig.desiredPos, 8, dt);

  camera.position.copy(cameraRig.pos);
  camera.lookAt(cameraRig.target);
}

function syncMovementAxes() {
  const forwardPressed = input.keys.KeyS || input.keys.ArrowDown;
  const backwardPressed = input.keys.KeyW || input.keys.ArrowUp;
  const leftPressed = input.keys.KeyA || input.keys.ArrowLeft;
  const rightPressed = input.keys.KeyD || input.keys.ArrowRight;

  input.forward = (forwardPressed ? 1 : 0) + (backwardPressed ? -1 : 0);
  input.strafe = (rightPressed ? 1 : 0) + (leftPressed ? -1 : 0);
}

function onKeyChange(event, pressed) {
  if (event.code in input.keys) {
    input.keys[event.code] = pressed;
    syncMovementAxes();
    return;
  }

  switch (event.code) {
    case 'ShiftLeft':
    case 'ShiftRight':
      input.sprint = pressed;
      break;
    case 'Space':
      if (pressed) input.jumpQueued = true;
      event.preventDefault();
      break;
    case 'Enter':
      if (pressed) input.interactQueued = true;
      break;
    case 'KeyM':
      if (pressed) music.toggle();
      break;
    default:
      break;
  }
}

function attachEvents() {
  window.addEventListener('keydown', (event) => {
    onKeyChange(event, true);
  });
  window.addEventListener('keyup', (event) => {
    onKeyChange(event, false);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  });

  canvas.addEventListener('pointerdown', (event) => {
    input.dragging = true;
    input.pointerX = event.clientX;
    input.pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!input.dragging) return;
    const dx = event.clientX - input.pointerX;
    const dy = event.clientY - input.pointerY;
    input.pointerX = event.clientX;
    input.pointerY = event.clientY;
    cameraRig.yaw -= dx * 0.006;
    cameraRig.pitch = clamp(cameraRig.pitch - dy * 0.004, -0.58, -0.1);
  });

  const stopDrag = () => {
    input.dragging = false;
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
}

class MusicSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.fxBus = null;
    this.compressor = null;
    this.started = false;
    this.enabled = true;
    this.nextPulse = 0;
    this.lastFootstep = 0;
    this.padLfos = [];
    this.baseGain = 0.44;
    this.noiseBuffer = null;
    this.bassOsc = null;
    this.bassGain = null;
  }

  updateButton() {
    if (!ui.musicToggle) return;
    ui.musicToggle.textContent = this.enabled ? 'Music On' : 'Music Off';
    ui.musicToggle.classList.toggle('is-muted', !this.enabled);
  }

  async ensureContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.ctx) {
      this.ctx = new AudioCtx();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0;

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 1.38;

      this.fxBus = this.ctx.createGain();
      this.fxBus.gain.value = 1.95;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -22;
      this.compressor.knee.value = 14;
      this.compressor.ratio.value = 3.5;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.18;

      this.musicBus.connect(this.master);
      this.fxBus.connect(this.master);
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return true;
  }

  async start() {
    const ok = await this.ensureContext();
    if (!ok) return;

    if (this.started) {
      this.applyMuteState();
      return;
    }

    this.startPad(174.61, 220.0, 261.63, 329.63);
    this.startBass();
    this.started = true;
    this.applyMuteState(true);
    this.updateButton();
  }

  async unlock() {
    await this.start();
  }

  applyMuteState(immediate = false) {
    if (!this.master || !this.ctx) return;
    const now = this.ctx.currentTime;
    const target = this.enabled ? this.baseGain : 0.0;
    if (immediate) {
      this.master.gain.setValueAtTime(target, now);
    } else {
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.linearRampToValueAtTime(target, now + 0.12);
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    this.applyMuteState();
    this.updateButton();
    showToast(this.enabled ? 'Music enabled' : 'Music muted');
    if (this.enabled) this.unlock();
  }

  startPad(...freqs) {
    if (!this.ctx || !this.musicBus) return;
    freqs.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      osc.type = index % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 580 + index * 95;
      gain.gain.value = 0.026 + index * 0.006;
      lfo.type = 'sine';
      lfo.frequency.value = 0.08 + index * 0.03;
      lfoGain.gain.value = 18 + index * 4;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicBus);
      osc.start();
      lfo.start();
      this.padLfos.push(lfo);
    });
  }

  startBass() {
    if (!this.ctx || !this.musicBus) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    gain.gain.value = 0.0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start();
    this.bassOsc = osc;
    this.bassGain = gain;
  }

  pulse(now, freq, length = 0.28, volume = 0.034, type = 'triangle', targetBus = this.musicBus) {
    if (!this.ctx || !targetBus) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    filter.type = 'lowpass';
    filter.frequency.value = 1600;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(targetBus);
    osc.start(now);
    osc.stop(now + length + 0.03);
  }

  getNoiseBuffer() {
    if (!this.ctx) return null;
    if (this.noiseBuffer) return this.noiseBuffer;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.0, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.7;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  noiseBurst(now, { volume = 0.035, duration = 0.12, lowpass = 900, highpass = 60 } = {}) {
    if (!this.ctx || !this.fxBus) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer();

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = highpass;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpass;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(hp);
    hp.connect(lp);
    lp.connect(gain);
    gain.connect(this.fxBus);
    source.start(now);
    source.stop(now + duration + 0.03);
  }

  footstep(now) {
    if (!this.ctx || !this.fxBus) return;
    if (now - this.lastFootstep < 0.16) return;
    this.lastFootstep = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(172, now);
    osc.frequency.exponentialRampToValueAtTime(72, now + 0.09);
    filter.type = 'bandpass';
    filter.frequency.value = 280;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.fxBus);
    osc.start(now);
    osc.stop(now + 0.12);
    this.noiseBurst(now, { volume: 0.018, duration: 0.06, lowpass: 420, highpass: 80 });
  }

  playJump() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    this.pulse(now, 330, 0.14, 0.05, 'square', this.fxBus);
    this.pulse(now + 0.04, 494, 0.16, 0.04, 'triangle', this.fxBus);
  }

  playLand(intensity = 1) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    this.pulse(now, 110, 0.12, 0.03 * intensity, 'sine', this.fxBus);
    this.noiseBurst(now, { volume: 0.03 * intensity, duration: 0.09, lowpass: 500, highpass: 50 });
  }

  playUnlock() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    this.pulse(now, 523.25, 0.16, 0.05, 'triangle', this.fxBus);
    this.pulse(now + 0.08, 659.25, 0.18, 0.05, 'triangle', this.fxBus);
    this.pulse(now + 0.16, 783.99, 0.24, 0.055, 'sawtooth', this.fxBus);
    this.noiseBurst(now + 0.05, { volume: 0.018, duration: 0.12, lowpass: 1800, highpass: 250 });
  }

  playLink() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    this.pulse(now, 392, 0.12, 0.04, 'square', this.fxBus);
    this.pulse(now + 0.06, 587.33, 0.18, 0.045, 'triangle', this.fxBus);
  }

  playPortal() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    [392, 523.25, 659.25, 783.99].forEach((freq, i) => {
      this.pulse(now + i * 0.08, freq, 0.32, 0.05 + i * 0.004, i % 2 ? 'triangle' : 'sawtooth', this.fxBus);
    });
    this.noiseBurst(now + 0.08, { volume: 0.028, duration: 0.26, lowpass: 2200, highpass: 180 });
  }

  update(movingFast) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const now = this.ctx.currentTime;

    if (this.bassGain) {
      const target = movingFast ? 0.09 : 0.04;
      this.bassGain.gain.cancelScheduledValues(now);
      this.bassGain.gain.linearRampToValueAtTime(target, now + 0.12);
    }

    if (now >= this.nextPulse) {
      const motif = [392.0, 523.25, 659.25, 523.25];
      const note = motif[Math.floor((now * 2) % motif.length)];
      this.pulse(now, note, 0.26, movingFast ? 0.048 : 0.036, movingFast ? 'sawtooth' : 'triangle');
      this.nextPulse = now + (movingFast ? 0.34 : 0.52);
    }

    if (movingFast) this.footstep(now);
  }
}

const music = new MusicSystem();
music.updateButton();

async function init() {
  attachEvents();
  await stage(10, 'Creating sky dome', createSky);
  await stage(22, 'Warming global lights', createLights);
  await stage(38, 'Laying the world floor', createFloor);
  await stage(52, 'Spawning particles', createParticleField);
  await stage(68, 'Assembling the player', createPlayer);
  await stage(86, 'Forging monuments', () => milestones.forEach((item, index) => createMonument(item, index)));
  await stage(94, 'Linking profile terminals', () => heroProfile.links.forEach((link, index) => createContactStation(link, index)));
  await stage(100, 'Opening the finale gateway', createFinishPortal);

  setDetailForSpawn();
  updateProgressText();
  updateObjectiveText();

  ui.loadingScreen.classList.add('hidden');
  ui.startScreen.classList.remove('hidden');
  ui.startScreen.classList.add('visible');
}

function restartGame() {
  milestones.forEach((item) => {
    item.unlocked = false;
  });
  state.completed = false;
  player.position.set(0, 1.2, 0);
  player.velocity.set(0, 0, 0);
  player.planarVelocity.set(0, 0, 0);
  cameraRig.yaw = Math.PI;
  cameraRig.pitch = -0.28;
  world.finishPortal.visible = false;
  world.finishGlow.intensity = 0;
  setDetailForSpawn();
  updateProgressText();
  updateObjectiveText();
  ui.finishScreen.classList.add('hidden');
  ui.hud.classList.remove('hidden');
}

ui.playButton.addEventListener('click', async () => {
  await music.start();
  ui.startScreen.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  state.started = true;
  showToast('Journey started · music live');
});

ui.restartButton.addEventListener('click', async () => {
  await music.start();
  restartGame();
});

if (ui.musicToggle) {
  ui.musicToggle.addEventListener('click', async () => {
    music.toggle();
    if (music.enabled) await music.unlock();
  });
}

window.addEventListener('pointerdown', () => {
  music.unlock();
}, { passive: true });

window.addEventListener('keydown', () => {
  if (state.started) music.unlock();
}, { passive: true });

function animate(time) {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state.started && !state.completed) {
    updatePlayer(dt);
    updateCamera(dt);
    updateNearestTarget();
    updateBeacon(dt);

    if (input.interactQueued) {
      interactWith(state.nearest);
    }
    input.interactQueued = false;

    const planarSpeed = Math.hypot(player.planarVelocity.x, player.planarVelocity.z);
    music.update(planarSpeed > 2.4 && player.onGround);
  } else {
    updateCamera(dt);
  }

  updateMonuments(time);
  updateParticles(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

init();
requestAnimationFrame(animate);
