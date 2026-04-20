import * as THREE from 'three';

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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeLabelSprite(title, subtitle, accent) {
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

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
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
  const scale = Math.min(size / spec.viewBox.width, size / spec.viewBox.height);
  const offsetX = x + (size - spec.viewBox.width * scale) * 0.5;
  const offsetY = y + (size - spec.viewBox.height * scale) * 0.5;

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

export function make3DIconBadge(link) {
  const badge = new THREE.Group();
  const accent = new THREE.Color(link.accent);

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 1.82, 0.22),
    new THREE.MeshStandardMaterial({
      color: 0x111b2a,
      emissive: accent,
      emissiveIntensity: 0.18,
      metalness: 0.28,
      roughness: 0.34,
    }),
  );
  housing.castShadow = true;
  badge.add(housing);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.6, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0x1b2a3d,
      emissive: accent,
      emissiveIntensity: 0.08,
      metalness: 0.32,
      roughness: 0.42,
    }),
  );
  bezel.position.z = 0.09;
  bezel.castShadow = true;
  badge.add(bezel);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.26, 1.46),
    new THREE.MeshBasicMaterial({
      map: makeBrandIconTexture(link),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  screen.position.z = 0.123;
  badge.add(screen);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.24, 1.44),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  glass.position.z = 0.129;
  badge.add(glass);

  const backLight = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 1.32),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  backLight.position.z = -0.115;
  badge.add(backLight);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.56, 18),
    new THREE.MeshStandardMaterial({
      color: 0x17253a,
      emissive: accent,
      emissiveIntensity: 0.12,
      metalness: 0.3,
      roughness: 0.4,
    }),
  );
  stem.position.set(0, -1.05, -0.03);
  stem.castShadow = true;
  badge.add(stem);

  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.5, 0.08, 28),
    new THREE.MeshStandardMaterial({
      color: 0x0d1522,
      emissive: accent,
      emissiveIntensity: 0.18,
      metalness: 0.26,
      roughness: 0.35,
    }),
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
