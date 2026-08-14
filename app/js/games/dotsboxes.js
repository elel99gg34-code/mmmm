/**
 * 점과 상자 view.
 *
 * The board is a single CSS grid of alternating dot/edge tracks: odd rows hold
 * horizontal edges, even rows hold vertical edges and box fills. That keeps the
 * geometry declarative instead of hand-positioned.
 */
import { el, mount } from '../ui.js';
import { ROWS, COLS, hIndex, vIndex } from '../../../shared/games/dotsboxes.js';

export function createView({ mount: root, onMove, sound }) {
  const gap = 'minmax(18px, 1fr)';
  const board = el('div.db-board', {
    style: {
      gridTemplateColumns: `repeat(${COLS}, 11px ${gap}) 11px`,
      gridTemplateRows: `repeat(${ROWS}, 11px ${gap}) 11px`,
      width: `min(100%, 420px)`,
      aspectRatio: '1',
    },
  });

  const edgeNodes = new Map();
  const boxNodes = new Map();

  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c <= COLS; c++) {
      board.append(el('span.db-dot', { style: { gridRow: r * 2 + 1, gridColumn: c * 2 + 1 } }));
    }
  }
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = hIndex(r, c);
      const node = el('button.db-edge.h', {
        type: 'button',
        'aria-label': `가로선 ${r + 1}-${c + 1}`,
        style: { gridRow: r * 2 + 1, gridColumn: c * 2 + 2 },
        onClick: () => onMove(idx),
      });
      edgeNodes.set(idx, node);
      board.append(node);
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS; c++) {
      const idx = vIndex(r, c);
      const node = el('button.db-edge.v', {
        type: 'button',
        'aria-label': `세로선 ${r + 1}-${c + 1}`,
        style: { gridRow: r * 2 + 2, gridColumn: c * 2 + 1 },
        onClick: () => onMove(idx),
      });
      edgeNodes.set(idx, node);
      board.append(node);
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const node = el('span.db-box', { style: { gridRow: r * 2 + 2, gridColumn: c * 2 + 2 } });
      boxNodes.set(r * COLS + c, node);
      board.append(node);
    }
  }

  mount(root, el('div', { style: { display: 'grid', placeItems: 'center', width: '100%' } }, board));
  let lastSignature = '';

  return {
    render(ctx) {
      const { state, status } = ctx;
      const signature = `${state.edges.join('')}|${ctx.interactive}|${status.turn}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      const canPlay = ctx.interactive && status.turn === ctx.seat && status.phase === 'playing';
      for (const [idx, node] of edgeNodes) {
        const owner = state.edges[idx];
        node.className = `db-edge ${node.classList.contains('h') ? 'h' : 'v'}${owner ? ` p${owner - 1}` : ''}${
          state.last === idx ? ' last' : ''
        }`;
        node.disabled = !canPlay || owner !== 0;
      }
      for (const [idx, node] of boxNodes) {
        const owner = state.boxes[idx];
        node.className = `db-box${owner ? ` p${owner - 1}` : ''}`;
        node.textContent = owner ? (owner === 1 ? 'A' : 'B') : '';
      }
    },

    events(list) {
      for (const event of list) {
        if (event.type !== 'edge') continue;
        if (event.claimed?.length) sound.correct();
        else sound.click();
      }
    },

    destroy() {
      mount(root, null);
    },
  };
}
