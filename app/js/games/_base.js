/**
 * Shared building blocks for the fifteen game views.
 *
 * A view is a small object — `{ render(ctx), events(list), destroy() }` — that
 * owns one DOM subtree. It never talks to the network: it calls `onMove(move)`
 * and the host (an online room or a local match) decides what that means.
 *
 * The `ctx` a view receives:
 *   state        engine state, already redacted for this seat
 *   status       engine status ({ phase, turn, winner, scores, reason })
 *   seat         0, 1, or null when spectating
 *   interactive  true when this client may act right now
 *   names        [string, string]
 *   avatars      [emoji, emoji]
 *   now          server-synced timestamp
 *   isLocal      true for offline play (vs AI / same device)
 */
import { el } from '../ui.js';

/** A square-celled grid board sized to its container. */
export function gridBoard(className, cols, rows, maxWidth = 560) {
  return el(`div.grid-board${className ? `.${className}` : ''}`, {
    style: {
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridAutoRows: '1fr',
      width: `min(100%, ${maxWidth}px)`,
      aspectRatio: `${cols} / ${rows}`,
    },
  });
}

/** A clickable board cell. */
export function cell(props = {}, children = null) {
  return el('button.cell', { type: 'button', ...props }, children);
}

/** A seat-coloured stone. */
export function stone(seat, extra = '') {
  return el(`div.stone.p${seat}${extra ? `.${extra}` : ''}`);
}

/** Column and row letters/numbers for coordinate boards. */
export const COLUMN_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** `interactive && it is my turn` for turn-based games. */
export function myTurn(ctx) {
  return ctx.interactive && ctx.status?.turn === ctx.seat;
}

/**
 * Re-render only when something actually changed.
 *
 * Views rebuild their DOM wholesale, which is fine at these sizes but wasteful
 * at 10 Hz. Wrapping the state in a cheap signature skips the no-op renders.
 */
export function memoRender(fn) {
  let lastKey = null;
  return (ctx, key) => {
    const signature = key === undefined ? JSON.stringify(ctx.state) : String(key);
    if (signature === lastKey) return false;
    lastKey = signature;
    fn(ctx);
    return true;
  };
}

/** A labelled progress/score strip used by the race games. */
export function miniHead(seat, name, value) {
  return el('div.mini-head', { dataset: { seat } }, [
    el('span.who', { text: name }),
    el('span.val', { text: value }),
  ]);
}

/** Arrow-key + swipe input for the real-time games. Returns a cleanup fn. */
export function directionInput(target, onDirection) {
  const KEYS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
    W: 'up',
    S: 'down',
    A: 'left',
    D: 'right',
  };

  const onKey = (event) => {
    // Never steal keys from someone typing in the chat box.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const dir = KEYS[event.key];
    if (!dir) return;
    event.preventDefault();
    onDirection(dir);
  };
  window.addEventListener('keydown', onKey, { passive: false });

  let startX = 0;
  let startY = 0;
  let tracking = false;
  const onStart = (event) => {
    const touch = event.changedTouches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
  };
  const onEnd = (event) => {
    if (!tracking) return;
    tracking = false;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    onDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  };
  target.addEventListener('touchstart', onStart, { passive: true });
  target.addEventListener('touchend', onEnd, { passive: true });

  return () => {
    window.removeEventListener('keydown', onKey);
    target.removeEventListener('touchstart', onStart);
    target.removeEventListener('touchend', onEnd);
  };
}

/** On-screen d-pad, shown on touch devices where CSS hides it on desktop. */
export function dpad(onDirection) {
  const key = (dir, glyph) =>
    el('button', { class: dir, type: 'button', 'aria-label': dir, onClick: () => onDirection(dir) }, glyph);
  return el('div.dpad', {}, [key('up', '▲'), key('left', '◀'), key('right', '▶'), key('down', '▼')]);
}

/** A countdown bar that turns red near the end. */
export function timerBar(remainingMs, totalMs) {
  const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const urgent = ratio < 0.25;
  return el('div.timer-bar', {}, el(`div.timer-fill${urgent ? '.urgent' : ''}`, { style: { width: `${ratio * 100}%` } }));
}
