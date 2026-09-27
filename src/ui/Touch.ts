import { el } from './dom';
import type { Action, Input } from '../core/Input';

/**
 * On-screen controls for touch devices: a left thumb-stick for movement, a right
 * cluster for the combat verbs, and drag-anywhere-else to swing the camera.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private knob: HTMLElement;
  private stick: HTMLElement;
  private input: Input;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private origin = { x: 0, y: 0 };

  constructor(input: Input) {
    this.input = input;
    this.knob = el('div', { class: 'knob' });
    this.stick = el('div', { class: 'stick' }, this.knob);

    const buttons = el('div', { class: 'touch-buttons' });
    const make = (label: string, action: Action, wide = false) => {
      const button = el('div', { class: `touch-btn${wide ? ' wide' : ''}`, text: label });
      const press = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.input.virtualHold(action, true);
      };
      const release = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.input.virtualHold(action, false);
      };
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('pointerleave', release);
      return button;
    };
    buttons.append(
      make('Dodge', 'dodge'),
      make('Attack', 'attack'),
      make('Talk', 'interact'),
      make('Special', 'special'),
      make('Bag', 'inventory', true),
    );

    this.root = el('div', { class: 'touch' }, this.stick, buttons);
    this.bindStick();
  }

  private bindStick(): void {
    const rectRadius = () => this.stick.getBoundingClientRect().width / 2;

    this.stick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.stickId = event.pointerId;
      const rect = this.stick.getBoundingClientRect();
      this.origin.x = rect.left + rect.width / 2;
      this.origin.y = rect.top + rect.height / 2;
      this.stick.setPointerCapture(event.pointerId);
      this.moveStick(event.clientX, event.clientY, rectRadius());
    });
    this.stick.addEventListener('pointermove', (event) => {
      if (this.stickId !== event.pointerId) return;
      event.preventDefault();
      this.moveStick(event.clientX, event.clientY, rectRadius());
    });
    const end = (event: PointerEvent) => {
      if (this.stickId !== event.pointerId) return;
      this.stickId = null;
      this.knob.style.transform = '';
      this.input.setVirtualMove(0, 0);
    };
    this.stick.addEventListener('pointerup', end);
    this.stick.addEventListener('pointercancel', end);
  }

  private moveStick(x: number, y: number, radius: number): void {
    let dx = x - this.origin.x;
    let dy = y - this.origin.y;
    const length = Math.hypot(dx, dy);
    const max = radius * 0.72;
    if (length > max) {
      dx = (dx / length) * max;
      dy = (dy / length) * max;
    }
    this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    // Screen down is +Y, but "forward" is -Y.
    this.input.setVirtualMove(dx / max, -dy / max);
  }

  /** Drag on empty screen space to orbit the camera. */
  bindLook(surface: HTMLElement): void {
    surface.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType !== 'touch' || this.lookId !== null) return;
        this.lookId = event.pointerId;
        this.lookLast.x = event.clientX;
        this.lookLast.y = event.clientY;
      },
      { passive: true },
    );
    surface.addEventListener(
      'pointermove',
      (event) => {
        if (this.lookId !== event.pointerId) return;
        this.input.addLook(event.clientX - this.lookLast.x, event.clientY - this.lookLast.y);
        this.lookLast.x = event.clientX;
        this.lookLast.y = event.clientY;
      },
      { passive: true },
    );
    const end = (event: PointerEvent) => {
      if (this.lookId === event.pointerId) this.lookId = null;
    };
    surface.addEventListener('pointerup', end, { passive: true });
    surface.addEventListener('pointercancel', end, { passive: true });
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('show', visible);
    if (!visible) this.input.setVirtualMove(0, 0);
  }
}

/** Rough check for a device that wants touch controls. */
export function prefersTouch(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse && navigator.maxTouchPoints > 0;
}
