/**
 * 체커 view.
 *
 * Moves are paths, so selection is stateful: pick a piece, then walk the
 * legal destinations. Because captures are compulsory, only pieces that have a
 * legal move are selectable at all — the board itself teaches the rule.
 */
import { el, mount } from '../ui.js';
import { gridBoard, cell } from './_base.js';
import { SIZE, legalMoves } from '../../../shared/games/checkers.js';

const isKing = (v) => v === 2 || v === 4;
const ownerOf = (v) => (v === 0 ? -1 : v <= 2 ? 0 : 1);

export function createView({ mount: root, onMove, sound }) {
  const board = gridBoard('checkers-board', SIZE, SIZE, 460);
  const cells = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    const node = cell({
      class: (r + c) % 2 === 1 ? 'dark' : 'light',
      'aria-label': `${String.fromCharCode(65 + c)}${SIZE - r}`,
      onClick: () => onSquare(i),
    });
    cells.push(node);
    board.append(node);
  }

  const hint = el('p.field-hint', { style: { textAlign: 'center', marginTop: '10px' } }, '');
  mount(root, el('div', { style: { display: 'grid', placeItems: 'center', width: '100%' } }, [board, hint]));

  /** The path being built, e.g. `[from]` then `[from, over]` mid multi-jump. */
  let path = [];
  let current = null;

  function optionsFrom(prefix) {
    if (!current) return [];
    return legalMoves(current.state, current.seat).filter((move) =>
      prefix.every((sq, i) => move[i] === sq) && move.length > prefix.length,
    );
  }

  function onSquare(idx) {
    if (!current?.canPlay) return;

    if (!path.length) {
      const starts = legalMoves(current.state, current.seat).filter((m) => m[0] === idx);
      if (!starts.length) return;
      path = [idx];
      sound.select();
      paint();
      return;
    }

    if (idx === path[path.length - 1] || idx === path[0]) {
      path = []; // clicking the piece again cancels
      paint();
      return;
    }

    const candidates = optionsFrom([...path, idx]);
    if (!candidates.length) {
      // Maybe they clicked a different piece to start over.
      const starts = legalMoves(current.state, current.seat).filter((m) => m[0] === idx);
      path = starts.length ? [idx] : [];
      paint();
      return;
    }

    path = [...path, idx];
    const exact = candidates.find((m) => m.length === path.length);
    // A jump chain can continue; only send when no longer continuation exists.
    if (exact && !candidates.some((m) => m.length > path.length)) {
      const move = exact;
      path = [];
      onMove(move);
      return;
    }
    sound.select();
    paint();
  }

  function paint() {
    if (!current) return;
    const { state, canPlay } = current;
    const targets = new Set(optionsFrom(path).map((m) => m[path.length]));
    const selectable = new Set(canPlay ? legalMoves(state, current.seat).map((m) => m[0]) : []);
    const lastPath = new Set(state.last || []);

    for (let i = 0; i < cells.length; i++) {
      const node = cells[i];
      const piece = state.board[i];
      node.classList.toggle('pick', path.includes(i));
      node.classList.toggle('target', targets.has(i));
      node.classList.toggle('last', lastPath.has(i) && !path.length);
      node.disabled = !canPlay || (!selectable.has(i) && !targets.has(i) && !path.includes(i));

      const existing = node.querySelector('.checker-piece');
      if (!piece) {
        existing?.remove();
        continue;
      }
      const owner = ownerOf(piece);
      const want = `checker-piece p${owner}`;
      if (!existing) node.append(el(`div.${want.split(' ').join('.')}`, {}, isKing(piece) ? '♛' : ''));
      else {
        existing.className = want;
        existing.textContent = isKing(piece) ? '♛' : '';
      }
    }

    if (!canPlay) hint.textContent = '';
    else if (path.length > 1) hint.textContent = '연속으로 잡을 수 있으면 이어서 클릭하세요.';
    else if (path.length === 1) hint.textContent = '이동할 칸을 고르세요. (다시 누르면 취소)';
    else {
      const jumps = legalMoves(state, current.seat).some((m) => Math.abs(Math.floor(m[0] / SIZE) - Math.floor(m[1] / SIZE)) === 2);
      hint.textContent = jumps ? '잡을 수 있는 수가 있어 반드시 잡아야 합니다.' : '움직일 말을 고르세요.';
    }
  }

  return {
    render(ctx) {
      const canPlay = ctx.interactive && ctx.status.turn === ctx.seat && ctx.status.phase === 'playing';
      const changedTurn = current && (current.state.turn !== ctx.state.turn || current.canPlay !== canPlay);
      current = { state: ctx.state, seat: ctx.seat, canPlay };
      if (changedTurn) path = [];
      paint();
    },

    events(list) {
      for (const event of list) {
        if (event.type === 'move') sound[event.captures ? 'hit' : 'place']();
      }
    },

    destroy() {
      mount(root, null);
    },
  };
}
