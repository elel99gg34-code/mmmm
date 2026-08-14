/**
 * Application bootstrap: theme, profile, routing, and the connection chip.
 *
 * Nothing here blocks on the network. The catalogue, the rules and every
 * offline mode come from modules bundled with the page, so the hub is fully
 * usable the moment it paints — connecting to a server only adds other people.
 */
import { el, mount, modal, toast } from './ui.js';
import { store, setState, subscribe } from './store.js';
import { route, startRouter, navigate, refresh } from './router.js';
import { connect, api, isOnline } from './net.js';
import { sound } from './sound.js';
import {
  loadProfile,
  saveProfile,
  loadTheme,
  saveTheme,
  resolveServer,
} from './config.js';
import { AVATARS, sanitizeName } from '../../shared/protocol.js';
import { catalogue } from '../../shared/games/index.js';

import { renderHub } from './views/hub.js';
import { renderPlay } from './views/play.js';
import { renderLobby } from './views/lobby.js';
import { renderRoom } from './views/room.js';
import { renderTournaments } from './views/tournaments.js';
import { renderHelp } from './views/help.js';
import { openServerDialog } from './views/server.js';

/* ── Theme ────────────────────────────────────────────────────────────────── */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f6fb' : '#0d1017');
  saveTheme(theme);
}

/* ── Profile ──────────────────────────────────────────────────────────────── */

let profile = loadProfile();

function paintProfileChip() {
  const button = document.getElementById('profile-btn');
  if (!button) return;
  const name = store.me?.name || profile.name || '손님';
  const avatar = AVATARS[store.me?.avatar ?? profile.avatar] || AVATARS[0];
  button.querySelector('.profile-avatar').textContent = avatar;
  button.querySelector('.profile-name').textContent = name;
}

function openProfileDialog() {
  let avatar = store.me?.avatar ?? profile.avatar;
  const nameInput = el('input.input', {
    type: 'text',
    maxlength: '16',
    value: store.me?.name || profile.name || '',
    placeholder: '이름을 입력하세요',
  });

  const grid = el('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '6px' },
  });
  const paintAvatars = () => {
    mount(
      grid,
      AVATARS.map((emoji, index) =>
        el(
          'button.btn',
          {
            type: 'button',
            style: {
              padding: '6px',
              fontSize: '18px',
              borderColor: index === avatar ? 'var(--accent)' : 'var(--line)',
              background: index === avatar ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--surface-2)',
            },
            onClick: () => {
              avatar = index;
              paintAvatars();
            },
          },
          emoji,
        ),
      ),
    );
  };
  paintAvatars();

  const soundToggle = el('input', { type: 'checkbox', checked: profile.sound });

  const close = modal({
    title: '프로필',
    body: [
      el('div.field', {}, [el('label', {}, '이름'), nameInput]),
      el('div.field', {}, [el('label', {}, '아바타'), grid]),
      el('div.field', {}, [
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          soundToggle,
          document.createTextNode('효과음 켜기'),
        ]),
      ]),
      el('div.divider'),
      el('div.field', {}, [
        el('label', {}, '서버'),
        el('p.field-hint', { style: { marginBottom: '8px' } },
          store.serverUrl ? store.serverUrl : '연결된 서버가 없습니다. 오프라인 모드로 즐기는 중입니다.'),
        el('button.btn.block', { type: 'button', onClick: () => { close(); openServerDialog(); } }, '서버 연결 설정'),
      ]),
    ],
    actions: () => [
      el('button.btn', { type: 'button', onClick: () => close() }, '취소'),
      el(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            const name = sanitizeName(nameInput.value) || '';
            profile = { name, avatar, sound: soundToggle.checked };
            saveProfile(profile);
            sound.setEnabled(profile.sound);
            if (isOnline() && name) api.setProfile(name, avatar);
            else paintProfileChip();
            toast('프로필을 저장했습니다.', 'good');
            close();
          },
        },
        '저장',
      ),
    ],
  });
  nameInput.focus();
}

/* ── Connection chip ──────────────────────────────────────────────────────── */

const CONN_LABELS = {
  offline: '오프라인',
  connecting: '연결 중…',
  online: '온라인',
  error: '연결 실패',
};

function paintConnection() {
  const chip = document.getElementById('conn-chip');
  if (!chip) return;
  chip.dataset.state = store.connection;
  chip.querySelector('.conn-text').textContent =
    store.connection === 'online' ? `온라인 · ${store.lobby.online || 1}명` : CONN_LABELS[store.connection];
  chip.title = store.serverError || store.serverUrl || '서버에 연결하면 다른 사람과 대결할 수 있습니다.';
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */

function boot() {
  applyTheme(loadTheme());
  sound.setEnabled(profile.sound);

  // The catalogue ships with the page; the server only ever confirms it.
  setState({ games: catalogue(), avatars: AVATARS });

  document.getElementById('theme-btn')?.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });
  document.getElementById('profile-btn')?.addEventListener('click', openProfileDialog);
  document.getElementById('conn-chip')?.addEventListener('click', openServerDialog);

  // Browsers need a gesture before they will let us make any sound.
  const unlock = () => sound.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  route('/', renderHub, 'hub');
  route('/game/:id', renderPlay, 'hub');
  route('/lobby', renderLobby, 'lobby');
  route('/room', renderRoom, 'lobby');
  route('/tournaments', renderTournaments, 'tournaments');
  route('/help', renderHelp, 'help');

  subscribe(['connection', 'lobby', 'serverUrl', 'serverError'], paintConnection);
  subscribe('me', paintProfileChip);
  subscribe('connection', (state, changed) => {
    if (!changed.includes('connection')) return;
    // Pages that look different online than offline re-render on change.
    const path = location.hash.replace(/^#/, '');
    if (path.startsWith('/lobby') || path.startsWith('/room') || path.startsWith('/tournaments')) refresh();
  });

  paintConnection();
  paintProfileChip();
  startRouter(document.getElementById('main'));

  // Try to find a server in the background; the app is already usable.
  resolveServer().then(({ url, source }) => {
    if (!url) return;
    setState({ serverUrl: url });
    if (source === 'url' || source === 'saved' || source === 'default' || source === 'same-origin') connect(url);
  });

  // A room invite in the URL: #/room?code=ABCD
  const hash = location.hash;
  if (hash.includes('code=')) {
    const code = new URLSearchParams(hash.split('?')[1] || '').get('code');
    if (code) {
      const stop = subscribe('connection', () => {
        if (!isOnline()) return;
        api.joinByCode(code.toUpperCase());
        navigate('#/room');
        stop();
      });
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
