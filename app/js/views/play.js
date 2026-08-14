/**
 * A single game's page: rules, offline play, and the ways into online play.
 *
 * This is where the hub earns its keep on a static host — everything here
 * works with no server at all, and the online buttons light up the moment one
 * is connected.
 */
import { el, mount, confirmDialog, toast } from '../ui.js';
import { store } from '../store.js';
import { getGame } from '../../../shared/games/index.js';
import { LocalMatch, localModes, MODE_LABELS, LEVEL_LABELS } from '../local.js';
import { createMatchSurface } from '../match.js';
import { sound } from '../sound.js';
import { api, isOnline } from '../net.js';
import { navigate } from '../router.js';

export function renderPlay(root, params) {
  const engine = getGame(params.id);
  if (!engine) {
    mount(root, el('div.empty', {}, [el('div.empty-emoji', {}, '❓'), el('p', {}, '그런 게임은 없습니다.')]));
    return () => {};
  }

  const meta = engine.meta;
  const modes = localModes(meta);
  let mode = modes[0];
  let level = 2;
  let match = null;
  let surface = null;

  const arena = el('div');
  const setupPanel = el('div.card.card-pad');
  const rulesPanel = el('aside.card.card-pad', {}, [
    el('h2', { style: { fontSize: '15px', marginBottom: '9px' } }, '규칙'),
    el('ol.rules-list', {}, meta.rules.map((rule) => el('li', { text: rule }))),
  ]);

  function paintSetup() {
    mount(setupPanel, [
      el('h2', { style: { fontSize: '15px', marginBottom: '10px' } }, '오프라인으로 즐기기'),
      modes.length > 1
        ? el('div.field', {}, [
            el('label', {}, '방식'),
            el(
              'div.segmented',
              {},
              modes.map((value) =>
                el(
                  'button',
                  {
                    type: 'button',
                    'aria-pressed': String(mode === value),
                    onClick: () => {
                      mode = value;
                      paintSetup();
                    },
                  },
                  MODE_LABELS[value],
                ),
              ),
            ),
          ])
        : el('p.field-hint', { style: { marginBottom: '11px' } }, MODE_LABELS[modes[0]]),

      mode === 'ai'
        ? el('div.field', {}, [
            el('label', {}, '난이도'),
            el(
              'div.segmented',
              {},
              [1, 2, 3].map((value) =>
                el(
                  'button',
                  {
                    type: 'button',
                    'aria-pressed': String(level === value),
                    onClick: () => {
                      level = value;
                      paintSetup();
                    },
                  },
                  LEVEL_LABELS[value],
                ),
              ),
            ),
          ])
        : null,

      el('button.btn.primary.block', { type: 'button', onClick: startLocal }, match ? '다시 시작' : '시작하기'),

      el('div.divider'),
      el('h2', { style: { fontSize: '15px', marginBottom: '9px' } }, '온라인으로 대결'),
      el('p.field-hint', { style: { marginBottom: '10px' } },
        isOnline()
          ? '방을 만들어 친구를 초대하거나, 아무나와 바로 붙어 보세요.'
          : '서버에 연결하면 다른 사람과 대결할 수 있습니다. 오른쪽 위 연결 버튼을 눌러 주세요.'),
      el('div.btn-row', {}, [
        el(
          'button.btn',
          {
            type: 'button',
            disabled: !isOnline(),
            onClick: () => {
              api.queueJoin(meta.id);
              navigate('#/lobby');
              toast('상대를 찾는 중입니다…');
            },
          },
          '⚡ 빠른 대전',
        ),
        el(
          'button.btn',
          {
            type: 'button',
            disabled: !isOnline(),
            onClick: () => {
              api.createRoom(meta.id, {});
              navigate('#/room');
            },
          },
          '🚪 방 만들기',
        ),
      ]),
    ]);
  }

  function startLocal() {
    sound.unlock();
    teardown();

    match = new LocalMatch({
      gameId: meta.id,
      mode,
      level,
      onUpdate: (snapshot) => {
        surface?.update({ ...snapshot, actions: snapshot.result ? resultActions() : null });
      },
      onEvents: (events) => surface?.events(events),
    });

    mount(arena, el('div'));
    surface = createMatchSurface({
      container: arena.firstChild,
      gameId: meta.id,
      sound,
      nowFn: () => Date.now(),
      onMove: (move) => {
        const res = match.move(move);
        if (!res.ok && res.error) toast(res.error, 'bad');
      },
    });

    match.start();
    sound.start();
    paintSetup();
    paintActions();
  }

  function resultActions() {
    return [
      el('button.btn.primary', { type: 'button', onClick: startLocal }, '한 판 더'),
      el('a.btn', { href: '#/' }, '다른 게임'),
    ];
  }

  const actionBar = el('div.match-actions');

  function paintActions() {
    mount(
      actionBar,
      match && !match.result
        ? [
            el(
              'button.btn.sm.danger',
              {
                type: 'button',
                onClick: async () => {
                  if (await confirmDialog({ title: '기권', message: '정말 기권하시겠습니까?', confirmText: '기권', danger: true })) {
                    match.resign();
                  }
                },
              },
              '기권',
            ),
            el('button.btn.sm', { type: 'button', onClick: startLocal }, '새 게임'),
          ]
        : [],
    );
  }

  function teardown() {
    match?.destroy();
    surface?.destroy();
    match = null;
    surface = null;
    paintActions();
  }

  mount(root, [
    el('div.match-head', {}, [
      el('div.match-title', {}, [
        el('div.game-emoji', { text: meta.emoji }),
        el('div', {}, [
          el('h1', { text: meta.name }),
          el('div.sub', { text: `${meta.nameEn} · ${meta.category}` }),
        ]),
      ]),
      actionBar,
    ]),
    el('p', { style: { color: 'var(--text-dim)', marginBottom: '18px', maxWidth: '62ch' }, text: meta.desc }),
    el('div.lobby-grid', {}, [arena, el('div.side-panel', {}, [setupPanel, rulesPanel])]),
  ]);

  mount(
    arena,
    el('div.empty', {}, [
      el('div.empty-emoji', { text: meta.emoji }),
      el('p', {}, '오른쪽에서 방식을 고르고 시작하세요.'),
    ]),
  );
  paintSetup();

  return teardown;
}
