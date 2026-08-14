/** 리버시 view — legal squares are dotted, flipped discs animate. */
import { el, mount } from '../ui.js';
import { gridBoard, cell, stone } from './_base.js';
import { SIZE, legalMoves } from '../../../shared/games/reversi.js';

export function createView({ mount: root, onMove, sound }) {
  const board = gridBoard('reversi-board', SIZE, SIZE, 460);
  const cells = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const node = cell({
      'aria-label': `${String.fromCharCode(65 + (i % SIZE))}${Math.floor(i / SIZE) + 1}`,
      onClick: () => onMove(i),
    });
    cells.push(node);
    board.append(node);
  }
  mount(root, el('div', { style: { display: 'grid', placeItems: 'center', width: '100%' } }, board));

  let lastSignature = '';
  let flashFlips = [];

  return {
    render(ctx) {
      const { state, status } = ctx;
      const signature = `${state.board.join('')}|${state.last}|${ctx.interactive}|${status.turn}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      const canPlay = ctx.interactive && status.turn === ctx.seat && status.phase === 'playing';
      const legal = new Set(canPlay ? legalMoves(state, ctx.seat) : []);
      const flipped = new Set(flashFlips);
      flashFlips = [];

      for (let i = 0; i < cells.length; i++) {
        const node = cells[i];
        const value = state.board[i];
        node.disabled = !legal.has(i);
        node.classList.toggle('legal', legal.has(i));
        node.classList.toggle('last', state.last === i);

        const existing = node.querySelector('.stone');
        if (!value) {
          existing?.remove();
          continue;
        }
        const want = `stone p${value - 1}${flipped.has(i) ? ' flip' : ''}`;
        if (!existing) node.append(stone(value - 1, flipped.has(i) ? 'flip' : ''));
        else if (existing.className !== want) existing.className = want;
      }
    },

    events(list) {
      for (const event of list) {
        if (event.type !== 'place') continue;
        flashFlips = event.flips || [];
        sound.flip();
        // The signature has already changed, so the next render picks these up.
        lastSignature = '';
      }
    },

    destroy() {
      mount(root, null);
    },
  };
}
