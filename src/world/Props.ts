import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { GeoBuilder } from '../render/GeoBuilder';
import type { Rng } from '../core/Random';
import type { BiomeDef, PropKind } from './Biomes';

/**
 * Procedural low-poly prop kit.
 *
 * Rather than shipping GLB files, every prop is assembled from a handful of cached
 * primitives with baked vertex colours, so the whole set is one material and each
 * kind can be drawn as a single `InstancedMesh`. Each prop is built with its base
 * at y = 0 and roughly 0.3–4.5 units tall (the hero is ~1.8).
 */

const cache = new Map<string, BufferGeometry>();

function cyl(rTop: number, rBottom: number, height: number, segments = 7): BufferGeometry {
  const key = `cyl:${rTop}:${rBottom}:${height}:${segments}`;
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = new CylinderGeometry(rTop, rBottom, height, segments, 1);
    cache.set(key, geometry);
  }
  return geometry;
}

function cone(radius: number, height: number, segments = 7): BufferGeometry {
  const key = `cone:${radius}:${height}:${segments}`;
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = new ConeGeometry(radius, height, segments, 1);
    cache.set(key, geometry);
  }
  return geometry;
}

function ico(detail = 0): BufferGeometry {
  const key = `ico:${detail}`;
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = new IcosahedronGeometry(1, detail);
    cache.set(key, geometry);
  }
  return geometry;
}

function ball(widthSegments = 8, heightSegments = 6): BufferGeometry {
  const key = `ball:${widthSegments}:${heightSegments}`;
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = new SphereGeometry(1, widthSegments, heightSegments);
    cache.set(key, geometry);
  }
  return geometry;
}

function cube(): BufferGeometry {
  const key = 'box';
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = new BoxGeometry(1, 1, 1);
    cache.set(key, geometry);
  }
  return geometry;
}

export const PRIMITIVES = { cyl, cone, ico, ball, cube };

function shade(base: Color, amount: number): Color {
  return base.clone().multiplyScalar(amount);
}

/** Build one prop's geometry for a biome's palette. */
export function buildProp(kind: PropKind, biome: BiomeDef, rng: Rng): BufferGeometry {
  const b = new GeoBuilder();
  const wood = biome.wood;
  const foliage = biome.foliage;
  const foliageAlt = biome.foliageAlt;
  const rock = biome.rock;
  const accent = biome.accent;

  switch (kind) {
    case 'broadTree': {
      b.place(cyl(0.17, 0.27, 2.3, 6), wood, [0, 1.15, 0]);
      b.place(ico(1), foliage, [0, 2.75, 0], [1.35, 1.15, 1.35]);
      b.place(ico(0), foliageAlt, [0.55, 2.3, 0.28], [0.85, 0.75, 0.85]);
      b.place(ico(0), foliageAlt, [-0.45, 3.35, -0.2], [0.72, 0.68, 0.72]);
      break;
    }
    case 'pineTree': {
      b.place(cyl(0.14, 0.2, 1.5, 6), wood, [0, 0.75, 0]);
      b.place(cone(1.25, 1.7, 7), foliage, [0, 1.75, 0]);
      b.place(cone(0.98, 1.5, 7), foliageAlt, [0, 2.65, 0]);
      b.place(cone(0.66, 1.3, 7), foliage, [0, 3.5, 0]);
      break;
    }
    case 'deadTree': {
      b.place(cyl(0.11, 0.24, 2.7, 6), shade(wood, 0.72), [0, 1.35, 0]);
      b.place(cyl(0.07, 0.11, 1.15, 5), shade(wood, 0.66), [0.42, 2.25, 0.1], [1, 1, 1], [0, 0, -0.75]);
      b.place(cyl(0.06, 0.1, 1.0, 5), shade(wood, 0.66), [-0.36, 1.95, -0.16], [1, 1, 1], [0, 0, 0.8]);
      b.place(cyl(0.05, 0.08, 0.8, 5), shade(wood, 0.6), [0.05, 2.85, 0.32], [1, 1, 1], [0.9, 0, 0]);
      break;
    }
    case 'stump': {
      b.place(cyl(0.44, 0.5, 0.55, 8), wood, [0, 0.27, 0]);
      b.place(cyl(0.4, 0.4, 0.07, 8), shade(wood, 1.28), [0, 0.57, 0]);
      break;
    }
    case 'rock': {
      b.place(ico(0), rock, [0, 0.3, 0], [0.62, 0.46, 0.68], [rng() * 3, rng() * 3, rng() * 3]);
      break;
    }
    case 'boulder': {
      b.place(ico(1), rock, [0, 0.72, 0], [1.2, 0.92, 1.28], [rng() * 3, rng() * 3, rng() * 3]);
      b.place(ico(0), shade(rock, 0.86), [0.85, 0.3, 0.5], [0.45, 0.38, 0.45]);
      break;
    }
    case 'crystal': {
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2 + rng();
        const height = 0.9 + rng() * 0.9;
        b.place(
          cone(0.2, height, 5),
          accent,
          [Math.cos(angle) * 0.22, height * 0.45, Math.sin(angle) * 0.22],
          [1, 1, 1],
          [Math.sin(angle) * 0.24, 0, -Math.cos(angle) * 0.24],
          { emissiveBoost: 0.55 },
        );
      }
      b.place(ico(0), shade(rock, 0.8), [0, 0.16, 0], [0.5, 0.26, 0.5]);
      break;
    }
    case 'cactus': {
      b.place(cyl(0.29, 0.33, 2.0, 8), foliage, [0, 1.0, 0]);
      b.place(cyl(0.16, 0.16, 0.7, 6), foliage, [0.42, 1.2, 0], [1, 1, 1], [0, 0, -1.4]);
      b.place(cyl(0.16, 0.16, 0.55, 6), foliage, [0.52, 1.5, 0]);
      b.place(cyl(0.14, 0.14, 0.6, 6), foliageAlt, [-0.38, 0.95, 0], [1, 1, 1], [0, 0, 1.4]);
      b.place(cyl(0.14, 0.14, 0.5, 6), foliageAlt, [-0.47, 1.2, 0]);
      break;
    }
    case 'palm': {
      let x = 0;
      let y = 0;
      for (let i = 0; i < 4; i++) {
        const lean = i * 0.12;
        b.place(cyl(0.14 - i * 0.012, 0.19 - i * 0.012, 0.85, 6), wood, [x, y + 0.42, 0], [1, 1, 1], [0, 0, -lean]);
        y += 0.8;
        x += Math.sin(lean) * 0.8;
      }
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        b.place(
          cube(),
          i % 2 === 0 ? foliage : foliageAlt,
          [x + Math.cos(angle) * 0.68, y + 0.02, Math.sin(angle) * 0.68],
          [1.5, 0.07, 0.34],
          [0, -angle, -0.34],
        );
      }
      b.place(ball(6, 5), accent, [x + 0.16, y - 0.16, 0.14], [0.16, 0.16, 0.16]);
      b.place(ball(6, 5), accent, [x - 0.14, y - 0.2, -0.1], [0.14, 0.14, 0.14]);
      break;
    }
    case 'grassTuft': {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + rng() * 0.6;
        const height = 0.34 + rng() * 0.28;
        b.place(
          cone(0.055, height, 4),
          i % 2 === 0 ? foliage : foliageAlt,
          [Math.cos(angle) * 0.13, height * 0.48, Math.sin(angle) * 0.13],
          [1, 1, 1],
          [Math.sin(angle) * 0.4, 0, -Math.cos(angle) * 0.4],
        );
      }
      break;
    }
    case 'reed': {
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const height = 0.9 + rng() * 0.5;
        b.place(
          cyl(0.03, 0.05, height, 4),
          foliageAlt,
          [Math.cos(angle) * 0.11, height * 0.5, Math.sin(angle) * 0.11],
          [1, 1, 1],
          [Math.sin(angle) * 0.18, 0, -Math.cos(angle) * 0.18],
        );
      }
      break;
    }
    case 'mushroom': {
      b.place(cyl(0.09, 0.12, 0.5, 6), 0xf0e6d2, [0, 0.25, 0]);
      b.place(ball(8, 5), accent, [0, 0.52, 0], [0.4, 0.3, 0.4]);
      b.place(ball(6, 4), 0xfff4e0, [0.14, 0.62, 0.1], [0.07, 0.05, 0.07]);
      b.place(ball(6, 4), 0xfff4e0, [-0.11, 0.6, -0.13], [0.06, 0.04, 0.06]);
      break;
    }
    case 'bones': {
      b.place(cyl(0.06, 0.06, 1.15, 5), 0xe6dfcd, [0.1, 0.07, 0], [1, 1, 1], [0, 0.4, Math.PI / 2]);
      b.place(cyl(0.05, 0.05, 0.9, 5), 0xd8d0bc, [-0.12, 0.06, 0.22], [1, 1, 1], [0, -0.7, Math.PI / 2]);
      b.place(ball(7, 5), 0xece5d2, [0.62, 0.15, -0.1], [0.19, 0.16, 0.19]);
      for (let i = 0; i < 3; i++) {
        b.place(cyl(0.03, 0.03, 0.42, 4), 0xdfd8c4, [-0.1 + i * 0.2, 0.2, -0.16], [1, 1, 1], [0.5, 0, 0.2]);
      }
      break;
    }
    case 'iceSpike': {
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2 + rng() * 1.2;
        const height = 1.1 + rng() * 1.2;
        b.place(
          cone(0.24, height, 5),
          i === 0 ? accent : shade(accent, 0.86),
          [Math.cos(angle) * 0.26, height * 0.45, Math.sin(angle) * 0.26],
          [1, 1, 1],
          [Math.sin(angle) * 0.2, 0, -Math.cos(angle) * 0.2],
          { emissiveBoost: 0.18 },
        );
      }
      break;
    }
    case 'lavaVent': {
      b.place(cyl(0.62, 0.78, 0.34, 9), shade(rock, 0.66), [0, 0.17, 0]);
      b.place(cyl(0.46, 0.46, 0.06, 9), accent, [0, 0.35, 0], [1, 1, 1], [0, 0, 0], { emissiveBoost: 0.95 });
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 + rng();
        b.place(
          ico(0),
          shade(rock, 0.78),
          [Math.cos(angle) * 0.78, 0.16, Math.sin(angle) * 0.78],
          [0.26, 0.2, 0.26],
          [rng() * 3, rng() * 3, rng() * 3],
        );
      }
      break;
    }
    case 'blightThorn': {
      const dark = new Color(0x2f1b3a);
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + rng() * 0.8;
        const height = 0.8 + rng() * 0.9;
        b.place(
          cone(0.15, height, 5),
          dark,
          [Math.cos(angle) * 0.2, height * 0.45, Math.sin(angle) * 0.2],
          [1, 1, 1],
          [Math.sin(angle) * 0.42, 0, -Math.cos(angle) * 0.42],
        );
        b.place(
          cone(0.06, 0.24, 4),
          0x9d5cff,
          [Math.cos(angle) * 0.56, height * 0.9, Math.sin(angle) * 0.56],
          [1, 1, 1],
          [Math.sin(angle) * 0.42, 0, -Math.cos(angle) * 0.42],
          { emissiveBoost: 0.9 },
        );
      }
      break;
    }
    case 'flowerPatch': {
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 + rng();
        const radius = 0.1 + rng() * 0.22;
        const height = 0.24 + rng() * 0.16;
        b.place(cyl(0.022, 0.028, height, 4), foliage, [Math.cos(angle) * radius, height * 0.5, Math.sin(angle) * radius]);
        b.place(
          ball(6, 4),
          i % 2 === 0 ? accent : 0xfff1f5,
          [Math.cos(angle) * radius, height + 0.04, Math.sin(angle) * radius],
          [0.09, 0.06, 0.09],
        );
      }
      break;
    }
  }

  return b.build(`prop:${kind}:${biome.id}`);
}
