import { Vector3 } from 'three';
import type { Game } from './Game';
import { getState, derivedStats, actions } from '../state/gameState';
import { BIOMES, biomeAt } from '../world/Biomes';
import { surfaceDistance } from './SphereMath';
import type { BiomeId } from '../rpg/Types';
import type { ItemId } from '../rpg/Items';

/**
 * A read-only snapshot of the running game, hung off `window.__debug()`.
 *
 * Handy when something looks wrong on screen and you want numbers instead of a
 * squint. It exposes no mutators — the cheats below are registered only in a dev
 * build, so a deployed game has nothing to poke at.
 */
export interface DebugSnapshot {
  phase: string;
  biome: string;
  position: [number, number, number];
  facing: [number, number, number];
  playerState: string;
  timeInState: number;
  speed: number;
  hp: number;
  maxHp: number;
  stamina: number;
  level: number;
  xp: number;
  glimmer: number;
  enemiesAlive: number;
  enemiesTotal: number;
  enemiesVisible: number;
  nearestEnemy: { kind: string; state: string; distance: number } | null;
  distanceToVillage: number;
  shrines: Record<string, boolean>;
  quests: Record<string, string>;
  hitStop: number;
  frozen: boolean;
  gameSeconds: number;
  wallSeconds: number;
  interactLabel: string | null;
  uiOpen: boolean;
  dialogueOpen: boolean;
  fps: number;
  frames: number;
  drawCalls: number;
  triangles: number;
}

interface GameInternals {
  phase: string;
  hitStopTimer: number;
  loop: { elapsed: number; timeScale: number };
  player: {
    dir: Vector3;
    forward: Vector3;
    state: string;
    groundSpeed: number;
    timeInState: number;
  } | null;
  enemies: Array<{
    kind: string;
    state: string;
    dir: Vector3;
    dead: boolean;
    group: { visible: boolean };
    hurt(damage: number, heading: Vector3, knockback: number, ctx: unknown): void;
  }>;
  ui: { anyOpen: boolean; dialogue: { isOpen: boolean } };
  ctx: { interactTarget(): { label: string } | null; interact(): boolean };
  world: { villageDir: Vector3; npcs: Array<{ def: { id: string }; dir: Vector3; forward: Vector3 }> } | null;
  fps: number;
  frames: number;
  renderer: { renderer: { info: { render: { calls: number; triangles: number } } } };
}

export function installDebug(game: Game): void {
  const internals = game as unknown as GameInternals;

  const snapshot = (): DebugSnapshot | null => {
    const state = getState();
    const stats = derivedStats(state);
    const player = internals.player;
    if (!player) return null;
    const alive = internals.enemies.filter((enemy) => !enemy.dead);
    let nearest: DebugSnapshot['nearestEnemy'] = null;
    for (const enemy of alive) {
      const distance = surfaceDistance(enemy.dir, player.dir);
      if (!nearest || distance < nearest.distance) {
        nearest = { kind: enemy.kind, state: enemy.state, distance: Number(distance.toFixed(2)) };
      }
    }
    const quests: Record<string, string> = {};
    for (const [id, progress] of Object.entries(state.quests)) {
      quests[id] = `${progress.stage}:${progress.counters.join(',')}`;
    }
    return {
      phase: internals.phase,
      biome: biomeAt(player.dir).id,
      position: [round(player.dir.x), round(player.dir.y), round(player.dir.z)],
      facing: [round(player.forward.x), round(player.forward.y), round(player.forward.z)],
      playerState: player.state,
      timeInState: Number(player.timeInState.toFixed(3)),
      speed: Number(player.groundSpeed.toFixed(2)),
      hp: Math.round(state.hp),
      maxHp: stats.maxHp,
      stamina: Math.round(state.stamina),
      level: state.level,
      xp: state.xp,
      glimmer: state.glimmer,
      enemiesAlive: alive.length,
      enemiesTotal: internals.enemies.length,
      enemiesVisible: internals.enemies.filter((enemy) => enemy.group.visible).length,
      nearestEnemy: nearest,
      distanceToVillage: internals.world
        ? Number(surfaceDistance(player.dir, internals.world.villageDir).toFixed(2))
        : -1,
      shrines: { ...state.shrines },
      quests,
      hitStop: Number(internals.hitStopTimer.toFixed(3)),
      frozen: internals.ui.anyOpen,
      gameSeconds: Number(internals.loop.elapsed.toFixed(2)),
      wallSeconds: Number((performance.now() / 1000).toFixed(2)),
      interactLabel: internals.ctx.interactTarget()?.label ?? null,
      uiOpen: internals.ui.anyOpen,
      dialogueOpen: internals.ui.dialogue.isOpen,
      fps: Math.round(internals.fps),
      frames: internals.frames,
      drawCalls: internals.renderer.renderer.info.render.calls,
      triangles: internals.renderer.renderer.info.render.triangles,
    };
  };

  Object.assign(window, { __debug: snapshot });

  if (!import.meta.env.DEV) return;

  // Dev-only shortcuts, so a playtest does not need a 20-minute run-up.
  Object.assign(window, {
    __cheat: {
      teleport(biome: BiomeId, offset = 9): void {
        const player = internals.player;
        if (!player) return;
        const target = BIOMES[biome].centre.clone();
        const away = new Vector3(target.y, target.z, target.x).cross(target).normalize();
        const angle = offset / 30;
        target.multiplyScalar(Math.cos(angle)).addScaledVector(away, Math.sin(angle)).normalize();
        player.dir.copy(target);
      },
      grant(id: ItemId, count = 1): void {
        actions.addItem(id, count);
      },
      xp(amount: number): void {
        actions.gainXp(amount);
      },
      glimmer(amount: number): void {
        actions.addGlimmer(amount);
      },
      /** Stand in front of an NPC, facing them — the deterministic way to test talking. */
      gotoNpc(id: string): boolean {
        const player = internals.player;
        const npc = internals.world?.npcs.find((candidate) => candidate.def.id === id);
        if (!player || !npc) return false;
        const back = npc.forward.clone().negate();
        const angle = 1.6 / 30;
        player.dir
          .copy(npc.dir)
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(back, Math.sin(angle))
          .normalize();
        player.forward.copy(npc.dir).addScaledVector(player.dir, -npc.dir.dot(player.dir)).normalize();
        return true;
      },
      /** Stand a few paces from the nearest living enemy of a kind. */
      gotoEnemy(kind?: string, distance = 3.2): boolean {
        const player = internals.player;
        if (!player) return false;
        let best: { dir: Vector3; d: number } | null = null;
        for (const enemy of internals.enemies) {
          if (enemy.dead) continue;
          if (kind && enemy.kind !== kind) continue;
          const d = surfaceDistance(enemy.dir, player.dir);
          if (!best || d < best.d) best = { dir: enemy.dir, d };
        }
        if (!best) return false;
        const target = best.dir;
        const away = new Vector3(target.y, target.z, target.x).cross(target).normalize();
        const angle = distance / 30;
        player.dir
          .copy(target)
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(away, Math.sin(angle))
          .normalize();
        player.forward.copy(target).addScaledVector(player.dir, -target.dot(player.dir)).normalize();
        return true;
      },
      hurt(amount: number): void {
        const state = getState();
        actions.setVitals(state.hp - amount, state.stamina);
      },
      /** Properly slay everything nearby, so XP, loot and quest hooks all fire. */
      killAll(kind?: string): number {
        let count = 0;
        for (const enemy of [...internals.enemies]) {
          if (enemy.dead) continue;
          if (kind && enemy.kind !== kind) continue;
          const heading = new Vector3(enemy.dir.y, enemy.dir.z, enemy.dir.x)
            .cross(enemy.dir)
            .normalize();
          enemy.hurt(999999, heading, 0, internals.ctx);
          count++;
        }
        return count;
      },
    },
  });
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
