/**
 * 해전게임 view — two grids: your fleet on the left, your shots on the right.
 *
 * Setup is drag-free: pick a ship, click a square, press R (or the button) to
 * rotate. Ships preview in green/red before they commit, so nobody loses a
 * match to a misclick during placement.
 */
import { el, mount, toast } from '../ui.js';
import { gridBoard, cell } from './_base.js';
import { SIZE, SHIPS, shipCells, buildFleet, randomPlacements } from '../../../shared/games/battleship.js';

export function createView({ mount: root, onMove, sound }) {
  let placements = [];
  let selected = SHIPS[0].id;
  let dir = 'h';
  let hover = null;
  let ctx = null;

  const ownGrid = gridBoard('bs-grid', SIZE, SIZE, 300);
  const fireGrid = gridBoard('bs-grid', SIZE, SIZE, 300);
  const ownCells = [];
  const fireCells = [];

  for (let i = 0; i < SIZE * SIZE; i++) {
    const label = `${String.fromCharCode(65 + (i % SIZE))}${Math.floor(i / SIZE) + 1}`;
    const own = cell({
      'aria-label': label,
      onClick: () => placeAt(i),
      onMouseenter: () => {
        hover = i;
        paint();
      },
      onMouseleave: () => {
        hover = null;
        paint();
      },
    });
    ownCells.push(own);
    ownGrid.append(own);

    const fire = cell({ class: 'aim', 'aria-label': label, onClick: () => fireAt(i) });
    fireCells.push(fire);
    fireGrid.append(fire);
  }

  const fleetBar = el('div.bs-fleet');
  const sunkBar = el('div.bs-fleet');
  const setupBar = el('div.btn-row', { style: { justifyContent: 'center', marginTop: '10px' } }, [
    el('button.btn.sm', { type: 'button', onClick: () => { dir = dir === 'h' ? 'v' : 'h'; paint(); } }, '방향 회전 (R)'),
    el('button.btn.sm', { type: 'button', onClick: autoPlace }, '자동 배치'),
    el('button.btn.sm', { type: 'button', onClick: () => { placements = []; paint(); } }, '초기화'),
    el('button.btn.sm.primary', { type: 'button', onClick: confirmFleet }, '배치 완료'),
  ]);

  const wrap = el('div.bs-wrap', {}, [
    el('div.bs-panel', {}, [el('h4', { text: '내 함대' }), ownGrid, fleetBar, setupBar]),
    el('div.bs-panel', {}, [el('h4', { text: '적 해역' }), fireGrid, sunkBar]),
  ]);
  mount(root, wrap);

  const onKey = (event) => {
    if (event.key !== 'r' && event.key !== 'R') return;
    if (document.activeElement?.tagName === 'INPUT') return;
    dir = dir === 'h' ? 'v' : 'h';
    paint();
  };
  window.addEventListener('keydown', onKey);

  function specOf(id) {
    return SHIPS.find((s) => s.id === id);
  }

  function nextUnplaced() {
    return SHIPS.find((s) => !placements.some((p) => p.id === s.id))?.id ?? null;
  }

  function placeAt(idx) {
    if (!isSetup()) return;
    const spec = specOf(selected);
    if (!spec) return;
    const r = Math.floor(idx / SIZE);
    const c = idx % SIZE;
    const cells = shipCells(r, c, spec.len, dir);
    if (!cells) return;

    const others = placements.filter((p) => p.id !== spec.id);
    const used = new Set(others.flatMap((p) => shipCells(p.r, p.c, specOf(p.id).len, p.dir) || []));
    if (cells.some((x) => used.has(x))) {
      toast('다른 함선과 겹칩니다.', 'bad');
      return;
    }
    placements = [...others, { id: spec.id, r, c, dir }];
    sound.place();
    selected = nextUnplaced() || spec.id;
    paint();
  }

  function autoPlace() {
    placements = randomPlacements();
    selected = SHIPS[0].id;
    sound.select();
    paint();
  }

  function confirmFleet() {
    const { error } = buildFleet(placements);
    if (error) {
      toast(error, 'bad');
      return;
    }
    onMove({ type: 'place', placements });
  }

  function fireAt(idx) {
    if (!ctx || ctx.state.phase !== 'playing') return;
    if (ctx.status.turn !== ctx.seat || !ctx.interactive) return;
    if (ctx.state.shots[ctx.seat][idx] !== 0) return;
    onMove({ type: 'fire', idx });
  }

  function isSetup() {
    return ctx?.state.phase === 'setup' && ctx.seat !== null && !ctx.state.ready[ctx.seat];
  }

  function paint() {
    if (!ctx) return;
    const { state, seat } = ctx;
    const setup = isSetup();
    setupBar.style.display = setup ? 'flex' : 'none';

    /* ── Own grid ────────────────────────────────────────────────────────── */
    const mine = seat === null ? null : state.fleets[seat];
    const occupied = new Map();
    if (setup) {
      for (const p of placements) {
        for (const x of shipCells(p.r, p.c, specOf(p.id).len, p.dir) || []) occupied.set(x, p.id);
      }
    } else if (mine) {
      mine.cells.forEach((id, i) => id && occupied.set(i, id));
    }

    let preview = [];
    let previewOk = false;
    if (setup && hover !== null) {
      const spec = specOf(selected);
      const cells = spec ? shipCells(Math.floor(hover / SIZE), hover % SIZE, spec.len, dir) : null;
      if (cells) {
        preview = cells;
        const others = placements.filter((p) => p.id !== selected);
        const used = new Set(others.flatMap((p) => shipCells(p.r, p.c, specOf(p.id).len, p.dir) || []));
        previewOk = !cells.some((x) => used.has(x));
      }
    }

    const oppShots = seat === null ? [] : state.shots[seat === 0 ? 1 : 0];
    const mySunk = new Set((mine?.sunk || []).flatMap((s) => s.cells));

    for (let i = 0; i < ownCells.length; i++) {
      const node = ownCells[i];
      const classes = ['cell'];
      if (occupied.has(i)) classes.push(mySunk.has(i) ? 'sunk' : 'ship');
      if (oppShots[i] === 2) classes.push('hit');
      else if (oppShots[i] === 1) classes.push('miss');
      if (preview.includes(i)) classes.push(previewOk ? 'preview-ok' : 'preview-bad');
      node.className = classes.join(' ');
      node.textContent = oppShots[i] === 2 ? '✕' : oppShots[i] === 1 ? '·' : '';
      node.disabled = !setup;
    }

    /* ── Firing grid ─────────────────────────────────────────────────────── */
    const myShots = seat === null ? [] : state.shots[seat];
    const oppSunk = new Set(
      seat === null ? [] : (state.fleets[seat === 0 ? 1 : 0].sunk || []).flatMap((s) => s.cells),
    );
    const canFire = ctx.interactive && state.phase === 'playing' && ctx.status.turn === seat;

    for (let i = 0; i < fireCells.length; i++) {
      const node = fireCells[i];
      const shot = myShots[i] || 0;
      const classes = ['cell', 'aim'];
      if (oppSunk.has(i)) classes.push('sunk');
      else if (shot === 2) classes.push('hit');
      else if (shot === 1) classes.push('miss');
      node.className = classes.join(' ');
      node.textContent = shot === 2 ? '💥' : shot === 1 ? '·' : '';
      node.disabled = !canFire || shot !== 0;
    }

    /* ── Fleet legends ───────────────────────────────────────────────────── */
    mount(
      fleetBar,
      SHIPS.map((spec) => {
        const placed = setup ? placements.some((p) => p.id === spec.id) : Boolean(mine);
        const sunk = (mine?.sunk || []).some((s) => s.id === spec.id);
        const classes = ['bs-ship'];
        if (sunk) classes.push('sunk');
        else if (placed) classes.push('placed');
        if (setup && selected === spec.id) classes.push('selected');
        return el(
          setup ? 'button' : 'span',
          {
            class: classes.join(' '),
            type: setup ? 'button' : undefined,
            onClick: setup
              ? () => {
                  selected = spec.id;
                  paint();
                }
              : undefined,
          },
          `${spec.name} ${spec.len}`,
        );
      }),
    );

    const theirFleet = seat === null ? null : state.fleets[seat === 0 ? 1 : 0];
    mount(
      sunkBar,
      SHIPS.map((spec) => {
        const sunk = (theirFleet?.sunk || []).some((s) => s.id === spec.id);
        return el(`span.bs-ship${sunk ? '.sunk' : ''}`, {}, `${spec.name} ${spec.len}`);
      }),
    );
  }

  return {
    render(next) {
      ctx = next;
      if (ctx.state.phase === 'setup' && ctx.seat !== null && !placements.length && !ctx.state.ready[ctx.seat]) {
        // Start people off with a legal fleet they can then rearrange.
        placements = randomPlacements();
      }
      paint();
    },

    events(list) {
      for (const event of list) {
        if (event.type === 'fire') sound[event.hit ? 'hit' : 'miss']();
        if (event.type === 'sunk') {
          sound.boom();
          toast(`${event.name} 격침!`, event.seat === ctx?.seat ? 'good' : 'bad');
        }
        if (event.type === 'ready' && event.seat !== ctx?.seat) toast('상대가 배치를 마쳤습니다.', 'info');
      }
    },

    destroy() {
      window.removeEventListener('keydown', onKey);
      mount(root, null);
    },
  };
}
