import { Color, Group, Mesh, PlaneGeometry, Vector3 } from 'three';
import { Actor } from './Actor';
import { buildBrute, buildMote, buildSpitter, buildWarden, type CharacterModel } from './Models';
import { flat } from '../render/ToonMaterials';
import type { GameContext } from '../core/Context';
import {
  arcAngle,
  clamp,
  headingTo,
  PLANET_RADIUS,
  randomNearby,
  rightOf,
  signedTangentAngle,
  turnTowards,
} from '../core/SphereMath';
import { mulberry32, type Rng } from '../core/Random';
import { enemyStats } from '../rpg/Stats';
import { resolveDamage } from '../rpg/Stats';
import type { BiomeId, EnemyKind } from '../rpg/Types';
import { actions, derivedStats } from '../state/gameState';

export type EnemyState =
  | 'idle'
  | 'patrol'
  | 'chase'
  | 'telegraph'
  | 'strike'
  | 'recover'
  | 'hurt'
  | 'return'
  | 'dead';

interface EnemyConfig {
  radius: number;
  footOffset: number;
  patrolSpeed: number;
  chaseSpeed: number;
  turnRate: number;
  aggroRadius: number;
  leashRadius: number;
  patrolRadius: number;
  attackRange: number;
  attackArc: number;
  /** Seconds of readable wind-up before the hit lands. */
  telegraph: number;
  strike: number;
  recover: number;
  damageMultiplier: number;
  knockback: number;
  staggerResist: number;
  ranged: boolean;
  /** Preferred distance for ranged enemies. */
  standoff: number;
  telegraphColour: number;
  barHeight: number;
}

const CONFIG: Record<EnemyKind, EnemyConfig> = {
  mote: {
    radius: 0.42,
    footOffset: 0.15,
    patrolSpeed: 2.2,
    chaseSpeed: 6.1,
    turnRate: 7,
    aggroRadius: 13,
    leashRadius: 26,
    patrolRadius: 7,
    attackRange: 1.55,
    attackArc: 1.1,
    telegraph: 0.34,
    strike: 0.16,
    recover: 0.46,
    damageMultiplier: 0.85,
    knockback: 4,
    staggerResist: 0,
    ranged: false,
    standoff: 0,
    telegraphColour: 0xff6b8a,
    barHeight: 1.45,
  },
  brute: {
    radius: 0.85,
    footOffset: 0,
    patrolSpeed: 1.5,
    chaseSpeed: 3.5,
    turnRate: 2.6,
    aggroRadius: 11,
    leashRadius: 28,
    patrolRadius: 6,
    attackRange: 2.7,
    attackArc: 0.95,
    telegraph: 0.82,
    strike: 0.24,
    recover: 0.95,
    damageMultiplier: 1.55,
    knockback: 11,
    staggerResist: 0.65,
    ranged: false,
    standoff: 0,
    telegraphColour: 0xff5a3c,
    barHeight: 2.6,
  },
  spitter: {
    radius: 0.55,
    footOffset: 0,
    patrolSpeed: 1.1,
    chaseSpeed: 2.3,
    turnRate: 3.4,
    aggroRadius: 16,
    leashRadius: 24,
    patrolRadius: 3.5,
    attackRange: 13,
    attackArc: 0.5,
    telegraph: 0.72,
    strike: 0.18,
    recover: 1.25,
    damageMultiplier: 1.05,
    knockback: 4,
    staggerResist: 0.2,
    ranged: true,
    standoff: 7.5,
    telegraphColour: 0xb46bff,
    barHeight: 2.1,
  },
  warden: {
    radius: 1.25,
    footOffset: 0,
    patrolSpeed: 1.3,
    chaseSpeed: 4.2,
    turnRate: 2.3,
    aggroRadius: 15,
    leashRadius: 40,
    patrolRadius: 5,
    attackRange: 3.5,
    attackArc: 1.15,
    telegraph: 0.95,
    strike: 0.28,
    recover: 1.0,
    damageMultiplier: 1.7,
    knockback: 15,
    staggerResist: 0.88,
    ranged: false,
    standoff: 0,
    telegraphColour: 0xff4a6a,
    barHeight: 3.7,
  },
};

let nextEnemyId = 1;

/**
 * Enemy AI: a small finite state machine.
 *
 *   idle → patrol → chase → telegraph → strike → recover → …
 *
 * with `return` when leashed and `hurt` on stagger. There is no pathfinding —
 * chasing just walks the great circle towards the player and lets prop collision
 * slide the body around obstacles, which is plenty for open biomes and keeps the
 * whole brain readable.
 *
 * Every attack is preceded by a wind-up the player can see and hear: the body
 * rears back, a coloured ring grows on the ground over exactly the danger area, and
 * a low warning tone plays. Making the tell honest matters more than roster size.
 */
export class Enemy extends Actor {
  readonly id = nextEnemyId++;
  readonly kind: EnemyKind;
  readonly biome: BiomeId;
  readonly model: CharacterModel;
  readonly config: EnemyConfig;
  /** Index of the spawn point that owns this enemy, for respawning. */
  spawnIndex = -1;

  state: EnemyState = 'idle';
  attack = 1;
  defense = 0;
  xpValue = 1;
  glimmerValue = 1;

  private ctx!: GameContext;
  private home: Vector3;
  private waypoint: Vector3;
  private stateTime = 0;
  private strikeDone = false;
  private idleTimer = 0;
  private flashTimer = 0;
  private freezeTimer = 0;
  private phase = 0;
  private rng: Rng;
  private bar: Group;
  private barFill: Mesh;
  private barTimer = 0;
  private despawnTimer = 0;
  private summonedAdds = false;
  private baseColour = new Color(0x000000);

  constructor(kind: EnemyKind, biome: BiomeId, dir: Vector3) {
    super(dir);
    this.kind = kind;
    this.biome = biome;
    this.config = CONFIG[kind];
    this.rng = mulberry32((this.id * 2654435761) >>> 0);

    this.model =
      kind === 'mote'
        ? buildMote()
        : kind === 'brute'
          ? buildBrute()
          : kind === 'spitter'
            ? buildSpitter()
            : buildWarden();
    this.group.add(this.model.root);
    this.radius = this.config.radius;
    this.footOffset = this.config.footOffset;

    const stats = enemyStats(kind, biome);
    this.maxHp = stats.maxHp;
    this.hp = stats.maxHp;
    this.attack = stats.attack;
    this.defense = stats.defense;
    this.xpValue = stats.xp;
    this.glimmerValue = stats.glimmer;

    this.home = dir.clone();
    this.waypoint = dir.clone();
    this.phase = this.rng() * Math.PI * 2;

    // Floating health bar, only shown after the enemy has been hit.
    this.bar = new Group();
    const back = new Mesh(new PlaneGeometry(1, 0.12), flat(0x1a1424, 0.75, { fog: false }));
    const fillGeometry = new PlaneGeometry(1, 0.1);
    fillGeometry.translate(0.5, 0, 0.002);
    this.barFill = new Mesh(fillGeometry, flat(kind === 'warden' ? 0xff6b8a : 0xff8a5c, 1, { fog: false }));
    this.barFill.position.x = -0.5;
    this.bar.add(back, this.barFill);
    this.bar.position.y = this.config.barHeight;
    this.bar.visible = false;
    this.bar.renderOrder = 8;
    this.group.add(this.bar);
  }

  attachContext(ctx: GameContext): void {
    this.ctx = ctx;
  }

  get isBoss(): boolean {
    return this.kind === 'warden';
  }

  get healthRatio(): number {
    return clamp(this.hp / this.maxHp, 0, 1);
  }

  /** True while the enemy is winding up — the UI dims nothing, but audio ducks. */
  get threatening(): boolean {
    return this.state === 'telegraph' || this.state === 'strike';
  }

  freeze(seconds: number): void {
    this.freezeTimer = Math.max(this.freezeTimer, seconds);
    if (this.state === 'telegraph' || this.state === 'strike') {
      this.state = 'recover';
      this.stateTime = 0;
    }
  }

  hurt(damage: number, fromHeading: Vector3, knockback: number, ctx: GameContext): void {
    if (this.dead) return;
    const dealt = this.takeDamage(damage);
    if (dealt <= 0) return;
    this.barTimer = 4;
    this.bar.visible = true;
    this.flashTimer = 0.16;
    ctx.floatText(this.chestPoint(_v5), `${dealt}`, 'enemy');
    ctx.vfx.burst(this.chestPoint(_v5), {
      count: 8,
      color: 0xffd08a,
      speed: 5.5,
      life: 0.34,
      size: 0.9,
      direction: fromHeading,
    });

    if (this.dead) {
      this.onDeath(ctx);
      return;
    }

    ctx.audio.play('enemyHurt', { pitch: this.kind === 'brute' ? 0.7 : this.kind === 'warden' ? 0.55 : 1.15 });
    this.applyKnockback(fromHeading, knockback * (1 - this.config.staggerResist));
    // Heavier enemies shrug off interruptions; motes get knocked clean out of a swing.
    if (this.rng() > this.config.staggerResist) {
      this.state = 'hurt';
      this.stateTime = 0;
      this.stagger = 0.24 * (1 - this.config.staggerResist * 0.6);
    }
  }

  private onDeath(ctx: GameContext): void {
    this.state = 'dead';
    this.despawnTimer = 1.1;
    this.bar.visible = false;
    ctx.audio.play('enemyDie', { pitch: this.kind === 'warden' ? 0.6 : this.kind === 'brute' ? 0.8 : 1.2 });
    ctx.vfx.burst(this.chestPoint(_v5), {
      count: this.isBoss ? 46 : 18,
      color: 0x9d5cff,
      speed: this.isBoss ? 12 : 7,
      life: 0.8,
      size: this.isBoss ? 1.8 : 1.1,
    });
    ctx.vfx.shockSphere(this.chestPoint(_v5), this.isBoss ? 7 : 2.4, 0x9d5cff, this.isBoss ? 0.9 : 0.45);
    if (this.isBoss) {
      ctx.shake(0.75);
      ctx.hitStop(0.22);
    }

    actions.gainXp(this.xpValue);
    actions.addGlimmer(this.glimmerValue);
    actions.recordKill(this.kind, this.biome);
    ctx.floatText(this.chestPoint(_v5), `+${this.xpValue} xp`, 'crit');
  }

  /** Once the fade-out is done the game can take this enemy out of the scene. */
  get readyToRemove(): boolean {
    return this.state === 'dead' && this.despawnTimer <= 0;
  }

  update(dt: number, rawDt: number, playerDir: Vector3): void {
    this.stateTime += dt;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.barTimer = Math.max(0, this.barTimer - dt);
    this.freezeTimer = Math.max(0, this.freezeTimer - dt);
    this.phase += dt;

    if (this.state === 'dead') {
      this.despawnTimer -= dt;
      this.poseDeath();
      this.model.root.scale.setScalar(Math.max(0.01, clamp(this.despawnTimer / 1.1, 0, 1)));
      this.model.rig.apply(rawDt, 0.12);
      this.syncTransform();
      return;
    }

    this.updateCommon(dt, this.ctx.blockers);
    this.updateMaterial();
    this.updateBar();

    if (this.freezeTimer > 0) {
      this.poseFrozen();
      this.model.rig.apply(rawDt, 0.2);
      this.syncTransform();
      return;
    }

    const distance = arcAngle(this.dir, playerDir) * PLANET_RADIUS;
    const homeDistance = arcAngle(this.dir, this.home) * PLANET_RADIUS;
    const playerAlive = !this.ctx.player.dead;

    switch (this.state) {
      case 'idle':
        this.tickIdle(dt, distance, playerAlive);
        break;
      case 'patrol':
        this.tickPatrol(dt, distance, playerAlive);
        break;
      case 'chase':
        this.tickChase(dt, distance, homeDistance, playerDir, playerAlive);
        break;
      case 'telegraph':
        this.tickTelegraph(dt, playerDir);
        break;
      case 'strike':
        this.tickStrike(dt, playerDir);
        break;
      case 'recover':
        this.tickRecover(dt, distance);
        break;
      case 'hurt':
        this.poseHurt();
        if (this.stateTime > 0.26) this.enter(distance < this.config.aggroRadius ? 'chase' : 'idle');
        break;
      case 'return':
        this.tickReturn(dt, homeDistance, distance, playerAlive);
        break;
    }

    if (this.isBoss && !this.summonedAdds && this.healthRatio < 0.5) {
      this.summonedAdds = true;
      this.summonAdds();
    }

    this.model.rig.apply(rawDt, this.state === 'telegraph' || this.state === 'strike' ? 0.045 : 0.1);
    this.syncTransform();
  }

  private enter(state: EnemyState): void {
    this.state = state;
    this.stateTime = 0;
    this.strikeDone = false;
  }

  private tickIdle(dt: number, distance: number, playerAlive: boolean): void {
    this.idleTimer -= dt;
    this.poseIdle();
    if (playerAlive && distance < this.config.aggroRadius) {
      this.enter('chase');
      this.ctx.audio.play('uiMove', { pitch: 0.6, gain: 0.25 });
      return;
    }
    if (this.idleTimer <= 0) {
      this.waypoint = randomNearby(this.rng, this.home, this.config.patrolRadius, 1.5);
      this.enter('patrol');
    }
  }

  private tickPatrol(dt: number, distance: number, playerAlive: boolean): void {
    if (playerAlive && distance < this.config.aggroRadius) {
      this.enter('chase');
      return;
    }
    const toWaypoint = arcAngle(this.dir, this.waypoint) * PLANET_RADIUS;
    if (toWaypoint < 0.6 || this.stateTime > 8) {
      this.idleTimer = 1.2 + this.rng() * 2.4;
      this.enter('idle');
      return;
    }
    const heading = headingTo(this.dir, this.waypoint, _v1);
    turnTowards(this.forward, heading, this.dir, this.config.turnRate * dt);
    if (this.stagger <= 0) this.move(this.forward, this.config.patrolSpeed * dt);
    this.poseWalk(dt, this.config.patrolSpeed);
  }

  private tickChase(
    dt: number,
    distance: number,
    homeDistance: number,
    playerDir: Vector3,
    playerAlive: boolean,
  ): void {
    if (!playerAlive || homeDistance > this.config.leashRadius) {
      this.enter('return');
      return;
    }
    if (distance > this.config.aggroRadius * 1.5) {
      this.enter('return');
      return;
    }

    const heading = headingTo(this.dir, playerDir, _v1);
    turnTowards(this.forward, heading, this.dir, this.config.turnRate * dt);

    const facing = Math.abs(signedTangentAngle(this.dir, this.forward, heading));
    const inRange = distance <= this.config.attackRange;

    if (this.config.ranged) {
      // Kite: back off when crowded, close in when too far.
      const standoff = this.config.standoff;
      if (distance < standoff * 0.75) {
        this.move(this.forward, -this.config.chaseSpeed * 0.7 * dt);
        this.poseWalk(dt, this.config.chaseSpeed * 0.7);
      } else if (distance > standoff * 1.25) {
        this.move(this.forward, this.config.chaseSpeed * dt);
        this.poseWalk(dt, this.config.chaseSpeed);
      } else {
        this.poseIdle();
      }
      if (inRange && facing < this.config.attackArc && this.stateTime > 0.35) this.beginTelegraph();
      return;
    }

    if (inRange && facing < 0.9) {
      this.beginTelegraph();
      return;
    }
    if (this.stagger <= 0) this.move(this.forward, this.config.chaseSpeed * dt);
    this.poseWalk(dt, this.config.chaseSpeed);
  }

  private beginTelegraph(): void {
    this.enter('telegraph');
    const colour = this.config.telegraphColour;
    this.ctx.audio.play('telegraph', {
      pitch: this.kind === 'warden' ? 0.7 : this.kind === 'brute' ? 0.85 : 1.35,
      gain: 0.9,
    });
    if (this.config.ranged) {
      this.ctx.vfx.ring(this.dir, 0.4, 1.5, this.config.telegraph, colour, 0.55);
    } else {
      // The ring grows to exactly the reach of the swing that is coming.
      const reach = this.config.attackRange + this.radius;
      this.ctx.vfx.ring(this.dir, 0.5, reach, this.config.telegraph, colour, 0.6);
    }
  }

  private tickTelegraph(dt: number, playerDir: Vector3): void {
    const heading = headingTo(this.dir, playerDir, _v1);
    // Wind-ups track slowly, so side-stepping a brute genuinely works.
    turnTowards(this.forward, heading, this.dir, this.config.turnRate * 0.35 * dt);
    this.poseTelegraph(clamp(this.stateTime / this.config.telegraph, 0, 1));
    if (this.stateTime >= this.config.telegraph) this.enter('strike');
  }

  private tickStrike(dt: number, playerDir: Vector3): void {
    this.poseStrike(clamp(this.stateTime / this.config.strike, 0, 1));
    if (!this.config.ranged && this.stagger <= 0) {
      this.move(this.forward, this.config.chaseSpeed * 0.55 * dt);
    }
    if (!this.strikeDone && this.stateTime >= this.config.strike * 0.4) {
      this.strikeDone = true;
      this.resolveStrike(playerDir);
    }
    if (this.stateTime >= this.config.strike) this.enter('recover');
  }

  private resolveStrike(playerDir: Vector3): void {
    const ctx = this.ctx;
    if (this.config.ranged) {
      const origin = this.chestPoint(_v5);
      const heading = headingTo(this.dir, playerDir, _v1).clone();
      const damage = resolveDamage(this.attack, 0, this.config.damageMultiplier, 0.05);
      ctx.spawnProjectile(origin, this.dir, heading, damage, 16);
      ctx.audio.play('spit');
      return;
    }

    ctx.audio.play('swingHeavy', { pitch: this.kind === 'warden' ? 0.6 : 0.9 });
    const reach = this.config.attackRange + this.radius;
    ctx.vfx.slash(this.dir, this.forward, reach, this.config.attackArc, this.config.telegraphColour, 0.6);

    const player = ctx.player;
    const distance = arcAngle(this.dir, player.dir) * PLANET_RADIUS;
    if (distance <= reach + player.radius) {
      const heading = headingTo(this.dir, player.dir, _v1);
      const angle = Math.abs(signedTangentAngle(this.dir, this.forward, heading));
      if (angle <= this.config.attackArc) {
        const damage = resolveDamage(this.attack, derivedStats().defense, this.config.damageMultiplier, 0.08);
        const dealt = player.takeDamage(damage);
        if (dealt > 0) player.applyKnockback(heading, this.config.knockback);
      }
    }

    if (this.isBoss) {
      // The warden's slam is an area attack: a shockwave on top of the arc.
      ctx.vfx.ring(this.dir, 1, reach + 1.4, 0.35, 0xff8a5c, 0.7);
      ctx.shake(0.45);
    }
  }

  private tickRecover(dt: number, distance: number): void {
    this.poseRecover(clamp(this.stateTime / this.config.recover, 0, 1));
    if (this.config.ranged) {
      // Shuffle sideways between shots so ranged fights are not static.
      if (this.stateTime > this.config.recover * 0.4) {
        const side = rightOf(this.forward, this.dir, _v2);
        this.move(side, (this.rng() > 0.5 ? 1 : -1) * this.config.patrolSpeed * dt * 0.8);
      }
    }
    if (this.stateTime >= this.config.recover) {
      this.enter(distance < this.config.aggroRadius * 1.4 ? 'chase' : 'idle');
    }
  }

  private tickReturn(dt: number, homeDistance: number, distance: number, playerAlive: boolean): void {
    if (playerAlive && distance < this.config.aggroRadius * 0.8) {
      this.enter('chase');
      return;
    }
    if (homeDistance < 1.2) {
      this.idleTimer = 0.8;
      this.enter('idle');
      // Coming home restores a little composure.
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.35);
      return;
    }
    const heading = headingTo(this.dir, this.home, _v1);
    turnTowards(this.forward, heading, this.dir, this.config.turnRate * dt);
    this.move(this.forward, this.config.patrolSpeed * 1.5 * dt);
    this.poseWalk(dt, this.config.patrolSpeed * 1.5);
  }

  private summonAdds(): void {
    this.ctx.notice('The warden calls the blight to it!', 'bad');
    this.ctx.audio.play('shrineCure', { pitch: 0.55, gain: 0.5 });
    for (let i = 0; i < 3; i++) {
      const spot = randomNearby(this.rng, this.dir, 6, 3);
      const add = new Enemy('mote', this.biome, spot);
      add.attachContext(this.ctx);
      this.ctx.enemies.push(add);
      this.group.parent?.add(add.group);
      this.ctx.vfx.shockSphere(add.chestPoint(_v5), 2.5, 0x9d5cff, 0.5);
    }
  }

  /* -------------------------------------------------------- appearance */

  private updateMaterial(): void {
    const material = this.model.material;
    if (this.flashTimer > 0) {
      material.emissive.setHex(0xffffff);
      material.emissiveIntensity = this.flashTimer / 0.16;
      return;
    }
    if (this.freezeTimer > 0) {
      material.emissive.setHex(0x5ca8ff);
      material.emissiveIntensity = 0.55;
      return;
    }
    if (this.state === 'telegraph') {
      // Pulse faster as the strike approaches — the visual half of the tell.
      const t = clamp(this.stateTime / this.config.telegraph, 0, 1);
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t * t * 22));
      material.emissive.setHex(this.config.telegraphColour);
      material.emissiveIntensity = pulse * 0.85;
      return;
    }
    if (this.state === 'strike') {
      material.emissive.setHex(this.config.telegraphColour);
      material.emissiveIntensity = 0.5;
      return;
    }
    material.emissive.copy(this.baseColour);
    material.emissiveIntensity = 0;
  }

  private updateBar(): void {
    if (this.barTimer <= 0 && !this.isBoss) {
      this.bar.visible = false;
      return;
    }
    if (this.hp >= this.maxHp && !this.isBoss) {
      this.bar.visible = false;
      return;
    }
    this.bar.visible = true;
    this.barFill.scale.x = Math.max(0.001, this.healthRatio);
    // Billboard towards the camera.
    const camera = this.ctx.camera.camera;
    this.bar.lookAt(camera.position);
  }

  /* -------------------------------------------------------------- poses */

  private poseIdle(): void {
    const pose = this.model.rig.target;
    pose.reset();
    const bob = Math.sin(this.phase * 2.1) * 0.5 + 0.5;
    switch (this.kind) {
      case 'mote':
        pose.offset[1] = Math.sin(this.phase * 2.4) * 0.12;
        pose.set('spikes', 0, this.phase * 1.4, 0);
        pose.set('core', Math.sin(this.phase) * 0.2, 0, Math.cos(this.phase * 0.8) * 0.2);
        break;
      case 'spitter':
        pose.set('stalk', Math.sin(this.phase * 1.1) * 0.12, 0, Math.cos(this.phase * 0.9) * 0.12);
        pose.set('head', 0, Math.sin(this.phase * 0.6) * 0.5, 0);
        break;
      default:
        pose.set('torso', 0.12 + bob * 0.04, Math.sin(this.phase * 0.5) * 0.08, 0);
        pose.set('head', -0.1, Math.sin(this.phase * 0.4) * 0.2, 0);
        pose.set('armL', 0.1, 0, 0.3);
        pose.set('armR', 0.1, 0, -0.3);
        pose.set('elbowL', -0.5, 0, 0);
        pose.set('elbowR', -0.5, 0, 0);
        pose.offset[1] = bob * 0.05;
        break;
    }
  }

  private poseWalk(dt: number, speed: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    const rate = 2 + speed * 1.7;
    this.phase += dt * rate;
    const swing = Math.sin(this.phase);
    switch (this.kind) {
      case 'mote':
        pose.offset[1] = Math.sin(this.phase * 1.6) * 0.18;
        pose.set('spikes', 0, this.phase * 2.2, 0);
        pose.set('core', swing * 0.25, 0, 0);
        pose.scale[1] = 1 + Math.sin(this.phase * 1.6) * 0.09;
        break;
      case 'spitter':
        pose.set('stalk', 0.14 + swing * 0.14, 0, 0);
        pose.set('head', -0.1, 0, swing * 0.1);
        pose.offset[1] = Math.abs(Math.sin(this.phase)) * 0.12;
        break;
      default: {
        const amplitude = this.kind === 'warden' ? 0.6 : 0.68;
        pose.set('hipL', swing * amplitude, 0, 0);
        pose.set('hipR', -swing * amplitude, 0, 0);
        pose.set('kneeL', -Math.max(0, -swing) * 0.7 - 0.15, 0, 0);
        pose.set('kneeR', -Math.max(0, swing) * 0.7 - 0.15, 0, 0);
        pose.set('armL', -swing * 0.5, 0, 0.35);
        pose.set('armR', swing * 0.5, 0, -0.35);
        pose.set('elbowL', -0.55, 0, 0);
        pose.set('elbowR', -0.55, 0, 0);
        pose.set('torso', 0.2, swing * 0.09, 0);
        pose.offset[1] = Math.abs(Math.sin(this.phase * 2)) * 0.07 - 0.03;
        break;
      }
    }
  }

  /** The wind-up: everything pulls back, away from where the hit will land. */
  private poseTelegraph(t: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    const p = t * t;
    switch (this.kind) {
      case 'mote':
        pose.offset[1] = 0.25 * p;
        pose.set('spikes', 0, this.phase * 6, 0);
        pose.scale[0] = 1 + 0.2 * p;
        pose.scale[2] = 1 + 0.2 * p;
        pose.scale[1] = 1 - 0.18 * p;
        break;
      case 'spitter':
        pose.set('stalk', -0.5 * p, 0, 0);
        pose.set('jawTop', -0.9 * p, 0, 0);
        pose.set('jawBottom', 0.7 * p, 0, 0);
        pose.set('head', -0.3 * p, 0, 0);
        break;
      default:
        pose.set('armR', -2.4 * p, 0, -0.3 * p);
        pose.set('armL', -1.6 * p, 0, 0.4 * p);
        pose.set('elbowR', -0.5 * p, 0, 0);
        pose.set('torso', -0.45 * p, 0.35 * p, 0);
        pose.set('head', -0.3 * p, 0, 0);
        pose.set('hipL', -0.25 * p, 0, 0);
        pose.set('hipR', -0.25 * p, 0, 0);
        pose.offset[1] = 0.18 * p;
        break;
    }
  }

  private poseStrike(t: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    const p = Math.min(1, t * 2.2);
    switch (this.kind) {
      case 'mote':
        pose.offset[1] = -0.2 * p;
        pose.scale[1] = 1 + 0.25 * p;
        pose.scale[0] = 1 - 0.15 * p;
        pose.scale[2] = 1 - 0.15 * p;
        pose.set('eye', 0.3 * p, 0, 0);
        break;
      case 'spitter':
        pose.set('stalk', 0.45 * p, 0, 0);
        pose.set('jawTop', -0.2, 0, 0);
        pose.set('jawBottom', 0.15, 0, 0);
        pose.set('head', 0.35 * p, 0, 0);
        break;
      default:
        pose.set('armR', 1.6 * p, 0, 0.2);
        pose.set('armL', 0.9 * p, 0, -0.2);
        pose.set('elbowR', -0.2, 0, 0);
        pose.set('torso', 0.55 * p, -0.3 * p, 0);
        pose.set('head', 0.3 * p, 0, 0);
        pose.set('hipL', 0.45 * p, 0, 0);
        pose.set('kneeL', -0.5 * p, 0, 0);
        pose.offset[1] = -0.22 * p;
        break;
    }
  }

  private poseRecover(t: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    const p = 1 - t;
    switch (this.kind) {
      case 'mote':
        pose.offset[1] = Math.sin(this.phase * 2.4) * 0.1;
        pose.scale[1] = 1 + 0.08 * p;
        break;
      case 'spitter':
        pose.set('stalk', 0.25 * p, 0, 0);
        pose.set('jawTop', -0.1 * p, 0, 0);
        break;
      default:
        pose.set('armR', 1.0 * p, 0, 0);
        pose.set('torso', 0.35 * p, 0, 0);
        pose.set('head', 0.15 * p, 0, 0);
        pose.offset[1] = -0.1 * p;
        break;
    }
  }

  private poseHurt(): void {
    const pose = this.model.rig.target;
    pose.reset();
    switch (this.kind) {
      case 'mote':
        pose.scale[0] = 1.2;
        pose.scale[1] = 0.8;
        pose.scale[2] = 1.2;
        break;
      case 'spitter':
        pose.set('stalk', -0.4, 0, 0.2);
        pose.set('head', -0.3, 0, 0);
        break;
      default:
        pose.set('torso', -0.3, 0, 0.14);
        pose.set('head', -0.25, 0, 0);
        pose.set('armL', -0.4, 0, 0.5);
        pose.set('armR', -0.4, 0, -0.5);
        break;
    }
  }

  private poseFrozen(): void {
    const pose = this.model.rig.target;
    pose.reset();
    pose.scale[0] = 1.02;
    pose.scale[1] = 0.98;
    pose.scale[2] = 1.02;
  }

  private poseDeath(): void {
    const pose = this.model.rig.target;
    pose.reset();
    switch (this.kind) {
      case 'mote':
        pose.scale[0] = 1.4;
        pose.scale[1] = 0.4;
        pose.scale[2] = 1.4;
        break;
      case 'spitter':
        pose.set('stalk', 1.3, 0, 0.4);
        pose.set('head', 0.5, 0, 0);
        break;
      default:
        pose.set('body', 1.5, 0, 0.2);
        pose.set('torso', -0.4, 0, 0);
        pose.set('armL', -0.6, 0, 1.0);
        pose.set('armR', -0.6, 0, -1.0);
        break;
    }
  }
}

const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();
const _v5 = /* @__PURE__ */ new Vector3();

export { CONFIG as ENEMY_CONFIG };
export type { EnemyConfig };
