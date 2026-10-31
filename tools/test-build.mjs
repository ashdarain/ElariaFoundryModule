/**
 * End-to-end check of the Google Sheet importer, without Foundry:
 * download (or read a local .xlsx) → read → convert → build compendium entries → validate every entry.
 *
 *   node tools/test-build.mjs "https://docs.google.com/spreadsheets/d/…"     (read-only download)
 *   node tools/test-build.mjs "Elaria 2.2.xlsx"
 *
 * Needs Node 18+.
 */
import fs from "node:fs";
import { downloadSheet } from "../module/importer/google-sheet.mjs";
import { readXlsx } from "../module/importer/xlsx.mjs";
import { convertWorkbook } from "../module/importer/convert.mjs";
import { buildCompendiumData, PACKS } from "../module/importer/build.mjs";

const arg = process.argv[2];
if (!arg) { console.error("Usage: node tools/test-build.mjs <Google Sheets link | file.xlsx>"); process.exit(2); }

let buffer;
if (/^https?:\/\//.test(arg)) {
  console.log("Downloading a read-only copy of the sheet…");
  buffer = await downloadSheet(arg);
} else {
  const b = fs.readFileSync(arg);
  buffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const t0 = Date.now();
const workbook = await readXlsx(buffer);
const conversion = convertWorkbook(workbook, { source: { spreadsheetUrl: arg } });
const { packs, report } = await buildCompendiumData(conversion.index, async p => conversion.docs.get(p));
console.log(`${workbook.size} tabs → ${conversion.docs.size} documents → compendium entries in ${Date.now() - t0} ms\n`);

const CATEGORIES = new Set(["basic", "utility", "offensive", "defensive", "support", "any", "none"]);
const SOURCES = new Set(["general", "discipline", "elemental", "set", "bond", "deity", "ancestry", "profession"]);
const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };

let total = 0;
for (const [key, pack] of Object.entries(packs)) {
  const folderIds = new Set(pack.folders.map(f => f._id));
  for (const f of pack.folders) check(!f.folder || folderIds.has(f.folder), `${key}: folder ${f.name} has unknown parent`);
  for (const it of pack.items) {
    total++;
    const s = it.system, where = `${key}: ${it.name} (${it.flags.elaria.ref})`;
    check(/^[A-Za-z0-9]{16}$/.test(it._id), `${where}: bad id ${it._id}`);
    check(!it.folder || folderIds.has(it.folder), `${where}: unknown folder`);
    if (it.type === "gear") {
      check(["weapon", "armour", "trinket", "item"].includes(s.kind), `${where}: kind ${s.kind}`);
      check(s.reqLevel === null || (Number.isInteger(s.reqLevel) && s.reqLevel >= 0 && s.reqLevel <= 20), `${where}: reqLevel ${s.reqLevel}`);
      check(Array.isArray(s.tags) && s.tags.every(t => typeof t === "string" && t), `${where}: tags`);
      check(typeof s.baseAttack.raw === "string" && typeof s.effects === "string" && !s.effects.includes("[object"), `${where}: fields`);
      continue;
    }
    check(CATEGORIES.has(s.category), `${where}: category ${s.category}`);
    check(s.value === null || (Number.isInteger(s.value) && s.value >= 0), `${where}: value ${s.value}`);
    check(s.reqLevel === null || (Number.isInteger(s.reqLevel) && s.reqLevel >= 0 && s.reqLevel <= 20), `${where}: reqLevel ${s.reqLevel}`);
    check(Array.isArray(s.tags) && s.tags.every(t => typeof t === "string" && t), `${where}: tags`);
    check(s.sources.length > 0 && s.sources.every(x => SOURCES.has(x.type)), `${where}: sources ${JSON.stringify(s.sources)}`);
    check(typeof s.skillMod.raw === "string" && typeof s.damage.raw === "string", `${where}: skillMod/damage`);
    check(typeof s.details === "string" && s.details.startsWith("<p>") && !s.details.includes("[object"), `${where}: details`);
  }
}

console.log("Compendium entries:");
for (const [key, pack] of Object.entries(packs)) {
  console.log(`  ${PACKS[key].label.padEnd(32)} ${String(pack.items.length).padStart(5)} entries  ${String(pack.folders.length).padStart(3)} folders`);
}
console.log(`  ${"Total".padEnd(32)} ${String(total).padStart(5)}`);
console.log(`\nShared masteries merged: ${report.merged} copies; kept separate (they differ): ${report.keptSeparate.length}`);
for (const k of report.keptSeparate) console.log(`  - ${k.name} (${k.ref}) ≠ ${k.differsIn.join(", ")}`);
console.log(`Things to check in the sheet: ${conversion.warnings.length}; tags not on the Tags tab: ${conversion.unknownTags.length}`);
console.log(problems.length ? `\n${problems.length} PROBLEMS:\n  ${problems.slice(0, 30).join("\n  ")}` : "\nAll entries pass the checks.");
process.exit(problems.length ? 1 : 0);
