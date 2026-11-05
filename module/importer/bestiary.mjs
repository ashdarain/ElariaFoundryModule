/**
 * Bestiary importer: monster stat blocks → Monster actors. No Foundry dependencies (tools/test-bestiary.mjs).
 *
 * It doesn't go by tab names: every tab is searched for the monster stat block pattern (the "Monster stat block"
 * template the Pre-made monsters tabs use), so new tabs and new monsters are picked up as they're added:
 *
 *   <Name>
 *   Type: <Mob / Minion / Elite / Boss>   Power: <n>      Nature Check …
 *   (picture)                                            Elements: <…>
 *                                                        Creature Size: <…>
 *                                                        <description>
 *                                                        Hp <n>  Ftg <n>  Mp <n>
 *   Stat Mod … Strength(str) <mod> …                     AR: <n>   Passive Awa: <n> …   Elemental Res: <…>
 *   Unique Loot: <…>   Loot Tables: <…>
 *   Name | Skill mod | Cost | Description | Dmg | Tags   (one row per ability)
 *
 * A block starts at a "Type:" cell with a "Power:" cell beside it; the name is the cell above "Type:". Blocks
 * with no name (or "Monster Name") or no power are the empty template and are skipped. Labels are found by
 * text anywhere in the block, so moved columns don't matter.
 */
import { ELARIA } from "../config.mjs";
import * as R from "../rules.mjs";

const STAT_ALIASES = { str: "str", stf: "stf", con: "con", res: "res", fin: "fin", pre: "pre", awa: "awa", dem: "dem",
  smrts: "smrts", smarts: "smrts", spc: "spc", wis: "wis", ins: "ins", lck: "lck", luck: "lck" };
const DEFENCE_LABELS = { "ar": "ar", "mar": "mar", "aar": "aar", "nar": "nar", "nmar": "nmar",
  "passive awa": "passiveAwareness", "passive awareness": "passiveAwareness", "rxn per round": "reacts",
  "reacts per round": "reacts", "reactions per round": "reacts", "crit chance": "critChance", "crit damage": "critDamage",
  "crit dmg": "critDamage", "mv": "mv", "movement": "mv" };
const ABILITY_HEADERS = { name: "name", "skill mod": "skillMod", cost: "cost", description: "description",
  dmg: "damage", damage: "damage", tags: "tags" };
const NA = /^(n\/?a|none|-|—|–)?$/i;

export const BESTIARY_SCHEMA = "1.0.0";

const slug = s => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const num = v => {
  const n = parseFloat(String(v ?? "").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const clean = v => String(v ?? "").replace(/\r/g, "").trim();
const label = v => clean(v).toLowerCase().replace(/\s*:\s*$/, "").replace(/\s+/g, " ");

/** "Ice -25%, Wind 50%" or "-25% Ice, 25% Earth" → { ice: -25, wind: 50 } (elements and forms). */
export function parseResistances(text) {
  const out = {};
  const keys = [...Object.keys(ELARIA.resistanceElements), ...Object.keys(ELARIA.forms)];
  for (const part of clean(text).split(/[,;/]|\band\b/i)) {
    const p = part.trim().toLowerCase();
    if (!p) continue;
    const n = num(p.match(/[+-]?\s*\d+(?:\.\d+)?\s*%?/)?.[0]?.replace(/\s/g, ""));
    const key = keys.find(k => new RegExp(`\\b${k}\\b`).test(p));
    if (key && n !== null) out[key] = (out[key] ?? 0) + n;
  }
  return out;
}

/**
 * @param {Map<string, string[][]>} workbook  from readXlsx
 * @returns {{monsters: object[], warnings: string[], tabs: string[]}}
 */
export function convertBestiary(workbook) {
  const monsters = [], warnings = [], tabs = new Set();
  for (const [sheet, rows] of workbook) {
    const get = (r, c) => clean(rows[r]?.[c]);
    // Block anchors: "Type:" with "Power:" within the next three cells of the row.
    const anchors = [];
    rows.forEach((row, r) => (row ?? []).forEach((v, c) => {
      if (!/^type\s*:/i.test(clean(v))) return;
      for (let cc = c + 1; cc <= c + 3; cc++) if (/^power\s*:/i.test(get(r, cc))) { anchors.push({ r, c, pc: cc }); return; }
    }));
    anchors.forEach((a, i) => {
      const end = i + 1 < anchors.length ? anchors[i + 1].r - 1 : rows.length;
      const name = get(a.r - 1, a.c);
      const type = get(a.r, a.c).replace(/^type\s*:\s*/i, "");
      const powerText = get(a.r, a.pc).replace(/^power\s*:\s*/i, "");
      const where = `${sheet}!row ${a.r}`;
      if (!name || /^monster name$/i.test(name)) return;              // the empty template
      const power = num(powerText);
      if (power === null) { warnings.push(`${where}: "${name}" has no power; skipped`); return; }
      const m = parseBlock(rows, get, a, end, { name, type, power, sheet, row: a.r }, warnings);
      monsters.push(m);
      tabs.add(sheet);
    });
  }
  // The same name twice: keep both, numbered.
  const seen = new Map();
  for (const m of monsters) {
    const n = (seen.get(m.id) ?? 0) + 1;
    seen.set(m.id, n);
    if (n > 1) { m.id = `${m.id}-${n}`; warnings.push(`"${m.name}" appears more than once (${m.source.sheet}); imported as a separate monster`); }
  }
  return { monsters, warnings, tabs: [...tabs] };
}

function parseBlock(rows, get, a, end, base, warnings) {
  const m = {
    id: slug(base.name), name: base.name, type: base.type, power: base.power,
    elements: "", size: "", description: "",
    resources: { hp: null, ftg: null, mp: null },
    stats: {}, defence: {}, elementalRes: "", resistances: {},
    uniqueLoot: "", lootTables: "", abilities: [],
    source: { sheet: base.sheet, row: base.row + 1 }
  };
  const where = `${base.sheet}!row ${base.row + 1} (${base.name})`;
  /** The value of a "Label: value" cell, or the next non-empty cell to its right. */
  const valueOf = (r, c, re) => {
    const inCell = get(r, c).replace(re, "").trim();
    if (inCell) return inCell;
    for (let cc = c + 1; cc < c + 4; cc++) if (get(r, cc)) return get(r, cc);
    return "";
  };
  let sizeCell = null, hpRow = null, abilityHeader = null;
  for (let r = a.r; r < end; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = get(r, c);
      if (!v) continue;
      const l = label(v);
      if (/^elements?\s*:/i.test(v)) m.elements = valueOf(r, c, /^elements?\s*:/i);
      else if (/^(creature )?size\s*:/i.test(v)) { m.size = valueOf(r, c, /^(creature )?size\s*:/i); sizeCell = [r, c]; }
      else if (/^unique loot\s*:/i.test(v)) m.uniqueLoot = valueOf(r, c, /^unique loot\s*:/i);
      else if (/^loot tables?\s*:/i.test(v)) m.lootTables = valueOf(r, c, /^loot tables?\s*:/i);
      else if (/^elemental res(istances?)?\s*:/i.test(v)) m.elementalRes = valueOf(r, c, /^elemental res(istances?)?\s*:/i);
      else if (["hp", "ftg", "mp"].includes(l) && num(get(r, c + 1)) !== null) {
        m.resources[l] = num(get(r, c + 1));
        hpRow ??= r;
      } else if (/\((\w+)\)\s*$/.test(v) && STAT_ALIASES[/\((\w+)\)\s*$/.exec(v)[1].toLowerCase()]) {
        const key = STAT_ALIASES[/\((\w+)\)\s*$/.exec(v)[1].toLowerCase()];
        const mod = num(get(r, c + 1));
        if (mod !== null) m.stats[key] = mod;
      } else if (/:\s*$/.test(v) && DEFENCE_LABELS[l]) {
        let n = num(get(r, c + 1));
        // Crit cells formatted as % come through as fractions (0.05 = 5 %).
        if (n !== null && /^crit/.test(l) && n !== 0 && Math.abs(n) < 1) n = Math.round(n * 100);
        if (n !== null) m.defence[DEFENCE_LABELS[l]] = n;
      } else if (l === "name" && label(get(r, c + 1)) === "skill mod") {
        abilityHeader = { r, cols: {} };
        for (let cc = c; cc < row.length; cc++) {
          const k = ABILITY_HEADERS[label(get(r, cc))];
          if (k && !(k in abilityHeader.cols)) abilityHeader.cols[k] = cc;
        }
      }
    }
  }
  // Description: the text under "Creature Size" (above the Hp row), skipping the picture placeholder.
  if (sizeCell) {
    const parts = [];
    for (let r = sizeCell[0] + 1; r < (hpRow ?? end); r++) {
      const v = get(r, sizeCell[1]);
      if (v && !/^nature check/i.test(v) && !/beautiful pic/i.test(v)) parts.push(v);
    }
    m.description = parts.join("\n\n");
  }
  // Abilities: rows under the header until the block ends (blank rows are skipped).
  if (abilityHeader) {
    const k = abilityHeader.cols;
    for (let r = abilityHeader.r + 1; r < end; r++) {
      const name = get(r, k.name);
      if (!name) continue;
      if (/^nature check/i.test(name)) break;
      const opt = key => (k[key] === undefined ? "" : get(r, k[key]));
      const tags = opt("tags").replace(/\.\s*$/, "").split(",").map(t => t.trim()).filter(t => t && !NA.test(t));
      m.abilities.push({
        name,
        skillMod: NA.test(opt("skillMod")) ? "" : opt("skillMod"),
        cost: NA.test(opt("cost")) ? "" : opt("cost"),
        description: opt("description"),
        damage: NA.test(opt("damage")) ? "" : opt("damage"),
        tags
      });
    }
  } else {
    warnings.push(`${where}: no abilities table found`);
  }
  m.resistances = parseResistances(m.elementalRes);
  const missing = Object.keys(STAT_ALIASES).filter(k => STAT_ALIASES[k] === k && !(k in m.stats));
  if (missing.length) warnings.push(`${where}: no modifier for ${missing.join(", ")} (0 used)`);
  if (m.resources.hp === null) warnings.push(`${where}: no Hp value`);
  return m;
}

/* ------------------------------------------------------------------ */
/*  Actor data                                                         */
/* ------------------------------------------------------------------ */

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHTML = text => clean(text).split(/\n{2,}/).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

/** Mortal unless the type, elements or resistances say Divine / Demonic. */
function formOf(m) {
  const t = `${m.type} ${m.elements}`.toLowerCase();
  if (/\bdemonic\b/.test(t)) return "demonic";
  if (/\bdivine\b/.test(t)) return "divine";
  return "mortal";
}

/** A small stable hash of the parts the importer writes, to tell changed monsters from unchanged ones. */
export function contentHash(obj) {
  const s = JSON.stringify(obj);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/**
 * Actor data for one converted monster. The sheet's AR, Mv, reactions … are kept exactly: the monster sheet
 * works them out from the modifiers, so the difference goes into its Bonus column; resistances likewise
 * (the elements and form give the built-in part, the rest is the bonus).
 */
export function monsterActorData(m) {
  const mods = Object.fromEntries(Object.keys(ELARIA.stats).map(k => [k, m.stats[k] ?? 0]));
  const base = R.monsterSubstatBase(mods);
  const d = m.defence;
  const bonuses = {};
  for (const k of ["nar", "nmar", "aar", "critChance", "critDamage", "mv", "reacts", "passiveAwareness"]) {
    bonuses[k] = d[k] === undefined ? 0 : d[k] - base[k];
  }
  // AR / MAR: what's left after NAR / NMAR and AAR.
  const nar = base.nar + bonuses.nar, nmar = base.nmar + bonuses.nmar, aar = bonuses.aar;
  bonuses.ar = d.ar === undefined ? 0 : d.ar - (nar + aar);
  bonuses.mar = d.mar === undefined ? 0 : d.mar - (nmar + aar);

  const form = formOf(m);
  const elementKeys = R.elementsInText(m.elements, Object.keys(ELARIA.resistanceElements));
  const builtIn = { ...R.elementResistances(elementKeys, ELARIA.elementAffinity), ...R.formResistances(form) };
  // Elements: the sheet's Elemental Res is the whole list (an element it leaves out is 0 %). Forms (Mortal / Divine /
  // Demonic) keep their built-in values unless the sheet names them.
  const resistances = Object.fromEntries([
    ...Object.keys(ELARIA.resistanceElements).map(k => [k, m.elementalRes ? (m.resistances[k] ?? 0) - (builtIn[k] ?? 0) : 0]),
    ...Object.keys(ELARIA.forms).map(k => [k, k in m.resistances ? m.resistances[k] - (builtIn[k] ?? 0) : 0])
  ]);

  const res = k => {
    const v = Math.max(0, Math.round(m.resources[k] ?? 0));
    return { value: v, max: v, temp: 0 };
  };
  const system = {
    details: { type: m.type, power: Math.round(m.power), elements: m.elements, size: m.size, form,
      description: toHTML(m.description) },
    resources: { hp: res("hp"), ftg: res("ftg"), mp: res("mp") },
    stats: Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, { mod: Math.round(v) }])),
    resistances,
    defence: { elementalRes: "" },
    bonuses: Object.fromEntries(Object.entries(bonuses).map(([k, v]) => [k, Math.round(v)])),
    loot: { unique: toHTML(m.uniqueLoot), tables: toHTML(m.lootTables) }
  };
  const items = m.abilities.map((ab, i) => ({
    name: ab.name, type: "ability", sort: (i + 1) * 100000,
    system: {
      skillMod: { raw: ab.skillMod }, damage: { raw: ab.damage }, cost: ab.cost, tags: ab.tags,
      isReaction: ab.tags.some(t => /^(reactions?|rxn)$/i.test(t)) || /\(rxn\)/i.test(ab.name),
      details: toHTML(ab.description)
    }
  }));
  const ref = `bestiary:${m.id}`;
  return {
    name: m.name, type: "monster", system, items,
    flags: { elaria: { imported: true, bestiary: true, ref, hash: contentHash({ name: m.name, system, items }),
      source: m.source } }
  };
}
