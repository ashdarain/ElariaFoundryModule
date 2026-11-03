/**
 * Checks the damage maths (module/combat/damage.mjs) against Mechanics' "Damage Modifier" and the damage types.
 * Run from the system folder:  node tools/test-damage.mjs
 */
import assert from "node:assert/strict";
Math.clamp ??= (v, a, b) => Math.min(b, Math.max(a, v));
globalThis.game = { i18n: { localize: k => k, format: k => k } };
const D = await import("../module/combat/damage.mjs");

const target = (over = {}) => ({ system: {
  defence: { ar: 6, mar: 3, aar: 4, nar: 2, nmar: 3, ...over.defence },
  stats: { con: { mod: 2 } },
  resistanceTotals: { fire: { total: 25 }, water: { total: -25 }, mortal: { total: 0 }, divine: { total: 25 }, demonic: { total: -25 }, ...over.res }
} });
const P = (...tags) => D.profileFromText(tags);
const dmg = (hits, profile, { crit = false, critDamage = 50, flat = 0, t = target() } = {}) =>
  D.computeDamage({ hits, flat, crit }, profile, critDamage, t).final;

const cases = [
  // Ash's example (option a): 14 vs AR 4, crit ×1.5, 25 % resist → (14 − 4) × (1.5 − 0.25) = 12.5 → 13
  ["option a example", dmg([14], P("Physical", "Fire"), { crit: true, t: target({ defence: { ar: 4, mar: 4 } }) }), 13],
  ["physical, full AR", dmg([14], P("Physical")), 8],
  ["crit adds 50 %", dmg([14], P("Physical"), { crit: true }), 12],
  ["slashing = full AR", dmg([10], P("Slashing")), 4],
  ["piercing = half AR", dmg([10], P("Piercing")), 7],
  ["blunt ignores AAR", dmg([10], P("Blunt")), 8],
  ["chopping ignores NAR", dmg([10], P("Chopping")), 6],
  ["magical = MAR", dmg([10], P("Magical")), 7],
  ["magical piercing = half MAR", dmg([10], P("Magical", "Piercing")), 9],  // 10 − 1.5 = 8.5 → 9
  ["magical chopping ignores NMAR", dmg([10], P("Magical", "Chopping")), 10],
  ["true ignores armour and resistance", dmg([10], P("True Damage", "Divine")), 10],
  ["toxic blocked by Con only", dmg([10], P("Toxic")), 8],
  ["AR piercing", dmg([10], P("AR Piercing", "Physical")), 10],
  ["AAR piercing", dmg([10], P("AAR Piercing", "Physical")), 8],
  ["fire element = magical, fire resist 25 %", dmg([10], P("Fire")), 5],      // (10 − 3) × 0.75 = 5.25
  ["weak to water", dmg([10], P("Water")), 9],                               // 7 × 1.25 = 8.75
  ["divine resisted 25 %", dmg([10], P("Physical", "Divine")), 3],           // 4 × 0.75
  ["demonic +25 %", dmg([10], P("Physical", "Demonic")), 5],                 // 4 × 1.25
  ["armour per hit (3 × 5 vs AR 6)", dmg([5, 5, 5], P("Physical")), 0],
  ["multi-hit, once-only bonus on hit 1", dmg([5, 7, 9], P("Physical"), { flat: 3 }), 6],  // 2 + 1 + 3
  ["once-only bonus moved to hit 3", D.computeDamage({ hits: [5, 7, 9], flat: 3, crit: false, flatHit: 2 }, P("Physical"), 50, target()).final, 7],
  ["once-only bonus on hit 1 of weak hits", D.computeDamage({ hits: [4, 4, 9], flat: 3, crit: false }, P("Physical"), 50, target()).final, 4],
  ["… moved to the hit that gets through", D.computeDamage({ hits: [4, 4, 9], flat: 3, crit: false, flatHit: 2 }, P("Physical"), 50, target()).final, 6],
  ["never negative", dmg([1], P("Physical"), { flat: -5 }), 0],
  // "2d6 Fire 4 Wind" on a 10-damage physical hit vs AR 6 / MAR 3, fire res 25: 4 + (6−3)×0.75 + (4−3)×1 = 7.25
  ["typed bonus parts", D.computeDamage({ hits: [10], flat: 0, crit: false, extras: [
    { profile: D.labelDamageProfile("Fire"), label: "Fire", values: [6] },
    { profile: D.labelDamageProfile("Wind"), label: "Wind", values: [4] }] }, P("Physical"), 50, target()).final, 7],
  ["true bonus ignores armour", D.computeDamage({ hits: [10], flat: 0, crit: false, extras: [
    { profile: D.labelDamageProfile("True"), label: "True", values: [5] }] }, P("Physical"), 50, target()).final, 9],
  // Ash's example: 4 Fire vs 150 % Fire resistance (no armour) → 4 × (1 − 1.5) = −2 → heals 2
  ["resistance over 100 % heals", dmg([4], P("Fire"), { t: target({ defence: { mar: 0 }, res: { fire: { total: 150 } } }) }), -2],
  ["crit against 150 % = 0", dmg([4], P("Fire"), { crit: true, t: target({ defence: { mar: 0 }, res: { fire: { total: 150 } } }) }), 0],
  ["heal rounds halves away from 0", dmg([5], P("Fire"), { t: target({ defence: { mar: 0 }, res: { fire: { total: 150 } } }) }), -3],
  ["mixed: physical hurts, fire heals", D.computeDamage({ hits: [10], flat: 0, crit: false, extras: [
    { profile: D.labelDamageProfile("Fire"), label: "Fire", values: [7] }] }, P("Physical"), 50,
    target({ res: { fire: { total: 200 } } })).final, 0]   // 4 + (7 − 3) × (1 − 2) = 0
];
let failed = 0;
for (const [label, actual, expected] of cases) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}
assert.equal(P("Weapon Damage").weapon, true);
assert.equal(P("Elemental").askElement, true);
assert.equal(P("Phy. Slashing").type, "slashing");
assert.equal(D.labelDamageProfile("Rage"), null);
assert.equal(D.labelDamageProfile("Fire", { form: "divine" }).form, "divine");
console.log(failed ? `\n${failed} check(s) failed` : "\nAll damage checks passed");
process.exit(failed ? 1 : 0);
