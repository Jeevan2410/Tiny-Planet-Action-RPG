import { Group, Vector3 } from 'three';
import {
  clamp,
  orientationFrom,
  surfaceHeight,
  PLANET_RADIUS,
  tangentise,
  walk,
} from '../core/SphereMath';
import { resolveBlockers, type Blocker } from '../world/Scatter';

/**
 * Anything that stands on the planet.
 *
 * Transform is `dir` (unit vector = where on the globe) plus `forward` (unit
 * tangent = which way it faces). Walking rotates both about `dir x forward`, an
 * exact great-circle step that parallel-transports the heading, so an actor can
 * cross a pole without its facing snapping.
 */
export abstract class Actor {
  readonly group = new Group();
  dir = new Vector3(0, 1, 0);
  forward = new Vector3(0, 0, -1);

  /** Body radius used for collision and hit checks, in world units. */
  radius = 0.45;
  /** How far the model's origin sits above the terrain. */
  footOffset = 0;

  maxHp = 10;
  hp = 10;
  dead = false;

  /** Decaying tangential push from hits, in world units per second. */
  protected knockHeading = new Vector3(1, 0, 0);
  protected knockSpeed = 0;
  /** Seconds of remaining damage immunity. */
  invulnerable = 0;
  /** Seconds of remaining stagger, during which the actor cannot act. */
  stagger = 0;

  constructor(dir: Vector3, forward?: Vector3) {
    this.dir.copy(dir).normalize();
    if (forward) tangentise(forward, this.dir, this.forward);
    else tangentise(new Vector3(0, 0, -1), this.dir, this.forward);
    this.syncTransform();
  }

  get up(): Vector3 {
    return this.dir;
  }

  /** World-space position of the model's origin (its feet). */
  get position(): Vector3 {
    return this.group.position;
  }

  /** World-space point roughly at chest height, for VFX and camera focus. */
  chestPoint(out = new Vector3()): Vector3 {
    return out.copy(this.dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(this.dir) + this.footOffset + this.radius * 1.6);
  }

  /** Move along the surface, carrying the heading with us. */
  move(heading: Vector3, distance: number): void {
    walk(this.dir, heading, distance, [this.forward]);
  }

  applyKnockback(heading: Vector3, speed: number): void {
    tangentise(heading, this.dir, this.knockHeading);
    this.knockSpeed = Math.max(this.knockSpeed, speed);
  }

  /** Integrate knockback and tick down timers. Call once per frame. */
  protected updateCommon(dt: number, blockers?: readonly Blocker[]): void {
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    if (this.knockSpeed > 0.02) {
      tangentise(this.knockHeading, this.dir, this.knockHeading);
      this.move(this.knockHeading, this.knockSpeed * dt);
      // Fast exponential falloff: a shove, not a slide.
      this.knockSpeed *= Math.pow(0.0006, dt);
    } else {
      this.knockSpeed = 0;
    }
    if (blockers && blockers.length) {
      resolveBlockers(this.dir, this.radius, blockers, [this.forward]);
    }
  }

  /** Push the sphere transform into the Object3D. */
  syncTransform(): void {
    const radius = PLANET_RADIUS + surfaceHeight(this.dir) + this.footOffset;
    this.group.position.copy(this.dir).multiplyScalar(radius);
    orientationFrom(this.dir, this.forward, this.group.quaternion);
  }

  /** @returns the damage actually taken. */
  takeDamage(amount: number): number {
    if (this.dead || this.invulnerable > 0) return 0;
    const dealt = Math.max(1, Math.round(amount));
    this.hp = clamp(this.hp - dealt, 0, this.maxHp);
    if (this.hp <= 0) this.dead = true;
    return dealt;
  }

  heal(amount: number): number {
    const before = this.hp;
    this.hp = clamp(this.hp + amount, 0, this.maxHp);
    return this.hp - before;
  }
}
