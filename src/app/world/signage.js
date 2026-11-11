import * as THREE from 'three';

let inputMode = 'keyboard';

/** Labels say "Tap" on touch devices and "Enter" elsewhere. */
export function setSignageInputMode(mode) {
  inputMode = mode === 'touch' ? 'touch' : 'keyboard';
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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData = { canvas, ctx };
  return texture;
}

/** Shrinks the font until the text fits, then draws it. */
function fitText(ctx, text, x, y, maxWidth, { weight = 700, size = 60, minSize = 26, family = 'Inter, "Segoe UI", system-ui, sans-serif' } = {}) {
  let fontSize = size;

  do {
    ctx.font = `${weight} ${fontSize}px ${family}`;

    if (ctx.measureText(text).width <= maxWidth) {
      break;
    }

    fontSize -= 2;
  } while (fontSize > minSize);

  let output = text;

  while (ctx.measureText(output).width > maxWidth && output.length > 4) {
    output = `${output.slice(0, -2)}…`;
  }

  ctx.fillText(output, x, y);
}

function drawLabelCard(ctx, width, height, { eyebrow, title, subtitle, accent, status }) {
  ctx.clearRect(0, 0, width, height);
  const pad = 22;
  const cardWidth = width - pad * 2;
  const cardHeight = height - pad * 2;

  // Outer glow.
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 26;
  roundedRect(ctx, pad, pad, cardWidth, cardHeight, 30);
  const background = ctx.createLinearGradient(0, pad, 0, pad + cardHeight);
  background.addColorStop(0, 'rgba(10, 18, 34, 0.94)');
  background.addColorStop(1, 'rgba(4, 8, 18, 0.9)');
  ctx.fillStyle = background;
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 3;
  ctx.strokeStyle = accent;
  roundedRect(ctx, pad, pad, cardWidth, cardHeight, 30);
  ctx.stroke();

  // Accent bar.
  const bar = ctx.createLinearGradient(0, pad + 30, 0, pad + cardHeight - 30);
  bar.addColorStop(0, accent);
  bar.addColorStop(1, 'rgba(255,255,255,0.15)');
  ctx.fillStyle = bar;
  roundedRect(ctx, pad + 26, pad + 34, 8, cardHeight - 68, 4);
  ctx.fill();

  const left = pad + 60;
  const textWidth = cardWidth - 90;

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  ctx.font = '700 26px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.letterSpacing = '6px';
  ctx.fillText(eyebrow.toUpperCase(), left, pad + 70);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#f1f8ff';
  fitText(ctx, title, left, pad + 150, textWidth, { size: 64, minSize: 34 });

  ctx.fillStyle = '#a9c0d6';
  fitText(ctx, subtitle, left, pad + 205, textWidth, { weight: 500, size: 32, minSize: 22 });

  if (status) {
    ctx.font = '800 24px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.letterSpacing = '4px';
    const chipText = status.text.toUpperCase();
    const chipWidth = ctx.measureText(chipText).width + 56;
    const chipY = pad + cardHeight - 76;
    roundedRect(ctx, left, chipY, chipWidth, 46, 23);
    ctx.fillStyle = status.filled ? accent : 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.fillStyle = status.filled ? '#06121c' : accent;
    ctx.fillText(chipText, left + 28, chipY + 32);
    ctx.letterSpacing = '0px';
  }
}

/**
 * Billboard info card. Returns a sprite whose `userData.update(next)` redraws
 * the card in place (used when a monument is unlocked).
 */
export function makeLabelSprite({ eyebrow, title, subtitle, accent, status = null }) {
  const content = { eyebrow, title, subtitle, accent, status };
  const texture = makeCanvasTexture((ctx, width, height) => drawLabelCard(ctx, width, height, content), 1024, 400);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6.8, 6.8 * (400 / 1024), 1);
  sprite.userData.update = (next) => {
    Object.assign(content, next);
    const { canvas, ctx } = texture.userData;
    drawLabelCard(ctx, canvas.width, canvas.height, content);
    texture.needsUpdate = true;
  };
  return sprite;
}

export function inspectStatus() {
  return { text: inputMode === 'touch' ? '◆ Tap to inspect' : '◆ Enter to inspect', filled: false };
}

export function unlockedStatus() {
  return { text: '✓ Unlocked', filled: true };
}

/** Small "CHAPTER 03" plate floating on top of each arch. */
export function makeChapterSprite(text, accent) {
  const texture = makeCanvasTexture((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(6, 12, 24, 0.82)';
    roundedRect(ctx, 8, 8, width - 16, height - 16, 26);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = '800 44px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.letterSpacing = '10px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2 + 5, height / 2 + 2);
  }, 512, 112);

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(3.4, 3.4 * (112 / 512), 1);
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

    if (!spec) {
      return;
    }

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
  }, 512, 512);
}

export function make3DIconBadge(link) {
  const badge = new THREE.Group();
  const accent = new THREE.Color(link.accent);

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 1.82, 0.22),
    new THREE.MeshStandardMaterial({
      color: 0x111b2a,
      emissive: accent,
      emissiveIntensity: 0.25,
      metalness: 0.7,
      roughness: 0.28,
    }),
  );
  housing.castShadow = true;
  badge.add(housing);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.6, 0.06),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.05,
      metalness: 0.3,
      roughness: 0.4,
    }),
  );
  bezel.position.z = 0.09;
  badge.add(bezel);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.32, 1.52),
    new THREE.MeshBasicMaterial({
      map: makeBrandIconTexture(link),
      transparent: true,
      depthWrite: false,
      color: new THREE.Color(1.1, 1.1, 1.1),
    }),
  );
  screen.position.z = 0.125;
  badge.add(screen);

  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(1.32, 1.52),
    new THREE.MeshBasicMaterial({ color: 0x050a12 }),
  );
  backing.position.z = 0.122;
  badge.add(backing);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.56, 18),
    new THREE.MeshStandardMaterial({ color: 0x17253a, metalness: 0.8, roughness: 0.3 }),
  );
  stem.position.set(0, -1.05, -0.03);
  stem.castShadow = true;
  badge.add(stem);

  badge.rotation.x = -0.045;
  badge.userData = { screen, bezel };
  return badge;
}
