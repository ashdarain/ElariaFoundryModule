/**
 * The roll window's Bonus field can hold several parts, each optionally named:
 *   "2"                 → +2
 *   "1d4 + 2"           → +1d4, +2
 *   "2d6 Fire 4 Wind"   → +2d6 (Fire), +4 (Wind)
 *   "(1d6+2) Divine - 1"→ +(1d6+2) (Divine), −1
 * A part is a number, dice, an @value or anything in brackets; the words after it name it. On the chat card
 * every part is shown on its own. On damage rolls a name that is a damage type, element or form (Fire, True,
 * Divine …) makes that part its own damage with its own armour and resistance (see combat/damage.mjs).
 */

const TOKEN_RE = /\([^()]*\)|[+-]|[^\s+()-]+/g;

/** @returns {{terms: {sign: 1|-1, formula: string, label: string}[], error: string}} */
export function parseBonus(text) {
  const terms = [];
  let sign = 1, current = null, error = "";
  for (const token of String(text ?? "").match(TOKEN_RE) ?? []) {
    if (token === "+" || token === "-") {
      if (token === "-") sign = -sign;
      current = null;
      continue;
    }
    const isFormula = /^[(@\d]/.test(token) || /^d\d/i.test(token);
    if (isFormula) {
      current = { sign, formula: token, label: "" };
      terms.push(current);
      sign = 1;
    } else if (current) {
      current.label = current.label ? `${current.label} ${token}` : token;
    } else {
      error = token;   // a word with no number before it
    }
  }
  return { terms, error };
}

/** The bonus as one plain roll formula (names dropped), e.g. for reactions. */
export function bonusFormula(text) {
  return parseBonus(text).terms.map((t, i) => `${t.sign < 0 ? "-" : i ? "+" : ""} ${t.formula}`).join(" ").trim();
}

/** Is the bonus usable? (Foundry's Roll.validate for each part.) */
export function bonusIsValid(text) {
  if (!String(text ?? "").trim()) return true;
  const { terms, error } = parseBonus(text);
  if (error || !terms.length) return false;
  return terms.every(t => globalThis.Roll ? Roll.validate(t.formula) : true);
}
