/**
 * Elaria Google Sheet → mastery data.
 *
 * Reads the workbook grid (from xlsx.mjs) and produces one data document per discipline, element (and element
 * pair), deity, ancestry and profession, plus one for set masteries and one for bond masteries. The output shape
 * is documented in docs/04-compendium-data.md; build.mjs turns it into Foundry items.
 *
 * Pure JavaScript, no Foundry dependencies, so it is tested in Node by tools/test-convert.mjs.
 */
import { getCloseMatches } from "./difflib.mjs";

/* ================================================================== */
/*  Configuration (which tabs hold what)                               */
/* ================================================================== */

export const DEFAULT_CONFIG = {
  sheets: {
    general: "General Masteries",
    disciplines: [
      "Rogue Masteries", "Skirmisher Masteries", "Ranger Masteries", "Assassin Masteries", "Beastmaster(WIP) Masteries",
      "Saboteur Masteries", "Samurai Masteries", "Warrior Masteries", "Guardian Masteries", "Cavalier Masteries",
      "Ninja Masteries", "Monk Masteries", "Brawler Masteries", "Dragon Mage Masteries", "Spellblade Masteries",
      "Space Mage Masteries", "Summoner Masteries", "Meta Mage Masteries", "Scholar Masteries", "Minstrel Masteries",
      "Psychic Masteries", "Shapeshifter Masteries", "Occultist Masteries", "Merchant Masteries", "War Priest Masteries",
      "Divine Masteries", "Sword Saint Masteries", "Shaman Masteries", "Demonic Lineage Masteries",
      "Super Soldier Masteries", "Vampirism Masteries", "Corruption Masteries (WIP)", "Crow Masteries", "Raven Masteries"
    ],
    disciplineIndex: "Disciplines",
    elemental: "Elemental Masteries",
    set: "Set Masteries",
    bond: "Bond Masteries",
    deity: "Deity Masteries",
    ancestry: "Ancestry",
    professions: [
      { sheet: "Professions" },
      { sheet: "Technomancy and Gnomish Engineering", requirement: "Must be a Gnome" }
    ],
    tags: "Tags",
    gear: "Gear",
    backgrounds: "Backgrounds",
    bursts: "Bursts/Alignment"
  },
  // Tabs that look like mastery tabs but are old copies or helper tables.
  ignoredSheets: [
    "Set Masteries (Discontinued)", "Summoner Masteries old", "Elemental Masteries sortable (needs updating)",
    "Data table (masteries)", "Data Table (set masteries)", "Elemental Masteries Data"
  ],
  deityMoralGroups: {},
  treatAsDevNotes: [
    "Beastmaster(WIP) Masteries!A1", "Saboteur Masteries!A1", "Merchant Masteries!A2",
    "Elemental Masteries!B1", "Elemental Masteries!AA149"
  ],
  // Base-weapon names on the Gear tab that differ from their gear family's name.
  gearBaseAliases: {
    fist: "cestus", heater: "heater-shield", "bo-staff": "stave", "great-axe": "axe", "magic-wand": "wand", "long-bow": "long-bow"
  },
  // New "<X> Masteries" tabs not listed above are converted as disciplines automatically.
  autoDetectDisciplines: true
};

export const SCHEMA_VERSION = "1.0.0";

/* ================================================================== */
/*  Small helpers (Python equivalents)                                 */
/* ================================================================== */

const pyStrip = (s, chars) => {
  if (chars === undefined) return s.trim();
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};
const lstrip = (s, chars) => { let a = 0; while (a < s.length && chars.includes(s[a])) a++; return s.slice(a); };
const isUpperStart = s => s.length ? s[0].toUpperCase() + s.slice(1) : s;
const capitalize = s => s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
const titleCase = s => s.replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
const partition = (s, sep) => { const i = s.indexOf(sep); return i < 0 ? [s, "", ""] : [s.slice(0, i), sep, s.slice(i + sep.length)]; };
const uniq = arr => [...new Set(arr)];
/** Compare tuples (arrays) like Python. */
const cmpTuple = (x, y) => {
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i], b = y[i];
    if (Array.isArray(a)) { const r = cmpTuple(a, b); if (r) return r; continue; }
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return x.length - y.length;
};
const sortBy = (arr, key) => arr.map((v, i) => [key(v), i, v]).sort((p, q) => cmpTuple(p[0], q[0]) || p[1] - q[1]).map(x => x[2]);

/* ================================================================== */
/*  text.py                                                            */
/* ================================================================== */

export function slugify(text) {
  let t = text.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  t = t.toLowerCase().replace(/&/g, " and ");
  t = t.replace(/['’"]/g, "");
  t = t.replace(/[^a-z0-9]+/g, "-");
  return pyStrip(t, "-");
}

export function nameKey(text) {
  let t = stripRxn(text)[0].toLowerCase();
  t = t.replace(/['’"]/g, "");
  return t.replace(/[^a-z0-9]+/g, "");
}

const RXN_RE = /\s*\(\s*rxn\s*\)\s*/i;
const RXN_RE_G = /\s*\(\s*rxn\s*\)\s*/gi;

function stripRxn(name) {
  if (RXN_RE.test(name)) return [name.replace(RXN_RE_G, " ").trim(), true];
  return [name.trim(), false];
}

const STAT_ALIASES = {
  str: "str", strength: "str",
  stf: "stf", steadfast: "stf",
  con: "con", const: "con", constitution: "con",
  res: "res", resilience: "res", resiliance: "res",
  fin: "fin", finesse: "fin",
  pre: "pre", prec: "pre", precision: "pre",
  awa: "awa", aw: "awa", awareness: "awa", awarness: "awa",
  dem: "dem", demeanor: "dem", demeanour: "dem",
  smrts: "smrts", smarts: "smrts", smart: "smrts", smt: "smrts", smrt: "smrts",
  spc: "spc", speech: "spc", speechcraft: "spc",
  wis: "wis", wisdom: "wis",
  ins: "ins", insight: "ins",
  lck: "lck", luck: "lck"
};

export function statCode(word) {
  return STAT_ALIASES[word.trim().toLowerCase().replace(/\.+$/, "")] ?? null;
}

const isNA = v => ["", "n/a", "na", "-", "none"].includes(v.trim().toLowerCase());

const SKILL_RE = /^\s*(\d+)\s*\+\s*([A-Za-z]+)(?:\s*(?:or|\/)\s*([A-Za-z]+))?\s*$/i;

function parseSkillMod(raw) {
  if (isNA(raw)) return null;
  const out = { raw: raw.trim() };
  const m = SKILL_RE.exec(raw);
  if (m) {
    const stats = [m[2], m[3]].filter(x => x).map(statCode);
    if (stats.every(s => s)) {
      out.bonus = parseInt(m[1], 10);
      out.stats = uniq(stats);
    }
  }
  return out;
}

const DMG_RE = /^\s*(\d+)\s*d\s*(\d+)\s*(?:\+\s*([A-Za-z]+?))?\s*(?:x\s*(\d+|#))?\s*(per target)?\s*$/i;

function parseDamage(raw) {
  if (isNA(raw)) return null;
  const out = { raw: raw.trim() };
  const m = DMG_RE.exec(raw);
  if (m) {
    const [, count, sides, stat, hits, per] = m;
    const sc = stat ? statCode(stat) : null;
    if (stat && !sc) return out;
    out.dice = { count: parseInt(count, 10), sides: parseInt(sides, 10) };
    out.stat = sc;
    if (hits === "#") out.hits = "variable";
    else if (hits && parseInt(hits, 10) >= 2) out.hits = parseInt(hits, 10);
    if (per) out.perTarget = true;
  }
  return out;
}

const RESOURCES = {
  ftg: "ftg", fatigue: "ftg", mana: "mp", mp: "mp", hp: "hp", health: "hp",
  ap: "ap", rap: "rap", rage: "rage", tranquility: "tranquility", momentum: "momentum", piety: "piety"
};

function parseCosts(details) {
  const costs = [];
  for (const sent of details.matchAll(/\bcosts?\b([^.]*)/gi)) {
    for (const item of sent[1].matchAll(/\b(\d+|no)\s+([A-Za-z]+)/gi)) {
      const res = RESOURCES[item[2].toLowerCase()];
      if (!res) continue;
      const amount = item[1].toLowerCase() === "no" ? 0 : parseInt(item[1], 10);
      if (!costs.some(c => c.resource === res)) costs.push({ amount, resource: res });
    }
  }
  return costs;
}

const COUNT_WORDS = { once: 1, twice: 2, "three times": 3, "four times": 4, "1 time": 1, "2 times": 2, "3 times": 3 };
const LIMIT_RE = /\b(once|twice|three times|four times|[123] times?)\s+(?:per|a|each)\s+(turn|round|battle|combat|fight|day|week|long rest)\b/i;
const PER = { combat: "battle", fight: "battle", "long rest": "long-rest" };

function parseUsageLimit(details) {
  const m = LIMIT_RE.exec(details);
  if (!m) return null;
  const count = COUNT_WORDS[m[1].toLowerCase()] ?? 1;
  const per = m[2].toLowerCase();
  return { count, per: PER[per] ?? per };
}

const LEVEL_RE = /^\s*(?:lvl\.?\s*)?(\d+)\s*(?:\(\s*(\d+)\s*\))?\s*(\S*)\s*$/i;

/** → [level, alt, odd] */
function parseLevel(raw) {
  if (!raw || !raw.trim()) return [null, null, null];
  const m = LEVEL_RE.exec(raw);
  if (!m) return [null, null, raw.trim()];
  const [, lvl, alt, rest] = m;
  const odd = (alt || rest) ? raw.trim() : null;
  return [parseInt(lvl, 10), alt ? parseInt(alt, 10) : null, odd];
}

const isLevel = raw => parseLevel(raw)[0] !== null;

function parseIntPy(raw) {
  const s = String(raw ?? "").trim();
  if (!/^[+-]?\d+(?:_\d+)*$/.test(s)) return null;
  return parseInt(s.replace(/_/g, ""), 10);
}

function parseBool(raw) {
  const v = String(raw ?? "").trim().toUpperCase();
  return v === "TRUE" ? true : v === "FALSE" ? false : null;
}

class TagNormalizer {
  constructor() {
    this.canon = new Map();
    this.unknown = new Map();
  }
  static key(t) { return t.toLowerCase().replace(/[^a-z0-9]/g, ""); }
  addKnown(t) {
    const k = TagNormalizer.key(t);
    if (!this.canon.has(k)) this.canon.set(k, t);
  }
  normalize(raw) {
    const out = [];
    for (const part of (raw || "").split(/[,\n]/)) {
      let t = pyStrip(pyStrip(part).replace(/^\.+|\.+$/g, ""));
      if (!t || isNA(t)) continue;
      const k = TagNormalizer.key(t);
      if (this.canon.has(k)) t = this.canon.get(k);
      else this.unknown.set(t, (this.unknown.get(t) ?? 0) + 1);
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }
}

function buildMastery({ name, details, skill = "", dmg = "", tags, reqLevel = null, value = null, verified = null, source = null, extra = {} }) {
  const [cleanName, rxn] = stripRxn(name);
  const m = { id: slugify(cleanName), name: cleanName };
  if (rxn) m.isReaction = true;
  for (const k of ["category", "minBondTier"]) if (k in extra) m[k] = extra[k];
  m.reqLevel = reqLevel;
  m.value = value;
  for (const [k, v] of Object.entries(extra)) if (!["category", "minBondTier"].includes(k)) m[k] = v;
  m.details = details;
  m.skillMod = parseSkillMod(skill);
  m.damage = parseDamage(dmg);
  m.tags = tags;
  const costs = parseCosts(details);
  if (costs.length) m.costs = costs;
  const lim = parseUsageLimit(details);
  if (lim) m.usageLimit = lim;
  m.verified = verified;
  if (source) m.source = source;
  return m;
}

function isDevNote(firstLine) {
  const fl = firstLine.trim().toLowerCase();
  return ["*", "idea", "note", "todo", "to do", "need ", "they will"].some(p => fl.startsWith(p));
}

function blockToAppendix(lines) {
  const first = lines[0].trim();
  if (lines.length > 1 && first.length <= 60 && !first.endsWith(".")) {
    return { title: pyStrip(first.replace(/:+$/, "")), content: lines.slice(1).join("\n").trim() };
  }
  return { title: "Notes", content: lines.join("\n").trim() };
}

/* ================================================================== */
/*  sheets.py — Grid                                                   */
/* ================================================================== */

function colLetter(c) {
  let s = "";
  c += 1;
  while (c) {
    const rem = (c - 1) % 26;
    c = Math.floor((c - 1) / 26);
    s = String.fromCharCode(65 + rem) + s;
  }
  return s;
}

function cleanText(v) {
  const lines = String(v).replace(/\r\n/g, "\n").split("\n").map(ln => ln.trimEnd());
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((ln, i) => (i === 0 ? ln.trim() : ln)).join("\n").trim();
}

class Grid {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows;
    this.consumed = new Set();
  }
  get length() { return this.rows.length; }
  get(r, c) {
    if (r < 0 || c < 0 || r >= this.rows.length) return "";
    return this.rows[r][c] ?? "";
  }
  s(r, c) { return this.get(r, c).trim(); }
  take(r, c) {
    const v = this.s(r, c);
    if (v) this.consumed.add(`${r},${c}`);
    return v;
  }
  takeRaw(r, c) {
    const v = this.get(r, c);
    if (v.trim()) this.consumed.add(`${r},${c}`);
    return cleanText(v);
  }
  nonempty(r) {
    if (r < 0 || r >= this.rows.length) return [];
    const out = [];
    const row = this.rows[r];
    for (let c = 0; c < row.length; c++) {
      const v = (row[c] ?? "").trim();
      if (v) out.push([c, v]);
    }
    return out;
  }
  /** → [[r, c, value]] in row-major order */
  find(pred, rows = null, cols = null) {
    const out = [];
    const rr = rows ?? range(0, this.rows.length);
    for (const r of rr) {
      if (r < 0 || r >= this.rows.length) continue;
      const row = this.rows[r];
      for (let c = 0; c < row.length; c++) {
        if (cols && !cols.includes(c)) continue;
        const sv = (row[c] ?? "").trim();
        if (sv && pred(sv)) out.push([r, c, sv]);
      }
    }
    return out;
  }
  firstRight(r, c, limit = 12) {
    for (let cc = c + 1; cc < c + 1 + limit; cc++) {
      if (this.s(r, cc)) return [cc, this.s(r, cc)];
    }
    return [-1, ""];
  }
  static a1(r, c) { return `${colLetter(c)}${r + 1}`; }

  leftoverBlocks(rowRange = null) {
    const cells = [];
    const rr = rowRange ?? range(0, this.rows.length);
    for (const r of rr) {
      for (const [c] of this.nonempty(r)) if (!this.consumed.has(`${r},${c}`)) cells.push([r, c]);
    }
    const key = (r, c) => `${r},${c}`;
    const cellset = new Set(cells.map(([r, c]) => key(r, c)));
    const seen = new Set();
    const blocks = [];
    for (const start of cells) {
      if (seen.has(key(...start))) continue;
      const stack = [start], comp = [];
      seen.add(key(...start));
      while (stack.length) {
        const [r, c] = stack.pop();
        comp.push([r, c]);
        for (const dr of [-1, 0, 1]) {
          for (let dc = -3; dc <= 3; dc++) {
            const k = key(r + dr, c + dc);
            if (cellset.has(k) && !seen.has(k)) { seen.add(k); stack.push([r + dr, c + dc]); }
          }
        }
      }
      comp.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const lines = [];
      let curR = null, cur = [];
      for (const [r, c] of comp) {
        if (r !== curR && cur.length) { lines.push(cur.join(" ")); cur = []; }
        curR = r;
        cur.push(cleanText(this.get(r, c)));
      }
      if (cur.length) lines.push(cur.join(" "));
      blocks.push({ row: comp[0][0], col: Math.min(...comp.map(x => x[1])), lines });
    }
    blocks.sort((a, b) => a.row - b.row || a.col - b.col);
    return blocks;
  }
}

function range(a, b) {
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/* ================================================================== */
/*  common.py                                                          */
/* ================================================================== */

const CATEGORIES = ["basic", "utility", "offensive", "defensive", "support"];

class Context {
  constructor(config, sheets) {
    this.config = config;
    this.sheets = sheets;
    this.tags = new TagNormalizer();
    this.warnings = [];
    this.notes = [];
  }
  warn(where, msg) { this.warnings.push([where, msg]); }
  note(where, msg) { this.notes.push([where, msg]); }
  sheet(name) {
    let g = this.sheets.get(name);
    if (!g && this.sheets.has(xlsxSheetName(name))) {
      g = this.sheets.get(xlsxSheetName(name));
      g.name = name;
    }
    if (!g) this.warn(name, "tab not found in the spreadsheet");
    return g ?? null;
  }
}

/** How a Google tab name comes out in an .xlsx export (31 chars max, no / \ ? * [ ] :). */
function xlsxSheetName(name) {
  return name.replace(/[/\\?*[\]:]/g, "-").slice(0, 31);
}

const src = (grid, r, c) => ({ sheet: grid.name, row: r + 1, column: Grid.a1(r, c).replace(/\d+$/, "") });

const HEADER_ALIASES = {
  "req. lvl": "level", "req lvl": "level", "lvl unlocked at": "level",
  value: "value", name: "name", details: "details", effect: "details",
  description: "details", "skill mod": "skill", dmg: "dmg", damage: "dmg",
  tags: "tags", tag: "tags", verified: "verified", "req. ele": "element",
  "mastery type": "category", "min. bond tier": "bondTier", "bond tier": "bondTier",
  "req. masteries": "requirements", combination: "requirements"
};

/** Ordered map field → column (a plain object keeps insertion order for string keys). */
function headerMap(grid, r, anchorCol, maxSpan = 14) {
  const cols = {};
  for (let c = Math.max(0, anchorCol - 2); c < anchorCol + maxSpan; c++) {
    const key = HEADER_ALIASES[grid.s(r, c).toLowerCase()];
    if (!key) continue;
    if (key === "level" && c !== anchorCol && "level" in cols) break;
    if ((key === "element" || key === "verified") && c > anchorCol + 1 && !("tags" in cols)) break;
    if (!(key in cols)) cols[key] = c;
    if (key === "verified" && c > anchorCol) break;
  }
  return cols;
}

function findTables(grid, anchorLabel = "req. lvl") {
  const tables = [];
  const labels = [anchorLabel, anchorLabel.replace(/\./g, "")];
  for (const [r, c] of grid.find(x => labels.includes(x.toLowerCase()))) {
    const cols = headerMap(grid, r, c);
    if (!("name" in cols)) continue;
    const first = Math.min(...Object.values(cols));
    let title = null;
    for (let tc = first - 1; tc <= c; tc++) {
      const t = grid.s(r - 1, tc);
      if (t.toLowerCase().endsWith("masteries")) { title = t; grid.take(r - 1, tc); break; }
    }
    for (const cc of Object.values(cols)) grid.take(r, cc);
    tables.push({ headerRow: r, cols, title, rows: dataRows(grid, r, cols) });
  }
  return tables;
}

function isDataRow(grid, r, cols) {
  const name = grid.s(r, cols.name);
  const lvl = "level" in cols ? grid.s(r, cols.level) : "";
  if (!name || name.toLowerCase() === "name") return false;
  if ("level" in cols) return isLevel(lvl) || (!lvl && !!grid.s(r, cols.details ?? -1));
  return true;
}

function dataRows(grid, headerRow, cols) {
  const rows = [];
  let r = headerRow + 1;
  while (r < grid.length) {
    if (isDataRow(grid, r, cols)) { rows.push(r); r++; continue; }
    const blank = !Object.values(cols).some(c => grid.s(r, c));
    if (blank && isDataRow(grid, r + 1, cols)) { r++; continue; }
    break;
  }
  return rows;
}

function categoryFromTitle(title) {
  if (!title) return null;
  const w = (title.split(/\s+/).filter(x => x)[0] ?? "").toLowerCase();
  return CATEGORIES.includes(w) ? w : null;
}

function verifiedCell(grid, r, cols) {
  const candidates = [];
  if ("verified" in cols) candidates.push(cols.verified);
  if ("tags" in cols) candidates.push(cols.tags + 1);
  candidates.push(Math.min(...Object.values(cols)) - 1);
  for (const c of candidates) {
    const b = parseBool(grid.s(r, c));
    if (b !== null) { grid.take(r, c); return b; }
  }
  return null;
}

function readMasteryRow(ctx, grid, r, cols, extra = {}) {
  const g = k => (k in cols ? grid.takeRaw(r, cols[k]) : "");
  const [lvl, , odd] = parseLevel(g("level"));
  if (odd) ctx.warn(`${grid.name}!${Grid.a1(r, cols.level)}`, `unusual level cell ${JSON.stringify(odd)}`);
  const name = g("name"), details = g("details"), skill = g("skill"), dmg = g("dmg");
  const tags = ctx.tags.normalize(g("tags"));
  const value = "value" in cols ? parseIntPy(g("value")) : null;
  return buildMastery({
    name, details, skill, dmg, tags, reqLevel: lvl, value,
    verified: verifiedCell(grid, r, cols), source: src(grid, r, Math.min(...Object.values(cols))), extra
  });
}

function dedupeIds(ctx, where, masteries) {
  const out = [];
  const seen = new Map();
  for (const m of masteries) {
    if (!m.id) m.id = "unnamed";
    if (!seen.has(m.id)) { seen.set(m.id, m); out.push(m); continue; }
    const prev = seen.get(m.id);
    if (prev.details === m.details) {
      ctx.warn(where, `duplicate mastery ${JSON.stringify(m.name)} dropped (row ${m.source?.row})`);
      continue;
    }
    let n = 2;
    while (seen.has(`${m.id}-${n}`)) n++;
    ctx.warn(where, `two different masteries named ${JSON.stringify(m.name)}; second one saved as id '${m.id}-${n}'`);
    m.id = `${m.id}-${n}`;
    seen.set(m.id, m);
    out.push(m);
  }
  return out;
}

function pushTo(entity, key, value) {
  if (!entity[key]) entity[key] = [];
  entity[key].push(value);
}

function attachLeftovers(ctx, grid, entity, rowRange = null) {
  attachBlocks(ctx, grid, grid.leftoverBlocks(rowRange), entity);
  for (const r of rowRange ?? range(0, grid.length)) {
    for (const [c] of grid.nonempty(r)) grid.consumed.add(`${r},${c}`);
  }
}

function attachBlocks(ctx, grid, blocks, entity) {
  const forced = new Set(ctx.config.treatAsDevNotes ?? []);
  for (const b of blocks) {
    const addr = `${grid.name}!${Grid.a1(b.row, b.col)}`;
    const numeric = b.lines.every(ln => /^(?:[\d\s.,%]*|TRUE|FALSE)$/.test(ln.trim()));
    if (forced.has(addr) || numeric || isDevNote(b.lines[0])) {
      pushTo(entity, "devNotes", b.lines.join("\n"));
    } else {
      pushTo(entity, "appendices", blockToAppendix(b.lines));
      ctx.note(addr, `appendix on '${entity.id}': ${JSON.stringify(b.lines[0].slice(0, 60))}`);
    }
  }
}

function attachByRows(ctx, grid, entities, fallback = null) {
  const blocks = grid.leftoverBlocks();
  const starts = entities.map(([s]) => s);
  for (const b of blocks) {
    let idx = null;
    starts.forEach((s, i) => { if (s <= b.row) idx = i; });
    if (idx === null) {
      const target = fallback ?? (entities.length ? entities[0][1] : null);
      if (!target) continue;
      pushTo(target, "devNotes", b.lines.join("\n"));
    } else {
      attachBlocks(ctx, grid, [b], entities[idx][1]);
    }
  }
  for (let r = 0; r < grid.length; r++) for (const [c] of grid.nonempty(r)) grid.consumed.add(`${r},${c}`);
}

function fileHeader(type, id, name, grid) {
  const h = { schemaVersion: SCHEMA_VERSION, type, id, name };
  if (grid) h.source = { sheet: grid.name };
  return h;
}

const cleanClassName = text => text.replace(/\s*\((?:wip|WIP)\)\s*/g, " ").trim();
const classId = name => slugify(cleanClassName(name));

/* ================================================================== */
/*  discipline.py                                                      */
/* ================================================================== */

function parseClassLine(text) {
  const [name, , rest] = partition(text, ":");
  const info = { name: name.trim(), subdisciplines: [], requirement: null, countsAsClassPick: true };
  const reqs = [];
  for (const m of rest.matchAll(/\(([^)]*)\)/g)) {
    const pl = m[1].toLowerCase();
    if (pl.includes("doesnt count") || pl.includes("doesn't count")) info.countsAsClassPick = false;
    else if (pl.startsWith("req")) reqs.push(m[1].trim());
  }
  const body = rest.replace(/\(([^)]*)\)/g, (m0, g1) => {
    const l = g1.toLowerCase();
    return (l.startsWith("req") || l.startsWith("doesnt") || l.startsWith("doesn't")) ? "" : m0;
  });
  info.subdisciplines = body.split(/[,.]/).map(s => s.trim()).filter(s => s);
  if (reqs.length) info.requirement = reqs.map(isUpperStart).join("; ");
  return info;
}

function readDisciplineIndex(ctx) {
  const name = ctx.config.sheets.disciplineIndex;
  const grid = name ? ctx.sheets.get(name) : null;
  const out = {};
  if (!grid) return out;
  for (let r = 0; r < grid.length; r++) {
    for (const [, v] of grid.nonempty(r)) {
      if (v.includes(":") && v.split(":")[0].length <= 25 && !v.startsWith("Ex.") && !v.startsWith("*")) {
        const info = parseClassLine(v);
        out[classId(info.name)] = info;
      }
    }
  }
  return out;
}

function parseFocus(text) {
  const body = text.includes(":") ? text.split(":").slice(1).join(":") : text;
  const out = [];
  for (let w of body.toLowerCase().split(/[,\s]+/)) {
    w = { defense: "defensive", offense: "offensive" }[w] ?? w;
    if (CATEGORIES.includes(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

const masterySortKey = m => [CATEGORIES.indexOf(m.category), m.reqLevel || 0, m.source.row];

function convertDiscipline(ctx, sheetName, index, general = false) {
  const grid = ctx.sheet(sheetName);
  if (!grid) return null;
  const wip = sheetName.toLowerCase().includes("wip");
  const discName = cleanClassName(sheetName.replace(/\s*Masteries\s*/g, " ")).trim();
  const did = classId(discName);
  const where = sheetName;

  const tables = findTables(grid);
  if (!tables.length) ctx.warn(where, "no mastery tables found");
  const firstTableRow = (tables.length ? Math.min(...tables.map(t => t.headerRow)) : grid.length) - 1;

  const doc = fileHeader("discipline", did, discName, grid);
  if (wip) doc.status = "wip";
  const meta = index[did] ?? {};
  doc.subdisciplines = meta.subdisciplines ?? [];
  doc.focus = [];
  doc.description = null;
  doc.availability = {
    pickable: !general,
    countsAsClassPick: meta.countsAsClassPick ?? !general,
    requirement: meta.requirement ?? null
  };

  for (const [r, c, v] of grid.find(() => true, range(0, Math.max(firstTableRow, 0)))) {
    const low = v.toLowerCase();
    if (low === "discipline description") {
      grid.take(r, c);
      doc.description = grid.takeRaw(r + 1, c) || null;
    } else if (/^(mastery )?focus\s*:/.test(low) || (low.endsWith("focus") && parseFocus(v).length)) {
      grid.take(r, c);
      doc.focus = parseFocus(v);
    } else if (v.includes(":") && classId(v.split(":")[0]) === did && c <= 2) {
      grid.take(r, c);
      const info = parseClassLine(v);
      doc.subdisciplines = info.subdisciplines;
      if (info.requirement && !doc.availability.requirement) doc.availability.requirement = info.requirement;
      if (!info.countsAsClassPick) doc.availability.countsAsClassPick = false;
    }
  }

  if (general && doc.subdisciplines.length) {
    doc.description = doc.description || `${capitalize(doc.subdisciplines.join(", "))}.`;
    doc.subdisciplines = [];
  }

  let masteries = [];
  for (const t of tables) {
    const cat = categoryFromTitle(t.title);
    if (!cat) {
      ctx.warn(`${where}!${Grid.a1(t.headerRow, t.cols.name)}`, `table has no recognisable category title (${JSON.stringify(t.title)}); skipped`);
      continue;
    }
    for (const r of t.rows) masteries.push(readMasteryRow(ctx, grid, r, t.cols, { category: cat }));
  }
  masteries = sortBy(masteries, masterySortKey);
  doc.masteries = dedupeIds(ctx, where, masteries);
  attachLeftovers(ctx, grid, doc);
  return doc;
}

/* ================================================================== */
/*  elemental.py                                                       */
/* ================================================================== */

export const ELEMENTS = ["fire", "ice", "lightning", "wind", "water", "earth", "light", "dark", "nature", "poison"];

function elementKey(raw) {
  const v = raw.trim().toLowerCase();
  if (v === "any" || v === "all") return ["any", []];
  let parts = v.split(/[/,&+]/).map(p => p.trim()).filter(p => p);
  if (!parts.length || parts.some(p => !ELEMENTS.includes(p)) || parts.length > 2) return null;
  parts = uniq(parts).sort((a, b) => ELEMENTS.indexOf(a) - ELEMENTS.indexOf(b));
  return [parts.length === 1 ? "prime" : "combo", parts];
}

function convertElemental(ctx, sheetName) {
  const grid = ctx.sheet(sheetName);
  if (!grid) return [];
  const tables = findTables(grid);
  const files = new Map();
  const getFile = (kind, elems) => {
    const fid = kind === "any" ? "any" : elems.join("-");
    if (!files.has(fid)) {
      const name = kind === "any" ? "Any Element" : elems.map(titleCase).join(" / ");
      const doc = fileHeader("elemental", fid, name, grid);
      Object.assign(doc, { kind, elements: elems, description: null, masteries: [] });
      files.set(fid, doc);
    }
    return files.get(fid);
  };

  for (const t of tables) {
    const cat = categoryFromTitle(t.title);
    if (!("element" in t.cols)) {
      ctx.warn(sheetName, `table at row ${t.headerRow + 1} has no 'Req. Ele' column; skipped`);
      continue;
    }
    for (const r of t.rows) {
      const rawEle = grid.take(r, t.cols.element);
      const key = elementKey(rawEle);
      if (!key) {
        ctx.warn(`${sheetName}!${Grid.a1(r, t.cols.element)}`, `unknown element ${JSON.stringify(rawEle)}; row skipped`);
        continue;
      }
      let rowCat = cat;
      if ("category" in t.cols) {
        const words = grid.take(r, t.cols.category).split(/\s+/).filter(x => x);
        rowCat = (words[0] ?? "").toLowerCase() || cat;
      }
      if (!CATEGORIES.includes(rowCat)) {
        ctx.warn(`${sheetName}!${Grid.a1(r, t.cols.name)}`, "no category for row; skipped");
        continue;
      }
      getFile(...key).masteries.push(readMasteryRow(ctx, grid, r, t.cols, { category: rowCat }));
    }
  }

  for (const [r, c, v] of grid.find(x => x.toLowerCase().endsWith(" description"))) {
    const head = v.slice(0, v.lastIndexOf(" "));
    const key = elementKey(head);
    if (key && key[0] === "prime") {
      grid.take(r, c);
      const text = grid.takeRaw(r + 1, c);
      getFile(...key).description = text || null;
    }
  }

  for (const doc of files.values()) {
    doc.masteries = dedupeIds(ctx, `${sheetName} (${doc.id})`, sortBy(doc.masteries, masterySortKey));
  }
  const anyDoc = getFile("any", []);
  attachLeftovers(ctx, grid, anyDoc);
  const kinds = ["any", "prime", "combo"];
  return sortBy([...files.values()], d => [kinds.indexOf(d.kind), d.elements.map(e => ELEMENTS.indexOf(e))]);
}

/* ================================================================== */
/*  bond.py                                                            */
/* ================================================================== */

const RANGE_RE = /^\s*(\d+)\s*(?:to|-)\s*(\d+)\s*$/;

function convertBond(ctx, sheetName) {
  const grid = ctx.sheet(sheetName);
  if (!grid) return null;
  const doc = fileHeader("bond-masteries", "bond-masteries", "Bond Masteries", grid);
  doc.rules = []; doc.tierTable = [];
  let masteries = [];

  const tierHdr = grid.find(x => x.toLowerCase() === "max bond tier")[0];
  if (tierHdr) {
    const [hr, tc] = tierHdr;
    const lc = tc - 1;
    grid.take(hr, tc); grid.take(hr, lc);
    for (let r = 0; r < hr; r++) {
      for (const [c, v] of grid.nonempty(r)) {
        const text = grid.takeRaw(r, c);
        if (v.toLowerCase().startsWith("idea") || v.toLowerCase().startsWith("*")) pushTo(doc, "devNotes", text);
        else doc.rules.push(text);
      }
    }
    let r = hr + 1;
    while (RANGE_RE.test(grid.s(r, lc))) {
      const [, lo, hi] = RANGE_RE.exec(grid.take(r, lc));
      const row = { minLevel: parseInt(lo, 10), maxLevel: parseInt(hi, 10), maxBondTier: parseIntPy(grid.take(r, tc)) };
      const note = grid.take(r, tc + 1);
      row.newMasteries = note.toLowerCase().includes("new");
      doc.tierTable.push(row);
      r++;
    }
  } else {
    ctx.warn(sheetName, "couldn't find the 'Max Bond Tier' table");
  }

  for (const [r, c] of grid.find(x => ["min. bond tier", "bond tier"].includes(x.toLowerCase()))) {
    const cols = headerMap(grid, r, c);
    if (!("name" in cols)) continue;
    for (const cc of Object.values(cols)) grid.take(r, cc);
    const title = grid.s(r - 1, c);
    if (title.toLowerCase().startsWith("empty template")) { grid.take(r - 1, c); continue; }
    if (title.toLowerCase().startsWith("tier")) grid.take(r - 1, c);
    let rr = r + 1;
    const rowCols = Object.fromEntries(Object.entries(cols).filter(([k]) => k !== "bondTier"));
    while (parseIntPy(grid.s(rr, cols.bondTier)) !== null && grid.s(rr, cols.name)) {
      const tier = parseIntPy(grid.take(rr, cols.bondTier));
      masteries.push(readMasteryRow(ctx, grid, rr, rowCols, { minBondTier: tier }));
      rr++;
    }
  }
  masteries = sortBy(masteries, m => [m.minBondTier, m.source.row]);
  doc.masteries = dedupeIds(ctx, sheetName, masteries);
  attachLeftovers(ctx, grid, doc);
  return doc;
}

/* ================================================================== */
/*  set_masteries.py                                                   */
/* ================================================================== */

const HEAD_COLON_RE = /^\s*(?:(\d+)\s+)?([^:,]+?)\s*(\d+)?\s*:\s*([\s\S]*)$/;
const HEAD_COMMA_RE = /^\s*(\d+)\s+([^:,]+?)\s*,\s*([\s\S]*)$/;

function classRef(name, classes) {
  const key = slugify(name);
  if (key === "profession" || key === "professions") return { type: "profession", id: "any" };
  return { ...(classes[key] ?? { type: "discipline", id: key }) };
}

const isClass = (name, classes) => {
  const k = slugify(name);
  return k in classes || k === "profession" || k === "professions";
};

function parseRequirements(raw, classes, ctx, where) {
  const clauses = [];
  for (const sent of raw.trim().split(/\.\s+|\.$|\s+(?=\d+\s+[A-Za-z][A-Za-z' ]*:)/)) {
    if (!sent || !sent.trim()) continue;
    let m = HEAD_COLON_RE.exec(sent);
    if (m && isClass(m[2], classes)) {
      const count = m[1] || m[3];
      clauses.push([count ? parseInt(count, 10) : null, m[2].trim(), m[4]]);
      continue;
    }
    m = HEAD_COMMA_RE.exec(sent);
    if (m && isClass(m[2], classes)) {
      clauses.push([parseInt(m[1], 10), m[2].trim(), m[3]]);
      continue;
    }
    if (clauses.length) clauses[clauses.length - 1][2] += `, ${sent}`;
  }
  const out = [];
  for (const [count, cls, body] of clauses) {
    const names = body.split(/,(?![^(]*\))/).map(n => pyStrip(pyStrip(n).replace(/^\.+|\.+$/g, ""))).filter(n => n);
    const items = names.map(n => ({ name: n, ref: null }));
    out.push({ count: count || items.length, class: classRef(cls, classes), masteries: items });
  }
  if (!out.length && raw.trim()) ctx.warn(where, `requirements are free text, kept as written: ${JSON.stringify(raw.slice(0, 80))}`);
  return out.filter(c => c.masteries.length);
}

function reorderSet(m) {
  const keys = ["id", "name", "isReaction", "reqLevel", "reqLevelAlt", "reqLevelRaw", "value", "requirementsRaw", "requirements"];
  const out = {};
  for (const k of keys) if (k in m) out[k] = m[k];
  for (const [k, v] of Object.entries(m)) if (!(k in out)) out[k] = v;
  return out;
}

function convertSetMasteries(ctx, sheetName, classes) {
  const grid = ctx.sheet(sheetName);
  if (!grid) return null;
  const doc = fileHeader("set-masteries", "set-masteries", "Set Masteries", grid);
  doc.rules = []; doc.groups = []; doc.masteries = [];
  const byId = new Map();
  let group = null;

  const headers = grid.find(x => x.toLowerCase() === "req. masteries").map(([r, c]) => [r, c]);
  const firstHeader = headers.length ? headers[0][0] : grid.length;
  const headerRows = new Set(headers.map(([hr]) => hr));

  for (let r = 0; r < grid.length; r++) {
    const cells = grid.nonempty(r);
    if (r < firstHeader - 2) {
      for (const [c, v] of cells) {
        const l = v.toLowerCase();
        if (!l.startsWith("empty template") && !l.startsWith("combo")) doc.rules.push(lstrip(grid.takeRaw(r, c), "*").trim());
      }
      continue;
    }
    const combo = cells.find(([, v]) => v.toLowerCase().startsWith("combo"));
    if (combo) {
      const title = cells.find(([c]) => c < combo[0])?.[1] ?? "";
      for (const [c] of cells) grid.take(r, c);
      if (title.toLowerCase().startsWith("empty template")) { group = null; continue; }
      const afterColon = combo[1].includes(":") ? combo[1].slice(combo[1].indexOf(":") + 1) : "";
      const combos = afterColon.split(",").map(x => x.trim()).filter(x => x && !x.includes("?"));
      group = { class: classRef(title, classes), combos: combos.map(x => classRef(x, classes)), masteryIds: [] };
      doc.groups.push(group);
      continue;
    }
    if (headerRows.has(r + 1) && cells.length === 1 && cells[0][0] <= 2) {
      const title = grid.take(r, cells[0][0]);
      group = null;
      if (slugify(title) in classes) {
        group = { class: classRef(title, classes), combos: [], masteryIds: [] };
        doc.groups.push(group);
      }
      continue;
    }
    if (headerRows.has(r)) {
      const reqC = headers.find(([hr]) => hr === r)[1];
      const cols = headerMap(grid, r, reqC);
      cols.level = reqC - 1;
      for (const [c] of cells) grid.take(r, c);
      let rr = r + 1;
      while (rr < grid.length && !headerRows.has(rr)) {
        const name = grid.s(rr, cols.name);
        if (name.toLowerCase().startsWith("combo")) break;
        const rowCells = grid.nonempty(rr).map(([c]) => c);
        if (!rowCells.length) break;
        if (!name) {
          const note = rowCells.filter(c => !["N/A", "FALSE", "TRUE"].includes(grid.s(rr, c).toUpperCase()))
            .map(c => grid.takeRaw(rr, c)).join(" | ");
          for (const c of rowCells) grid.take(rr, c);
          pushTo(doc, "devNotes", `Unnamed row ${rr + 1}: ${note}`);
          ctx.warn(`${sheetName}!${Grid.a1(rr, cols.name)}`, "row has no mastery name; kept as a designer note");
          rr++;
          continue;
        }
        const where = `${sheetName}!${Grid.a1(rr, cols.name)}`;
        const [lvl, alt, odd] = parseLevel(grid.take(rr, cols.level));
        const rawReq = grid.takeRaw(rr, cols.requirements);
        let m = buildMastery({
          name: grid.takeRaw(rr, cols.name), details: grid.takeRaw(rr, cols.details ?? -1),
          skill: grid.takeRaw(rr, cols.skill ?? -1), dmg: grid.takeRaw(rr, cols.dmg ?? -1),
          tags: ctx.tags.normalize(grid.takeRaw(rr, cols.tags ?? -1)), reqLevel: lvl, value: null,
          verified: verifiedCell(grid, rr, cols), source: src(grid, rr, cols.level)
        });
        if (alt !== null) m.reqLevelAlt = alt;
        if (odd) m.reqLevelRaw = odd;
        m.requirementsRaw = rawReq;
        m.requirements = parseRequirements(rawReq, classes, ctx, where);
        m = reorderSet(m);
        let existing = byId.get(m.id);
        if (existing && existing.details !== m.details) {
          ctx.warn(where, `set mastery ${JSON.stringify(m.name)} appears twice with different text; kept both`);
          m.id += `-${[...byId.keys()].filter(k => k.startsWith(m.id)).length + 1}`;
          existing = null;
        }
        if (!existing) { byId.set(m.id, m); doc.masteries.push(m); }
        if (group && !group.masteryIds.includes(m.id)) group.masteryIds.push(m.id);
        rr++;
      }
    }
  }
  doc.masteries = sortBy(doc.masteries, m => [m.name.toLowerCase()]);
  attachLeftovers(ctx, grid, doc);
  return doc;
}

/* ================================================================== */
/*  deity.py                                                           */
/* ================================================================== */

const GOD_RE = /^\s*([^,]+?)\s*,\s*(.+?)\s*(?:\(([^)]*)\))?\s*$/;
const FIELD_LABELS = { "god domains": "domains", alignment: "alignment", "ways to increase piety": "pietyGains", "typical enemies": "typicalEnemies" };
const splitList = text => text.split(",").map(x => x.trim()).filter(x => x);

function readDeityTable(ctx, grid, hr, hc, doc) {
  const cols = headerMap(grid, hr, hc);
  for (const c of Object.values(cols)) grid.take(hr, c);
  const pc = grid.nonempty(hr).find(([, v]) => v.toLowerCase() === "preferred stat")?.[0] ?? null;
  if (pc !== null) {
    grid.take(hr, pc);
    const val = grid.take(hr, pc + 1);
    doc.preferredStat = val ? statCode(val) : null;
    if (val && !doc.preferredStat) ctx.warn(grid.name, `unknown preferred stat ${JSON.stringify(val)} for ${doc.id}`);
  }
  const masteries = [];
  let r = hr + 1;
  while (grid.s(r, cols.name)) {
    masteries.push(readMasteryRow(ctx, grid, r, cols));
    if (pc !== null) {
      const slot = grid.s(r, pc);
      const m = /^unique (curse|boon)\s*(\d+)/i.exec(slot);
      if (m) {
        grid.take(r, pc);
        const note = grid.takeRaw(r, pc + 1);
        const entry = { slot: parseInt(m[2], 10), name: null, details: null };
        if (note.startsWith("*")) entry.scalesWithPiety = note.toLowerCase().includes("piety");
        else if (note) entry.details = note;
        doc[m[1].toLowerCase() === "curse" ? "curses" : "boons"].push(entry);
      }
    }
    r++;
  }
  return [masteries, r];
}

function convertDeities(ctx, sheetName) {
  const grid = ctx.sheet(sheetName);
  if (!grid) return [];
  let docs = [];
  const godCells = sortBy(grid.find(x => x.toLowerCase() === "god name"), x => x);
  const headers = sortBy(grid.find(x => x.toLowerCase() === "lvl unlocked at"), x => x);
  const starts = godCells.map(([r]) => r);

  godCells.forEach(([r, c], i) => {
    grid.take(r, c);
    const [vc, full] = grid.firstRight(r, c);
    grid.take(r, vc);
    const m = GOD_RE.exec(full);
    const [name, title, realm] = m ? [m[1], m[2], m[3] ?? null] : [full, null, null];
    const gid = slugify(name) || slugify(title ?? "") || `deity-${i + 1}`;
    const doc = fileHeader("deity", gid, slugify(name) ? name : (title || name), grid);
    doc.source.row = r + 1;
    Object.assign(doc, {
      title, realm, domains: [], alignment: null, moralGroup: ctx.config.deityMoralGroups?.[gid] ?? null,
      preferredStat: null, pietyGains: [], typicalEnemies: [], curses: [], boons: []
    });
    let rr = r + 1;
    while (grid.s(rr, c).toLowerCase() in FIELD_LABELS) {
      const key = FIELD_LABELS[grid.take(rr, c).toLowerCase()];
      const [vcol, val] = grid.firstRight(rr, c);
      grid.take(rr, vcol);
      if (key === "alignment") doc.alignment = val || null;
      else if (key === "domains") doc.domains = val ? val.split(/,| and /).map(x => x.trim()).filter(x => x) : [];
      else doc[key] = splitList(val);
      rr++;
    }
    const nxt = i + 1 < starts.length ? starts[i + 1] : grid.length;
    const hdr = headers.find(([hr]) => rr <= hr && hr < nxt);
    if (!hdr) { ctx.warn(sheetName, `no mastery table for god ${JSON.stringify(name)}`); return; }
    const [masteries, end] = readDeityTable(ctx, grid, hdr[0], hdr[1], doc);
    doc.masteries = dedupeIds(ctx, `${sheetName} (${gid})`, masteries);
    doc._rows = [r, end];
    docs.push(doc);
  });

  for (const [hr, hc] of headers) {
    if (docs.some(d => d._rows[0] <= hr && hr < d._rows[1])) continue;
    let labelR = null, label = null;
    outer: for (let rr = hr - 1; rr > Math.max(hr - 4, -1); rr--) {
      for (const [cc, v] of grid.nonempty(rr)) {
        if (v.toLowerCase().endsWith("masteries")) { labelR = rr; label = grid.s(rr, cc); break outer; }
      }
    }
    const name = (label || "Other").replace(/\s*Masteries\s*$/, "").trim();
    if (labelR !== null) {
      for (const [cc, v] of grid.nonempty(labelR)) if (v.toLowerCase().endsWith("masteries")) grid.take(labelR, cc);
    }
    const doc = fileHeader("deity", slugify(name), name, grid);
    doc.source.row = hr + 1;
    Object.assign(doc, { title: null, realm: null, domains: [], alignment: null, moralGroup: null,
      preferredStat: null, pietyGains: [], typicalEnemies: [], curses: [], boons: [] });
    const [masteries, end] = readDeityTable(ctx, grid, hr, hc, doc);
    doc.masteries = dedupeIds(ctx, `${sheetName} (${doc.id})`, masteries);
    doc._rows = [hr, end];
    docs.push(doc);
  }

  docs = sortBy(docs, d => [d._rows[0]]);
  attachByRows(ctx, grid, docs.map(d => [d._rows[0], d]));
  for (const d of docs) delete d._rows;
  return docs;
}

/* ================================================================== */
/*  profession.py                                                      */
/* ================================================================== */

const LVL_RE = /^\s*lvl\s*\d+\s*$/i;
const CRAFT_ALIASES = { "req lvl": "level", "req. lvl": "level", name: "name", description: "description",
  "material needed": "materials", materials: "materials", tier: "tier", "tier minimum": "tier" };

function convertProfessions(ctx, sheetName, requirement = null) {
  const grid = ctx.sheet(sheetName);
  if (!grid) return [];
  const craftHeaderRows = new Set(grid.find(x => ["req lvl", "req. lvl"].includes(x.toLowerCase())).map(([r]) => r));
  const descCells = grid.find(x => x.toLowerCase() === "description")
    .filter(([r]) => !craftHeaderRows.has(r) && grid.nonempty(r).length <= 3).map(([r, c]) => [r, c]);
  const docs = [];
  descCells.forEach(([dr, dc], i) => {
    const end = i + 1 < descCells.length ? descCells[i + 1][0] - 1 : grid.length;
    let nc = null, name = "";
    for (let c = dc; c < dc + 3; c++) if (grid.s(dr - 1, c)) { nc = c; name = grid.s(dr - 1, c); break; }
    if (!name) { ctx.warn(`${sheetName}!${Grid.a1(dr, dc)}`, "profession block without a name above 'Description'"); return; }
    grid.take(dr - 1, nc);
    grid.take(dr, dc);
    const pid = slugify(name);
    const doc = fileHeader("profession", pid, name, grid);
    doc.source.row = dr;
    doc.description = grid.takeRaw(dr, dc + 1) || null;
    doc.unlockedBy = [];
    doc.requirement = requirement;

    const vhdr = grid.find(x => x.toLowerCase() === "value", range(dr, end))[0];
    const masteries = [];
    if (vhdr) {
      grid.take(vhdr[0], vhdr[1]);
      const vcol = vhdr[1];
      for (let r = vhdr[0] + 1; r < end; r++) {
        const lc = grid.nonempty(r).find(([c, v]) => LVL_RE.test(v) && c < vcol)?.[0] ?? null;
        if (lc === null) { if (masteries.length) break; continue; }
        const lvl = parseLevel(grid.take(r, lc))[0];
        const [ncol, mname] = grid.firstRight(r, lc);
        grid.take(r, ncol);
        const [dcol] = grid.firstRight(r, ncol);
        const details = (dcol >= 0 && dcol < vcol) ? grid.takeRaw(r, dcol) : "";
        masteries.push(buildMastery({ name: mname, details, tags: [], reqLevel: lvl,
          value: parseIntPy(grid.take(r, vcol)), source: src(grid, r, lc) }));
      }
    } else {
      ctx.warn(sheetName, `profession ${JSON.stringify(name)} has no 'Value' column / masteries`);
    }
    doc.masteries = dedupeIds(ctx, `${sheetName} (${pid})`, masteries);

    const craft = grid.find(x => x.toLowerCase() === "crafting", range(dr, end))[0];
    if (craft) {
      grid.take(craft[0], craft[1]);
      const crafting = { note: null, items: [] };
      let hr = null;
      for (let r = craft[0] + 1; r < Math.min(craft[0] + 3, end); r++) if (craftHeaderRows.has(r)) { hr = r; break; }
      if (hr === null) {
        crafting.note = grid.takeRaw(craft[0] + 1, craft[1]) || null;
      } else {
        const cols = {};
        for (const [c, v] of grid.nonempty(hr)) {
          const k = CRAFT_ALIASES[v.toLowerCase()];
          if (k && !(k in cols)) { cols[k] = c; grid.take(hr, c); }
        }
        let r = hr + 1;
        while (r < end && grid.s(r, cols.name ?? -1)) {
          const item = {
            id: slugify(grid.s(r, cols.name)),
            reqLevel: parseLevel(grid.take(r, cols.level ?? -1))[0],
            name: grid.takeRaw(r, cols.name),
            description: grid.takeRaw(r, cols.description ?? -1) || null,
            materials: grid.takeRaw(r, cols.materials ?? -1) || null
          };
          item.tierMinimum = parseIntPy(grid.take(r, cols.tier ?? -1));
          crafting.items.push(item);
          r++;
        }
      }
      doc.crafting = crafting;
    }
    docs.push([dr - 1, doc]);
  });
  attachByRows(ctx, grid, docs);
  return docs.map(([, d]) => d);
}

/* ================================================================== */
/*  ancestry.py                                                        */
/* ================================================================== */

const ANC_RE = /^-?\s*lvl\.?\s*(\d+)\s*:?\s+([^,;:]+?)\s*[,;:]\s*([\s\S]*)$/i;
const STATMOD_RE = /^([+-])\s*(\d+(?:\.\d+)?)\s*(%?)\s*(.+)$/;
const DERIVED = { nar: "nar", nmar: "nmar", ar: "ar", mar: "mar", aar: "aar",
  "max mana": "max-mana", "max mp": "max-mana", mana: "max-mana",
  "max fatigue": "max-fatigue", "max ftg": "max-fatigue", "max hp": "max-hp",
  "crit chance": "crit-chance", "critical chance": "crit-chance",
  "crit damage": "crit-damage", "crit dmg": "crit-damage", "critical damage": "crit-damage",
  "all stats": "all", all: "all" };

const statTarget = word => {
  const w = word.trim().toLowerCase().replace(/\.+$/, "");
  return statCode(w) ?? DERIVED[w] ?? null;
};

function parseStatMods(raw, ctx, where) {
  const body = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  if (["", "none", "no mods", "n/a"].includes(body.trim().toLowerCase())) return [];
  const out = [];
  for (const part of body.split(",")) {
    const m = STATMOD_RE.exec(part.trim());
    if (!m) { ctx.warn(where, `couldn't read stat mod ${JSON.stringify(part.trim())}`); continue; }
    const [, sign, num, pct, rest] = m;
    let amount = num.includes(".") ? parseFloat(num) : parseInt(num, 10);
    if (sign === "-") amount = -amount;
    const choice = /\bor\b/.test(rest) ? "one" : "each";
    const targets = rest.split(/\bor\b|\band\b/).map(statTarget);
    if (!targets.every(t => t)) { ctx.warn(where, `couldn't read stat mod ${JSON.stringify(part.trim())}`); continue; }
    const mod = { amount, targets: uniq(targets) };
    if (pct) mod.unit = "percent";
    if (targets.length > 1) mod.choice = choice;
    out.push(mod);
  }
  return out;
}

function abilityPrefix(text) {
  const [head, sep] = partition(lstrip(text, "-").trim(), ":");
  return sep && head.length <= 30 && head.split(/\s+/).filter(x => x).length <= 4 ? head.trim() : null;
}

function abilityGroup(texts) {
  const common = texts.map(abilityPrefix).filter(p => p);
  if (texts.length >= 2 && common.length) {
    const counts = new Map();
    for (const p of common) counts.set(p, (counts.get(p) ?? 0) + 1);
    let top = null, best = 0;
    for (const [p, n] of counts) if (n > best) { top = p; best = n; }
    if (best >= 2 && best * 2 > texts.length) return top;
  }
  return null;
}

function parseAbility(text, group, fallback) {
  let t = lstrip(text, "-").trim();
  if (group && abilityPrefix(t) === group) t = t.slice(t.indexOf(":") + 1).trim();
  if (abilityPrefix(t)) {
    const i = t.indexOf(":");
    return [t.slice(0, i).trim(), t.slice(i + 1).trim()];
  }
  const semi = t.indexOf(";");
  if (semi >= 0 && semi <= 60) return [t.slice(0, semi).trim(), t.slice(semi + 1).trim()];
  const comma = t.indexOf(",");
  if (comma >= 0 && comma <= 40 && t.slice(0, comma).split(/\s+/).filter(x => x).length <= 5
      && !["once", "when", "you", "all", "any"].some(p => t.slice(0, comma).toLowerCase().startsWith(p))) {
    return [t.slice(0, comma).trim(), t.slice(comma + 1).trim()];
  }
  const short = t.replace(/\.+$/, "");
  if (short.split(/\s+/).filter(x => x).length <= 7) return [short, t];
  return [fallback, t];
}

function convertAncestries(ctx, sheetName) {
  const grid = ctx.sheet(sheetName);
  if (!grid) return [];
  const starts = range(0, grid.length - 1).filter(r => grid.s(r, 1) && grid.s(r + 1, 1).toLowerCase() === "race pic");
  const docs = [];
  starts.forEach((r0, i) => {
    const r1 = i + 1 < starts.length ? starts[i + 1] : grid.length;
    const name = grid.take(r0, 1);
    const rid = slugify(name);
    const where = `${sheetName} (${rid})`;
    const doc = fileHeader("ancestry", rid, name, grid);
    doc.source.row = r0 + 1;
    const verifiedCellPair = grid.nonempty(r0).find(([, v]) => parseBool(v) !== null);
    const verified = verifiedCellPair ? parseBool(verifiedCellPair[1]) : null;
    for (const [c, v] of grid.nonempty(r0)) if (parseBool(v) !== null) grid.take(r0, c);
    grid.take(r0 + 1, 1);
    Object.assign(doc, { verified, image: null, description: null, passives: [] });

    const rows = range(r0, r1);
    const cell = pred => grid.find(pred, rows)[0] ?? null;
    const d = cell(v => v.toLowerCase().startsWith("description:"));
    if (d) doc.description = grid.takeRaw(d[0], d[1]).replace(/^description:\s*/i, "");
    const heritage = cell(v => v.toLowerCase() === "heritage");
    const herRow = heritage ? heritage[0] : r1;
    const anc = cell(v => v.toLowerCase() === "ancestral masteries");
    const pas = cell(v => v.toLowerCase() === "passives");
    if (pas) {
      grid.take(pas[0], pas[1]);
      const stop = anc ? anc[0] : herRow;
      for (let rr = pas[0] + 1; rr < stop; rr++) if (grid.s(rr, pas[1])) doc.passives.push(grid.takeRaw(rr, pas[1]));
    }

    const masteries = [];
    if (anc) {
      const [ar, ac] = anc;
      grid.take(ar, ac);
      const vcol = grid.nonempty(ar).find(([, v]) => v.toLowerCase() === "value")?.[0] ?? null;
      const tcol = grid.nonempty(ar).find(([, v]) => v.toLowerCase() === "tags")?.[0] ?? null;
      for (const c of [vcol, tcol]) if (c !== null) grid.take(ar, c);
      for (let rr = ar + 1; rr < herRow; rr++) {
        const text = grid.s(rr, ac);
        if (!text) continue;
        if (!ANC_RE.test(text)) {
          ctx.warn(`${sheetName}!${Grid.a1(rr, ac)}`, `ancestral mastery not in 'Lvl N Name, details' form: ${JSON.stringify(text.slice(0, 50))}`);
          continue;
        }
        const full = grid.takeRaw(rr, ac);
        const m = ANC_RE.exec(full);
        masteries.push(buildMastery({
          name: m[2], details: m[3].trim(), tags: ctx.tags.normalize(tcol !== null ? grid.takeRaw(rr, tcol) : ""),
          reqLevel: parseInt(m[1], 10), value: vcol !== null ? parseIntPy(grid.take(rr, vcol)) : null,
          source: src(grid, rr, ac)
        }));
      }
    } else {
      ctx.warn(where, "no 'Ancestral Masteries' section");
    }
    doc.masteries = dedupeIds(ctx, where, masteries);

    doc.heritages = [];
    if (heritage) {
      grid.take(heritage[0], heritage[1]);
      const hc = heritage[1];
      const hstarts = range(herRow + 1, r1).filter(rr =>
        grid.s(rr, hc) && grid.nonempty(rr).some(([, v]) => v.toLowerCase().startsWith("description:")));
      hstarts.forEach((h0, j) => {
        const h1 = j + 1 < hstarts.length ? hstarts[j + 1] : r1;
        const hname = grid.take(h0, hc);
        const [dcol] = grid.nonempty(h0).find(([, v]) => v.toLowerCase().startsWith("description:"));
        const her = {
          id: slugify(hname), name: hname,
          description: grid.takeRaw(h0, dcol).replace(/^description:\s*/i, "") || null
        };
        let sm = null;
        for (let rr = h0 + 1; rr < h1; rr++) if (grid.s(rr, hc).toLowerCase().startsWith("stat mods")) { sm = [rr, grid.s(rr, hc)]; break; }
        if (sm) {
          grid.take(sm[0], hc);
          her.statModsRaw = sm[1].includes(":") ? sm[1].slice(sm[1].indexOf(":") + 1).trim() : sm[1];
          her.statMods = parseStatMods(sm[1], ctx, `${sheetName}!${Grid.a1(sm[0], hc)}`);
        } else {
          her.statMods = [];
        }
        let tcol = null;
        outer: for (let rr = h0; rr < h1; rr++) for (const [c, v] of grid.nonempty(rr)) if (v.toLowerCase() === "tags") { tcol = c; break outer; }
        for (let rr = h0; rr < h1; rr++) if (tcol !== null && grid.s(rr, tcol).toLowerCase() === "tags") grid.take(rr, tcol);
        const abilities = [];
        const aRows = range(h0 + 1, h1).filter(rr => grid.s(rr, dcol) && !(sm && rr === sm[0] && dcol === hc));
        const group = abilityGroup(aRows.map(rr => grid.s(rr, dcol)));
        aRows.forEach((rr, n0) => {
          const n = n0 + 1;
          const full = grid.takeRaw(rr, dcol);
          let [aname, details] = parseAbility(full, group, `${group || hname} trait ${n}`);
          if (aname.endsWith(`trait ${n}`)) ctx.warn(`${sheetName}!${Grid.a1(rr, dcol)}`, `${hname} ability has no name in the sheet; shown as '${aname}'`);
          const req = grid.s(rr, dcol - 1);
          if (req && req.toLowerCase().startsWith("req")) {
            grid.take(rr, dcol - 1);
            details = `(${req}) ${details}`.trim();
          }
          abilities.push(buildMastery({ name: aname, details,
            tags: ctx.tags.normalize(tcol !== null ? grid.takeRaw(rr, tcol) : ""),
            reqLevel: null, value: 0, source: src(grid, rr, dcol) }));
        });
        her.abilityGroup = group;
        her.abilities = dedupeIds(ctx, `${where} / ${hname}`, abilities);
        her.source = src(grid, h0, hc);
        if (!abilities.length) ctx.warn(where, `heritage ${JSON.stringify(hname)} has no abilities`);
        doc.heritages.push(her);
      });
    } else {
      ctx.warn(where, "no 'Heritage' section");
    }
    docs.push([r0, doc]);
  });
  attachByRows(ctx, grid, docs, null);
  return docs.map(([, d]) => d);
}

/* ================================================================== */
/*  links.py                                                           */
/* ================================================================== */

const mref = (type, fileId, masteryId) => `${type}:${fileId}/${masteryId}`;

function namesIndex(masteries) {
  const out = new Map();
  for (const m of masteries) out.set(nameKey(m.name), m.id);
  for (const m of masteries) {
    const head = m.name.split(",")[0];
    if (head !== m.name && !out.has(nameKey(head))) out.set(nameKey(head), m.id);
  }
  return out;
}

function findIn(names, k, fuzzy = true) {
  if (!k) return [null, ""];
  if (names.has(k)) return [names.get(k), "exact"];
  const pref = [...names.keys()].filter(key => key.startsWith(k));
  if (pref.length === 1) return [names.get(pref[0]), "prefix"];
  const close = fuzzy ? getCloseMatches(k, names.keys(), 1, 0.86) : [];
  if (close.length) return [names.get(close[0]), "fuzzy"];
  return [null, ""];
}

/** idx: Map<"type|id", {cls: [type, id], names: Map}> */
function lookup(ctx, idx, cls, name, where, warn = true, fuzzy = true) {
  const k = nameKey(name);
  const isAnyProf = cls[0] === "profession" && cls[1] === "any";
  const scopes = isAnyProf ? [...idx.values()].filter(e => e.cls[0] === "profession").map(e => e.cls) : [cls];
  const scopeKeys = new Set(scopes.map(c => c.join("|")));
  for (const c of scopes) {
    const [mid, how] = findIn(idx.get(c.join("|"))?.names ?? new Map(), k, fuzzy);
    if (mid) {
      if (how === "fuzzy" && warn) ctx.warn(where, `requirement ${JSON.stringify(name)} matched by similar spelling to ${c[1]}/${mid}`);
      return mref(c[0], c[1], mid);
    }
  }
  const hits = [...idx.values()].filter(e => e.names.has(k) && !scopeKeys.has(e.cls.join("|")));
  if (hits.length === 1) {
    const [t, fid] = hits[0].cls;
    if (warn) ctx.warn(where, `requirement ${JSON.stringify(name)} is listed under ${fid}, not ${cls[1]}; linked there`);
    return mref(t, fid, hits[0].names.get(k));
  }
  return null;
}

function alternatives(name) {
  let body = name.trim();
  if (body.startsWith("(") && body.endsWith(")")) body = body.slice(1, -1);
  const parts = body.split(/\s+or\s+|\s*\/\s*(?=[A-Z])/).map(p => p.trim()).filter(p => p);
  if (parts.length < 2) return [];
  const first = parts[0].split(/\s+/).filter(x => x), last = parts[parts.length - 1].split(/\s+/).filter(x => x);
  return parts.map((p, i) => {
    const w = p.split(/\s+/).filter(x => x);
    let expanded = null;
    if (i > 0 && w.length === 1 && first.length > 1) expanded = [...first.slice(0, -1), ...w].join(" ");
    else if (i < parts.length - 1 && w.length === 1 && last.length > 1) expanded = [...w, ...last.slice(1)].join(" ");
    return expanded ? [expanded, p] : [p];
  });
}

function resolveRequirement(ctx, idx, cls, item, where) {
  const name = item.name;
  let r = lookup(ctx, idx, cls, name, where, true, false);
  if (r) { item.ref = r; return; }
  if (/\bany\b/i.test(name)) { item.generic = true; return; }
  const alts = alternatives(name);
  if (alts.length) {
    item.options = [];
    for (const cands of alts) {
      let hit = null;
      for (const c of cands) { const rr = lookup(ctx, idx, cls, c, where); if (rr) { hit = [c, rr]; break; } }
      item.options.push(hit ? { name: hit[0], ref: hit[1] } : { name: cands[cands.length - 1], ref: null });
    }
    const missing = item.options.filter(o => !o.ref).map(o => o.name);
    if (missing.length) ctx.warn(where, `requirement option(s) ${JSON.stringify(missing)} not found in ${cls[0]} '${cls[1]}'`);
    return;
  }
  r = lookup(ctx, idx, cls, name, where);
  if (r) { item.ref = r; return; }
  ctx.warn(where, `requirement ${JSON.stringify(name)} not found in ${cls[0]} '${cls[1]}'`);
}

function* refsOf(items) {
  for (const it of items) {
    if (it.ref) yield it.ref;
    for (const o of it.options ?? []) if (o.ref) yield o.ref;
  }
}

function linkAll(ctx, out) {
  const { disciplines, elements } = out;
  const idx = new Map();
  const addIdx = (type, id, masteries) => idx.set(`${type}|${id}`, { cls: [type, id], names: namesIndex(masteries) });
  for (const d of disciplines) addIdx("discipline", d.id, d.masteries);
  for (const e of elements) addIdx("elemental", e.id, e.masteries);

  // 1. alsoIn: the same mastery name in several disciplines
  const byName = new Map();
  for (const d of disciplines) for (const m of d.masteries) {
    const k = nameKey(m.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(mref("discipline", d.id, m.id));
  }
  for (const d of disciplines) for (const m of d.masteries) {
    const self = mref("discipline", d.id, m.id);
    const others = byName.get(nameKey(m.name)).filter(r => r !== self);
    if (others.length) m.alsoIn = others;
  }

  for (const p of out.professions) addIdx("profession", p.id, p.masteries);

  // 2. set requirements
  if (out.set) {
    for (const m of out.set.masteries) {
      const where = `set-masteries/${m.id}`;
      for (const req of m.requirements) {
        const cls = [req.class.type, req.class.id];
        for (const item of req.masteries) resolveRequirement(ctx, idx, cls, item, where);
        if (cls[0] === "profession" && cls[1] === "any") {
          const ids = new Set([...refsOf(req.masteries)].map(r => r.split(":")[1].split("/")[0]));
          if (ids.size === 1) req.class.id = [...ids][0];
        }
      }
    }
  }

  // 3. which "Profession: X" masteries unlock each profession
  const profs = new Map(out.professions.map(p => [p.id, p]));
  for (const d of disciplines) for (const m of d.masteries) {
    const mt = /^profession\s*:\s*(.+)$/i.exec(m.name);
    if (!mt) continue;
    const pname = mt[1].replace(/\(.*?\)/g, "").trim();
    let pid = slugify(pname);
    if (!profs.has(pid)) {
      const pref = [...profs.keys()].filter(k => k.startsWith(`${pid}-`));
      const close = pref.length === 1 ? pref : getCloseMatches(pid, profs.keys(), 1, 0.8);
      pid = close.length ? close[0] : pid;
    }
    if (profs.has(pid)) profs.get(pid).unlockedBy.push(mref("discipline", d.id, m.id));
    else ctx.warn(`discipline:${d.id}/${m.id}`, `unlocks profession ${JSON.stringify(pname)}, which has no profession block`);
  }
  for (const p of profs.values()) if (!p.unlockedBy.length) ctx.warn(`profession:${p.id}`, "no 'Profession: ...' mastery unlocks this profession");
}

function classMap(disciplines, elementNames) {
  const out = {};
  for (const d of disciplines) {
    out[slugify(d.name)] = { type: "discipline", id: d.id };
    out[d.id] = { type: "discipline", id: d.id };
    out[d.id.replace(/-/g, "")] = { type: "discipline", id: d.id };
  }
  for (const e of elementNames) out[e] = { type: "elemental", id: e };
  return out;
}

/* ================================================================== */
/*  run.py                                                             */
/* ================================================================== */

function knownTags(ctx) {
  const name = ctx.config.sheets.tags;
  const grid = name ? ctx.sheets.get(name) : null;
  if (!grid) return [];
  const hdr = grid.find(x => x.toLowerCase() === "name")[0];
  if (!hdr) return [];
  const out = [];
  for (let r = hdr[0] + 1; r < grid.length; r++) {
    let v = grid.s(r, hdr[1]);
    if (!v) continue;
    if (v.includes(":")) v = v.split(":")[0];
    if (v.length <= 40) out.push(v.trim());
  }
  return out;
}


/* ================================================================== */
/*  gear.py                                                            */
/* ================================================================== */

const TIER_RE = /^\s*tier\s*(\d+)\s*\(\s*lvl\s*(\d+)\s*\)/i;
const GEAR_LVL_RE = /^\s*lvl\s*(\d+)\s*$/i;
const AR_RE = /^\s*(\d+)\s*AAR\s*$/i;
const NUM_AFTER_RE = /(\d+)/;
const MAT_RE = /^\s*(\d+)\s+(.+?)\s*$/;
const WEIGHTS = new Set(["light", "medium", "heavy"]);
const GEAR_LABELS = ["description", "effects", "materials", "tags"];

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripLabel = (text, label) => text.replace(new RegExp(`^\\s*${escapeRe(label)}\\s*:?\\s*`, "i"), "").trim();

function parseMaterials(raw) {
  const out = [];
  for (const part of (raw || "").split(/,|\band\b/)) {
    const m = MAT_RE.exec(part.trim());
    if (m) {
      const mat = m[2].trim().replace(/\.+$/, "");
      out.push({ amount: parseInt(m[1], 10), material: mat.toLowerCase().endsWith("artifacts") ? mat.toLowerCase().replace(/s$/, "") : mat.toLowerCase() });
    }
  }
  return out;
}

/** 'Fist (claws(small bladed), heavy blunt)(note)' → ['claws(small bladed), heavy blunt', 'note'] */
function topLevelGroups(text) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if (ch === "(") {
      if (depth) cur += ch;
      depth++;
    } else if (ch === ")" && depth) {
      depth--;
      if (depth) cur += ch;
      else { out.push(pyStrip(cur.trim(), ",").trim()); cur = ""; }
    } else if (depth) cur += ch;
  }
  return out.filter(o => o);
}

function parseAffinity(raw) {
  if (!raw) return null;
  const opts = [];
  for (let p of raw.split(/\/|\bor\b|,/)) {
    p = p.trim().toLowerCase().replace(/ /g, "-");
    if (!p) continue;
    if (["non-elemental", "nonelemental", "non-element", "none"].includes(p)) p = "non-elemental";
    opts.push(p);
  }
  return { raw: raw.trim(), options: opts };
}

function parseDamageType(raw) {
  if (!raw) return null;
  const low = raw.toLowerCase().replace(/\./g, "");
  const nature = low.startsWith("phy") ? "physical" : low.startsWith("mag") ? "magical" : null;
  const words = low.split(/[\s/]+/).filter(w => w && !w.startsWith("phy") && !w.startsWith("mag"));
  const out = { raw: raw.trim() };
  if (nature) out.nature = nature;
  if (words.length) out.type = words.join(" ");
  return out;
}

function splitGearTags(raw) {
  const out = [];
  for (let t of raw.split(/[,\n\t]/)) {
    t = pyStrip(t.trim(), ".");
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function familyCategory(title, afterUniques) {
  const low = title.toLowerCase();
  if (afterUniques) return "unique";
  if (low.includes("armour") || low.includes("armor")) return "armour";
  if (low.includes("trinket")) return "trinket";
  return "weapon";
}

function itemKind(tags, statAr) {
  const low = new Set(tags.map(t => t.toLowerCase()));
  if (statAr || [...low].some(t => t.includes("armour") || t.includes("armor"))) return "armour";
  if (low.has("trinket")) return "trinket";
  return "weapon";
}

function readGearCard(ctx, grid, r, x, tier, stop) {
  const where = `${grid.name}!${Grid.a1(r, x)}`;
  const name = grid.takeRaw(r, x);
  const lvl = GEAR_LVL_RE.exec(grid.take(r, x + 2));
  const item = { id: slugify(name), name, tier, reqLevel: lvl ? parseInt(lvl[1], 10) : null };

  const prof = grid.s(r - 1, x);
  if (prof.toLowerCase().startsWith("prof")) item.proficiency = stripLabel(grid.take(r - 1, x), "prof");

  const s1 = grid.s(r + 1, x), s2 = grid.s(r + 1, x + 1), s3 = grid.s(r + 1, x + 2);
  const isStatRow = !(s1.toLowerCase().startsWith("equip") || s1.toLowerCase().startsWith("description"))
    && !s2.toLowerCase().startsWith("breakpoint");
  let statAr = false;
  if (isStatRow) {
    for (const c of [x, x + 1, x + 2]) grid.take(r + 1, c);
    if (AR_RE.test(s1)) {
      item.armourRating = parseInt(AR_RE.exec(s1)[1], 10);
      statAr = true;
    } else if (s1) {
      item.baseAttack = parseDamage(s1);
    }
    if (s2) {
      if (WEIGHTS.has(s2.toLowerCase())) item.weight = s2.toLowerCase();
      else item.damageType = parseDamageType(s2);
    }
    item.affinity = parseAffinity(s3);
  }

  const blocks = {};
  for (let rr = r + 1; rr < stop; rr++) {
    const a = grid.s(rr, x), b = grid.s(rr, x + 1);
    if (a.toLowerCase().startsWith("equip load")) {
      const m = NUM_AFTER_RE.exec(a);
      item.equipLoad = m ? parseIntPy(m[1]) : null;
      grid.take(rr, x);
      if (b.toLowerCase().startsWith("breakpoint")) {
        const mb = NUM_AFTER_RE.exec(b);
        item.breakpoint = mb ? parseInt(mb[1], 10) : null;
        grid.take(rr, x + 1);
      }
      continue;
    }
    for (const label of GEAR_LABELS) {
      if (a.toLowerCase().startsWith(label)) blocks[label] = stripLabel(grid.takeRaw(rr, x), label);
    }
    if (grid.s(rr, x + 3) === ">") grid.take(rr, x + 3);
  }
  if (!("equipLoad" in item)) item.equipLoad = null;
  if (!("breakpoint" in item)) item.breakpoint = null;
  item.description = blocks.description || null;
  item.effects = blocks.effects || null;
  if (item.effects && ["no special effects", "none"].includes(item.effects.toLowerCase().replace(/\.+$/, ""))) item.effects = null;
  const rawMats = blocks.materials ?? "";
  item.materialsRaw = rawMats || null;
  item.materials = parseMaterials(rawMats);
  if (rawMats && !item.materials.length) ctx.warn(where, `couldn't read materials ${pyRepr(rawMats)}`);
  item.tags = splitGearTags(blocks.tags ?? "");
  item.kind = itemKind(item.tags, statAr);
  item.source = src(grid, r, x);
  return item;
}

const pyRepr = s => (s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/'/g, "\\'")}'`);

const GEAR_ITEM_ORDER = ["id", "name", "kind", "tier", "reqLevel", "path", "evolvesFrom", "proficiency",
  "baseAttack", "damageType", "armourRating", "weight", "affinity", "equipLoad", "breakpoint",
  "description", "effects", "materialsRaw", "materials", "tags", "source"];

function orderGearItem(it) {
  const out = {};
  for (const k of GEAR_ITEM_ORDER) if (k in it) out[k] = it[k];
  for (const [k, v] of Object.entries(it)) if (!(k in out)) out[k] = v;
  return out;
}

function convertGear(ctx, sheetName) {
  const grid = ctx.sheet(sheetName);
  if (!grid) return [[], null, null];

  const tierRows = range(0, grid.length).filter(r => grid.nonempty(r).some(([, v]) => TIER_RE.test(v)));
  const uniquesRow = grid.find(v => v.toLowerCase() === "uniques")[0]?.[0] ?? null;
  const classRows = grid.find(v => v.toLowerCase().endsWith("class trinket designs")).map(([r]) => r).sort((a, b) => a - b);
  const hardStops = [...new Set([...tierRows, ...classRows, ...(uniquesRow !== null ? [uniquesRow] : [])])].sort((a, b) => a - b);
  const nextStop = tr => hardStops.find(s => s > tr) ?? grid.length;

  const families = [];
  for (const tr of tierRows) {
    const titleCells = grid.nonempty(tr - 1);
    if (!titleCells.length) continue;
    const [titleCol, title] = titleCells[0];
    if (title.toLowerCase().startsWith("empty template")) {
      const end = nextStop(tr) - 1;
      for (let rr = tr - 1; rr < end; rr++) for (const [c] of grid.nonempty(rr)) grid.take(rr, c);
      continue;
    }
    grid.take(tr - 1, titleCol);
    const tiers = new Map();
    for (const [c, v] of grid.nonempty(tr)) {
      const m = TIER_RE.exec(v);
      if (m) {
        tiers.set(c, [parseInt(m[1], 10), parseInt(m[2], 10)]);
        grid.take(tr, c);
      }
    }
    const end = nextStop(tr) - 1;

    const clean = title.replace(/\s*\(needs descriptions?\)\s*/gi, "").trim();
    const fam = fileHeader("gear", slugify(clean), clean, grid);
    fam.source.row = tr;
    fam.category = familyCategory(clean, uniquesRow !== null && tr > uniquesRow);
    if (title.toLowerCase().includes("needs description")) pushTo(fam, "devNotes", "Marked in the sheet as needing descriptions.");
    for (const [c, v] of titleCells.slice(1)) {
      grid.take(tr - 1, c);
      if (v.includes(":") && fam.category === "trinket") fam.focus = partition(v, ":")[2].trim();
      else pushTo(fam, "devNotes", v);
    }
    fam.tiers = [...tiers.values()].sort((a, b) => a[0] - b[0]).map(([t, lvl]) => ({ tier: t, reqLevel: lvl }));

    const cards = [];
    const nameRows = [];
    for (let r = tr + 1; r < end; r++) {
      const rowCards = [];
      for (const [x, [t]] of tiers) {
        if (GEAR_LVL_RE.test(grid.s(r, x + 2)) && grid.s(r, x)) rowCards.push([x, t]);
      }
      if (rowCards.length) nameRows.push([r, rowCards]);
    }
    nameRows.forEach(([r, rowCards], i) => {
      const stop = i + 1 < nameRows.length ? nameRows[i + 1][0] - 1 : end;
      for (const [x, t] of rowCards) cards.push([r, t, readGearCard(ctx, grid, r, x, t, stop)]);
    });

    const pathOfRow = new Map(nameRows.map(([r], n) => [r, n + 1]));
    const items = [];
    const seenIds = new Set();
    const sorted = [...cards].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [r, t, it] of sorted) {
      let parent = null;
      const sameRow = cards.filter(c => c[0] === r && c[1] === t - 1);
      if (sameRow.length) parent = sameRow[0][2];
      else if (t > 1) {
        const above = cards.filter(c => c[0] < r && c[1] === t - 1);
        parent = above.length ? above.reduce((best, c) => (c[0] > best[0] ? c : best))[2] : null;
      }
      if (seenIds.has(it.id)) {
        let n = 2;
        while (seenIds.has(`${it.id}-${n}`)) n++;
        ctx.warn(`${sheetName}!${Grid.a1(r, 0)}`, `two items named ${pyRepr(it.name)} in ${clean}; second saved as '${it.id}-${n}'`);
        it.id = `${it.id}-${n}`;
      }
      seenIds.add(it.id);
      it.path = pathOfRow.get(r);
      it.evolvesFrom = parent ? parent.id : null;
      if (t > 1 && !parent) ctx.warn(`${sheetName}!${Grid.a1(r, 0)}`, `${pyRepr(it.name)} (tier ${t}) has nothing to evolve from`);
      items.push(orderGearItem(it));
    }
    if (!items.length) ctx.warn(sheetName, `gear family ${pyRepr(clean)} has no items`);
    fam.items = items;
    for (let rr = tr + 1; rr < end; rr++) for (const [c, v] of grid.nonempty(rr)) if (v === ">") grid.take(rr, c);
    fam._rows = [tr - 1, end];
    families.push(fam);
  }

  readGearBaseTables(ctx, grid, families);
  const classDoc = readClassTrinkets(ctx, grid, classRows);
  const overview = readGearOverview(ctx, grid, uniquesRow);

  const entities = families.map(f => [f._rows[0], f]);
  if (classDoc) { entities.push([classDoc._start, classDoc]); delete classDoc._start; }
  entities.sort((a, b) => a[0] - b[0]);
  attachByRows(ctx, grid, entities, overview);
  for (const f of families) delete f._rows;
  return [families, classDoc, overview];
}

function readGearBaseTables(ctx, grid, families) {
  const aliases = Object.fromEntries(Object.entries(ctx.config.gearBaseAliases ?? {}).map(([k, v]) => [slugify(k), v]));
  const bySlug = new Map(families.filter(f => f.category !== "unique").map(f => [f.id, f]));
  const match = name => {
    let s = slugify(name.split("(")[0]);
    s = aliases[s] ?? s;
    if (bySlug.has(s)) return bySlug.get(s);
    for (const [fid, f] of bySlug) {
      if (fid.startsWith(s) || s.startsWith(fid) || (s.split("-").at(-1) === fid.split("-").at(-1) && fid.split("-").at(-1) === fid)) return f;
    }
    return null;
  };
  for (const [r, c, v] of grid.find(v => ["base weapons", "base armor", "base armour", "base trinkets"].includes(v.toLowerCase()))) {
    grid.take(r, c);
    const kind = v.toLowerCase().split(/\s+/)[1];
    let rr = r + 1;
    while (rr < grid.length && parseIntPy(grid.s(rr, 0)) !== null) {
      grid.take(rr, 0);
      if (kind === "weapons") {
        const mats = grid.take(rr, 1), aff = grid.take(rr, 2), full = grid.takeRaw(rr, 3);
        const f = match(full);
        if (f) {
          f.baseMaterials = mats.split(",").map(m => m.trim().toLowerCase()).filter(m => m);
          f.baseAffinity = aff || null;
          const variants = topLevelGroups(full);
          if (variants.length) f.variants = variants.join("; ");
        } else {
          ctx.warn(`${grid.name}!${Grid.a1(rr, 3)}`, `base weapon ${pyRepr(full)} doesn't match a gear family (add it to gearBaseAliases)`);
        }
      } else if (kind.startsWith("armo")) {
        const name = grid.take(rr, 1), desc = grid.takeRaw(rr, 3);
        const f = match(name.replace(/armor/g, "armour"));
        if (f && desc) f.variants = desc;
      } else {
        const name = grid.take(rr, 1), slots = grid.take(rr, 2), focus = grid.take(rr, 4);
        const f = match(name);
        if (f) {
          f.slots = slots.split(/,(?![^(]*\))/).map(x => x.trim()).filter(x => x);
          if (focus && !("focus" in f)) f.focus = focus.includes(":") ? partition(focus, ":")[2].trim() : focus;
        }
      }
      rr++;
    }
  }
}

function readClassTrinkets(ctx, grid, headerRows) {
  if (!headerRows.length) return null;
  const doc = fileHeader("class-trinkets", "class-trinkets", "Class Trinkets", grid);
  doc.rules = [];
  doc.groups = [];
  doc._start = headerRows[0] - 1;
  const above = grid.s(headerRows[0] - 1, 1);
  if (above) doc.rules.push(pyStrip(grid.take(headerRows[0] - 1, 1), "()"));
  const seen = new Set();
  for (const hr of headerRows) {
    const titleCol = grid.nonempty(hr).find(([, v]) => v.toLowerCase().endsWith("designs"))[0];
    const title = grid.take(hr, titleCol);
    const group = { id: slugify(title.replace("Class Trinket Designs", "")), name: title.replace(" Designs", ""),
      reqLevel: null, tier: null, items: [] };
    const r = hr + 1;
    for (const [c, v] of grid.nonempty(r)) {
      const m = /^req\s*lvl\s*(\d+)/i.exec(v);
      const t = /^tier\s*(\d+)/i.exec(v);
      if (m) { group.reqLevel = parseInt(m[1], 10); grid.take(r, c); }
      else if (t) { group.tier = parseInt(t[1], 10); grid.take(r, c); }
    }
    const hdr = r + 1;
    const cols = {};
    for (const [c, v] of grid.nonempty(hdr)) {
      const k = { name: "name", "trinket effect": "effect", effect: "effect", "material types": "materials" }[v.toLowerCase()];
      if (k) { cols[k] = c; grid.take(hdr, c); }
    }
    const nameCol = cols.name ?? 1;
    let rr = hdr + 1;
    while (rr < grid.length && grid.s(rr, nameCol) && !grid.s(rr, nameCol).toLowerCase().endsWith("designs")) {
      const name = grid.takeRaw(rr, nameCol);
      if (name.toLowerCase().startsWith("uniques")) break;
      let iid = slugify(name);
      if (seen.has(iid)) iid = `${iid}-${group.id}`;
      seen.add(iid);
      const mats = grid.takeRaw(rr, cols.materials ?? -1);
      const effect = grid.takeRaw(rr, cols.effect ?? -1);
      const item = { id: iid, name, effect: effect || null, materialsRaw: mats || null,
        materials: parseMaterials(mats), source: src(grid, rr, nameCol) };
      const head = partition(effect || "", ",")[0];
      if (effect && effect.includes(",") && head.split(/\s+/).filter(w => w).length <= 4 && /^[A-Z]/.test(head.slice(0, 1))
        && !["plus", "once", "when", "you", "can", "select", "deal", "take"].some(w => head.toLowerCase().startsWith(w))) {
        item.grants = head.trim();
      }
      group.items.push(item);
      rr++;
    }
    doc.groups.push(group);
  }
  return doc;
}

function readGearOverview(ctx, grid, uniquesRow) {
  const doc = fileHeader("gear-overview", "gear-overview", "Gear", grid);
  doc.glossary = [];
  doc.rules = [];
  const GLOSS = /^(min lvl|base attack|damage type|affinity|equip load(\(\d+-\d+\))?|breakpoint(\(\d+-\d+\))?|description|effects|materials|tags)\s*:/i;
  for (const [r, c] of grid.find(v => GLOSS.test(v) && v.length > 25, range(0, 40))) {
    const [term, , text] = partition(grid.takeRaw(r, c), ":");
    doc.glossary.push({ term: term.trim(), text: text.trim() });
  }
  const et = grid.find(v => v.toLowerCase().startsWith("enchanter types"), range(0, 40))[0];
  if (et) {
    grid.take(et[0], et[1]);
    const lines = [];
    let rr = et[0] + 1;
    while (grid.s(rr, et[1]) && grid.s(rr, et[1]).includes("-")) { lines.push(grid.take(rr, et[1])); rr++; }
    if (lines.length) doc.glossary.push({ term: "Enchanters", text: lines.map(l => l.replace(/\.+$/, "") + ".").join(" ") });
  }
  for (const [r, c] of grid.find(v => /trinkets? can be worn|class trinkets are/i.test(v), range(0, 40))) {
    doc.rules.push(grid.takeRaw(r, c));
  }
  if (uniquesRow !== null) {
    grid.take(uniquesRow, grid.nonempty(uniquesRow)[0][0]);
    const text = grid.s(uniquesRow + 1, 1);
    if (text) doc.uniquesNote = grid.takeRaw(uniquesRow + 1, 1);
  }
  const TEMPLATE = new Set(["name", "min lvl", "base attack", "damage type", "affinity", "equip load", "breakpoint",
    "desciption", "description", "effects", "materials", "tags"]);
  for (let r = 0; r < 30; r++) {
    for (const [c, v] of grid.nonempty(r)) {
      if ([11, 12, 13].includes(c) && TEMPLATE.has(v.replace(/:+$/, "").toLowerCase())) grid.take(r, c);
    }
  }
  return doc;
}


/* ================================================================== */
/*  Backgrounds tab                                                    */
/* ================================================================== */

const BG_SCALES = ["nobility", "military", "civilian", "criminal"];
const BG_LABELS = { name: "name", description: "description", perk: "perk", "starting inventory": "inventory", inventory: "inventory" };

/** "1" → {min:1,max:1}; "2 to 7" / "2-7" → {min:2,max:7}; "20+" → {min:20,max:null} */
function parseStandingRange(text) {
  const t = text.trim();
  let m = /^(\d+)\s*\+$/.exec(t);
  if (m) return { min: parseInt(m[1], 10), max: null };
  m = /^(\d+)\s*(?:to|-|–)\s*(\d+)$/i.exec(t);
  if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  m = /^(\d+)$/.exec(t);
  if (m) return { min: parseInt(m[1], 10), max: parseInt(m[1], 10) };
  return null;
}

/**
 * Backgrounds tab → one document: the rules text at the top, then one scale per table (Nobility, Military,
 * Civilian, Criminal), each with its social-standing ranges and a background per range (name, description,
 * perk, starting inventory).
 */
function convertBackgrounds(ctx, sheetName) {
  const grid = ctx.sheet(sheetName);
  if (!grid) return null;
  const doc = fileHeader("backgrounds", "backgrounds", "Backgrounds", grid);
  doc.rules = [];
  doc.scales = [];
  const titleRows = grid.find(v => BG_SCALES.includes(v.toLowerCase()))
    .filter(([r]) => grid.nonempty(r).length === 1)
    .map(([r, c, v]) => ({ r, c, v }));
  const firstTable = titleRows.length ? titleRows[0].r : grid.length;
  for (let r = 0; r < firstTable; r++) {
    for (const [c] of grid.nonempty(r)) doc.rules.push(grid.takeRaw(r, c));
  }
  titleRows.forEach(({ r, c, v }, i) => {
    grid.take(r, c);
    const end = i + 1 < titleRows.length ? titleRows[i + 1].r : grid.length;
    const scale = { id: slugify(v), name: v.trim(), tiers: [] };
    const cols = [];
    for (const [cc, text] of grid.nonempty(r + 1)) {
      const range = parseStandingRange(text);
      if (!range) continue;
      grid.take(r + 1, cc);
      cols.push(cc);
      scale.tiers.push({ ...range, range: text.trim(), name: "", description: "", perk: "", inventory: "" });
    }
    for (let rr = r + 2; rr < end; rr++) {
      const cells = grid.nonempty(rr);
      if (!cells.length) continue;
      const [lc, label] = cells[0];
      const key = BG_LABELS[label.toLowerCase().replace(/:$/, "")];
      if (!key || lc >= (cols[0] ?? Infinity)) continue;
      grid.take(rr, lc);
      cols.forEach((cc, t) => {
        const text = grid.takeRaw(rr, cc);
        if (text) scale.tiers[t][key] = text.replace(/[ \t]+\n/g, "\n").trim();
      });
    }
    for (const t of scale.tiers) {
      if (!t.name) ctx.warn(`${sheetName}!${Grid.a1(r + 1, 0)}`, `${scale.name}: a background for ${t.range} has no name`);
    }
    doc.scales.push(scale);
  });
  if (!doc.scales.length) ctx.warn(sheetName, "no background tables found (Nobility / Military / Civilian / Criminal)");
  return doc;
}

/* ================================================================== */
/*  Bursts/Alignment tab: the pre-made bursts list                     */
/* ================================================================== */

/** "Stalwart Sentinel: Create a field…" / "Bone Armour, Spend 50%…" → { name, text } */
export function splitBurst(raw) {
  const text = cleanText(raw);
  const m = /^([^:,.\n]{2,48})[:,]\s+([\s\S]+)$/.exec(text);
  return m ? { name: m[1].trim(), text: m[2].trim() } : { name: "", text };
}

/**
 * The list under "Class specific bursts": one row per discipline / element, its name in one column and the burst
 * ("Name: what it does") in the next. Rows without a burst yet are skipped. Found by its heading, not its position.
 */
function convertBursts(ctx, sheetName) {
  const isHead = v => /^class specific bursts?$/i.test(v);
  // The tab is found by its name or, if it was renamed (Google drops the "/" on export), by the heading itself.
  const grid = ctx.sheets.get(sheetName) ?? ctx.sheets.get(xlsxSheetName(sheetName))
    ?? [...ctx.sheets.values()].find(g => g.find(isHead).length);
  if (!grid) { ctx.warn(sheetName, "no tab with a \"Class specific bursts\" list found; pre-made bursts not read"); return null; }
  const doc = fileHeader("bursts", "bursts", "Bursts", grid);
  doc.bursts = [];
  const head = grid.find(isHead)[0];
  if (!head) { ctx.warn(grid.name, "no \"Class specific bursts\" heading found; pre-made bursts not read"); return doc; }
  const [hr, hc] = head;
  grid.take(hr, hc);
  let blanks = 0;
  for (let r = hr + 1; r < grid.length && blanks < 3; r++) {
    const cells = grid.nonempty(r).filter(([c]) => c >= hc);
    if (!cells.length) { blanks++; continue; }
    blanks = 0;
    const [c0, source] = cells[0];
    if (c0 !== hc || source.length > 40) continue;      // notes beside the list, not a row of it
    grid.take(r, c0);
    for (const [c] of cells.slice(1)) {
      const b = splitBurst(grid.takeRaw(r, c));
      if (!b.text) continue;
      if (!b.name) b.name = `${source} burst`;
      doc.bursts.push({ id: slugify(`${source}-${b.name}`), source, ...b });
    }
  }
  return doc;
}

function dedupeFileIds(ctx, out) {
  for (const key of ["disciplines", "elements", "deities", "ancestries", "professions", "gear"]) {
    const seen = new Map();
    for (const d of out[key]) {
      seen.set(d.id, (seen.get(d.id) ?? 0) + 1);
      if (seen.get(d.id) > 1) {
        const n = `${d.id}-${seen.get(d.id)}`;
        ctx.warn(key, `two files would be called '${d.id}'; second renamed '${n}'`);
        d.id = n;
      }
    }
  }
}

const SUBDIRS = { discipline: "disciplines", elemental: "elements", deity: "deities", ancestry: "ancestries", profession: "professions", gear: "gear" };
const SINGLE = { "set-masteries": "set-masteries.json", "bond-masteries": "bond-masteries.json",
  "class-trinkets": "class-trinkets.json", "gear-overview": "gear-overview.json", backgrounds: "backgrounds.json", bursts: "bursts.json" };

/** Masteries in the file, or items for gear files. */
const masteryCount = doc => {
  if (doc.type === "gear") return doc.items.length;
  if (doc.type === "class-trinkets") return doc.groups.reduce((n, g) => n + g.items.length, 0);
  if (doc.type === "backgrounds") return doc.scales.reduce((n, sc) => n + sc.tiers.length, 0);
  if (doc.type === "bursts") return doc.bursts.length;
  return (doc.masteries?.length ?? 0) + (doc.heritages ?? []).reduce((n, h) => n + h.abilities.length, 0);
};

/**
 * Convert a workbook.
 * @param {Map<string, string[][]>} workbook   from readXlsx()
 * @param {object} [options]
 * @param {object} [options.config]            defaults to DEFAULT_CONFIG
 * @param {object} [options.source]            recorded in the index (e.g. { spreadsheetUrl })
 * @returns {{ index: object, docs: Map<string, object>, warnings: [string, string][], notes: [string, string][], unknownTags: [string, number][] }}
 *   docs is keyed by the path listed in index.files (e.g. "disciplines/rogue.json").
 */
export function convertWorkbook(workbook, { config = DEFAULT_CONFIG, source = {} } = {}) {
  const sheets = new Map([...workbook].map(([name, rows]) => [name, new Grid(name, rows)]));
  const ctx = new Context(config, sheets);
  for (const t of knownTags(ctx)) ctx.tags.addKnown(t);
  const sc = config.sheets;

  // Discipline tabs: the configured list, plus any new "<X> Masteries" tab
  const disciplineSheets = [...(sc.disciplines ?? [])];
  const configured = new Set([...disciplineSheets, sc.general, sc.elemental, sc.set, sc.bond, sc.deity, sc.ancestry,
    ...(sc.professions ?? []).map(p => (typeof p === "string" ? p : p.sheet))].filter(x => x));
  const ignored = new Set(config.ignoredSheets ?? []);
  for (const n of [...configured]) configured.add(xlsxSheetName(n));
  for (const n of [...ignored]) ignored.add(xlsxSheetName(n));
  for (const name of sheets.keys()) {
    if (!name.toLowerCase().includes("masteries") || configured.has(name) || ignored.has(name)) continue;
    if (config.autoDetectDisciplines && /\bmasteries\b/i.test(name)) {
      disciplineSheets.push(name);
      ctx.warn(name, "new tab that looks like a discipline; converted as one (add it to the ignored list if it isn't)");
    } else {
      ctx.warn(name, "looks like a mastery tab but isn't in the configuration; skipped");
    }
  }

  const index = readDisciplineIndex(ctx);
  const out = { disciplines: [], elements: [], set: null, bond: null, deities: [], ancestries: [], professions: [],
    gear: [], classTrinkets: null, gearOverview: null, backgrounds: null, bursts: null };
  if (sc.general) { const d = convertDiscipline(ctx, sc.general, index, true); if (d) out.disciplines.push(d); }
  for (const name of disciplineSheets) { const d = convertDiscipline(ctx, name, index); if (d) out.disciplines.push(d); }
  if (sc.elemental) out.elements = convertElemental(ctx, sc.elemental);
  if (sc.set) out.set = convertSetMasteries(ctx, sc.set, classMap(out.disciplines, ELEMENTS));
  if (sc.bond) out.bond = convertBond(ctx, sc.bond);
  if (sc.deity) out.deities = convertDeities(ctx, sc.deity);
  if (sc.ancestry) out.ancestries = convertAncestries(ctx, sc.ancestry);
  for (let p of sc.professions ?? []) {
    p = typeof p === "string" ? { sheet: p } : p;
    out.professions.push(...convertProfessions(ctx, p.sheet, p.requirement ?? null));
  }
  if (sc.gear) [out.gear, out.classTrinkets, out.gearOverview] = convertGear(ctx, sc.gear);
  if (sc.backgrounds) out.backgrounds = convertBackgrounds(ctx, sc.backgrounds);
  if (sc.bursts) out.bursts = convertBursts(ctx, sc.bursts);

  dedupeFileIds(ctx, out);
  linkAll(ctx, out);

  const all = [...out.disciplines, ...out.elements, ...out.deities, ...out.ancestries, ...out.professions,
    ...out.gear, ...[out.set, out.bond, out.classTrinkets, out.gearOverview, out.backgrounds, out.bursts].filter(d => d)];
  const docs = new Map();
  const files = [];
  const totals = {};
  for (const d of all) {
    const path = SINGLE[d.type] ?? `${SUBDIRS[d.type]}/${d.id}.json`;
    docs.set(path, d);
    const entry = { type: d.type, id: d.id, name: d.name, path, masteryCount: masteryCount(d) };
    if (d.status) entry.status = d.status;
    files.push(entry);
    totals[d.type] = (totals[d.type] ?? 0) + entry.masteryCount;
  }
  const indexDoc = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    source,
    totals,
    files
  };
  return {
    index: indexDoc, docs, warnings: ctx.warnings, notes: ctx.notes,
    unknownTags: [...ctx.tags.unknown].sort((a, b) => (b[1] - a[1]) || a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
  };
}
