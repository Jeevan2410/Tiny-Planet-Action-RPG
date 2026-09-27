import { Vector3 } from 'three';
import { Input } from './Input';
import { Loop } from './Loop';
import { Renderer, type Atmosphere, type Quality } from '../render/Renderer';
import { CameraRig } from '../render/CameraRig';
import { Vfx } from '../render/Vfx';
import { World } from '../world/World';
import { BIOMES, biomeAt, type BiomeDef } from '../world/Biomes';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Npc } from '../entities/Npc';
import { Projectile } from '../entities/Drops';
import { audio } from '../audio/Audio';
import { Ui } from '../ui/Ui';
import type { CompassMark } from '../ui/Hud';
import type { Settings } from '../ui/Panels';
import type { DamageTone, GameContext } from './Context';
import {
  clamp,
  headingTo,
  PLANET_RADIUS,
  signedTangentAngle,
  surfaceDistance,
  tangentise,
} from './SphereMath';
import { actions, derivedStats, gameEvents, getState } from '../state/gameState';
import { ITEMS } from '../rpg/Items';
import { QUESTS } from '../rpg/Quests';
import { SHRINE_BIOMES, type BiomeId } from '../rpg/Types';
import type { DialogueContext, DialogueOption } from '../rpg/Dialogue';
import { loadGame, loadSummary, saveGame, deleteSave } from '../save/SaveGame';
import { Shrine } from '../world/Shrine';
import { installDebug } from './Debug';

const AUTOSAVE_SECONDS = 20;
const SETTINGS_KEY = 'tiny-planet-action-rpg:settings';

/**
 * The game shell: owns the renderer, the world, the hero and the UI, and wires
 * them together through a single `GameContext` that entities talk to.
 */
export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private camera: CameraRig;
  private input: Input;
  private loop = new Loop();
  private vfx = new Vfx();
  private ui: Ui;

  private world: World | null = null;
  private player: Player | null = null;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private ctx: GameContext;

  private running = false;
  private hitStopTimer = 0;
  private autosaveTimer = AUTOSAVE_SECONDS;
  private currentBiome: BiomeDef = BIOMES.meadow;
  private talkingTo: Npc | null = null;
  private settings: Settings;
  private disposers: Array<() => void> = [];
  private lastFrameTime = 0;
  private lastRealTime = 0;
  private frames = 0;
  private restoring = false;
  private fps = 0;
  /** 'title' until a run starts; used by the debug snapshot. */
  phase: 'title' | 'playing' = 'title';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.tabIndex = 0;
    this.settings = loadSettings();

    const atmosphere = cloneAtmosphere(BIOMES.meadow.atmosphere);
    this.renderer = new Renderer(canvas, atmosphere);
    this.camera = new CameraRig(this.renderer.camera);
    this.input = new Input(canvas);
    this.renderer.scene.add(this.vfx.group);

    this.ui = new Ui(document.getElementById('ui-root') ?? document.body, this.input, this.settings, {
      onSettings: (settings) => this.applySettings(settings),
      onEquipmentChanged: () => this.player?.syncWeapon(),
    });
    this.ui.dialogue.setBlip(() => audio.play('blip', { pitch: 0.9 + Math.random() * 0.4, gain: 0.5 }));
    this.ui.touch.bindLook(canvas);

    this.ctx = this.buildContext();
    this.bindEvents();
    this.applySettings(this.settings);
    installDebug(this);
  }

  private buildContext(): GameContext {
    const game = this;
    return {
      get input() {
        return game.input;
      },
      get camera() {
        return game.camera;
      },
      get vfx() {
        return game.vfx;
      },
      get audio() {
        return audio;
      },
      get blockers() {
        return game.world?.blockers ?? [];
      },
      get enemies() {
        return game.enemies;
      },
      get npcs() {
        return game.world?.npcs ?? [];
      },
      get player() {
        return game.player as Player;
      },
      get paused() {
        return game.ui.anyOpen;
      },
      get biome() {
        return game.currentBiome.id;
      },
      hitStop: (seconds) => {
        game.hitStopTimer = Math.max(game.hitStopTimer, seconds);
      },
      shake: (amount) => game.camera.shake(amount),
      floatText: (position, text, tone: DamageTone) => game.ui.floating.spawn(position, text, tone),
      notice: (text, tone) => game.ui.hud.toast(text, tone),
      spawnProjectile: (origin, dir, heading, damage, speed = 15) => {
        const height = Math.max(0.4, origin.length() - PLANET_RADIUS - 0.2);
        const projectile = new Projectile(dir, heading, damage, speed, Math.min(height, 2.2));
        game.projectiles.push(projectile);
        game.renderer.scene.add(projectile.mesh);
      },
      interact: () => game.tryInteract(),
      interactTarget: () => game.findInteractTarget(),
    };
  }

  /* --------------------------------------------------------------- boot */

  async boot(): Promise<void> {
    // Build the world up front so "Continue" is instant.
    this.createWorld();
    this.ui.hideLoading();
    const summary = await loadSummary();
    this.ui.hud.setVisible(false);
    this.ui.title.show(summary, {
      onContinue: () => void this.startRun(true),
      onNew: () => void this.startRun(false),
      onDelete: async () => {
        await deleteSave();
        this.ui.title.show(null, {
          onContinue: () => void this.startRun(true),
          onNew: () => void this.startRun(false),
          onDelete: () => {},
        });
      },
    });
    this.start();
  }

  private createWorld(): void {
    const world = new World(this.renderer.palette, {
      seed: 0x7a1e5,
      densityScale: this.settings.quality === 'high' ? 1 : 0.55,
      detail: this.settings.quality === 'high' ? 5 : 4,
    });
    world.addToScene(this.renderer.scene);
    this.world = world;

    const forward = tangentise(new Vector3(0, 0, -1), world.villageDir);
    const player = new Player(world.villageDir, forward, world.villageDir);
    player.attach(this.ctx);
    this.renderer.scene.add(player.group);
    this.player = player;
    this.camera.reset(player.dir, player.forward);
  }

  private async startRun(continueSave: boolean): Promise<void> {
    this.restoring = true;
    if (continueSave) {
      await loadGame();
    } else {
      actions.reset();
    }

    const world = this.world!;
    const player = this.player!;
    const state = getState();

    // Restore shrine/warden state before anything spawns.
    for (const biome of SHRINE_BIOMES) {
      const cured = !!state.shrines[biome];
      world.shrine(biome)?.setCuredInstant(cured);
      world.planet.setHealed(biome, cured ? 1 : 0);
      if (cured) world.markWardenDefeated(biome);
    }

    // A fresh run always begins in the village square; a loaded one resumes
    // wherever the hero was standing.
    const dir = continueSave
      ? new Vector3(state.position[0], state.position[1], state.position[2])
      : world.villageDir.clone();
    if (dir.lengthSq() < 0.5) dir.copy(world.villageDir);
    player.dir.copy(dir).normalize();
    const facing = continueSave
      ? new Vector3(state.facing[0], state.facing[1], state.facing[2])
      : new Vector3(0, 0, -1);
    tangentise(facing, player.dir, player.forward);
    player.dead = false;
    player.setLocked(false);
    player.syncWeapon();
    player.syncTransform();

    const stats = derivedStats();
    actions.setVitals(continueSave ? state.hp : stats.maxHp, continueSave ? state.stamina : stats.maxStamina);

    this.enemies.length = 0;
    world.populate(this.ctx);

    this.camera.reset(player.dir, player.forward);
    this.currentBiome = biomeAt(player.dir);
    this.phase = 'playing';
    this.ui.title.hide();
    this.ui.victory.hide();
    this.ui.hud.setVisible(true);
    this.ui.hud.announceBiome(this.currentBiome);
    this.autosaveTimer = AUTOSAVE_SECONDS;
    this.restoring = false;

    void audio.unlock();
    audio.setBiome(this.currentBiome.id, !!getState().shrines[this.currentBiome.id]);

    if (!continueSave) {
      this.ui.hud.toast('Find Elder Mira by the hearth.', 'info');
    }
    this.focusCanvas();
  }

  private focusCanvas(): void {
    this.canvas.focus?.();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.lastRealTime = this.lastFrameTime;
    this.loop.resync(this.lastFrameTime);
    requestAnimationFrame(this.frame);
  }

  /* ------------------------------------------------------------- events */

  private bindEvents(): void {
    const onResize = () => this.renderer.resize();
    window.addEventListener('resize', onResize);
    this.disposers.push(() => window.removeEventListener('resize', onResize));

    const onKey = (event: KeyboardEvent) => this.onKeyDown(event);
    window.addEventListener('keydown', onKey);
    this.disposers.push(() => window.removeEventListener('keydown', onKey));

    const onPointerDown = () => {
      void audio.unlock();
      if (!this.ui.anyOpen) this.input.requestPointerLock();
    };
    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.disposers.push(() => this.canvas.removeEventListener('pointerdown', onPointerDown));

    const onHide = () => {
      if (this.world && this.player && !this.ui.title.isOpen) void this.save();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
      else this.loop.resync(performance.now());
    });
    this.disposers.push(() => window.removeEventListener('pagehide', onHide));

    gameEvents.on('levelUp', ({ level }) => {
      this.ui.hud.showLevelUp(level);
      audio.play('levelUp');
      const player = this.player;
      if (player) {
        this.vfx.shockSphere(player.chestPoint(new Vector3()), 6, 0xffe6a8, 0.8);
        this.vfx.burst(player.chestPoint(new Vector3()), { count: 26, color: 0xffe6a8, speed: 7, life: 0.9, size: 1.3 });
      }
      void this.save();
    });
    gameEvents.on('questStarted', ({ id }) => {
      this.ui.hud.toast(`New quest — ${QUESTS[id].title}`, 'good');
      audio.play('questStart');
      void this.save();
    });
    gameEvents.on('questReady', ({ id }) => {
      this.ui.hud.toast(`${QUESTS[id].title}: ready to hand in`, 'good');
      audio.play('questStart', { pitch: 1.2 });
    });
    gameEvents.on('questCompleted', ({ id }) => {
      this.ui.hud.toast(`Quest complete — ${QUESTS[id].title}`, 'epic');
      audio.play('questDone');
      void this.save();
    });
    gameEvents.on('itemGained', ({ id, count }) => {
      const item = ITEMS[id];
      this.ui.hud.toast(`${item.icon} ${item.name}${count > 1 ? ` ×${count}` : ''}`, 'info');
    });
    gameEvents.on('shrineCured', () => void this.save());
    gameEvents.on('victory', () => {
      audio.play('victory');
      window.setTimeout(() => {
        this.ui.victory.show(() => {
          this.ui.victory.hide();
          this.focusCanvas();
        });
      }, 3200);
      void this.save();
    });
    gameEvents.on('notice', ({ text, tone }) => this.ui.hud.toast(text, tone));
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.ui.title.isOpen) return;

    // Dialogue owns the keyboard while it is up.
    if (this.ui.dialogue.isOpen) {
      if (event.code === 'Escape') {
        event.preventDefault();
        this.closeDialogue();
        return;
      }
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'KeyE') {
        event.preventDefault();
        this.ui.dialogue.advance();
        return;
      }
      if (event.code === 'ArrowUp' || event.code === 'KeyW') {
        event.preventDefault();
        this.ui.dialogue.moveSelection(-1);
        return;
      }
      if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        event.preventDefault();
        this.ui.dialogue.moveSelection(1);
        return;
      }
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit) {
        event.preventDefault();
        this.ui.dialogue.choose(Number(digit[1]) - 1);
      }
      return;
    }

    if (event.code === 'Escape') {
      event.preventDefault();
      if (this.ui.victory.isOpen) return;
      if (!this.ui.closeTopmost()) this.openPause();
      else this.afterModalClose();
      return;
    }

    if (this.ui.modalOpen) return;

    switch (event.code) {
      case 'KeyI':
      case 'Tab':
        event.preventDefault();
        this.openInventory();
        break;
      case 'KeyL':
        event.preventDefault();
        this.openJournal();
        break;
      case 'KeyQ':
        event.preventDefault();
        this.quickHeal();
        break;
      case 'KeyE':
        event.preventDefault();
        this.tryInteract();
        break;
      default:
        break;
    }
  }

  private quickHeal(): void {
    const state = getState();
    const stats = derivedStats(state);
    if (state.hp >= stats.maxHp) {
      this.ui.hud.toast('Already in one piece.', 'info');
      return;
    }
    if (!actions.useConsumable('salve')) {
      this.ui.hud.toast('No salves left.', 'bad');
      audio.play('hitBlocked', { pitch: 0.6, gain: 0.4 });
      return;
    }
    audio.play('potion');
    const player = this.player;
    if (player) {
      this.vfx.burst(player.chestPoint(new Vector3()), { count: 14, color: 0x86e09a, speed: 3.6, life: 0.7, size: 0.9 });
      this.ui.floating.spawn(player.chestPoint(new Vector3()), `+${ITEMS.salve.healFlat}`, 'heal');
    }
  }

  private openInventory(): void {
    this.ui.inventory.open();
    this.beforeModalOpen();
    this.ui.inventory.onClose(() => this.afterModalClose());
  }

  private openJournal(): void {
    this.ui.journal.open();
    this.beforeModalOpen();
    this.ui.journal.onClose(() => this.afterModalClose());
  }

  private openShop(): void {
    this.ui.shop.open();
    this.beforeModalOpen();
    this.ui.shop.onClose(() => this.afterModalClose());
  }

  private openPause(): void {
    this.ui.pause.setActions([
      {
        label: 'Resume',
        onClick: () => {
          this.ui.pause.close();
          this.afterModalClose();
        },
      },
      {
        label: 'Save now',
        ghost: true,
        onClick: () => {
          void this.save().then(() => this.ui.hud.toast('Progress saved.', 'good'));
        },
      },
      {
        label: 'Save and quit to title',
        ghost: true,
        onClick: () => {
          void this.save().then(() => {
            this.ui.pause.close();
            void this.returnToTitle();
          });
        },
      },
    ]);
    this.ui.pause.open();
    this.beforeModalOpen();
    this.ui.pause.onClose(() => this.afterModalClose());
  }

  private async returnToTitle(): Promise<void> {
    this.phase = 'title';
    this.ui.hud.setVisible(false);
    const summary = await loadSummary();
    this.ui.title.show(summary, {
      onContinue: () => void this.startRun(true),
      onNew: () => void this.startRun(false),
      onDelete: async () => {
        await deleteSave();
        void this.returnToTitle();
      },
    });
  }

  private beforeModalOpen(): void {
    this.input.setCaptured(true);
    this.input.releasePointerLock();
    this.player?.setLocked(true);
    audio.play('uiClick');
  }

  private afterModalClose(): void {
    if (this.ui.anyOpen) return;
    this.input.setCaptured(false);
    this.input.flush();
    this.player?.setLocked(false);
    this.focusCanvas();
  }

  /* ---------------------------------------------------------- interact */

  private findInteractTarget(): { label: string; key: string } | null {
    const world = this.world;
    const player = this.player;
    if (!world || !player || player.dead) return null;

    let best: { score: number; label: string } | null = null;
    for (const npc of world.npcs) {
      const score = npc.interactScore(player.dir, player.forward);
      if (score === null) continue;
      if (!best || score < best.score) best = { score, label: `Talk to ${npc.def.name}` };
    }
    for (const biome of SHRINE_BIOMES) {
      const shrine = world.shrine(biome);
      if (!shrine) continue;
      const score = shrine.interactScore(player.dir, player.forward);
      if (score === null) continue;
      const label = shrine.cured
        ? 'Touch the shrine'
        : world.wardenAlive(biome)
          ? 'The warden still holds it'
          : 'Cleanse the shrine';
      if (!best || score < best.score) best = { score, label };
    }
    if (!best) return null;
    return { label: best.label, key: 'E' };
  }

  private tryInteract(): boolean {
    const world = this.world;
    const player = this.player;
    if (!world || !player || player.dead || this.ui.anyOpen) return false;

    let bestNpc: { npc: Npc; score: number } | null = null;
    for (const npc of world.npcs) {
      const score = npc.interactScore(player.dir, player.forward);
      if (score === null) continue;
      if (!bestNpc || score < bestNpc.score) bestNpc = { npc, score };
    }

    let bestShrine: { shrine: Shrine; biome: BiomeId; score: number } | null = null;
    for (const biome of SHRINE_BIOMES) {
      const shrine = world.shrine(biome);
      if (!shrine) continue;
      const score = shrine.interactScore(player.dir, player.forward);
      if (score === null) continue;
      if (!bestShrine || score < bestShrine.score) bestShrine = { shrine, biome, score };
    }

    if (bestNpc && (!bestShrine || bestNpc.score <= bestShrine.score)) {
      this.openDialogue(bestNpc.npc);
      return true;
    }
    if (bestShrine) {
      this.useShrine(bestShrine.shrine, bestShrine.biome);
      return true;
    }
    return false;
  }

  private useShrine(shrine: Shrine, biome: BiomeId): void {
    const world = this.world!;
    if (shrine.cured) {
      this.ui.hud.toast('The stone is warm. It hums under your hand.', 'info');
      audio.play('uiMove', { pitch: 1.4 });
      return;
    }
    if (world.wardenAlive(biome)) {
      this.ui.hud.toast('The warden still holds this shrine. Break it first.', 'bad');
      audio.play('hitBlocked', { pitch: 0.7 });
      return;
    }
    if (!shrine.beginCure()) return;
    audio.play('shrineCure');
    this.camera.shake(0.5);
    actions.cureShrine(biome);
    audio.setBiome(this.currentBiome.id, true);
    this.ui.hud.toast(`${BIOMES[biome].name} shrine cured`, 'epic');

    // Curing hands you the biome's keepsake.
    const keepsake = {
      greenwood: 'emberSeed',
      dunes: 'sunGlass',
      tundra: 'frostCore',
      cinder: 'cinderHeart',
    } as const;
    const item = keepsake[biome as keyof typeof keepsake];
    if (item) actions.addItem(item, 1);
  }

  /* ---------------------------------------------------------- dialogue */

  private dialogueContext(): DialogueContext {
    const state = getState();
    return {
      questStage: (id) => state.quests[id]?.stage ?? 'notStarted',
      hasItem: (id, count = 1) => (state.inventory[id] ?? 0) >= count,
      itemCount: (id) => state.inventory[id] ?? 0,
      level: state.level,
      shrinesCured: SHRINE_BIOMES.filter((biome) => state.shrines[biome]).length,
      shrineCured: (biome) => !!state.shrines[biome],
      flag: (name) => !!state.flags[name],
      victory: state.victory,
    };
  }

  private openDialogue(npc: Npc): void {
    this.talkingTo = npc;
    npc.setTalking(true);
    this.input.setCaptured(true);
    this.input.releasePointerLock();
    this.player?.setLocked(true);
    this.showDialogueNode(npc, npc.def.entry(this.dialogueContext()));
  }

  private showDialogueNode(npc: Npc, nodeId: string): void {
    const node = npc.def.nodes[nodeId];
    if (!node) {
      this.closeDialogue();
      return;
    }
    const ctx = this.dialogueContext();
    const options = (node.options ?? []).filter((option) => !option.when || option.when(ctx));
    this.ui.dialogue.open(
      { speaker: node.speaker ?? npc.def.name, role: npc.def.role, node, options },
      (option) => this.onDialogueOption(npc, option),
      () => this.closeDialogue(),
    );
  }

  private onDialogueOption(npc: Npc, option: DialogueOption): void {
    audio.play('uiClick');
    let keepOpen = !!option.next;

    if (option.action) {
      switch (option.action.kind) {
        case 'startQuest':
          actions.startQuest(option.action.quest);
          break;
        case 'turnIn':
          actions.turnInQuest(option.action.quest);
          break;
        case 'shop':
          this.closeDialogue();
          this.openShop();
          return;
        case 'flag':
          actions.setFlag(option.action.name);
          break;
        case 'rest':
          this.rest();
          break;
        case 'close':
          keepOpen = false;
          break;
      }
    }

    if (option.next) {
      this.showDialogueNode(npc, option.next);
      return;
    }
    if (!keepOpen) this.closeDialogue();
  }

  private rest(): void {
    const stats = derivedStats();
    actions.setVitals(stats.maxHp, stats.maxStamina);
    audio.play('potion', { pitch: 0.85 });
    this.ui.hud.toast('You rest by the fire. Fully restored.', 'good');
    const player = this.player;
    if (player) {
      this.vfx.burst(player.chestPoint(new Vector3()), { count: 20, color: 0xffd76b, speed: 3.2, life: 1.1, size: 1 });
    }
    void this.save();
  }

  private closeDialogue(): void {
    this.ui.dialogue.close();
    this.talkingTo?.setTalking(false);
    this.talkingTo = null;
    this.afterModalClose();
  }

  /* ------------------------------------------------------------ settings */

  private applySettings(settings: Settings): void {
    this.settings = settings;
    audio.setVolume(settings.volume);
    audio.setMuted(!settings.sound);
    audio.setMusicEnabled(settings.music);
    this.renderer.setQuality(settings.quality as Quality);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage may be unavailable */
    }
  }

  private async save(): Promise<void> {
    const player = this.player;
    if (!player || this.restoring) return;
    actions.setPosition(
      [player.dir.x, player.dir.y, player.dir.z],
      [player.forward.x, player.forward.y, player.forward.z],
    );
    try {
      await saveGame();
    } catch {
      /* A failed autosave should never interrupt play. */
    }
  }

  /* ---------------------------------------------------------------- loop */

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const timing = this.loop.begin(now);
    const rawDt = timing.rawDt;
    this.lastFrameTime = now;
    // Measure true frame time: `rawDt` is clamped, so it would flatter a slideshow.
    this.frames++;
    const realDt = (now - this.lastRealTime) / 1000;
    this.lastRealTime = now;
    if (realDt > 0.0005) this.fps += (1 / realDt - this.fps) * 0.1;

    const frozen = this.ui.anyOpen || this.ui.title.isOpen;
    // Hit-stop crawls rather than fully freezing: a whiff of motion reads better.
    let dt = frozen ? 0 : timing.dt;
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - rawDt);
      dt *= 0.05;
    }

    this.input.sample();
    const player = this.player;
    const world = this.world;

    if (player && world) {
      if (!frozen) {
        actions.tickTime(dt);
        player.update(dt, rawDt);
        for (const enemy of this.enemies) {
          const enemyDt = enemy.prepareUpdate(dt, player.dir);
          if (enemyDt > 0) enemy.update(enemyDt, Math.min(rawDt, enemyDt), player.dir);
        }
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
          if (!this.projectiles[i].update(dt, this.ctx)) {
            this.renderer.scene.remove(this.projectiles[i].mesh);
            this.projectiles.splice(i, 1);
          }
        }
        world.update(dt, this.ctx, player.dir);
        this.updateBiome(dt);

        this.autosaveTimer -= dt;
        if (this.autosaveTimer <= 0) {
          this.autosaveTimer = AUTOSAVE_SECONDS;
          void this.save();
        }
      } else {
        // Keep shrines and NPCs breathing behind an open panel.
        world.update(0, this.ctx, player.dir);
      }

      const look = this.input.takeLook();
      if (!this.ui.anyOpen) this.camera.orbit(look.dx, look.dy);
      // Slowly drift around the village behind the title screen.
      if (this.ui.title.isOpen) this.camera.orbit(-rawDt * 22, 0);
      this.camera.zoom(this.input.takeZoom());
      this.camera.update(rawDt, player.dir, 1.35, world.blockers);
      this.renderer.updateLighting(player.position, player.dir, this.camera.rightTangent, rawDt);
    }

    this.vfx.update(rawDt);
    if (world && player) {
      this.world?.sky.update(rawDt, this.renderer.camera.position, player.dir, this.renderer.palette);
    }
    this.renderer.render();

    this.updateUi(rawDt);
  };

  private updateBiome(dt: number): void {
    const player = this.player;
    const world = this.world;
    if (!player || !world) return;
    const biome = biomeAt(player.dir);
    if (biome.id !== this.currentBiome.id) {
      this.currentBiome = biome;
      this.ui.hud.announceBiome(biome);
      audio.setBiome(biome.id, !!getState().shrines[biome.id]);
      // Crossing a border is a natural save point.
      void this.save();
    }
    this.renderer.applyAtmosphere(biome.atmosphere, dt);
    audio.setIntensity(world.combatIntensity(this.ctx, player.dir));
  }

  private updateUi(rawDt: number): void {
    const player = this.player;
    if (!player) return;
    const stats = derivedStats();
    const special = stats.special;

    // Only raise the boss bar for a warden that has actually noticed you — a
    // sleeping one three biomes away should not be announced.
    let boss: { name: string; ratio: number } | null = null;
    for (const enemy of this.enemies) {
      if (!enemy.isBoss || enemy.dead) continue;
      if (enemy.state === 'idle' || enemy.state === 'patrol' || enemy.state === 'return') continue;
      if (surfaceDistance(enemy.dir, player.dir) > 26) continue;
      boss = { name: `${BIOMES[enemy.biome].name} Warden`, ratio: enemy.healthRatio };
      break;
    }

    this.ui.update(
      rawDt,
      {
        biome: this.currentBiome,
        prompt: this.ui.anyOpen ? null : this.findInteractTarget(),
        boss,
        specialCooldown: special === 'none' ? 0 : this.specialCooldownRatio(),
        marks: this.compassMarks(),
        touch: this.ui.usingTouch,
      },
      this.renderer.camera,
      this.canvas.clientWidth || window.innerWidth,
      this.canvas.clientHeight || window.innerHeight,
    );
  }

  private specialCooldownRatio(): number {
    // The player owns the timer; expose it through a tiny accessor rather than
    // duplicating the countdown here.
    return this.player ? this.player.specialCooldownRatio : 0;
  }

  private compassMarks(): CompassMark[] {
    const player = this.player;
    const world = this.world;
    if (!player || !world) return [];
    const marks: CompassMark[] = [];
    const camForward = tangentise(_v1.copy(this.camera.forwardTangent), player.dir, _v1);

    const add = (target: Vector3, label: string, colour: string, dim = false) => {
      const distance = surfaceDistance(player.dir, target);
      if (distance < 6) return;
      const heading = headingTo(player.dir, target, _v2);
      const bearing = -signedTangentAngle(player.dir, camForward, heading);
      marks.push({ label: `${label} ${Math.round(distance)}m`, bearing, colour, dim });
    };

    add(world.villageDir, 'Village', '#ffd76b');
    const state = getState();
    const colours: Record<string, string> = {
      greenwood: '#e8a83c',
      dunes: '#f0d79a',
      tundra: '#bfe4ff',
      cinder: '#c98aff',
    };
    for (const biome of SHRINE_BIOMES) {
      add(BIOMES[biome].centre, BIOMES[biome].name, colours[biome] ?? '#ffffff', !!state.shrines[biome]);
    }
    return marks;
  }

  dispose(): void {
    this.running = false;
    for (const dispose of this.disposers) dispose();
    this.input.dispose();
    this.renderer.dispose();
  }
}

function cloneAtmosphere(atmosphere: Atmosphere): Atmosphere {
  return {
    sky: atmosphere.sky.clone(),
    horizon: atmosphere.horizon.clone(),
    ground: atmosphere.ground.clone(),
    fog: atmosphere.fog.clone(),
    sun: atmosphere.sun.clone(),
    sunIntensity: atmosphere.sunIntensity,
    ambient: atmosphere.ambient,
  };
}

function loadSettings(): Settings {
  const fallback: Settings = { volume: 0.7, music: true, sound: true, quality: 'high' };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      volume: clamp(typeof parsed.volume === 'number' ? parsed.volume : fallback.volume, 0, 1),
      music: parsed.music ?? fallback.music,
      sound: parsed.sound ?? fallback.sound,
      quality: parsed.quality === 'low' ? 'low' : 'high',
    };
  } catch {
    return fallback;
  }
}

const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();
