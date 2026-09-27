import './style.css';
import { Game } from './core/Game';

/**
 * Entry point. Everything else hangs off `Game`, which owns the renderer, the
 * world and the DOM overlay.
 */

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;

function fail(message: string): void {
  const root = document.getElementById('ui-root') ?? document.body;
  root.innerHTML = `
    <div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;
                background:#140e28;color:#f6ecd8;font:15px/1.6 'Trebuchet MS',system-ui,sans-serif;
                text-align:center;pointer-events:auto">
      <div style="max-width:440px">
        <h1 style="margin:0 0 10px;font-size:26px;color:#ffd76b">Tiny Planet</h1>
        <p>${message}</p>
      </div>
    </div>`;
}

function webglSupported(target: HTMLCanvasElement): boolean {
  try {
    return !!(target.getContext('webgl2') ?? target.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!canvas) {
  fail('Could not find the game canvas.');
} else if (!webglSupported(document.createElement('canvas'))) {
  fail('This game needs WebGL, and this browser will not give it to us. Try a recent Chrome, Firefox, Safari or Edge.');
} else {
  const game = new Game(canvas);
  void game.boot();

  // `Game` installs a read-only `window.__debug()` snapshot for smoke tests.
  Object.assign(window, { __ready: true });
}
