import { Object3D, Vector3 } from 'three';
import { damp } from '../core/SphereMath';

/**
 * A tiny pose-blending rig.
 *
 * Instead of sampling baked animation clips, every clip is a function that writes
 * euler targets into a `PoseTarget`; the rig then eases the live bones towards that
 * target each frame. Transitions between clips come for free, and combat can dial
 * the easing half-life per clip — the brief wants snappy attack timing and readable
 * wind-ups more than it wants animation variety, and this gives frame-level control
 * over both.
 */
export class PoseTarget {
  private values = new Map<string, [number, number, number]>();
  /** Root translation in the model's local space (bob, crouch, lunge). */
  offset: [number, number, number] = [0, 0, 0];
  /** Extra uniform scale, for squash-and-stretch. */
  scale: [number, number, number] = [1, 1, 1];

  reset(): void {
    for (const v of this.values.values()) {
      v[0] = 0;
      v[1] = 0;
      v[2] = 0;
    }
    this.offset[0] = 0;
    this.offset[1] = 0;
    this.offset[2] = 0;
    this.scale[0] = 1;
    this.scale[1] = 1;
    this.scale[2] = 1;
  }

  declare(bone: string): void {
    if (!this.values.has(bone)) this.values.set(bone, [0, 0, 0]);
  }

  set(bone: string, x: number, y: number, z: number): void {
    const v = this.values.get(bone);
    if (!v) {
      this.values.set(bone, [x, y, z]);
      return;
    }
    v[0] = x;
    v[1] = y;
    v[2] = z;
  }

  add(bone: string, x: number, y: number, z: number): void {
    const v = this.values.get(bone);
    if (!v) {
      this.values.set(bone, [x, y, z]);
      return;
    }
    v[0] += x;
    v[1] += y;
    v[2] += z;
  }

  get(bone: string): [number, number, number] | undefined {
    return this.values.get(bone);
  }

  bones(): IterableIterator<string> {
    return this.values.keys();
  }
}

export class Rig {
  readonly target = new PoseTarget();
  private bones = new Map<string, Object3D>();
  private rest = new Map<string, Vector3>();
  private restOffset = new Vector3();
  readonly root: Object3D;

  constructor(root: Object3D, bones: Record<string, Object3D>) {
    this.root = root;
    this.restOffset.copy(root.position);
    for (const [name, object] of Object.entries(bones)) {
      this.bones.set(name, object);
      const r = object.rotation;
      this.rest.set(name, new Vector3(r.x, r.y, r.z));
      this.target.declare(name);
    }
  }

  has(bone: string): boolean {
    return this.bones.has(bone);
  }

  bone(name: string): Object3D | undefined {
    return this.bones.get(name);
  }

  /** Ease live bone rotations towards the pose target. */
  apply(dt: number, halfLife = 0.09): void {
    const k = damp(dt, halfLife);
    for (const [name, object] of this.bones) {
      const wanted = this.target.get(name);
      if (!wanted) continue;
      const rest = this.rest.get(name)!;
      object.rotation.x += (rest.x + wanted[0] - object.rotation.x) * k;
      object.rotation.y += (rest.y + wanted[1] - object.rotation.y) * k;
      object.rotation.z += (rest.z + wanted[2] - object.rotation.z) * k;
    }
    const offset = this.target.offset;
    this.root.position.x += (this.restOffset.x + offset[0] - this.root.position.x) * k;
    this.root.position.y += (this.restOffset.y + offset[1] - this.root.position.y) * k;
    this.root.position.z += (this.restOffset.z + offset[2] - this.root.position.z) * k;
    const scale = this.target.scale;
    this.root.scale.x += (scale[0] - this.root.scale.x) * k;
    this.root.scale.y += (scale[1] - this.root.scale.y) * k;
    this.root.scale.z += (scale[2] - this.root.scale.z) * k;
  }

  /** Snap straight to the target with no easing (respawns, cutscene poses). */
  snap(): void {
    this.apply(1, 0.0001);
  }
}
