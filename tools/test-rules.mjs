/**
 * Checks module/rules.mjs against the sample character on the Google Sheet
 * ("Character Stats", B42 onward): level 10, Strength Bst, Finesse Bst with 13 points, everything else Gen.
 *
 * Run from the system folder:  node tools/test-rules.mjs
 */
import assert from "node:assert/strict";
import * as R from "../module/rules.mjs";

const MAJORS = new Set(["str", "con", "fin", "pre", "awa", "smrts", "wis"]);
const lvl = 10;
const stats = {
  str: { scaling: "bst", points: 0 }, stf: { scaling: "gen", points: 0 }, con: { scaling: "gen", points: 0 },
  res: { scaling: "gen", points: 0 }, fin: { scaling: "bst", points: 13 }, pre: { scaling: "gen", points: 0 },
  awa: { scaling: "gen", points: 0 }, dem: { scaling: "gen", points: 0 }, smrts: { scaling: "gen", points: 0 },
  spc: { scaling: "gen", points: 0 }, wis: { scaling: "gen", points: 0 }, ins: { scaling: "gen", points: 0 },
  lck: { scaling: "gen", points: 0 }
};

const total = {}, mod = {};
for (const [k, s] of Object.entries(stats)) {
  total[k] = R.statTotal(lvl, s.points, s.scaling);
  mod[k] = R.statMod(total[k]);
}

const checks = [
  // [label, actual, expected value shown on the Google Sheet]
  ["Str total", total.str, 15], ["Str mod", mod.str, 3],
  ["Fin total", total.fin, 34], ["Fin mod", mod.fin, 8],
  ["Stf total", total.stf, 10], ["Stf mod", mod.stf, 2],
  ["Stat points available", R.statPointsAvailable(lvl), 39],
  ["HP max", R.hpMax(mod.con, lvl), 45],
  ["MP max", R.mpMax(mod.wis, lvl), 16],
  ["FTG max", R.ftgMax(mod.res, lvl), 16],
  ["AR (AAR 0)", mod.stf + 0, 2],
  ["MAR (AAR 0)", mod.wis + 0, 2],
  ["Passive Awareness", R.passiveAwareness(mod.awa), 12],
  ["Reacts per round", R.reactsPerRound(mod.awa), 2],
  ["Crit chance %", R.critChance(mod.lck), 10],
  ["Crit damage %", R.critDamage(mod.ins), 20],
  ["Mv", R.movement(mod.fin), 12],
  ["Equip load", R.equipLoad(mod.con), 4],
  ["Life point max", R.lifePointsMax(mod.con), 3],
  ["Max output", R.maxOutput(lvl), 25],
  ["Bag slots (rank 1)", R.bagSlots(R.equipLoad(mod.con), 1), 20]
];

// Edge cases from the formulas themselves
checks.push(
  ["Scaling off → Gen", R.statTotal(10, 13, "bst", false), 23],
  ["Null scaling", R.statTotal(10, 3, "null"), 6],
  ["Reacts cap at 4", R.reactsPerRound(12), 4],
  ["Reacts at awa mod 6", R.reactsPerRound(6), 3],
  ["Life points at con mod 6", R.lifePointsMax(6), 4],
  ["Life points at con mod 8", R.lifePointsMax(8), 5],
  ["Mv floor 1", R.movement(-9), 1],
  ["Mv cap 20", R.movement(30), 20],
  ["FTG at exhaustion 3", R.ftgMax(2, 10, 3), 11],
  ["Output lvl 1", R.maxOutput(1), 5],
  ["Output lvl 12", R.maxOutput(12), 32],
  ["Output lvl 20 + Plus 5", R.maxOutput(20, true), 60],
  ["HP floor 1", R.hpMax(-10, 1), 1]
);

checks.push(
  ["Mortal vs Demonic", R.formResistances("mortal").demonic, -25],
  ["Mortal vs Divine", R.formResistances("mortal").divine, 25],
  ["Mortal vs Mortal", R.formResistances("mortal").mortal, 0],
  ["Divine vs Mortal", R.formResistances("divine").mortal, -25],
  ["Demonic vs Divine", R.formResistances("demonic").divine, -25]
);

let failed = 0;
for (const [label, actual, expected] of checks) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

const bal = R.scalingBalance(stats, MAJORS);
console.log(`INFO  Sample scaling: boosts cost ${bal.cost}, nulls credit ${bal.credit} → ${bal.balanced ? "balanced" : "unbalanced (warning shown)"}`);
assert.deepEqual(R.elementCombos(["Fire", "Ice", "Wind"]), ["Fire/Ice", "Fire/Wind", "Ice/Wind"]);
console.log("PASS  Three elements → three combos");

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
