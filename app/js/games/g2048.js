/** 2048 듀얼 view — two grids side by side, arrow keys or swipe to slide. */
import { el, mount } from '../ui.js';
import { directionInput, dpad, miniHead } from './_base.js';
import { formatSeconds } from '../ui.js';

export function createView({ mount: root, onMove, sound }) {
  const boards = el('div.g2048-boards');
  const clock = el('p.field-hint', { style: { textAlign: 'center' } });
  const pad = dpad((dir) => move(dir));
  mount(root, el('div', { style: { width: '100%', display: 'grid', gap: '12px' } }, [clock, boards, pad]));

  let ctx = null;
  const panels = [null, null];
  const previous = [null, null];

  function move(dir) {
    if (!ctx || !ctx.interactive || ctx.seat === null) return;
    if (ctx.status.phase !== 'playing' || ctx.state.dead[ctx.seat]) return;
    onMove({ type: 'move', dir });
  }

  const releaseInput = directionInput(root, move);

  function build() {
    mount(boards, null);
    for (const seat of [0, 1]) {
      const grid = el('div.g2048-grid');
      const tiles = [];
      for (let i = 0; i < 16; i++) {
        const tile = el('div.g2048-tile.v0');
        tiles.push(tile);
        grid.append(tile);
      }
      const head = miniHead(seat, '', '');
      panels[seat] = { grid, tiles, head };
      boards.append(el('div', { style: { display: 'grid', placeItems: 'center', width: '100%' } }, [head, grid]));
    }
  }
  build();

  const timer = setInterval(() => {
    if (!ctx) return;
    if (ctx.status.phase === 'over') {
      clock.textContent = '';
      return;
    }
    clock.textContent = `남은 시간 ${formatSeconds(ctx.state.deadline - ctx.now(), 0)}`;
  }, 400);

  function tileClass(value) {
    if (value === 0) return 'g2048-tile v0';
    if (value > 2048) return 'g2048-tile big';
    return `g2048-tile v${value}`;
  }

  return {
    render(next) {
      ctx = next;
      for (const seat of [0, 1]) {
        const panel = panels[seat];
        const grid = ctx.state.grids[seat];
        const before = previous[seat];

        panel.head.querySelector('.who').textContent = `${ctx.names[seat] || '-'}${seat === ctx.seat ? ' (나)' : ''}`;
        panel.head.querySelector('.val').textContent = `${ctx.state.scores[seat]}점${
          ctx.state.dead[seat] ? ' · 막힘' : ''
        }`;

        for (let i = 0; i < 16; i++) {
          const value = grid[i];
          const tile = panel.tiles[i];
          const changed = !before || before[i] !== value;
          tile.className = `${tileClass(value)}${changed && value ? ' spawn' : ''}`;
          tile.textContent = value ? String(value) : '';
        }
        previous[seat] = grid.slice();
      }
    },

    events(list) {
      for (const event of list) {
        if (event.type === 'move' && event.seat === ctx?.seat) {
          if (event.gained > 0) sound.merge();
          else sound.click();
        }
      }
    },

    destroy() {
      clearInterval(timer);
      releaseInput();
      mount(root, null);
    },
  };
}
