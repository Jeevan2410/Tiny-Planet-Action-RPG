import { Vector3, type PerspectiveCamera } from 'three';
import type { DamageTone } from '../core/Context';
import { el } from './dom';

interface Floater {
  node: HTMLElement;
  anchor: Vector3;
  life: number;
  maxLife: number;
  drift: number;
  wobble: number;
}

const POOL_SIZE = 26;

/**
 * Damage and pickup numbers.
 *
 * Kept in the DOM rather than as 3D sprites: text stays crisp at any resolution,
 * costs no texture uploads, and inherits the HUD's typography for free. Each
 * floater anchors to a world position and is projected through the camera.
 */
export class FloatingText {
  readonly root: HTMLElement;
  private pool: HTMLElement[] = [];
  private active: Floater[] = [];

  constructor() {
    this.root = el('div', { class: 'floaters' });
    for (let i = 0; i < POOL_SIZE; i++) {
      const node = el('div', { class: 'floater' });
      node.style.display = 'none';
      this.root.append(node);
      this.pool.push(node);
    }
  }

  spawn(position: Vector3, text: string, tone: DamageTone): void {
    const node = this.pool.pop() ?? this.active.shift()?.node;
    if (!node) return;
    node.className = `floater ${tone}`;
    node.textContent = text;
    node.style.display = '';
    node.style.opacity = '1';
    this.active.push({
      node,
      anchor: position.clone(),
      life: tone === 'player' ? 1.1 : 0.85,
      maxLife: tone === 'player' ? 1.1 : 0.85,
      drift: 0.9 + Math.random() * 0.5,
      wobble: (Math.random() * 2 - 1) * 26,
    });
  }

  update(dt: number, camera: PerspectiveCamera, width: number, height: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const floater = this.active[i];
      floater.life -= dt;
      if (floater.life <= 0) {
        floater.node.style.display = 'none';
        this.pool.push(floater.node);
        this.active.splice(i, 1);
        continue;
      }
      const t = 1 - floater.life / floater.maxLife;
      _v.copy(floater.anchor).addScaledVector(_up.copy(floater.anchor).normalize(), t * floater.drift * 1.8);
      _v.project(camera);
      if (_v.z > 1) {
        floater.node.style.display = 'none';
        continue;
      }
      floater.node.style.display = '';
      const x = (_v.x * 0.5 + 0.5) * width + floater.wobble * t;
      const y = (-_v.y * 0.5 + 0.5) * height;
      floater.node.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1.25 - t * 0.35).toFixed(2)})`;
      floater.node.style.opacity = String(Math.min(1, (1 - t) * 2.2));
    }
  }

  clear(): void {
    for (const floater of this.active) {
      floater.node.style.display = 'none';
      this.pool.push(floater.node);
    }
    this.active.length = 0;
  }
}

const _v = /* @__PURE__ */ new Vector3();
const _up = /* @__PURE__ */ new Vector3();
