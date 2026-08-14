/**
 * The "just let me play" dialog.
 *
 * Two paths out of one button: pick a game and play it right now offline, or
 * queue for a stranger / open a room if a server is connected. Anything that
 * needs a server is visibly disabled rather than silently missing, so it is
 * obvious that online play needs one.
 */
import { el, modal, toast } from '../ui.js';
import { store } from '../store.js';
import { catalogue } from '../../../shared/games/index.js';
import { api, isOnline } from '../net.js';
import { navigate } from '../router.js';

export function openQuickPlay(preselectId = null) {
  const games = store.games?.length ? store.games : catalogue();
  let picked = preselectId || games.find((g) => g.featured)?.id || games[0].id;

  const close = modal({
    title: '바로 시작하기',
    wide: true,
    body: () => {
      const list = el('div.game-grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } });
      const paint = () => {
        list.replaceChildren(
          ...games.map((meta) =>
            el(
              `button.game-card${picked === meta.id ? '.featured' : ''}`,
              {
                type: 'button',
                style: { padding: '11px' },
                onClick: () => {
                  picked = meta.id;
                  paint();
                },
              },
              [
                el('div.game-card-top', {}, [
                  el('div.game-emoji', { style: { width: '32px', height: '32px', fontSize: '17px' }, text: meta.emoji }),
                  el('div', {}, el('h3', { style: { fontSize: '13.5px' }, text: meta.name })),
                ]),
              ],
            ),
          ),
        );
      };
      paint();

      return [
        el('p.field-hint', { style: { marginBottom: '10px' } }, '게임을 고르고, 아래에서 방식을 선택하세요.'),
        list,
      ];
    },
    actions: () => [
      el(
        'button.btn',
        {
          type: 'button',
          onClick: () => {
            close();
            navigate(`#/game/${picked}`);
          },
        },
        '🤖 혼자 / 둘이 (오프라인)',
      ),
      el(
        'button.btn',
        {
          type: 'button',
          disabled: !isOnline(),
          title: isOnline() ? '' : '서버에 연결해야 사용할 수 있습니다',
          onClick: () => {
            api.queueJoin(picked);
            close();
            navigate('#/lobby');
            toast('상대를 찾는 중입니다…', 'info');
          },
        },
        '⚡ 빠른 대전',
      ),
      el(
        'button.btn.primary',
        {
          type: 'button',
          disabled: !isOnline(),
          title: isOnline() ? '' : '서버에 연결해야 사용할 수 있습니다',
          onClick: () => {
            api.createRoom(picked, {});
            close();
            navigate('#/room');
          },
        },
        '🚪 방 만들기',
      ),
    ],
  });
}
