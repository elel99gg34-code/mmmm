/**
 * The game registry — the single list the lobby, the server and the client all
 * read from. Adding a sixteenth game means writing one engine module, adding
 * one client view, and appending one line here.
 */
import * as gomoku from './gomoku.js';
import * as connect4 from './connect4.js';
import * as reversi from './reversi.js';
import * as checkers from './checkers.js';
import * as uttt from './uttt.js';
import * as dotsboxes from './dotsboxes.js';
import * as battleship from './battleship.js';
import * as quiz from './quiz.js';
import * as wordchain from './wordchain.js';
import * as typing from './typing.js';
import * as reaction from './reaction.js';
import * as memory from './memory.js';
import * as minesweeper from './minesweeper.js';
import * as g2048 from './g2048.js';
import * as snake from './snake.js';

/** Display order on the hub. Featured / headline games first. */
export const GAMES = [
  quiz,
  gomoku,
  connect4,
  reversi,
  uttt,
  checkers,
  dotsboxes,
  battleship,
  wordchain,
  memory,
  typing,
  reaction,
  minesweeper,
  g2048,
  snake,
];

const BY_ID = new Map(GAMES.map((g) => [g.meta.id, g]));

/** The engine module for an id, or undefined. */
export function getGame(id) {
  return BY_ID.get(id);
}

/** Every registered id. */
export function gameIds() {
  return GAMES.map((g) => g.meta.id);
}

/** Metadata only — safe to send over the wire and to render a catalogue from. */
export function catalogue() {
  return GAMES.map((g) => ({ ...g.meta }));
}

/** Games that can host a head-to-head online match. */
export function duelGames() {
  return GAMES.filter((g) => g.meta.mode !== 'solo-only');
}

/** Games sensible to run a bracket tournament on. */
export function tournamentGames() {
  return GAMES.filter((g) => g.meta.mode === 'turn' || g.meta.mode === 'simul' || g.meta.mode === 'race');
}

export const CATEGORIES = [...new Set(GAMES.map((g) => g.meta.category))];

/* ── Engine helpers with sensible fallbacks ──────────────────────────────── */

/** `view` is optional; default to showing everything. */
export function viewFor(game, state, seat) {
  return typeof game.view === 'function' ? game.view(state, seat) : state;
}

/**
 * What a spectator is allowed to see.
 *
 * Spectators sit in the same room as the players and can talk to them, so a
 * spectator who can see a hidden board is a cheat channel. Engines with secrets
 * export `spectatorView`; engines without any secret are shown as-is.
 */
export function spectatorViewFor(game, state) {
  if (typeof game.spectatorView === 'function') return game.spectatorView(state);
  if (game.meta.hidden) return null; // nothing safe to show — the UI falls back to the scoreboard
  return state;
}

/** `tick` is optional; default to a no-op. */
export function tickOf(game, state, now) {
  return typeof game.tick === 'function' ? game.tick(state, now) : { state, changed: false };
}

/** `legalMoves` is optional. */
export function legalMovesOf(game, state, seat) {
  return typeof game.legalMoves === 'function' ? game.legalMoves(state, seat) : [];
}

export {
  gomoku,
  connect4,
  reversi,
  checkers,
  uttt,
  dotsboxes,
  battleship,
  quiz,
  wordchain,
  typing,
  reaction,
  memory,
  minesweeper,
  g2048,
  snake,
};
