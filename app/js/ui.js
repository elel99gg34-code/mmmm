/**
 * DOM helpers, toasts and modals.
 *
 * `el()` is deliberately tiny: tag, props, children. Every view in this app is
 * built from it, and because it sets `textContent` rather than `innerHTML`,
 * player names and chat lines cannot inject markup.
 */

/**
 * Create an element.
 *
 * @param {string} tag        'div', or 'div.card.pad', or 'button.btn.primary'
 * @param {object} [props]    attributes; `class`, `dataset`, `style`, `on*` handlers
 * @param {any} [children]    string | Node | array of either
 */
export function el(tag, props = {}, children = null) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.className = [node.className, value].filter(Boolean).join(' ');
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) {
        if (dv !== null && dv !== undefined) node.dataset[dk] = dv;
      }
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'html') {
      node.innerHTML = value; // only ever used with strings this app authored
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') {
      node.textContent = value;
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, value);
    }
  }

  append(node, children);
  return node;
}

/** Append a string, Node, or (nested) array of them. */
export function append(parent, children) {
  if (children === null || children === undefined || children === false) return parent;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return parent;
  }
  parent.append(children instanceof Node ? children : document.createTextNode(String(children)));
  return parent;
}

/** Replace everything inside `parent`. */
export function clear(parent) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  return parent;
}

/** Replace the contents of `parent` with `children`. */
export function mount(parent, children) {
  clear(parent);
  append(parent, children);
  return parent;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ── Toasts ───────────────────────────────────────────────────────────────── */

const TOAST_ICONS = { info: 'ℹ️', good: '✅', bad: '⚠️', match: '🎮', champion: '🏆' };

export function toast(message, kind = 'info', ms = 3600) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const node = el(`div.toast.${kind === 'good' || kind === 'bad' ? kind : ''}`, {}, [
    el('span', { text: TOAST_ICONS[kind] || TOAST_ICONS.info }),
    el('span', { text: message }),
  ]);
  root.append(node);
  const remove = () => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 200);
  };
  setTimeout(remove, ms);
  node.addEventListener('click', remove);
}

/* ── Modal ────────────────────────────────────────────────────────────────── */

let closeActiveModal = null;

/**
 * Open a modal. `render(close)` returns the body; `actions(close)` returns
 * footer buttons. Escape and a backdrop click both close it.
 */
export function modal({ title, body, actions, onClose, wide = false }) {
  closeActiveModal?.();
  const root = document.getElementById('modal-root');
  const previouslyFocused = document.activeElement;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    clear(root);
    closeActiveModal = null;
    onClose?.();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  };

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  const dialog = el('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '대화 상자' }, [
    el('div.modal-head', {}, [
      el('h2', { text: title || '' }),
      el('button.icon-btn', { type: 'button', 'aria-label': '닫기', onClick: close }, '✕'),
    ]),
    el('div.modal-body', {}, typeof body === 'function' ? body(close) : body),
    actions ? el('div.modal-foot', {}, typeof actions === 'function' ? actions(close) : actions) : null,
  ]);
  if (wide) dialog.style.width = 'min(760px, 100%)';

  const backdrop = el(
    'div.modal-backdrop',
    {
      onClick: (event) => {
        if (event.target === backdrop) close();
      },
    },
    dialog,
  );

  mount(root, backdrop);
  document.addEventListener('keydown', onKey);
  closeActiveModal = close;

  // Focus the first useful control so keyboard users are not stranded.
  const focusable = dialog.querySelector('input, select, textarea, button.primary, button');
  focusable?.focus();
  return close;
}

/** A yes/no modal that resolves to a boolean. */
export function confirmDialog({ title, message, confirmText = '확인', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const close = modal({
      title,
      body: el('p', { text: message }),
      actions: () => [
        el('button.btn', { type: 'button', onClick: () => { finish(false); close(); } }, '취소'),
        el(
          `button.btn.${danger ? 'danger' : 'primary'}`,
          { type: 'button', onClick: () => { finish(true); close(); } },
          confirmText,
        ),
      ],
      onClose: () => finish(false),
    });
  });
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

/** `72300` -> `1:12` */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `4200` -> `4.2초` */
export function formatSeconds(ms, digits = 1) {
  return `${(Math.max(0, ms) / 1000).toFixed(digits)}초`;
}

/** `1731000000000` -> `14:32` */
export function formatTime(at) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** '3분 전' */
export function formatAgo(at) {
  const diff = Date.now() - at;
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  return `${Math.floor(diff / 3_600_000)}시간 전`;
}

/** Bounce an element for emphasis without a CSS class per caller. */
export function pulse(node) {
  if (!node) return;
  node.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
    { duration: 260, easing: 'cubic-bezier(0.2,0.7,0.3,1)' },
  );
}
