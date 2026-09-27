/** Shared string ids, kept in one leaf module so systems never import each other. */

export type BiomeId = 'meadow' | 'greenwood' | 'dunes' | 'tundra' | 'cinder';

export type EnemyKind = 'mote' | 'brute' | 'spitter' | 'warden';

export type EquipSlot = 'weapon' | 'accessory';

export type ItemKind = 'weapon' | 'accessory' | 'consumable' | 'quest';

export type QuestStage = 'unavailable' | 'notStarted' | 'inProgress' | 'readyToTurnIn' | 'complete';

export const BIOME_ORDER: readonly BiomeId[] = ['meadow', 'greenwood', 'dunes', 'tundra', 'cinder'];

/** The four blighted biomes — the meadow is the safe hub and has no shrine. */
export const SHRINE_BIOMES: readonly BiomeId[] = ['greenwood', 'dunes', 'tundra', 'cinder'];
