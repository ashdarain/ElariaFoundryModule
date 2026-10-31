import { ELARIA } from "../config.mjs";

const f = foundry.data.fields;

const str = () => new f.StringField({ required: true, blank: true, initial: "" });
const nullInt = (opts = {}) => new f.NumberField({ required: true, nullable: true, integer: true, initial: null, ...opts });

/**
 * A mastery. The shape matches what the Google Sheet importer produces (docs/04-compendium-data.md), so every
 * field from the sheet is carried over. Raw sheet text is always kept next to parsed values.
 */
export class MasteryData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      // Reference from the sheet import, e.g. "discipline:rogue/sorru". Blank for hand-made masteries.
      ref: str(),

      // null = no level gate (heritage abilities, bond masteries, some set masteries).
      reqLevel: new f.NumberField({ required: true, nullable: true, integer: true, initial: 1, min: 0, max: 20 }),
      // null = uses no budget (set and bond masteries). Usually 0–4; Steal Lvl is 5 on purpose (A23).
      value: new f.NumberField({ required: true, nullable: true, integer: true, initial: 1, min: 0 }),

      // basic … support, "any" (deity / ancestry / profession: the player picks, A24),
      // or "none" (set, bond, heritage abilities: no category budget).
      category: new f.StringField({
        required: true, initial: "basic",
        choices: () => ({ ...ELARIA.masteryCategories, any: "ELARIA.Category.any", none: "ELARIA.Category.none" })
      }),
      equippedCategory: new f.StringField({ required: true, initial: "basic", choices: () => ELARIA.masteryCategories }),
      equipped: new f.BooleanField({ initial: false }),

      // Every list this mastery belongs to. Shared proficiencies (Wise, Speed Training …) list
      // all their disciplines here (A25), so availability checks can match any of them.
      sources: new f.ArrayField(new f.SchemaField({
        type: new f.StringField({ required: true, initial: "general", choices: () => ELARIA.masterySources }),
        id: str(),      // list id from the sheet import, e.g. "rogue", "fire-dark", "hecate"
        name: str()     // display name, e.g. "Rogue", "Fire/Dark", "Hecate"
      })),

      isReaction: new f.BooleanField({ initial: false }),

      skillMod: new f.SchemaField({
        raw: str(),                                   // as written, e.g. "2+Fin or Pre"
        bonus: nullInt(),
        stats: new f.ArrayField(new f.StringField({ blank: false }))
      }),
      damage: new f.SchemaField({
        raw: str(),                                   // as written, e.g. "1d6+Str x4"
        count: nullInt({ min: 0 }),
        sides: nullInt({ min: 1 }),
        stat: str(),
        hits: str(),                                  // "4", "variable" or blank
        perTarget: new f.BooleanField({ initial: false })
      }),

      cost: str(),                                    // display text, e.g. "3 ftg, 1 mp"
      costs: new f.ArrayField(new f.SchemaField({
        amount: nullInt({ min: 0 }),                  // null = variable
        resource: str()                               // ftg, mp, hp, ap, rage, tranquility …
      })),
      usageLimit: new f.SchemaField({
        count: nullInt({ min: 1 }),
        per: str()                                    // turn, round, battle, day, week, long-rest
      }),

      tags: new f.ArrayField(new f.StringField({ blank: false })),

      // The sheet's verified checkbox: "yes", "no", or "" when the table has none.
      verified: new f.StringField({ required: true, blank: true, initial: "", choices: { "": "—", yes: "Yes", no: "No" } }),

      // Set masteries
      requirementsRaw: str(),
      requirements: new f.ArrayField(new f.ObjectField()),
      reqLevelAlt: nullInt({ min: 0 }),
      // Bond masteries
      minBondTier: nullInt({ min: 1 }),

      details: new f.HTMLField({ required: true, blank: true, initial: "" })
    };
  }

  /** Bring v0.1.x masteries (plain-text fields, single source) up to this shape. */
  static migrateData(source) {
    if (typeof source.tags === "string") {
      source.tags = source.tags.split(",").map(t => t.trim()).filter(t => t);
    }
    if (typeof source.skillMod === "string") source.skillMod = { raw: source.skillMod };
    if (typeof source.damage === "string") source.damage = { raw: source.damage };
    if (source.source && typeof source.source === "object" && !Array.isArray(source.sources)) {
      source.sources = [{ type: source.source.type || "general", id: "", name: source.source.name ?? "" }];
      delete source.source;
    }
    return super.migrateData(source);
  }

  /** The category this mastery counts against when equipped ("none" = no budget). */
  get slotCategory() {
    if (this.category === "any") return this.equippedCategory;
    return this.category;
  }

  get tagList() {
    return this.tags ?? [];
  }

  /** "Discipline: Rogue, Ninja" style label for the sheet. */
  get sourceLabel() {
    return sourceLabelFor(this.sources);
  }

  /** Does this mastery belong to a list with the given type and name/id (case-insensitive)? */
  hasSource(type, nameOrId) {
    const n = String(nameOrId).toLowerCase();
    return this.sources.some(s => s.type === type && (s.id.toLowerCase() === n || s.name.toLowerCase() === n));
  }

  prepareDerivedData() {
    // A "Reaction" tag gives the mastery rxn (A: masteries tagged Reaction count as reactions).
    if (!this.isReaction && this.tags?.some(t => /^(reactions?|rxn)$/i.test(String(t).trim()))) this.isReaction = true;
    const actor = this.parent.actor;
    this.levelTooHigh = !!actor && this.reqLevel !== null && (actor.system.level ?? 0) < this.reqLevel;
  }
}

/** "Discipline: Rogue, Ninja · Deity: Hecate" label from a sources array (also used on compendium index entries). */
export function sourceLabelFor(sources) {
  if (!sources?.length) return "";
  const byType = new Map();
  for (const s of sources) {
    const key = s.type || "general";
    if (!byType.has(key)) byType.set(key, []);
    if (s.name) byType.get(key).push(s.name);
  }
  return [...byType].map(([type, all]) => {
    const label = game.i18n.localize(ELARIA.masterySources[type] ?? type);
    const names = all.filter(n => n.toLowerCase() !== label.toLowerCase());
    return names.length ? `${label}: ${names.join(", ")}` : label;
  }).join(" · ");
}
