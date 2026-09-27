import { Vector3 } from 'three';
import { Actor } from './Actor';
import { buildHero, buildWeapon, type CharacterModel, type WeaponLook } from './Models';
import type { GameContext } from '../core/Context';
import {
  arcAngle,
  clamp,
  damp,
  headingTo,
  PLANET_RADIUS,
  rightOf,
  signedTangentAngle,
  surfaceHeight,
  tangentise,
  turnTowards,
} from '../core/SphereMath';
import { actions, derivedStats, getState, type DerivedStats } from '../state/gameState';
import { ITEMS, SPECIALS, type SpecialId } from '../rpg/Items';
import { resolveDamage } from '../rpg/Stats';

export type PlayerState = 'idle' | 'run' | 'attack' | 'dodge' | 'special' | 'hurt' | 'dead' | 'locked';

interface Swing {
  windup: number;
  active: number;
  recover: number;
  multiplier: number;
  lunge: number;
  reach: number;
  arc: number;
  heavy?: boolean;
}

/** Three-hit combo: two quick cuts and a committed finisher. */
const COMBO: Swing[] = [
  { windup: 0.1, active: 0.1, recover: 0.2, multiplier: 1.0, lunge: 1.1, reach: 2.25, arc: 1.0 },
  { windup: 0.08, active: 0.1, recover: 0.2, multiplier: 1.15, lunge: 1.2, reach: 2.25, arc: 1.1 },
  { windup: 0.17, active: 0.13, recover: 0.34, multiplier: 1.85, lunge: 1.8, reach: 2.7, arc: 1.3, heavy: true },
];

const WALK_SPEED = 4.8;
const SPRINT_SPEED = 7.6;
const DODGE_SPEED = 13.5;
const DODGE_DURATION = 0.44;
const DODGE_IFRAME_START = 0.04;
const DODGE_IFRAME_END = 0.32;
const STAMINA_REGEN = 23;
const STAMINA_DELAY = 0.5;
const SPRINT_DRAIN = 12;
const ATTACK_COSTS = [10, 10, 16];
const DODGE_COST = 24;
const RESPAWN_DELAY = 2.6;

export class Player extends Actor {
  readonly model: CharacterModel;
  state: PlayerState = 'idle';

  private ctx!: GameContext;
  private stateTime = 0;
  private comboIndex = 0;
  private comboQueued = false;
  private comboWindow = 0;
  private swingHit = false;
  private staminaTimer = 0;
  private specialCooldown = 0;
  private deathTimer = 0;
  private speed = 0;
  private stepTimer = 0;
  private weaponLook: WeaponLook = 'none';
  private legPhase = 0;
  private rollAngle = 0;
  /** Set for a frame when a dodge's i-frames ate an attack. */
  dodgedThisRoll = false;
  private stats: DerivedStats;
  private homeDir: Vector3;

  constructor(dir: Vector3, forward: Vector3, homeDir: Vector3) {
    super(dir, forward);
    this.model = buildHero();
    this.group.add(this.model.root);
    this.radius = 0.42;
    this.footOffset = 0;
    this.homeDir = homeDir.clone().normalize();
    this.stats = derivedStats();
    this.maxHp = this.stats.maxHp;
    this.hp = getState().hp;
    this.syncWeapon();
  }

  attach(ctx: GameContext): void {
    this.ctx = ctx;
  }

  get stamina(): number {
    return getState().stamina;
  }

  get invulnerableFromDodge(): boolean {
    return (
      this.state === 'dodge' && this.stateTime >= DODGE_IFRAME_START && this.stateTime <= DODGE_IFRAME_END
    );
  }

  /** Current ground speed in world units per second. */
  get groundSpeed(): number {
    return this.speed;
  }

  /** Seconds spent in the current state. */
  get timeInState(): number {
    return this.stateTime;
  }

  /** 1 while the special is fully on cooldown, 0 when it is ready. */
  get specialCooldownRatio(): number {
    const special = SPECIALS[this.stats.special];
    if (!special || special.cooldown <= 0) return 0;
    return clamp(this.specialCooldown / special.cooldown, 0, 1);
  }

  get busy(): boolean {
    return this.state === 'attack' || this.state === 'special' || this.state === 'dodge' || this.state === 'hurt';
  }

  /** Rebuild the weapon in hand when equipment changes. */
  syncWeapon(): void {
    const id = getState().equipped.weapon;
    const look: WeaponLook = id ? ITEMS[id].look ?? 'none' : 'none';
    if (look === this.weaponLook) return;
    this.weaponLook = look;
    const socket = this.model.socket;
    if (!socket) return;
    for (const child of [...socket.children]) socket.remove(child);
    if (look !== 'none') socket.add(buildWeapon(look, this.model.material));
  }

  /** Lock input, e.g. while a dialogue is open. */
  setLocked(locked: boolean): void {
    if (locked && this.state !== 'dead') {
      this.state = 'locked';
      this.speed = 0;
    } else if (!locked && this.state === 'locked') {
      this.state = 'idle';
    }
  }

  update(dt: number, rawDt: number): void {
    this.stats = derivedStats();
    this.maxHp = this.stats.maxHp;
    this.hp = getState().hp;
    this.stateTime += dt;
    this.specialCooldown = Math.max(0, this.specialCooldown - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.updateCommon(dt, this.ctx.blockers);

    if (this.state === 'dead') {
      this.deathTimer -= dt;
      this.poseDead(dt);
      if (this.deathTimer <= 0) this.respawn();
      this.syncTransform();
      return;
    }

    if (this.state !== 'locked') {
      this.handleInput(dt);
      this.updateState(dt);
    } else {
      this.speed *= Math.pow(0.001, dt);
      this.poseIdle(dt);
    }

    this.regenStamina(dt);
    this.syncTransform();
    this.model.rig.apply(rawDt, this.rigHalfLife());
  }

  private rigHalfLife(): number {
    switch (this.state) {
      case 'attack':
        return 0.03;
      case 'special':
        return 0.035;
      case 'dodge':
        return 0.02;
      case 'hurt':
        return 0.05;
      default:
        return 0.085;
    }
  }

  /* ------------------------------------------------------------ input */

  private handleInput(dt: number): void {
    const input = this.ctx.input;

    if (input.pressed('dodge')) this.tryDodge();
    if (input.pressed('attack')) this.tryAttack();
    if (input.pressed('special')) this.trySpecial();

    if (this.state === 'idle' || this.state === 'run') {
      this.handleLocomotion(dt);
    } else if (this.state === 'attack') {
      // A trickle of steering during the wind-up keeps swings from feeling stuck.
      const swing = COMBO[this.comboIndex];
      const windup = swing.windup / this.stats.swingSpeed;
      if (this.stateTime < windup) this.steer(dt, 3.2, 0);
    }
  }

  private handleLocomotion(dt: number): void {
    const input = this.ctx.input;
    const wantsMove = Math.abs(input.moveX) > 0.02 || Math.abs(input.moveY) > 0.02;
    const sprinting = wantsMove && input.down('sprint') && this.stamina > 1;
    const targetSpeed = wantsMove ? (sprinting ? SPRINT_SPEED : WALK_SPEED) : 0;

    if (sprinting) this.spendStamina(SPRINT_DRAIN * dt, false);

    this.speed += (targetSpeed - this.speed) * damp(dt, 0.07);
    if (wantsMove) this.steer(dt, 11, 1);

    if (this.speed > 0.05) {
      this.move(this.forward, this.speed * dt);
      this.state = 'run';
      this.poseRun(dt, sprinting);
      this.footsteps(dt);
    } else {
      this.state = 'idle';
      this.poseIdle(dt);
    }
    this.ctx.camera.setDistanceBias(sprinting ? 0.9 : 0);
  }

  /** Turn towards the camera-relative input direction. */
  private steer(dt: number, turnRate: number, _weight: number): void {
    const input = this.ctx.input;
    if (Math.abs(input.moveX) < 0.02 && Math.abs(input.moveY) < 0.02) return;
    const camForward = tangentise(_v1.copy(this.ctx.camera.forwardTangent), this.dir, _v1);
    const camRight = rightOf(camForward, this.dir, _v2);
    _desired.copy(camForward).multiplyScalar(input.moveY).addScaledVector(camRight, input.moveX);
    if (_desired.lengthSq() < 1e-6) return;
    tangentise(_desired, this.dir, _desired);
    turnTowards(this.forward, _desired, this.dir, turnRate * dt);
  }

  private footsteps(dt: number): void {
    this.stepTimer -= dt * (this.speed / WALK_SPEED);
    if (this.stepTimer <= 0) {
      this.stepTimer = 0.34;
      this.ctx.audio.play('footstep', { pitch: 0.9 + Math.random() * 0.25, gain: 0.7 });
      const point = _v3.copy(this.dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(this.dir) + 0.1);
      this.ctx.vfx.burst(point, { count: 2, color: 0xd8cdb4, speed: 1.4, life: 0.3, size: 0.5, gravity: 6 });
    }
  }

  /* ----------------------------------------------------------- combat */

  private spendStamina(amount: number, resetDelay = true): boolean {
    const state = getState();
    if (state.stamina < amount) return false;
    actions.setVitals(state.hp, state.stamina - amount);
    if (resetDelay) this.staminaTimer = STAMINA_DELAY;
    return true;
  }

  private regenStamina(dt: number): void {
    this.staminaTimer = Math.max(0, this.staminaTimer - dt);
    if (this.staminaTimer > 0) return;
    const state = getState();
    if (state.stamina >= this.stats.maxStamina) return;
    actions.setVitals(state.hp, state.stamina + STAMINA_REGEN * this.stats.staminaRegen * dt);
  }

  private tryAttack(): void {
    if (this.state === 'dead' || this.state === 'hurt' || this.state === 'locked') return;
    if (this.state === 'dodge' || this.state === 'special') return;
    if (this.state === 'attack') {
      // Buffer the next swing; it fires when the current one is past its active frames.
      if (this.comboWindow > 0) this.comboQueued = true;
      return;
    }
    this.beginSwing(0);
  }

  private beginSwing(index: number): void {
    const cost = ATTACK_COSTS[Math.min(index, ATTACK_COSTS.length - 1)];
    if (!this.spendStamina(cost)) {
      this.ctx.audio.play('hitBlocked', { pitch: 0.7, gain: 0.5 });
      return;
    }
    this.comboIndex = clamp(index, 0, COMBO.length - 1);
    this.state = 'attack';
    this.stateTime = 0;
    this.swingHit = false;
    this.comboQueued = false;
    this.comboWindow = 0;
    this.faceNearestEnemy();
    const swing = COMBO[this.comboIndex];
    this.ctx.audio.play(swing.heavy ? 'swingHeavy' : 'swing', {
      pitch: 0.92 + this.comboIndex * 0.12,
    });
  }

  /** Snap towards a nearby enemy so swings connect the way the player expects. */
  private faceNearestEnemy(): void {
    let best: { dir: Vector3; score: number } | null = null;
    for (const enemy of this.ctx.enemies) {
      if (enemy.dead) continue;
      const distance = arcAngle(this.dir, enemy.dir) * PLANET_RADIUS;
      if (distance > 5) continue;
      const heading = headingTo(this.dir, enemy.dir, _v4);
      const angle = Math.abs(signedTangentAngle(this.dir, this.forward, heading));
      if (angle > 1.25) continue;
      const score = distance + angle * 2.2;
      if (!best || score < best.score) best = { dir: heading.clone(), score };
    }
    if (best) turnTowards(this.forward, best.dir, this.dir, 1.1);
  }

  private trySpecial(): void {
    if (this.busy || this.state === 'dead' || this.state === 'locked') return;
    const specialId: SpecialId = this.stats.special;
    const special = SPECIALS[specialId];
    if (!special || specialId === 'none') return;
    if (this.specialCooldown > 0) {
      this.ctx.audio.play('hitBlocked', { pitch: 0.6, gain: 0.4 });
      return;
    }
    if (!this.spendStamina(special.staminaCost)) {
      this.ctx.audio.play('hitBlocked', { pitch: 0.7, gain: 0.5 });
      this.ctx.notice('Not enough stamina', 'bad');
      return;
    }
    this.state = 'special';
    this.stateTime = 0;
    this.swingHit = false;
    this.specialCooldown = special.cooldown;
    this.faceNearestEnemy();
    this.ctx.audio.play('cast', { pitch: specialId === 'quake' ? 0.7 : 1 });
  }

  private tryDodge(): void {
    if (this.state === 'dead' || this.state === 'locked' || this.state === 'dodge') return;
    if (this.state === 'attack' && this.stateTime < COMBO[this.comboIndex].windup) return;
    const cost = DODGE_COST * this.stats.dodgeCost;
    if (!this.spendStamina(cost)) {
      this.ctx.audio.play('hitBlocked', { pitch: 0.8, gain: 0.45 });
      return;
    }
    // Roll towards the stick if it is pushed, otherwise straight ahead.
    const input = this.ctx.input;
    if (Math.abs(input.moveX) > 0.02 || Math.abs(input.moveY) > 0.02) {
      const camForward = tangentise(_v1.copy(this.ctx.camera.forwardTangent), this.dir, _v1);
      const camRight = rightOf(camForward, this.dir, _v2);
      _desired.copy(camForward).multiplyScalar(input.moveY).addScaledVector(camRight, input.moveX);
      tangentise(_desired, this.dir, _desired);
      this.forward.copy(_desired);
    }
    this.state = 'dodge';
    this.stateTime = 0;
    this.rollAngle = 0;
    this.dodgedThisRoll = false;
    this.knockSpeed = 0;
    this.ctx.audio.play('dodge');
  }

  private updateState(dt: number): void {
    switch (this.state) {
      case 'attack':
        this.updateAttack(dt);
        break;
      case 'special':
        this.updateSpecial(dt);
        break;
      case 'dodge':
        this.updateDodge(dt);
        break;
      case 'hurt':
        this.poseHurt(dt);
        if (this.stateTime > 0.32) this.state = 'idle';
        break;
      default:
        break;
    }
  }

  private updateAttack(dt: number): void {
    const swing = COMBO[this.comboIndex];
    const speed = this.stats.swingSpeed;
    const windup = swing.windup / speed;
    const active = windup + swing.active / speed;
    const recover = active + swing.recover / speed;
    const t = this.stateTime;

    if (t < windup) {
      this.poseSwingWindup(t / windup);
    } else if (t < active) {
      const phase = (t - windup) / (active - windup);
      this.poseSwingStrike(phase);
      // Step into the swing.
      this.move(this.forward, swing.lunge * (1 - phase) * dt * 5.5);
      if (!this.swingHit) {
        this.swingHit = true;
        this.resolveSwing(swing);
      }
    } else if (t < recover) {
      this.poseSwingRecover((t - active) / (recover - active));
      this.comboWindow = 0.28;
      if (this.comboQueued && this.comboIndex < COMBO.length - 1) {
        this.beginSwing(this.comboIndex + 1);
      }
    } else {
      this.state = 'idle';
      this.comboIndex = 0;
    }
  }

  private resolveSwing(swing: Swing): void {
    const reach = swing.reach + this.stats.reachBonus;
    const halfArc = swing.arc + this.stats.arcBonus;
    this.ctx.vfx.slash(this.dir, this.forward, reach, halfArc, swing.heavy ? 0xffd28a : 0xfff4d8, 0.95);

    let connected = 0;
    for (const enemy of this.ctx.enemies) {
      if (enemy.dead) continue;
      const distance = arcAngle(this.dir, enemy.dir) * PLANET_RADIUS;
      if (distance > reach + enemy.radius) continue;
      const heading = headingTo(this.dir, enemy.dir, _v4);
      const angle = Math.abs(signedTangentAngle(this.dir, this.forward, heading));
      if (angle > halfArc) continue;
      const damage = resolveDamage(this.stats.attack, enemy.defense, swing.multiplier, 0.08);
      enemy.hurt(damage, this.forward, swing.heavy ? 12 : 7, this.ctx);
      connected++;
    }

    if (connected > 0) {
      this.ctx.hitStop(swing.heavy ? 0.1 : 0.055);
      this.ctx.shake(swing.heavy ? 0.28 : 0.13);
      this.ctx.audio.play(swing.heavy ? 'hitHeavy' : 'hit', { pitch: 0.95 + Math.random() * 0.15 });
    }
  }

  private updateSpecial(dt: number): void {
    const special = SPECIALS[this.stats.special];
    const windup = 0.22;
    const active = 0.34;
    const total = 0.72;
    const t = this.stateTime;

    if (t < windup) {
      this.poseSpecialWindup(t / windup, special.id);
    } else if (t < active) {
      this.poseSpecialStrike((t - windup) / (active - windup), special.id);
      if (!this.swingHit) {
        this.swingHit = true;
        this.resolveSpecial();
      }
    } else if (t < total) {
      this.poseSwingRecover((t - active) / (total - active));
    } else {
      this.state = 'idle';
    }
    if (this.state === 'special' && special.id === 'flameArc' && t < active) {
      this.move(this.forward, dt * 3.2);
    }
  }

  private resolveSpecial(): void {
    const special = SPECIALS[this.stats.special];
    const reach = special.reach + this.stats.reachBonus;
    const colour =
      special.id === 'flameArc'
        ? 0xff9a46
        : special.id === 'frostNova'
          ? 0x9fe4ff
          : special.id === 'quake'
            ? 0xc9a0ff
            : 0xfff0c0;

    this.ctx.vfx.slash(this.dir, this.forward, reach, special.arc, colour, 0.8);
    if (special.arc >= Math.PI - 0.01) {
      this.ctx.vfx.ring(this.dir, 0.6, reach, 0.4, colour, 0.75);
    }
    const chest = this.chestPoint(_v5);
    this.ctx.vfx.burst(chest, { count: 18, color: colour, speed: 8, life: 0.55, size: 1.2 });

    let connected = 0;
    for (const enemy of this.ctx.enemies) {
      if (enemy.dead) continue;
      const distance = arcAngle(this.dir, enemy.dir) * PLANET_RADIUS;
      if (distance > reach + enemy.radius) continue;
      if (special.arc < Math.PI - 0.01) {
        const heading = headingTo(this.dir, enemy.dir, _v4);
        const angle = Math.abs(signedTangentAngle(this.dir, this.forward, heading));
        if (angle > special.arc) continue;
      }
      const damage = resolveDamage(this.stats.attack, enemy.defense, special.multiplier, 0.06);
      const away = headingTo(this.dir, enemy.dir, _v4);
      enemy.hurt(damage, away, 14, this.ctx);
      if (special.id === 'frostNova') enemy.freeze(2.4);
      connected++;
    }

    if (connected > 0) {
      this.ctx.hitStop(0.12);
      this.ctx.shake(0.4);
      this.ctx.audio.play('hitHeavy', { pitch: 0.85 });
    }
  }

  private updateDodge(dt: number): void {
    const t = this.stateTime;
    const phase = clamp(t / DODGE_DURATION, 0, 1);
    // Fast at the start, coasting by the end.
    const speed = DODGE_SPEED * (1 - phase) * (1 - phase * 0.4);
    this.move(this.forward, speed * dt);
    this.rollAngle -= dt / DODGE_DURATION * Math.PI * 2;
    this.poseRoll(phase);
    if (phase < 0.6 && Math.random() < dt * 30) {
      const point = _v3.copy(this.dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(this.dir) + 0.12);
      this.ctx.vfx.burst(point, { count: 1, color: 0xe8dcc0, speed: 1.2, life: 0.35, size: 0.6, gravity: 5 });
    }
    if (t >= DODGE_DURATION) {
      this.state = 'idle';
      this.rollAngle = 0;
    }
  }

  /* ----------------------------------------------------------- damage */

  override takeDamage(amount: number): number {
    if (this.dead || this.state === 'dead') return 0;
    if (this.invulnerableFromDodge) {
      if (!this.dodgedThisRoll) {
        this.dodgedThisRoll = true;
        actions.recordPerfectDodge();
        this.ctx.notice('Clean dodge!', 'good');
        this.ctx.audio.play('uiMove', { pitch: 1.6 });
        const chest = this.chestPoint(_v5);
        this.ctx.floatText(chest, 'dodge', 'heal');
      }
      return 0;
    }
    if (this.invulnerable > 0) return 0;

    const state = getState();
    const dealt = Math.max(1, Math.round(amount));
    const hp = Math.max(0, state.hp - dealt);
    actions.setVitals(hp, state.stamina);
    this.hp = hp;
    this.invulnerable = 0.55;
    this.ctx.audio.play('hurt');
    this.ctx.shake(0.35);
    this.ctx.hitStop(0.07);
    this.ctx.floatText(this.chestPoint(_v5), `-${dealt}`, 'player');

    if (hp <= 0) {
      this.die();
    } else {
      this.state = 'hurt';
      this.stateTime = 0;
    }
    return dealt;
  }

  private die(): void {
    this.state = 'dead';
    this.dead = true;
    this.stateTime = 0;
    this.deathTimer = RESPAWN_DELAY;
    this.speed = 0;
    actions.recordDefeat();
    this.ctx.audio.play('death');
    this.ctx.notice('You fall. The hearth calls you back.', 'bad');
  }

  private respawn(): void {
    const stats = derivedStats();
    this.dir.copy(this.homeDir);
    tangentise(_v1.set(0, 0, -1), this.dir, this.forward);
    this.dead = false;
    this.state = 'idle';
    this.stateTime = 0;
    this.knockSpeed = 0;
    this.invulnerable = 1.6;
    this.rollAngle = 0;
    actions.setVitals(Math.max(1, Math.round(stats.maxHp * 0.6)), stats.maxStamina);
    this.hp = getState().hp;
    this.model.rig.target.reset();
    this.model.rig.snap();
    this.ctx.camera.reset(this.dir, this.forward);
    this.ctx.notice('You wake by the hearth, aching but whole.', 'info');
  }

  /* ------------------------------------------------------------- poses */

  private poseIdle(dt: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    this.legPhase += dt * 1.4;
    const breathe = Math.sin(this.legPhase) * 0.035;
    pose.set('torso', breathe * 0.6, 0, 0);
    pose.set('head', -breathe * 0.5, Math.sin(this.legPhase * 0.43) * 0.16, 0);
    pose.set('armL', 0.06, 0, 0.16 + breathe);
    pose.set('armR', 0.06, 0, -0.16 - breathe);
    pose.set('elbowL', -0.22, 0, 0);
    pose.set('elbowR', -0.3, 0, 0);
    pose.offset[1] = breathe * 0.4;
  }

  private poseRun(dt: number, sprinting: boolean): void {
    const pose = this.model.rig.target;
    pose.reset();
    const rate = sprinting ? 12.5 : 9.5;
    this.legPhase += dt * rate;
    const swing = Math.sin(this.legPhase);
    const swing2 = Math.sin(this.legPhase * 2);
    const amplitude = sprinting ? 1.0 : 0.78;

    pose.set('hipL', swing * 0.85 * amplitude, 0, 0);
    pose.set('hipR', -swing * 0.85 * amplitude, 0, 0);
    pose.set('kneeL', -Math.max(0, -swing) * 1.1 * amplitude - 0.12, 0, 0);
    pose.set('kneeR', -Math.max(0, swing) * 1.1 * amplitude - 0.12, 0, 0);
    pose.set('armL', -swing * 0.8 * amplitude, 0, 0.22);
    pose.set('armR', swing * 0.8 * amplitude, 0, -0.22);
    pose.set('elbowL', -0.5, 0, 0);
    pose.set('elbowR', -0.6, 0, 0);
    pose.set('torso', 0.16 + (sprinting ? 0.12 : 0), swing * 0.1, 0);
    pose.set('head', -0.12, swing * 0.06, 0);
    pose.offset[1] = Math.abs(swing2) * 0.06 - 0.02;
  }

  private poseSwingWindup(phase: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    const p = phase * phase;
    const even = this.comboIndex % 2 === 0;
    const side = even ? 1 : -1;
    pose.set('torso', -0.12 * p, side * 0.65 * p, 0);
    pose.set('armR', -1.9 * p, -0.5 * p * side, -0.6 * p);
    pose.set('elbowR', -0.9 * p, 0, 0);
    pose.set('armL', 0.4 * p, 0, 0.5);
    pose.set('head', -0.1 * p, side * 0.3 * p, 0);
    pose.set('hipL', -0.2 * p, 0, 0);
    pose.set('hipR', 0.2 * p, 0, 0);
    pose.offset[1] = -0.06 * p;
  }

  private poseSwingStrike(phase: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    const p = Math.min(1, phase * 1.6);
    const even = this.comboIndex % 2 === 0;
    const side = even ? 1 : -1;
    const heavy = this.comboIndex === 2;
    pose.set('torso', 0.22 + (heavy ? 0.2 : 0), -side * (0.7 + p * 0.5), 0);
    pose.set('armR', heavy ? 1.1 + p * 0.6 : 0.4 + p * 0.9, side * 0.4, side * (0.9 - p * 1.4));
    pose.set('elbowR', -0.25, 0, 0);
    pose.set('armL', -0.5 * p, 0, 0.75);
    pose.set('elbowL', -0.8, 0, 0);
    pose.set('head', 0.16, -side * 0.35, 0);
    pose.set('hipL', 0.35 * p, 0, 0);
    pose.set('hipR', -0.3 * p, 0, 0);
    pose.offset[1] = -0.1;
  }

  private poseSwingRecover(phase: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    const p = 1 - phase;
    const side = this.comboIndex % 2 === 0 ? 1 : -1;
    pose.set('torso', 0.18 * p, -side * 0.45 * p, 0);
    pose.set('armR', 0.7 * p, 0, -0.3 * p);
    pose.set('elbowR', -0.35, 0, 0);
    pose.set('armL', -0.2 * p, 0, 0.4);
    pose.offset[1] = -0.05 * p;
  }

  private poseSpecialWindup(phase: number, special: SpecialId): void {
    const pose = this.model.rig.target;
    pose.reset();
    const p = phase * phase;
    if (special === 'quake' || special === 'frostNova') {
      pose.set('armR', -2.5 * p, 0, 0);
      pose.set('armL', -2.2 * p, 0, 0.3);
      pose.set('torso', -0.3 * p, 0, 0);
      pose.offset[1] = 0.12 * p;
    } else if (special === 'flameArc') {
      pose.set('armR', -0.9 * p, -0.7 * p, -0.4 * p);
      pose.set('torso', -0.1 * p, 0.8 * p, 0);
      pose.offset[1] = -0.08 * p;
    } else {
      pose.set('armR', -0.4 * p, -1.1 * p, -1.0 * p);
      pose.set('torso', 0, 1.1 * p, 0);
    }
    pose.set('head', -0.2 * p, 0, 0);
  }

  private poseSpecialStrike(phase: number, special: SpecialId): void {
    const pose = this.model.rig.target;
    pose.reset();
    const p = Math.min(1, phase * 1.8);
    if (special === 'quake' || special === 'frostNova') {
      pose.set('armR', 1.5 * p, 0, 0);
      pose.set('armL', 1.2 * p, 0, 0.3);
      pose.set('torso', 0.5 * p, 0, 0);
      pose.set('hipL', 0.5 * p, 0, 0);
      pose.set('hipR', 0.5 * p, 0, 0);
      pose.set('kneeL', -0.9 * p, 0, 0);
      pose.set('kneeR', -0.9 * p, 0, 0);
      pose.offset[1] = -0.3 * p;
    } else if (special === 'flameArc') {
      pose.set('armR', 0.2, 1.1 * p, -1.2 * p);
      pose.set('torso', 0.2, -0.9 * p, 0);
      pose.set('hipL', 0.6 * p, 0, 0);
      pose.offset[1] = -0.12;
    } else {
      // Spin cut: whip the whole body round.
      pose.set('body', 0, -Math.PI * 2 * p, 0);
      pose.set('armR', 0.2, 0, -1.4);
      pose.set('armL', 0.2, 0, 1.4);
      pose.set('torso', 0.12, 0, 0);
    }
  }

  private poseRoll(phase: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    pose.set('body', this.rollAngle, 0, 0);
    const tuck = Math.sin(Math.min(1, phase * 1.25) * Math.PI);
    pose.set('torso', 0.7 * tuck, 0, 0);
    pose.set('head', 0.5 * tuck, 0, 0);
    pose.set('hipL', -1.5 * tuck, 0, 0);
    pose.set('hipR', -1.5 * tuck, 0, 0);
    pose.set('kneeL', -1.5 * tuck, 0, 0);
    pose.set('kneeR', -1.5 * tuck, 0, 0);
    pose.set('armL', -1.1 * tuck, 0, 0.5);
    pose.set('armR', -1.1 * tuck, 0, -0.5);
    pose.offset[1] = 0.42 * tuck;
  }

  private poseHurt(_dt: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    pose.set('torso', -0.42, 0, 0.12);
    pose.set('head', -0.35, 0, 0);
    pose.set('armL', -0.8, 0, 0.5);
    pose.set('armR', -0.7, 0, -0.45);
    pose.set('hipL', 0.3, 0, 0);
    pose.set('hipR', -0.2, 0, 0);
    pose.offset[1] = -0.12;
  }

  private poseDead(dt: number): void {
    const pose = this.model.rig.target;
    pose.reset();
    const fall = clamp((RESPAWN_DELAY - this.deathTimer) / 0.5, 0, 1);
    pose.set('body', fall * 1.45, 0, 0);
    pose.set('torso', -0.3, 0, 0);
    pose.set('head', 0.3, 0, 0);
    pose.set('armL', -0.5, 0, 1.1);
    pose.set('armR', -0.5, 0, -1.1);
    pose.set('hipL', 0.4, 0, 0);
    pose.set('hipR', 0.2, 0, 0);
    pose.offset[1] = -0.28 * fall;
    this.model.rig.apply(dt, 0.14);
  }
}

const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();
const _v3 = /* @__PURE__ */ new Vector3();
const _v4 = /* @__PURE__ */ new Vector3();
const _v5 = /* @__PURE__ */ new Vector3();
const _desired = /* @__PURE__ */ new Vector3();
