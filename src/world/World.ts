import { Group, Vector3, type Scene } from 'three';
import { Planet } from './Planet';
import { Sky } from './Sky';
import { scatterProps, type Blocker } from './Scatter';
import { buildVillage, localForward, localToDir, type VillageFrame } from './Village';
import { Shrine } from './Shrine';
import { BIOMES, BIOME_LIST, biomeAt, SANCTUARY_RADIUS, VILLAGE_DIR } from './Biomes';
import { addFlatZone, arcAngle, clamp, PLANET_RADIUS, randomNearby } from '../core/SphereMath';
import { mulberry32, type Rng } from '../core/Random';
import { Enemy } from '../entities/Enemy';
import { Npc } from '../entities/Npc';
import { Pickup, type DropKind } from '../entities/Drops';
import { NPC_LIST } from '../rpg/Dialogue';
import { SHRINE_BIOMES, type BiomeId, type EnemyKind } from '../rpg/Types';
import type { GameContext } from '../core/Context';
import type { Atmosphere } from '../render/Renderer';

interface SpawnPoint {
  kind: EnemyKind;
  biome: BiomeId;
  dir: Vector3;
  enemy: Enemy | null;
  respawnIn: number;
  /** Wardens are one-and-done; everything else comes back. */
  permanent: boolean;
  lootDropped: boolean;
}

const RESPAWN_SECONDS = 55;
const RESPAWN_MIN_DISTANCE = 26;

export interface WorldOptions {
  seed?: number;
  /** Below 1 thins out the scatter for weaker machines. */
  densityScale?: number;
  detail?: number;
}

/**
 * Owns everything that is "the planet": terrain, props, the village, the shrines,
 * the NPCs and the enemy spawn points.
 *
 * The whole world is generated from one integer seed, so a save only has to store
 * progress — not a single tree position.
 */
export class World {
  readonly root = new Group();
  readonly planet: Planet;
  readonly sky: Sky;
  readonly blockers: Blocker[] = [];
  readonly shrines = new Map<BiomeId, Shrine>();
  readonly npcs: Npc[] = [];
  readonly villageFrame: VillageFrame;
  readonly villageDir = VILLAGE_DIR.clone();
  readonly propCount: number;

  private spawns: SpawnPoint[] = [];
  private pickups: Pickup[] = [];
  private fire: Group;
  private firePhase = 0;
  private rng: Rng;
  private enemyLayer = new Group();
  private pickupLayer = new Group();

  constructor(atmosphere: Atmosphere, options: WorldOptions = {}) {
    const seed = options.seed ?? 0x7a1e5;
    this.rng = mulberry32(seed);
    this.root.name = 'world';

    // Flatten the village square and every shrine plaza before anything samples
    // the terrain — the planet mesh, prop scatter and actor footing all read it.
    addFlatZone(VILLAGE_DIR, 13, 20);
    for (const biome of SHRINE_BIOMES) addFlatZone(BIOMES[biome].centre, 7.5, 15);

    this.planet = new Planet(options.detail ?? 5, seed ^ 0x1234);
    this.root.add(this.planet.mesh);

    this.sky = new Sky(atmosphere, seed ^ 0x99);

    const exclusions = [
      { dir: VILLAGE_DIR, radius: 17 },
      ...SHRINE_BIOMES.map((biome) => ({ dir: BIOMES[biome].centre, radius: 13 })),
    ];
    const scatter = scatterProps({
      seed: seed ^ 0x5eed,
      exclusions,
      densityScale: options.densityScale ?? 1,
    });
    this.root.add(scatter.group);
    this.blockers.push(...scatter.blockers);
    this.propCount = scatter.propCount;

    const village = buildVillage(VILLAGE_DIR);
    this.root.add(village.group);
    this.blockers.push(...village.blockers);
    this.villageFrame = village.frame;
    this.fire = village.fire as Group;

    for (const biome of SHRINE_BIOMES) {
      const shrine = new Shrine(biome, BIOMES[biome].centre);
      this.shrines.set(biome, shrine);
      this.root.add(shrine.group);
    }

    for (const def of NPC_LIST) {
      const dir = localToDir(this.villageFrame, def.place[0], def.place[1], new Vector3());
      const forward = localForward(this.villageFrame, dir, def.facing);
      const npc = new Npc(def, dir, forward);
      this.npcs.push(npc);
      this.root.add(npc.group);
      this.blockers.push({ dir: npc.dir.clone(), radius: 0.5, height: 2.4 });
    }

    this.buildSpawnPoints();
    this.root.add(this.enemyLayer, this.pickupLayer);
  }

  private buildSpawnPoints(): void {
    for (const biome of BIOME_LIST) {
      for (const group of biome.spawns) {
        for (let i = 0; i < group.count; i++) {
          const dir = this.findSpawnSpot(biome.id);
          if (!dir) continue;
          this.spawns.push({
            kind: group.kind,
            biome: biome.id,
            dir,
            enemy: null,
            respawnIn: 0,
            permanent: false,
            lootDropped: false,
          });
        }
      }
    }
    // One warden guarding each shrine.
    for (const biome of SHRINE_BIOMES) {
      const centre = BIOMES[biome].centre;
      const dir = randomNearby(this.rng, centre, 7.5, 5.5);
      this.spawns.push({
        kind: 'warden',
        biome,
        dir,
        enemy: null,
        respawnIn: 0,
        permanent: true,
        lootDropped: false,
      });
    }
  }

  /** Rejection-sample a spot inside a biome that is clear of the safe zones. */
  private findSpawnSpot(biome: BiomeId): Vector3 | null {
    for (let attempt = 0; attempt < 200; attempt++) {
      const dir = randomNearby(this.rng, BIOMES[biome].centre, 26, 9);
      if (biomeAt(dir).id !== biome) continue;
      // Clear of the sanctuary by more than the widest patrol loop (7 units), so
      // nothing's idle wandering brushes the fence.
      if (arcAngle(dir, VILLAGE_DIR) * PLANET_RADIUS < SANCTUARY_RADIUS + 8) continue;
      let blocked = false;
      for (const blocker of this.blockers) {
        if (arcAngle(dir, blocker.dir) * PLANET_RADIUS < blocker.radius + 1.2) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      return dir;
    }
    return null;
  }

  addToScene(scene: Scene): void {
    scene.add(this.root);
    scene.add(this.sky.group);
  }

  /**
   * Tear the live world down so a new run can repopulate it.
   *
   * The `World` outlives a run — it is built once and reused when the player quits
   * to the title and starts again — so every enemy, pickup and warden flag has to
   * be cleared or the next run inherits the last one's corpses.
   */
  despawnAll(ctx: GameContext): void {
    for (const enemy of ctx.enemies) this.enemyLayer.remove(enemy.group);
    ctx.enemies.length = 0;
    for (const spawn of this.spawns) {
      spawn.enemy = null;
      spawn.respawnIn = 0;
      spawn.lootDropped = false;
    }
    for (const pickup of this.pickups) this.pickupLayer.remove(pickup.group);
    this.pickups.length = 0;
    this.wardenDefeated.clear();
  }

  /** Spawn everything that should exist right now. Call once per run. */
  populate(ctx: GameContext): void {
    for (const spawn of this.spawns) {
      if (spawn.permanent && this.isWardenDefeated(spawn.biome)) continue;
      this.spawnAt(spawn, ctx);
    }
  }

  private isWardenDefeated(biome: BiomeId): boolean {
    return this.wardenDefeated.has(biome);
  }

  private wardenDefeated = new Set<BiomeId>();

  /** Restore warden state from a save: a cured shrine implies a dead warden. */
  markWardenDefeated(biome: BiomeId): void {
    this.wardenDefeated.add(biome);
  }

  private spawnAt(spawn: SpawnPoint, ctx: GameContext): void {
    const enemy = new Enemy(spawn.kind, spawn.biome, spawn.dir);
    enemy.attachContext(ctx);
    enemy.spawnIndex = this.spawns.indexOf(spawn);
    spawn.enemy = enemy;
    spawn.lootDropped = false;
    ctx.enemies.push(enemy);
    this.enemyLayer.add(enemy.group);
  }

  /** Is the biome's warden still standing? Shrines cannot be cleansed until it is not. */
  wardenAlive(biome: BiomeId): boolean {
    for (const spawn of this.spawns) {
      if (spawn.kind !== 'warden' || spawn.biome !== biome) continue;
      return !!spawn.enemy && !spawn.enemy.dead;
    }
    return false;
  }

  shrine(biome: BiomeId): Shrine | undefined {
    return this.shrines.get(biome);
  }

  addPickup(dir: Vector3, drop: DropKind): void {
    const pickup = new Pickup(dir, drop);
    this.pickups.push(pickup);
    this.pickupLayer.add(pickup.group);
  }

  update(dt: number, ctx: GameContext, playerDir: Vector3): void {
    // Campfire flicker.
    this.firePhase += dt;
    const flicker = 1 + Math.sin(this.firePhase * 11) * 0.09 + Math.sin(this.firePhase * 23) * 0.05;
    for (const child of this.fire.children) {
      child.scale.set(flicker, flicker * (1 + Math.sin(this.firePhase * 17) * 0.12), flicker);
      child.rotation.y += dt * 2.2;
    }

    for (const shrine of this.shrines.values()) {
      const amount = shrine.update(dt, ctx.vfx, playerDir);
      if (shrine.isCuring || amount === 1) this.planet.setHealed(shrine.biome, amount);
    }

    for (const npc of this.npcs) npc.update(dt, dt, playerDir);

    // Deaths: drop loot once, then let respawn timers run.
    for (const spawn of this.spawns) {
      const enemy = spawn.enemy;
      if (!enemy) {
        if (!spawn.permanent) {
          spawn.respawnIn -= dt;
          const far = arcAngle(spawn.dir, playerDir) * PLANET_RADIUS > RESPAWN_MIN_DISTANCE;
          if (spawn.respawnIn <= 0 && far) this.spawnAt(spawn, ctx);
        }
        continue;
      }
      if (enemy.dead && !spawn.lootDropped) {
        spawn.lootDropped = true;
        if (enemy.kind === 'warden') this.wardenDefeated.add(enemy.biome);
        this.dropLoot(enemy);
      }
      if (enemy.readyToRemove) {
        this.enemyLayer.remove(enemy.group);
        const index = ctx.enemies.indexOf(enemy);
        if (index >= 0) ctx.enemies.splice(index, 1);
        spawn.enemy = null;
        spawn.respawnIn = RESPAWN_SECONDS * (0.75 + Math.random() * 0.5);
      }
    }

    // Enemies summoned mid-fight are not owned by a spawn point; clean them up too.
    for (let i = ctx.enemies.length - 1; i >= 0; i--) {
      const enemy = ctx.enemies[i];
      if (enemy.spawnIndex >= 0) continue;
      if (enemy.readyToRemove) {
        this.enemyLayer.remove(enemy.group);
        enemy.group.parent?.remove(enemy.group);
        ctx.enemies.splice(i, 1);
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      if (!this.pickups[i].update(dt, ctx)) {
        this.pickupLayer.remove(this.pickups[i].group);
        this.pickups.splice(i, 1);
      }
    }
  }

  private dropLoot(enemy: Enemy): void {
    const roll = Math.random();
    if (enemy.kind === 'warden') {
      this.addPickup(randomNearby(this.rng, enemy.dir, 1.6), { kind: 'item', id: 'elixir', count: 1 });
      this.addPickup(randomNearby(this.rng, enemy.dir, 2.2), { kind: 'glimmer', amount: 40 });
      return;
    }
    if (roll < 0.34) {
      this.addPickup(randomNearby(this.rng, enemy.dir, 1.2), { kind: 'item', id: 'blightSample', count: 1 });
    } else if (roll < 0.46) {
      this.addPickup(randomNearby(this.rng, enemy.dir, 1.2), { kind: 'item', id: 'salve', count: 1 });
    } else if (roll < 0.62) {
      this.addPickup(randomNearby(this.rng, enemy.dir, 1.2), { kind: 'glimmer', amount: 5 + Math.floor(Math.random() * 9) });
    }
  }

  /** Highest threat level near the hero, used to drive the music. */
  combatIntensity(ctx: GameContext, playerDir: Vector3): number {
    let intensity = 0;
    for (const enemy of ctx.enemies) {
      if (enemy.dead) continue;
      const distance = arcAngle(enemy.dir, playerDir) * PLANET_RADIUS;
      if (distance > 18) continue;
      const near = 1 - clamp(distance / 18, 0, 1);
      const weight = enemy.isBoss ? 1 : enemy.kind === 'brute' ? 0.55 : 0.35;
      intensity = Math.min(1, intensity + near * weight);
    }
    return intensity;
  }
}
