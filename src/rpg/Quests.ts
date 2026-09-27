import type { BiomeId, EnemyKind, QuestStage } from './Types';
import type { ItemId } from './Items';

export type QuestId =
  | 'firstLight'
  | 'tamsErrand'
  | 'rooksTrial'
  | 'emberwoodShrine'
  | 'dunesShrine'
  | 'tundraShrine'
  | 'cinderShrine';

export type NpcId = 'mira' | 'tam' | 'rook' | 'pip' | 'hollis';

/**
 * Objectives are declarative so the quest system can watch gameplay events
 * (something died, something was picked up, a shrine was cured) and advance every
 * quest generically, instead of each quest carrying bespoke logic.
 */
export type Objective =
  | { kind: 'slay'; enemy: EnemyKind | 'any'; biome?: BiomeId; count: number; label: string }
  | { kind: 'collect'; item: ItemId; count: number; label: string }
  | { kind: 'cure'; biome: BiomeId; label: string }
  | { kind: 'reachLevel'; level: number; label: string }
  | { kind: 'perfectDodge'; count: number; label: string };

export interface QuestReward {
  xp: number;
  glimmer: number;
  items?: Array<{ id: ItemId; count: number }>;
}

export interface QuestDef {
  id: QuestId;
  title: string;
  giver: NpcId;
  /** One line for the journal. */
  summary: string;
  /** Shown when the quest is handed in. */
  outro: string;
  objectives: Objective[];
  reward: QuestReward;
  /** Quest that must be complete before this one is offered. */
  requires?: QuestId;
  /** Consumed from the inventory on turn-in (collect quests). */
  consumesItems?: boolean;
}

export const QUESTS: Record<QuestId, QuestDef> = {
  firstLight: {
    id: 'firstLight',
    title: 'First Light',
    giver: 'mira',
    summary: 'Clear four blight motes out of the Hearthmeadow.',
    outro: 'Four fewer. Good. Now the harder part.',
    objectives: [{ kind: 'slay', enemy: 'mote', biome: 'meadow', count: 4, label: 'Motes cleared from the meadow' }],
    reward: { xp: 55, glimmer: 45, items: [{ id: 'salve', count: 2 }] },
  },
  tamsErrand: {
    id: 'tamsErrand',
    title: "Tam's Errand",
    giver: 'tam',
    summary: 'Bring Tam five blight samples so he can work out what the stuff is made of.',
    outro: 'Tam holds one up to the light and pulls a face you will remember for years.',
    objectives: [{ kind: 'collect', item: 'blightSample', count: 5, label: 'Blight samples' }],
    reward: { xp: 90, glimmer: 160, items: [{ id: 'elixir', count: 1 }] },
    requires: 'firstLight',
    consumesItems: true,
  },
  rooksTrial: {
    id: 'rooksTrial',
    title: "Rook's Trial",
    giver: 'rook',
    summary: 'Rook wants to see six clean dodges. Roll through an attack, do not just run from it.',
    outro: '"Now you are listening to the fight instead of shouting at it."',
    objectives: [{ kind: 'perfectDodge', count: 6, label: 'Clean dodges' }],
    reward: { xp: 110, glimmer: 60, items: [{ id: 'swiftfootBand', count: 1 }] },
    requires: 'firstLight',
  },
  emberwoodShrine: {
    id: 'emberwoodShrine',
    title: 'The Emberwood Shrine',
    giver: 'mira',
    summary: 'Put down the warden holding the Emberwood shrine, then cleanse the shrine itself.',
    outro: 'One shrine singing again. Three still silent.',
    objectives: [
      { kind: 'slay', enemy: 'warden', biome: 'greenwood', count: 1, label: 'Emberwood Warden felled' },
      { kind: 'cure', biome: 'greenwood', label: 'Emberwood shrine cleansed' },
    ],
    reward: { xp: 180, glimmer: 130, items: [{ id: 'emberBrand', count: 1 }] },
    requires: 'firstLight',
  },
  dunesShrine: {
    id: 'dunesShrine',
    title: 'The Sunscar Shrine',
    giver: 'mira',
    summary: 'The Sunscar Dunes shrine has a warden of its own. Cure it.',
    outro: 'Mira turns the sun-glass over and over while you talk.',
    objectives: [
      { kind: 'slay', enemy: 'warden', biome: 'dunes', count: 1, label: 'Sunscar Warden felled' },
      { kind: 'cure', biome: 'dunes', label: 'Sunscar shrine cleansed' },
    ],
    reward: { xp: 260, glimmer: 180, items: [{ id: 'sturdyCharm', count: 1 }, { id: 'salve', count: 3 }] },
    requires: 'emberwoodShrine',
  },
  tundraShrine: {
    id: 'tundraShrine',
    title: 'The Frostpeak Shrine',
    giver: 'mira',
    summary: 'Frostpeak next. Wrap up warm, and do not stop moving.',
    outro: 'The frost core does not melt in her hands. She says that is a good sign.',
    objectives: [
      { kind: 'slay', enemy: 'warden', biome: 'tundra', count: 1, label: 'Frostpeak Warden felled' },
      { kind: 'cure', biome: 'tundra', label: 'Frostpeak shrine cleansed' },
    ],
    reward: { xp: 340, glimmer: 240, items: [{ id: 'vitalPendant', count: 1 }, { id: 'elixir', count: 2 }] },
    requires: 'dunesShrine',
  },
  cinderShrine: {
    id: 'cinderShrine',
    title: 'Where It Began',
    giver: 'mira',
    summary: 'Cinder Hollow. The first shrine to fall, and the last one left.',
    outro: 'The bell rings on its own. Nobody is pulling the rope.',
    objectives: [
      { kind: 'slay', enemy: 'warden', biome: 'cinder', count: 1, label: 'Hollow Warden felled' },
      { kind: 'cure', biome: 'cinder', label: 'Cinder shrine cleansed' },
    ],
    reward: { xp: 460, glimmer: 400, items: [{ id: 'wardenEdge', count: 1 }] },
    requires: 'tundraShrine',
  },
};

export const QUEST_LIST = Object.values(QUESTS);

/** Which biome's shrine a quest is about, if any. */
export function questBiome(id: QuestId): BiomeId | null {
  const quest = QUESTS[id];
  for (const objective of quest.objectives) {
    if (objective.kind === 'cure') return objective.biome;
  }
  return null;
}

export interface QuestProgress {
  stage: QuestStage;
  /** One counter per objective, in definition order. */
  counters: number[];
}

export function newProgress(quest: QuestDef, stage: QuestStage = 'notStarted'): QuestProgress {
  return { stage, counters: quest.objectives.map(() => 0) };
}

export function objectiveGoal(objective: Objective): number {
  switch (objective.kind) {
    case 'slay':
      return objective.count;
    case 'collect':
      return objective.count;
    case 'perfectDodge':
      return objective.count;
    case 'reachLevel':
      return 1;
    case 'cure':
      return 1;
  }
}

/** Human-readable "3 / 5" style progress for the journal and tracker. */
export function objectiveText(objective: Objective, counter: number): string {
  const goal = objectiveGoal(objective);
  if (goal === 1) return objective.label;
  return `${objective.label}  ${Math.min(counter, goal)}/${goal}`;
}

export function isComplete(quest: QuestDef, progress: QuestProgress): boolean {
  return quest.objectives.every((objective, i) => (progress.counters[i] ?? 0) >= objectiveGoal(objective));
}
