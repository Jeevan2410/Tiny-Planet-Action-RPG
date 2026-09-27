import { clear, el } from './dom';
import { actions, derivedStats, getState } from '../state/gameState';
import { ITEMS, SHOP_STOCK, SPECIALS, isEquippable, type ItemDef, type ItemId } from '../rpg/Items';
import { MAX_LEVEL, xpToNext } from '../rpg/Stats';
import { objectiveGoal, objectiveText, QUEST_LIST } from '../rpg/Quests';
import type { EquipSlot } from '../rpg/Types';
import { formatPlaytime, type SaveSummary } from '../save/SaveGame';

/** Shared modal chrome: a dimmed backdrop and a titled sheet. */
export class Modal {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  protected header: HTMLElement;
  private titleNode: HTMLElement;
  private onCloseHandler: (() => void) | null = null;

  constructor(title: string, subtitle = '') {
    this.titleNode = el('h2', { text: title });
    this.body = el('div');
    const close = el('button', { class: 'close', type: 'button', text: 'Close  (Esc)' });
    close.addEventListener('click', () => this.close());
    this.header = el(
      'header',
      {},
      this.titleNode,
      el('span', { class: 'section-title', text: subtitle }),
      el('span', { class: 'spacer' }),
      close,
    );
    const sheet = el('div', { class: 'sheet ui-panel' }, this.header, this.body);
    this.root = el('div', { class: 'modal' }, sheet);
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('show');
  }

  setTitle(title: string): void {
    this.titleNode.textContent = title;
  }

  onClose(handler: () => void): void {
    this.onCloseHandler = handler;
  }

  open(): void {
    this.root.classList.add('show');
  }

  close(): void {
    this.root.classList.remove('show');
    this.onCloseHandler?.();
  }
}

function itemRow(
  item: ItemDef,
  options: { count?: number; meta?: string; equipped?: boolean; disabled?: boolean },
  onClick: () => void,
): HTMLElement {
  const row = el(
    'button',
    {
      class: `item-row${options.equipped ? ' equipped' : ''}${options.disabled ? ' disabled' : ''}`,
      type: 'button',
    },
    el('span', { class: 'icon', text: item.icon }),
    el(
      'span',
      {},
      el('div', { class: 'name', text: options.count && options.count > 1 ? `${item.name} ×${options.count}` : item.name }),
      el('div', { class: 'desc', text: item.description }),
    ),
    el('span', { class: 'meta', text: options.meta ?? '' }),
  );
  if (!options.disabled) row.addEventListener('click', onClick);
  return row;
}

/** Bag + equipment + the stat sheet that equipment feeds. */
export class InventoryPanel extends Modal {
  private slotsNode: HTMLElement;
  private statsNode: HTMLElement;
  private listNode: HTMLElement;
  private onChange: () => void;

  constructor(onChange: () => void) {
    super('Pack', 'Equipment & items');
    this.onChange = onChange;
    this.slotsNode = el('div', { class: 'equip-slots' });
    this.statsNode = el('div', { class: 'stat-grid' });
    this.listNode = el('div', { class: 'item-list' });
    this.body.append(
      el(
        'div',
        { class: 'cols' },
        el('div', {}, el('h3', { class: 'section-title', text: 'Carried' }), this.listNode),
        el(
          'div',
          {},
          el('h3', { class: 'section-title', text: 'Equipped' }),
          this.slotsNode,
          el('h3', { class: 'section-title', text: 'Standing' }),
          this.statsNode,
        ),
      ),
    );
  }

  override open(): void {
    this.refresh();
    super.open();
  }

  refresh(): void {
    const state = getState();
    const stats = derivedStats(state);

    clear(this.slotsNode);
    for (const slot of ['weapon', 'accessory'] as EquipSlot[]) {
      const id = state.equipped[slot];
      const item = id ? ITEMS[id] : null;
      const unequip = el('button', { type: 'button', text: item ? 'Remove' : '—' });
      if (item) {
        unequip.addEventListener('click', () => {
          actions.equip(null, slot);
          this.refresh();
          this.onChange();
        });
      } else {
        unequip.setAttribute('disabled', '');
      }
      this.slotsNode.append(
        el(
          'div',
          { class: 'equip-slot' },
          el('span', { class: 'icon', text: item?.icon ?? '○' }),
          el(
            'span',
            {},
            el('div', { class: 'kind', text: slot }),
            el('div', { text: item?.name ?? 'Nothing equipped' }),
          ),
          unequip,
        ),
      );
    }

    clear(this.statsNode);
    const special = SPECIALS[stats.special];
    const rows: Array<[string, string]> = [
      ['Level', `${state.level}${state.level >= MAX_LEVEL ? ' (max)' : ''}`],
      ['Next level', state.level >= MAX_LEVEL ? '—' : `${state.xp} / ${xpToNext(state.level)}`],
      ['Health', String(stats.maxHp)],
      ['Stamina', String(stats.maxStamina)],
      ['Attack', String(stats.attack)],
      ['Defence', String(stats.defense)],
      ['Special', stats.special === 'none' ? '—' : special.name],
      ['Glimmer', String(state.glimmer)],
    ];
    for (const [label, value] of rows) {
      this.statsNode.append(el('div', {}, el('span', { text: label }), el('b', { text: value })));
    }
    if (stats.special !== 'none') {
      this.statsNode.append(
        el(
          'div',
          { style: 'grid-column: 1 / -1; background: rgba(255,216,128,0.09)' },
          el('span', { text: special.description }),
        ),
      );
    }

    clear(this.listNode);
    const entries = Object.entries(state.inventory)
      .filter(([, count]) => (count ?? 0) > 0)
      .map(([id]) => ITEMS[id as ItemId])
      .filter(Boolean)
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));

    if (entries.length === 0) {
      this.listNode.append(el('div', { class: 'empty-note', text: 'Your pack is empty.' }));
    }

    for (const item of entries) {
      const count = state.inventory[item.id] ?? 0;
      const equipped = item.slot ? state.equipped[item.slot] === item.id : false;
      const meta = isEquippable(item)
        ? equipped
          ? 'Equipped'
          : 'Equip'
        : item.kind === 'consumable'
          ? 'Use'
          : 'Quest item';
      this.listNode.append(
        itemRow(item, { count, meta, equipped, disabled: item.kind === 'quest' }, () => {
          if (isEquippable(item) && item.slot) {
            actions.equip(equipped ? null : item.id, item.slot);
          } else if (item.kind === 'consumable') {
            actions.useConsumable(item.id);
          }
          this.refresh();
          this.onChange();
        }),
      );
    }
  }
}

function order(item: ItemDef): number {
  return item.kind === 'weapon' ? 0 : item.kind === 'accessory' ? 1 : item.kind === 'consumable' ? 2 : 3;
}

/** The quest journal: every quest, its stage and its objectives. */
export class JournalPanel extends Modal {
  private listNode: HTMLElement;

  constructor() {
    super('Journal', 'Quests & errands');
    this.listNode = el('div');
    this.body.append(this.listNode);
  }

  override open(): void {
    this.refresh();
    super.open();
  }

  refresh(): void {
    const state = getState();
    clear(this.listNode);
    let shown = 0;

    for (const quest of QUEST_LIST) {
      const progress = state.quests[quest.id];
      if (!progress || progress.stage === 'unavailable') continue;
      shown++;
      const stateLabel =
        progress.stage === 'complete'
          ? 'Complete'
          : progress.stage === 'readyToTurnIn'
            ? 'Ready to hand in'
            : progress.stage === 'inProgress'
              ? 'In progress'
              : 'Not started';
      const card = el(
        'div',
        {
          class: `quest-card${progress.stage === 'complete' ? ' done' : progress.stage === 'readyToTurnIn' ? ' ready' : ''}`,
        },
        el('div', { class: 'state', text: stateLabel }),
        el('h4', { text: quest.title }),
        el('p', { text: progress.stage === 'complete' ? quest.outro : quest.summary }),
      );
      if (progress.stage === 'inProgress' || progress.stage === 'readyToTurnIn') {
        const list = el('ul');
        quest.objectives.forEach((objective, index) => {
          const counter = progress.counters[index] ?? 0;
          const done = counter >= objectiveGoal(objective);
          list.append(el('li', { style: done ? 'color:#86e09a' : '', text: objectiveText(objective, counter) }));
        });
        card.append(list);
      }
      this.listNode.append(card);
    }

    if (shown === 0) {
      this.listNode.append(el('div', { class: 'empty-note', text: 'Nobody has asked you for anything yet.' }));
    }
  }
}

/** Tam's stall. */
export class ShopPanel extends Modal {
  private listNode: HTMLElement;
  private purseNode: HTMLElement;
  private onChange: () => void;

  constructor(onChange: () => void) {
    super("Tam's Stall", 'Buy supplies');
    this.onChange = onChange;
    this.listNode = el('div', { class: 'item-list' });
    this.purseNode = el('div', { class: 'section-title' });
    this.body.append(this.purseNode, this.listNode);
  }

  override open(): void {
    this.refresh();
    super.open();
  }

  refresh(): void {
    const state = getState();
    this.purseNode.textContent = `Purse: ${state.glimmer} glimmer`;
    clear(this.listNode);
    for (const id of SHOP_STOCK) {
      const item = ITEMS[id];
      const owned = state.inventory[id] ?? 0;
      const affordable = state.glimmer >= item.price;
      // One of each piece of gear is plenty.
      const alreadyOwned = isEquippable(item) && owned > 0;
      const meta = alreadyOwned ? 'Owned' : `${item.price} ✦`;
      this.listNode.append(
        itemRow(
          item,
          {
            meta,
            count: owned > 1 ? owned : undefined,
            disabled: alreadyOwned || !affordable,
          },
          () => {
            if (getState().glimmer < item.price) return;
            actions.addGlimmer(-item.price);
            actions.addItem(id, 1);
            this.refresh();
            this.onChange();
          },
        ),
      );
    }
  }
}

export interface Settings {
  volume: number;
  music: boolean;
  sound: boolean;
  quality: 'low' | 'high';
}

/** Pause menu with settings, plus save/quit controls. */
export class PausePanel extends Modal {
  private settingsNode: HTMLElement;
  private actionsNode: HTMLElement;
  private settings: Settings;
  private onSettings: (settings: Settings) => void;

  constructor(settings: Settings, onSettings: (settings: Settings) => void) {
    super('Paused', 'Settings');
    this.settings = settings;
    this.onSettings = onSettings;
    this.settingsNode = el('div');
    this.actionsNode = el('div', { class: 'menu-buttons', style: 'margin-top:18px' });
    this.body.append(this.settingsNode, this.actionsNode);
  }

  setActions(buttons: Array<{ label: string; onClick: () => void; ghost?: boolean }>): void {
    clear(this.actionsNode);
    for (const button of buttons) {
      const node = el('button', { class: `big-button${button.ghost ? ' ghost' : ''}`, type: 'button', text: button.label });
      node.addEventListener('click', button.onClick);
      this.actionsNode.append(node);
    }
  }

  override open(): void {
    this.refresh();
    super.open();
  }

  refresh(): void {
    clear(this.settingsNode);

    const volume = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      value: String(Math.round(this.settings.volume * 100)),
    }) as HTMLInputElement;
    volume.addEventListener('input', () => {
      this.settings.volume = Number(volume.value) / 100;
      this.onSettings(this.settings);
    });
    this.settingsNode.append(
      row('Volume', 'Master level for music and effects.', volume),
      toggleRow('Music', 'The wandering score.', this.settings.music, (on) => {
        this.settings.music = on;
        this.onSettings(this.settings);
      }),
      toggleRow('Sound effects', 'Swings, hits and pickups.', this.settings.sound, (on) => {
        this.settings.sound = on;
        this.onSettings(this.settings);
      }),
      toggleRow('High detail', 'Shadows and full resolution. Turn off if the frame rate dips.', this.settings.quality === 'high', (on) => {
        this.settings.quality = on ? 'high' : 'low';
        this.onSettings(this.settings);
      }),
    );

    const state = getState();
    this.settingsNode.append(
      el(
        'div',
        { class: 'setting-row' },
        el(
          'div',
          {},
          el('label', { text: 'This run' }),
          el('div', {
            class: 'desc',
            text: `Level ${state.level} · ${formatPlaytime(state.playSeconds)} played · ${state.defeats} defeat${state.defeats === 1 ? '' : 's'}`,
          }),
        ),
      ),
    );
  }
}

function row(label: string, desc: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'setting-row' }, el('div', {}, el('label', { text: label }), el('div', { class: 'desc', text: desc })), control);
}

function toggleRow(label: string, desc: string, initial: boolean, onToggle: (on: boolean) => void): HTMLElement {
  const button = el('button', { class: `toggle${initial ? ' on' : ''}`, type: 'button', text: initial ? 'On' : 'Off' });
  let value = initial;
  button.addEventListener('click', () => {
    value = !value;
    button.classList.toggle('on', value);
    button.textContent = value ? 'On' : 'Off';
    onToggle(value);
  });
  return row(label, desc, button);
}

/** Title screen with continue / new game. */
export class TitleScreen {
  readonly root: HTMLElement;
  private buttons: HTMLElement;
  private note: HTMLElement;

  constructor() {
    this.buttons = el('div', { class: 'menu-buttons' });
    this.note = el('div', { class: 'save-note' });
    this.root = el(
      'div',
      { class: 'title-screen' },
      el(
        'div',
        { class: 'title-inner' },
        el('h1', { text: 'Tiny Planet' }),
        el('div', { class: 'sub', text: 'Shrines of the Blight' }),
        el('div', {
          class: 'blurb',
          text: 'A small round world, four silent shrines and one very stubborn hero. Walk all the way around and put it right.',
        }),
        this.buttons,
        this.note,
      ),
    );
  }

  show(
    save: SaveSummary | null,
    handlers: { onContinue: () => void; onNew: () => void; onDelete: () => void },
  ): void {
    clear(this.buttons);
    if (save) {
      const cont = el('button', { class: 'big-button', type: 'button', text: 'Continue' });
      cont.addEventListener('click', handlers.onContinue);
      this.buttons.append(cont);
      this.note.textContent = `Saved ${timeAgo(save.savedAt)} · Level ${save.level} · ${save.shrines}/4 shrines · ${formatPlaytime(save.playSeconds)} played · ${save.biome}`;
    } else {
      this.note.textContent = 'Progress saves automatically to this browser.';
    }
    const fresh = el('button', {
      class: save ? 'big-button ghost' : 'big-button',
      type: 'button',
      text: save ? 'New game (overwrites your save)' : 'Begin',
    });
    fresh.addEventListener('click', handlers.onNew);
    this.buttons.append(fresh);

    if (save) {
      const del = el('button', { class: 'big-button ghost', type: 'button', text: 'Delete save' });
      del.addEventListener('click', handlers.onDelete);
      this.buttons.append(del);
    }
    this.root.classList.add('show');
  }

  hide(): void {
    this.root.classList.remove('show');
  }

  get isOpen(): boolean {
    return this.root.classList.contains('show');
  }
}

/** Shown when the fourth shrine is cured. */
export class VictoryScreen {
  readonly root: HTMLElement;
  private statsNode: HTMLElement;
  private buttons: HTMLElement;

  constructor() {
    this.statsNode = el('div', { class: 'victory-stats' });
    this.buttons = el('div', { class: 'menu-buttons' });
    this.root = el(
      'div',
      { class: 'title-screen victory-screen' },
      el(
        'div',
        { class: 'title-inner' },
        el('h1', { text: 'The World Sings' }),
        el('div', { class: 'sub', text: 'All four shrines cured' }),
        el('div', {
          class: 'blurb',
          text: 'The bell rings on its own, and nobody is pulling the rope. Pip wants to walk all the way round with you. You said you would.',
        }),
        this.statsNode,
        this.buttons,
      ),
    );
  }

  show(onContinue: () => void): void {
    const state = getState();
    clear(this.statsNode);
    const kills = Object.values(state.kills).reduce((a, b) => a + (b ?? 0), 0);
    const rows: Array<[string, string]> = [
      ['Level reached', String(state.level)],
      ['Blight felled', String(kills)],
      ['Clean dodges', String(state.perfectDodges)],
      ['Times you fell', String(state.defeats)],
      ['Glimmer earned', String(state.glimmer)],
      ['Time on the road', formatPlaytime(state.playSeconds)],
    ];
    for (const [label, value] of rows) {
      this.statsNode.append(el('div', {}, el('span', { text: label }), el('b', { text: value })));
    }
    clear(this.buttons);
    const button = el('button', { class: 'big-button', type: 'button', text: 'Keep walking' });
    button.addEventListener('click', onContinue);
    this.buttons.append(button);
    this.root.classList.add('show');
  }

  hide(): void {
    this.root.classList.remove('show');
  }

  get isOpen(): boolean {
    return this.root.classList.contains('show');
  }
}

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
