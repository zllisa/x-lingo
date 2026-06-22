// ============================================================
// Local Korean → Revised Romanization (국어의 로마자 표기법)
//
// Per-syllable jamo mapping (no cross-syllable assimilation).
// This guarantees deterministic, offline, word-by-word output so the
// 精听 transcript can always align one romaja token under each Korean
// word — independent of the DeepSeek sentence-level romanization.
//
// English / numbers / punctuation pass through unchanged, so a mixed
// Korean-English line still produces exactly one token per word.
// ============================================================

// 초성 (initial consonants) — 19
const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
// 중성 (vowels) — 21
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// 종성 (final consonants) — 28 (index 0 = none)
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** Romanize a single string (word or full sentence). */
export function romanize(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const s = code - HANGUL_BASE;
      const cho = Math.floor(s / 588);
      const jung = Math.floor((s % 588) / 28);
      const jong = s % 28;
      out += CHO[cho] + JUNG[jung] + JONG[jong];
    } else {
      // English, digits, punctuation, spaces — keep as-is
      out += ch;
    }
  }
  return out;
}

/**
 * Split a Korean line into word tokens, each paired with its own
 * locally-computed romaja. Splitting on whitespace guarantees the two
 * arrays have identical length → perfect 1:1 column alignment.
 */
export interface RomaPair {
  ko: string;
  roma: string;
}

export function romanizeWords(line: string): RomaPair[] {
  return line
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => ({ ko: w, roma: romanize(w) }));
}
