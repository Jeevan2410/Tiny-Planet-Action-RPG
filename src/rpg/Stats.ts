import { clamp } from '../core/SphereMath';

/**
 * Character progression.
 *
 * Deliberately four numbers and one level — no skill tree. Everything the player
 * can change about their build comes from the two equipment slots, which keeps the
 * numbers legible and the balance pass tractable.
 */

export const MAX_LEVEL = 12;

export interface BaseStats {
  maxHp: number;
  maxStamina: number;
  attack: number;
  defense: number;
}

export function statsForLevel(level: number): BaseStats {
  const l = clamp(level, 1, MAX_LEVEL) - 1;
  return {
    maxHp: 60 + l * 16,
    maxStamina: 100 + l * 6,
    attack: 9 + l * 3,
    defense: 4 + l * 2,
  };
}

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  return Math.round(24 * Math.pow(level, 1.4));
}

/** Enemy tier per biome, used to scale enemy stats and rewards. */
export const BIOME_TIER: Record<string, number> = {
  meadow: -1,
  greenwood: 0,
  dunes: 1,
  tundra: 2,
  cinder: 3,
};

export interface EnemyStatBlock {
  maxHp: number;
  attack: number;
  defense: number;
  xp: number;
  glimmer: number;
}

const ENEMY_BASE: Record<string, EnemyStatBlock & { hpPerTier: number; atkPerTier: number; defPerTier: number; xpPerTier: number }> = {
  mote: { maxHp: 20, attack: 7, defense: 1, xp: 11, glimmer: 3, hpPerTier: 7, atkPerTier: 3, defPerTier: 1, xpPerTier: 5 },
  spitter: { maxHp: 32, attack: 10, defense: 2, xp: 20, glimmer: 6, hpPerTier: 11, atkPerTier: 4, defPerTier: 1.5, xpPerTier: 9 },
  brute: { maxHp: 58, attack: 15, defense: 4, xp: 30, glimmer: 9, hpPerTier: 23, atkPerTier: 5, defPerTier: 2, xpPerTier: 13 },
  warden: { maxHp: 210, attack: 19, defense: 6, xp: 130, glimmer: 60, hpPerTier: 95, atkPerTier: 7, defPerTier: 3, xpPerTier: 55 },
};

export function enemyStats(kind: string, biome: string): EnemyStatBlock {
  const base = ENEMY_BASE[kind] ?? ENEMY_BASE.mote;
  const tier = Math.max(0, (BIOME_TIER[biome] ?? 0) + 1);
  return {
    maxHp: Math.round(base.maxHp + base.hpPerTier * tier),
    attack: Math.round(base.attack + base.atkPerTier * tier),
    defense: Math.round(base.defense + base.defPerTier * tier),
    xp: Math.round(base.xp + base.xpPerTier * tier),
    glimmer: Math.round(base.glimmer * (1 + tier * 0.7)),
  };
}

/**
 * Damage after mitigation. Defence subtracts rather than scales so early armour
 * feels meaningful, and the floor of 1 means nothing is ever fully immune.
 */
export function resolveDamage(attack: number, defense: number, multiplier = 1, variance = 0): number {
  const roll = 1 + (variance ? (Math.random() * 2 - 1) * variance : 0);
  return Math.max(1, Math.round(attack * multiplier * roll - defense * 0.5));
}
