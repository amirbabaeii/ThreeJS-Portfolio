export class InputController {
  constructor({ canvas, onOrbit, onToggleMusic }) {
    this.canvas = canvas;
    this.onOrbit = onOrbit;
    this.onToggleMusic = onToggleMusic;
    this.forward = 0;
    this.strafe = 0;
    this.sprint = false;
    this.jumpQueued = false;
    this.interactQueued = false;
    this.dragging = false;
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
      this.dragging = true;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    };
    this.handlePointerMove = (event) => {
      if (!this.dragging) return;

      const dx = event.clientX - this.pointerX;
      const dy = event.clientY - this.pointerY;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.onOrbit(dx, dy);
    };
    this.stopDragging = () => {
      this.dragging = false;
    };

    this.attachEvents();
  }

  attachEvents() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.stopDragging);
    this.canvas.addEventListener('pointercancel', this.stopDragging);
  }

  syncAxes() {
    const moveForward = this.keys.KeyW || this.keys.ArrowUp;
    const moveBackward = this.keys.KeyS || this.keys.ArrowDown;
    const moveLeft = this.keys.KeyA || this.keys.ArrowLeft;
    const moveRight = this.keys.KeyD || this.keys.ArrowRight;

    this.forward = (moveForward ? 1 : 0) - (moveBackward ? 1 : 0);
    this.strafe = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
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
        this.sprint = pressed;
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

    this.forward = 0;
    this.strafe = 0;
    this.sprint = false;
    this.clearQueuedActions();
    this.dragging = false;
  }
}
