import { Color, Vector3 } from 'three';
import type { Atmosphere } from '../render/Renderer';
import { arcAngle, PLANET_RADIUS } from '../core/SphereMath';
import type { BiomeId, EnemyKind } from '../rpg/Types';

export interface PropMix {
  /** Props per 1000 square world units of the biome's surface. */
  density: number;
  kinds: Array<{ kind: PropKind; weight: number; scale?: [number, number] }>;
}

export type PropKind =
  | 'broadTree'
  | 'pineTree'
  | 'deadTree'
  | 'stump'
  | 'rock'
  | 'boulder'
  | 'crystal'
  | 'cactus'
  | 'palm'
  | 'grassTuft'
  | 'reed'
  | 'mushroom'
  | 'bones'
  | 'iceSpike'
  | 'lavaVent'
  | 'blightThorn'
  | 'flowerPatch';

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** Flavour line shown on the biome banner. */
  tagline: string;
  /** Unit vector: where on the globe this biome is centred. */
  centre: Vector3;
  /** Ground colours, blended per face with a little noise. */
  ground: Color;
  groundAlt: Color;
  rock: Color;
  /** Colour of the highest ground in the biome (snow caps, scorched crust...). */
  peak: Color;
  peakHeight: number;
  /** Palette the procedural props are built from. */
  foliage: Color;
  foliageAlt: Color;
  wood: Color;
  accent: Color;
  atmosphere: Atmosphere;
  props: PropMix;
  /** Enemy roster used when populating the biome. */
  spawns: Array<{ kind: EnemyKind; count: number }>;
  /** Recommended level, shown in the biome banner so players can judge risk. */
  recommendedLevel: number;
  /** Musical key for the procedural score, semitones from A. */
  musicRoot: number;
  musicMode: 'major' | 'minor' | 'lydian' | 'dorian';
}

function atmos(
  sky: number,
  horizon: number,
  ground: number,
  fog: number,
  sun: number,
  sunIntensity: number,
  ambient: number,
): Atmosphere {
  return {
    sky: new Color(sky),
    horizon: new Color(horizon),
    ground: new Color(ground),
    fog: new Color(fog),
    sun: new Color(sun),
    sunIntensity,
    ambient,
  };
}

/** Spherical coordinates helper: polar angle from +Y, azimuth around +Y. */
function site(polarDeg: number, azimuthDeg: number): Vector3 {
  const polar = (polarDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const s = Math.sin(polar);
  return new Vector3(s * Math.cos(azimuth), Math.cos(polar), s * Math.sin(azimuth)).normalize();
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  meadow: {
    id: 'meadow',
    name: 'Hearthmeadow',
    tagline: 'Home. The bell still rings at dusk.',
    centre: site(0, 0),
    ground: new Color(0x7cc45c),
    groundAlt: new Color(0x5fa94a),
    rock: new Color(0x9a9286),
    peak: new Color(0xa8d68a),
    peakHeight: 2.6,
    foliage: new Color(0x5aa84e),
    foliageAlt: new Color(0x79c85f),
    wood: new Color(0x7a5a3c),
    accent: new Color(0xffd76b),
    atmosphere: atmos(0x4f8fd6, 0xa9d8f5, 0x6f9a5a, 0xc9e4f2, 0xfff3d0, 2.5, 0.42),
    props: {
      density: 118,
      kinds: [
        { kind: 'broadTree', weight: 2, scale: [0.85, 1.25] },
        { kind: 'flowerPatch', weight: 4 },
        { kind: 'grassTuft', weight: 6 },
        { kind: 'rock', weight: 1.4 },
        { kind: 'stump', weight: 0.6 },
      ],
    },
    spawns: [{ kind: 'mote', count: 6 }],
    recommendedLevel: 1,
    musicRoot: 0,
    musicMode: 'major',
  },
  greenwood: {
    id: 'greenwood',
    name: 'Emberwood',
    tagline: 'Autumn leaves that never fall, and something moving between them.',
    centre: site(62, 22),
    ground: new Color(0x8f7a3e),
    groundAlt: new Color(0x6f6a34),
    rock: new Color(0x87796a),
    peak: new Color(0xb8994c),
    peakHeight: 2.4,
    foliage: new Color(0xd4753a),
    foliageAlt: new Color(0xe8a83c),
    wood: new Color(0x6b4630),
    accent: new Color(0xb4472f),
    atmosphere: atmos(0x63709e, 0xe0b071, 0x6a5a38, 0xe8c391, 0xffe0a8, 2.35, 0.4),
    props: {
      density: 205,
      kinds: [
        { kind: 'broadTree', weight: 5, scale: [0.9, 1.5] },
        { kind: 'pineTree', weight: 2.2, scale: [0.9, 1.35] },
        { kind: 'mushroom', weight: 2 },
        { kind: 'grassTuft', weight: 3 },
        { kind: 'stump', weight: 1.2 },
        { kind: 'rock', weight: 1.4 },
        { kind: 'blightThorn', weight: 1.1 },
      ],
    },
    spawns: [
      { kind: 'mote', count: 9 },
      { kind: 'brute', count: 3 },
    ],
    recommendedLevel: 2,
    musicRoot: 3,
    musicMode: 'dorian',
  },
  dunes: {
    id: 'dunes',
    name: 'Sunscar Dunes',
    tagline: 'Glass where the sand was struck. Nothing casts a shadow at noon.',
    centre: site(96, 142),
    ground: new Color(0xe3c483),
    groundAlt: new Color(0xd0a865),
    rock: new Color(0xc19a6b),
    peak: new Color(0xf2ddab),
    peakHeight: 2.2,
    foliage: new Color(0x86a85c),
    foliageAlt: new Color(0xa0c069),
    wood: new Color(0xa8794c),
    accent: new Color(0xefdcae),
    atmosphere: atmos(0x69a8d8, 0xf6d9a0, 0xb08a54, 0xf3dcae, 0xfff0c8, 2.9, 0.5),
    props: {
      density: 96,
      kinds: [
        { kind: 'cactus', weight: 3 },
        { kind: 'palm', weight: 1.6, scale: [0.95, 1.3] },
        { kind: 'rock', weight: 3 },
        { kind: 'boulder', weight: 1.2 },
        { kind: 'bones', weight: 1.5 },
        { kind: 'crystal', weight: 1 },
      ],
    },
    spawns: [
      { kind: 'mote', count: 7 },
      { kind: 'spitter', count: 5 },
      { kind: 'brute', count: 2 },
    ],
    recommendedLevel: 4,
    musicRoot: 7,
    musicMode: 'lydian',
  },
  tundra: {
    id: 'tundra',
    name: 'Frostpeak',
    tagline: 'The cold here is patient. It waits for you to stop moving.',
    centre: site(96, 262),
    ground: new Color(0xe8f0f6),
    groundAlt: new Color(0xc6d6e4),
    rock: new Color(0x8b93a3),
    peak: new Color(0xffffff),
    peakHeight: 1.6,
    foliage: new Color(0x3f7a6a),
    foliageAlt: new Color(0x5b9683),
    wood: new Color(0x5a4a44),
    accent: new Color(0xc4ecff),
    atmosphere: atmos(0x4d6da8, 0xcfe2f2, 0x93a7b8, 0xd8e6f2, 0xe8f2ff, 2.2, 0.55),
    props: {
      density: 140,
      kinds: [
        { kind: 'pineTree', weight: 4, scale: [0.9, 1.4] },
        { kind: 'iceSpike', weight: 2.6 },
        { kind: 'rock', weight: 2.2 },
        { kind: 'boulder', weight: 1.1 },
        { kind: 'deadTree', weight: 1.4 },
        { kind: 'crystal', weight: 0.9 },
      ],
    },
    spawns: [
      { kind: 'brute', count: 5 },
      { kind: 'spitter', count: 4 },
      { kind: 'mote', count: 6 },
    ],
    recommendedLevel: 6,
    musicRoot: 10,
    musicMode: 'minor',
  },
  cinder: {
    id: 'cinder',
    name: 'Cinder Hollow',
    tagline: 'Where the blight first broke through. The ground remembers.',
    centre: site(152, 42),
    ground: new Color(0x4a3644),
    groundAlt: new Color(0x38283a),
    rock: new Color(0x5b4a58),
    peak: new Color(0x7a4a52),
    peakHeight: 2.8,
    foliage: new Color(0x6d3a52),
    foliageAlt: new Color(0x8f4a60),
    wood: new Color(0x3a2a30),
    accent: new Color(0xff7a3c),
    atmosphere: atmos(0x2b1c39, 0x7d4160, 0x3a2438, 0x6d3d59, 0xffb38a, 1.9, 0.48),
    props: {
      density: 158,
      kinds: [
        { kind: 'deadTree', weight: 3.4 },
        { kind: 'blightThorn', weight: 3.2 },
        { kind: 'lavaVent', weight: 1.7 },
        { kind: 'rock', weight: 2.4 },
        { kind: 'boulder', weight: 1.2 },
        { kind: 'bones', weight: 1.4 },
        { kind: 'crystal', weight: 1.2 },
      ],
    },
    spawns: [
      { kind: 'brute', count: 5 },
      { kind: 'spitter', count: 5 },
      { kind: 'mote', count: 10 },
    ],
    recommendedLevel: 8,
    musicRoot: 5,
    musicMode: 'minor',
  },
};

export const BIOME_LIST: BiomeDef[] = Object.values(BIOMES);

/** Village sits just off the meadow centre so the pole is not literally the square. */
export const VILLAGE_DIR = (() => {
  const d = site(6, 200);
  return d;
})();

/** Which biome owns a point: nearest centre on the sphere (a spherical Voronoi cell). */
export function biomeAt(dir: Vector3): BiomeDef {
  let best = BIOME_LIST[0];
  let bestAngle = Infinity;
  for (const biome of BIOME_LIST) {
    const angle = arcAngle(dir, biome.centre);
    if (angle < bestAngle) {
      bestAngle = angle;
      best = biome;
    }
  }
  return best;
}

/** How deep inside its biome a point is, 0 at the border and 1 at the centre. */
export function biomeStrength(dir: Vector3, biome: BiomeDef): number {
  let nearestOther = Infinity;
  for (const other of BIOME_LIST) {
    if (other.id === biome.id) continue;
    nearestOther = Math.min(nearestOther, arcAngle(dir, other.centre));
  }
  const own = arcAngle(dir, biome.centre);
  const total = own + nearestOther;
  if (total <= 1e-5) return 1;
  return Math.max(0, (nearestOther - own) / total);
}

/**
 * Smoothly blended ground colour. Weighting by inverse distance over all five
 * sites gives soft biome borders (sand creeping into grass) instead of a hard seam.
 */
const _blend = /* @__PURE__ */ new Color();
export function blendedGround(dir: Vector3, useAlt: boolean): Color {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (const biome of BIOME_LIST) {
    const angle = arcAngle(dir, biome.centre);
    // Sharpened inverse-distance weighting: nearby biomes dominate quickly.
    const w = 1 / Math.pow(Math.max(angle, 0.05), 6);
    const colour = useAlt ? biome.groundAlt : biome.ground;
    r += colour.r * w;
    g += colour.g * w;
    b += colour.b * w;
    total += w;
  }
  return _blend.setRGB(r / total, g / total, b / total);
}

/** Great-circle distance from the village, in world units. */
export function distanceFromVillage(dir: Vector3): number {
  return arcAngle(dir, VILLAGE_DIR) * PLANET_RADIUS;
}
