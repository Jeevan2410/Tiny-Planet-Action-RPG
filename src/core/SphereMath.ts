import { Matrix4, Quaternion, Vector3 } from 'three';
import { mulberry32, type Rng } from './Random';

/**
 * Everything in the game lives on the surface of a sphere.
 *
 * An actor's transform is stored as:
 *   `dir`     — a unit vector from the planet centre (its "where on the globe")
 *   `forward` — a unit vector tangent to the sphere at `dir` (its "which way")
 *
 * Walking is a rotation of both vectors about the axis `dir x forward`, which is
 * an exact great-circle (geodesic) step and keeps `forward` parallel-transported,
 * so heading never drifts as you cross a pole.
 */

export const PLANET_RADIUS = 30;

/** Terrain relief, in world units, added on top of PLANET_RADIUS. */
export const TERRAIN_AMPLITUDE = 1.15;

const TERRAIN_SEED = 0x51a7e;

type Wave = { dir: Vector3; freq: number; amp: number; phase: number };

/**
 * The height field is a sum of plane waves evaluated on the unit sphere. Because
 * every term is a smooth function of the 3D position, the field is seamless over
 * the whole globe — no UV wrapping, no pole pinching, and it is cheap enough to
 * call per-frame for every actor's footing.
 */
const WAVES: Wave[] = buildWaves(TERRAIN_SEED);

function buildWaves(seed: number): Wave[] {
  const rng = mulberry32(seed);
  const octaves = [
    { freq: 1.15, amp: 0.55 },
    { freq: 2.3, amp: 0.26 },
    { freq: 4.1, amp: 0.13 },
    { freq: 7.4, amp: 0.07 },
    { freq: 12.6, amp: 0.035 },
  ];
  const waves: Wave[] = [];
  for (const octave of octaves) {
    // Three differently-oriented waves per octave to avoid directional banding.
    for (let i = 0; i < 3; i++) {
      waves.push({
        dir: randomDirection(rng),
        freq: octave.freq * (0.85 + rng() * 0.3),
        amp: octave.amp,
        phase: rng() * Math.PI * 2,
      });
    }
  }
  return waves;
}

/** Raw relief of the planet at a surface direction (already normalised). */
export function terrainHeight(dir: Vector3): number {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    h += w.amp * Math.sin(dir.dot(w.dir) * w.freq * Math.PI + w.phase);
  }
  return h * TERRAIN_AMPLITUDE;
}

/**
 * Flattening zones: the village square and each shrine plaza should be level so
 * that buildings do not float and boss arenas read clearly. Registered by the
 * world builder before the planet mesh is generated.
 */
type FlatZone = { dir: Vector3; cosInner: number; cosOuter: number; height: number };
const flatZones: FlatZone[] = [];

export function addFlatZone(dir: Vector3, innerRadius: number, outerRadius: number): void {
  const d = dir.clone().normalize();
  flatZones.push({
    dir: d,
    cosInner: Math.cos(innerRadius / PLANET_RADIUS),
    cosOuter: Math.cos(outerRadius / PLANET_RADIUS),
    height: terrainHeight(d),
  });
}

export function clearFlatZones(): void {
  flatZones.length = 0;
}

/** Terrain relief with flattening zones applied. This is the authoritative surface. */
export function surfaceHeight(dir: Vector3): number {
  let h = terrainHeight(dir);
  for (let i = 0; i < flatZones.length; i++) {
    const zone = flatZones[i];
    const d = dir.dot(zone.dir);
    if (d <= zone.cosOuter) continue;
    // 0 at the outer edge, 1 inside the inner radius.
    const t = smoothstep(zone.cosOuter, zone.cosInner, d);
    h = h + (zone.height - h) * t;
  }
  return h;
}

/** World-space point on the terrain for a direction, plus an optional offset along up. */
export function surfacePoint(dir: Vector3, offset = 0, out = new Vector3()): Vector3 {
  return out.copy(dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(dir) + offset);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(dt: number, halfLife: number): number {
  if (halfLife <= 0) return 1;
  return 1 - Math.pow(2, -dt / halfLife);
}

export function randomDirection(rng: Rng): Vector3 {
  // Uniform on the sphere: z uniform in [-1,1], azimuth uniform.
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(a) * r, z, Math.sin(a) * r);
}

/** Project `v` onto the tangent plane at `up` and normalise it. */
export function tangentise(v: Vector3, up: Vector3, out = new Vector3()): Vector3 {
  out.copy(v).addScaledVector(up, -v.dot(up));
  const len = out.length();
  if (len < 1e-6) {
    // Degenerate: pick any tangent.
    return anyTangent(up, out);
  }
  return out.multiplyScalar(1 / len);
}

export function anyTangent(up: Vector3, out = new Vector3()): Vector3 {
  const helper = Math.abs(up.y) < 0.9 ? UP_Y : FORWARD_Z;
  return out.copy(helper).cross(up).normalize();
}

const UP_Y = /* @__PURE__ */ new Vector3(0, 1, 0);
const FORWARD_Z = /* @__PURE__ */ new Vector3(0, 0, 1);

/** Angle (radians) of the great-circle arc between two unit directions. */
export function arcAngle(a: Vector3, b: Vector3): number {
  return Math.acos(clamp(a.dot(b), -1, 1));
}

/** Surface distance between two unit directions, in world units. */
export function surfaceDistance(a: Vector3, b: Vector3): number {
  return arcAngle(a, b) * PLANET_RADIUS;
}

const _axis = /* @__PURE__ */ new Vector3();
const _quat = /* @__PURE__ */ new Quaternion();

/**
 * Walk `distance` world units from `dir` heading along the tangent `heading`.
 * Rotates `dir` and every vector in `transport` (usually the actor's forward) so
 * headings stay consistent across the whole globe.
 */
export function walk(
  dir: Vector3,
  heading: Vector3,
  distance: number,
  transport: Vector3[] = [],
): void {
  if (distance === 0) return;
  _axis.copy(dir).cross(heading);
  const len = _axis.length();
  if (len < 1e-6) return;
  _axis.multiplyScalar(1 / len);
  _quat.setFromAxisAngle(_axis, distance / PLANET_RADIUS);
  dir.applyQuaternion(_quat).normalize();
  for (const v of transport) v.applyQuaternion(_quat).normalize();
}

/** The tangent direction at `from` that heads towards `to` along the shorter arc. */
export function headingTo(from: Vector3, to: Vector3, out = new Vector3()): Vector3 {
  return tangentise(out.copy(to).sub(from), from, out);
}

/**
 * Signed angle, in radians, from `forward` to `target` measured in the tangent
 * plane at `up`. Positive is anticlockwise about `up` (i.e. to the actor's left).
 */
export function signedTangentAngle(up: Vector3, forward: Vector3, target: Vector3): number {
  const right = _rightScratch.copy(forward).cross(up);
  const x = target.dot(forward);
  const y = -target.dot(right);
  return Math.atan2(y, x);
}

const _rightScratch = /* @__PURE__ */ new Vector3();

/** Local right-hand axis for an actor: +X when up is +Y and forward is -Z. */
export function rightOf(forward: Vector3, up: Vector3, out = new Vector3()): Vector3 {
  return out.copy(forward).cross(up).normalize();
}

const _right = /* @__PURE__ */ new Vector3();
const _back = /* @__PURE__ */ new Vector3();

/**
 * Build a rotation for an object whose local +Y is up and local -Z is forward.
 */
export function orientationFrom(up: Vector3, forward: Vector3, out = new Quaternion()): Quaternion {
  rightOf(forward, up, _right);
  _back.copy(forward).negate();
  _basis.makeBasis(_right, up, _back);
  return out.setFromRotationMatrix(_basis);
}

const _basis = /* @__PURE__ */ new Matrix4();

/** Rotate a tangent vector by `angle` about `up`, in place. */
export function rotateTangent(v: Vector3, up: Vector3, angle: number): Vector3 {
  _quat.setFromAxisAngle(up, angle);
  return v.applyQuaternion(_quat).normalize();
}

/**
 * Turn `forward` towards `desired` by at most `maxAngle`, staying tangent to `up`.
 * Returns the angle actually turned.
 */
export function turnTowards(
  forward: Vector3,
  desired: Vector3,
  up: Vector3,
  maxAngle: number,
): number {
  const delta = signedTangentAngle(up, forward, desired);
  const step = clamp(delta, -maxAngle, maxAngle);
  rotateTangent(forward, up, step);
  return step;
}

/** A direction offset from `dir` by `distance` along tangent `heading`. */
export function offsetDirection(
  dir: Vector3,
  heading: Vector3,
  distance: number,
  out = new Vector3(),
): Vector3 {
  out.copy(dir);
  const h = _headingScratch.copy(heading);
  walk(out, h, distance, [h]);
  return out;
}

const _headingScratch = /* @__PURE__ */ new Vector3();

/** A random direction within `radius` world units of `centre`. */
export function randomNearby(rng: Rng, centre: Vector3, radius: number, minRadius = 0): Vector3 {
  const heading = tangentise(randomDirection(rng), centre);
  const t = Math.sqrt(rng());
  const distance = minRadius + t * (radius - minRadius);
  return offsetDirection(centre, heading, distance);
}
