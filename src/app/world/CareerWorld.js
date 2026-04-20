import * as THREE from 'three';
import { WORLD_LAYOUT } from '../config.js';
import { make3DIconBadge, makeLabelSprite } from './signage.js';

function createMonumentGeometry(category) {
  if (category === 'education') {
    return new THREE.CylinderGeometry(0.16, 0.46, 2.7, 5);
  }

  return new THREE.CapsuleGeometry(0.42, 1.5, 6, 10);
}

export class CareerWorld {
  constructor({ scene, heroProfile, milestones }) {
    this.scene = scene;
    this.heroProfile = heroProfile;
    this.milestones = milestones;
    this.interactives = [];
    this.monuments = [];
    this.contactStations = [];
    this.monumentById = new Map();
    this.beacon = null;
    this.finishPortal = null;
    this.finishGlow = null;
    this.particles = null;
    this.tmpVec = new THREE.Vector3();
    this.beaconTarget = new THREE.Vector3();
  }

  createSky() {
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

    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    const starCount = 1500;
    const positions = new Float32Array(starCount * 3);

    for (let index = 0; index < starCount; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 250;
      positions[index * 3 + 1] = 12 + Math.random() * 90;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 250;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xe3f4ff,
      size: 0.34,
      opacity: 0.9,
      transparent: true,
      depthWrite: false,
    });
    this.scene.add(new THREE.Points(starGeo, starMat));
  }

  createLights() {
    const hemisphere = new THREE.HemisphereLight(0x8ccfff, 0x071016, 1.15);
    this.scene.add(hemisphere);

    const directional = new THREE.DirectionalLight(0xbfe3ff, 1.6);
    directional.position.set(8, 20, 10);
    directional.castShadow = true;
    directional.shadow.mapSize.set(1024, 1024);
    directional.shadow.camera.left = -34;
    directional.shadow.camera.right = 34;
    directional.shadow.camera.top = 34;
    directional.shadow.camera.bottom = -34;
    directional.shadow.camera.near = 0.1;
    directional.shadow.camera.far = 70;
    this.scene.add(directional);

    const rim = new THREE.PointLight(0x7dd3fc, 12, 80, 2);
    rim.position.set(0, 6, 26);
    this.scene.add(rim);
  }

  createFloor() {
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
    this.scene.add(floor);

    const grid = new THREE.GridHelper(160, 80, 0x17334f, 0x0f1d2f);
    grid.position.y = 0.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.34;
    this.scene.add(grid);

    const roadGeo = new THREE.PlaneGeometry(12, 220, 1, 60);
    const positions = roadGeo.attributes.position;

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = Math.sin(positions.getY(index) * 0.08) * 0.08 + Math.cos(x * 0.8) * 0.04;
      positions.setZ(index, y);
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
    this.scene.add(road);

    const lineMat = new THREE.MeshBasicMaterial({ color: 0x79cfff, transparent: true, opacity: 0.85 });

    for (let index = 0; index < 2; index += 1) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 200), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(index === 0 ? -3.15 : 3.15, 0.04, 100);
      this.scene.add(line);
    }

    const crystalGeo = new THREE.OctahedronGeometry(0.33, 0);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x5eead4,
      emissive: 0x4dd3be,
      emissiveIntensity: 0.9,
      roughness: 0.25,
      metalness: 0.2,
    });
    const crystalGroup = new THREE.Group();

    for (let index = 0; index < 40; index += 1) {
      const mesh = new THREE.Mesh(crystalGeo, crystalMat);
      const side = index % 2 === 0 ? -1 : 1;
      mesh.position.set(
        side * (10 + Math.random() * 14),
        0.65 + Math.random() * 2.8,
        8 + index * 5.2 + Math.random() * 3,
      );
      mesh.scale.setScalar(0.7 + Math.random() * 2.6);
      mesh.rotation.set(Math.random(), Math.random() * Math.PI, 0);
      crystalGroup.add(mesh);
    }

    this.scene.add(crystalGroup);
  }

  createParticleField() {
    const count = 700;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 56;
      positions[index * 3 + 1] = 0.5 + Math.random() * 10;
      positions[index * 3 + 2] = Math.random() * 212;
      speeds[index] = 0.2 + Math.random() * 0.7;
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

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  createMonuments() {
    this.milestones.forEach((item, index) => {
      const group = new THREE.Group();
      const side = index % 2 === 0 ? -1 : 1;
      const x = side * 7.7;
      const z = WORLD_LAYOUT.firstMonumentZ + index * WORLD_LAYOUT.monumentSpacing;
      group.position.set(x, 0, z);

      const accent = new THREE.Color(item.accent);
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x132538, metalness: 0.45, roughness: 0.46 });
      const accentMat = new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 0.6,
        roughness: 0.18,
        metalness: 0.22,
      });
      const statueMat = new THREE.MeshStandardMaterial({
        color: 0xebf7ff,
        emissive: accent,
        emissiveIntensity: 0.15,
        roughness: 0.2,
        metalness: 0.08,
      });

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
        new THREE.MeshBasicMaterial({
          color: accent,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
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
        interactionRadius: 4.2,
        beam,
        beacon,
        label,
        statue,
        homeY: statue.position.y,
      };

      this.scene.add(group);
      this.monuments.push(group);
      this.monumentById.set(item.id, group);
      this.interactives.push(group);
    });
  }

  createContactStations() {
    this.heroProfile.links.forEach((link, index) => {
      const group = new THREE.Group();
      const x = index === 0 ? -5.2 : 5.2;
      group.position.set(x, 0, WORLD_LAYOUT.contactStationZ);

      const accent = new THREE.Color(link.accent);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x101b2b,
        roughness: 0.28,
        metalness: 0.34,
        emissive: 0x0f1c2b,
        emissiveIntensity: 0.2,
      });
      const accentMat = new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 0.45,
        roughness: 0.15,
        metalness: 0.2,
      });

      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 1.02, 8), bodyMat);
      plinth.position.y = 0.52;
      plinth.castShadow = true;
      group.add(plinth);

      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.08, 16, 48), accentMat);
      trim.position.y = 1.02;
      trim.rotation.x = Math.PI / 2;
      trim.castShadow = true;
      group.add(trim);

      const badge = make3DIconBadge(link);
      badge.position.set(0, 2.5, 0);
      group.add(badge);

      const label = makeLabelSprite(link.label, link.description, link.accent);
      label.scale.set(4.6, 2.25, 1);
      label.position.set(0, 4.8, 0);
      group.add(label);

      const floorGlow = new THREE.Mesh(
        new THREE.CircleGeometry(1.35, 40),
        new THREE.MeshBasicMaterial({
          color: accent,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        }),
      );
      floorGlow.rotation.x = -Math.PI / 2;
      floorGlow.position.y = 0.03;
      group.add(floorGlow);

      group.userData = {
        type: 'link',
        link,
        interactionRadius: 3.2,
        labelSprite: label,
        holo: badge,
        holoBasePosition: badge.position.clone(),
        baseRotationY: Math.PI,
        labelBaseY: label.position.y,
        floorGlowBaseOpacity: floorGlow.material.opacity,
        floorGlow,
      };

      this.scene.add(group);
      this.contactStations.push(group);
      this.interactives.push(group);
    });
  }

  createFinishPortal() {
    const group = new THREE.Group();
    group.position.set(
      0,
      0,
      WORLD_LAYOUT.firstMonumentZ +
        this.milestones.length * WORLD_LAYOUT.monumentSpacing +
        WORLD_LAYOUT.finishPortalOffset,
    );

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc,
      emissive: 0xc084fc,
      emissiveIntensity: 0.6,
      roughness: 0.16,
      metalness: 0.3,
    });
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 16, 64), ringMat);
    outerRing.position.y = 3.5;
    outerRing.castShadow = true;
    group.add(outerRing);

    const innerPlane = new THREE.Mesh(
      new THREE.CircleGeometry(1.86, 40),
      new THREE.MeshBasicMaterial({
        color: 0x91f3ff,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      }),
    );
    innerPlane.position.y = 3.5;
    group.add(innerPlane);

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 4.2, 1, 32),
      new THREE.MeshStandardMaterial({
        color: 0x111a28,
        emissive: 0x0e1623,
        emissiveIntensity: 0.24,
      }),
    );
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

    this.scene.add(group);
    this.finishPortal = group;
    this.finishGlow = glow;
    this.interactives.push(group);
  }

  getUnlockedCount() {
    return this.milestones.filter((item) => item.unlocked).length;
  }

  getNextMilestone() {
    return this.milestones.find((item) => !item.unlocked) ?? null;
  }

  getMaxPlayerZ() {
    return this.finishPortal?.position.z ?? 0;
  }

  unlockMilestone(target) {
    const milestone = target.userData.item;

    if (milestone.unlocked) {
      return false;
    }

    milestone.unlocked = true;
    return true;
  }

  setFinishPortalActive(active) {
    if (!this.finishPortal || !this.finishGlow) {
      return;
    }

    this.finishPortal.visible = active;
    this.finishGlow.intensity = active ? 22 : 0;
  }

  reset() {
    this.milestones.forEach((item) => {
      item.unlocked = false;
    });
    this.setFinishPortalActive(false);
  }

  getNearestInteractive(position) {
    let nearest = null;
    let bestDistanceSquared = Infinity;

    for (const target of this.interactives) {
      if (target.userData.type === 'finish' && !this.finishPortal?.visible) {
        continue;
      }

      const radius = target.userData.interactionRadius;
      const distanceSquared = this.tmpVec.copy(target.position).sub(position).lengthSq();

      if (distanceSquared < radius * radius && distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        nearest = target;
      }
    }

    return nearest;
  }

  updateBeacon(dt, nextMilestone) {
    if (!nextMilestone) {
      if (this.beacon) {
        this.beacon.visible = false;
      }
      return;
    }

    const target = this.monumentById.get(nextMilestone.id);

    if (!target) {
      return;
    }

    if (!this.beacon) {
      this.beacon = new THREE.Mesh(
        new THREE.ConeGeometry(0.7, 2.2, 16),
        new THREE.MeshBasicMaterial({
          color: 0x90e9ff,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        }),
      );
      this.beacon.rotation.x = Math.PI;
      this.scene.add(this.beacon);
    }

    this.beacon.visible = true;
    this.beaconTarget.set(target.position.x, target.position.y + 8.8, target.position.z);
    this.beacon.position.lerp(this.beaconTarget, 1 - Math.exp(-6 * dt));
    this.beacon.position.y += Math.sin(performance.now() * 0.0035) * 0.01;
  }

  updateMonuments(time) {
    for (const group of this.monuments) {
      const { item, beam, beacon, label, statue, homeY } = group.userData;
      const t = time * 0.001 + item.index * 0.4;
      beam.material.opacity = 0.12 + Math.sin(t * 1.8) * 0.03;
      beam.scale.y = 0.95 + Math.sin(t * 1.2) * 0.04;
      beacon.intensity = item.unlocked ? 18 : 12 + Math.sin(t * 3) * 2.4;
      label.position.y = 7.8 + Math.sin(t * 1.8) * 0.12;
      statue.position.y = homeY + Math.sin(t * 2.2) * 0.08;
      statue.rotation.y += 0.003;
    }

    for (const station of this.contactStations) {
      const t = time * 0.001;
      station.userData.holo.position.y =
        station.userData.holoBasePosition.y + Math.sin(t * 1.6 + station.position.x) * 0.06;
      station.userData.holo.rotation.y =
        station.userData.baseRotationY + Math.sin(t * 0.8 + station.position.x * 0.1) * 0.14;
      station.userData.labelSprite.position.y =
        station.userData.labelBaseY + Math.sin(t * 2 + station.position.x) * 0.1;
      station.userData.floorGlow.material.opacity =
        station.userData.floorGlowBaseOpacity + Math.sin(t * 3 + station.position.x) * 0.05;

      if (station.userData.holo.userData?.glow) {
        station.userData.holo.userData.glow.intensity = 9 + Math.sin(t * 4 + station.position.x) * 2;
      }
    }

    if (this.finishPortal?.visible) {
      const t = time * 0.001;
      this.finishPortal.userData.outerRing.rotation.z = t * 0.9;
      this.finishPortal.userData.innerPlane.material.opacity = 0.22 + Math.sin(t * 4) * 0.06;
      this.finishGlow.intensity = 20 + Math.sin(t * 3) * 2;
    }
  }

  updateParticles(dt) {
    if (!this.particles) {
      return;
    }

    const positions = this.particles.geometry.attributes.position;
    const speeds = this.particles.geometry.attributes.speed;

    for (let index = 0; index < positions.count; index += 1) {
      let y = positions.getY(index);
      y += speeds.array[index] * dt;

      if (y > 12) {
        y = 0.6;
      }

      positions.setY(index, y);
    }

    positions.needsUpdate = true;
  }

  updateAnimations({ time, dt, nextMilestone }) {
    this.updateBeacon(dt, nextMilestone);
    this.updateMonuments(time);
    this.updateParticles(dt);
  }
}
