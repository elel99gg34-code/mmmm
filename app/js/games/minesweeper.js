/**
 * 지뢰찾기 듀얼 view.
 *
 * Your own field is interactive; the opponent's shows only which squares they
 * have opened, so you can feel them gaining on you without seeing their
 * numbers. Right-click (or long-press) flags; clicking a satisfied number
 * chords.
 */
import { el, mount } from '../ui.js';
import { formatSeconds } from '../ui.js';

export function createView({ mount: root, onMove, sound }) {
  const boards = el('div.ms-boards');
  const status = el('p.field-hint', { style: { textAlign: 'center' } });
  mount(root, el('div.ms-wrap', {}, [status, boards]));

  let ctx = null;
  let built = null; // `${rows}x${cols}` the DOM was built for
  const panels = [null, null];
  let longPressTimer = null;

  function buildPanels() {
    const { rows, cols } = ctx.state.config;
    mount(boards, null);
    for (const seat of [0, 1]) {
      const grid = el('div.ms-grid', {
        style: {
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridAutoRows: '1fr',
          width: `min(100%, ${Math.min(360, cols * 24)}px)`,
          aspectRatio: `${cols} / ${rows}`,
        },
      });
      const cells = [];
      for (let i = 0; i < rows * cols; i++) {
        const node = el('button.ms-cell', { type: 'button', 'aria-label': `${i + 1}번 칸` });
        if (seat === ctx.seat) wireOwnCell(node, i);
        cells.push(node);
        grid.append(node);
      }
      const head = el('div.mini-head', { dataset: { seat } }, [el('span.who'), el('span.val')]);
      panels[seat] = { grid, cells, head };
      boards.append(el('div', { style: { display: 'grid', placeItems: 'center', width: '100%' } }, [head, grid]));
    }
    built = `${rows}x${cols}`;
  }

  function wireOwnCell(node, idx) {
    node.addEventListener('click', () => {
      if (!playable()) return;
      const opened = ctx.state.revealed[ctx.seat][idx];
      onMove({ type: opened ? 'chord' : 'reveal', idx });
    });
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (!playable()) return;
      onMove({ type: 'flag', idx });
      sound.click();
    });
    // Long press is the touch equivalent of a right click.
    node.addEventListener('touchstart', () => {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (!playable()) return;
        onMove({ type: 'flag', idx });
        sound.click();
      }, 420);
    }, { passive: true });
    const cancel = () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    };
    node.addEventListener('touchend', cancel, { passive: true });
    node.addEventListener('touchmove', cancel, { passive: true });
  }

  function playable() {
    return (
      ctx &&
      ctx.interactive &&
      ctx.seat !== null &&
      ctx.status.phase === 'playing' &&
      !ctx.state.dead[ctx.seat] &&
      ctx.state.finishedAt[ctx.seat] === null
    );
  }

  const timer = setInterval(() => {
    if (!ctx || ctx.status.phase === 'over') return;
    const left = ctx.state.deadline - ctx.now();
    status.textContent = `남은 시간 ${formatSeconds(left, 0)} · 안전한 칸 ${ctx.state.safeTotal}개`;
  }, 500);

  return {
    render(next) {
      ctx = next;
      const { rows, cols } = ctx.state.config;
      if (built !== `${rows}x${cols}`) buildPanels();

      const mineSet = new Set(ctx.state.mines);
      for (const seat of [0, 1]) {
        const panel = panels[seat];
        const revealed = ctx.state.revealed[seat];
        const flags = ctx.state.flags[seat];
        const isMe = seat === ctx.seat;

        panel.head.querySelector('.who').textContent = `${ctx.names[seat] || '-'}${isMe ? ' (나)' : ''}`;
        panel.head.querySelector('.val').textContent = ctx.state.dead[seat]
          ? '💥 탈락'
          : ctx.state.finishedAt[seat] !== null
            ? `✅ ${(ctx.state.finishedAt[seat] / 1000).toFixed(1)}초`
            : `${ctx.state.opened[seat]} / ${ctx.state.safeTotal}`;

        for (let i = 0; i < panel.cells.length; i++) {
          const node = panel.cells[i];
          const open = revealed[i];
          const value = ctx.state.numbers[i];
          const classes = ['ms-cell'];
          let text = '';

          if (open) {
            classes.push('open');
            if (mineSet.has(i)) {
              classes.push('boom');
              text = '💣';
            } else if (isMe || ctx.status.phase === 'over') {
              if (value > 0) {
                classes.push(`n${value}`);
                text = String(value);
              }
            } else {
              // Opponent's opened squares: position only, never the number.
              text = '';
            }
          } else if (flags[i] && (isMe || ctx.status.phase === 'over')) {
            text = '🚩';
          } else if (ctx.status.phase === 'over' && mineSet.has(i)) {
            text = '💣';
          }

          node.className = classes.join(' ');
          node.textContent = text;
          node.disabled = !isMe || !playable();
        }
      }
    },

    events(list) {
      for (const event of list) {
        if (event.seat !== ctx?.seat) continue;
        if (event.type === 'boom') sound.boom();
        else if (event.type === 'clear') sound.win();
        else if (event.type === 'reveal') sound.click();
      }
    },

    destroy() {
      clearInterval(timer);
      clearTimeout(longPressTimer);
      mount(root, null);
    },
  };
}
