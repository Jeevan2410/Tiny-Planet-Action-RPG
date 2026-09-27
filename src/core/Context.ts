import type { Vector3 } from 'three';
import type { Input } from './Input';
import type { CameraRig } from '../render/CameraRig';
import type { Vfx } from '../render/Vfx';
import type { AudioEngine } from '../audio/Audio';
import type { Blocker } from '../world/Scatter';
import type { Enemy } from '../entities/Enemy';
import type { Npc } from '../entities/Npc';
import type { Player } from '../entities/Player';
import type { BiomeId } from '../rpg/Types';

export type DamageTone = 'player' | 'enemy' | 'crit' | 'heal';

/**
 * The seam between entities and the game shell.
 *
 * Entities take this instead of importing `Game` directly, which keeps the module
 * graph acyclic and makes each entity testable with a stub.
 */
export interface GameContext {
  readonly input: Input;
  readonly camera: CameraRig;
  readonly vfx: Vfx;
  readonly audio: AudioEngine;
  readonly blockers: readonly Blocker[];
  readonly enemies: Enemy[];
  readonly npcs: Npc[];
  readonly player: Player;
  /** True while a menu or dialogue owns the screen. */
  readonly paused: boolean;
  /** Biome the hero is currently standing in. */
  readonly biome: BiomeId;

  hitStop(seconds: number): void;
  shake(amount: number): void;
  /** Floating combat text, projected from a world position. */
  floatText(position: Vector3, text: string, tone: DamageTone): void;
  notice(text: string, tone?: 'info' | 'good' | 'bad' | 'epic'): void;
  /** Launch an enemy projectile from a world position along a tangent heading. */
  spawnProjectile(origin: Vector3, dir: Vector3, heading: Vector3, damage: number, speed?: number): void;
  /** Try to talk to / use whatever the hero is standing in front of. */
  interact(): boolean;
  /** What the hero would interact with right now, for the prompt. */
  interactTarget(): { label: string; key: string } | null;
}
