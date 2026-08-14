/**
 * View registry — game id to the module that draws it.
 *
 * The rule engines live in `shared/games/`; these are their faces. Both lists
 * are keyed by the same id, so a missing view is a loud error rather than a
 * silently unplayable game.
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

const VIEWS = {
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

/** Build the view for a game id. Throws if a game has no view, by design. */
export function createGameView(gameId, options) {
  const module = VIEWS[gameId];
  if (!module) throw new Error(`no view registered for game "${gameId}"`);
  return module.createView(options);
}

export function hasView(gameId) {
  return Boolean(VIEWS[gameId]);
}

export const viewIds = () => Object.keys(VIEWS);
