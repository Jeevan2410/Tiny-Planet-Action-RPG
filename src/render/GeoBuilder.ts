import {
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  Matrix3,
  Matrix4,
  Vector3,
  type BufferAttribute,
} from 'three';

/**
 * Accumulates transformed primitives into one geometry with baked vertex colours.
 *
 * Every model in the game (hero, enemies, houses, trees) is assembled from boxes,
 * cylinders and icospheres this way. Baking the colour into vertices means a whole
 * prop — or a whole village — is a single draw call with one shared material, and
 * props can be instanced across the planet without per-part material swaps.
 */
export class GeoBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private normalMatrix = new Matrix3();
  private v = new Vector3();
  /** Transform stack: everything placed is pre-multiplied by the top entry. */
  private stack: Matrix4[] = [];
  private current = new Matrix4();
  private composed = new Matrix4();

  /**
   * Push a transform that subsequent `place`/`add` calls are relative to.
   *
   * Used to lay a village out on a sphere: each building is authored in flat local
   * space, then pushed with the transform that stands it upright on the globe, so
   * the whole village still merges into a single draw call.
   */
  pushTransform(matrix: Matrix4): this {
    this.stack.push(this.current.clone());
    this.current.multiply(matrix);
    return this;
  }

  popTransform(): this {
    const previous = this.stack.pop();
    if (previous) this.current.copy(previous);
    else this.current.identity();
    return this;
  }

  add(
    geometry: BufferGeometry,
    transform: Matrix4,
    color: Color | number,
    options: { emissiveBoost?: number } = {},
  ): this {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = source.getAttribute('position') as BufferAttribute;
    const normal = source.getAttribute('normal') as BufferAttribute | undefined;
    const matrix = this.stack.length
      ? this.composed.copy(this.current).multiply(transform)
      : transform;
    this.normalMatrix.getNormalMatrix(matrix);

    const tint = color instanceof Color ? color : new Color(color);
    const boost = options.emissiveBoost ?? 0;
    const r = Math.min(1, tint.r * (1 + boost));
    const g = Math.min(1, tint.g * (1 + boost));
    const b = Math.min(1, tint.b * (1 + boost));

    for (let i = 0; i < position.count; i++) {
      this.v.fromBufferAttribute(position, i).applyMatrix4(matrix);
      this.positions.push(this.v.x, this.v.y, this.v.z);
      if (normal) {
        this.v.fromBufferAttribute(normal, i).applyMatrix3(this.normalMatrix).normalize();
        this.normals.push(this.v.x, this.v.y, this.v.z);
      } else {
        this.normals.push(0, 1, 0);
      }
      this.colors.push(r, g, b);
    }
    if (source !== geometry) source.dispose();
    return this;
  }

  /** Convenience: place a primitive with position / rotation / scale. */
  place(
    geometry: BufferGeometry,
    color: Color | number,
    position: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
    rotation: [number, number, number] = [0, 0, 0],
    options: { emissiveBoost?: number } = {},
  ): this {
    const m = _scratch;
    m.makeRotationFromEuler(_euler.set(rotation[0], rotation[1], rotation[2]));
    m.scale(_v.set(scale[0], scale[1], scale[2]));
    m.setPosition(position[0], position[1], position[2]);
    return this.add(geometry, m, color, options);
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  build(name = 'built'): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.computeBoundingSphere();
    geometry.name = name;
    return geometry;
  }
}

const _scratch = /* @__PURE__ */ new Matrix4();
const _v = /* @__PURE__ */ new Vector3();
const _euler = /* @__PURE__ */ new Euler();
