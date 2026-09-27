import './ui.css';
import { el } from './dom';
import { Hud, type HudFrame } from './Hud';
import { DialogueView } from './DialogueView';
import { FloatingText } from './FloatingText';
import { InventoryPanel, JournalPanel, PausePanel, ShopPanel, TitleScreen, VictoryScreen, type Settings } from './Panels';
import { prefersTouch, TouchControls } from './Touch';
import type { Input } from '../core/Input';
import type { PerspectiveCamera } from 'three';

/**
 * Owns the DOM overlay and nothing else: three.js does not draw UI, and fighting
 * the 3D scene to render menus would cost far more than a handful of divs.
 */
export class Ui {
  readonly root: HTMLElement;
  readonly hud = new Hud();
  readonly dialogue = new DialogueView();
  readonly floating = new FloatingText();
  readonly inventory: InventoryPanel;
  readonly journal = new JournalPanel();
  readonly shop: ShopPanel;
  readonly pause: PausePanel;
  readonly title = new TitleScreen();
  readonly victory = new VictoryScreen();
  readonly touch: TouchControls;

  private loading: HTMLElement;

  constructor(
    mount: HTMLElement,
    input: Input,
    settings: Settings,
    handlers: { onSettings: (settings: Settings) => void; onEquipmentChanged: () => void },
  ) {
    this.inventory = new InventoryPanel(handlers.onEquipmentChanged);
    this.shop = new ShopPanel(handlers.onEquipmentChanged);
    this.pause = new PausePanel(settings, handlers.onSettings);
    this.touch = new TouchControls(input);

    this.loading = el(
      'div',
      { class: 'loading' },
      el('div', {}, el('div', { class: 'orb' }), el('p', { text: 'Shaping a small world…' })),
    );

    this.root = el(
      'div',
      { class: 'ui-layer' },
      this.hud.root,
      this.floating.root,
      this.dialogue.root,
      this.touch.root,
      this.inventory.root,
      this.journal.root,
      this.shop.root,
      this.pause.root,
      this.title.root,
      this.victory.root,
      this.loading,
    );
    mount.append(this.root);

    if (prefersTouch()) this.touch.setVisible(true);
  }

  get usingTouch(): boolean {
    return this.touch.root.classList.contains('show');
  }

  setTouchVisible(visible: boolean): void {
    this.touch.setVisible(visible);
  }

  hideLoading(): void {
    this.loading.classList.add('gone');
    window.setTimeout(() => this.loading.remove(), 600);
  }

  /** Any full-screen panel that should freeze the world. */
  get modalOpen(): boolean {
    return (
      this.inventory.isOpen ||
      this.journal.isOpen ||
      this.shop.isOpen ||
      this.pause.isOpen ||
      this.title.isOpen ||
      this.victory.isOpen
    );
  }

  get anyOpen(): boolean {
    return this.modalOpen || this.dialogue.isOpen;
  }

  closeTopmost(): boolean {
    for (const panel of [this.shop, this.inventory, this.journal, this.pause]) {
      if (panel.isOpen) {
        panel.close();
        return true;
      }
    }
    return false;
  }

  update(dt: number, frame: HudFrame, camera: PerspectiveCamera, width: number, height: number): void {
    this.hud.update(dt, frame);
    this.dialogue.update(dt);
    this.floating.update(dt, camera, width, height);
  }
}

export type { Settings, HudFrame };
