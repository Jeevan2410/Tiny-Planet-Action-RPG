import type { EquipSlot, ItemKind } from './Types';
import type { WeaponLook } from '../entities/Models';

export type ItemId =
  | 'trainingBlade'
  | 'emberBrand'
  | 'frostEdge'
  | 'wardenEdge'
  | 'sturdyCharm'
  | 'swiftfootBand'
  | 'vitalPendant'
  | 'huntersSigil'
  | 'salve'
  | 'elixir'
  | 'wardAsh'
  | 'blightSample'
  | 'emberSeed'
  | 'sunGlass'
  | 'frostCore'
  | 'cinderHeart';

/** Special attacks unlocked by a weapon. Bound to the same key, one per weapon. */
export type SpecialId = 'none' | 'spinCut' | 'flameArc' | 'frostNova' | 'quake';

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: ItemKind;
  slot?: EquipSlot;
  icon: string;
  description: string;
  /** Shop price in glimmer. 0 means it cannot be bought. */
  price: number;
  /** Flat stat changes while equipped. */
  attack?: number;
  defense?: number;
  maxHp?: number;
  /** Multipliers applied while equipped. */
  staminaRegen?: number;
  dodgeCost?: number;
  xpBonus?: number;
  /** Swing speed multiplier: below 1 is slower, heavier. */
  swingSpeed?: number;
  /** Extra reach and arc for the basic combo, in world units / radians. */
  reachBonus?: number;
  arcBonus?: number;
  special?: SpecialId;
  look?: WeaponLook;
  /** Consumable effects. */
  healFlat?: number;
  healPercent?: number;
  restoreStamina?: number;
  buffDefense?: number;
  buffSeconds?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  trainingBlade: {
    id: 'trainingBlade',
    name: 'Training Blade',
    kind: 'weapon',
    slot: 'weapon',
    icon: '🗡️',
    description: 'Dull, honest and yours since you were small. Unlocks the Spin Cut.',
    price: 0,
    attack: 0,
    special: 'spinCut',
    look: 'trainingBlade',
  },
  emberBrand: {
    id: 'emberBrand',
    name: 'Ember Brand',
    kind: 'weapon',
    slot: 'weapon',
    icon: '🔥',
    description: 'Forged from a cured shrine-stone. Wide swings. Special: Flame Arc.',
    price: 220,
    attack: 7,
    reachBonus: 0.25,
    arcBonus: 0.18,
    special: 'flameArc',
    look: 'emberBrand',
  },
  frostEdge: {
    id: 'frostEdge',
    name: 'Frost Edge',
    kind: 'weapon',
    slot: 'weapon',
    icon: '❄️',
    description: 'Quick and cold. Swings faster than it has any right to. Special: Frost Nova.',
    price: 300,
    attack: 5,
    swingSpeed: 1.25,
    special: 'frostNova',
    look: 'frostEdge',
  },
  wardenEdge: {
    id: 'wardenEdge',
    name: "Warden's Edge",
    kind: 'weapon',
    slot: 'weapon',
    icon: '⚔️',
    description: 'Heavy as guilt. Slow, enormous reach. Special: Quake.',
    price: 0,
    attack: 13,
    swingSpeed: 0.82,
    reachBonus: 0.5,
    arcBonus: 0.24,
    special: 'quake',
    look: 'wardenEdge',
  },
  sturdyCharm: {
    id: 'sturdyCharm',
    name: 'Sturdy Charm',
    kind: 'accessory',
    slot: 'accessory',
    icon: '🛡️',
    description: 'A river stone with a hole worn through it. +5 defence.',
    price: 110,
    defense: 5,
  },
  swiftfootBand: {
    id: 'swiftfootBand',
    name: 'Swiftfoot Band',
    kind: 'accessory',
    slot: 'accessory',
    icon: '🌀',
    description: 'Dodges cost 40% less and stamina returns half again as fast.',
    price: 170,
    dodgeCost: 0.6,
    staminaRegen: 1.5,
  },
  vitalPendant: {
    id: 'vitalPendant',
    name: 'Vital Pendant',
    kind: 'accessory',
    slot: 'accessory',
    icon: '💗',
    description: 'Warm to the touch. +30 maximum health.',
    price: 240,
    maxHp: 30,
  },
  huntersSigil: {
    id: 'huntersSigil',
    name: "Hunter's Sigil",
    kind: 'accessory',
    slot: 'accessory',
    icon: '🎯',
    description: 'Every felled blight teaches you a little more. +25% experience.',
    price: 300,
    xpBonus: 0.25,
  },
  salve: {
    id: 'salve',
    name: 'Meadow Salve',
    kind: 'consumable',
    icon: '🧪',
    description: 'Restores 45 health.',
    price: 30,
    healFlat: 45,
  },
  elixir: {
    id: 'elixir',
    name: 'Hearth Elixir',
    kind: 'consumable',
    icon: '🍯',
    description: 'Restores all health and stamina.',
    price: 110,
    healPercent: 1,
    restoreStamina: 999,
  },
  wardAsh: {
    id: 'wardAsh',
    name: 'Ward Ash',
    kind: 'consumable',
    icon: '🌫️',
    description: '+6 defence for 30 seconds.',
    price: 55,
    buffDefense: 6,
    buffSeconds: 30,
  },
  blightSample: {
    id: 'blightSample',
    name: 'Blight Sample',
    kind: 'quest',
    icon: '🫧',
    description: 'A twist of corruption, still faintly humming. Tam wants five.',
    price: 8,
  },
  emberSeed: {
    id: 'emberSeed',
    name: 'Ember Seed',
    kind: 'quest',
    icon: '🌰',
    description: 'The Emberwood shrine gave this up when it was cured.',
    price: 0,
  },
  sunGlass: {
    id: 'sunGlass',
    name: 'Sun-Glass',
    kind: 'quest',
    icon: '🔆',
    description: 'Desert sand fused by the shrine-light. Warm even at night.',
    price: 0,
  },
  frostCore: {
    id: 'frostCore',
    name: 'Frost Core',
    kind: 'quest',
    icon: '🧊',
    description: 'The heart of the Frostpeak shrine, quiet at last.',
    price: 0,
  },
  cinderHeart: {
    id: 'cinderHeart',
    name: 'Cinder Heart',
    kind: 'quest',
    icon: '💜',
    description: 'Where the blight began. It beats, slowly, in your hand.',
    price: 0,
  },
};

export const ITEM_LIST = Object.values(ITEMS);

/** What the shopkeeper stocks, in display order. */
export const SHOP_STOCK: ItemId[] = [
  'salve',
  'wardAsh',
  'elixir',
  'sturdyCharm',
  'swiftfootBand',
  'vitalPendant',
  'huntersSigil',
  'frostEdge',
];

export interface SpecialDef {
  id: SpecialId;
  name: string;
  staminaCost: number;
  cooldown: number;
  /** Damage multiplier against the player's attack stat. */
  multiplier: number;
  /** Half-angle of the hit arc, in radians. Math.PI means all around. */
  arc: number;
  reach: number;
  description: string;
}

export const SPECIALS: Record<SpecialId, SpecialDef> = {
  none: { id: 'none', name: '—', staminaCost: 0, cooldown: 0, multiplier: 0, arc: 0, reach: 0, description: '' },
  spinCut: {
    id: 'spinCut',
    name: 'Spin Cut',
    staminaCost: 28,
    cooldown: 1.6,
    multiplier: 1.35,
    arc: Math.PI,
    reach: 2.4,
    description: 'A full turn that hits everything around you.',
  },
  flameArc: {
    id: 'flameArc',
    name: 'Flame Arc',
    staminaCost: 34,
    cooldown: 2.2,
    multiplier: 2.1,
    arc: 1.15,
    reach: 4.4,
    description: 'A long cone of fire that burns through a whole line of them.',
  },
  frostNova: {
    id: 'frostNova',
    name: 'Frost Nova',
    staminaCost: 30,
    cooldown: 2.4,
    multiplier: 1.15,
    arc: Math.PI,
    reach: 3.6,
    description: 'A ring of ice — modest damage, but everything caught freezes solid.',
  },
  quake: {
    id: 'quake',
    name: 'Quake',
    staminaCost: 42,
    cooldown: 3,
    multiplier: 2.6,
    arc: Math.PI,
    reach: 4.2,
    description: 'Drive the blade down. The ground does the rest.',
  },
};

export function isEquippable(item: ItemDef): boolean {
  return item.kind === 'weapon' || item.kind === 'accessory';
}
