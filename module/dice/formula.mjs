import { statCode } from "../importer/convert.mjs";

/**
 * Reading roll text typed on masteries, abilities and weapons ("3d6+Str+1", "3d6+1+Str x2", "2+Fin", "Fin+1").
 * The parts can come in any order; anything that isn't dice, a stat or a whole number is left out (the roll
 * window shows the text as written, so the player can add the rest).
 */

/** Split "a + b - c" into [{sign, text}] (brackets kept whole). */
function terms(text) {
  const out = [];
  let depth = 0, sign = 1, current = "";
  const push = () => { if (current.trim()) out.push({ sign, text: current.trim() }); current = ""; };
  for (const ch of String(text ?? "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (!depth && (ch === "+" || ch === "-" || ch === "−" || ch === "–")) {
      push();
      sign = ch === "+" ? 1 : -1;
    } else current += ch;
  }
  push();
  return out;
}

const DICE = /^(\d+)\s*d\s*(\d+)$/i;
const signed = (sign, text, first) => `${sign < 0 ? "- " : first ? "" : "+ "}${text}`;

/**
 * Damage text → what the roll window is filled with.
 *   "3d6+Str+1"       → { dice: "3d6", stat: "str", bonus: "1", hits: 1 }
 *   "3d6+1+Str x2"    → { dice: "3d6", stat: "str", bonus: "1", hits: 2 }
 *   "2d6+Str+1d4+Fin" → { dice: "2d6", stat: "str", bonus: "1d4 + @fin", hits: 1 }
 *   "3d6+Wis/5d6+Wis" → the first alternative
 * @returns {{dice: string, stat: string, bonus: string, hits: number}}  dice is "" when the text has none
 */
export function parseDamageText(raw) {
  let text = String(raw ?? "").trim();
  // "x3" / "×3" after the formula, or "3 x " before it: hits. (Never the "x" inside a word.)
  let hits = 1;
  text = text.replace(/(?:^|\s|(?<=[A-Za-z\d)]))[x×]\s*(\d+)\b/i, (m, n) => { hits = Number(n) || 1; return " "; });
  text = text.replace(/[x×]\s*#/i, " ");            // "x#": a number of hits that varies
  text = text.replace(/^\s*(\d+)\s*[x×]\s+/i, (m, n) => { hits = Number(n) || 1; return ""; });
  // Alternatives ("3d6+Wis/5d6+Wis", "2d6+Str or 3d6+Str"): the first one.
  text = text.split(/\s+or\s+|\/(?=\s*\d+\s*d)/i)[0];
  let dice = "", stat = "";
  const extra = [];
  for (const t of terms(text)) {
    const word = t.text.replace(/\s+per target$/i, "").trim();
    const d = DICE.exec(word);
    if (d) {
      if (!dice && t.sign > 0) dice = `${Number(d[1])}d${Number(d[2])}`;
      else extra.push({ sign: t.sign, text: `${Number(d[1])}d${Number(d[2])}` });
    } else if (/^\d+$/.test(word)) {
      extra.push({ sign: t.sign, text: String(Number(word)) });
    } else if (/^[A-Za-z.]+$/.test(word) && statCode(word)) {
      if (!stat && t.sign > 0) stat = statCode(word);
      else extra.push({ sign: t.sign, text: `@${statCode(word)}` });
    }
  }
  return { dice, stat, bonus: extra.map((e, i) => signed(e.sign, e.text, i === 0)).join(" "), hits };
}

/**
 * Skill mod text → { stats, bonus }: "2+Fin" → fin, 2; "Fin+1" → fin, 1; "1+Pre or Smrts" → [pre, smrts], 1;
 * "2+Fin+1" → fin, 3. Returns null when no stat or number can be read.
 */
export function parseSkillText(raw) {
  const stats = [];
  let bonus = 0, found = false;
  for (const t of terms(raw)) {
    if (/^\d+$/.test(t.text)) { bonus += t.sign * Number(t.text); found = true; continue; }
    const words = t.text.split(/\s+or\s+|\s*\/\s*/i).map(w => w.trim());
    if (words.every(w => /^[A-Za-z.]+$/.test(w) && statCode(w))) {
      for (const w of words) if (!stats.includes(statCode(w))) stats.push(statCode(w));
      found = true;
    }
  }
  return found ? { stats, bonus } : null;
}
