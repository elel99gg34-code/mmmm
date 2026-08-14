/**
 * 끝말잇기 view.
 *
 * The prompt shows every syllable the next word may start with, including the
 * 두음법칙 alternative, so nobody has to guess whether the rule is honoured
 * here. Client-side validation gives instant feedback; the server validates
 * again and has the final word.
 */
import { el, mount } from '../ui.js';
import { checkWord, nextStarts } from '../../../shared/games/wordchain.js';

export function createView({ mount: root, onMove, sound }) {
  const chain = el('div.wc-chain');
  const prompt = el('p.wc-prompt');
  const bar = el('div.timer-bar', {}, el('div.timer-fill'));
  const input = el('input.input', {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: '낱말을 입력하세요',
    maxlength: '12',
  });
  const hint = el('p.field-hint', { style: { textAlign: 'center', minHeight: '1.3em' } });

  const form = el(
    'form.wc-form',
    {
      onSubmit: (event) => {
        event.preventDefault();
        submit();
      },
    },
    [input, el('button.btn.primary', { type: 'submit' }, '제출')],
  );

  mount(root, el('div.wc-wrap', {}, [chain, prompt, bar, form, hint]));
  const fill = bar.querySelector('.timer-fill');

  let ctx = null;
  let lastLength = -1;

  input.addEventListener('input', () => {
    if (!ctx || !ctx.interactive) return;
    const value = input.value.trim();
    if (!value) {
      hint.textContent = '';
      hint.style.color = '';
      return;
    }
    const problem = checkWord(ctx.state, value);
    hint.textContent = problem || '좋습니다! 엔터를 누르세요.';
    hint.style.color = problem ? 'var(--bad)' : 'var(--good)';
  });

  function submit() {
    if (!ctx || !ctx.interactive || ctx.status.turn !== ctx.seat) return;
    const word = input.value.trim();
    if (!word) return;
    const problem = checkWord(ctx.state, word);
    if (problem) {
      hint.textContent = problem;
      hint.style.color = 'var(--bad)';
      sound.wrong();
      return;
    }
    input.value = '';
    hint.textContent = '';
    onMove({ type: 'word', word });
  }

  const timer = setInterval(() => {
    if (!ctx || ctx.status.phase === 'over') {
      fill.style.width = '0%';
      return;
    }
    const total = ctx.state.config.turnMs;
    const remaining = ctx.state.deadline - ctx.now();
    const ratio = Math.max(0, Math.min(1, remaining / total));
    fill.style.width = `${ratio * 100}%`;
    fill.classList.toggle('urgent', ratio < 0.3);
  }, 90);

  return {
    render(next) {
      ctx = next;
      const { state, status } = ctx;

      if (state.chain.length !== lastLength) {
        lastLength = state.chain.length;
        mount(
          chain,
          state.chain.map((entry, i) =>
            el(
              `span.wc-word${entry.seat === null ? '' : `.p${entry.seat}`}${
                i === state.chain.length - 1 ? '.latest' : ''
              }`,
              { text: entry.word },
            ),
          ),
        );
        chain.scrollTop = chain.scrollHeight;
      }

      const starts = nextStarts(state);
      const mine = ctx.interactive && status.turn === ctx.seat && status.phase === 'playing';
      mount(prompt, [
        document.createTextNode(mine ? '이 글자로 시작하는 낱말을 입력하세요' : '상대가 답할 차례입니다'),
        el('b', { text: starts.join(' 또는 ') }),
      ]);

      input.disabled = !mine;
      form.querySelector('button').disabled = !mine;
      if (mine && document.activeElement !== input) input.focus();
      if (!mine) {
        input.value = '';
        hint.textContent = '';
      }
    },

    events(list) {
      if (list.some((e) => e.type === 'word')) sound.select();
    },

    destroy() {
      clearInterval(timer);
      mount(root, null);
    },
  };
}
