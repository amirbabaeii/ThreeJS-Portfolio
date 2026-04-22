function clampAxis(value) {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

export class InputController {
  constructor({ canvas, onOrbit, onToggleMusic, mobile } = {}) {
    this.canvas = canvas;
    this.onOrbit = onOrbit;
    this.onToggleMusic = onToggleMusic;
    this.forward = 0;
    this.strafe = 0;
    this.sprint = false;
    this.keyboardSprint = false;
    this.touchSprint = false;
    this.touchForward = 0;
    this.touchStrafe = 0;
    this.jumpQueued = false;
    this.interactQueued = false;
    this.orbitPointerId = null;
    this.pointerX = 0;
    this.pointerY = 0;
    this.keys = {
      KeyW: false,
      ArrowUp: false,
      KeyS: false,
      ArrowDown: false,
      KeyA: false,
      ArrowLeft: false,
      KeyD: false,
      ArrowRight: false,
    };

    this.handleKeyDown = (event) => {
      this.onKeyChange(event, true);
    };
    this.handleKeyUp = (event) => {
      this.onKeyChange(event, false);
    };
    this.handlePointerDown = (event) => {
      if (this.orbitPointerId !== null) return;
      this.orbitPointerId = event.pointerId;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.canvas.setPointerCapture?.(event.pointerId);
    };
    this.handlePointerMove = (event) => {
      if (event.pointerId !== this.orbitPointerId) return;

      const dx = event.clientX - this.pointerX;
      const dy = event.clientY - this.pointerY;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.onOrbit(dx, dy);
    };
    this.stopDragging = (event) => {
      if (event && event.pointerId !== this.orbitPointerId) return;
      this.orbitPointerId = null;
    };

    this.attachEvents();

    if (mobile) {
      this.attachMobileControls(mobile);
    }
  }

  attachEvents() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.stopDragging);
    this.canvas.addEventListener('pointercancel', this.stopDragging);
  }

  attachMobileControls({ joystick, knob, jumpButton, interactButton, sprintButton }) {
    if (joystick && knob) {
      this.bindJoystick(joystick, knob);
    }

    this.bindHoldButton(jumpButton, {
      onPress: () => {
        this.jumpQueued = true;
      },
    });

    this.bindHoldButton(interactButton, {
      onPress: () => {
        this.interactQueued = true;
      },
    });

    this.bindHoldButton(sprintButton, {
      onPress: () => this.setTouchSprint(true),
      onRelease: () => this.setTouchSprint(false),
    });
  }

  bindJoystick(joystick, knob) {
    let activePointerId = null;
    let centerX = 0;
    let centerY = 0;
    let maxRadius = 0;

    const setKnob = (x, y, smooth) => {
      knob.classList.toggle('is-smoothing', Boolean(smooth));
      knob.style.transform = `translate(${x}px, ${y}px)`;
    };

    const resetKnob = () => {
      activePointerId = null;
      this.setTouchAxes(0, 0);
      setKnob(0, 0, true);
    };

    const updateFromPointer = (event) => {
      const dxRaw = event.clientX - centerX;
      const dyRaw = event.clientY - centerY;
      const distance = Math.hypot(dxRaw, dyRaw);
      const limit = maxRadius || 1;

      let dx = dxRaw;
      let dy = dyRaw;

      if (distance > limit) {
        dx = (dxRaw / distance) * limit;
        dy = (dyRaw / distance) * limit;
      }

      setKnob(dx, dy, false);
      this.setTouchAxes(-dy / limit, dx / limit);
    };

    joystick.addEventListener('pointerdown', (event) => {
      if (activePointerId !== null) return;
      activePointerId = event.pointerId;

      const rect = joystick.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      maxRadius = Math.min(rect.width, rect.height) / 2 - 12;

      joystick.setPointerCapture?.(event.pointerId);
      updateFromPointer(event);
      event.preventDefault();
    });

    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activePointerId) return;
      updateFromPointer(event);
    });

    const release = (event) => {
      if (event.pointerId !== activePointerId) return;
      resetKnob();
    };

    joystick.addEventListener('pointerup', release);
    joystick.addEventListener('pointercancel', release);
    joystick.addEventListener('lostpointercapture', release);
  }

  bindHoldButton(button, { onPress, onRelease } = {}) {
    if (!button) return;

    const pointerIds = new Set();

    button.addEventListener('contextmenu', (event) => event.preventDefault());

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      pointerIds.add(event.pointerId);
      button.setPointerCapture?.(event.pointerId);
      button.classList.add('is-active');
      onPress?.();
    });

    const release = (event) => {
      pointerIds.delete(event.pointerId);
      if (pointerIds.size === 0) {
        button.classList.remove('is-active');
        onRelease?.();
      }
    };

    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  setTouchAxes(forward, strafe) {
    this.touchForward = clampAxis(forward);
    this.touchStrafe = clampAxis(strafe);
    this.syncAxes();
  }

  setTouchSprint(active) {
    this.touchSprint = Boolean(active);
    this.sprint = this.keyboardSprint || this.touchSprint;
  }

  syncAxes() {
    const moveForward = this.keys.KeyW || this.keys.ArrowUp;
    const moveBackward = this.keys.KeyS || this.keys.ArrowDown;
    const moveLeft = this.keys.KeyA || this.keys.ArrowLeft;
    const moveRight = this.keys.KeyD || this.keys.ArrowRight;

    const keyboardForward = (moveForward ? 1 : 0) - (moveBackward ? 1 : 0);
    const keyboardStrafe = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);

    this.forward = clampAxis(keyboardForward + this.touchForward);
    this.strafe = clampAxis(keyboardStrafe + this.touchStrafe);
  }

  onKeyChange(event, pressed) {
    if (event.code in this.keys) {
      this.keys[event.code] = pressed;
      this.syncAxes();

      if (event.code.startsWith('Arrow')) {
        event.preventDefault();
      }

      return;
    }

    switch (event.code) {
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keyboardSprint = pressed;
        this.sprint = this.keyboardSprint || this.touchSprint;
        break;
      case 'Space':
        if (pressed) {
          this.jumpQueued = true;
        }
        event.preventDefault();
        break;
      case 'Enter':
        if (pressed) {
          this.interactQueued = true;
        }
        event.preventDefault();
        break;
      case 'KeyM':
        if (pressed) {
          this.onToggleMusic();
        }
        break;
      default:
        break;
    }
  }

  consumeJump() {
    const jumpQueued = this.jumpQueued;
    this.jumpQueued = false;
    return jumpQueued;
  }

  consumeInteract() {
    const interactQueued = this.interactQueued;
    this.interactQueued = false;
    return interactQueued;
  }

  clearQueuedActions() {
    this.jumpQueued = false;
    this.interactQueued = false;
  }

  reset() {
    Object.keys(this.keys).forEach((code) => {
      this.keys[code] = false;
    });

    this.touchForward = 0;
    this.touchStrafe = 0;
    this.touchSprint = false;
    this.keyboardSprint = false;
    this.forward = 0;
    this.strafe = 0;
    this.sprint = false;
    this.clearQueuedActions();
    this.orbitPointerId = null;
  }
}
