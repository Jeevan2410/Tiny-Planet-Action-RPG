/** Terse DOM helpers so the UI modules stay readable. */

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function show(node: Element, visible: boolean, className = 'show'): void {
  node.classList.toggle(className, visible);
}

export function setBar(fill: HTMLElement, ratio: number): void {
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
}

/** A keycap chip, e.g. for "[E] Talk". */
export function key(label: string): HTMLElement {
  return el('span', { class: 'keycap', text: label });
}
