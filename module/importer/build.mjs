/**
 * Converted sheet data → Foundry documents.
 *
 * Takes the per-tab documents produced by convert.mjs (one per discipline, element, deity, ancestry, profession,
 * plus set and bond masteries) and returns plain Item / Folder data for each compendium. No Foundry dependencies,
 * so it can be tested in Node (tools/test-build.mjs). See docs/04-compendium-data.md for the mapping.
 */

export const SCHEMA_VERSION = "1.0.0";

/** One world compendium per mastery type. `name` becomes the pack id: world.<name>. */
/** Tags that mark a reaction: "Reaction", "Reactions", "Rxn". */
export const REACTION_TAG = /^(reactions?|rxn)$/i;

export const PACKS = {
  discipline: { name: "elaria-discipline-masteries", label: "Elaria: Discipline Masteries", img: "systems/elaria/assets/icons/mastery-discipline.svg" },
  elemental:  { name: "elaria-elemental-masteries",  label: "Elaria: Elemental Masteries",  img: "systems/elaria/assets/icons/mastery-elemental.svg" },
  deity:      { name: "elaria-deity-masteries",      label: "Elaria: Deity Masteries",      img: "systems/elaria/assets/icons/mastery-deity.svg" },
  ancestry:   { name: "elaria-ancestry-masteries",   label: "Elaria: Ancestry Masteries",   img: "systems/elaria/assets/icons/mastery-ancestry.svg" },
  profession: { name: "elaria-profession-masteries", label: "Elaria: Profession Masteries", img: "systems/elaria/assets/icons/mastery-profession.svg" },
  set:        { name: "elaria-set-masteries",        label: "Elaria: Set Masteries",        img: "systems/elaria/assets/icons/mastery-set.svg" },
  bond:       { name: "elaria-bond-masteries",       label: "Elaria: Bond Masteries",       img: "systems/elaria/assets/icons/mastery-bond.svg" },
  // Gear (the Gear tab)
  weapons:    { name: "elaria-weapons",              label: "Elaria: Weapons",              img: "systems/elaria/assets/icons/gear-weapon.svg" },
  armour:     { name: "elaria-armour",               label: "Elaria: Armour",               img: "systems/elaria/assets/icons/gear-armour.svg" },
  trinkets:   { name: "elaria-trinkets",             label: "Elaria: Trinkets",             img: "systems/elaria/assets/icons/gear-trinket.svg" },
  uniques:    { name: "elaria-unique-gear",          label: "Elaria: Unique Gear",          img: "systems/elaria/assets/icons/gear-unique.svg" }
};

/** Which Foundry banner each pack uses in the Compendium sidebar: masteries one, gear another (see packBanner). */
export const MASTERY_PACKS = ["discipline", "elemental", "deity", "ancestry", "profession", "set", "bond"];
export const GEAR_PACKS = ["weapons", "armour", "trinkets", "uniques"];

/** Icon for a gear item by kind. */
const ICONS = "systems/elaria/assets/icons/";
const GEAR_IMG = { weapon: `${ICONS}gear-weapon.svg`, armour: `${ICONS}gear-armour.svg`, trinket: `${ICONS}gear-trinket.svg`, item: `${ICONS}gear-item.svg` };
/** Unique gear: the same glyphs on a red frame. Class trinkets: a crystal ball. */
const gearImg = (system, packKey) => system.classTrinket ? `${ICONS}gear-class-trinket.svg`
  : packKey === "uniques" ? (["weapon", "armour", "trinket"].includes(system.kind) ? `${ICONS}gear-unique-${system.kind}.svg` : `${ICONS}gear-unique.svg`)
  : (GEAR_IMG[system.kind] ?? GEAR_IMG.item);

const SHARED_FOLDER = "Shared (several disciplines)";

/* ------------------------------------------------------------------ */
/*  Stable ids                                                         */
/* ------------------------------------------------------------------ */

/** 53-bit string hash (cyrb53). */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function base62(n, len) {
  let out = "";
  for (let i = 0; i < len; i++) { out = ALPHABET[n % 62] + out; n = Math.floor(n / 62); }
  return out;
}

/** Deterministic 16-character Foundry id. The same key always gives the same id. */
export function stableId(key) {
  return base62(cyrb53(key, 1), 8) + base62(cyrb53(key, 2), 8);
}

/** Short hash used to tell whether an imported item changed since the last import. */
export function contentHash(obj) {
  const s = JSON.stringify(obj);
  return base62(cyrb53(s, 7), 9) + base62(cyrb53(s, 11), 9);
}

/* ------------------------------------------------------------------ */
/*  Field conversion                                                   */
/* ------------------------------------------------------------------ */

const escapeHTML = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain sheet text → simple HTML paragraphs. */
export function textToHTML(text) {
  if (!text) return "";
  return String(text).trim().split(/\n{2,}/)
    .map(p => `<p>${escapeHTML(p).replace(/\n/g, "<br>")}</p>`).join("");
}

function convertSkillMod(sm) {
  if (!sm) return { raw: "", bonus: null, stats: [] };
  return { raw: sm.raw ?? "", bonus: Number.isInteger(sm.bonus) ? sm.bonus : null, stats: sm.stats ?? [] };
}

function convertDamage(d) {
  if (!d) return { raw: "", count: null, sides: null, stat: "", hits: "", perTarget: false };
  return {
    raw: d.raw ?? "",
    count: d.dice?.count ?? null,
    sides: d.dice?.sides ?? null,
    stat: d.stat ?? "",
    hits: d.hits === undefined || d.hits === null ? "" : String(d.hits),
    perTarget: !!d.perTarget
  };
}

function convertCosts(costs) {
  const list = (costs ?? []).map(c => ({ amount: Number.isInteger(c.amount) ? c.amount : null, resource: c.resource ?? "" }));
  const text = list.map(c => `${c.amount ?? "X"} ${c.resource}`).join(", ");
  return { costs: list, cost: text };
}

const verifiedOf = v => (v === true ? "yes" : v === false ? "no" : "");

/** System data for one converted mastery. */
function masterySystem(m, { ref, category, sources, extraTags = [] }) {
  const { costs, cost } = convertCosts(m.costs);
  const tags = [...(m.tags ?? [])];
  for (const t of extraTags) if (!tags.includes(t)) tags.push(t);
  return {
    ref,
    reqLevel: Number.isInteger(m.reqLevel) ? m.reqLevel : null,
    value: Number.isInteger(m.value) ? m.value : null,
    category,
    equippedCategory: "basic",
    equipped: false,
    sources,
    // A "Reaction" tag makes it a reaction mastery (rxn) even if the sheet didn't mark it.
    isReaction: !!m.isReaction || tags.some(t => REACTION_TAG.test(String(t).trim())),
    skillMod: convertSkillMod(m.skillMod),
    damage: convertDamage(m.damage),
    cost,
    costs,
    usageLimit: { count: m.usageLimit?.count ?? null, per: m.usageLimit?.per ?? "" },
    tags,
    verified: verifiedOf(m.verified),
    requirementsRaw: m.requirementsRaw ?? "",
    requirements: m.requirements ?? [],
    reqLevelAlt: Number.isInteger(m.reqLevelAlt) ? m.reqLevelAlt : null,
    minBondTier: Number.isInteger(m.minBondTier) ? m.minBondTier : null,
    details: textToHTML(m.details)
  };
}

/** The parts of a mastery that must match for shared copies to be merged into one item. */
const sameMastery = (a, b) =>
  a.details === b.details && a.value === b.value && a.reqLevel === b.reqLevel
  && (a.category ?? null) === (b.category ?? null) && a.name === b.name;

/* ------------------------------------------------------------------ */
/*  Build                                                              */
/* ------------------------------------------------------------------ */

/** System data for one gear item from a gear family (gear/<family>.json). */
function gearSystem(it, fam, nameOf) {
  const ba = it.baseAttack;
  return {
    kind: ["weapon", "armour", "trinket"].includes(it.kind) ? it.kind : "item",
    ref: `gear:${fam.id}/${it.id}`,
    family: fam.name,
    tier: Number.isInteger(it.tier) ? it.tier : null,
    reqLevel: Number.isInteger(it.reqLevel) ? it.reqLevel : null,
    evolvesFrom: it.evolvesFrom ? (nameOf.get(it.evolvesFrom) ?? it.evolvesFrom) : "",
    proficiency: it.proficiency ?? "",
    baseAttack: {
      raw: ba?.raw ?? "",
      count: ba?.dice?.count ?? null,
      sides: ba?.dice?.sides ?? null,
      stat: ba?.stat ?? "",
      hits: ba?.hits === undefined || ba?.hits === null ? "" : String(ba.hits)
    },
    damageType: it.damageType?.raw ?? "",
    armourRating: Number.isInteger(it.armourRating) ? it.armourRating : null,
    weight: it.weight ?? "",
    affinity: it.affinity?.raw ?? "",
    equipLoad: Number.isInteger(it.equipLoad) ? it.equipLoad : null,
    breakpoint: Number.isInteger(it.breakpoint) ? it.breakpoint : null,
    classTrinket: false,
    grants: "",
    materials: it.materialsRaw ?? "",
    tags: [...(it.tags ?? [])],
    effects: textToHTML(it.effects),
    description: textToHTML(it.description),
    location: "bag",
    quantity: 1,
    broken: false
  };
}

/** System data for a class trinket (class-trinkets.json). */
function classTrinketSystem(it, group) {
  return {
    kind: "trinket",
    ref: `class-trinket:${it.id}`,
    family: group.name,
    tier: Number.isInteger(group.tier) ? group.tier : null,
    reqLevel: Number.isInteger(group.reqLevel) ? group.reqLevel : null,
    evolvesFrom: "", proficiency: "",
    baseAttack: { raw: "", count: null, sides: null, stat: "", hits: "" },
    damageType: "", armourRating: null, weight: "", affinity: "", equipLoad: null, breakpoint: null,
    classTrinket: true,
    grants: it.grants ?? "",
    materials: it.materialsRaw ?? "",
    tags: ["Trinket", "Class Trinket"],
    effects: textToHTML(it.effect),
    description: "",
    location: "bag", quantity: 1, broken: false
  };
}

/**
 * @param {object} index                         the index from convertWorkbook()
 * @param {(path: string) => Promise<object>} load  returns a converted document by its index path
 * @param {(done: number, total: number, label: string) => void} [progress]
 * @returns {Promise<{packs: Record<string, {meta, folders: object[], items: object[]}>, report: object}>}
 */
export async function buildCompendiumData(index, load, progress = () => {}) {
  if (index?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported data schema ${index?.schemaVersion ?? "(none)"}; this importer expects ${SCHEMA_VERSION}.`);
  }
  const report = { generatedAt: index.generatedAt, sheet: index.source?.spreadsheetUrl ?? "", warnings: [], merged: 0, keptSeparate: [] };
  const packs = Object.fromEntries(Object.entries(PACKS).map(([k, meta]) => [k, { meta, folders: new Map(), items: [] }]));
  const fileNames = new Map(index.files.map(f => [`${f.type}:${f.id}`, f.name]));

  const folder = (packKey, path) => {
    // path: array of names from the top level down
    const pack = packs[packKey];
    let parent = null;
    for (let i = 0; i < path.length; i++) {
      const key = path.slice(0, i + 1).join(" / ");
      if (!pack.folders.has(key)) {
        pack.folders.set(key, {
          _id: stableId(`folder:${packKey}:${key}`), name: path[i], type: "Item",
          folder: parent, sorting: "a", sort: 0
        });
      }
      parent = pack.folders.get(key)._id;
    }
    return parent;
  };

  const pushItem = (packKey, folderId, m, system, refKey) => {
    const doc = { _id: stableId(`mastery:${refKey}`), name: m.name, type: "mastery", img: PACKS[packKey].img, folder: folderId, system };
    doc.flags = { elaria: { imported: true, ref: refKey, hash: contentHash({ name: doc.name, img: doc.img, folder: folderId, system }) } };
    packs[packKey].items.push(doc);
  };

  const pushGear = (packKey, folderId, name, system) => {
    const img = gearImg(system, packKey);
    const doc = { _id: stableId(`gear:${system.ref}`), name, type: "gear", img, folder: folderId, system };
    doc.flags = { elaria: { imported: true, ref: system.ref, hash: contentHash({ name, img, folder: folderId, system }) } };
    packs[packKey].items.push(doc);
  };

  // ---- load all files (disciplines first so shared groups can be resolved)
  const files = [];
  let done = 0;
  for (const f of index.files) {
    progress(done++, index.files.length, f.name);
    files.push({ entry: f, data: await load(f.path) });
  }
  progress(index.files.length, index.files.length, "");

  // ---- disciplines (incl. General), with shared proficiencies merged
  const discByRef = new Map();
  for (const { entry, data } of files.filter(x => x.entry.type === "discipline")) {
    for (const m of data.masteries) discByRef.set(`discipline:${data.id}/${m.id}`, { file: data, m });
  }
  const handled = new Set();
  for (const [ref, { file, m }] of discByRef) {
    if (handled.has(ref)) continue;
    const isGeneral = file.id === "general";
    const sourceOf = d => ({ type: d.id === "general" ? "general" : "discipline", id: d.id, name: d.name });

    // Copies in other disciplines that are identical go into this item; differing ones stay separate.
    const group = [ref];
    const differing = [];
    for (const other of m.alsoIn ?? []) {
      const o = discByRef.get(other);
      if (!o) { report.warnings.push(`${ref}: alsoIn points at missing ${other}`); continue; }
      if (handled.has(other)) continue;
      if (sameMastery(m, o.m)) group.push(other);
      else differing.push(other);
    }
    for (const r of group) handled.add(r);
    if (differing.length) report.keptSeparate.push({ name: m.name, ref, differsIn: differing });

    const sources = group.map(r => sourceOf(discByRef.get(r).file));
    const canonical = [...group].sort()[0];
    if (group.length > 1) report.merged += group.length - 1;
    const folderPath = group.length > 1 ? [SHARED_FOLDER] : [isGeneral ? "General" : file.name];
    const system = masterySystem(m, { ref: canonical, category: m.category ?? "basic", sources });
    if (file.status === "wip") system.tags.push("WIP");
    pushItem("discipline", folder("discipline", folderPath), m, system, canonical);
  }

  // ---- everything else
  for (const { entry, data } of files) {
    switch (entry.type) {
      case "elemental": {
        const source = { type: "elemental", id: data.id, name: data.name };
        const fpath = [data.kind === "combo" ? "Combos" : data.kind === "any" ? "Any Element" : "Prime Elements"];
        if (data.kind !== "any") fpath.push(data.name);
        for (const m of data.masteries) {
          const ref = `elemental:${data.id}/${m.id}`;
          pushItem("elemental", folder("elemental", fpath), m,
            masterySystem(m, { ref, category: m.category ?? "basic", sources: [source] }), ref);
        }
        break;
      }
      case "deity": {
        const source = { type: "deity", id: data.id, name: data.name };
        for (const m of data.masteries) {
          const ref = `deity:${data.id}/${m.id}`;
          pushItem("deity", folder("deity", [data.name]), m, masterySystem(m, { ref, category: "any", sources: [source] }), ref);
        }
        break;
      }
      case "profession": {
        const source = { type: "profession", id: data.id, name: data.name };
        for (const m of data.masteries) {
          const ref = `profession:${data.id}/${m.id}`;
          pushItem("profession", folder("profession", [data.name]), m,
            masterySystem(m, { ref, category: "any", sources: [source] }), ref);
        }
        break;
      }
      case "ancestry": {
        const source = { type: "ancestry", id: data.id, name: data.name };
        for (const m of data.masteries) {
          const ref = `ancestry:${data.id}/${m.id}`;
          pushItem("ancestry", folder("ancestry", [data.name]), m, masterySystem(m, { ref, category: "any", sources: [source] }), ref);
        }
        // Heritage abilities: automatic with the heritage, no budget (A16). Kept for reference until
        // heritage items exist (phase 2).
        for (const h of data.heritages ?? []) {
          const hSource = { type: "ancestry", id: `${data.id}/${h.id}`, name: `${data.name} · ${h.name}` };
          for (const m of h.abilities ?? []) {
            const ref = `ancestry:${data.id}/${h.id}/${m.id}`;
            const system = masterySystem(m, { ref, category: "none", sources: [hSource], extraTags: ["Heritage"] });
            system.value = 0;
            pushItem("ancestry", folder("ancestry", [data.name, h.name]), m, system, ref);
          }
        }
        break;
      }
      case "set-masteries": {
        const groupOf = new Map();
        for (const g of data.groups ?? []) {
          for (const id of g.masteryIds) if (!groupOf.has(id)) groupOf.set(id, g.class);
        }
        for (const m of data.masteries) {
          const ref = `set:${m.id}`;
          const cls = groupOf.get(m.id);
          const clsName = cls ? (fileNames.get(`${cls.type}:${cls.id}`) ?? cls.id) : "Ungrouped";
          // Sources: every class named in the requirements, so the sheet can show who it's for.
          const seen = new Set();
          const sources = [];
          for (const r of m.requirements ?? []) {
            const c = r.class;
            if (!c || seen.has(`${c.type}:${c.id}`)) continue;
            seen.add(`${c.type}:${c.id}`);
            sources.push({ type: c.type === "elemental" ? "elemental" : c.type === "profession" ? "profession" : "discipline",
              id: c.id, name: fileNames.get(`${c.type}:${c.id}`) ?? c.id });
          }
          if (!sources.length) sources.push({ type: "set", id: "set", name: clsName });
          pushItem("set", folder("set", [clsName]), m, masterySystem(m, { ref, category: "none", sources }), ref);
        }
        break;
      }
      case "bond-masteries": {
        for (const m of data.masteries) {
          const ref = `bond:${m.id}`;
          pushItem("bond", null, m, masterySystem(m, { ref, category: "none", sources: [{ type: "bond", id: "bond", name: "Bond" }] }), ref);
        }
        break;
      }
      case "gear": {
        // One folder per evolution tree; items in tier order, each saying what it evolves from.
        const packKey = data.category === "unique" ? "uniques"
          : data.category === "armour" ? "armour" : data.category === "trinket" ? "trinkets" : "weapons";
        const nameOf = new Map(data.items.map(it => [it.id, it.name]));
        const fid = folder(packKey, [data.name]);
        for (const it of data.items) pushGear(packKey, fid, it.name, gearSystem(it, data, nameOf));
        break;
      }
      case "class-trinkets": {
        for (const g of data.groups ?? []) {
          const fid = folder("trinkets", ["Class Trinkets", g.name]);
          for (const it of g.items) pushGear("trinkets", fid, it.name, classTrinketSystem(it, g));
        }
        break;
      }
      case "gear-overview": break;   // rules text only
      case "discipline": break;   // done above
      default: report.warnings.push(`Skipped unknown file type "${entry.type}" (${entry.path})`);
    }
  }

  // ---- finish: Maps → arrays, duplicate-id check
  const out = {};
  const ids = new Map();
  for (const [key, p] of Object.entries(packs)) {
    for (const it of p.items) {
      if (ids.has(it._id)) report.warnings.push(`Duplicate id for ${it.flags.elaria.ref} and ${ids.get(it._id)}`);
      ids.set(it._id, it.flags.elaria.ref);
    }
    out[key] = { meta: p.meta, folders: [...p.folders.values()], items: p.items };
  }
  report.totals = Object.fromEntries(Object.entries(out).map(([k, p]) => [k, p.items.length]));
  return { packs: out, report };
}
