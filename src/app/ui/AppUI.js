function getRequiredElement(root, selector) {
  const element = root.querySelector(selector);

  if (!element) {
    throw new Error(`Missing required UI element: ${selector}`);
  }

  return element;
}

function setElementVisibility(element, visible) {
  element.classList.toggle('hidden', !visible);
  element.classList.toggle('visible', visible);
}

function renderBullets(listElement, bullets) {
  const items = bullets.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  });

  listElement.replaceChildren(...items);
}

export class AppUI {
  constructor(root = document) {
    this.root = root;
    this.canvas = getRequiredElement(root, '#game');
    this.loadingScreen = getRequiredElement(root, '#loadingScreen');
    this.loadingBar = getRequiredElement(root, '#loadingBar');
    this.loadingValue = getRequiredElement(root, '#loadingValue');
    this.loadingLabel = getRequiredElement(root, '#loadingLabel');
    this.startScreen = getRequiredElement(root, '#startScreen');
    this.startTitle = getRequiredElement(root, '#startTitle');
    this.startCopy = getRequiredElement(root, '#startCopy');
    this.playButton = getRequiredElement(root, '#playButton');
    this.finishScreen = getRequiredElement(root, '#finishScreen');
    this.finishCopy = getRequiredElement(root, '#finishCopy');
    this.restartButton = getRequiredElement(root, '#restartButton');
    this.hud = getRequiredElement(root, '#hud');
    this.heroTitle = getRequiredElement(root, '#heroTitle');
    this.heroSubtitle = getRequiredElement(root, '#heroSubtitle');
    this.progressValue = getRequiredElement(root, '#progressValue');
    this.objectiveValue = getRequiredElement(root, '#objectiveValue');
    this.detailEyebrow = getRequiredElement(root, '#detailEyebrow');
    this.detailTitle = getRequiredElement(root, '#detailTitle');
    this.detailMeta = getRequiredElement(root, '#detailMeta');
    this.detailBullets = getRequiredElement(root, '#detailBullets');
    this.detailClose = root.querySelector('#detailClose');
    this.interactionHint = getRequiredElement(root, '#interactionHint');
    this.inspectPrompt = root.querySelector('#inspectPrompt');
    this.hintChip = getRequiredElement(root, '#hintChip');
    this.toast = getRequiredElement(root, '#toast');
    this.musicToggle = getRequiredElement(root, '#musicToggle');
    this.mobileControls = root.querySelector('#mobileControls');
    this.joystick = root.querySelector('#joystick');
    this.joystickKnob = root.querySelector('#joystickKnob');
    this.jumpButton = root.querySelector('#jumpButton');
    this.interactButton = root.querySelector('#interactButton');
    this.sprintButton = root.querySelector('#sprintButton');
    this.metaDescription = root.querySelector('meta[name="description"]');
    this.toastTimeout = null;
    this.heroName = '';
  }

  hydrate(heroProfile) {
    this.heroName = heroProfile.name;
    document.title = `${heroProfile.name} | Career Odyssey`;

    if (this.metaDescription) {
      this.metaDescription.setAttribute(
        'content',
        `Interactive Three.js portfolio for ${heroProfile.name}. ${heroProfile.tagline}`,
      );
    }

    this.startTitle.textContent = heroProfile.name;
    this.startCopy.textContent = heroProfile.intro;
    this.heroTitle.textContent = heroProfile.name;
    this.heroSubtitle.textContent = heroProfile.tagline;
  }

  bindPlay(handler) {
    this.playButton.addEventListener('click', handler);
  }

  bindRestart(handler) {
    this.restartButton.addEventListener('click', handler);
  }

  bindMusicToggle(handler) {
    this.musicToggle.addEventListener('click', handler);
  }

  bindDetailsClose(handler) {
    if (this.detailClose) {
      this.detailClose.addEventListener('click', handler);
    }
  }

  openDetails() {
    this.hud.classList.add('details-open');
  }

  closeDetails() {
    this.hud.classList.remove('details-open');
  }

  updateLoading(progress, label) {
    this.loadingBar.style.width = `${progress}%`;
    this.loadingValue.textContent = `${Math.round(progress)}%`;
    this.loadingLabel.textContent = label;
  }

  showStartScreen() {
    setElementVisibility(this.loadingScreen, false);
    setElementVisibility(this.startScreen, true);
  }

  hideStartScreen() {
    setElementVisibility(this.startScreen, false);
  }

  showHud() {
    this.hud.classList.remove('hidden');
  }

  hideHud() {
    this.hud.classList.add('hidden');
    this.closeDetails();
  }

  showFinish(copy) {
    this.finishCopy.textContent = copy;
    setElementVisibility(this.finishScreen, true);
  }

  hideFinish() {
    setElementVisibility(this.finishScreen, false);
  }

  setMusicEnabled(enabled) {
    this.musicToggle.textContent = enabled ? 'Music On' : 'Music Off';
    this.musicToggle.classList.toggle('is-muted', !enabled);
  }

  updateProgress(unlocked, total) {
    this.progressValue.textContent = `${unlocked} / ${total}`;
  }

  updateObjective(text, hint) {
    this.objectiveValue.textContent = text;
    this.hintChip.textContent = hint;
  }

  setInteractionHintVisible(visible) {
    this.interactionHint.classList.toggle('hidden', !visible);

    if (this.inspectPrompt) {
      this.inspectPrompt.classList.toggle('hidden', !visible);
    }

    if (this.interactButton) {
      this.interactButton.classList.toggle('is-disabled', !visible);
    }
  }

  setDetailPanel({ eyebrow, title, meta, bullets }) {
    this.detailEyebrow.textContent = eyebrow;
    this.detailTitle.textContent = title;
    this.detailMeta.textContent = meta;
    renderBullets(this.detailBullets, bullets);
  }

  setSpawnDetails() {
    this.setDetailPanel({
      eyebrow: 'Spawn Point',
      title: 'Launch Platform',
      meta: `A cinematic review of ${this.heroName}'s career. Move forward to begin.`,
      bullets: [
        'Inspect monuments to unlock chapters.',
        'Use Enter on the profile terminals to open LinkedIn or GitHub.',
        'Complete the journey and enter the final gateway.',
      ],
    });
  }

  setMilestoneDetails(item) {
    this.setDetailPanel({
      eyebrow: item.category === 'education' ? 'Education Monument' : 'Experience Monument',
      title: item.title,
      meta: `${item.place} · ${item.period} · Node ${item.index + 1}`,
      bullets: item.bullets,
    });
  }

  setLinkDetails(link) {
    this.setDetailPanel({
      eyebrow: 'Profile Terminal',
      title: link.label,
      meta: link.description,
      bullets: [`Press Enter to open ${link.label} in a new tab.`],
    });
  }

  setFinishDetails() {
    this.setDetailPanel({
      eyebrow: 'Final Gateway',
      title: 'Exit Portal',
      meta: 'Press Enter to complete the experience.',
      bullets: ['All monuments are cleared. Step through to finish.'],
    });
  }

  showToast(message) {
    this.toast.textContent = message;
    this.toast.classList.add('show');

    if (this.toastTimeout) {
      window.clearTimeout(this.toastTimeout);
    }

    this.toastTimeout = window.setTimeout(() => {
      this.toast.classList.remove('show');
    }, 1800);
  }
}
