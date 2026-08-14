/** The hub: the catalogue of all fifteen games, filterable. */
import { el, mount } from '../ui.js';
import { store, subscribe } from '../store.js';
import { catalogue, CATEGORIES } from '../../../shared/games/index.js';
import { navigate } from '../router.js';
import { openQuickPlay } from './quickplay.js';

let filterCategory = 'all';
let filterText = '';

export function renderHub(root) {
  const games = store.games?.length ? store.games : catalogue();

  const hero = el('section.hero', {}, [
    el('h1', {}, '친구와 지금 바로, 15가지 게임'),
    el(
      'p',
      {},
      '오목부터 퀴즈 배틀까지 전부 1대1로 즐길 수 있습니다. 혼자서는 컴퓨터와, ' +
        '둘이서는 같은 기기에서, 멀리 있으면 로비에서 만나 온라인으로. 퀴즈 대회도 열 수 있습니다.',
    ),
    el('div.btn-row', {}, [
      el('button.btn.primary.lg', { type: 'button', onClick: () => openQuickPlay() }, '🎮 바로 시작하기'),
      el('a.btn.lg', { href: '#/lobby' }, '🌐 로비 둘러보기'),
      el('a.btn.lg.ghost', { href: '#/tournaments' }, '🏆 대회'),
    ]),
    el('div.hero-stats', {}, [
      stat(String(games.length), '게임'),
      stat(store.connection === 'online' ? String(store.lobby.online || 0) : '–', '접속 중'),
      stat(store.connection === 'online' ? String(store.lobby.rooms?.length || 0) : '–', '열린 방'),
    ]),
  ]);

  const search = el('input.input', {
    type: 'search',
    placeholder: '게임 검색…',
    value: filterText,
    onInput: (event) => {
      filterText = event.target.value;
      paintGrid();
    },
  });

  const categories = el('div.segmented', {}, [
    catButton('all', '전체'),
    ...CATEGORIES.map((cat) => catButton(cat, cat)),
  ]);

  const grid = el('div.game-grid');
  const section = el('section.section', {}, [
    el('div.filter-bar', {}, [categories, search]),
    grid,
  ]);

  function catButton(value, label) {
    return el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(filterCategory === value),
        onClick: () => {
          filterCategory = value;
          [...categories.children].forEach((btn) =>
            btn.setAttribute('aria-pressed', String(btn.textContent === label)),
          );
          paintGrid();
        },
      },
      label,
    );
  }

  function paintGrid() {
    const needle = filterText.trim().toLowerCase();
    const visible = games.filter((meta) => {
      if (filterCategory !== 'all' && meta.category !== filterCategory) return false;
      if (!needle) return true;
      return (
        meta.name.toLowerCase().includes(needle) ||
        meta.nameEn.toLowerCase().includes(needle) ||
        meta.desc.toLowerCase().includes(needle)
      );
    });

    if (!visible.length) {
      mount(grid, el('div.empty', {}, [el('div.empty-emoji', {}, '🔍'), el('p', {}, '조건에 맞는 게임이 없습니다.')]));
      return;
    }
    mount(grid, visible.map(gameCard));
  }

  paintGrid();
  mount(root, [hero, section]);

  // Keep the "접속 중" counters honest while the page is open.
  return subscribe(['lobby', 'connection', 'games'], () => {
    const stats = hero.querySelector('.hero-stats');
    if (!stats) return;
    mount(stats, [
      stat(String((store.games?.length || games.length)), '게임'),
      stat(store.connection === 'online' ? String(store.lobby.online || 0) : '–', '접속 중'),
      stat(store.connection === 'online' ? String(store.lobby.rooms?.length || 0) : '–', '열린 방'),
    ]);
  });
}

function stat(value, label) {
  return el('div.hero-stat', {}, [el('b', { text: value }), el('span', { text: label })]);
}

function gameCard(meta) {
  return el(
    `button.game-card${meta.featured ? '.featured' : ''}`,
    {
      type: 'button',
      onClick: () => navigate(`#/game/${meta.id}`),
      'aria-label': `${meta.name} 열기`,
    },
    [
      el('div.game-card-top', {}, [
        el('div.game-emoji', { text: meta.emoji }),
        el('div', {}, [el('h3', { text: meta.name }), el('div.en', { text: meta.nameEn })]),
      ]),
      el('p', { text: meta.desc }),
      el('div.game-card-tags', {}, [
        el('span.chip', { text: meta.category }),
        meta.ai ? el('span.chip', {}, '🤖 AI') : null,
        meta.mode === 'turn' ? el('span.chip', {}, '턴제') : null,
        meta.mode === 'simul' ? el('span.chip', {}, '동시') : null,
        meta.mode === 'race' ? el('span.chip', {}, '스피드') : null,
        meta.featured ? el('span.chip.accent', {}, '대회 종목') : null,
      ]),
    ],
  );
}
