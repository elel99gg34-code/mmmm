/**
 * Hash routing.
 *
 * Hash rather than history API because the site is deployed to GitHub Pages,
 * where there is no server to rewrite deep links back to `index.html`.
 */

const routes = [];
let currentCleanup = null;
let currentPath = null;
let outlet = null;

/**
 * Register a route.
 * @param {string} pattern e.g. '/', '/game/:id'
 * @param {(root: HTMLElement, params: object) => (void|Function)} render
 * @param {string} [nav] value for the matching top-nav link
 */
export function route(pattern, render, nav) {
  const keys = [];
  const regex = new RegExp(
    `^${pattern
      .replace(/\/+$/, '')
      .replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/')}\\/?$`,
  );
  routes.push({ regex, keys, render, nav: nav || pattern });
}

export function currentHashPath() {
  const raw = location.hash.replace(/^#/, '') || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** Navigate, optionally forcing a re-render of the same path. */
export function navigate(hash, { force = false } = {}) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (location.hash === target) {
    if (force) render();
    return;
  }
  location.hash = target;
}

export function startRouter(mountPoint) {
  outlet = mountPoint;
  window.addEventListener('hashchange', render);
  render();
}

function render() {
  const path = currentHashPath();
  const match = routes
    .map((entry) => ({ entry, result: entry.regex.exec(path.split('?')[0]) }))
    .find((candidate) => candidate.result);

  currentCleanup?.();
  currentCleanup = null;
  currentPath = path;

  if (!match) {
    outlet.replaceChildren();
    const notice = document.createElement('div');
    notice.className = 'empty';
    notice.textContent = '페이지를 찾을 수 없습니다.';
    outlet.append(notice);
    return;
  }

  const params = {};
  match.entry.keys.forEach((key, i) => {
    params[key] = decodeURIComponent(match.result[i + 1]);
  });

  outlet.replaceChildren();
  const cleanup = match.entry.render(outlet, params);
  currentCleanup = typeof cleanup === 'function' ? cleanup : null;

  // Reflect the active section in the top nav.
  for (const link of document.querySelectorAll('.topnav a')) {
    const isCurrent = link.dataset.nav === match.entry.nav;
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  document.getElementById('main')?.focus({ preventScroll: true });
}

/** Re-run the current route (used when connection state changes a page). */
export function refresh() {
  if (currentPath !== null) render();
}
