/**
 * Sign in, sign up, and the account card.
 *
 * Accounts are optional on purpose. Everything in the hub works as a guest;
 * signing in buys you a name nobody else can wear, stats that survive closing
 * the tab, and a place on the leaderboard. The dialog says so, because a login
 * wall in front of a game is a good way to lose the player.
 */
import { el, mount, modal, toast, confirmDialog, formatAgo } from '../ui.js';
import { store, subscribe } from '../store.js';
import { api, isOnline } from '../net.js';
import { checkUsername, checkPassword, AVATARS } from '../../../shared/protocol.js';
import { openServerDialog } from './server.js';

/* ── Sign in / sign up ────────────────────────────────────────────────────── */

/** @param {'login'|'register'} startOn */
export function openAuthDialog(startOn = 'login') {
  if (!isOnline()) {
    openServerDialog();
    return;
  }
  if (!store.accountsEnabled) {
    toast('이 서버는 계정 기능을 사용하지 않습니다. 손님으로 즐기실 수 있습니다.', 'info');
    return;
  }

  let mode = startOn;
  const problem = el('p.field-hint', { style: { minHeight: '1.3em' } });

  const username = el('input.input', {
    type: 'text',
    autocomplete: 'username',
    maxlength: '16',
    placeholder: '한글·영문·숫자',
  });
  const password = el('input.input', {
    type: 'password',
    autocomplete: 'current-password',
    placeholder: '6자 이상',
  });
  const confirm = el('input.input', { type: 'password', autocomplete: 'new-password', placeholder: '한 번 더' });
  const confirmField = el('div.field', {}, [el('label', {}, '비밀번호 확인'), confirm]);

  const title = el('h2', { style: { fontSize: '16px', marginBottom: '4px' } });
  const blurb = el('p.field-hint', { style: { marginBottom: '14px' } });
  const submitBtn = el('button.btn.primary', { type: 'submit' });
  const switchBtn = el('button.btn.ghost.sm', { type: 'button' });

  function paintMode() {
    const registering = mode === 'register';
    title.textContent = registering ? '회원가입' : '로그인';
    blurb.textContent = registering
      ? '아이디를 등록하면 그 이름은 나만 쓸 수 있고, 전적과 순위가 계속 쌓입니다.'
      : '가입한 아이디로 로그인하면 전적과 순위를 이어서 볼 수 있습니다.';
    confirmField.style.display = registering ? '' : 'none';
    password.autocomplete = registering ? 'new-password' : 'current-password';
    submitBtn.textContent = registering ? '가입하고 시작' : '로그인';
    switchBtn.textContent = registering ? '이미 계정이 있어요 → 로그인' : '계정이 없어요 → 회원가입';
    problem.textContent = '';
    problem.style.color = '';
  }

  switchBtn.addEventListener('click', () => {
    mode = mode === 'register' ? 'login' : 'register';
    paintMode();
    username.focus();
  });

  function fail(message) {
    problem.textContent = message;
    problem.style.color = 'var(--bad)';
  }

  function submit(event) {
    event.preventDefault();
    const name = username.value.trim();
    const pass = password.value;

    const nameProblem = checkUsername(name);
    if (nameProblem) return fail(nameProblem);
    const passProblem = checkPassword(pass);
    if (passProblem) return fail(passProblem);
    if (mode === 'register' && pass !== confirm.value) return fail('비밀번호가 서로 다릅니다.');

    problem.textContent = '잠시만요…';
    problem.style.color = 'var(--text-faint)';
    submitBtn.disabled = true;
    if (mode === 'register') api.register(name, pass);
    else api.login(name, pass);
  }

  const form = el('form', { onSubmit: submit }, [
    title,
    blurb,
    el('div.field', {}, [el('label', {}, '아이디'), username]),
    el('div.field', {}, [el('label', {}, '비밀번호'), password]),
    confirmField,
    problem,
    el('div.btn-row', { style: { marginTop: '6px' } }, [submitBtn, switchBtn]),
    el('div.divider'),
    el(
      'p.field-hint',
      {},
      '계정 없이도 모든 게임을 즐길 수 있습니다. 로그인은 이름을 지키고 전적을 남기기 위한 것입니다.',
    ),
  ]);

  const close = modal({
    title: '계정',
    body: form,
    onClose: () => stop(),
  });

  // The server answers asynchronously; close on success, show the reason on failure.
  const stop = subscribe(['user', 'authError'], () => {
    if (store.user) {
      stop();
      close();
      toast(`${store.user.username} 님, 반갑습니다!`, 'good');
      return;
    }
    if (store.authError) {
      submitBtn.disabled = false;
      fail(store.authError);
    }
  });

  paintMode();
  username.focus();
}

/* ── Account card (used inside the profile dialog) ────────────────────────── */

/** The signed-in summary, or a prompt to sign in. */
export function accountCard() {
  if (!isOnline() || !store.accountsEnabled) {
    return el('div.field', {}, [
      el('label', {}, '계정'),
      el(
        'p.field-hint',
        {},
        isOnline()
          ? '이 서버는 계정 기능을 사용하지 않습니다.'
          : '서버에 연결하면 계정을 만들어 전적을 남길 수 있습니다.',
      ),
    ]);
  }

  if (!store.user) {
    return el('div.field', {}, [
      el('label', {}, '계정'),
      el('p.field-hint', { style: { marginBottom: '8px' } }, '지금은 손님으로 놀고 있습니다.'),
      el('div.btn-row', {}, [
        el('button.btn.primary', { type: 'button', onClick: () => openAuthDialog('login') }, '로그인'),
        el('button.btn', { type: 'button', onClick: () => openAuthDialog('register') }, '회원가입'),
      ]),
    ]);
  }

  const stats = store.user.stats || { games: 0, wins: 0, losses: 0, draws: 0 };
  return el('div.field', {}, [
    el('label', {}, '계정'),
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' } }, [
      el('div.score-avatar', { text: AVATARS[store.user.avatar] || '👤' }),
      el('div', { style: { flex: '1', minWidth: 0 } }, [
        el('strong', { text: store.user.username }),
        el('div.field-hint', { text: `가입 ${formatAgo(store.user.createdAt)} · ${stats.games}판` }),
      ]),
    ]),
    statRow(stats),
    el('div.btn-row', { style: { marginTop: '10px' } }, [
      el('button.btn.sm', { type: 'button', onClick: openPasswordDialog }, '비밀번호 변경'),
      el(
        'button.btn.sm.danger',
        {
          type: 'button',
          onClick: async () => {
            const ok = await confirmDialog({
              title: '로그아웃',
              message: '로그아웃하면 손님으로 돌아갑니다. 전적은 계정에 그대로 남습니다.',
              confirmText: '로그아웃',
            });
            if (ok) api.logout();
          },
        },
        '로그아웃',
      ),
    ]),
  ]);
}

/** Win / loss / draw tiles. */
export function statRow(stats) {
  const rate = stats.games ? Math.round((stats.wins / stats.games) * 100) : 0;
  const tile = (label, value, color) =>
    el(
      'div',
      {
        style: {
          flex: '1',
          textAlign: 'center',
          padding: '8px 4px',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface-2)',
          border: '1px solid var(--line-soft)',
        },
      },
      [
        el('div', { style: { fontSize: '17px', fontWeight: '800', color: color || 'var(--text)' }, text: String(value) }),
        el('div', { style: { fontSize: '11px', color: 'var(--text-faint)' }, text: label }),
      ],
    );

  return el('div', { style: { display: 'flex', gap: '6px' } }, [
    tile('승', stats.wins, 'var(--good)'),
    tile('패', stats.losses, 'var(--bad)'),
    tile('무', stats.draws, 'var(--text-dim)'),
    tile('승률', `${rate}%`, 'var(--accent-2)'),
  ]);
}

/* ── Password change ──────────────────────────────────────────────────────── */

function openPasswordDialog() {
  const current = el('input.input', { type: 'password', autocomplete: 'current-password' });
  const next = el('input.input', { type: 'password', autocomplete: 'new-password', placeholder: '6자 이상' });
  const again = el('input.input', { type: 'password', autocomplete: 'new-password' });
  const problem = el('p.field-hint', { style: { minHeight: '1.3em' } });

  const close = modal({
    title: '비밀번호 변경',
    body: [
      el('div.field', {}, [el('label', {}, '현재 비밀번호'), current]),
      el('div.field', {}, [el('label', {}, '새 비밀번호'), next]),
      el('div.field', {}, [el('label', {}, '새 비밀번호 확인'), again]),
      problem,
      el('p.field-hint', {}, '변경하면 다른 기기의 로그인은 모두 해제됩니다.'),
    ],
    actions: () => [
      el('button.btn', { type: 'button', onClick: () => close() }, '취소'),
      el(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            const problemText = checkPassword(next.value);
            if (problemText) {
              problem.textContent = problemText;
              problem.style.color = 'var(--bad)';
              return;
            }
            if (next.value !== again.value) {
              problem.textContent = '새 비밀번호가 서로 다릅니다.';
              problem.style.color = 'var(--bad)';
              return;
            }
            api.changePassword(current.value, next.value);
            close();
          },
        },
        '변경',
      ),
    ],
    onClose: () => stop(),
  });

  const stop = subscribe('authError', () => {
    if (store.authError) toast(store.authError, 'bad');
  });
  current.focus();
}

/* ── Leaderboard ──────────────────────────────────────────────────────────── */

/**
 * The lobby's ranking panel.
 * @returns {{ node: HTMLElement, stop: () => void }} — call `stop` on unmount.
 */
export function leaderboardPanel() {
  const list = el('div.player-list', { style: { maxHeight: '320px' } });

  const paint = () => {
    const rows = store.leaderboard || [];
    if (!store.accountsEnabled) {
      mount(list, el('p.field-hint', {}, '이 서버는 순위를 기록하지 않습니다.'));
      return;
    }
    if (!rows.length) {
      mount(list, el('p.field-hint', {}, '아직 기록된 대국이 없습니다. 첫 승리의 주인공이 되어 보세요!'));
      return;
    }
    mount(
      list,
      rows.map((row, i) =>
        el(
          'button.player-row',
          {
            type: 'button',
            style: { width: '100%', border: 0, background: 'transparent', textAlign: 'left' },
            title: `${row.username} 전적 보기`,
            onClick: () => openProfileDialog(row.id),
          },
          [
            el('span', {
              style: {
                width: '20px',
                fontWeight: '800',
                color: i < 3 ? 'var(--warn)' : 'var(--text-faint)',
                fontSize: '12px',
              },
              text: `${i + 1}`,
            }),
            el('span', { text: AVATARS[row.avatar] || '👤' }),
            el('span', {
              style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              text: row.username + (row.id === store.user?.id ? ' (나)' : ''),
            }),
            el('span', {
              style: { fontSize: '12px', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' },
              text: `${row.wins}승 ${Math.round(row.winRate * 100)}%`,
            }),
          ],
        ),
      ),
    );
  };

  paint();
  const stop = subscribe(['leaderboard', 'accountsEnabled', 'user'], paint);

  const node = el('div.card', {}, [
    el('div.card-pad', { style: { paddingBottom: '4px' } }, [
      el('h2', { style: { fontSize: '15px' } }, '🏅 순위'),
    ]),
    el('div.card-pad', { style: { paddingTop: '6px' } }, list),
  ]);
  return { node, stop };
}

/** Another player's record. */
export function openProfileDialog(userId) {
  api.getProfile(userId);
  const body = el('div', {}, el('p.field-hint', {}, '불러오는 중…'));

  const close = modal({ title: '전적', body, onClose: () => stop() });

  const paint = () => {
    const profile = store.viewedProfile;
    if (!profile) return;
    const stats = profile.stats || { games: 0, wins: 0, losses: 0, draws: 0, byGame: {} };
    const perGame = Object.entries(stats.byGame || {}).sort((a, b) => b[1].games - a[1].games);

    mount(body, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '11px', marginBottom: '14px' } }, [
        el('div.score-avatar', { text: AVATARS[profile.avatar] || '👤' }),
        el('div', {}, [
          el('strong', { style: { fontSize: '16px' }, text: profile.username }),
          el('div.field-hint', { text: `가입 ${formatAgo(profile.createdAt)} · 최근 접속 ${formatAgo(profile.lastSeenAt)}` }),
        ]),
      ]),
      statRow(stats),
      perGame.length
        ? el('div', { style: { marginTop: '14px' } }, [
            el('h3', { style: { fontSize: '13px', marginBottom: '7px', color: 'var(--text-dim)' } }, '게임별'),
            ...perGame.map(([gameId, row]) =>
              el(
                'div.player-row',
                {},
                [
                  el('span', { style: { flex: '1' }, text: gameLabel(gameId) }),
                  el('span', {
                    style: { fontSize: '12px', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' },
                    text: `${row.wins}승 ${row.losses}패${row.draws ? ` ${row.draws}무` : ''}`,
                  }),
                ],
              ),
            ),
          ])
        : el('p.field-hint', { style: { marginTop: '12px' } }, '아직 기록된 대국이 없습니다.'),
    ]);
  };

  const stop = subscribe('viewedProfile', paint);
  paint();
}

function gameLabel(gameId) {
  const meta = (store.games || []).find((g) => g.id === gameId);
  return meta ? `${meta.emoji} ${meta.name}` : gameId;
}
