/**
 * Pure Elaria rules maths. No Foundry dependencies, so it can be unit-tested with plain Node
 * (see tools/test-rules.mjs). Every formula cites where it comes from:
 *   CS = "Character Stats" tab cell, M = "Mechanics" tab, A# = answer in docs/QUESTIONS.md.
 */

/** Stat scaling multipliers. */
export const SCALING = { gen: 1, bst: 1.5, null: 0.5 };

/** Total stat = floor((level + points) × scaling). CS G46, A1. Scaling toggle off → ×1 (A9). */
export function statTotal(level, points, scaling = "gen", scalingEnabled = true) {
  const mult = scalingEnabled ? (SCALING[scaling] ?? 1) : 1;
  return Math.floor((level + points) * mult);
}

/** Modifier = floor(total / 4) + flat bonuses. CS I46, A4. */
export function statMod(total, bonus = 0) {
  return Math.floor(total / 4) + bonus;
}

/** Stat points to spend = 12 + 3 per level after the first. CS F62. */
export function statPointsAvailable(level) {
  return 12 + 3 * (level - 1);
}

/** Max points in a single stat = level + 3, counting assigned points only. A3 (warning only). */
export function perStatPointCap(level) {
  return level + 3;
}

/** CS L46 */
export function hpMax(conMod, level) {
  return Math.max(1, conMod * 5 + level * 3 + 5);
}

/** CS L47 */
export function mpMax(wisMod, level) {
  return Math.max(1, wisMod * 3 + level);
}

/** CS L48, plus Exhaustion 3 (M): −5 max FTG, can reach 0. */
export function ftgMax(resMod, level, exhaustion = 0) {
  let max = Math.max(1, resMod * 3 + level);
  if (exhaustion >= 3) max = Math.max(0, max - 5);
  return max;
}

/** CS L62: 3, +1 at con mod 6, +2 at con mod 8. A21. */
export function lifePointsMax(conMod) {
  return 3 + (conMod >= 8 ? 2 : conMod >= 6 ? 1 : 0);
}

/** CS L60: fin mod + 4, clamped to 1–20 metres. */
export function movement(finMod) {
  return Math.min(20, Math.max(1, finMod + 4));
}

/** CS L54 */
export function passiveAwareness(awaMod) {
  return awaMod + 10;
}

/** CS L55: floor(clamp(awa mod / 2, 2, 4)). Bonuses (heritages) are added on top and can exceed 4. */
export function reactsPerRound(awaMod) {
  return Math.floor(Math.min(4, Math.max(2, awaMod / 2)));
}

/** CS L56, percent. */
export function critChance(lckMod) {
  return lckMod * 5;
}

/** CS L57, percent. A crit multiplies damage by 1 + this/100 (A6). */
export function critDamage(insMod) {
  return insMod * 10;
}

/** CS L61 */
export function equipLoad(conMod) {
  return Math.max(0, conMod + 2);
}

/** CS D127 */
export function bagSlots(load, bagRank) {
  return (load + bagRank) * 4;
}

/** CS J66, A18. */
export function maxOutput(level, plusOutput = false) {
  return level * 2 + 3
    + (plusOutput ? 5 : 0)
    + (level >= 5 ? 2 : 0)
    + (level >= 12 ? 3 : 0)
    + (level >= 18 ? 4 : 0)
    + (level >= 20 ? 3 : 0);
}

/**
 * Boost/null trade check (CS text). Boosting a major costs 2, a minor 1.
 * Nulling a major credits 2, a minor 1. Credit must cover cost.
 * Demeanor and Speechcraft must share scaling.
 * @param {Record<string,{scaling:string}>} stats
 * @param {Set<string>} majors
 * @returns {{cost:number, credit:number, balanced:boolean, demSpcMismatch:boolean}}
 */
export function scalingBalance(stats, majors) {
  let cost = 0, credit = 0;
  for (const [key, s] of Object.entries(stats)) {
    const weight = majors.has(key) ? 2 : 1;
    if (s.scaling === "bst") cost += weight;
    else if (s.scaling === "null") credit += weight;
  }
  const demSpcMismatch = (stats.dem?.scaling ?? "gen") !== (stats.spc?.scaling ?? "gen");
  return { cost, credit, balanced: credit >= cost, demSpcMismatch };
}

/** Element combos: every pair of chosen elements (A20). */
export function elementCombos(elements) {
  const els = elements.filter(e => e);
  const combos = [];
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) combos.push(`${els[i]}/${els[j]}`);
  }
  return combos;
}

/**
 * Built-in resistance from a creature's damage form (Mechanics table, A19 and Ash's 2026-10-29 notes).
 * Positive = resists (takes less), negative = weak (takes more). Forms don't resist themselves.
 * Mortal: takes 25 % more from Demonic, 25 % less from Divine.
 * @param {"mortal"|"divine"|"demonic"} form
 * @returns {{mortal:number, divine:number, demonic:number}}
 */
export function formResistances(form) {
  switch (form) {
    case "divine": return { mortal: -25, divine: 0, demonic: 25 };
    case "demonic": return { mortal: 25, divine: -25, demonic: 0 };
    default: return { mortal: 0, divine: 25, demonic: -25 };
  }
}
