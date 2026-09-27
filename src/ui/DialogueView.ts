import { clear, el } from './dom';
import type { DialogueAction, DialogueNode, DialogueOption } from '../rpg/Dialogue';

export interface DialogueSession {
  speaker: string;
  role: string;
  node: DialogueNode;
  options: DialogueOption[];
}

/**
 * The dialogue box.
 *
 * Lines are typed out a character at a time with a blip per glyph; pressing the
 * advance key once completes the line, twice moves on. Options appear only after
 * the last line, and are pickable with the number keys, arrows or a click.
 */
export class DialogueView {
  readonly root: HTMLElement;

  private whoName: HTMLElement;
  private whoRole: HTMLElement;
  private lineNode: HTMLElement;
  private optionsNode: HTMLElement;
  private hintNode: HTMLElement;

  private session: DialogueSession | null = null;
  private lineIndex = 0;
  private typed = 0;
  private typeTimer = 0;
  private optionIndex = 0;
  private onChoose: ((option: DialogueOption) => void) | null = null;
  private onAdvanceEnd: (() => void) | null = null;
  private blip: (() => void) | null = null;

  /** Characters per second. */
  private static readonly SPEED = 52;

  constructor() {
    this.whoName = el('b');
    this.whoRole = el('span');
    this.lineNode = el('div', { class: 'line' });
    this.optionsNode = el('div', { class: 'options' });
    this.hintNode = el('div', { class: 'hintline' });
    this.root = el(
      'div',
      { class: 'dialogue ui-panel' },
      el('div', { class: 'who' }, this.whoName, this.whoRole),
      this.lineNode,
      this.optionsNode,
      this.hintNode,
    );
  }

  get isOpen(): boolean {
    return this.session !== null;
  }

  get showingOptions(): boolean {
    return (
      this.session !== null &&
      this.lineIndex >= this.session.node.lines.length - 1 &&
      this.typed >= this.currentLine.length &&
      this.session.options.length > 0
    );
  }

  private get currentLine(): string {
    if (!this.session) return '';
    return this.session.node.lines[Math.min(this.lineIndex, this.session.node.lines.length - 1)] ?? '';
  }

  setBlip(blip: () => void): void {
    this.blip = blip;
  }

  open(session: DialogueSession, onChoose: (option: DialogueOption) => void, onEnd: () => void): void {
    this.session = session;
    this.lineIndex = 0;
    this.typed = 0;
    this.typeTimer = 0;
    this.optionIndex = 0;
    this.onChoose = onChoose;
    this.onAdvanceEnd = onEnd;
    this.whoName.textContent = session.speaker;
    this.whoRole.textContent = session.role;
    this.root.classList.add('show');
    this.render();
  }

  close(): void {
    this.session = null;
    this.onChoose = null;
    this.onAdvanceEnd = null;
    this.root.classList.remove('show');
  }

  /** Advance: finish typing, move to the next line, or end the node. */
  advance(): void {
    if (!this.session) return;
    if (this.typed < this.currentLine.length) {
      this.typed = this.currentLine.length;
      this.render();
      return;
    }
    if (this.lineIndex < this.session.node.lines.length - 1) {
      this.lineIndex++;
      this.typed = 0;
      this.render();
      return;
    }
    if (this.session.options.length === 0) {
      this.onAdvanceEnd?.();
      return;
    }
    // With options up, advance confirms the highlighted one.
    this.choose(this.optionIndex);
  }

  moveSelection(delta: number): void {
    if (!this.showingOptions || !this.session) return;
    const count = this.session.options.length;
    this.optionIndex = (this.optionIndex + delta + count) % count;
    this.render();
  }

  choose(index: number): void {
    if (!this.session) return;
    const option = this.session.options[index];
    if (!option) return;
    this.onChoose?.(option);
  }

  update(dt: number): void {
    if (!this.session) return;
    const line = this.currentLine;
    if (this.typed >= line.length) return;
    this.typeTimer += dt;
    const step = 1 / DialogueView.SPEED;
    let changed = false;
    while (this.typeTimer >= step && this.typed < line.length) {
      this.typeTimer -= step;
      this.typed++;
      changed = true;
      const char = line[this.typed - 1];
      if (char && char !== ' ' && this.typed % 2 === 0) this.blip?.();
    }
    if (changed) this.render();
  }

  private render(): void {
    if (!this.session) return;
    const line = this.currentLine;
    const visible = line.slice(0, this.typed);
    clear(this.lineNode);
    this.lineNode.append(document.createTextNode(visible));
    if (this.typed < line.length) this.lineNode.append(el('span', { class: 'cursor', text: '▌' }));

    clear(this.optionsNode);
    if (this.showingOptions) {
      this.session.options.forEach((option, index) => {
        const button = el(
          'button',
          { class: `option${index === this.optionIndex ? ' active' : ''}`, type: 'button' },
          el('span', { class: 'num', text: `${index + 1}` }),
          option.text,
        );
        button.addEventListener('click', () => this.choose(index));
        button.addEventListener('mouseenter', () => {
          this.optionIndex = index;
          this.render();
        });
        this.optionsNode.append(button);
      });
      this.hintNode.textContent = '↑↓ or 1-9 to choose · Enter to confirm · Esc to leave';
    } else {
      const more = this.lineIndex < this.session.node.lines.length - 1 || this.typed < line.length;
      this.hintNode.textContent = more ? 'Space / E to continue' : 'Space / E to finish';
    }
  }
}

export type { DialogueAction };
