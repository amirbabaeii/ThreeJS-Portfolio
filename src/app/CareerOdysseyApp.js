import * as THREE from 'three';
import { createCareerRuntime } from './data/createCareerRuntime.js';
import { RenderPipeline } from './render/RenderPipeline.js';
import { CameraController } from './systems/CameraController.js';
import { InputController } from './systems/InputController.js';
import { MusicSystem } from './systems/MusicSystem.js';
import { PlayerController } from './systems/PlayerController.js';
import { AppUI } from './ui/AppUI.js';
import { CareerWorld } from './world/CareerWorld.js';
import { sharedUniforms } from './world/shaderLib.js';
import { setSignageInputMode } from './world/signage.js';
import { PLAYER_DEFAULTS, RESTART_CINEMATIC, SCENE_CONFIG } from './config.js';
import { easeInOutCubic } from './utils/math.js';

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

export class CareerOdysseyApp {
  constructor(root = document) {
    const { heroProfile, milestones } = createCareerRuntime();

    this.heroProfile = heroProfile;
    this.milestones = milestones;
    this.ui = new AppUI(root);
    this.ui.hydrate(heroProfile);

    this.isTouch = this.isTouchDevice();

    if (this.isTouch) {
      document.body.classList.add('is-touch');
    }

    setSignageInputMode(this.isTouch ? 'touch' : 'keyboard');

    this.pipeline = new RenderPipeline(this.ui.canvas);
    this.renderer = this.pipeline.renderer;
    this.scene = this.createScene();
    this.camera = new THREE.PerspectiveCamera(
      SCENE_CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      SCENE_CONFIG.camera.near,
      SCENE_CONFIG.camera.far,
    );
    this.pipeline.attach(this.scene, this.camera);

    this.clock = new THREE.Clock(false);
    this.elapsed = 0;
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
    this.lookTarget = new THREE.Vector3();
    this.targetCheckAccumulator = 0;
    this.targetCheckInterval = 1 / 16;

    this.world = new CareerWorld({
      scene: this.scene,
      heroProfile: this.heroProfile,
      milestones: this.milestones,
    });
    this.player = new PlayerController(this.scene);
    this.cameraController = new CameraController(this.camera);
    // Reused every frame to avoid per-frame allocations.
    this.cameraOptions = {
      velocity: this.player.planarVelocity,
      sprinting: false,
      wideFraming: false,
      getGroundHeight: (x, z) => this.world.getGroundHeight(x, z),
    };
    this.music = new MusicSystem({
      onStateChange: (enabled) => this.ui.setMusicEnabled(enabled),
      onToast: (message) => this.ui.showToast(message),
    });
    this.input = new InputController({
      canvas: this.ui.canvas,
      onOrbit: (dx, dy) => this.cameraController.applyOrbit(dx, dy),
      onZoom: (delta) => this.cameraController.applyZoom(delta),
      onToggleMusic: () => this.music.toggle(),
      mobile: {
        joystick: this.ui.joystick,
        knob: this.ui.joystickKnob,
        sprintButton: this.ui.sprintButton,
        jumpButton: this.ui.jumpButton,
      },
    });

    this.handleResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.pipeline.resize(window.innerWidth, window.innerHeight);
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
    this.ui.bindQualityToggle(() => {
      const label = this.pipeline.cycleMode();
      this.ui.showToast(`Graphics: ${label}`);
    });
    this.ui.bindDetailsClose(() => {
      this.ui.closeDetails();
    });
    this.ui.bindInspectPrompt(() => {
      // Run the interaction synchronously inside the user gesture.
      // Routing through queueInteract() defers window.open() to the next
      // animation frame, which mobile browsers treat as a non-user-gesture
      // popup and block (LinkedIn / GitHub never open).
      this.triggerInteract();
    });
    this.ui.setMusicEnabled(this.music.enabled);
    this.ui.setQualityLabel(this.pipeline.getModeLabel());

    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Enter' || event.repeat) return;

      if (this.ui.startScreen.classList.contains('visible')) {
        event.preventDefault();
        void this.startJourney();
        return;
      }

      if (this.ui.finishScreen.classList.contains('visible')) {
        event.preventDefault();
        void this.restartJourney();
      }
    });

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

  createScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SCENE_CONFIG.fogColor);
    scene.fog = new THREE.FogExp2(SCENE_CONFIG.fogColor, SCENE_CONFIG.fogDensity);
    return scene;
  }

  async runStage(progress, label, action) {
    this.ui.updateLoading(progress, label);
    await nextFrame();
    await action();
    await nextFrame();
  }

  async init() {
    const tier = this.pipeline.tier;
    const stages = [
      { progress: 8, label: 'Baking the night sky', action: () => this.world.createSky(this.renderer, tier) },
      { progress: 16, label: 'Hanging the moon', action: () => this.world.createLights() },
      { progress: 28, label: 'Sculpting the valley', action: () => this.world.createTerrain() },
      { progress: 40, label: 'Growing luminous grass', action: () => this.world.createVegetation() },
      { progress: 52, label: 'Scattering crystals and ruins', action: () => this.world.createProps() },
      { progress: 60, label: 'Releasing fireflies', action: () => this.world.createParticleField() },
      { progress: 68, label: 'Assembling the explorer', action: () => this.player.build() },
      { progress: 78, label: 'Forging career monuments', action: () => this.world.createMonuments() },
      { progress: 84, label: 'Linking profile terminals', action: () => this.world.createContactStations() },
      { progress: 90, label: 'Charging the finale gateway', action: () => this.world.createFinishPortal() },
      {
        progress: 97,
        label: 'Compiling shaders',
        action: async () => {
          this.pipeline.onTierChange((nextTier, options) => {
            sharedUniforms.uPixelRatio.value = this.pipeline.pixelRatio;

            if (!options?.pixelRatioOnly) {
              this.world.applyQuality(nextTier);
              this.ui.setQualityLabel(this.pipeline.getModeLabel());
            }
          });
          this.cameraController.reset(this.player.position);
          this.updateWorld(0);
          await this.pipeline.precompile();
        },
      },
    ];

    for (const stage of stages) {
      await this.runStage(stage.progress, stage.label, stage.action);
    }

    this.ui.updateLoading(100, 'Ready');
    this.cameraController.setIdleOrbit(true);
    this.ui.setSpawnDetails();
    this.refreshProgress();
    this.refreshObjective();
    this.ui.showStartScreen();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.animate());
  }

  async startJourney() {
    if (this.state.started) {
      return;
    }

    await this.music.start();
    this.input.clearQueuedActions();
    this.state.started = true;
    this.state.completed = false;
    this.cameraController.setIdleOrbit(false);
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
    const unlocked = this.world.getUnlockedCount();
    this.ui.updateProgress(unlocked, this.milestones.length);
    this.music.setProgress(unlocked / this.milestones.length);
  }

  refreshObjective() {
    const nextMilestone = this.world.getNextMilestone();

    if (nextMilestone) {
      const verb = this.isTouch ? 'tap Inspect' : 'press Enter';
      this.ui.updateObjective(nextMilestone.title, `Follow the beam to ${nextMilestone.place.split(',')[0]} and ${verb}.`);
      return;
    }

    if (this.state.completed) {
      this.ui.updateObjective('Journey complete', 'Replay available from the end screen.');
      return;
    }

    this.ui.updateObjective('Enter the final gateway', 'The gateway at the end of the road is open.');
  }

  getFinishCopy() {
    return 'Thanks for walking through my career. If anything caught your eye, the contact details below are the best way to reach me.';
  }

  updateObjectiveDistance() {
    const objective = this.world.getObjectivePosition();

    if (!objective || this.state.completed) {
      this.ui.updateObjectiveDistance(null);
      return;
    }

    const distance = Math.hypot(objective.x - this.player.position.x, objective.z - this.player.position.z);
    this.ui.updateObjectiveDistance(Math.max(0, Math.round(distance - 3)));
  }

  updateNearestTarget() {
    this.state.nearest = this.world.getNearestInteractive(this.player.position);
    const canInteract = Boolean(this.state.nearest && this.state.started && !this.state.completed);
    this.ui.setInteractionHintVisible(canInteract);
    this.updateObjectiveDistance();

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
    this.world.setCompleted(true);
    this.ui.setInteractionHintVisible(false);
    this.music.playPortal();
    this.refreshObjective();
    this.ui.showFinish(this.getFinishCopy());
    this.ui.hideHud();
    this.ui.showToast('Journey complete');
  }

  openExternalLink(url) {
    // Use a synthesized anchor click rather than window.open(). Mobile
    // browsers (especially iOS Safari) treat synchronous anchor clicks as
    // user-initiated navigation and let them through, while window.open()
    // calls (even inside a click handler) are frequently blocked.
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  triggerInteract() {
    if (!this.state.started || this.state.completed) {
      return;
    }

    // Clear any pending queued interact so the animation loop does not
    // re-fire the same interaction next frame.
    this.input.consumeInteract();
    this.handleInteract();
  }

  handleInteract() {
    this.updateNearestTarget();
    this.targetCheckAccumulator = 0;

    if (this.state.nearest) {
      this.interactWithNearest();

      if (!this.state.completed) {
        this.ui.openDetails();
        this.state.inspectedTarget = this.state.nearest;
      }
    } else {
      this.ui.showToast('Walk closer to a monument to inspect');
    }
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
      this.player.rig.pulse(item.accent);
      this.cameraController.addShake(0.35);
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
      this.openExternalLink(link.url);
      this.ui.showToast(`Opening ${link.label}`);
      return;
    }

    if (target.userData.type === 'finish' && this.world.isFinishActive()) {
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

  /** The point of interest the character's head turns toward. */
  getLookTarget() {
    const nearest = this.state.nearest;

    if (!nearest) {
      return null;
    }

    const height = nearest.userData.type === 'milestone' ? 4.8 : nearest.userData.type === 'finish' ? 4 : 2.4;
    return this.lookTarget.set(nearest.position.x, height, nearest.position.z);
  }

  updatePlayer(dt) {
    const playing = this.state.started && !this.state.completed && !this.state.restartCinematic;

    if (!this.playerOptions) {
      this.playerOptions = {
        dt: 0,
        input: this.input,
        cameraYaw: 0,
        maxPlayerZ: this.world.getMaxPlayerZ(),
        world: this.world,
        lookTarget: null,
        frozen: true,
        onJump: () => this.music.playJump(),
        onLand: (intensity, position) => {
          this.music.playLand(intensity);
          this.world.emitLanding(position, intensity);
          this.cameraController.addShake(intensity * 0.3);
        },
        onFootstep: (position, strength) => {
          this.world.emitFootstep(position, strength);
          this.music.footstep(strength);
        },
      };
    }

    const options = this.playerOptions;
    options.dt = dt;
    options.cameraYaw = this.cameraController.yaw;
    options.lookTarget = playing ? this.getLookTarget() : null;
    options.frozen = !playing;
    this.player.update(options);
  }

  updateWorld(dt) {
    this.world.updateAnimations({
      time: this.elapsed,
      dt,
      nextMilestone: this.world.getNextMilestone(),
      camera: this.camera,
      playerPosition: this.player.position,
    });
  }

  animate() {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    this.elapsed += dt;
    sharedUniforms.uTime.value = this.elapsed;
    this.pipeline.sampleFrame(rawDt);

    if (this.state.restartCinematic) {
      this.updatePlayer(dt);
      this.updateRestartCinematic(dt);
    } else if (this.state.started && !this.state.completed) {
      this.updatePlayer(dt);
      this.targetCheckAccumulator += dt;

      if (this.targetCheckAccumulator >= this.targetCheckInterval) {
        this.targetCheckAccumulator = 0;
        this.updateNearestTarget();
      }

      if (this.input.consumeInteract()) {
        // Refresh just before acting on input so the player never
        // sees a stale "no target" message right as they press Enter.
        this.handleInteract();
      }

      this.updateInspectionDismiss();
    } else {
      this.input.clearQueuedActions();
      this.updatePlayer(dt);
    }

    if (!this.state.restartCinematic) {
      const options = this.cameraOptions;
      options.sprinting = this.player.sprinting;
      options.wideFraming = window.innerWidth / window.innerHeight > 1.3 && window.innerWidth > 1000;
      this.cameraController.update(this.player.position, dt, options);
    }

    this.updateWorld(dt);
    this.pipeline.render(dt);
  }
}
