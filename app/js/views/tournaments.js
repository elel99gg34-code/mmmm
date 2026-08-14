/**
 * 대결 퀴즈 대회 — tournaments.
 *
 * Create a bracket for any game (Quiz Battle is the default), let people join
 * from the lobby, then start it: the server pairs everyone, opens a room per
 * match, and walks the winners up the bracket automatically.
 */
import { el, mount, modal, toast, confirmDialog } from '../ui.js';
import { store, subscribe } from '../store.js';
import { api, isOnline } from '../net.js';
import { catalogue, getGame } from '../../../shared/games/index.js';
import { navigate } from '../router.js';
import { openServerDialog } from './server.js';
import { LIMITS } from '../../../shared/protocol.js';

export function renderTournaments(root) {
  if (!isOnline()) {
    mount(root, [
      el('div.page-head', {}, el('div', {}, [
        el('h1', {}, '대회'),
        el('p', {}, '퀴즈 배틀을 비롯한 어떤 게임으로도 토너먼트를 열 수 있습니다.'),
      ])),
      el('div.empty', {}, [
        el('div.empty-emoji', {}, '🏆'),
        el('p', {}, '대회는 서버에 연결해야 열 수 있습니다.'),
        el('p.field-hint', {}, '4명·8명·16명 단판 토너먼트를 지원하며, 부전승과 중도 이탈도 자동으로 처리됩니다.'),
        el('div.btn-row', { style: { marginTop: '10px', justifyContent: 'center' } }, [
          el('button.btn.primary', { type: 'button', onClick: () => openServerDialog() }, '서버 연결하기'),
        ]),
      ]),
    ]);
    return subscribe('connection', () => {
      if (isOnline()) navigate('#/tournaments', { force: true });
    });
  }

  const body = el('div');
  mount(root, [
    el('div.page-head', {}, [
      el('div', {}, [el('h1', {}, '대회'), el('p', {}, '단판 승부 토너먼트. 우승할 때까지 계속됩니다.')]),
      el('div.btn-row', {}, [
        el('button.btn.primary', { type: 'button', onClick: openCreate }, '＋ 대회 열기'),
      ]),
    ]),
    body,
  ]);

  api.listTournaments();

  function paint() {
    mount(body, store.tournament ? tournamentDetail(store.tournament) : tournamentList());
  }

  paint();
  const unsubscribe = [
    subscribe(['tournament', 'tournamentList', 'lobby'], paint),
    subscribe('connection', () => {
      if (!isOnline()) navigate('#/tournaments', { force: true });
    }),
  ];
  return () => unsubscribe.forEach((fn) => fn());
}

/* ── List ─────────────────────────────────────────────────────────────────── */

function tournamentList() {
  const list = store.tournamentList?.length ? store.tournamentList : store.lobby.tournaments || [];
  if (!list.length) {
    return el('div.empty', {}, [
      el('div.empty-emoji', {}, '🏆'),
      el('p', {}, '지금 열려 있는 대회가 없습니다.'),
      el('p.field-hint', {}, '대회를 열면 로비의 모두가 참가할 수 있습니다.'),
      el('button.btn.sm.primary', { type: 'button', style: { marginTop: '8px' }, onClick: openCreate }, '대회 열기'),
    ]);
  }

  return el(
    'div.room-list',
    {},
    list.map((entry) => {
      const meta = getGame(entry.gameId)?.meta;
      const open = entry.status === 'lobby';
      return el('div.room-row', {}, [
        el('div.game-emoji', { text: meta?.emoji || '🏆' }),
        el('div.room-row-main', {}, [
          el('strong', { text: entry.name }),
          el('span', {
            text: `${meta?.name || entry.gameId} · ${entry.joined}/${entry.size}명${
              entry.roundLabel ? ` · ${entry.roundLabel} 진행 중` : ''
            }`,
          }),
        ]),
        entry.status === 'done'
          ? el('span.chip.good', { text: `🏆 ${entry.championName || '종료'}` })
          : open
            ? el('span.chip.good', {}, '모집 중')
            : el('span.chip.warn', {}, '진행 중'),
        open
          ? el('button.btn.sm.primary', { type: 'button', onClick: () => api.joinTournament(entry.id) }, '참가')
          : null,
      ]);
    }),
  );
}

/* ── Detail + bracket ─────────────────────────────────────────────────────── */

function tournamentDetail(tourney) {
  const meta = getGame(tourney.gameId)?.meta;
  const isHost = tourney.hostId === store.me?.id;
  const canStart = isHost && tourney.status === 'lobby' && tourney.players.length >= 2;

  const header = el('div.card.card-pad', { style: { marginBottom: '16px' } }, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } }, [
      el('div.game-emoji', { text: meta?.emoji || '🏆' }),
      el('div', { style: { flex: '1', minWidth: '160px' } }, [
        el('h2', { style: { fontSize: '17px' }, text: tourney.name }),
        el('div.field-hint', {
          text: `${meta?.name || tourney.gameId} · 정원 ${tourney.size}명 · 참가 ${tourney.players.length}명${
            tourney.status === 'running' ? ` · ${tourney.roundLabel}` : ''
          }`,
        }),
      ]),
      el('div.btn-row', {}, [
        canStart
          ? el('button.btn.primary', { type: 'button', onClick: () => api.startTournament() }, '대회 시작')
          : null,
        tourney.status === 'lobby' && isHost && tourney.players.length < 2
          ? el('span.chip.warn', {}, '2명 이상 필요')
          : null,
        el(
          'button.btn',
          {
            type: 'button',
            onClick: async () => {
              const running = tourney.status === 'running';
              const ok = await confirmDialog({
                title: '대회 나가기',
                message: running ? '진행 중에 나가면 기권 처리됩니다. 나가시겠습니까?' : '대회에서 나가시겠습니까?',
                confirmText: '나가기',
                danger: running,
              });
              if (ok) api.leaveTournament();
            },
          },
          '나가기',
        ),
      ]),
    ]),
  ]);

  const champion =
    tourney.status === 'done'
      ? el('div.champion-banner', {}, [
          el('div.crown', {}, '🏆'),
          el('strong', { text: tourney.championName || '우승자' }),
          el('p.field-hint', { text: `${tourney.name} 우승` }),
        ])
      : null;

  const roster = el('div.card.card-pad', {}, [
    el('h2', { style: { fontSize: '15px', marginBottom: '9px' } }, `참가자 ${tourney.players.length}명`),
    tourney.players.length
      ? el(
          'div.player-list',
          { style: { maxHeight: 'none' } },
          tourney.players.map((player) =>
            el('div.player-row', {}, [
              el('span', { text: store.avatars[player.avatar] || '👤' }),
              el('span', { text: `${player.name}${player.id === store.me?.id ? ' (나)' : ''}` }),
              player.id === tourney.hostId ? el('span.chip', {}, '개설자') : null,
            ]),
          ),
        )
      : el('p.field-hint', {}, '아직 참가자가 없습니다.'),
  ]);

  const bracket =
    tourney.status === 'lobby'
      ? el('div.empty', {}, [
          el('div.empty-emoji', {}, '⏳'),
          el('p', {}, '대진표는 대회가 시작되면 만들어집니다.'),
          el('p.field-hint', {}, '로비에서 다른 사람들이 참가할 수 있습니다.'),
        ])
      : el('div.card.card-pad', {}, [
          el('h2', { style: { fontSize: '15px', marginBottom: '11px' } }, '대진표'),
          el(
            'div.bracket',
            {},
            tourney.rounds.map((round, r) =>
              el('div.bracket-round', {}, [
                el('h4', { text: round[0]?.roundLabel || `${r + 1}라운드` }),
                ...round.map((match) =>
                  el(`div.bracket-match${match.roomId && !match.done ? '.live' : ''}`, {}, [
                    bracketSlot(match, 'a'),
                    bracketSlot(match, 'b'),
                  ]),
                ),
              ]),
            ),
          ),
        ]);

  return el('div', {}, [
    el('button.btn.sm.ghost', { type: 'button', style: { marginBottom: '10px' }, onClick: () => api.leaveTournament() },
      '← 다른 대회 보기'),
    champion,
    header,
    el('div.lobby-grid', {}, [bracket, el('div.side-panel', {}, roster)]),
  ]);
}

function bracketSlot(match, side) {
  const id = match[side];
  const name = match[`${side}Name`];
  const isWinner = match.done && match.winner === id;
  const isBye = !id;
  return el(`div.bracket-slot${isWinner ? '.winner' : ''}${isBye ? '.bye' : ''}`, {}, [
    el('span.nm', { text: isBye ? '부전승' : name || '미정' }),
    isWinner ? el('span', {}, '✓') : null,
  ]);
}

/* ── Create ───────────────────────────────────────────────────────────────── */

function openCreate() {
  const games = (store.games?.length ? store.games : catalogue()).filter((g) => g.mode !== 'race' || g.solo);
  let gameId = games.find((g) => g.featured)?.id || games[0].id;
  let size = 8;

  const nameInput = el('input.input', { type: 'text', maxlength: '32', placeholder: '퀴즈 배틀 대회' });
  const select = el(
    'select.select',
    { onChange: (event) => { gameId = event.target.value; } },
    games.map((meta) => el('option', { value: meta.id, selected: meta.id === gameId }, `${meta.emoji} ${meta.name}`)),
  );
  const sizes = el(
    'div.segmented',
    {},
    LIMITS.tournamentSizes.map((value) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(size === value),
          onClick: (event) => {
            size = value;
            [...sizes.children].forEach((btn) => btn.setAttribute('aria-pressed', String(btn === event.currentTarget)));
          },
        },
        `${value}명`,
      ),
    ),
  );

  const close = modal({
    title: '대회 열기',
    body: [
      el('div.field', {}, [el('label', {}, '종목'), select]),
      el('div.field', {}, [el('label', {}, '정원'), sizes, el('span.field-hint', {}, '정원보다 적게 모여도 시작할 수 있습니다. 남는 자리는 부전승입니다.')]),
      el('div.field', {}, [el('label', {}, '대회 이름'), nameInput]),
    ],
    actions: () => [
      el('button.btn', { type: 'button', onClick: () => close() }, '취소'),
      el(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            api.createTournament(gameId, { size, name: nameInput.value.trim() || undefined });
            close();
            toast('대회를 열었습니다. 참가자를 기다려 주세요!', 'good');
          },
        },
        '열기',
      ),
    ],
  });
}
