import { actions, getState, initialState, type GameState } from '../state/gameState';
import { newProgress, QUESTS, QUEST_LIST } from '../rpg/Quests';
import { SHRINE_BIOMES, type BiomeId } from '../rpg/Types';
import { AUTO_SLOT, SAVE_VERSION, saveStore, type SaveRecord } from './Db';

import { Vector3 } from 'three';
import { BIOMES, biomeAt } from '../world/Biomes';

export interface SaveSummary {
  slot: string;
  savedAt: number;
  level: number;
  shrines: number;
  playSeconds: number;
  biome: string;
}

/**
 * Serialise the whole run.
 *
 * Only progress is stored — the world is regenerated from its seed, so a save is a
 * couple of kilobytes of JSON no matter how many trees are on the planet.
 */
export async function saveGame(slot = AUTO_SLOT): Promise<SaveRecord> {
  const state = getState();
  const dir = new Vector3(state.position[0], state.position[1], state.position[2]).normalize();
  const record: SaveRecord = {
    slot,
    version: SAVE_VERSION,
    savedAt: Date.now(),
    summary: {
      level: state.level,
      shrines: SHRINE_BIOMES.filter((biome) => state.shrines[biome]).length,
      playSeconds: Math.round(state.playSeconds),
      biome: BIOMES[biomeAt(dir).id].name,
    },
    // Structured clone through JSON keeps the record free of live object references.
    state: JSON.parse(JSON.stringify(state)) as GameState,
  };
  await saveStore.put(record);
  return record;
}

export async function loadSummary(slot = AUTO_SLOT): Promise<SaveSummary | null> {
  const record = await saveStore.get(slot);
  if (!record) return null;
  return { slot: record.slot, savedAt: record.savedAt, ...record.summary };
}

export async function hasSave(slot = AUTO_SLOT): Promise<boolean> {
  return (await saveStore.get(slot)) !== undefined;
}

export async function deleteSave(slot = AUTO_SLOT): Promise<void> {
  await saveStore.remove(slot);
}

/**
 * Load a save into the store.
 *
 * Every field is merged onto a fresh `initialState()`, so a save written by an
 * older build (missing a quest, an item or a flag that has since been added) still
 * loads cleanly instead of leaving holes in the state.
 */
export async function loadGame(slot = AUTO_SLOT): Promise<GameState | null> {
  const record = await saveStore.get(slot);
  if (!record) return null;
  const base = initialState();
  const saved = record.state ?? ({} as Partial<GameState>);

  const quests = { ...base.quests };
  for (const quest of QUEST_LIST) {
    const savedProgress = saved.quests?.[quest.id];
    if (!savedProgress) continue;
    const counters = quest.objectives.map((_, i) => savedProgress.counters?.[i] ?? 0);
    quests[quest.id] = { stage: savedProgress.stage ?? 'notStarted', counters };
  }
  // Re-derive gating: anything whose prerequisite is complete must be offerable.
  for (const quest of QUEST_LIST) {
    if (!quest.requires) continue;
    if (quests[quest.requires].stage === 'complete' && quests[quest.id].stage === 'unavailable') {
      quests[quest.id] = newProgress(QUESTS[quest.id], 'notStarted');
    }
  }

  const shrines = { ...base.shrines };
  for (const biome of SHRINE_BIOMES) shrines[biome] = !!saved.shrines?.[biome];

  const merged: GameState = {
    ...base,
    ...saved,
    equipped: { ...base.equipped, ...(saved.equipped ?? {}) },
    inventory: { ...(saved.inventory ?? base.inventory) },
    quests,
    shrines,
    kills: { ...(saved.kills ?? {}) },
    flags: { ...(saved.flags ?? {}) },
    buff: saved.buff ?? null,
    position: normaliseTriple(saved.position, base.position),
    facing: normaliseTriple(saved.facing, base.facing),
  };

  actions.replaceState(merged);
  return merged;
}

function normaliseTriple(
  value: [number, number, number] | undefined,
  fallback: [number, number, number],
): [number, number, number] {
  if (!value || value.length !== 3 || value.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return [...fallback] as [number, number, number];
  }
  return [value[0], value[1], value[2]];
}

/** Which biomes the save says are already cured. */
export function curedBiomes(state: GameState): BiomeId[] {
  return SHRINE_BIOMES.filter((biome) => state.shrines[biome]);
}

export function formatPlaytime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
