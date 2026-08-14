/**
 * Hangul syllable helpers — just enough to run 끝말잇기 correctly.
 *
 * A precomposed Hangul syllable at code point U+AC00..U+D7A3 decomposes as
 *   index  = code - 0xAC00
 *   초성   = index / 588
 *   중성   = (index % 588) / 28
 *   종성   = index % 28
 */

export const BASE = 0xac00;
export const LAST = 0xd7a3;

export const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const JUNGSEONG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];

/** True when every character is a precomposed Hangul syllable. */
export function isHangulWord(word) {
  if (typeof word !== 'string' || word.length === 0) return false;
  for (const ch of word) {
    const code = ch.codePointAt(0);
    if (code < BASE || code > LAST) return false;
  }
  return true;
}

/** `{ cho, jung, jong }` indices for one syllable, or null. */
export function decompose(ch) {
  const code = ch.codePointAt(0);
  if (code < BASE || code > LAST) return null;
  const index = code - BASE;
  return { cho: Math.floor(index / 588), jung: Math.floor((index % 588) / 28), jong: index % 28 };
}

/** Rebuild a syllable from its three indices. */
export function compose(cho, jung, jong = 0) {
  return String.fromCodePoint(BASE + cho * 588 + jung * 28 + jong);
}

// 중성 indices that trigger ㄹ/ㄴ → ㅇ under 두음법칙 (ㅑ ㅒ ㅕ ㅖ ㅛ ㅠ ㅣ).
const Y_VOWELS = new Set([2, 3, 6, 7, 12, 17, 20]);
const CHO_N = 2; // ㄴ
const CHO_R = 5; // ㄹ
const CHO_O = 11; // ㅇ

/**
 * Every syllable a next word is allowed to start with, given `ch`.
 *
 * Standard 끝말잇기 accepts 두음법칙: 력 also opens 역, 라 also opens 나,
 * 녀 also opens 여. Returns a Set that always contains `ch` itself.
 */
export function allowedStarts(ch) {
  const out = new Set([ch]);
  const parts = decompose(ch);
  if (!parts) return out;
  const { cho, jung, jong } = parts;

  if (cho === CHO_R) {
    // 랴/려/료/류/리/례 → 야/여/요/유/이/예, 라/로/루/르/뢰 → 나/노/누/느/뇌
    out.add(compose(Y_VOWELS.has(jung) ? CHO_O : CHO_N, jung, jong));
  } else if (cho === CHO_N && Y_VOWELS.has(jung)) {
    // 녀/뇨/뉴/니 → 여/요/유/이
    out.add(compose(CHO_O, jung, jong));
  }
  return out;
}

/** True if `word` may follow a word ending in `prevLast`. */
export function canFollow(prevLast, word) {
  if (!word) return false;
  return allowedStarts(prevLast).has(word[0]);
}
