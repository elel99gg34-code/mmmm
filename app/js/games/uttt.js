/** 얼티밋 틱택토 view — nine mini boards, the live one outlined. */
import { el, mount } from '../ui.js';
import { legalMoves } from '../../../shared/games/uttt.js';

const MARKS = ['✕', '○'];

export function createView({ mount: root, onMove, sound }) {
  const board = el('div.uttt-board', { style: { width: 'min(100%, 460px)' } });
  const minis = [];
  const cells = [];

  for (let b = 0; b < 9; b++) {
    const mini = el('div.uttt-mini');
    minis.push(mini);
    for (let i = 0; i < 9; i++) {
      const idx = b * 9 + i;
      const node = el('button.uttt-cell', {
        type: 'button',
        'aria-label': `${b + 1}번 판 ${i + 1}번 칸`,
        onClick: () => onMove(idx),
      });
      cells.push(node);
      mini.append(node);
    }
    board.append(mini);
  }

  mount(root, el('div', { style: { display: 'grid', placeItems: 'center', width: '100%' } }, board));
  let lastSignature = '';

  return {
    render(ctx) {
      const { state, status } = ctx;
      const signature = `${state.cells.join('')}|${state.macro.join('')}|${state.active}|${ctx.interactive}|${status.turn}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      const canPlay = ctx.interactive && status.turn === ctx.seat && status.phase === 'playing';
      const legal = new Set(canPlay ? legalMoves(state) : []);
      const activeBoards = new Set([...legal].map((i) => Math.floor(i / 9)));

      for (let b = 0; b < 9; b++) {
        const mini = minis[b];
        const owner = state.macro[b];
        mini.className = 'uttt-mini';
        mini.removeAttribute('data-mark');
        if (owner === 1 || owner === 2) {
          mini.classList.add(`won-${owner - 1}`);
          mini.dataset.mark = MARKS[owner - 1];
        } else if (owner === 3) {
          mini.classList.add('drawn');
          mini.dataset.mark = '–';
        }
        // Highlight where play is allowed — including "anywhere" after a
        // send into a finished board.
        if (status.phase === 'playing' && activeBoards.has(b) && owner === 0) mini.classList.add('active');
      }

      for (let i = 0; i < cells.length; i++) {
        const node = cells[i];
        const value = state.cells[i];
        node.className = `uttt-cell${value ? ` p${value - 1}` : ''}${state.last === i ? ' last' : ''}`;
        node.textContent = value ? MARKS[value - 1] : '';
        node.disabled = !legal.has(i);
      }
    },

    events(list) {
      if (list.some((e) => e.type === 'place')) sound.place();
    },

    destroy() {
      mount(root, null);
    },
  };
}
