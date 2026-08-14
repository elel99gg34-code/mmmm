/**
 * 퀴즈 배틀 view — the hub's headline game and the one tournaments run on.
 *
 * Both players answer the same question at the same time, so there is no turn
 * indicator: there is a clock, four buttons, and the knowledge that the other
 * person is looking at exactly this. The countdown runs on its own interval
 * against the server-synced clock rather than waiting for state pushes.
 */
import { el, mount } from '../ui.js';
import { BASE_POINTS } from '../../../shared/games/quiz.js';

const LETTERS = ['A', 'B', 'C', 'D'];

export function createView({ mount: root, onMove, sound }) {
  const meta = el('div.quiz-meta');
  const bar = el('div.timer-bar', {}, el('div.timer-fill'));
  const question = el('h3.quiz-question');
  const options = el('div.quiz-options');
  const feedback = el('p.quiz-feedback');
  const tally = el('div.quiz-tally');

  mount(root, el('div.quiz-wrap', {}, [meta, bar, question, options, feedback, tally]));
  const fill = bar.querySelector('.timer-fill');

  const buttons = LETTERS.map((letter, i) =>
    el('button.quiz-option', { type: 'button', onClick: () => choose(i) }, [
      el('span.idx', { text: letter }),
      el('span.label'),
    ]),
  );
  mount(options, buttons);

  let ctx = null;
  let lastQi = -1;
  let lastPhase = '';
  let announced = -1;

  function choose(index) {
    if (!ctx || ctx.state.phase !== 'question' || !ctx.interactive) return;
    if (ctx.seat === null) return;
    if (ctx.state.answers[ctx.state.qi]?.[ctx.seat]) return;
    sound.click();
    onMove({ type: 'answer', qi: ctx.state.qi, choice: index });
  }

  const timer = setInterval(paintClock, 90);

  function paintClock() {
    if (!ctx || ctx.state.phase === 'over') {
      fill.style.width = '0%';
      return;
    }
    const total = ctx.state.phase === 'question' ? ctx.state.config.perQuestion : ctx.state.config.revealMs;
    const remaining = ctx.state.phaseEndsAt - ctx.now();
    const ratio = Math.max(0, Math.min(1, remaining / total));
    fill.style.width = `${ratio * 100}%`;
    fill.classList.toggle('urgent', ctx.state.phase === 'question' && ratio < 0.25);
    if (ctx.state.phase === 'question') {
      const seconds = Math.max(0, Math.ceil(remaining / 1000));
      meta.lastChild.textContent = `${seconds}초`;
    }
  }

  function paint() {
    const { state, seat } = ctx;
    const q = state.questions[state.qi];
    const mine = seat === null ? null : state.answers[state.qi]?.[seat];
    const theirs = seat === null ? null : state.answers[state.qi]?.[seat === 0 ? 1 : 0];
    const revealing = state.phase === 'reveal' || state.phase === 'over';

    mount(meta, [
      el('span', { text: `문제 ${Math.min(state.qi + 1, state.questions.length)} / ${state.questions.length}` }),
      el('span.chip', { text: q?.cat || '' }),
      el('span', { text: '' }),
    ]);

    question.textContent = q?.q || '';

    buttons.forEach((btn, i) => {
      btn.querySelector('.label').textContent = q?.a?.[i] ?? '';
      const classes = ['quiz-option'];
      if (mine && mine.choice === i) classes.push('picked');
      if (revealing && q && q.c === i) classes.push('correct');
      if (revealing && mine && mine.choice === i && q && q.c !== i) classes.push('wrong');
      btn.className = classes.join(' ');
      btn.disabled = state.phase !== 'question' || Boolean(mine) || !ctx.interactive || seat === null;
    });

    if (state.phase === 'question') {
      if (mine) feedback.textContent = theirs ? '두 사람 다 제출했습니다…' : '제출 완료! 상대를 기다리는 중…';
      else feedback.textContent = theirs ? '상대가 먼저 제출했습니다. 서두르세요!' : '';
      feedback.style.color = 'var(--text-dim)';
    } else if (revealing && mine) {
      if (mine.choice === null) {
        feedback.textContent = '시간 초과';
        feedback.style.color = 'var(--bad)';
      } else if (mine.correct) {
        const speed = mine.points - BASE_POINTS;
        feedback.textContent = `정답! +${mine.points}점${speed > 0 ? ` (스피드 +${speed})` : ''}`;
        feedback.style.color = 'var(--good)';
      } else {
        feedback.textContent = '오답';
        feedback.style.color = 'var(--bad)';
      }
    } else {
      feedback.textContent = '';
    }

    mount(
      tally,
      state.answers.map((row, i) => {
        if (i > state.qi || (i === state.qi && !revealing)) return el('span.quiz-pip');
        const answer = seat === null ? null : row[seat];
        if (!answer || answer.locked) return el('span.quiz-pip');
        return el(`span.quiz-pip.${answer.correct ? 'hit' : 'miss'}`);
      }),
    );

    paintClock();
  }

  return {
    render(next) {
      ctx = next;
      const { state } = ctx;
      if (state.qi !== lastQi) {
        lastQi = state.qi;
        announced = -1;
      }
      // Play the verdict once per question, when the reveal begins.
      if (state.phase !== lastPhase) {
        lastPhase = state.phase;
        if (state.phase === 'reveal' && ctx.seat !== null && announced !== state.qi) {
          announced = state.qi;
          const mine = state.answers[state.qi]?.[ctx.seat];
          if (mine) sound[mine.correct ? 'correct' : 'wrong']();
        }
      }
      paint();
    },

    destroy() {
      clearInterval(timer);
      mount(root, null);
    },
  };
}
