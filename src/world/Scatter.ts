import { Group, InstancedMesh, Matrix4, Object3D, Vector3, type BufferGeometry } from 'three';
import { mulberry32, randRange } from '../core/Random';
import {
  arcAngle,
  offsetDirection,
  orientationFrom,
  PLANET_RADIUS,
  randomDirection,
  surfaceHeight,
  surfacePoint,
  tangentise,
} from '../core/SphereMath';
import { toon } from '../render/ToonMaterials';
import { biomeAt, BIOME_LIST, type PropKind } from './Biomes';
import { buildProp } from './Props';

/** A prop that actors cannot walk through. */
export interface Blocker {
  dir: Vector3;
  /** World-unit radius the actor's centre is pushed out to. */
  radius: number;
  /** How tall it stands, so the camera knows what it can fly over. */
  height: number;
}

/** Props big enough to body-block: how wide they block, and how tall they are. */
const BLOCKER_SHAPES: Partial<Record<PropKind, { radius: number; height: number }>> = {
  broadTree: { radius: 0.55, height: 4.3 },
  pineTree: { radius: 0.5, height: 4.6 },
  deadTree: { radius: 0.42, height: 3.2 },
  boulder: { radius: 1.15, height: 1.7 },
  cactus: { radius: 0.48, height: 2.1 },
  palm: { radius: 0.42, height: 3.8 },
  iceSpike: { radius: 0.6, height: 2.4 },
  crystal: { radius: 0.5, height: 1.9 },
  lavaVent: { radius: 0.8, height: 0.5 },
  stump: { radius: 0.5, height: 0.7 },
};

/** Props that skip shadow casting, because there are a lot of them and they are tiny. */
const NO_SHADOW = new Set<PropKind>(['grassTuft', 'flowerPatch', 'reed', 'mushroom', 'bones']);

/** Props that need reasonably level ground. */
const NEEDS_FLAT = new Set<PropKind>(['broadTree', 'pineTree', 'palm', 'cactus', 'deadTree', 'lavaVent']);

export interface ScatterOptions {
  seed?: number;
  /** Keep-out zones (village square, shrine plazas) as {dir, radius} in world units. */
  exclusions?: Array<{ dir: Vector3; radius: number }>;
  /** Scales every biome's density — used by the low quality setting. */
  densityScale?: number;
}

export interface ScatterResult {
  group: Group;
  blockers: Blocker[];
  propCount: number;
}

/** Local steepness, 0 on the flat and ~1 on a cliff. */
export function slopeAt(dir: Vector3): number {
  const up = _up.copy(dir).normalize();
  const t1 = tangentise(_t1.set(up.y, -up.z, up.x), up, _t1);
  const t2 = _t2.copy(t1).cross(up).normalize();
  const h = surfaceHeight(up);
  const step = 0.7;
  const dh1 = surfaceHeight(offsetDirection(up, t1, step, _p1)) - h;
  const dh2 = surfaceHeight(offsetDirection(up, t2, step, _p2)) - h;
  return Math.hypot(dh1, dh2) / step;
}

/**
 * Sprinkle props across every biome.
 *
 * Positions come from rejection sampling: draw a uniform direction on the sphere,
 * keep it if it belongs to the biome we are filling, is outside the keep-out zones
 * and the ground is level enough for the prop. One `InstancedMesh` per
 * biome × prop kind keeps the whole planet's greenery at a few dozen draw calls.
 */
export function scatterProps(options: ScatterOptions = {}): ScatterResult {
  const rng = mulberry32(options.seed ?? 0x9e5d1);
  const group = new Group();
  group.name = 'scatter';
  const blockers: Blocker[] = [];
  const material = toon({ vertexColors: true, steps: 3, flatShading: true });
  const exclusions = options.exclusions ?? [];
  const densityScale = options.densityScale ?? 1;
  const dummy = new Object3D();
  const matrix = new Matrix4();
  let propCount = 0;

  // Surface area of one biome cell, assuming the five sites split the globe evenly.
  const cellArea = (4 * Math.PI * PLANET_RADIUS * PLANET_RADIUS) / BIOME_LIST.length;

  for (const biome of BIOME_LIST) {
    const target = Math.round((cellArea / 1000) * biome.props.density * densityScale);
    const totalWeight = biome.props.kinds.reduce((sum, k) => sum + k.weight, 0);

    for (const entry of biome.props.kinds) {
      const count = Math.max(1, Math.round((entry.weight / totalWeight) * target));
      const placements: Array<{ dir: Vector3; scale: number; spin: number }> = [];
      const needsFlat = NEEDS_FLAT.has(entry.kind);
      let attempts = 0;
      const maxAttempts = count * 60;

      while (placements.length < count && attempts < maxAttempts) {
        attempts++;
        const dir = randomDirection(rng);
        if (biomeAt(dir).id !== biome.id) continue;
        let excluded = false;
        for (const zone of exclusions) {
          if (arcAngle(dir, zone.dir) * PLANET_RADIUS < zone.radius) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;
        if (needsFlat && slopeAt(dir) > 0.55) continue;
        const range = entry.scale ?? [0.85, 1.2];
        placements.push({
          dir,
          scale: randRange(rng, range[0], range[1]),
          spin: rng() * Math.PI * 2,
        });
      }

      if (placements.length === 0) continue;

      const geometry: BufferGeometry = buildProp(entry.kind, biome, rng);
      const mesh = new InstancedMesh(geometry, material, placements.length);
      mesh.name = `${biome.id}:${entry.kind}`;
      mesh.castShadow = !NO_SHADOW.has(entry.kind);
      mesh.receiveShadow = false;
      // One mesh per biome x kind, each covering roughly a fifth of the globe:
      // frustum culling then drops the three or four biomes behind the camera.
      mesh.frustumCulled = true;

      const shape = BLOCKER_SHAPES[entry.kind];
      for (let i = 0; i < placements.length; i++) {
        const place = placements[i];
        const up = place.dir;
        const forward = tangentise(randomDirection(rng), up);
        // Sink very slightly so the base never floats over a facet edge.
        surfacePoint(up, -0.06, dummy.position);
        orientationFrom(up, forward, dummy.quaternion);
        dummy.rotateY(place.spin);
        dummy.scale.setScalar(place.scale);
        dummy.updateMatrix();
        matrix.copy(dummy.matrix);
        mesh.setMatrixAt(i, matrix);
        if (shape) {
          blockers.push({
            dir: up.clone(),
            radius: shape.radius * place.scale,
            height: shape.height * place.scale,
          });
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      // InstancedMesh.boundingSphere accounts for the instance matrices, which is
      // what Frustum.intersectsObject uses.
      mesh.computeBoundingSphere();
      group.add(mesh);
      propCount += placements.length;
    }
  }

  return { group, blockers, propCount };
}

/**
 * Push a direction out of every blocker it overlaps.
 *
 * Brute force over a few hundred blockers is a handful of cheap rejects per actor —
 * less machinery than a spatial index on a sphere, and with none of the cross-cell
 * seams a naive lat/long grid would introduce near the poles.
 */
export function resolveBlockers(
  dir: Vector3,
  actorRadius: number,
  blockers: readonly Blocker[],
  transport: Vector3[] = [],
): boolean {
  let moved = false;
  for (let i = 0; i < blockers.length; i++) {
    const blocker = blockers[i];
    const maxDistance = actorRadius + blocker.radius;
    // For unit vectors, chord = 2 sin(arc/2): reject on the chord before paying acos.
    const chordLimit = 2 * Math.sin(maxDistance / (2 * PLANET_RADIUS));
    if (dir.distanceToSquared(blocker.dir) > chordLimit * chordLimit) continue;

    const distance = arcAngle(dir, blocker.dir) * PLANET_RADIUS;
    if (distance >= maxDistance) continue;
    const away =
      distance < 1e-4
        ? tangentise(_away.set(blocker.dir.y, blocker.dir.z, blocker.dir.x), blocker.dir, _away)
        : tangentise(_away.copy(dir).sub(blocker.dir), blocker.dir, _away);
    offsetDirection(blocker.dir, away, maxDistance, _next);
    dir.copy(_next).normalize();
    for (const v of transport) tangentise(v, dir, v);
    moved = true;
  }
  return moved;
}

const _up = /* @__PURE__ */ new Vector3();
const _t1 = /* @__PURE__ */ new Vector3();
const _t2 = /* @__PURE__ */ new Vector3();
const _p1 = /* @__PURE__ */ new Vector3();
const _p2 = /* @__PURE__ */ new Vector3();
const _away = /* @__PURE__ */ new Vector3();
const _next = /* @__PURE__ */ new Vector3();
