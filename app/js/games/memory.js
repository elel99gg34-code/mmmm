/** 기억력 카드 view — 24 cards that flip in 3D, captured ones tinted by owner. */
import { el, mount } from '../ui.js';
import { ROWS, COLS } from '../../../shared/games/memory.js';

export function createView({ mount: root, onMove, sound }) {
  const board = el('div.memory-board', {
    style: { gridTemplateColumns: `repeat(${COLS}, 1fr)`, width: `min(100%, 520px)` },
  });

  const cards = [];
  for (let i = 0; i < ROWS * COLS; i++) {
    const front = el('span.memory-face.front');
    const node = el('button.memory-card', { type: 'button', 'aria-label': `${i + 1}번 카드`, onClick: () => flip(i) }, [
      el('span.memory-face.back', {}, '🎴'),
      front,
    ]);
    cards.push({ node, front });
    board.append(node);
  }

  mount(root, el('div', { style: { display: 'grid', placeItems: 'center', width: '100%' } }, board));

  let ctx = null;
  let lastSignature = '';

  function flip(idx) {
    if (!ctx || !ctx.interactive) return;
    if (ctx.status.turn !== ctx.seat || ctx.status.phase !== 'playing') return;
    if (ctx.state.closeAt !== null) return;
    if (ctx.state.owner[idx] !== null || ctx.state.face.includes(idx)) return;
    onMove({ type: 'flip', idx });
  }

  return {
    render(next) {
      ctx = next;
      const { state, status } = ctx;
      const signature = `${state.owner.join(',')}|${state.face.join(',')}|${state.closeAt}|${status.turn}|${ctx.interactive}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      const canPlay =
        ctx.interactive && status.turn === ctx.seat && status.phase === 'playing' && state.closeAt === null;

      for (let i = 0; i < cards.length; i++) {
        const { node, front } = cards[i];
        const owner = state.owner[i];
        const faceUp = state.face.includes(i);
        const taken = owner !== null;

        node.className = `memory-card${faceUp ? ' up' : ''}${taken ? ' taken' : ''}${
          taken ? ` own-${owner}` : ''
        }`;
        node.disabled = !canPlay || taken || faceUp;
        front.textContent = state.cards[i] || '';
      }
    },

    events(list) {
      for (const event of list) {
        if (event.type === 'flip') sound.flip();
        if (event.type === 'match') sound.correct();
        if (event.type === 'miss') sound.wrong();
      }
    },

    destroy() {
      mount(root, null);
    },
  };
}
