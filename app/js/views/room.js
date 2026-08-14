/**
 * The online room: two seats, spectators, chat, and the live match.
 *
 * Everything drawn here comes from a server snapshot. The client never decides
 * whose turn it is or who won — it draws what it was told and sends intents
 * back.
 */
import { el, mount, formatTime, confirmDialog, toast } from '../ui.js';
import { store, subscribe, serverNow } from '../store.js';
import { api, isOnline } from '../net.js';
import { getGame } from '../../../shared/games/index.js';
import { sanitizeChat } from '../../../shared/protocol.js';
import { createMatchSurface } from '../match.js';
import { sound } from '../sound.js';
import { navigate } from '../router.js';

export function renderRoom(root) {
  if (!isOnline() || !store.room) {
    mount(
      root,
      el('div.empty', {}, [
        el('div.empty-emoji', {}, '🚪'),
        el('p', {}, '참여 중인 방이 없습니다.'),
        el('div.btn-row', { style: { marginTop: '8px', justifyContent: 'center' } }, [
          el('a.btn.primary', { href: '#/lobby' }, '로비로 가기'),
          el('a.btn', { href: '#/' }, '게임 목록'),
        ]),
      ]),
    );
    return subscribe('room', () => {
      if (store.room) navigate('#/room', { force: true });
    });
  }

  const arena = el('div');
  const controls = el('div.match-actions');
  const seatPanel = el('div.card.card-pad');
  const chatLog = el('div.chat-log');
  const head = el('div.match-head');

  const chatInput = el('input.input', { type: 'text', placeholder: '메시지…', maxlength: '300', autocomplete: 'off' });
  const chatForm = el(
    'form.chat-form',
    {
      onSubmit: (event) => {
        event.preventDefault();
        const text = sanitizeChat(chatInput.value);
        if (!text) return;
        api.chat(text, 'room');
        chatInput.value = '';
      },
    },
    [chatInput, el('button.btn.sm.primary', { type: 'submit' }, '전송')],
  );

  mount(root, [
    head,
    el('div.room-layout', {}, [
      arena,
      el('div.side-panel', {}, [
        seatPanel,
        el('div.card.chat', {}, [
          el('div.card-pad', { style: { paddingBottom: 0 } }, el('h2', { style: { fontSize: '15px' } }, '방 채팅')),
          chatLog,
          chatForm,
        ]),
      ]),
    ]),
  ]);

  let surface = null;
  let surfaceGameId = null;

  function ensureSurface(gameId) {
    if (surface && surfaceGameId === gameId) return;
    surface?.destroy();
    mount(arena, el('div'));
    surface = createMatchSurface({
      container: arena.firstChild,
      gameId,
      sound,
      nowFn: serverNow,
      onMove: (move) => api.move(move),
    });
    surfaceGameId = gameId;
  }

  function paintHead(room) {
    const meta = getGame(room.gameId)?.meta;
    mount(head, [
      el('div.match-title', {}, [
        el('div.game-emoji', { text: meta?.emoji || '🎲' }),
        el('div', {}, [
          el('h1', { text: room.name }),
          el('div.sub', {
            text: `${meta?.name || room.gameId}${room.code ? ` · 코드 ${room.code}` : ''}${
              room.role === 'spectator' ? ' · 관전 중' : ''
            }`,
          }),
        ]),
      ]),
      controls,
    ]);
  }

  function paintControls(room) {
    const isPlayer = room.seat === 0 || room.seat === 1;
    const ready = isPlayer ? room.ready[room.seat] : false;
    const buttons = [];

    if (isPlayer && room.phase !== 'playing') {
      const waiting = room.players.filter(Boolean).length < 2;
      buttons.push(
        el(
          `button.btn.sm${ready ? '' : '.primary'}`,
          {
            type: 'button',
            disabled: waiting,
            title: waiting ? '상대를 기다리는 중입니다' : '',
            onClick: () => {
              sound.unlock();
              api.ready(!ready);
            },
          },
          waiting ? '상대 대기 중…' : ready ? '준비 취소' : '준비 완료',
        ),
      );
    }

    if (isPlayer && room.phase === 'playing') {
      buttons.push(
        el(
          'button.btn.sm.danger',
          {
            type: 'button',
            onClick: async () => {
              const ok = await confirmDialog({
                title: '기권',
                message: '정말 기권하시겠습니까? 상대의 승리로 기록됩니다.',
                confirmText: '기권',
                danger: true,
              });
              if (ok) api.resign();
            },
          },
          '기권',
        ),
      );
    }

    if (isPlayer && room.phase === 'over') {
      buttons.push(
        el('button.btn.sm.primary', { type: 'button', onClick: () => api.rematch() },
          room.rematchVotes ? `재대결 (${room.rematchVotes}/2)` : '재대결'),
      );
    }

    if (room.code) {
      buttons.push(
        el(
          'button.btn.sm',
          {
            type: 'button',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(room.code);
                toast('코드를 복사했습니다.', 'good');
              } catch {
                toast(`방 코드: ${room.code}`);
              }
            },
          },
          '🔗 코드 복사',
        ),
      );
    }

    buttons.push(
      el(
        'button.btn.sm.ghost',
        {
          type: 'button',
          onClick: async () => {
            if (room.phase === 'playing' && room.seat !== null) {
              const ok = await confirmDialog({
                title: '방 나가기',
                message: '진행 중인 게임을 떠나면 패배로 기록됩니다. 나가시겠습니까?',
                confirmText: '나가기',
                danger: true,
              });
              if (!ok) return;
            }
            api.leaveRoom();
            navigate('#/lobby');
          },
        },
        '나가기',
      ),
    );

    mount(controls, buttons);
  }

  function paintSeats(room) {
    const rows = room.players.map((player, seat) => {
      const isMe = room.seat === seat;
      return el(
        'div.player-row',
        { style: { padding: '8px', borderRadius: '10px', background: 'var(--surface-2)', marginBottom: '6px' } },
        [
          el('span', { text: seat === 0 ? '①' : '②' }),
          el('span', {
            text: player ? `${player.name}${isMe ? ' (나)' : ''}` : '빈 자리',
            style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }),
          room.absent?.[seat]
            ? el('span.chip.warn', {}, '연결 끊김')
            : room.phase !== 'playing' && player
              ? el(`span.chip${room.ready[seat] ? '.good' : ''}`, {}, room.ready[seat] ? '준비 완료' : '대기 중')
              : null,
        ],
      );
    });

    mount(seatPanel, [
      el('h2', { style: { fontSize: '15px', marginBottom: '10px' } }, '자리'),
      ...rows,
      room.spectators.length
        ? el('div', { style: { marginTop: '10px' } }, [
            el('h2', { style: { fontSize: '13px', color: 'var(--text-faint)', marginBottom: '6px' } },
              `관전 ${room.spectators.length}명`),
            el('div.field-hint', { text: room.spectators.map((s) => s.name).join(', ') }),
          ])
        : null,
      room.tournamentId
        ? el('div', { style: { marginTop: '12px' } }, [
            el('span.chip.accent', {}, '🏆 대회 경기'),
            el('a.btn.sm.block', { href: '#/tournaments', style: { marginTop: '8px' } }, '대진표 보기'),
          ])
        : null,
    ]);
  }

  function paintChat() {
    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 60;
    mount(
      chatLog,
      (store.roomChat || []).map((msg) =>
        msg.system
          ? el('div.chat-msg.system', { text: msg.text })
          : el(`div.chat-msg${msg.from === store.me?.id ? '.me' : ''}`, {}, [
              el('span.who', { text: msg.name }),
              el('span', { text: msg.text }),
              el('span', {
                style: { color: 'var(--text-faint)', fontSize: '11px', marginLeft: '6px' },
                text: formatTime(msg.at),
              }),
            ]),
      ),
    );
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  }

  function paintRoom() {
    const room = store.room;
    if (!room) {
      surface?.destroy();
      surface = null;
      navigate('#/lobby');
      return;
    }

    paintHead(room);
    paintControls(room);
    paintSeats(room);

    if (!room.state) {
      surface?.destroy();
      surface = null;
      surfaceGameId = null;
      const meta = getGame(room.gameId)?.meta;
      mount(
        arena,
        el('div.empty', {}, [
          el('div.empty-emoji', { text: meta?.emoji || '🎲' }),
          el('p', {}, room.players.filter(Boolean).length < 2 ? '상대를 기다리는 중입니다.' : '두 사람 모두 준비하면 시작합니다.'),
          room.code ? el('p.field-hint', { text: `친구에게 코드 ${room.code} 를 알려 주세요.` }) : null,
          meta ? el('ol.rules-list', { style: { marginTop: '12px', textAlign: 'left', maxWidth: '46ch' } },
            meta.rules.map((rule) => el('li', { text: rule }))) : null,
        ]),
      );
      return;
    }

    ensureSurface(room.gameId);
    surface.update({
      state: room.state,
      status: room.status,
      seat: room.seat,
      interactive: room.seat !== null && room.phase === 'playing',
      names: room.players.map((p) => p?.name || '빈 자리'),
      avatars: ['🙂', '😎'],
      result: room.phase === 'over' ? room.result : null,
      actions:
        room.phase === 'over' && room.seat !== null
          ? [
              el('button.btn.primary', { type: 'button', onClick: () => api.rematch() }, '재대결 신청'),
              el('a.btn', { href: '#/lobby', onClick: () => api.leaveRoom() }, '로비로'),
            ]
          : null,
    });
  }

  paintRoom();
  paintChat();

  const unsubscribe = [
    subscribe('room', paintRoom),
    subscribe('roomChat', paintChat),
    subscribe('lastEvents', () => {
      const payload = store.lastEvents;
      if (!payload || payload.roomId !== store.room?.id) return;
      surface?.events(payload.events);
    }),
    subscribe('connection', () => {
      if (!isOnline()) navigate('#/room', { force: true });
    }),
  ];

  return () => {
    unsubscribe.forEach((fn) => fn());
    surface?.destroy();
  };
}
