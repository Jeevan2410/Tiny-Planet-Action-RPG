import { clamp } from './SphereMath';

export type Action =
  | 'attack'
  | 'special'
  | 'dodge'
  | 'interact'
  | 'inventory'
  | 'quests'
  | 'pause'
  | 'potion'
  | 'sprint'
  | 'confirm';

const KEY_ACTIONS: Record<string, Action> = {
  KeyJ: 'attack',
  KeyK: 'special',
  Space: 'dodge',
  KeyE: 'interact',
  KeyI: 'inventory',
  Tab: 'inventory',
  KeyL: 'quests',
  Escape: 'pause',
  KeyP: 'pause',
  KeyQ: 'potion',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Enter: 'confirm',
};

const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * Keyboard + mouse + touch input, normalised into a small set of gameplay verbs.
 *
 * `moveX/moveY` are camera-relative (+Y is "away from the camera"). Camera look is
 * delivered as per-frame deltas that the consumer drains with `takeLook()`.
 */
export class Input {
  moveX = 0;
  moveY = 0;
  /** True while movement comes from the on-screen stick rather than keys. */
  usingTouch = false;

  private held = new Set<string>();
  private edge = new Set<Action>();
  private heldActions = new Set<Action>();
  private lookDx = 0;
  private lookDy = 0;
  private virtualMove = { x: 0, y: 0, active: false };
  private virtualHeld = new Set<Action>();
  private pointerDragging = false;
  private lastPointer = { x: 0, y: 0 };
  private disposers: Array<() => void> = [];
  private target: HTMLElement;
  /** Set while a modal UI panel owns the keyboard. */
  private captured = false;

  constructor(target: HTMLElement) {
    this.target = target;
    this.bind();
  }

  private bind(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Space' && e.target === document.body) e.preventDefault();
      if (e.repeat) return;
      const wasHeld = this.held.has(e.code);
      this.held.add(e.code);
      if (MOVE_KEYS.has(e.code)) this.usingTouch = false;
      const action = KEY_ACTIONS[e.code];
      if (action) {
        this.heldActions.add(action);
        if (!wasHeld) this.edge.add(action);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.held.delete(e.code);
      const action = KEY_ACTIONS[e.code];
      if (action && !this.isActionHeldByKey(action)) this.heldActions.delete(action);
    };
    const onBlur = () => {
      this.held.clear();
      this.heldActions.clear();
      this.pointerDragging = false;
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      this.target.focus?.();
      if (e.button === 0) {
        if (document.pointerLockElement === this.target) {
          this.edge.add('attack');
          this.heldActions.add('attack');
        } else {
          this.pointerDragging = true;
          this.lastPointer.x = e.clientX;
          this.lastPointer.y = e.clientY;
          this.target.setPointerCapture?.(e.pointerId);
        }
      } else if (e.button === 2) {
        e.preventDefault();
        this.edge.add('special');
        this.heldActions.add('special');
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 0) {
        this.pointerDragging = false;
        this.heldActions.delete('attack');
      }
      if (e.button === 2) this.heldActions.delete('special');
    };
    const onPointerMove = (e: PointerEvent) => {
      if (document.pointerLockElement === this.target) {
        this.lookDx += e.movementX;
        this.lookDy += e.movementY;
        return;
      }
      if (!this.pointerDragging) return;
      this.lookDx += e.clientX - this.lastPointer.x;
      this.lookDy += e.clientY - this.lastPointer.y;
      this.lastPointer.x = e.clientX;
      this.lastPointer.y = e.clientY;
    };
    const onWheel = (e: WheelEvent) => {
      this.zoomDelta += Math.sign(e.deltaY);
      e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.target.addEventListener('contextmenu', onContextMenu);
    this.target.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    this.target.addEventListener('wheel', onWheel, { passive: false });

    this.disposers.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => this.target.removeEventListener('contextmenu', onContextMenu),
      () => this.target.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('pointermove', onPointerMove),
      () => this.target.removeEventListener('wheel', onWheel),
    );
  }

  zoomDelta = 0;

  private isActionHeldByKey(action: Action): boolean {
    for (const code of this.held) if (KEY_ACTIONS[code] === action) return true;
    return false;
  }

  /** Called by the touch layer in the DOM overlay. */
  setVirtualMove(x: number, y: number): void {
    this.virtualMove.x = clamp(x, -1, 1);
    this.virtualMove.y = clamp(y, -1, 1);
    this.virtualMove.active = x !== 0 || y !== 0;
    if (this.virtualMove.active) this.usingTouch = true;
  }

  virtualPress(action: Action): void {
    this.edge.add(action);
  }

  virtualHold(action: Action, held: boolean): void {
    if (held) {
      this.virtualHeld.add(action);
      this.edge.add(action);
    } else {
      this.virtualHeld.delete(action);
    }
  }

  addLook(dx: number, dy: number): void {
    this.lookDx += dx;
    this.lookDy += dy;
  }

  /** When captured, gameplay verbs are suppressed (a menu has focus). */
  setCaptured(captured: boolean): void {
    this.captured = captured;
    if (captured) {
      this.moveX = 0;
      this.moveY = 0;
    }
  }

  /** Recompute per-frame axes. Call once at the top of the frame. */
  sample(): void {
    if (this.captured) {
      this.moveX = 0;
      this.moveY = 0;
      return;
    }
    if (this.virtualMove.active) {
      this.moveX = this.virtualMove.x;
      this.moveY = this.virtualMove.y;
      return;
    }
    let x = 0;
    let y = 0;
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) y += 1;
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) y -= 1;
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) x += 1;
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.moveX = x;
    this.moveY = y;
  }

  /** True on the frame the action was triggered. Consumed by reading it. */
  pressed(action: Action): boolean {
    if (this.edge.has(action)) {
      this.edge.delete(action);
      return true;
    }
    return false;
  }

  /** True while the action is held down. */
  down(action: Action): boolean {
    return this.heldActions.has(action) || this.virtualHeld.has(action);
  }

  /** Drain accumulated camera look, in pixels. */
  takeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookDx, dy: this.lookDy };
    this.lookDx = 0;
    this.lookDy = 0;
    return out;
  }

  takeZoom(): number {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }

  /** Forget queued edges — used when opening/closing menus. */
  flush(): void {
    this.edge.clear();
  }

  requestPointerLock(): void {
    if (document.pointerLockElement === this.target) return;
    const el = this.target as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
    try {
      const result = el.requestPointerLock?.();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          /* Pointer lock is a nicety; drag-to-look still works. */
        });
      }
    } catch {
      /* ignore */
    }
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
