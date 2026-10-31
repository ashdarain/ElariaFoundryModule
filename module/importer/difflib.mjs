/**
 * Port of the parts of Python's difflib used for fuzzy name matching:
 * SequenceMatcher (ratio, quick_ratio, real_quick_ratio) and get_close_matches.
 * Behaviour (including tie-breaking) follows CPython so results match the original converter.
 */

class SequenceMatcher {
  constructor() {
    this.a = null;
    this.b = null;
  }

  setSeq1(a) {
    if (a === this.a) return;
    this.a = a;
    this.matchingBlocks = null;
  }

  setSeq2(b) {
    if (b === this.b) return;
    this.b = b;
    this.matchingBlocks = null;
    this.fullbcount = null;
    this.#chainB();
  }

  #chainB() {
    const b = this.b;
    const b2j = new Map();
    for (let i = 0; i < b.length; i++) {
      const ch = b[i];
      if (!b2j.has(ch)) b2j.set(ch, []);
      b2j.get(ch).push(i);
    }
    // autojunk: purge popular elements in long sequences
    this.bpopular = new Set();
    const n = b.length;
    if (n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of b2j) {
        if (idxs.length > ntest) this.bpopular.add(elt);
      }
      for (const elt of this.bpopular) b2j.delete(elt);
    }
    this.b2j = b2j;
  }

  findLongestMatch(alo, ahi, blo, bhi) {
    const { a, b, b2j } = this;
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    // isbjunk is always false (no junk function), so these extend over popular elements only
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  }

  getMatchingBlocks() {
    if (this.matchingBlocks) return this.matchingBlocks;
    const la = this.a.length, lb = this.b.length;
    const queue = [[0, la, 0, lb]];
    const blocks = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const [i, j, k] = x;
      if (k) {
        blocks.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    blocks.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    // collapse adjacent blocks
    let i1 = 0, j1 = 0, k1 = 0;
    const nonAdjacent = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
      else {
        if (k1) nonAdjacent.push([i1, j1, k1]);
        i1 = i2; j1 = j2; k1 = k2;
      }
    }
    if (k1) nonAdjacent.push([i1, j1, k1]);
    nonAdjacent.push([la, lb, 0]);
    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  ratio() {
    const matches = this.getMatchingBlocks().reduce((s, t) => s + t[2], 0);
    return calcRatio(matches, this.a.length + this.b.length);
  }

  quickRatio() {
    if (!this.fullbcount) {
      this.fullbcount = new Map();
      for (const ch of this.b) this.fullbcount.set(ch, (this.fullbcount.get(ch) ?? 0) + 1);
    }
    const avail = new Map();
    let matches = 0;
    for (const ch of this.a) {
      const numb = avail.has(ch) ? avail.get(ch) : (this.fullbcount.get(ch) ?? 0);
      avail.set(ch, numb - 1);
      if (numb > 0) matches++;
    }
    return calcRatio(matches, this.a.length + this.b.length);
  }

  realQuickRatio() {
    const la = this.a.length, lb = this.b.length;
    return calcRatio(Math.min(la, lb), la + lb);
  }
}

function calcRatio(matches, length) {
  return length ? (2 * matches) / length : 1;
}

/** Python string ordering (by code point). */
const pyCmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * difflib.get_close_matches(word, possibilities, n, cutoff)
 * @param {string} word
 * @param {Iterable<string>} possibilities
 */
export function getCloseMatches(word, possibilities, n = 3, cutoff = 0.6) {
  const result = [];
  const s = new SequenceMatcher();
  s.setSeq2(word);
  for (const x of possibilities) {
    s.setSeq1(x);
    if (s.realQuickRatio() >= cutoff && s.quickRatio() >= cutoff && s.ratio() >= cutoff) result.push([s.ratio(), x]);
  }
  // heapq.nlargest(n, result): largest score first, ties broken by the larger string
  result.sort((p, q) => (q[0] - p[0]) || pyCmp(q[1], p[1]));
  return result.slice(0, n).map(r => r[1]);
}
