import * as THREE from 'three';
import { createCareerRuntime } from './data/createCareerRuntime.js';
import { CameraController } from './systems/CameraController.js';
import { InputController } from './systems/InputController.js';
import { MusicSystem } from './systems/MusicSystem.js';
import { PlayerController } from './systems/PlayerController.js';
import { AppUI } from './ui/AppUI.js';
import { CareerWorld } from './world/CareerWorld.js';
import {
  PLAYER_DEFAULTS,
  RENDERER_CONFIG,
  RESTART_CINEMATIC,
  SCENE_CONFIG,
} from './config.js';

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

function easeInOutCubic(value) {
  if (value < 0.5) {
    return 4 * value * value * value;
  }

  return 1 - ((-2 * value + 2) ** 3) / 2;
}

export class CareerOdysseyApp {
  constructor(root = document) {
    const { heroProfile, milestones } = createCareerRuntime();

    this.heroProfile = heroProfile;
    this.milestones = milestones;
    this.ui = new AppUI(root);
    this.ui.hydrate(heroProfile);

    this.renderer = this.createRenderer(this.ui.canvas);
    this.scene = this.createScene();
    this.camera = new THREE.PerspectiveCamera(
      SCENE_CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      SCENE_CONFIG.camera.near,
      SCENE_CONFIG.camera.far,
    );

    this.clock = new THREE.Clock();
    this.state = {
      started: false,
      completed: false,
      nearest: null,
      hoveredMonument: null,
      restartCinematic: null,
      inspectedTarget: null,
    };
    this.restartSpawnPosition = new THREE.Vector3(
      PLAYER_DEFAULTS.startPosition.x,
      PLAYER_DEFAULTS.startPosition.y,
      PLAYER_DEFAULTS.startPosition.z,
    );
    this.tmpCinematicPosition = new THREE.Vector3();
    this.tmpCinematicTarget = new THREE.Vector3();
    this.targetCheckAccumulator = 0;
    this.targetCheckInterval = 1 / 16;

    this.world = new CareerWorld({
      scene: this.scene,
      heroProfile: this.heroProfile,
      milestones: this.milestones,
    });
    this.player = new PlayerController(this.scene);
    this.cameraController = new CameraController(this.camera);
    this.music = new MusicSystem({
      onStateChange: (enabled) => this.ui.setMusicEnabled(enabled),
      onToast: (message) => this.ui.showToast(message),
    });
    this.input = new InputController({
      canvas: this.ui.canvas,
      onOrbit: (dx, dy) => this.cameraController.applyOrbit(dx, dy),
      onToggleMusic: () => this.music.toggle(),
      mobile: {
        joystick: this.ui.joystick,
        knob: this.ui.joystickKnob,
        sprintButton: this.ui.sprintButton,
        jumpButton: this.ui.jumpButton,
      },
    });

    if (this.isTouchDevice()) {
      document.body.classList.add('is-touch');
    }

    this.handleResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER_CONFIG.maxPixelRatio));
    };

    this.ui.bindPlay(async () => {
      await this.startJourney();
    });
    this.ui.bindRestart(async () => {
      await this.restartJourney();
    });
    this.ui.bindMusicToggle(() => {
      this.music.toggle();
    });
    this.ui.bindDetailsClose(() => {
      this.ui.closeDetails();
    });
    this.ui.bindInspectPrompt(() => {
      this.input.queueInteract();
    });
    this.ui.setMusicEnabled(this.music.enabled);

    window.addEventListener('resize', this.handleResize);
    window.addEventListener(
      'pointerdown',
      () => {
        void this.music.unlock();
      },
      { passive: true },
    );
    window.addEventListener('keydown', () => {
      if (this.state.started) {
        void this.music.unlock();
      }
    });
  }

  isTouchDevice() {
    if (typeof window === 'undefined') return false;
    const coarsePointer = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
    const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
    return Boolean(coarsePointer || hasTouch);
  }

  createRenderer(canvas) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER_CONFIG.maxPixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDERER_CONFIG.toneMappingExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    return renderer;
  }

  createScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SCENE_CONFIG.background);
    scene.fog = new THREE.FogExp2(SCENE_CONFIG.fogColor, SCENE_CONFIG.fogDensity);
    return scene;
  }

  async runStage(progress, label, action) {
    this.ui.updateLoading(progress, label);
    await nextFrame();
    action();
    await nextFrame();
  }

  async init() {
    const stages = [
      { progress: 10, label: 'Creating sky dome', action: () => this.world.createSky() },
      { progress: 22, label: 'Warming global lights', action: () => this.world.createLights() },
      { progress: 38, label: 'Laying the world floor', action: () => this.world.createFloor() },
      { progress: 52, label: 'Spawning particles', action: () => this.world.createParticleField() },
      { progress: 68, label: 'Assembling the player', action: () => this.player.build() },
      { progress: 86, label: 'Forging monuments', action: () => this.world.createMonuments() },
      { progress: 94, label: 'Linking profile terminals', action: () => this.world.createContactStations() },
      { progress: 100, label: 'Opening the finale gateway', action: () => this.world.createFinishPortal() },
    ];

    for (const stage of stages) {
      await this.runStage(stage.progress, stage.label, stage.action);
    }

    this.cameraController.reset(this.player.position);
    this.ui.setSpawnDetails();
    this.refreshProgress();
    this.refreshObjective();
    this.ui.showStartScreen();
    requestAnimationFrame((time) => this.animate(time));
  }

  async startJourney() {
    await this.music.start();
    this.input.clearQueuedActions();
    this.state.started = true;
    this.state.completed = false;
    this.ui.hideStartScreen();
    this.ui.showHud();
    this.ui.showToast('Journey started · music live');
  }

  async restartJourney() {
    if (this.state.restartCinematic) {
      return;
    }

    await this.music.start();
    this.ui.hideFinish();
    this.ui.hideHud();
    this.ui.setInteractionHintVisible(false);
    this.beginRestartCinematic();
    this.ui.showToast('Flying back to the start line');
  }

  refreshProgress() {
    this.ui.updateProgress(this.world.getUnlockedCount(), this.milestones.length);
  }

  refreshObjective() {
    const nextMilestone = this.world.getNextMilestone();

    if (nextMilestone) {
      this.ui.updateObjective(nextMilestone.title, `Reach ${nextMilestone.title} and press Enter.`);
      return;
    }

    if (this.state.completed) {
      this.ui.updateObjective('Journey complete', 'Replay available from the end screen.');
      return;
    }

    this.ui.updateObjective('Enter the final gateway', 'The final gateway is active.');
  }

  getFinishCopy() {
    return `${this.heroProfile.name}'s career route is fully unlocked. This world turns experience, education, and profile links into a memorable review instead of a flat PDF.`;
  }

  updateNearestTarget() {
    this.state.nearest = this.world.getNearestInteractive(this.player.position);
    const canInteract = Boolean(this.state.nearest && this.state.started && !this.state.completed);
    this.ui.setInteractionHintVisible(canInteract);

    if (!this.state.nearest) {
      if (!this.state.hoveredMonument) {
        this.ui.setSpawnDetails();
      }
      return;
    }

    if (this.state.nearest.userData.type === 'milestone') {
      this.state.hoveredMonument = this.state.nearest;
      this.ui.setMilestoneDetails(this.state.nearest.userData.item);
      return;
    }

    this.state.hoveredMonument = null;

    if (this.state.nearest.userData.type === 'link') {
      this.ui.setLinkDetails(this.state.nearest.userData.link);
      return;
    }

    if (this.state.nearest.userData.type === 'finish') {
      this.ui.setFinishDetails();
    }
  }

  updateInspectionDismiss() {
    const inspected = this.state.inspectedTarget;

    if (!inspected) {
      return;
    }

    if (this.state.nearest !== inspected) {
      this.state.inspectedTarget = null;
      this.ui.closeDetails();
    }
  }

  completeJourney() {
    this.state.completed = true;
    this.state.nearest = null;
    this.state.hoveredMonument = null;
    this.state.inspectedTarget = null;
    this.music.playPortal();
    this.refreshObjective();
    this.ui.showFinish(this.getFinishCopy());
    this.ui.hideHud();
    this.ui.showToast('Journey complete');
  }

  interactWithNearest() {
    const target = this.state.nearest;

    if (!target) {
      return;
    }

    if (target.userData.type === 'milestone') {
      const item = target.userData.item;
      this.ui.setMilestoneDetails(item);

      if (!this.world.unlockMilestone(target)) {
        this.ui.showToast(`${item.title} revisited`);
        return;
      }

      this.music.playUnlock();
      this.ui.showToast(`Unlocked: ${item.title}`);
      this.refreshProgress();
      this.refreshObjective();

      if (!this.world.getNextMilestone()) {
        this.world.setFinishPortalActive(true);
        this.music.playPortal();
        this.ui.showToast('Final gateway unlocked');
        this.refreshObjective();
      }

      return;
    }

    if (target.userData.type === 'link') {
      const { link } = target.userData;
      this.ui.setLinkDetails(link);
      this.music.playLink();
      window.open(link.url, '_blank', 'noopener,noreferrer');
      this.ui.showToast(`Opening ${link.label}`);
      return;
    }

    if (target.userData.type === 'finish' && this.world.finishPortal?.visible) {
      this.completeJourney();
    }
  }

  beginRestartCinematic() {
    const defaultPose = this.cameraController.getDefaultPose(this.restartSpawnPosition);

    this.state.restartCinematic = {
      elapsed: 0,
      duration: RESTART_CINEMATIC.duration,
      fromPosition: this.camera.position.clone(),
      toPosition: defaultPose.position,
      fromTarget: this.cameraController.target.clone(),
      toTarget: defaultPose.target,
    };
    this.state.started = false;
    this.state.nearest = null;
    this.state.hoveredMonument = null;
    this.state.inspectedTarget = null;
    this.input.reset();
  }

  finalizeRestartJourney() {
    this.state.restartCinematic = null;
    this.state.started = true;
    this.state.completed = false;
    this.state.nearest = null;
    this.state.hoveredMonument = null;
    this.state.inspectedTarget = null;
    this.input.reset();
    this.world.reset();
    this.player.reset();
    this.cameraController.reset(this.player.position);
    this.ui.showHud();
    this.ui.setSpawnDetails();
    this.refreshProgress();
    this.refreshObjective();
    this.ui.showToast('Journey restarted');
  }

  updateRestartCinematic(dt) {
    const cinematic = this.state.restartCinematic;

    if (!cinematic) {
      return;
    }

    cinematic.elapsed = Math.min(cinematic.elapsed + dt, cinematic.duration);
    const progress = cinematic.elapsed / cinematic.duration;
    const easedProgress = easeInOutCubic(progress);
    const arc = Math.sin(progress * Math.PI);

    this.tmpCinematicPosition.lerpVectors(cinematic.fromPosition, cinematic.toPosition, easedProgress);
    this.tmpCinematicPosition.y += arc * RESTART_CINEMATIC.arcHeight;
    this.tmpCinematicPosition.x += Math.sin(progress * Math.PI * 1.25) * RESTART_CINEMATIC.driftX * (1 - easedProgress);
    this.tmpCinematicPosition.z -= arc * 3.5;

    this.tmpCinematicTarget.lerpVectors(cinematic.fromTarget, cinematic.toTarget, easedProgress);
    this.tmpCinematicTarget.y += arc * RESTART_CINEMATIC.targetLift;
    this.tmpCinematicTarget.z += arc * 6;

    this.camera.position.copy(this.tmpCinematicPosition);
    this.camera.lookAt(this.tmpCinematicTarget);

    if (progress >= 1) {
      this.finalizeRestartJourney();
    }
  }

  animate(time) {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state.restartCinematic) {
      this.updateRestartCinematic(dt);
    } else if (this.state.started && !this.state.completed) {
      this.player.update({
        dt,
        input: this.input,
        cameraYaw: this.cameraController.yaw,
        elapsedTime: this.clock.elapsedTime,
        maxPlayerZ: this.world.getMaxPlayerZ(),
        onJump: () => this.music.playJump(),
        onLand: (intensity) => this.music.playLand(intensity),
      });

      this.targetCheckAccumulator += dt;

      if (this.targetCheckAccumulator >= this.targetCheckInterval) {
        this.targetCheckAccumulator = 0;
        this.updateNearestTarget();
      }

      if (this.input.consumeInteract()) {
        // Refresh just before acting on input so the player never
        // sees a stale "no target" message right as they press E.
        this.updateNearestTarget();
        this.targetCheckAccumulator = 0;

        if (this.state.nearest) {
          this.interactWithNearest();
          this.ui.openDetails();
          this.state.inspectedTarget = this.state.nearest;
        } else {
          this.ui.showToast('Walk closer to a monument to inspect');
        }
      }

      this.updateInspectionDismiss();

      this.music.update(this.player.getPlanarSpeed() > 2.4 && this.player.onGround);
    } else {
      this.input.clearQueuedActions();
    }

    if (!this.state.restartCinematic) {
      this.cameraController.update(this.player.position, dt);
    }
    this.world.updateAnimations({
      time,
      dt,
      nextMilestone: this.world.getNextMilestone(),
    });
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((nextTime) => this.animate(nextTime));
  }
}
