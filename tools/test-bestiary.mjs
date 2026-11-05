/**
 * Bestiary importer check without Foundry: read an .xlsx, find every monster stat block, build the actor data.
 *   node tools/test-bestiary.mjs path/to/bestiary.xlsx
 */
import fs from "node:fs";
import { readXlsx } from "../module/importer/xlsx.mjs";
import { convertBestiary, monsterActorData } from "../module/importer/bestiary.mjs";
import { ELARIA } from "../module/config.mjs";
import * as R from "../module/rules.mjs";

const file = process.argv[2];
if (!file) { console.log("Usage: node tools/test-bestiary.mjs <file.xlsx>"); process.exit(1); }
const b = fs.readFileSync(file);
const wb = await readXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const { monsters, warnings, tabs } = convertBestiary(wb);
console.log(`${monsters.length} monsters from ${tabs.length} tabs: ${tabs.join(", ")}`);
let bad = 0;
for (const m of monsters) {
  const a = monsterActorData(m);
  // Re-derive what the monster sheet will show and compare with the stat block.
  const mods = Object.fromEntries(Object.entries(a.system.stats).map(([k, s]) => [k, s.mod]));
  const base = R.monsterSubstatBase(mods), b2 = a.system.bonuses;
  const nar = base.nar + b2.nar, nmar = base.nmar + b2.nmar, aar = b2.aar;
  const shown = { nar, nmar, aar, ar: nar + aar + b2.ar, mar: nmar + aar + b2.mar,
    critChance: base.critChance + b2.critChance, critDamage: base.critDamage + b2.critDamage, mv: base.mv + b2.mv,
    reacts: base.reacts + b2.reacts, passiveAwareness: base.passiveAwareness + b2.passiveAwareness };
  const diffs = Object.entries(m.defence).filter(([k, v]) => shown[k] !== v).map(([k, v]) => `${k} ${shown[k]}≠${v}`);
  const els = R.elementsInText(a.system.details.elements, Object.keys(ELARIA.resistanceElements));
  const built = { ...R.elementResistances(els, ELARIA.elementAffinity), ...R.formResistances(a.system.details.form) };
  for (const [k, v] of Object.entries(m.resistances)) if ((built[k] ?? 0) + a.system.resistances[k] !== v) diffs.push(`res ${k}`);
  if (diffs.length) bad++;
  console.log(`${diffs.length ? "FAIL" : "ok  "}  P${m.power} ${m.type.padEnd(7)} ${m.name.padEnd(26)} HP ${a.system.resources.hp.max} · ${a.items.length} abilities · ${m.elements}${diffs.length ? "  " + diffs.join(", ") : ""}`);
}
if (warnings.length) console.log("\nWarnings:\n  " + warnings.join("\n  "));
process.exit(bad ? 1 : 0);
