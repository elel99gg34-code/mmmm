/**
 * The lobby — the "인터넷에서 만나는 공간".
 *
 * Everyone connected to the same server sees the same room list, the same
 * player list and the same chat. This is the page that turns fifteen games
 * into a place.
 */
import { el, mount, formatTime, toast } from '../ui.js';
import { store, subscribe } from '../store.js';
import { api, isOnline } from '../net.js';
import { catalogue, getGame } from '../../../shared/games/index.js';
import { navigate } from '../router.js';
import { openServerDialog } from './server.js';
import { sanitizeChat } from '../../../shared/protocol.js';

export function renderLobby(root) {
  if (!isOnline()) {
    mount(root, offlineNotice());
    return subscribe('connection', () => {
      if (isOnline()) navigate('#/lobby', { force: true });
    });
  }

  const roomList = el('div.room-list');
  const playerList = el('div.player-list');
  const chatLog = el('div.chat-log.tall');
  const queueBox = el('div');

  const chatInput = el('input.input', {
    type: 'text',
    placeholder: '로비에 인사해 보세요',
    maxlength: '300',
    autocomplete: 'off',
  });

  const chatForm = el(
    'form.chat-form',
    {
      onSubmit: (event) => {
        event.preventDefault();
        const text = sanitizeChat(chatInput.value);
        if (!text) return;
        api.chat(text, 'lobby');
        chatInput.value = '';
      },
    },
    [chatInput, el('button.btn.sm.primary', { type: 'submit' }, '전송')],
  );

  mount(root, [
    el('div.page-head', {}, [
      el('div', {}, [
        el('h1', {}, '로비'),
        el('p', {}, '방에 들어가거나, 새로 만들거나, 빠른 대전으로 아무나와 붙어 보세요.'),
      ]),
      el('div.btn-row', {}, [
        el('button.btn', { type: 'button', onClick: openJoinByCode }, '🔑 코드로 입장'),
        el('button.btn.primary', { type: 'button', onClick: openCreateRoom }, '＋ 방 만들기'),
      ]),
    ]),
    queueBox,
    el('div.lobby-grid', {}, [
      el('section', {}, [
        el('div.section', { style: { marginTop: 0 } }, [
          el('h2', {}, [document.createTextNode('열린 방'), el('span.count.js-room-count', {}, '0')]),
          roomList,
        ]),
      ]),
      el('div.side-panel', {}, [
        el('div.card', {}, [
          el('div.card-pad', { style: { paddingBottom: '4px' } }, el('h2', { style: { fontSize: '15px' } }, [
            document.createTextNode('접속 중'),
            el('span.count.js-online-count', { style: { marginLeft: '7px' } }, '0'),
          ])),
          el('div.card-pad', { style: { paddingTop: '6px' } }, playerList),
        ]),
        el('div.card.chat', {}, [
          el('div.card-pad', { style: { paddingBottom: 0 } }, el('h2', { style: { fontSize: '15px' } }, '로비 채팅')),
          chatLog,
          chatForm,
        ]),
      ]),
    ]),
  ]);

  function paintRooms() {
    const rooms = store.lobby.rooms || [];
    root.querySelector('.js-room-count').textContent = String(rooms.length);

    if (!rooms.length) {
      mount(
        roomList,
        el('div.empty', {}, [
          el('div.empty-emoji', {}, '🪑'),
          el('p', {}, '아직 열린 방이 없습니다.'),
          el('button.btn.sm.primary', { type: 'button', onClick: openCreateRoom }, '첫 방 만들기'),
        ]),
      );
      return;
    }

    mount(
      roomList,
      rooms.map((room) => {
        const meta = getGame(room.gameId)?.meta;
        const players = room.players.filter(Boolean);
        const full = players.length >= 2;
        const playing = room.phase === 'playing';
        return el('div.room-row', {}, [
          el('div.game-emoji', { text: meta?.emoji || '🎲' }),
          el('div.room-row-main', {}, [
            el('strong', { text: room.name }),
            el('span', {
              text: `${meta?.name || room.gameId} · ${players.map((p) => p.name).join(' vs ') || '대기 중'}`,
            }),
          ]),
          playing ? el('span.chip.warn', {}, '진행 중') : el('span.chip.good', {}, '대기 중'),
          el(
            'button.btn.sm',
            {
              type: 'button',
              onClick: () => {
                api.joinRoom(room.id, { spectate: full });
                navigate('#/room');
              },
            },
            full ? '관전' : '입장',
          ),
        ]);
      }),
    );
  }

  function paintPlayers() {
    const players = store.lobby.players || [];
    root.querySelector('.js-online-count').textContent = String(store.lobby.online || players.length);
    if (!players.length) {
      mount(playerList, el('p.field-hint', {}, '아무도 없습니다.'));
      return;
    }
    mount(
      playerList,
      players.map((player) =>
        el(`div.player-row${player.inRoom ? '.busy' : ''}`, {}, [
          el('span', { text: store.avatars[player.avatar] || '👤' }),
          el('span', {
            text: `${player.name}${player.id === store.me?.id ? ' (나)' : ''}`,
            style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }),
          el('span.dot'),
        ]),
      ),
    );
  }

  function paintChat() {
    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 60;
    mount(
      chatLog,
      (store.lobbyChat || []).map((msg) =>
        msg.system
          ? el('div.chat-msg.system', { text: msg.text })
          : el(`div.chat-msg${msg.from === store.me?.id ? '.me' : ''}`, {}, [
              el('span.who', { text: msg.name }),
              el('span', { text: msg.text }),
              el('span', { style: { color: 'var(--text-faint)', fontSize: '11px', marginLeft: '6px' }, text: formatTime(msg.at) }),
            ]),
      ),
    );
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  }

  function paintQueue() {
    if (!store.queue) {
      mount(queueBox, null);
      return;
    }
    const meta = getGame(store.queue.gameId)?.meta;
    mount(
      queueBox,
      el('div.card.card-pad', { style: { marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } }, [
        el('div.boot-spinner', { style: { width: '20px', height: '20px', borderWidth: '2px' } }),
        el('div', { style: { flex: '1' } }, [
          el('strong', { text: `${meta?.name || store.queue.gameId} 상대를 찾는 중…` }),
          el('div.field-hint', { text: `대기 인원 ${store.queue.waiting}명` }),
        ]),
        el('button.btn.sm', { type: 'button', onClick: () => api.queueLeave() }, '취소'),
      ]),
    );
  }

  function paintAll() {
    paintRooms();
    paintPlayers();
    paintQueue();
  }

  paintAll();
  paintChat();

  const unsubscribe = [
    subscribe(['lobby', 'queue'], paintAll),
    subscribe('lobbyChat', paintChat),
    subscribe('room', () => {
      // The server dropped us into a room (quick match, or a tournament).
      if (store.room) navigate('#/room');
    }),
    subscribe('connection', () => {
      if (!isOnline()) navigate('#/lobby', { force: true });
    }),
  ];

  return () => unsubscribe.forEach((fn) => fn());
}

function offlineNotice() {
  return el('div', {}, [
    el('div.page-head', {}, el('div', {}, [el('h1', {}, '로비'), el('p', {}, '다른 사람과 놀려면 서버 연결이 필요합니다.')])),
    el('div.empty', {}, [
      el('div.empty-emoji', {}, '🔌'),
      el('p', {}, '아직 서버에 연결되지 않았습니다.'),
      el('p.field-hint', {}, '서버가 없어도 모든 게임을 혼자 또는 한 기기에서 둘이 즐길 수 있습니다.'),
      el('div.btn-row', { style: { marginTop: '10px', justifyContent: 'center' } }, [
        el('button.btn.primary', { type: 'button', onClick: () => openServerDialog() }, '서버 연결하기'),
        el('a.btn', { href: '#/' }, '게임 목록으로'),
      ]),
    ]),
  ]);
}

/* ── Dialogs ──────────────────────────────────────────────────────────────── */

async function openCreateRoom() {
  const { modal } = await import('../ui.js');
  const games = store.games?.length ? store.games : catalogue();
  let gameId = games.find((g) => g.featured)?.id || games[0].id;

  const nameInput = el('input.input', { type: 'text', maxlength: '32', placeholder: `${store.me?.name || '나'}의 방` });
  const privateInput = el('input', { type: 'checkbox' });
  const select = el(
    'select.select',
    { onChange: (event) => { gameId = event.target.value; } },
    games.map((meta) => el('option', { value: meta.id, selected: meta.id === gameId }, `${meta.emoji} ${meta.name}`)),
  );

  const close = modal({
    title: '방 만들기',
    body: [
      el('div.field', {}, [el('label', {}, '게임'), select]),
      el('div.field', {}, [el('label', {}, '방 이름'), nameInput, el('span.field-hint', {}, '비워 두면 자동으로 정해집니다.')]),
      el('div.field', {}, [
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          privateInput,
          document.createTextNode('비공개 방 (목록에 표시하지 않고 코드로만 입장)'),
        ]),
      ]),
    ],
    actions: () => [
      el('button.btn', { type: 'button', onClick: () => close() }, '취소'),
      el(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            api.createRoom(gameId, { name: nameInput.value.trim() || undefined, isPrivate: privateInput.checked });
            close();
            navigate('#/room');
          },
        },
        '만들기',
      ),
    ],
  });
}

async function openJoinByCode() {
  const { modal } = await import('../ui.js');
  const input = el('input.input', {
    type: 'text',
    maxlength: '4',
    placeholder: 'ABCD',
    style: { textTransform: 'uppercase', letterSpacing: '0.3em', textAlign: 'center', fontSize: '22px' },
  });

  const close = modal({
    title: '코드로 입장',
    body: [el('div.field', {}, [el('label', {}, '방 코드'), input, el('span.field-hint', {}, '비공개 방의 방장에게 받은 4글자 코드를 입력하세요.')])],
    actions: () => [
      el('button.btn', { type: 'button', onClick: () => close() }, '취소'),
      el(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            const code = input.value.trim().toUpperCase();
            if (code.length !== 4) {
              toast('코드는 4글자입니다.', 'bad');
              return;
            }
            api.joinByCode(code);
            close();
            navigate('#/room');
          },
        },
        '입장',
      ),
    ],
  });
  input.focus();
}
