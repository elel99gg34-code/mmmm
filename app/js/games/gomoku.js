/** 오목 board view — 15x15 goban with hoshi points and a last-move marker. */
import { el, mount } from '../ui.js';
import { gridBoard, cell, stone } from './_base.js';
import { SIZE } from '../../../shared/games/gomoku.js';

const STARS = [3, 7, 11];

export function createView({ mount: root, onMove, sound }) {
  const board = gridBoard('goban', SIZE, SIZE, 560);
  const wrap = el('div', { style: { width: '100%', display: 'grid', placeItems: 'center' } }, board);
  mount(root, wrap);

  // Hoshi dots sit at line intersections, so they are absolutely positioned
  // over the grid rather than living inside a cell.
  for (const r of STARS) {
    for (const c of STARS) {
      board.append(
        el('span.star', {
          style: { left: `${((c + 0.5) / SIZE) * 100}%`, top: `${((r + 0.5) / SIZE) * 100}%` },
        }),
      );
    }
  }

  const cells = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    const edges = [r === 0 && 'edge-t', r === SIZE - 1 && 'edge-b', c === 0 && 'edge-l', c === SIZE - 1 && 'edge-r']
      .filter(Boolean)
      .join(' ');
    const node = cell({
      class: edges,
      'aria-label': `${String.fromCharCode(65 + c)}${SIZE - r}`,
      onClick: () => onMove(i),
    });
    cells.push(node);
    board.append(node);
  }

  let lastSignature = '';

  return {
    render(ctx) {
      const { state, status } = ctx;
      const signature = `${state.board.join('')}|${state.last}|${ctx.interactive}|${status.turn}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      const canPlay = ctx.interactive && status.turn === ctx.seat && status.phase === 'playing';
      const winSet = new Set(state.winLine || []);

      for (let i = 0; i < cells.length; i++) {
        const node = cells[i];
        const value = state.board[i];
        node.disabled = !canPlay || value !== 0;
        node.classList.toggle('last', state.last === i);
        const existing = node.querySelector('.stone');
        const wantClass = value === 0 ? null : `p${value - 1}${winSet.has(i) ? ' win' : ''}`;
        if (!value) {
          existing?.remove();
        } else if (!existing) {
          node.append(stone(value - 1, winSet.has(i) ? 'win' : ''));
        } else if (existing.className !== `stone ${wantClass}`) {
          existing.className = `stone ${wantClass}`;
        }
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
