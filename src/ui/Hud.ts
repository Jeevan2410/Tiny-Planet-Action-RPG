import { clear, el, setBar, show } from './dom';
import { derivedStats, getState, xpProgress } from '../state/gameState';
import { ITEMS, SPECIALS, type ItemId } from '../rpg/Items';
import { MAX_LEVEL } from '../rpg/Stats';
import { objectiveGoal, objectiveText, QUESTS, QUEST_LIST, type QuestId } from '../rpg/Quests';
import { SHRINE_BIOMES } from '../rpg/Types';
import type { BiomeDef } from '../world/Biomes';

export interface CompassMark {
  label: string;
  /** Bearing in radians relative to the camera's forward, -PI..PI. */
  bearing: number;
  colour: string;
  dim?: boolean;
}

export interface HudFrame {
  biome: BiomeDef;
  prompt: { label: string; key: string } | null;
  boss: { name: string; ratio: number } | null;
  specialCooldown: number;
  marks: CompassMark[];
  touch: boolean;
  /** Inside the village, where nothing can follow. */
  safe: boolean;
}

const QUICK_ITEM: ItemId = 'salve';

/**
 * The always-on overlay: vitals, objective tracker, compass, prompts and toasts.
 *
 * On a sphere you can only see ten metres of ground ahead of you, so the compass
 * ribbon is not decoration — it is the map. It marks the village and all four
 * shrines by bearing, dimming the ones already cured.
 */
export class Hud {
  readonly root: HTMLElement;

  private hpFill: HTMLElement;
  private hpGhost: HTMLElement;
  private hpLabel: HTMLElement;
  private hpValue: HTMLElement;
  private hpBar: HTMLElement;
  private staminaFill: HTMLElement;
  private staminaBar: HTMLElement;
  private xpFill: HTMLElement;
  private xpLabel: HTMLElement;
  private levelBadge: HTMLElement;
  private glimmer: HTMLElement;
  private buffNote: HTMLElement;

  private trackerTitle: HTMLElement;
  private trackerList: HTMLElement;
  private trackerReady: HTMLElement;
  private shrinePips: HTMLElement[] = [];

  private compass: HTMLElement;
  private compassMarks: HTMLElement[] = [];

  private banner: HTMLElement;
  private bannerName: HTMLElement;
  private bannerLine: HTMLElement;
  private bannerLevel: HTMLElement;
  private bannerTimer = 0;
  private lastBiome = '';

  private toasts: HTMLElement;
  private levelup: HTMLElement;
  private levelupText: HTMLElement;

  private bossBar: HTMLElement;
  private bossName: HTMLElement;
  private bossFill: HTMLElement;

  private prompt: HTMLElement;
  private promptKey: HTMLElement;
  private promptLabel: HTMLElement;

  private potionSlot: HTMLElement;
  private potionCount: HTMLElement;
  private specialSlot: HTMLElement;
  private specialIcon: HTMLElement;
  private specialCool: HTMLElement;
  private specialName: HTMLElement;

  private sanctuary: HTMLElement;
  private hurtFlash: HTMLElement;
  private lowHealth: HTMLElement;
  private hints: HTMLElement;

  private ghostHp = 1;
  private ghostTimer = 0;

  constructor() {
    this.hpFill = el('div', { class: 'fill' });
    this.hpGhost = el('div', { class: 'ghost' });
    this.hpValue = el('span', { text: '' });
    this.hpLabel = el('div', { class: 'label' }, el('span', { text: 'HP' }), this.hpValue);
    this.hpBar = el('div', { class: 'bar hp' }, this.hpGhost, this.hpFill, this.hpLabel);

    this.staminaFill = el('div', { class: 'fill' });
    this.staminaBar = el('div', { class: 'bar stamina' }, this.staminaFill);

    this.xpFill = el('div', { class: 'fill' });
    this.xpLabel = el('div', { class: 'label' });
    const xpBar = el('div', { class: 'bar xp' }, this.xpFill);

    this.levelBadge = el('div', { class: 'level-badge' }, el('small', { text: 'LV' }), el('b', { text: '1' }));
    this.glimmer = el('b', { text: '0' });
    this.buffNote = el('span', { class: 'buff' });
    const coin = el(
      'div',
      { class: 'coin' },
      el('span', {}, this.xpLabel),
      this.buffNote,
      el('span', {}, '✦ ', this.glimmer),
    );

    const vitals = el('div', { class: 'vitals ui-panel' }, this.levelBadge, this.hpBar, this.staminaBar, xpBar, coin);

    this.trackerTitle = el('div', { class: 'quest-title' });
    this.trackerList = el('ul');
    this.trackerReady = el('div', { class: 'ready' });
    const shrineRow = el('div', { class: 'shrines' }, el('span', { text: 'Shrines' }));
    for (let i = 0; i < SHRINE_BIOMES.length; i++) {
      const pip = el('i', { class: 'shrine-pip' });
      this.shrinePips.push(pip);
      shrineRow.append(pip);
    }
    const tracker = el(
      'div',
      { class: 'tracker ui-panel' },
      el('h3', { text: 'Objective' }),
      this.trackerTitle,
      this.trackerList,
      this.trackerReady,
      shrineRow,
    );

    this.compass = el('div', { class: 'compass' }, el('div', { class: 'needle' }));

    this.bannerName = el('h2');
    this.bannerLine = el('p');
    this.bannerLevel = el('div', { class: 'level-hint' });
    this.banner = el('div', { class: 'biome-banner' }, this.bannerName, this.bannerLine, this.bannerLevel);

    this.toasts = el('div', { class: 'toasts' });
    this.levelupText = el('p');
    this.levelup = el('div', { class: 'levelup' }, el('h2', { text: 'LEVEL UP' }), this.levelupText);

    this.bossName = el('div', { class: 'name' });
    this.bossFill = el('div', { class: 'fill' });
    this.bossBar = el('div', { class: 'boss-bar' }, this.bossName, el('div', { class: 'bar' }, this.bossFill));

    this.promptKey = el('span', { class: 'keycap', text: 'E' });
    this.promptLabel = el('span', { text: 'Talk' });
    this.prompt = el('div', { class: 'prompt ui-panel' }, this.promptKey, this.promptLabel);

    this.potionCount = el('span', { class: 'count', text: '0' });
    this.potionSlot = el(
      'div',
      { class: 'slot ui-panel' },
      el('span', { class: 'key', text: 'Q' }),
      el('span', { text: ITEMS[QUICK_ITEM].icon }),
      this.potionCount,
    );
    this.specialIcon = el('span', { text: '✷' });
    this.specialCool = el('div', { class: 'cool' });
    this.specialName = el('span', { class: 'sub' });
    this.specialSlot = el(
      'div',
      { class: 'slot ui-panel' },
      el('span', { class: 'key', text: 'K' }),
      this.specialIcon,
      this.specialName,
      this.specialCool,
    );
    const quickbar = el('div', { class: 'quickbar' }, this.potionSlot, this.specialSlot);

    this.hints = el('div', { class: 'hints' });
    this.setHints([
      ['WASD', 'move'],
      ['Shift', 'sprint'],
      ['J / LMB', 'attack'],
      ['K / RMB', 'special'],
      ['Space', 'dodge'],
      ['E', 'interact'],
      ['Q', 'salve'],
      ['I', 'bag'],
      ['L', 'journal'],
      ['Esc', 'menu'],
    ]);

    this.sanctuary = el(
      'div',
      { class: 'sanctuary ui-panel' },
      el('span', { class: 'ward', text: '✦' }),
      el('span', {}, el('b', { text: 'Sanctuary' }), ' · nothing follows you past the fence'),
    );

    this.hurtFlash = el('div', { class: 'hurt-flash' });
    this.lowHealth = el('div', { class: 'low-health' });
    this.lowHealth.style.display = 'none';

    this.root = el(
      'div',
      { class: 'hud' },
      el('div', { class: 'vignette' }),
      this.lowHealth,
      this.hurtFlash,
      vitals,
      this.sanctuary,
      tracker,
      this.compass,
      this.banner,
      this.toasts,
      this.levelup,
      this.bossBar,
      this.prompt,
      quickbar,
      this.hints,
    );
  }

  private setHints(pairs: Array<[string, string]>): void {
    clear(this.hints);
    for (const [k, label] of pairs) {
      this.hints.append(el('span', {}, el('b', { text: k }), ' ', label));
    }
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  flashHurt(): void {
    this.hurtFlash.classList.add('show');
    window.setTimeout(() => this.hurtFlash.classList.remove('show'), 90);
  }

  toast(text: string, tone: 'info' | 'good' | 'bad' | 'epic' = 'info'): void {
    const node = el('div', { class: `toast ${tone}`, text });
    this.toasts.append(node);
    window.setTimeout(() => {
      node.classList.add('out');
      window.setTimeout(() => node.remove(), 380);
    }, tone === 'epic' ? 3400 : 2400);
    // Never let a burst of pickups fill the screen.
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
  }

  showLevelUp(level: number): void {
    const stats = derivedStats();
    this.levelupText.textContent =
      level >= MAX_LEVEL
        ? `Level ${level} — the highest the road goes.`
        : `Level ${level} · ${stats.maxHp} HP · ${stats.attack} ATK · ${stats.defense} DEF`;
    this.levelup.classList.remove('show');
    // Restart the CSS animation.
    void this.levelup.offsetWidth;
    this.levelup.classList.add('show');
  }

  /** Announce a biome when the player crosses into it. */
  announceBiome(biome: BiomeDef): void {
    if (this.lastBiome === biome.id) return;
    this.lastBiome = biome.id;
    this.bannerName.textContent = biome.name;
    this.bannerLine.textContent = biome.tagline;
    // The meadow is not safe — its motes are the first quest. Only the village
    // inside the fence is, and the sanctuary badge says so when you are in it.
    this.bannerLevel.textContent =
      biome.id === 'meadow'
        ? 'Suggested level 1+ · the village is sanctuary'
        : `Suggested level ${biome.recommendedLevel}+`;
    this.banner.classList.add('show');
    this.bannerTimer = 3.4;
  }

  update(dt: number, frame: HudFrame): void {
    const state = getState();
    const stats = derivedStats(state);

    const hpRatio = stats.maxHp > 0 ? state.hp / stats.maxHp : 0;
    setBar(this.hpFill, hpRatio);
    const hpText = `${Math.ceil(state.hp)} / ${stats.maxHp}`;
    if (this.hpValue.textContent !== hpText) this.hpValue.textContent = hpText;
    this.hpBar.classList.toggle('low', hpRatio < 0.3);

    // A pale "ghost" bar drains behind the real one so damage reads at a glance.
    if (hpRatio < this.ghostHp) {
      this.ghostTimer = 0.45;
    } else {
      this.ghostHp = hpRatio;
    }
    if (this.ghostTimer > 0) {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) this.ghostHp = hpRatio;
    }
    setBar(this.hpGhost, Math.max(this.ghostHp, hpRatio));

    setBar(this.staminaFill, stats.maxStamina > 0 ? state.stamina / stats.maxStamina : 0);
    this.staminaBar.classList.toggle('spent', state.stamina < stats.maxStamina * 0.25);

    const xp = xpProgress(state);
    setBar(this.xpFill, xp.ratio);
    this.xpLabel.textContent = xp.needed > 0 ? `XP ${xp.current}/${xp.needed}` : 'XP MAX';

    const badgeValue = this.levelBadge.querySelector('b');
    if (badgeValue) badgeValue.textContent = String(state.level);
    this.levelBadge.classList.toggle('max', state.level >= MAX_LEVEL);
    this.glimmer.textContent = String(state.glimmer);
    this.buffNote.textContent = state.buff ? `Ward ${Math.ceil(state.buff.remaining)}s` : '';

    this.lowHealth.style.display = hpRatio < 0.25 && state.hp > 0 && !frame.safe ? '' : 'none';
    show(this.sanctuary, frame.safe);

    this.updateTracker();
    this.updateCompass(frame.marks);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }

    show(this.bossBar, !!frame.boss);
    if (frame.boss) {
      this.bossName.textContent = frame.boss.name;
      setBar(this.bossFill, frame.boss.ratio);
    }

    show(this.prompt, !!frame.prompt);
    if (frame.prompt) {
      this.promptKey.textContent = frame.prompt.key;
      this.promptLabel.textContent = frame.prompt.label;
    }

    const potions = state.inventory[QUICK_ITEM] ?? 0;
    this.potionCount.textContent = String(potions);
    this.potionSlot.classList.toggle('empty', potions <= 0);

    const special = SPECIALS[stats.special];
    this.specialSlot.classList.toggle('empty', stats.special === 'none');
    this.specialName.textContent = stats.special === 'none' ? '' : special.name;
    this.specialIcon.textContent =
      stats.special === 'flameArc' ? '🔥' : stats.special === 'frostNova' ? '❄️' : stats.special === 'quake' ? '⛰️' : '✷';
    this.specialCool.style.transform = `scaleY(${frame.specialCooldown.toFixed(3)})`;

    this.hints.style.display = frame.touch ? 'none' : '';
  }

  private updateTracker(): void {
    const state = getState();
    const active = pickTrackedQuest();
    clear(this.trackerList);
    this.trackerReady.textContent = '';

    if (!active) {
      this.trackerTitle.textContent = state.victory ? 'The world is whole' : 'Speak to Elder Mira';
      this.trackerList.append(
        el('li', {
          text: state.victory ? 'Walk the world. You have earned it.' : 'She is by the hearth in the village.',
        }),
      );
    } else {
      const quest = QUESTS[active];
      const progress = state.quests[active];
      this.trackerTitle.textContent = quest.title;
      quest.objectives.forEach((objective, index) => {
        const counter = progress.counters[index] ?? 0;
        const done = counter >= objectiveGoal(objective);
        this.trackerList.append(el('li', { class: done ? 'done' : '', text: objectiveText(objective, counter) }));
      });
      if (progress.stage === 'readyToTurnIn') {
        this.trackerReady.textContent = `Return to ${questGiverName(active)}`;
      }
    }

    SHRINE_BIOMES.forEach((biome, index) => {
      this.shrinePips[index].classList.toggle('cured', !!state.shrines[biome]);
    });
  }

  private updateCompass(marks: CompassMark[]): void {
    while (this.compassMarks.length < marks.length) {
      const node = el('div', { class: 'compass-mark' }, el('i', { class: 'dot' }), el('span'));
      this.compass.append(node);
      this.compassMarks.push(node);
    }

    // The ribbon spans +/- 100 degrees. Marks nearest the centre of the view win
    // the space; anything that would overlap one already placed is dropped, so
    // labels never pile up into an unreadable smear.
    const span = Math.PI * 0.55;
    const placed: number[] = [];
    const visible = marks
      .map((mark, index) => ({ mark, index }))
      .filter(({ mark }) => Math.abs(mark.bearing) <= span)
      .sort((a, b) => Math.abs(a.mark.bearing) - Math.abs(b.mark.bearing));

    const shown = new Set<number>();
    for (const { mark, index } of visible) {
      const percent = 50 + (mark.bearing / span) * 42;
      if (placed.some((other) => Math.abs(other - percent) < 21)) continue;
      placed.push(percent);
      shown.add(index);
      const node = this.compassMarks[index];
      node.style.display = '';
      node.classList.toggle('cured', !!mark.dim);
      node.style.color = mark.colour;
      node.style.left = `${percent.toFixed(2)}%`;
      const label = node.querySelector('span');
      if (label) label.textContent = mark.label;
    }
    for (let i = 0; i < this.compassMarks.length; i++) {
      if (!shown.has(i)) this.compassMarks[i].style.display = 'none';
    }
  }
}

/** The quest the tracker should show: hand-ins first, then oldest in-progress. */
export function pickTrackedQuest(): QuestId | null {
  const state = getState();
  let inProgress: QuestId | null = null;
  for (const quest of QUEST_LIST) {
    const stage = state.quests[quest.id]?.stage;
    if (stage === 'readyToTurnIn') return quest.id;
    if (stage === 'inProgress' && !inProgress) inProgress = quest.id;
  }
  return inProgress;
}

function questGiverName(id: QuestId): string {
  const giver = QUESTS[id].giver;
  return giver === 'mira' ? 'Elder Mira' : giver === 'tam' ? 'Tam' : giver === 'rook' ? 'Rook' : 'the village';
}
