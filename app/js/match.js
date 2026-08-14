/**
 * The match surface: scoreboard, turn banner, board, result card.
 *
 * Online rooms and offline (AI / same-device) matches both render through this,
 * which is why a game only ever needs one view module. The host supplies state
 * and a way to submit a move; this file knows nothing about where either
 * came from.
 */
import { el, mount, clear } from './ui.js';
import { createGameView } from './games/index.js';
import { getGame } from '../../shared/games/index.js';

export function createMatchSurface({ container, gameId, onMove, sound, nowFn }) {
  const engine = getGame(gameId);
  if (!engine) throw new Error(`unknown game "${gameId}"`);

  const scoreboard = el('div.scoreboard');
  const banner = el('div.turn-banner');
  const stage = el('div.board-stage');
  const resultSlot = el('div');

  mount(container, [scoreboard, banner, stage, resultSlot]);

  const view = createGameView(gameId, { mount: stage, onMove, sound });
  let last = null;

  function paintScoreboard(ctx) {
    const { status, names, avatars, seat } = ctx;
    const active = status.turn;
    const scores = status.scores || [0, 0];
    // Games like 오목 and 커넥트4 have no running score, so their status always
    // reports 0:0. Showing that is worse than showing nothing.
    const scored = Boolean(scores[0]) || Boolean(scores[1]);

    const side = (index) =>
      el(
        `div.score-side${index === 1 ? '.right' : ''}${active === index ? '.active' : ''}`,
        { dataset: { seat: index } },
        [
          el('div.score-avatar', { text: avatars[index] || '👤' }),
          el('div.score-meta', {}, [
            el('strong', { text: `${names[index] || '빈 자리'}${seat === index ? ' (나)' : ''}` }),
            el('span', { text: seat === index ? '내 자리' : index === 0 ? '선공' : '후공' }),
          ]),
          scored ? el('div.score-value', { text: String(scores[index] ?? 0) }) : null,
        ],
      );

    mount(scoreboard, [
      side(0),
      el('div.score-center', {}, [
        el('div.vs', {}, 'VS'),
        el('div', { text: engine.meta.name }),
      ]),
      side(1),
    ]);
  }

  function paintBanner(ctx) {
    const { status, seat, interactive } = ctx;
    banner.className = 'turn-banner';

    if (status.phase === 'over') {
      banner.textContent = status.reason || '경기 종료';
      return;
    }
    if (status.phase === 'setup') {
      banner.textContent = status.reason || '준비 중';
      return;
    }
    if (engine.meta.mode !== 'turn') {
      // Simultaneous and race games have no turn to announce.
      banner.classList.add(interactive ? 'mine' : '');
      banner.textContent = status.reason || (interactive ? '동시 진행 중 — 지금 하세요!' : '진행 중');
      return;
    }
    if (seat === null) {
      banner.textContent = `${ctx.names[status.turn] || '-'} 님의 차례`;
      return;
    }
    if (status.turn === seat) {
      banner.classList.add('mine');
      banner.textContent = '내 차례입니다';
    } else {
      banner.classList.add('theirs');
      banner.textContent = `${ctx.names[status.turn] || '상대'} 님의 차례`;
    }
  }

  function paintResult(ctx) {
    const { result, seat } = ctx;
    if (!result) {
      clear(resultSlot);
      return;
    }
    const drew = result.winner === 'draw';
    const won = !drew && result.winner === seat;
    const tone = seat === null || drew ? '' : won ? 'win' : 'lose';
    const emoji = drew ? '🤝' : seat === null ? '🏁' : won ? '🎉' : '😢';
    const heading = drew
      ? '무승부'
      : seat === null
        ? `${ctx.names[result.winner] || '승자'} 승리`
        : won
          ? '승리!'
          : '패배';

    mount(
      resultSlot,
      el(`div.result-card${tone ? `.${tone}` : ''}`, {}, [
        el('div.result-emoji', { text: emoji }),
        el('h2', { text: heading }),
        result.detail ? el('p', { text: result.detail }) : null,
        result.reasonText && result.reason !== 'normal' ? el('p', { text: result.reasonText }) : null,
        ctx.actions ? el('div.btn-row', { style: { justifyContent: 'center', marginTop: '6px' } }, ctx.actions) : null,
      ]),
    );
  }

  return {
    /**
     * @param {object} ctx { state, status, seat, interactive, names, avatars,
     *                       result, actions }
     */
    update(ctx) {
      const full = { ...ctx, now: nowFn };
      last = full;
      paintScoreboard(full);
      paintBanner(full);
      if (full.state) view.render(full);
      paintResult(full);
    },

    /** Forward engine events so views can animate and play sounds. */
    events(list) {
      if (!list?.length || !view.events) return;
      view.events(list);
    },

    /** Nudge the view without new state — used by the local animation loop. */
    refresh() {
      if (last?.state) view.render(last);
    },

    destroy() {
      view.destroy?.();
      clear(container);
    },
  };
}
