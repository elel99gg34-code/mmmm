/** 커넥트4 view — click a column header or any cell in that column. */
import { el, mount } from '../ui.js';
import { gridBoard, cell, stone } from './_base.js';
import { COLS, ROWS } from '../../../shared/games/connect4.js';

export function createView({ mount: root, onMove, sound }) {
  const drops = el('div.c4-cols', {
    style: { gridTemplateColumns: `repeat(${COLS}, 1fr)`, width: `min(100%, 460px)` },
  });
  const dropButtons = [];
  for (let c = 0; c < COLS; c++) {
    const btn = el(
      'button.c4-drop',
      { type: 'button', 'aria-label': `${c + 1}번 열에 넣기`, onClick: () => onMove(c) },
      '▼',
    );
    dropButtons.push(btn);
    drops.append(btn);
  }

  const board = gridBoard('c4-board', COLS, ROWS, 460);
  const cells = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const c = i % COLS;
    const node = cell({ 'aria-label': `${c + 1}번 열`, onClick: () => onMove(c) });
    cells.push(node);
    board.append(node);
  }

  mount(root, el('div', { style: { display: 'grid', placeItems: 'center', width: '100%' } }, [drops, board]));

  let lastSignature = '';

  return {
    render(ctx) {
      const { state, status } = ctx;
      const signature = `${state.board.join('')}|${state.last}|${ctx.interactive}|${status.turn}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      const canPlay = ctx.interactive && status.turn === ctx.seat && status.phase === 'playing';
      const winSet = new Set(state.winLine || []);

      for (let c = 0; c < COLS; c++) {
        dropButtons[c].disabled = !canPlay || state.board[c] !== 0;
      }
      for (let i = 0; i < cells.length; i++) {
        const node = cells[i];
        const value = state.board[i];
        node.disabled = !canPlay || state.board[i % COLS] !== 0;
        node.classList.toggle('last', state.last === i);
        const existing = node.querySelector('.stone');
        if (!value) {
          existing?.remove();
        } else {
          const want = `stone p${value - 1}${winSet.has(i) ? ' win' : ''}`;
          if (!existing) node.append(stone(value - 1, winSet.has(i) ? 'win' : ''));
          else if (existing.className !== want) existing.className = want;
        }
      }
    },

    events(list) {
      if (list.some((e) => e.type === 'drop')) sound.drop();
    },

    destroy() {
      mount(root, null);
    },
  };
}
