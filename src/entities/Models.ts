import { Color, Group, Mesh, Object3D, type MeshToonMaterial } from 'three';
import { GeoBuilder } from '../render/GeoBuilder';
import { outlineTree, toonUnique } from '../render/ToonMaterials';
import { PRIMITIVES } from '../world/Props';
import { Rig } from './Rig';

const { cyl, cone, ico, ball, cube } = PRIMITIVES;

export interface CharacterModel {
  root: Group;
  rig: Rig;
  material: MeshToonMaterial;
  /** Weapon attach point in the right hand, if the model has one. */
  socket?: Object3D;
  /** Height of the model in world units, for UI anchors and camera framing. */
  height: number;
}

function characterMaterial(): MeshToonMaterial {
  return toonUnique({ vertexColors: true, steps: 3, flatShading: true });
}

/** Build one merged mesh for a bone's parts. */
function part(material: MeshToonMaterial, build: (b: GeoBuilder) => void, name: string): Mesh {
  const builder = new GeoBuilder();
  build(builder);
  const mesh = new Mesh(builder.build(name), material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

function bone(parent: Object3D, x: number, y: number, z: number, name: string): Group {
  const group = new Group();
  group.name = name;
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

export interface HeroPalette {
  skin: number;
  hair: number;
  tunic: number;
  tunicTrim: number;
  trousers: number;
  boots: number;
  cape: number;
  belt: number;
}

export const HERO_PALETTE: HeroPalette = {
  skin: 0xf1c49c,
  hair: 0x6a3f24,
  tunic: 0x4a7fb5,
  tunicTrim: 0xf2d08a,
  trousers: 0x54606e,
  boots: 0x5a3f2e,
  cape: 0xc4553f,
  belt: 0x8a5a3c,
};

/**
 * The hero: a chibi adventurer about 1.8 units tall, built so every limb is its own
 * bone group. Local -Z is forward (matching `orientationFrom`), +Y is up.
 */
export function buildHero(palette: HeroPalette = HERO_PALETTE): CharacterModel {
  const material = characterMaterial();
  const root = new Group();
  root.name = 'hero';

  const body = bone(root, 0, 0, 0, 'body');
  const hips = bone(body, 0, 0.66, 0, 'hips');

  // Torso: tunic that flares towards the hem, plus a belt and a shoulder yoke.
  const torso = bone(hips, 0, 0, 0, 'torso');
  torso.add(
    part(
      material,
      (b) => {
        b.place(cyl(0.3, 0.37, 0.58, 8), palette.tunic, [0, 0.29, 0]);
        b.place(cyl(0.31, 0.31, 0.07, 8), palette.belt, [0, 0.05, 0]);
        b.place(cyl(0.3, 0.26, 0.09, 8), palette.tunicTrim, [0, 0.6, 0]);
        // Cape hanging off the shoulders.
        b.place(cube(), palette.cape, [0, 0.3, 0.2], [0.52, 0.66, 0.09], [0.08, 0, 0]);
        b.place(cube(), palette.cape, [0, -0.02, 0.24], [0.44, 0.34, 0.08], [0.22, 0, 0]);
      },
      'torsoMesh',
    ),
  );

  const head = bone(torso, 0, 0.74, 0, 'head');
  head.add(
    part(
      material,
      (b) => {
        b.place(ball(9, 7), palette.skin, [0, 0.02, 0], [0.245, 0.26, 0.235]);
        // Hair cap with a fringe and a short tail.
        b.place(ball(9, 6), palette.hair, [0, 0.07, 0.01], [0.26, 0.23, 0.25]);
        b.place(cube(), palette.hair, [0, 0.1, -0.2], [0.4, 0.2, 0.12], [0.3, 0, 0]);
        b.place(cone(0.1, 0.3, 5), palette.hair, [0, 0.12, 0.22], [1, 1, 1], [1.1, 0, 0]);
        // Eyes and a hint of a smile, on the -Z face.
        b.place(ball(7, 5), 0x2a2430, [-0.09, 0.0, -0.21], [0.045, 0.062, 0.03]);
        b.place(ball(7, 5), 0x2a2430, [0.09, 0.0, -0.21], [0.045, 0.062, 0.03]);
        b.place(ball(6, 4), 0xffffff, [-0.105, 0.025, -0.225], [0.018, 0.022, 0.014]);
        b.place(ball(6, 4), 0xffffff, [0.075, 0.025, -0.225], [0.018, 0.022, 0.014]);
      },
      'headMesh',
    ),
  );

  const armL = bone(torso, -0.33, 0.5, 0, 'armL');
  armL.add(
    part(
      material,
      (b) => {
        b.place(ball(7, 5), palette.tunic, [0, 0.02, 0], [0.13, 0.12, 0.13]);
        b.place(cyl(0.085, 0.1, 0.32, 6), palette.tunic, [0, -0.17, 0]);
      },
      'armLMesh',
    ),
  );
  const elbowL = bone(armL, 0, -0.33, 0, 'elbowL');
  elbowL.add(
    part(
      material,
      (b) => {
        b.place(cyl(0.075, 0.085, 0.3, 6), palette.skin, [0, -0.15, 0]);
        b.place(ball(7, 5), palette.skin, [0, -0.33, 0], [0.105, 0.105, 0.105]);
      },
      'elbowLMesh',
    ),
  );

  const armR = bone(torso, 0.33, 0.5, 0, 'armR');
  armR.add(
    part(
      material,
      (b) => {
        b.place(ball(7, 5), palette.tunic, [0, 0.02, 0], [0.13, 0.12, 0.13]);
        b.place(cyl(0.085, 0.1, 0.32, 6), palette.tunic, [0, -0.17, 0]);
      },
      'armRMesh',
    ),
  );
  const elbowR = bone(armR, 0, -0.33, 0, 'elbowR');
  elbowR.add(
    part(
      material,
      (b) => {
        b.place(cyl(0.075, 0.085, 0.3, 6), palette.skin, [0, -0.15, 0]);
        b.place(ball(7, 5), palette.skin, [0, -0.33, 0], [0.105, 0.105, 0.105]);
      },
      'elbowRMesh',
    ),
  );
  // The grip: weapons are modelled with the blade running up +Y from the origin.
  const socket = bone(elbowR, 0, -0.38, -0.02, 'socket');
  socket.rotation.x = -0.25;

  const hipL = bone(hips, -0.15, -0.04, 0, 'hipL');
  hipL.add(
    part(
      material,
      (b) => {
        b.place(cyl(0.11, 0.115, 0.34, 6), palette.trousers, [0, -0.17, 0]);
      },
      'hipLMesh',
    ),
  );
  const kneeL = bone(hipL, 0, -0.34, 0, 'kneeL');
  kneeL.add(
    part(
      material,
      (b) => {
        b.place(cyl(0.095, 0.105, 0.3, 6), palette.trousers, [0, -0.15, 0]);
        b.place(cube(), palette.boots, [0, -0.3, -0.05], [0.23, 0.14, 0.34]);
      },
      'kneeLMesh',
    ),
  );

  const hipR = bone(hips, 0.15, -0.04, 0, 'hipR');
  hipR.add(
    part(
      material,
      (b) => {
        b.place(cyl(0.11, 0.115, 0.34, 6), palette.trousers, [0, -0.17, 0]);
      },
      'hipRMesh',
    ),
  );
  const kneeR = bone(hipR, 0, -0.34, 0, 'kneeR');
  kneeR.add(
    part(
      material,
      (b) => {
        b.place(cyl(0.095, 0.105, 0.3, 6), palette.trousers, [0, -0.15, 0]);
        b.place(cube(), palette.boots, [0, -0.3, -0.05], [0.23, 0.14, 0.34]);
      },
      'kneeRMesh',
    ),
  );

  const rig = new Rig(body, {
    body,
    hips,
    torso,
    head,
    armL,
    elbowL,
    armR,
    elbowR,
    hipL,
    kneeL,
    hipR,
    kneeR,
  });

  outlineTree(root, 0.02);
  return { root, rig, material, socket, height: 1.8 };
}

/** Floating swarmer: a blighted mote with a single eye. Fast, fragile, relentless. */
export function buildMote(): CharacterModel {
  const material = characterMaterial();
  const root = new Group();
  root.name = 'mote';
  const body = bone(root, 0, 0.62, 0, 'body');
  const core = bone(body, 0, 0, 0, 'core');
  core.add(
    part(
      material,
      (b) => {
        b.place(ico(1), 0x5d3570, [0, 0, 0], [0.36, 0.34, 0.36]);
        b.place(ico(0), 0x7a4690, [0, 0.1, 0], [0.26, 0.24, 0.26]);
      },
      'coreMesh',
    ),
  );
  const spikes = bone(body, 0, 0, 0, 'spikes');
  spikes.add(
    part(
      material,
      (b) => {
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2;
          b.place(
            cone(0.08, 0.34, 4),
            0x2f1b3a,
            [Math.cos(angle) * 0.34, -0.04, Math.sin(angle) * 0.34],
            [1, 1, 1],
            [Math.sin(angle) * 1.5, 0, -Math.cos(angle) * 1.5],
          );
        }
      },
      'spikeMesh',
    ),
  );
  const eye = bone(body, 0, 0.02, -0.26, 'eye');
  eye.add(
    part(
      material,
      (b) => {
        b.place(ball(8, 6), 0xffe066, [0, 0, 0], [0.12, 0.12, 0.08], [0, 0, 0], { emissiveBoost: 0.8 });
        b.place(ball(7, 5), 0x201626, [0, 0, -0.05], [0.055, 0.075, 0.04]);
      },
      'eyeMesh',
    ),
  );
  const rig = new Rig(body, { body, core, spikes, eye });
  outlineTree(root, 0.022);
  return { root, rig, material, height: 1.0 };
}

/** Heavy hitter: slow, armoured, telegraphs a huge overhead swing. */
export function buildBrute(scale = 1): CharacterModel {
  const material = characterMaterial();
  const root = new Group();
  root.name = 'brute';
  root.scale.setScalar(scale);

  const body = bone(root, 0, 0, 0, 'body');
  const hips = bone(body, 0, 0.72, 0, 'hips');
  const torso = bone(hips, 0, 0, 0, 'torso');
  torso.add(
    part(
      material,
      (b) => {
        b.place(cube(), 0x463652, [0, 0.36, 0], [0.92, 0.78, 0.64]);
        b.place(cube(), 0x574364, [0, 0.66, -0.05], [0.98, 0.28, 0.68]);
        // Blight growths bursting out of the shoulders.
        b.place(cone(0.14, 0.52, 5), 0x2f1b3a, [-0.42, 0.78, 0], [1, 1, 1], [0, 0, 0.55]);
        b.place(cone(0.12, 0.42, 5), 0x2f1b3a, [0.44, 0.76, -0.06], [1, 1, 1], [0.2, 0, -0.6]);
        b.place(cone(0.07, 0.2, 4), 0x9d5cff, [-0.55, 0.99, 0], [1, 1, 1], [0, 0, 0.55], { emissiveBoost: 0.9 });
        b.place(cone(0.06, 0.16, 4), 0x9d5cff, [0.56, 0.95, -0.08], [1, 1, 1], [0.2, 0, -0.6], { emissiveBoost: 0.9 });
      },
      'torsoMesh',
    ),
  );

  const head = bone(torso, 0, 0.78, -0.04, 'head');
  head.add(
    part(
      material,
      (b) => {
        b.place(cube(), 0x3c2e46, [0, 0, 0], [0.42, 0.36, 0.4]);
        b.place(ball(7, 5), 0xff7a5c, [-0.11, 0.03, -0.2], [0.055, 0.055, 0.04], [0, 0, 0], { emissiveBoost: 0.9 });
        b.place(ball(7, 5), 0xff7a5c, [0.11, 0.03, -0.2], [0.055, 0.055, 0.04], [0, 0, 0], { emissiveBoost: 0.9 });
        // Under-bite tusks.
        b.place(cone(0.035, 0.14, 4), 0xe8ddd0, [-0.1, -0.16, -0.15], [1, 1, 1], [Math.PI, 0, 0.15]);
        b.place(cone(0.035, 0.14, 4), 0xe8ddd0, [0.1, -0.16, -0.15], [1, 1, 1], [Math.PI, 0, -0.15]);
      },
      'headMesh',
    ),
  );

  for (const side of [-1, 1] as const) {
    const armName = side < 0 ? 'armL' : 'armR';
    const arm = bone(torso, side * 0.55, 0.58, 0, armName);
    arm.add(
      part(
        material,
        (b) => {
          b.place(ball(7, 5), 0x574364, [0, 0.04, 0], [0.22, 0.2, 0.22]);
          b.place(cyl(0.16, 0.19, 0.46, 6), 0x4e3c5a, [0, -0.23, 0]);
        },
        `${armName}Mesh`,
      ),
    );
    const elbow = bone(arm, 0, -0.48, 0, side < 0 ? 'elbowL' : 'elbowR');
    elbow.add(
      part(
        material,
        (b) => {
          b.place(cyl(0.2, 0.24, 0.5, 6), 0x574364, [0, -0.25, 0]);
          b.place(ico(0), 0x3c2e46, [0, -0.58, 0], [0.3, 0.28, 0.3]);
          b.place(cone(0.07, 0.22, 4), 0x2f1b3a, [0, -0.62, -0.22], [1, 1, 1], [-1.4, 0, 0]);
        },
        `${side < 0 ? 'elbowL' : 'elbowR'}Mesh`,
      ),
    );
  }

  for (const side of [-1, 1] as const) {
    const hipName = side < 0 ? 'hipL' : 'hipR';
    const hip = bone(hips, side * 0.24, -0.06, 0, hipName);
    hip.add(
      part(
        material,
        (b) => {
          b.place(cyl(0.17, 0.18, 0.36, 6), 0x3c2e46, [0, -0.18, 0]);
        },
        `${hipName}Mesh`,
      ),
    );
    const knee = bone(hip, 0, -0.36, 0, side < 0 ? 'kneeL' : 'kneeR');
    knee.add(
      part(
        material,
        (b) => {
          b.place(cyl(0.15, 0.17, 0.32, 6), 0x463652, [0, -0.16, 0]);
          b.place(cube(), 0x2f2438, [0, -0.32, -0.06], [0.34, 0.16, 0.44]);
        },
        `${side < 0 ? 'kneeL' : 'kneeR'}Mesh`,
      ),
    );
  }

  const rig = new Rig(body, {
    body,
    hips,
    torso,
    head,
    armL: torso.getObjectByName('armL')!,
    armR: torso.getObjectByName('armR')!,
    elbowL: torso.getObjectByName('elbowL')!,
    elbowR: torso.getObjectByName('elbowR')!,
    hipL: hips.getObjectByName('hipL')!,
    hipR: hips.getObjectByName('hipR')!,
    kneeL: hips.getObjectByName('kneeL')!,
    kneeR: hips.getObjectByName('kneeR')!,
  });
  outlineTree(root, 0.024);
  return { root, rig, material, height: 2.3 * scale };
}

/** Rooted ranged enemy: a stalk with a snapping bulb that spits blight. */
export function buildSpitter(): CharacterModel {
  const material = characterMaterial();
  const root = new Group();
  root.name = 'spitter';

  const body = bone(root, 0, 0, 0, 'body');
  body.add(
    part(
      material,
      (b) => {
        b.place(ico(1), 0x3d5a42, [0, 0.22, 0], [0.44, 0.26, 0.44]);
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2 + 0.4;
          b.place(
            cone(0.13, 0.5, 4),
            0x4c6b4e,
            [Math.cos(angle) * 0.4, 0.16, Math.sin(angle) * 0.4],
            [1, 0.32, 1],
            [Math.sin(angle) * 1.35, 0, -Math.cos(angle) * 1.35],
          );
        }
      },
      'baseMesh',
    ),
  );

  const stalk = bone(body, 0, 0.34, 0, 'stalk');
  stalk.add(
    part(
      material,
      (b) => {
        b.place(cyl(0.11, 0.17, 0.78, 6), 0x4c6b4e, [0, 0.39, 0]);
        b.place(cone(0.16, 0.34, 4), 0x3d5a42, [-0.22, 0.5, 0.04], [1, 0.3, 1], [0, 0, 1.1]);
        b.place(cone(0.16, 0.34, 4), 0x3d5a42, [0.22, 0.32, -0.04], [1, 0.3, 1], [0, 0, -1.1]);
      },
      'stalkMesh',
    ),
  );

  const headPivot = bone(stalk, 0, 0.82, 0, 'head');
  const jawTop = bone(headPivot, 0, 0, 0, 'jawTop');
  jawTop.add(
    part(
      material,
      (b) => {
        b.place(ball(9, 5), 0x6b3a7a, [0, 0.05, 0], [0.3, 0.26, 0.3]);
        b.place(cone(0.05, 0.16, 4), 0xe8ddd0, [-0.12, -0.02, -0.18], [1, 1, 1], [-1.9, 0, 0]);
        b.place(cone(0.05, 0.16, 4), 0xe8ddd0, [0.12, -0.02, -0.18], [1, 1, 1], [-1.9, 0, 0]);
      },
      'jawTopMesh',
    ),
  );
  const jawBottom = bone(headPivot, 0, -0.02, 0, 'jawBottom');
  jawBottom.add(
    part(
      material,
      (b) => {
        b.place(ball(9, 5), 0x552e63, [0, -0.06, 0], [0.28, 0.2, 0.28]);
        b.place(ball(8, 5), 0x9d5cff, [0, 0.0, -0.06], [0.17, 0.1, 0.17], [0, 0, 0], { emissiveBoost: 0.85 });
      },
      'jawBottomMesh',
    ),
  );

  const rig = new Rig(body, { body, stalk, head: headPivot, jawTop, jawBottom });
  outlineTree(root, 0.022);
  return { root, rig, material, height: 1.75 };
}

/** Shrine warden: the biome boss — a brute grown around a shard of the shrine. */
export function buildWarden(): CharacterModel {
  const model = buildBrute(1.42);
  model.root.name = 'warden';
  const torso = model.rig.bone('torso');
  const head = model.rig.bone('head');
  const material = model.material;
  if (torso) {
    torso.add(
      part(
        material,
        (b) => {
          // Shrine shard fused into the chest — the thing you have to break.
          b.place(ico(0), 0x9d5cff, [0, 0.4, -0.34], [0.22, 0.3, 0.16], [0, 0, 0.3], { emissiveBoost: 1 });
          b.place(cyl(0.5, 0.56, 0.12, 8), 0x2f2438, [0, 0.02, 0]);
        },
        'shardMesh',
      ),
    );
  }
  if (head) {
    head.add(
      part(
        material,
        (b) => {
          for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            b.place(
              cone(0.055, 0.3, 4),
              0x2f1b3a,
              [Math.cos(angle) * 0.2, 0.2, Math.sin(angle) * 0.2],
              [1, 1, 1],
              [Math.sin(angle) * 0.5, 0, -Math.cos(angle) * 0.5],
            );
          }
        },
        'crownMesh',
      ),
    );
  }
  outlineTree(model.root, 0.024);
  return { ...model, height: 3.3 };
}

export type NpcLook = 'elder' | 'shopkeeper' | 'trainer' | 'villager' | 'child';

const NPC_PALETTES: Record<NpcLook, HeroPalette> = {
  elder: {
    skin: 0xe8c3a0,
    hair: 0xe6e2da,
    tunic: 0x6e5aa0,
    tunicTrim: 0xd8c98a,
    trousers: 0x4b4160,
    boots: 0x4a3a2e,
    cape: 0x8a76c0,
    belt: 0x6a5a40,
  },
  shopkeeper: {
    skin: 0xd9a476,
    hair: 0x3a2a22,
    tunic: 0xc98a4a,
    tunicTrim: 0xf5e6c8,
    trousers: 0x6a5240,
    boots: 0x4a3a2e,
    cape: 0xe8d5b0,
    belt: 0x8a6a44,
  },
  trainer: {
    skin: 0xc98f6a,
    hair: 0x2e2a30,
    tunic: 0x8a4a42,
    tunicTrim: 0xb8b0a0,
    trousers: 0x4a4650,
    boots: 0x3a3038,
    cape: 0x6a3a34,
    belt: 0x9a9080,
  },
  villager: {
    skin: 0xf0c49b,
    hair: 0x8a5a3a,
    tunic: 0x5f9a6a,
    tunicTrim: 0xe8dcc0,
    trousers: 0x5a5248,
    boots: 0x4a3a2e,
    cape: 0x7ab08a,
    belt: 0x7a6a50,
  },
  child: {
    skin: 0xf6d2ae,
    hair: 0xb87a3a,
    tunic: 0xd88aa8,
    tunicTrim: 0xfff0f4,
    trousers: 0x6a6070,
    boots: 0x4a3a2e,
    cape: 0xe8a8c0,
    belt: 0x8a7a60,
  },
};

/** Villagers reuse the hero rig with a different palette and a prop in hand. */
export function buildNpc(look: NpcLook): CharacterModel {
  const model = buildHero(NPC_PALETTES[look]);
  model.root.name = `npc:${look}`;
  if (look === 'child') model.root.scale.setScalar(0.74);

  if (look === 'elder' && model.socket) {
    const staff = part(
      model.material,
      (b) => {
        b.place(cyl(0.035, 0.045, 1.5, 5), 0x7a5a3c, [0, 0.55, 0]);
        b.place(ico(0), 0x9de8d0, [0, 1.35, 0], [0.13, 0.16, 0.13], [0, 0, 0], { emissiveBoost: 0.8 });
      },
      'staff',
    );
    model.socket.add(staff);
  }
  if (look === 'trainer' && model.socket) {
    model.socket.add(buildWeapon('trainingBlade', model.material));
  }
  return model;
}

export type WeaponLook = 'trainingBlade' | 'emberBrand' | 'frostEdge' | 'wardenEdge' | 'none';

/**
 * Weapons are modelled with the grip at the origin and the blade running up +Y, so
 * swapping one is a single `socket` child swap.
 */
export function buildWeapon(look: WeaponLook, material: MeshToonMaterial): Group {
  const group = new Group();
  group.name = `weapon:${look}`;
  if (look === 'none') return group;

  const mesh = part(
    material,
    (b) => {
      switch (look) {
        case 'trainingBlade':
          b.place(cyl(0.032, 0.036, 0.24, 6), 0x5a3f2e, [0, -0.1, 0]);
          b.place(cube(), 0x8a6a44, [0, 0.04, 0], [0.24, 0.05, 0.08]);
          b.place(cube(), 0xc9a06a, [0, 0.46, 0], [0.1, 0.84, 0.05]);
          b.place(cone(0.06, 0.16, 4), 0xc9a06a, [0, 0.95, 0], [0.9, 1, 0.5]);
          break;
        case 'emberBrand':
          b.place(cyl(0.034, 0.038, 0.26, 6), 0x4a2a22, [0, -0.11, 0]);
          b.place(cube(), 0x8a4a2a, [0, 0.05, 0], [0.3, 0.06, 0.1]);
          b.place(cube(), 0xb8b2a8, [0, 0.55, 0], [0.11, 0.98, 0.055]);
          b.place(cube(), 0xff8a3c, [0, 0.55, 0], [0.13, 0.86, 0.03], [0, 0, 0], { emissiveBoost: 1 });
          b.place(cone(0.07, 0.2, 4), 0xff8a3c, [0, 1.12, 0], [0.9, 1, 0.5], [0, 0, 0], { emissiveBoost: 0.9 });
          break;
        case 'frostEdge':
          b.place(cyl(0.032, 0.036, 0.24, 6), 0x3a4a5a, [0, -0.1, 0]);
          b.place(cube(), 0x8aa8c0, [0, 0.04, 0], [0.32, 0.05, 0.09]);
          b.place(cube(), 0xd8f0ff, [0, 0.52, 0], [0.12, 0.94, 0.05], [0, 0, 0], { emissiveBoost: 0.35 });
          b.place(cone(0.075, 0.24, 4), 0xa8e0ff, [0, 1.08, 0], [0.85, 1, 0.5], [0, 0, 0], { emissiveBoost: 0.5 });
          b.place(cone(0.05, 0.16, 4), 0xd8f0ff, [0.1, 0.78, 0], [1, 1, 0.5], [0, 0, -0.9], { emissiveBoost: 0.4 });
          break;
        case 'wardenEdge':
          b.place(cyl(0.04, 0.046, 0.34, 6), 0x2f2438, [0, -0.14, 0]);
          b.place(cube(), 0x574364, [0, 0.07, 0], [0.42, 0.08, 0.12]);
          b.place(cube(), 0xbfa8d8, [0, 0.72, 0], [0.2, 1.28, 0.07]);
          b.place(cube(), 0x9d5cff, [0, 0.72, 0], [0.07, 1.16, 0.09], [0, 0, 0], { emissiveBoost: 1 });
          b.place(cone(0.11, 0.3, 4), 0xbfa8d8, [0, 1.48, 0], [0.9, 1, 0.42]);
          break;
      }
    },
    `weaponMesh:${look}`,
  );
  group.add(mesh);
  outlineTree(group, 0.016);
  return group;
}

/** Flash a character's material — used for hit feedback and attack wind-ups. */
export function setFlash(material: MeshToonMaterial, amount: number, colour = 0xffffff): void {
  material.emissive.set(colour);
  material.emissiveIntensity = amount;
}

export const BLIGHT_GLOW = new Color(0x9d5cff);
