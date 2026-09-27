import {
  BufferAttribute,
  Color,
  IcosahedronGeometry,
  Mesh,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mulberry32 } from '../core/Random';
import { arcAngle, clamp, PLANET_RADIUS, smoothstep, surfaceHeight } from '../core/SphereMath';
import { toon } from '../render/ToonMaterials';
import { biomeAt, blendedGround, BIOMES } from './Biomes';
import { SHRINE_BIOMES, type BiomeId } from '../rpg/Types';

/** Colour the ground takes on where the blight has spread. */
const BLIGHT_COLOR = new Color(0x4a2a55);
const BLIGHT_RADIUS = 21;

/**
 * The planet itself: a displaced icosphere with flat-shaded, per-face vertex
 * colours.
 *
 * Because the geometry is non-indexed, each triangle owns its three vertices, so
 * writing one colour to all three gives clean facets and lets us repaint regions
 * at runtime — which is how curing a shrine visibly heals the land around it.
 */
export class Planet {
  readonly mesh: Mesh;
  private geometry: BufferGeometry;
  private healthyColor: Float32Array;
  private blightedColor: Float32Array;
  /** Vertex indices touched by each shrine's blight, for cheap repaints. */
  private blightVertices = new Map<BiomeId, number[]>();
  private healAmount = new Map<BiomeId, number>();

  constructor(detail = 5, seed = 0x7b10e) {
    this.geometry = new IcosahedronGeometry(PLANET_RADIUS, detail);
    const position = this.geometry.getAttribute('position') as BufferAttribute;
    const count = position.count;

    const rng = mulberry32(seed);
    const colors = new Float32Array(count * 3);
    this.healthyColor = new Float32Array(count * 3);
    this.blightedColor = new Float32Array(count * 3);

    const dir = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const centroid = new Vector3();
    const faceNormal = new Vector3();
    const edge1 = new Vector3();
    const edge2 = new Vector3();
    const colour = new Color();

    for (const biome of SHRINE_BIOMES) this.blightVertices.set(biome, []);
    for (const biome of SHRINE_BIOMES) this.healAmount.set(biome, 0);

    // Pass 1: displace vertices onto the terrain.
    for (let i = 0; i < count; i++) {
      dir.fromBufferAttribute(position, i).normalize();
      const radius = PLANET_RADIUS + surfaceHeight(dir);
      position.setXYZ(i, dir.x * radius, dir.y * radius, dir.z * radius);
    }

    // Pass 2: colour per face from biome blend, slope and altitude.
    for (let f = 0; f < count; f += 3) {
      a.fromBufferAttribute(position, f);
      b.fromBufferAttribute(position, f + 1);
      c.fromBufferAttribute(position, f + 2);
      centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      dir.copy(centroid).normalize();

      edge1.copy(b).sub(a);
      edge2.copy(c).sub(a);
      faceNormal.copy(edge1).cross(edge2).normalize();
      // 1 on flat ground, 0 on a cliff.
      const flatness = clamp(faceNormal.dot(dir), 0, 1);
      const slope = 1 - flatness;

      const biome = biomeAt(dir);
      const variation = rng();
      colour.copy(blendedGround(dir, variation > 0.55));

      // Rock shows through on steep faces.
      const rockiness = smoothstep(0.12, 0.42, slope);
      colour.lerp(biome.rock, rockiness * 0.9);

      // Highest ground gets the biome's peak colour (snow, scorch, bleached sand).
      const height = centroid.length() - PLANET_RADIUS;
      const peakBlend = smoothstep(biome.peakHeight * 0.55, biome.peakHeight, height);
      colour.lerp(biome.peak, peakBlend * 0.85);

      // Hand-painted wobble so neighbouring facets never match exactly.
      const tint = 0.94 + variation * 0.12;
      colour.multiplyScalar(tint);

      // Blight: a dark halo around every corrupted shrine.
      let blight = 0;
      let blightSource: BiomeId | null = null;
      for (const biomeId of SHRINE_BIOMES) {
        const shrineDir = BIOMES[biomeId].centre;
        const distance = arcAngle(dir, shrineDir) * PLANET_RADIUS;
        const influence = 1 - smoothstep(BLIGHT_RADIUS * 0.35, BLIGHT_RADIUS, distance);
        if (influence > blight) {
          blight = influence;
          blightSource = biomeId;
        }
      }

      for (let v = 0; v < 3; v++) {
        const index = (f + v) * 3;
        this.healthyColor[index] = colour.r;
        this.healthyColor[index + 1] = colour.g;
        this.healthyColor[index + 2] = colour.b;
      }

      if (blight > 0.004 && blightSource) {
        const strength = blight * 0.82;
        const r = colour.r + (BLIGHT_COLOR.r - colour.r) * strength;
        const g = colour.g + (BLIGHT_COLOR.g - colour.g) * strength;
        const bb = colour.b + (BLIGHT_COLOR.b - colour.b) * strength;
        const list = this.blightVertices.get(blightSource)!;
        for (let v = 0; v < 3; v++) {
          const index = (f + v) * 3;
          this.blightedColor[index] = r;
          this.blightedColor[index + 1] = g;
          this.blightedColor[index + 2] = bb;
          list.push(f + v);
        }
      } else {
        for (let v = 0; v < 3; v++) {
          const index = (f + v) * 3;
          this.blightedColor[index] = this.healthyColor[index];
          this.blightedColor[index + 1] = this.healthyColor[index + 1];
          this.blightedColor[index + 2] = this.healthyColor[index + 2];
        }
      }

      for (let v = 0; v < 3; v++) {
        const index = (f + v) * 3;
        colors[index] = this.blightedColor[index];
        colors[index + 1] = this.blightedColor[index + 1];
        colors[index + 2] = this.blightedColor[index + 2];
      }
    }

    this.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();

    this.mesh = new Mesh(this.geometry, toon({ vertexColors: true, steps: 4 }));
    this.mesh.name = 'planet';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  /** Cross-fade one shrine's blight halo back to healthy ground. 0 = blighted. */
  setHealed(biome: BiomeId, amount: number): void {
    const clamped = clamp(amount, 0, 1);
    if (this.healAmount.get(biome) === clamped) return;
    this.healAmount.set(biome, clamped);
    const list = this.blightVertices.get(biome);
    if (!list || list.length === 0) return;
    const attribute = this.geometry.getAttribute('color') as BufferAttribute;
    const array = attribute.array as Float32Array;
    for (const vertex of list) {
      const index = vertex * 3;
      for (let k = 0; k < 3; k++) {
        const from = this.blightedColor[index + k];
        const to = this.healthyColor[index + k];
        array[index + k] = from + (to - from) * clamped;
      }
    }
    attribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
