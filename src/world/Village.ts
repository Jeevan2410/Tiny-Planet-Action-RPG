import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { GeoBuilder } from '../render/GeoBuilder';
import { flat, outlineTree, toon } from '../render/ToonMaterials';
import { PRIMITIVES } from './Props';
import {
  offsetDirection,
  orientationFrom,
  PLANET_RADIUS,
  rightOf,
  rotateTangent,
  surfaceHeight,
  tangentise,
} from '../core/SphereMath';
import type { Blocker } from './Scatter';

const { cyl, cone, ico, ball, cube } = PRIMITIVES;

/**
 * A tangent frame for the village.
 *
 * `base` is the transform of the village's own object; `baseInverse` lets a part
 * positioned anywhere on the globe be expressed relative to it. That is the trick
 * that lets a village wrapped around a sphere still merge into one draw call:
 * each building is authored flat, then pushed onto the builder with the transform
 * that stands it upright at its own spot on the curve.
 */
export interface VillageFrame {
  centre: Vector3;
  forward: Vector3;
  right: Vector3;
  base: Matrix4;
  baseInverse: Matrix4;
}

export function villageFrame(centre: Vector3): VillageFrame {
  const up = centre.clone().normalize();
  const forward = tangentise(new Vector3(0, 0, -1), up);
  const right = rightOf(forward, up, new Vector3());
  const base = new Matrix4().compose(
    up.clone().multiplyScalar(PLANET_RADIUS + surfaceHeight(up)),
    orientationFrom(up, forward, new Quaternion()),
    _one,
  );
  return { centre: up, forward, right, base, baseInverse: base.clone().invert() };
}

/** Convert village-local (right, forward) metres into a direction on the globe. */
export function localToDir(frame: VillageFrame, x: number, z: number, out = new Vector3()): Vector3 {
  out.copy(frame.centre);
  const heading = _heading.copy(frame.forward);
  if (z !== 0) {
    offsetDirection(out, heading, z, out);
    tangentise(heading, out, heading);
  }
  if (x !== 0) {
    const right = rightOf(heading, out, _right);
    offsetDirection(out, right, x, out);
  }
  return out;
}

/** World transform for a part standing at village-local (x, z), turned by `facing`. */
export function partTransform(
  frame: VillageFrame,
  x: number,
  z: number,
  facing = 0,
  lift = 0,
  out = new Matrix4(),
): Matrix4 {
  const dir = localToDir(frame, x, z, _dir);
  const forward = tangentise(_partForward.copy(frame.forward), dir, _partForward);
  if (facing !== 0) rotateTangent(forward, dir, -facing);
  return out.compose(
    _position.copy(dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(dir) + lift),
    orientationFrom(dir, forward, _quaternion),
    _one,
  );
}

/** The same transform, expressed relative to the village object. */
function localTransform(
  frame: VillageFrame,
  x: number,
  z: number,
  facing = 0,
  lift = 0,
  out = new Matrix4(),
): Matrix4 {
  partTransform(frame, x, z, facing, lift, out);
  return out.premultiply(frame.baseInverse);
}

/** Stand a scene object on the surface at a village-local position and facing. */
export function placeLocal(
  object: Object3D,
  frame: VillageFrame,
  x: number,
  z: number,
  facing = 0,
  lift = 0,
): Vector3 {
  const dir = localToDir(frame, x, z, new Vector3());
  const forward = tangentise(_partForward.copy(frame.forward), dir, new Vector3());
  if (facing !== 0) rotateTangent(forward, dir, -facing);
  object.position.copy(dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(dir) + lift);
  orientationFrom(dir, forward, object.quaternion);
  object.updateMatrix();
  object.updateMatrixWorld(true);
  return dir;
}

/** The forward tangent an object placed at (x, z) with `facing` ends up with. */
export function localForward(frame: VillageFrame, dir: Vector3, facing: number): Vector3 {
  const forward = tangentise(_partForward.copy(frame.forward), dir, new Vector3());
  if (facing !== 0) rotateTangent(forward, dir, -facing);
  return forward;
}

/**
 * A disc of ground that follows the sphere instead of cutting across it.
 *
 * A flat cylinder 12 units wide would hang 2.5 units above the ground at its rim
 * on a planet this size, so the village square is generated as a spherical cap.
 */
function sphericalDisc(
  frame: VillageFrame,
  radius: number,
  rings: number,
  segments: number,
  lift: number,
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const point = (ring: number, segment: number, target: Vector3): Vector3 => {
    const r = (ring / rings) * radius;
    const angle = (segment / segments) * Math.PI * 2;
    localToDir(frame, Math.cos(angle) * r, Math.sin(angle) * r, target);
    const height = PLANET_RADIUS + surfaceHeight(target) + lift;
    return target.multiplyScalar(height);
  };

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const d = new Vector3();
  const push = (v: Vector3) => {
    positions.push(v.x, v.y, v.z);
    _normal.copy(v).normalize();
    normals.push(_normal.x, _normal.y, _normal.z);
  };

  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      point(ring, segment, a);
      point(ring + 1, segment, b);
      point(ring + 1, segment + 1, c);
      point(ring, segment + 1, d);
      if (ring === 0) {
        push(a);
        push(b);
        push(c);
      } else {
        push(a);
        push(b);
        push(c);
        push(a);
        push(c);
        push(d);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  return geometry;
}

interface HouseOptions {
  width: number;
  depth: number;
  height: number;
  wall: number;
  roof: number;
  trim: number;
  door: number;
}

function buildHouse(b: GeoBuilder, options: HouseOptions): void {
  const { width, depth, height, wall, roof, trim, door } = options;
  b.place(cube(), wall, [0, height / 2, 0], [width, height, depth]);
  b.place(cube(), trim, [0, height * 0.55, -depth / 2 - 0.01], [width * 1.01, 0.12, 0.08]);
  b.place(cube(), trim, [-width / 2, height / 2, -depth / 2], [0.14, height, 0.14]);
  b.place(cube(), trim, [width / 2, height / 2, -depth / 2], [0.14, height, 0.14]);
  b.place(
    cone(Math.max(width, depth) * 0.82, height * 0.72, 4),
    roof,
    [0, height + height * 0.33, 0],
    [1, 1, 1],
    [0, Math.PI / 4, 0],
  );
  b.place(cyl(0.16, 0.2, 0.9, 5), trim, [width * 0.26, height + height * 0.66, depth * 0.2]);
  b.place(cube(), door, [0, 0.62, -depth / 2 - 0.02], [0.66, 1.24, 0.08]);
  b.place(ball(6, 4), 0xf2d08a, [0.22, 0.62, -depth / 2 - 0.08], [0.06, 0.06, 0.06]);
  b.place(cube(), 0x9fd8f0, [-width * 0.3, height * 0.62, -depth / 2 - 0.02], [0.48, 0.44, 0.06]);
  b.place(cube(), 0x9fd8f0, [width * 0.3, height * 0.62, -depth / 2 - 0.02], [0.48, 0.44, 0.06]);
  b.place(cube(), trim, [-width * 0.3, height * 0.62, -depth / 2 - 0.04], [0.54, 0.06, 0.05]);
  b.place(cube(), trim, [width * 0.3, height * 0.62, -depth / 2 - 0.04], [0.54, 0.06, 0.05]);
}

export interface VillageResult {
  group: Group;
  frame: VillageFrame;
  blockers: Blocker[];
  fire: Object3D;
}

const SQUARE_RADIUS = 9.2;
const FENCE_RADIUS = 11.6;

/**
 * The Hearthmeadow village: the safe hub the player returns to between biomes.
 */
export function buildVillage(centre: Vector3): VillageResult {
  const frame = villageFrame(centre);
  const group = new Group();
  group.name = 'village';
  const blockers: Blocker[] = [];
  const material = toon({ vertexColors: true, steps: 3, flatShading: true });
  const b = new GeoBuilder();
  const transform = new Matrix4();

  // Ground: two spherical caps, the inner one a shade darker for the fire ring.
  b.add(sphericalDisc(frame, SQUARE_RADIUS, 6, 28, 0.06).applyMatrix4(frame.baseInverse), _identity, 0xb9ac95);
  b.add(sphericalDisc(frame, 3.3, 2, 20, 0.1).applyMatrix4(frame.baseInverse), _identity, 0xa79a84);

  const at = (x: number, z: number, facing = 0, lift = 0): Matrix4 =>
    localTransform(frame, x, z, facing, lift, transform);

  const houses: Array<{ x: number; z: number; facing: number; options: HouseOptions }> = [
    {
      x: -7.6,
      z: -6.6,
      facing: -0.65,
      options: { width: 4.2, depth: 3.6, height: 2.5, wall: 0xe8d9bc, roof: 0xb4553f, trim: 0x7a5a3c, door: 0x6b4630 },
    },
    {
      x: 7.4,
      z: -6.2,
      facing: 0.75,
      options: { width: 3.8, depth: 3.4, height: 2.3, wall: 0xdfd0b4, roof: 0x8a6ba8, trim: 0x6b5238, door: 0x5a3f2e },
    },
    {
      x: 8.6,
      z: 4.2,
      facing: 2.25,
      options: { width: 4.6, depth: 3.8, height: 2.7, wall: 0xeadcc0, roof: 0x5f9a6a, trim: 0x7a5a3c, door: 0x6b4630 },
    },
    {
      x: -8.4,
      z: 4.8,
      facing: -2.3,
      options: { width: 4.0, depth: 3.5, height: 2.4, wall: 0xe4d5b8, roof: 0xc98a4a, trim: 0x6b5238, door: 0x5a3f2e },
    },
    {
      x: -1.4,
      z: 9.8,
      facing: Math.PI,
      options: { width: 5.0, depth: 4.0, height: 2.9, wall: 0xefe2c8, roof: 0x8a4a42, trim: 0x7a5a3c, door: 0x6b4630 },
    },
  ];

  for (const house of houses) {
    b.pushTransform(at(house.x, house.z, house.facing));
    buildHouse(b, house.options);
    b.popTransform();
    blockers.push({
      dir: localToDir(frame, house.x, house.z, new Vector3()).clone(),
      radius: Math.max(house.options.width, house.options.depth) * 0.52,
      height: house.options.height * 1.8,
    });
  }

  // Well.
  b.pushTransform(at(-4.6, -1.0, 0.4));
  b.place(cyl(0.95, 1.05, 0.85, 9), 0x9a9286, [0, 0.42, 0]);
  b.place(cyl(0.98, 0.98, 0.12, 9), 0x7f7768, [0, 0.9, 0]);
  b.place(cyl(0.12, 0.14, 1.7, 5), 0x7a5a3c, [-0.8, 1.3, 0]);
  b.place(cyl(0.12, 0.14, 1.7, 5), 0x7a5a3c, [0.8, 1.3, 0]);
  b.place(cone(1.5, 0.72, 4), 0xb4553f, [0, 2.4, 0], [1, 1, 1], [0, Math.PI / 4, 0]);
  b.place(cyl(0.08, 0.08, 1.7, 5), 0x6b5238, [0, 2.0, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
  b.place(cube(), 0x6b4630, [0, 1.5, 0], [0.42, 0.38, 0.42]);
  b.popTransform();
  blockers.push({ dir: localToDir(frame, -4.6, -1.0, new Vector3()).clone(), radius: 1.2, height: 2.8 });

  // Market stall — Tam's pitch.
  b.pushTransform(at(5.2, -3.0, -0.9));
  b.place(cube(), 0x8a6a44, [0, 0.55, 0], [2.6, 0.16, 1.3]);
  for (const x of [-1.15, 1.15]) {
    for (const z of [-0.5, 0.5]) b.place(cyl(0.07, 0.08, 1.1, 5), 0x6b5238, [x, 0.3, z]);
    b.place(cyl(0.08, 0.09, 2.0, 5), 0x6b5238, [x, 1.2, -0.55]);
  }
  for (let i = 0; i < 5; i++) {
    b.place(cube(), i % 2 === 0 ? 0xd8674f : 0xf2e2c4, [-1.04 + i * 0.52, 2.2, -0.05], [0.52, 0.1, 1.5], [0.22, 0, 0]);
  }
  b.place(ball(6, 4), 0xd8674f, [-0.7, 0.72, 0.1], [0.2, 0.2, 0.2]);
  b.place(ball(6, 4), 0xf2d08a, [-0.25, 0.7, -0.2], [0.17, 0.17, 0.17]);
  b.place(cube(), 0x7fb56a, [0.4, 0.72, 0.05], [0.42, 0.24, 0.32]);
  b.place(cyl(0.16, 0.2, 0.38, 6), 0x9fd8f0, [0.95, 0.74, -0.1]);
  b.popTransform();
  blockers.push({ dir: localToDir(frame, 5.2, -3.0, new Vector3()).clone(), radius: 1.3, height: 2.4 });

  // Training dummy — Rook's corner.
  b.pushTransform(at(2.6, 5.8, 0.2));
  b.place(cyl(0.14, 0.2, 1.5, 6), 0x7a5a3c, [0, 0.75, 0]);
  b.place(cube(), 0xd8c9a4, [0, 1.55, 0], [0.66, 0.78, 0.5]);
  b.place(ball(6, 4), 0xe4d7b4, [0, 2.12, 0], [0.26, 0.26, 0.26]);
  b.place(cyl(0.09, 0.09, 1.5, 5), 0x6b5238, [0, 1.62, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
  b.place(cube(), 0xb4553f, [0, 1.5, -0.27], [0.34, 0.34, 0.06]);
  b.popTransform();
  blockers.push({ dir: localToDir(frame, 2.6, 5.8, new Vector3()).clone(), radius: 0.55, height: 2.3 });

  // Signpost, pointing at the four biomes.
  b.pushTransform(at(0.2, -7.4, 0));
  b.place(cyl(0.1, 0.13, 2.4, 6), 0x7a5a3c, [0, 1.2, 0]);
  for (const label of [
    { y: 2.0, angle: 0.35, colour: 0xd4753a },
    { y: 1.66, angle: 2.0, colour: 0xe3c483 },
    { y: 1.32, angle: 3.6, colour: 0xc6d6e4 },
    { y: 0.98, angle: 5.0, colour: 0x6d3a52 },
  ]) {
    b.place(
      cube(),
      label.colour,
      [Math.cos(label.angle) * 0.5, label.y, Math.sin(label.angle) * 0.5],
      [1.1, 0.22, 0.08],
      [0, -label.angle, 0],
    );
  }
  b.popTransform();
  blockers.push({ dir: localToDir(frame, 0.2, -7.4, new Vector3()).clone(), radius: 0.35, height: 2.5 });

  // Fence ring, with gaps for the paths out.
  const posts = 30;
  for (let i = 0; i < posts; i++) {
    const angle = (i / posts) * Math.PI * 2;
    if (Math.abs(Math.sin(angle * 2)) < 0.3) continue;
    const x = Math.cos(angle) * FENCE_RADIUS;
    const z = Math.sin(angle) * FENCE_RADIUS;
    b.pushTransform(at(x, z, -angle));
    b.place(cube(), 0x8a6a44, [0, 0.55, 0], [0.16, 1.1, 0.16]);
    b.place(cube(), 0x7a5a3c, [0, 0.8, 0.62], [0.07, 0.1, 1.3]);
    b.place(cube(), 0x7a5a3c, [0, 0.42, 0.62], [0.07, 0.09, 1.3]);
    b.popTransform();
  }

  // Lantern posts.
  for (const spot of [
    [-3.2, 2.4],
    [3.4, 2.2],
    [-3.0, -4.8],
    [3.2, -5.0],
  ] as Array<[number, number]>) {
    b.pushTransform(at(spot[0], spot[1], 0));
    b.place(cyl(0.07, 0.09, 2.2, 5), 0x6b5238, [0, 1.1, 0]);
    b.place(ico(0), 0xffe6a8, [0, 2.3, 0], [0.22, 0.28, 0.22], [0, 0, 0], { emissiveBoost: 1 });
    b.place(cone(0.3, 0.26, 5), 0x8a6a44, [0, 2.62, 0]);
    b.popTransform();
  }

  // Fire pit stones and logs.
  b.pushTransform(at(0, 0, 0));
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    b.place(ico(0), 0x8b8378, [Math.cos(angle) * 0.75, 0.1, Math.sin(angle) * 0.75], [0.24, 0.16, 0.24], [i, i * 2, i * 3]);
  }
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    b.place(
      cyl(0.07, 0.09, 1.0, 5),
      0x5a3f2e,
      [Math.cos(angle) * 0.22, 0.34, Math.sin(angle) * 0.22],
      [1, 1, 1],
      [Math.sin(angle) * 0.55, 0, -Math.cos(angle) * 0.55],
    );
  }
  b.popTransform();

  const mesh = new Mesh(b.build('village'), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.copy(frame.centre).multiplyScalar(PLANET_RADIUS + surfaceHeight(frame.centre));
  orientationFrom(frame.centre, frame.forward, mesh.quaternion);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
  group.add(mesh);

  // The flame is animated, so it stays a separate object.
  const fire = new Group();
  const flame = new Mesh(cone(0.38, 1.0, 6), flat(0xffa23c, 0.92));
  flame.position.y = 0.6;
  const inner = new Mesh(cone(0.2, 0.62, 6), flat(0xffe6a8, 0.95));
  inner.position.y = 0.52;
  fire.add(flame, inner);
  placeLocal(fire, frame, 0, 0, 0, 0.18);
  group.add(fire);
  blockers.push({ dir: localToDir(frame, 0, 0, new Vector3()).clone(), radius: 1.0, height: 0.9 });

  outlineTree(mesh, 0.024);
  return { group, frame, blockers, fire };
}

const _one = /* @__PURE__ */ new Vector3(1, 1, 1);
const _identity = /* @__PURE__ */ new Matrix4();
const _heading = /* @__PURE__ */ new Vector3();
const _right = /* @__PURE__ */ new Vector3();
const _dir = /* @__PURE__ */ new Vector3();
const _partForward = /* @__PURE__ */ new Vector3();
const _position = /* @__PURE__ */ new Vector3();
const _quaternion = /* @__PURE__ */ new Quaternion();
const _normal = /* @__PURE__ */ new Vector3();
