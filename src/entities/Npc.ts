import { Vector3 } from 'three';
import { Actor } from './Actor';
import { buildNpc, type CharacterModel } from './Models';
import { headingTo, turnTowards, arcAngle, PLANET_RADIUS, signedTangentAngle } from '../core/SphereMath';
import type { NpcDef } from '../rpg/Dialogue';

/**
 * A villager. NPCs do not move: they stand their post, idle-breathe, and turn to
 * face the hero when they get close enough to talk.
 */
export class Npc extends Actor {
  readonly def: NpcDef;
  readonly model: CharacterModel;
  /** True while the hero is inside talking range and roughly in front. */
  inRange = false;

  private phase = Math.random() * Math.PI * 2;
  private restFacing = new Vector3();
  private talking = false;

  static readonly TALK_RANGE = 3.4;

  constructor(def: NpcDef, dir: Vector3, forward: Vector3) {
    super(dir, forward);
    this.def = def;
    this.model = buildNpc(def.look);
    this.group.add(this.model.root);
    this.radius = 0.5;
    this.restFacing.copy(this.forward);
    this.maxHp = 1;
    this.hp = 1;
  }

  setTalking(talking: boolean): void {
    this.talking = talking;
  }

  update(dt: number, rawDt: number, playerDir: Vector3): void {
    this.phase += dt;
    const distance = arcAngle(this.dir, playerDir) * PLANET_RADIUS;
    this.inRange = distance <= Npc.TALK_RANGE;

    // Turn to the hero when they are close, drift back to their post otherwise.
    const target = this.inRange || this.talking ? headingTo(this.dir, playerDir, _v1) : this.restFacing;
    turnTowards(this.forward, target, this.dir, dt * 4.5);

    const pose = this.model.rig.target;
    pose.reset();
    const breathe = Math.sin(this.phase * 1.3);
    pose.set('torso', breathe * 0.035, Math.sin(this.phase * 0.4) * 0.1, 0);
    pose.set('head', -breathe * 0.03, Math.sin(this.phase * 0.31) * 0.22, 0);
    pose.set('armL', 0.05, 0, 0.2 + breathe * 0.04);
    pose.set('armR', 0.05, 0, -0.2 - breathe * 0.04);
    pose.set('elbowL', -0.3, 0, 0);
    pose.set('elbowR', -0.35, 0, 0);
    pose.offset[1] = breathe * 0.02;

    if (this.talking) {
      // A small nod while speaking sells that a line is being delivered.
      pose.add('head', Math.sin(this.phase * 9) * 0.06, 0, 0);
      pose.add('armR', Math.sin(this.phase * 4.5) * 0.12, 0, 0);
    }

    this.model.rig.apply(rawDt, 0.12);
    this.syncTransform();
  }

  /** How good a candidate this NPC is for the interact prompt: lower is better. */
  interactScore(playerDir: Vector3, playerForward: Vector3): number | null {
    const distance = arcAngle(this.dir, playerDir) * PLANET_RADIUS;
    if (distance > Npc.TALK_RANGE) return null;
    const heading = headingTo(playerDir, this.dir, _v1);
    const angle = Math.abs(signedTangentAngle(playerDir, playerForward, heading));
    if (angle > 1.9) return null;
    return distance + angle;
  }
}

const _v1 = /* @__PURE__ */ new Vector3();
