import { createStore, type StoreApi } from 'zustand/vanilla';
import { clamp } from '../core/SphereMath';
import { ITEMS, type ItemId, type SpecialId } from '../rpg/Items';
import {
  isComplete,
  newProgress,
  objectiveGoal,
  QUESTS,
  QUEST_LIST,
  type QuestId,
  type QuestProgress,
} from '../rpg/Quests';
import { MAX_LEVEL, statsForLevel, xpToNext } from '../rpg/Stats';
import type { BiomeId, EnemyKind, EquipSlot } from '../rpg/Types';
import { SHRINE_BIOMES } from '../rpg/Types';
import { Emitter } from '../core/Events';

export interface DerivedStats {
  maxHp: number;
  maxStamina: number;
  attack: number;
  defense: number;
  staminaRegen: number;
  dodgeCost: number;
  xpBonus: number;
  swingSpeed: number;
  reachBonus: number;
  arcBonus: number;
  special: SpecialId;
}

export interface TimedBuff {
  defense: number;
  remaining: number;
}

export interface GameState {
  level: number;
  xp: number;
  hp: number;
  stamina: number;
  glimmer: number;
  equipped: Record<EquipSlot, ItemId | null>;
  inventory: Partial<Record<ItemId, number>>;
  quests: Record<QuestId, QuestProgress>;
  shrines: Record<BiomeId, boolean>;
  buff: TimedBuff | null;
  /** Lifetime counters, used by quests and the end-of-game summary. */
  kills: Partial<Record<EnemyKind, number>>;
  perfectDodges: number;
  defeats: number;
  playSeconds: number;
  /** Set once the last shrine is cured. */
  victory: boolean;
  /** Where the hero stands, so a reload puts them back. */
  position: [number, number, number];
  facing: [number, number, number];
  /** Arbitrary one-off story flags (met an NPC, saw a tutorial, ...). */
  flags: Record<string, boolean>;
}

export interface GameEvents {
  levelUp: { level: number; stats: DerivedStats };
  xpGained: { amount: number };
  questStarted: { id: QuestId };
  questAdvanced: { id: QuestId; objective: number; counter: number };
  questReady: { id: QuestId };
  questCompleted: { id: QuestId };
  itemGained: { id: ItemId; count: number };
  itemUsed: { id: ItemId };
  equipped: { slot: EquipSlot; id: ItemId | null };
  shrineCured: { biome: BiomeId };
  glimmerChanged: { amount: number; total: number };
  victory: Record<string, never>;
  notice: { text: string; tone?: 'info' | 'good' | 'bad' | 'epic' };
}

export const gameEvents = new Emitter<GameEvents>();

function emptyQuests(): Record<QuestId, QuestProgress> {
  const out = {} as Record<QuestId, QuestProgress>;
  for (const quest of QUEST_LIST) {
    out[quest.id] = newProgress(quest, quest.requires ? 'unavailable' : 'notStarted');
  }
  return out;
}

function emptyShrines(): Record<BiomeId, boolean> {
  const out = {} as Record<BiomeId, boolean>;
  for (const biome of SHRINE_BIOMES) out[biome] = false;
  out.meadow = true;
  return out;
}

export function initialState(): GameState {
  const base = statsForLevel(1);
  return {
    level: 1,
    xp: 0,
    hp: base.maxHp,
    stamina: base.maxStamina,
    glimmer: 25,
    equipped: { weapon: 'trainingBlade', accessory: null },
    inventory: { trainingBlade: 1, salve: 2 },
    quests: emptyQuests(),
    shrines: emptyShrines(),
    buff: null,
    kills: {},
    perfectDodges: 0,
    defeats: 0,
    playSeconds: 0,
    victory: false,
    position: [0, 1, 0],
    facing: [0, 0, -1],
    flags: {},
  };
}

export type GameStore = StoreApi<GameState>;

export const store: GameStore = createStore<GameState>(() => initialState());

export const getState = store.getState;

/** Stats after equipment. Cheap enough to call per frame. */
export function derivedStats(state: GameState = store.getState()): DerivedStats {
  const base = statsForLevel(state.level);
  const out: DerivedStats = {
    maxHp: base.maxHp,
    maxStamina: base.maxStamina,
    attack: base.attack,
    defense: base.defense,
    staminaRegen: 1,
    dodgeCost: 1,
    xpBonus: 0,
    swingSpeed: 1,
    reachBonus: 0,
    arcBonus: 0,
    special: 'none',
  };
  for (const slot of ['weapon', 'accessory'] as const) {
    const id = state.equipped[slot];
    if (!id) continue;
    const item = ITEMS[id];
    if (!item) continue;
    out.attack += item.attack ?? 0;
    out.defense += item.defense ?? 0;
    out.maxHp += item.maxHp ?? 0;
    out.staminaRegen *= item.staminaRegen ?? 1;
    out.dodgeCost *= item.dodgeCost ?? 1;
    out.xpBonus += item.xpBonus ?? 0;
    out.swingSpeed *= item.swingSpeed ?? 1;
    out.reachBonus += item.reachBonus ?? 0;
    out.arcBonus += item.arcBonus ?? 0;
    if (item.special) out.special = item.special;
  }
  if (state.buff) out.defense += state.buff.defense;
  return out;
}

export function xpProgress(state: GameState = store.getState()): { current: number; needed: number; ratio: number } {
  const needed = xpToNext(state.level);
  if (!Number.isFinite(needed)) return { current: state.xp, needed: 0, ratio: 1 };
  return { current: state.xp, needed, ratio: clamp(state.xp / needed, 0, 1) };
}

export function itemCount(id: ItemId, state: GameState = store.getState()): number {
  return state.inventory[id] ?? 0;
}

/* ------------------------------------------------------------------ actions */

export const actions = {
  replaceState(next: GameState): void {
    store.setState(next, true);
  },

  reset(): void {
    store.setState(initialState(), true);
  },

  tickTime(dt: number): void {
    const state = store.getState();
    const buff = state.buff;
    if (buff) {
      const remaining = buff.remaining - dt;
      store.setState({
        playSeconds: state.playSeconds + dt,
        buff: remaining <= 0 ? null : { defense: buff.defense, remaining },
      });
    } else {
      store.setState({ playSeconds: state.playSeconds + dt });
    }
  },

  setVitals(hp: number, stamina: number): void {
    const stats = derivedStats();
    store.setState({
      hp: clamp(hp, 0, stats.maxHp),
      stamina: clamp(stamina, 0, stats.maxStamina),
    });
  },

  setPosition(dir: [number, number, number], facing: [number, number, number]): void {
    store.setState({ position: dir, facing });
  },

  setFlag(name: string, value = true): void {
    store.setState({ flags: { ...store.getState().flags, [name]: value } });
  },

  gainXp(amount: number): void {
    const state = store.getState();
    if (state.level >= MAX_LEVEL) return;
    const bonus = derivedStats(state).xpBonus;
    const gained = Math.max(1, Math.round(amount * (1 + bonus)));
    let xp = state.xp + gained;
    let level = state.level;
    gameEvents.emit('xpGained', { amount: gained });

    let levelled = false;
    while (level < MAX_LEVEL && xp >= xpToNext(level)) {
      xp -= xpToNext(level);
      level += 1;
      levelled = true;
    }
    if (level >= MAX_LEVEL) xp = 0;

    if (levelled) {
      const before = store.getState();
      const nextStats = statsForLevel(level);
      const previousStats = statsForLevel(before.level);
      // Level-ups top you up by the health you gained, and refill stamina fully.
      const hpGain = nextStats.maxHp - previousStats.maxHp;
      store.setState({ level, xp, hp: before.hp + hpGain, stamina: nextStats.maxStamina });
      const stats = derivedStats();
      store.setState({ hp: clamp(store.getState().hp, 0, stats.maxHp) });
      gameEvents.emit('levelUp', { level, stats });
      actions.checkQuestEvent({ kind: 'level', level });
    } else {
      store.setState({ xp });
    }
  },

  addGlimmer(amount: number): void {
    const total = Math.max(0, store.getState().glimmer + amount);
    store.setState({ glimmer: total });
    gameEvents.emit('glimmerChanged', { amount, total });
  },

  addItem(id: ItemId, count = 1, options: { silent?: boolean } = {}): void {
    const state = store.getState();
    const inventory = { ...state.inventory };
    inventory[id] = (inventory[id] ?? 0) + count;
    store.setState({ inventory });
    if (!options.silent) gameEvents.emit('itemGained', { id, count });
    actions.checkQuestEvent({ kind: 'collect', item: id });
  },

  removeItem(id: ItemId, count = 1): boolean {
    const state = store.getState();
    const have = state.inventory[id] ?? 0;
    if (have < count) return false;
    const inventory = { ...state.inventory };
    const left = have - count;
    if (left <= 0) delete inventory[id];
    else inventory[id] = left;
    // Unequip anything we no longer own.
    const equipped = { ...state.equipped };
    for (const slot of ['weapon', 'accessory'] as const) {
      if (equipped[slot] === id && left <= 0) equipped[slot] = null;
    }
    store.setState({ inventory, equipped });
    return true;
  },

  equip(id: ItemId | null, slot: EquipSlot): void {
    const state = store.getState();
    if (id) {
      const item = ITEMS[id];
      if (!item || item.slot !== slot) return;
      if ((state.inventory[id] ?? 0) <= 0) return;
    }
    store.setState({ equipped: { ...state.equipped, [slot]: id } });
    const stats = derivedStats();
    store.setState({
      hp: clamp(store.getState().hp, 1, stats.maxHp),
      stamina: clamp(store.getState().stamina, 0, stats.maxStamina),
    });
    gameEvents.emit('equipped', { slot, id });
  },

  /** @returns true if the item was consumed. */
  useConsumable(id: ItemId): boolean {
    const state = store.getState();
    const item = ITEMS[id];
    if (!item || item.kind !== 'consumable') return false;
    if ((state.inventory[id] ?? 0) <= 0) return false;
    const stats = derivedStats(state);
    let hp = state.hp;
    let stamina = state.stamina;
    if (item.healFlat) hp += item.healFlat;
    if (item.healPercent) hp += stats.maxHp * item.healPercent;
    if (item.restoreStamina) stamina += item.restoreStamina;
    const buff =
      item.buffDefense && item.buffSeconds
        ? { defense: item.buffDefense, remaining: item.buffSeconds }
        : state.buff;

    actions.removeItem(id, 1);
    store.setState({
      hp: clamp(hp, 0, stats.maxHp),
      stamina: clamp(stamina, 0, stats.maxStamina),
      buff,
    });
    gameEvents.emit('itemUsed', { id });
    return true;
  },

  /* ------------------------------------------------------------- quests */

  startQuest(id: QuestId): void {
    const state = store.getState();
    const progress = state.quests[id];
    if (!progress || (progress.stage !== 'notStarted' && progress.stage !== 'unavailable')) return;
    const quests = { ...state.quests, [id]: { ...newProgress(QUESTS[id], 'inProgress') } };
    store.setState({ quests });
    gameEvents.emit('questStarted', { id });
    // Collect objectives may already be satisfied by what is in the bag.
    actions.checkQuestEvent({ kind: 'collect', item: null });
    actions.checkQuestEvent({ kind: 'level', level: state.level });
  },

  /** Feed a gameplay event to every in-progress quest. */
  checkQuestEvent(
    event:
      | { kind: 'slay'; enemy: EnemyKind; biome: BiomeId }
      | { kind: 'collect'; item: ItemId | null }
      | { kind: 'cure'; biome: BiomeId }
      | { kind: 'level'; level: number }
      | { kind: 'dodge' },
  ): void {
    const state = store.getState();
    let quests: Record<QuestId, QuestProgress> | null = null;

    for (const quest of QUEST_LIST) {
      const progress = state.quests[quest.id];
      if (!progress || progress.stage !== 'inProgress') continue;
      let counters: number[] | null = null;

      quest.objectives.forEach((objective, index) => {
        const goal = objectiveGoal(objective);
        const current = progress.counters[index] ?? 0;
        if (current >= goal) return;
        let next = current;

        if (event.kind === 'slay' && objective.kind === 'slay') {
          const enemyMatches = objective.enemy === 'any' || objective.enemy === event.enemy;
          const biomeMatches = !objective.biome || objective.biome === event.biome;
          if (enemyMatches && biomeMatches) next = current + 1;
        } else if (event.kind === 'collect' && objective.kind === 'collect') {
          if (!event.item || event.item === objective.item) {
            next = state.inventory[objective.item] ?? 0;
          }
        } else if (event.kind === 'cure' && objective.kind === 'cure') {
          // Only counts once the objectives before it are done (kill, then cleanse).
          const earlierDone = quest.objectives
            .slice(0, index)
            .every((o, i) => (progress.counters[i] ?? 0) >= objectiveGoal(o));
          if (earlierDone && objective.biome === event.biome) next = 1;
        } else if (event.kind === 'level' && objective.kind === 'reachLevel') {
          if (event.level >= objective.level) next = 1;
        } else if (event.kind === 'dodge' && objective.kind === 'perfectDodge') {
          next = current + 1;
        }

        if (next !== current) {
          counters = counters ?? [...progress.counters];
          counters[index] = Math.min(next, goal);
          gameEvents.emit('questAdvanced', { id: quest.id, objective: index, counter: counters[index] });
        }
      });

      if (counters) {
        const updated: QuestProgress = { stage: progress.stage, counters };
        if (isComplete(quest, updated)) {
          updated.stage = 'readyToTurnIn';
          gameEvents.emit('questReady', { id: quest.id });
        }
        quests = { ...(quests ?? state.quests), [quest.id]: updated };
      }
    }

    if (quests) store.setState({ quests });
  },

  /** Hand in a finished quest and pay out. */
  turnInQuest(id: QuestId): boolean {
    const state = store.getState();
    const quest = QUESTS[id];
    const progress = state.quests[id];
    if (!quest || !progress || progress.stage !== 'readyToTurnIn') return false;

    if (quest.consumesItems) {
      for (const objective of quest.objectives) {
        if (objective.kind === 'collect') actions.removeItem(objective.item, objective.count);
      }
    }

    const quests = { ...store.getState().quests, [id]: { ...progress, stage: 'complete' as const } };
    // Unlock anything gated behind this quest.
    for (const other of QUEST_LIST) {
      if (other.requires === id && quests[other.id].stage === 'unavailable') {
        quests[other.id] = { ...quests[other.id], stage: 'notStarted' };
      }
    }
    store.setState({ quests });

    actions.addGlimmer(quest.reward.glimmer);
    for (const reward of quest.reward.items ?? []) actions.addItem(reward.id, reward.count, { silent: true });
    gameEvents.emit('questCompleted', { id });
    actions.gainXp(quest.reward.xp);
    return true;
  },

  cureShrine(biome: BiomeId): void {
    const state = store.getState();
    if (state.shrines[biome]) return;
    store.setState({ shrines: { ...state.shrines, [biome]: true } });
    gameEvents.emit('shrineCured', { biome });
    actions.checkQuestEvent({ kind: 'cure', biome });
    const cured = SHRINE_BIOMES.every((id) => store.getState().shrines[id]);
    if (cured && !store.getState().victory) {
      store.setState({ victory: true });
      gameEvents.emit('victory', {});
    }
  },

  recordKill(enemy: EnemyKind, biome: BiomeId): void {
    const state = store.getState();
    store.setState({ kills: { ...state.kills, [enemy]: (state.kills[enemy] ?? 0) + 1 } });
    actions.checkQuestEvent({ kind: 'slay', enemy, biome });
  },

  recordPerfectDodge(): void {
    store.setState({ perfectDodges: store.getState().perfectDodges + 1 });
    actions.checkQuestEvent({ kind: 'dodge' });
  },

  recordDefeat(): void {
    store.setState({ defeats: store.getState().defeats + 1 });
  },
};
