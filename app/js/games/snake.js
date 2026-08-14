/**
 * 스네이크 듀얼 view.
 *
 * Rendered to canvas rather than DOM because it repaints ~9 times a second.
 * Between server pushes the view runs the shared `tick()` locally: the
 * simulation is deterministic, so predicting forward shows a smooth snake
 * instead of one that stutters at the network's pace, and the next authoritative
 * state simply replaces it.
 */
import { el, mount } from '../ui.js';
import { directionInput, dpad, miniHead } from './_base.js';
import { tick as simulate } from '../../../shared/games/snake.js';
import { formatSeconds } from '../ui.js';

const COLORS = [
  { body: '#6ee7f9', head: '#b6f4ff', food: '#ff9f6b' },
  { body: '#ff9f6b', head: '#ffd0b3', food: '#6ee7f9' },
];

export function createView({ mount: root, onMove, sound }) {
  const boards = el('div.snake-boards');
  const clock = el('p.field-hint', { style: { textAlign: 'center' } });
  const pad = dpad((dir) => steer(dir));
  mount(root, el('div', { style: { width: '100%', display: 'grid', gap: '12px' } }, [clock, boards, pad]));

  let ctx = null;
  let predicted = null; // locally advanced copy of the last server state
  let raf = 0;
  let lastFoodCount = [0, 0];
  const panels = [null, null];

  function steer(dir) {
    if (!ctx || !ctx.interactive || ctx.seat === null) return;
    if (ctx.status.phase !== 'playing') return;
    onMove({ type: 'dir', dir });
  }

  const releaseInput = directionInput(root, steer);

  function build(config) {
    mount(boards, null);
    for (const seat of [0, 1]) {
      const canvas = el('canvas.snake-canvas', { width: config.w * 16, height: config.h * 16 });
      const head = miniHead(seat, '', '');
      panels[seat] = { canvas, ctx2d: canvas.getContext('2d'), head };
      boards.append(el('div', { style: { display: 'grid', placeItems: 'center', width: '100%' } }, [head, canvas]));
    }
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    if (!ctx || !predicted) return;

    // Predict forward from the last authoritative state.
    if (ctx.status.phase === 'playing') {
      const stepped = simulate(predicted, ctx.now());
      if (stepped.changed) predicted = stepped.state;
    }

    const config = predicted.config;
    const cellPx = 16;

    for (const seat of [0, 1]) {
      const panel = panels[seat];
      if (!panel) continue;
      const snake = predicted.snakes[seat];
      const paint = panel.ctx2d;
      const palette = COLORS[seat];

      paint.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface-3').trim() || '#232c3e';
      paint.fillRect(0, 0, panel.canvas.width, panel.canvas.height);

      // Faint grid so distances are readable.
      paint.strokeStyle = 'rgba(255,255,255,0.045)';
      paint.lineWidth = 1;
      for (let x = 1; x < config.w; x++) {
        paint.beginPath();
        paint.moveTo(x * cellPx + 0.5, 0);
        paint.lineTo(x * cellPx + 0.5, panel.canvas.height);
        paint.stroke();
      }
      for (let y = 1; y < config.h; y++) {
        paint.beginPath();
        paint.moveTo(0, y * cellPx + 0.5);
        paint.lineTo(panel.canvas.width, y * cellPx + 0.5);
        paint.stroke();
      }

      if (snake.food) {
        paint.fillStyle = palette.food;
        paint.beginPath();
        paint.arc((snake.food[0] + 0.5) * cellPx, (snake.food[1] + 0.5) * cellPx, cellPx * 0.32, 0, Math.PI * 2);
        paint.fill();
      }

      snake.body.forEach(([x, y], i) => {
        paint.fillStyle = i === 0 ? palette.head : palette.body;
        paint.globalAlpha = snake.alive ? 1 : 0.35;
        const inset = i === 0 ? 1 : 2;
        paint.fillRect(x * cellPx + inset, y * cellPx + inset, cellPx - inset * 2, cellPx - inset * 2);
      });
      paint.globalAlpha = 1;

      if (!snake.alive) {
        paint.fillStyle = 'rgba(0,0,0,0.45)';
        paint.fillRect(0, 0, panel.canvas.width, panel.canvas.height);
        paint.fillStyle = '#fff';
        paint.font = 'bold 18px system-ui, sans-serif';
        paint.textAlign = 'center';
        paint.fillText('충돌', panel.canvas.width / 2, panel.canvas.height / 2);
      }

      panel.head.querySelector('.who').textContent = `${ctx.names[seat] || '-'}${seat === ctx.seat ? ' (나)' : ''}`;
      panel.head.querySelector('.val').textContent = `${snake.score}점 · ${snake.body.length}칸`;

      // Chomp sound when our own food counter moves.
      if (seat === ctx.seat && snake.foodCount > lastFoodCount[seat]) sound.eat();
      lastFoodCount[seat] = snake.foodCount;
    }

    if (ctx.status.phase !== 'over') {
      clock.textContent = `남은 시간 ${formatSeconds(predicted.deadline - ctx.now(), 0)}`;
    }
  }

  return {
    render(next) {
      const first = !ctx;
      ctx = next;
      if (first) {
        build(ctx.state.config);
        lastFoodCount = ctx.state.snakes.map((s) => s.foodCount);
        raf = requestAnimationFrame(draw);
      }
      // Authoritative state always wins over the local prediction.
      predicted = ctx.state;
    },

    destroy() {
      cancelAnimationFrame(raf);
      releaseInput();
      mount(root, null);
    },
  };
}
