import { Group, Mesh, Vector3, type BufferGeometry } from 'three';
import { GeoBuilder } from '../render/GeoBuilder';
import { outlineTree, toon } from '../render/ToonMaterials';
import { PRIMITIVES } from '../world/Props';
import {
  arcAngle,
  orientationFrom,
  PLANET_RADIUS,
  surfaceHeight,
  tangentise,
  walk,
} from '../core/SphereMath';
import type { GameContext } from '../core/Context';
import { ITEMS, type ItemId } from '../rpg/Items';
import { actions } from '../state/gameState';

const { ico, cyl, cone } = PRIMITIVES;

/**
 * Shared geometry for the things that spawn and die constantly.
 *
 * A spitter fires a bolt every couple of seconds and every kill can drop loot;
 * building fresh buffers for each and never disposing them leaked GPU memory for
 * the whole session. The shapes never vary, so they are built once.
 */
let boltGeometry: BufferGeometry | null = null;
const pickupGeometry = new Map<string, BufferGeometry>();

function getBoltGeometry(): BufferGeometry {
  if (!boltGeometry) {
    boltGeometry = new GeoBuilder()
      .place(ico(0), 0x9d5cff, [0, 0, 0], [0.22, 0.22, 0.22], [0, 0, 0], { emissiveBoost: 1 })
      .place(cone(0.12, 0.34, 5), 0x6b3a7a, [0, -0.18, 0], [1, 1, 1], [Math.PI, 0, 0])
      .build('bolt');
  }
  return boltGeometry;
}

function getPickupGeometry(drop: DropKind): BufferGeometry {
  const key = drop.kind === 'glimmer' ? 'glimmer' : ITEMS[drop.id].kind;
  let geometry = pickupGeometry.get(key);
  if (!geometry) {
    const builder = new GeoBuilder();
    if (drop.kind === 'glimmer') {
      builder.place(ico(0), 0xffe06b, [0, 0, 0], [0.19, 0.26, 0.19], [0, 0, 0], { emissiveBoost: 1 });
    } else {
      const item = ITEMS[drop.id];
      const colour = item.kind === 'quest' ? 0x9d5cff : item.kind === 'consumable' ? 0x7fe0a8 : 0x9fd8f0;
      builder.place(cyl(0.14, 0.18, 0.34, 6), colour, [0, 0, 0], [1, 1, 1], [0, 0, 0], { emissiveBoost: 0.55 });
      builder.place(ico(0), 0xffffff, [0, 0.24, 0], [0.11, 0.09, 0.11], [0, 0, 0], { emissiveBoost: 0.7 });
    }
    geometry = builder.build(`pickup:${key}`);
    pickupGeometry.set(key, geometry);
  }
  return geometry;
}

/**
 * A blight bolt: travels along a great circle at a fixed height above the ground.
 * Flat trajectories on a sphere are still curves, so it follows the surface rather
 * than flying in a straight line through the planet.
 */
export class Projectile {
  readonly mesh: Mesh;
  dir: Vector3;
  heading: Vector3;
  private life: number;
  private trailTimer = 0;

  constructor(
    dir: Vector3,
    heading: Vector3,
    readonly damage: number,
    readonly speed: number,
    readonly height: number,
  ) {
    this.dir = dir.clone().normalize();
    this.heading = tangentise(heading.clone(), this.dir);
    this.life = 3.2;
    this.mesh = new Mesh(getBoltGeometry(), toon({ vertexColors: true, steps: 3, flatShading: true }));
    this.mesh.castShadow = false;
    this.sync();
  }

  private sync(): void {
    this.mesh.position.copy(this.dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(this.dir) + this.height);
    orientationFrom(this.dir, this.heading, this.mesh.quaternion);
  }

  /** @returns false once the bolt is spent. */
  update(dt: number, ctx: GameContext): boolean {
    this.life -= dt;
    if (this.life <= 0) return false;
    walk(this.dir, this.heading, this.speed * dt, [this.heading]);
    this.sync();
    this.mesh.rotateY(dt * 9);

    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.04;
      ctx.vfx.mote(this.mesh.position, 0x9d5cff, 0.2, 0.35);
    }

    const player = ctx.player;
    if (!player.dead) {
      const distance = arcAngle(this.dir, player.dir) * PLANET_RADIUS;
      if (distance < player.radius + 0.55) {
        const dealt = player.takeDamage(this.damage);
        if (dealt > 0) player.applyKnockback(this.heading, 5);
        ctx.vfx.burst(this.mesh.position, { count: 10, color: 0x9d5cff, speed: 5, life: 0.4 });
        ctx.audio.play('hit', { pitch: 1.25 });
        return false;
      }
    }

    for (const blocker of ctx.blockers) {
      if (arcAngle(this.dir, blocker.dir) * PLANET_RADIUS < blocker.radius * 0.8) {
        ctx.vfx.burst(this.mesh.position, { count: 6, color: 0x9d5cff, speed: 3.5, life: 0.3 });
        return false;
      }
    }
    return true;
  }
}

export type DropKind = { kind: 'item'; id: ItemId; count: number } | { kind: 'glimmer'; amount: number };

/** A pickup sitting on the ground, collected by walking over it. */
export class Pickup {
  readonly group = new Group();
  readonly dir: Vector3;
  private phase = Math.random() * 6;
  private life = 75;
  private collected = false;

  constructor(
    dir: Vector3,
    readonly drop: DropKind,
  ) {
    this.dir = dir.clone().normalize();
    const mesh = new Mesh(getPickupGeometry(drop), toon({ vertexColors: true, steps: 3, flatShading: true }));
    mesh.castShadow = false;
    this.group.add(mesh);
    outlineTree(this.group, 0.018);
    this.sync(0);
  }

  private sync(bob: number): void {
    this.group.position
      .copy(this.dir)
      .multiplyScalar(PLANET_RADIUS + surfaceHeight(this.dir) + 0.5 + bob);
    orientationFrom(this.dir, tangentise(_v1.set(this.dir.y, this.dir.z, this.dir.x), this.dir, _v1), this.group.quaternion);
    this.group.rotateY(this.phase * 1.6);
  }

  /** @returns false once collected or expired. */
  update(dt: number, ctx: GameContext): boolean {
    if (this.collected) return false;
    this.phase += dt;
    this.life -= dt;
    if (this.life <= 0) return false;
    this.sync(Math.sin(this.phase * 2.2) * 0.12);

    const player = ctx.player;
    const distance = arcAngle(this.dir, player.dir) * PLANET_RADIUS;
    if (distance < player.radius + 1.0 && !player.dead) {
      this.collect(ctx);
      return false;
    }
    if (Math.random() < dt * 2.5) {
      ctx.vfx.mote(this.group.position, this.drop.kind === 'glimmer' ? 0xffe06b : 0x9fe8c8, 0.5, 0.7);
    }
    return true;
  }

  private collect(ctx: GameContext): void {
    this.collected = true;
    ctx.audio.play('pickup', { pitch: this.drop.kind === 'glimmer' ? 1.3 : 1 });
    ctx.vfx.burst(this.group.position, {
      count: 8,
      color: this.drop.kind === 'glimmer' ? 0xffe06b : 0x9fe8c8,
      speed: 3.6,
      life: 0.4,
      size: 0.8,
    });
    if (this.drop.kind === 'glimmer') {
      actions.addGlimmer(this.drop.amount);
      ctx.floatText(this.group.position, `+${this.drop.amount}`, 'crit');
    } else {
      actions.addItem(this.drop.id, this.drop.count);
      ctx.floatText(this.group.position, `${ITEMS[this.drop.id].name}`, 'heal');
    }
  }
}

const _v1 = /* @__PURE__ */ new Vector3();
