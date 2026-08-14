/**
 * 타이핑 레이스 view.
 *
 * The passage highlights the longest correct prefix, so a typo visibly stops
 * your progress until you fix it — which is exactly what the engine scores.
 * Progress is reported on a throttle rather than per keystroke: the server
 * clamps the number anyway, and one frame per 150 ms is plenty.
 */
import { el, mount } from '../ui.js';
import { wpm } from '../../../shared/games/typing.js';

const REPORT_MS = 150;

export function createView({ mount: root, onMove, sound }) {
  const passage = el('div.typing-passage');
  const bar = el('div.timer-bar', {}, el('div.timer-fill'));
  const track = el('div.typing-track');
  const input = el('textarea.textarea', {
    rows: '3',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: '여기에 지문을 그대로 입력하세요',
  });
  const stats = el('p.field-hint', { style: { textAlign: 'center' } });

  mount(root, el('div.typing-wrap', {}, [passage, bar, track, input, stats]));
  const fill = bar.querySelector('.timer-fill');

  let ctx = null;
  let lastReported = -1;
  let lastSent = 0;
  let errors = 0;

  /** Length of the longest prefix of `text` that matches the passage. */
  function correctPrefix(typed, target) {
    let i = 0;
    while (i < typed.length && i < target.length && typed[i] === target[i]) i++;
    return i;
  }

  function report(force = false) {
    if (!ctx || !ctx.interactive || ctx.seat === null) return;
    const typed = input.value;
    const chars = correctPrefix(typed, ctx.state.text);
    if (typed.length > chars) errors = Math.max(errors, typed.length - chars);
    const now = Date.now();
    if (!force && chars === lastReported) return;
    if (!force && now - lastSent < REPORT_MS) return;
    lastReported = chars;
    lastSent = now;
    onMove({ type: 'progress', chars, errors });
  }

  input.addEventListener('input', () => {
    paintPassage();
    report();
  });
  // Never lose the final characters to the throttle.
  const flush = setInterval(() => report(true), REPORT_MS * 2);

  function paintPassage() {
    if (!ctx) return;
    const target = ctx.state.text;
    const typed = ctx.seat === null ? '' : input.value;
    const ok = correctPrefix(typed, target);
    const bad = typed.length > ok ? 1 : 0;
    mount(passage, [
      el('span.done', { text: target.slice(0, ok) }),
      el('span.cursor', { text: target.slice(ok, ok + Math.max(1, bad)) }),
      el('span.rest', { text: target.slice(ok + Math.max(1, bad)) }),
    ]);
  }

  const timer = setInterval(() => {
    if (!ctx) return;
    if (ctx.status.phase === 'over') {
      fill.style.width = '0%';
      return;
    }
    const total = ctx.state.config.timeLimit;
    const ratio = Math.max(0, Math.min(1, (ctx.state.deadline - ctx.now()) / total));
    fill.style.width = `${ratio * 100}%`;
    fill.classList.toggle('urgent', ratio < 0.2);
    paintLanes();
  }, 140);

  function paintLanes() {
    if (!ctx) return;
    const total = ctx.state.text.length;
    mount(
      track,
      [0, 1].map((seat) => {
        const done = ctx.state.progress[seat];
        const pct = total ? (done / total) * 100 : 0;
        const finished = ctx.state.finished[seat];
        return el('div.typing-lane', { dataset: { seat } }, [
          el('span', {
            text: `${ctx.names[seat] || '-'}${seat === ctx.seat ? ' (나)' : ''}`,
            style: { minWidth: '5.5em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }),
          el('span.bar', {}, el('i', { style: { width: `${pct}%` } })),
          el('span', {
            text: finished !== null ? `${(finished / 1000).toFixed(1)}초` : `${wpm(ctx.state, seat, ctx.now())} WPM`,
            style: { minWidth: '4.5em', textAlign: 'right' },
          }),
        ]);
      }),
    );
  }

  return {
    render(next) {
      const first = !ctx;
      ctx = next;
      const active = ctx.interactive && ctx.status.phase === 'playing' && ctx.seat !== null;
      input.disabled = !active || ctx.state.finished[ctx.seat] !== null;
      input.style.display = ctx.seat === null ? 'none' : '';
      if (first) paintPassage();
      if (active && document.activeElement !== input && !input.disabled) input.focus();
      stats.textContent =
        ctx.seat === null
          ? '관전 중입니다.'
          : `오타 ${errors}회 · 지문 ${ctx.state.title} (${ctx.state.text.length}자)`;
      paintLanes();
    },

    events(list) {
      for (const event of list) {
        if (event.type === 'progress' && event.seat !== ctx?.seat) sound.tick();
      }
    },

    destroy() {
      clearInterval(timer);
      clearInterval(flush);
      mount(root, null);
    },
  };
}
