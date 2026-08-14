/**
 * 반응속도 결투 view.
 *
 * The pad turns green at `state.goAt` measured on the *server* clock, which
 * both clients have synced against. The reaction is measured locally from the
 * frame that painted green, and the server clamps it into a plausible window.
 * Latency therefore shifts when both players see green, not who wins.
 */
import { el, mount } from '../ui.js';
import { FALSE_START } from '../../../shared/games/reaction.js';

export function createView({ mount: root, onMove, sound }) {
  const pad = el('div.reaction-pad', { role: 'button', tabindex: '0', dataset: { phase: 'waiting' } });
  const rounds = el('div.reaction-rounds');
  mount(root, el('div', { style: { width: '100%', maxWidth: '620px' } }, [pad, rounds]));

  let ctx = null;
  let greenAt = null; // performance.now() of the frame that painted green
  let pressedRound = -1;
  let wentGreen = false;

  function press() {
    if (!ctx || !ctx.interactive || ctx.seat === null) return;
    if (ctx.state.phase === 'over' || ctx.state.phase === 'result') return;
    if (pressedRound === ctx.state.round) return;
    pressedRound = ctx.state.round;

    const rt = greenAt === null ? 0 : Math.round(performance.now() - greenAt);
    sound.click();
    onMove({ type: 'react', rt });
  }

  pad.addEventListener('pointerdown', press);
  pad.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      press();
    }
  });

  const timer = setInterval(paint, 40);

  function paint() {
    if (!ctx) return;
    const { state, seat } = ctx;
    const mine = seat === null ? null : state.current[seat];
    const isGo = state.phase === 'go' || (state.phase === 'waiting' && ctx.now() >= state.goAt);

    if (state.phase === 'over') {
      pad.dataset.phase = 'result';
      mount(pad, [el('span', {}, '경기 종료'), el('small', { text: `${state.wins[0]} : ${state.wins[1]}` })]);
    } else if (state.phase === 'result') {
      pad.dataset.phase = 'result';
      const [a, b] = state.times[state.times.length - 1] || [null, null];
      mount(pad, [
        el('span', {}, `${state.round + 1}라운드 결과`),
        el('small', { text: `${label(a, ctx.names[0])} · ${label(b, ctx.names[1])}` }),
      ]);
      wentGreen = false;
      greenAt = null;
    } else if (isGo) {
      if (!wentGreen) {
        wentGreen = true;
        greenAt = performance.now();
        sound.go();
      }
      pad.dataset.phase = 'go';
      mount(pad, [
        el('span', {}, mine === null ? '지금!' : '기다리는 중…'),
        el('small', { text: mine === null ? '눌러 주세요' : `${mine}ms` }),
      ]);
    } else {
      pad.dataset.phase = 'waiting';
      wentGreen = false;
      mount(pad, [
        el('span', {}, mine === FALSE_START ? '부정 출발!' : '준비…'),
        el('small', {
          text:
            mine === FALSE_START
              ? '초록이 될 때까지 기다려야 합니다'
              : '초록으로 바뀌면 즉시 누르세요',
        }),
      ]);
    }

    mount(
      rounds,
      state.times.map((pair, i) => {
        const [a, b] = pair;
        const winner = score(a) < score(b) ? 0 : score(b) < score(a) ? 1 : null;
        return el(`div.reaction-round${winner === null ? '' : `.win-${winner}`}`, {
          text: `${i + 1}R ${short(a)} : ${short(b)}`,
        });
      }),
    );
  }

  const score = (v) => (v === null ? Infinity : v === FALSE_START ? Infinity - 1 : v);
  const short = (v) => (v === null ? '–' : v === FALSE_START ? 'F' : `${v}`);
  const label = (v, name) =>
    `${name || '-'} ${v === null ? '미입력' : v === FALSE_START ? '부정 출발' : `${v}ms`}`;

  return {
    render(next) {
      const prevRound = ctx?.state.round;
      ctx = next;
      if (prevRound !== undefined && prevRound !== ctx.state.round) {
        pressedRound = -1;
        greenAt = null;
        wentGreen = false;
      }
      paint();
    },

    destroy() {
      clearInterval(timer);
      mount(root, null);
    },
  };
}
