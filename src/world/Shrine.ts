import { Color, Group, Mesh, Vector3, type MeshToonMaterial } from 'three';
import { GeoBuilder } from '../render/GeoBuilder';
import { flat, outlineTree, toonUnique } from '../render/ToonMaterials';
import { PRIMITIVES } from './Props';
import {
  arcAngle,
  clamp,
  headingTo,
  orientationFrom,
  PLANET_RADIUS,
  signedTangentAngle,
  smoothstep,
  surfaceHeight,
  tangentise,
} from '../core/SphereMath';
import type { BiomeId } from '../rpg/Types';
import type { Vfx } from '../render/Vfx';

const { cyl, cone, ico, cube } = PRIMITIVES;

const CORRUPT_STONE = new Color(0x3b2c44);
const CURED_STONE = new Color(0xd8cdb8);
const CORRUPT_CRYSTAL = new Color(0x9d5cff);
const CURED_CRYSTAL = new Color(0xffd98a);

export const SHRINE_RADIUS = 4.6;

/**
 * A biome's shrine: the milestone object.
 *
 * Corrupted it is dark stone wrapped in thorns with a bruise-coloured crystal.
 * Cured it is pale stone, a warm crystal and a column of light — and the land
 * around it repaints to healthy colours as the cure animation plays.
 */
export class Shrine {
  readonly group = new Group();
  readonly biome: BiomeId;
  readonly dir: Vector3;

  /** 0 = fully corrupted, 1 = fully cured. Drives every visual. */
  private cureAmount = 0;
  private curing = false;
  private cureElapsed = 0;
  private moteTimer = 0;
  private phase = Math.random() * 10;

  private stoneMaterial: MeshToonMaterial;
  private crystalMaterial: MeshToonMaterial;
  private crystal: Group;
  private thorns: Group;
  private beam: Mesh;

  static readonly CURE_DURATION = 2.8;

  constructor(biome: BiomeId, dir: Vector3) {
    this.biome = biome;
    this.dir = dir.clone().normalize();
    this.group.name = `shrine:${biome}`;

    this.stoneMaterial = toonUnique({ vertexColors: true, steps: 3, flatShading: true });
    this.crystalMaterial = toonUnique({ vertexColors: true, steps: 3, flatShading: true });

    // Stepped plinth and four pillars.
    const stone = new GeoBuilder();
    stone.place(cyl(4.3, 4.6, 0.42, 12), 0xffffff, [0, 0.21, 0]);
    stone.place(cyl(3.5, 3.9, 0.38, 12), 0xf0f0f0, [0, 0.6, 0]);
    stone.place(cyl(2.7, 3.1, 0.34, 12), 0xe4e4e4, [0, 0.96, 0]);
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(angle) * 3.0;
      const z = Math.sin(angle) * 3.0;
      stone.place(cyl(0.26, 0.34, 2.9, 7), 0xf2f2f2, [x, 2.4, z]);
      stone.place(cube(), 0xdcdcdc, [x, 3.95, z], [0.82, 0.24, 0.82], [0, angle, 0]);
      stone.place(cone(0.3, 0.5, 5), 0xffffff, [x, 4.3, z], [1, 1, 1], [0, angle, 0]);
    }
    stone.place(cyl(0.72, 0.95, 1.25, 8), 0xf6f6f6, [0, 1.75, 0]);
    stone.place(cyl(0.95, 0.75, 0.2, 8), 0xdedede, [0, 2.45, 0]);
    const stoneMesh = new Mesh(stone.build('shrineStone'), this.stoneMaterial);
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    this.group.add(stoneMesh);

    // Floating crystal.
    this.crystal = new Group();
    const crystalBuilder = new GeoBuilder();
    crystalBuilder.place(ico(0), 0xffffff, [0, 0, 0], [0.42, 0.78, 0.42]);
    crystalBuilder.place(cone(0.32, 0.72, 5), 0xf0f0f0, [0, 0.62, 0]);
    crystalBuilder.place(cone(0.32, 0.72, 5), 0xf0f0f0, [0, -0.62, 0], [1, 1, 1], [Math.PI, 0, 0]);
    const crystalMesh = new Mesh(crystalBuilder.build('shrineCrystal'), this.crystalMaterial);
    crystalMesh.castShadow = true;
    this.crystal.add(crystalMesh);
    this.crystal.position.y = 3.5;
    this.group.add(this.crystal);

    // Blight thorns, faded out when the shrine is cured.
    this.thorns = new Group();
    const thornBuilder = new GeoBuilder();
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2 + 0.3;
      const radius = 3.2 + (i % 3) * 0.55;
      const height = 1.1 + (i % 4) * 0.5;
      thornBuilder.place(
        cone(0.22, height, 5),
        0x2f1b3a,
        [Math.cos(angle) * radius, height * 0.4, Math.sin(angle) * radius],
        [1, 1, 1],
        [Math.sin(angle) * 0.5, 0, -Math.cos(angle) * 0.5],
      );
      thornBuilder.place(
        cone(0.09, 0.3, 4),
        0x9d5cff,
        [Math.cos(angle) * (radius + 0.28), height * 0.85, Math.sin(angle) * (radius + 0.28)],
        [1, 1, 1],
        [Math.sin(angle) * 0.5, 0, -Math.cos(angle) * 0.5],
        { emissiveBoost: 0.9 },
      );
    }
    const thornMaterial = toonUnique({ vertexColors: true, steps: 3, flatShading: true, transparent: true });
    const thornMesh = new Mesh(thornBuilder.build('shrineThorns'), thornMaterial);
    thornMesh.castShadow = true;
    this.thorns.add(thornMesh);
    this.group.add(this.thorns);

    // Column of light, only visible once cured.
    const beamMaterial = flat(0xffe6a8, 0.3, { fog: false, doubleSide: true });
    this.beam = new Mesh(cyl(1.5, 0.9, 26, 10), beamMaterial);
    this.beam.position.y = 13;
    this.beam.visible = false;
    this.beam.userData.noOutline = true;
    this.beam.renderOrder = 4;
    this.group.add(this.beam);

    outlineTree(stoneMesh, 0.03);
    outlineTree(crystalMesh, 0.028);

    // Seat the shrine on the (flattened) terrain.
    const up = this.dir;
    const forward = tangentise(new Vector3(up.y, up.z, up.x), up);
    this.group.position.copy(up).multiplyScalar(PLANET_RADIUS + surfaceHeight(up) - 0.25);
    orientationFrom(up, forward, this.group.quaternion);

    this.applyCureVisuals();
  }

  get cured(): boolean {
    return this.cureAmount >= 1;
  }

  get isCuring(): boolean {
    return this.curing;
  }

  /** Restore a saved game: cured shrines start fully cured, with no animation. */
  setCuredInstant(cured: boolean): void {
    this.cureAmount = cured ? 1 : 0;
    this.curing = false;
    this.applyCureVisuals();
  }

  /** Kick off the cure animation. Returns false if it is already running or done. */
  beginCure(): boolean {
    if (this.curing || this.cured) return false;
    this.curing = true;
    this.cureElapsed = 0;
    return true;
  }

  /** @returns the 0..1 cure progress, for the caller to drive the planet repaint. */
  update(dt: number, vfx: Vfx, playerDir: Vector3): number {
    this.phase += dt;

    if (this.curing) {
      this.cureElapsed += dt;
      const t = clamp(this.cureElapsed / Shrine.CURE_DURATION, 0, 1);
      this.cureAmount = smoothstep(0, 1, t);
      if (t >= 1) this.curing = false;
      this.applyCureVisuals();

      // Light pouring out of the crystal as it turns.
      const crystalPoint = _v1.copy(this.dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(this.dir) + 3.4);
      for (let i = 0; i < 3; i++) vfx.mote(crystalPoint, 0xffe6a8, 3.2, 1.5);
      if (this.cureElapsed < dt * 2) {
        vfx.shockSphere(crystalPoint, 16, 0xffe6a8, 1.6);
        vfx.ring(this.dir, 1, 22, 1.8, 0xffe6a8, 0.8, 0.3);
      }
    }

    // Crystal bob and spin; faster and steadier once cured.
    const bob = Math.sin(this.phase * (this.cured ? 1.1 : 1.9)) * (this.cured ? 0.22 : 0.12);
    this.crystal.position.y = 3.5 + bob;
    this.crystal.rotation.y += dt * (this.cured ? 0.6 : 1.5);
    this.crystal.rotation.z = Math.sin(this.phase * 0.7) * (this.cured ? 0.05 : 0.18);

    if (this.beam.visible) {
      const material = this.beam.material as { opacity: number };
      material.opacity = (0.16 + Math.sin(this.phase * 1.7) * 0.05) * this.cureAmount;
    }

    // Ambient motes, but only when the hero is close enough to see them.
    const distance = arcAngle(this.dir, playerDir) * PLANET_RADIUS;
    if (distance < 26) {
      this.moteTimer -= dt;
      if (this.moteTimer <= 0) {
        this.moteTimer = this.cured ? 0.35 : 0.2;
        const angle = Math.random() * Math.PI * 2;
        const radius = 1 + Math.random() * 3.6;
        const point = _v1
          .copy(this.dir)
          .multiplyScalar(PLANET_RADIUS + surfaceHeight(this.dir) + 0.4 + Math.random() * 2.5);
        const forward = tangentise(_v2.set(this.dir.y, this.dir.z, this.dir.x), this.dir, _v2);
        const right = _v3.copy(forward).cross(this.dir).normalize();
        point.addScaledVector(forward, Math.cos(angle) * radius).addScaledVector(right, Math.sin(angle) * radius);
        vfx.mote(point, this.cured ? 0xffe6a8 : 0x9d5cff, this.cured ? 1.1 : 0.55, this.cured ? 2.2 : 1.6);
      }
    }

    return this.cureAmount;
  }

  private applyCureVisuals(): void {
    const t = this.cureAmount;
    _colour.copy(CORRUPT_STONE).lerp(CURED_STONE, t);
    this.stoneMaterial.color.copy(_colour);
    _colour.copy(CORRUPT_CRYSTAL).lerp(CURED_CRYSTAL, t);
    this.crystalMaterial.color.copy(_colour);
    this.crystalMaterial.emissive.copy(_colour);
    this.crystalMaterial.emissiveIntensity = 0.45 + t * 0.55;

    const thornMesh = this.thorns.children[0] as Mesh;
    const thornMaterial = thornMesh.material as MeshToonMaterial;
    thornMaterial.opacity = 1 - t;
    thornMaterial.transparent = t > 0.001;
    this.thorns.visible = t < 0.995;
    this.thorns.scale.setScalar(Math.max(0.001, 1 - t));

    this.beam.visible = t > 0.02;
  }

  /** Prompt scoring, matching the NPC rules. */
  interactScore(playerDir: Vector3, playerForward: Vector3): number | null {
    const distance = arcAngle(this.dir, playerDir) * PLANET_RADIUS;
    if (distance > SHRINE_RADIUS + 1.6) return null;
    const heading = headingTo(playerDir, this.dir, _v1);
    const angle = Math.abs(signedTangentAngle(playerDir, playerForward, heading));
    if (angle > 2.4) return null;
    return distance + angle * 0.5;
  }
}

const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();
const _v3 = /* @__PURE__ */ new Vector3();
const _colour = /* @__PURE__ */ new Color();
