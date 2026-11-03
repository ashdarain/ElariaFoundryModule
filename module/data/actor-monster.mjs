import { ELARIA } from "../config.mjs";
import * as R from "../rules.mjs";

const f = foundry.data.fields;
const int = (initial = 0, opts = {}) => new f.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });
const text = () => new f.StringField({ required: true, blank: true, initial: "" });
const html = () => new f.HTMLField({ required: true, blank: true, initial: "" });

/** Defence and combat numbers a monster works out from its modifiers (plus a typed bonus). */
export const MONSTER_SUBSTATS = ["nar", "nmar", "aar", "ar", "mar", "critChance", "critDamage", "mv", "reacts", "passiveAwareness"];

/** The formula part of each, from the stat modifiers (AR / MAR are built from the others afterwards). */
function monsterBase(m) {
  return {
    nar: m.stf ?? 0, nmar: m.wis ?? 0, aar: 0, ar: (m.stf ?? 0), mar: (m.wis ?? 0),
    critChance: R.critChance(m.lck ?? 0), critDamage: R.critDamage(m.ins ?? 0),
    mv: R.movement(m.fin ?? 0), reacts: R.reactsPerRound(m.awa ?? 0), passiveAwareness: R.passiveAwareness(m.awa ?? 0)
  };
}

/** A monster resource: everything typed in by the GM (no formulas). Temp is spent first, like characters. */
const resourceField = (max = 10) => new f.SchemaField({
  value: int(max, { min: 0 }),
  max: int(max, { min: 0 }),
  temp: int(0, { min: 0 })
});

/**
 * Monster, following the "Monster stat block" tab: name, type, power, elements, size, description;
 * HP / FTG / MP; the 13 stat modifiers (typed in directly; monsters have no stat points); defences and combat numbers typed in
 * directly; loot; abilities are embedded "ability" items (masteries can be dropped on too).
 *
 * Nature check DCs from the stat block (10 + Power for the overview, 8 + Power for HP/FTG/MP, 14 + Power for stats
 * and defences, 12 + Power for loot, 16 + Power for abilities) are shown on the sheet for the GM.
 */
export class MonsterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      details: new f.SchemaField({
        type: text(),
        power: int(0),
        elements: text(),
        size: text(),
        // Damage form (Mechanics): Mortal by default. Sets the built-in Mortal / Divine / Demonic resistances.
        form: new f.StringField({ required: true, initial: "mortal", choices: () => ELARIA.forms }),
        description: html()
      }),
      resources: new f.SchemaField({
        hp: resourceField(10),
        ftg: resourceField(10),
        mp: resourceField(10)
      }),
      // Monsters have no stat points: the GM types each stat's modifier directly.
      stats: new f.SchemaField(Object.fromEntries(Object.keys(ELARIA.stats).map(k => [k, new f.SchemaField({
        mod: int(0)
      })]))),
      // Resistance % per element and damage form on top of the built-in values (positive = takes less).
      resistances: new f.SchemaField(Object.fromEntries(
        [...Object.keys(ELARIA.resistanceElements), ...Object.keys(ELARIA.forms)].map(k => [k, int(0)]))),
      // Old free-text resistance note (before the resistance grid); shown until cleared.
      defence: new f.SchemaField({ elementalRes: text() }),
      // Defence and combat numbers are worked out from the stat modifiers like a character's (NAR = Stf,
      // NMAR = Wis, AR = NAR + AAR, MAR = NMAR + AAR, crit chance = Lck × 5, crit damage = Ins × 10,
      // Mv = Fin + 4, reactions from Awa, passive awareness = Awa + 10); the GM types a bonus on top.
      // AAR has no formula for monsters (no worn armour), so it's all bonus.
      bonuses: new f.SchemaField(Object.fromEntries(MONSTER_SUBSTATS.map(k => [k, int(0)]))),
      loot: new f.SchemaField({
        unique: html(),
        tables: html()
      })
    };
  }

  /** v0.11.2: stats used to be typed as stat values (mod = value ÷ 4); keep the same modifiers. */
  static migrateData(source) {
    for (const s of Object.values(source.stats ?? {})) {
      if (s && s.mod === undefined && Number.isFinite(s.value)) s.mod = Math.floor(s.value / 4);
    }
    // v0.12: typed defence / combat numbers became formula + bonus. Keep every number as it was by storing the
    // difference from the formula as the bonus.
    const oldD = source.defence ?? {}, oldC = source.combat ?? {};
    const hasOld = ["ar", "mar", "aar", "nar", "nmar"].some(k => Number.isFinite(oldD[k]))
      || ["passiveAwareness", "reacts", "critChance", "critDamage", "mv"].some(k => Number.isFinite(oldC[k]));
    if (hasOld && !source.bonuses) {
      const mods = Object.fromEntries(Object.entries(source.stats ?? {}).map(([k, s]) => [k, s?.mod ?? 0]));
      const base = monsterBase(mods);
      const old = { ...oldD, ...oldC };
      source.bonuses = Object.fromEntries(MONSTER_SUBSTATS.map(k => [k, Number.isFinite(old[k]) ? old[k] - base[k] : 0]));
      // AR and MAR include AAR, so their bonus is what's left after NAR / NMAR and AAR's own bonus.
      if (Number.isFinite(oldD.ar)) source.bonuses.ar = oldD.ar - ((base.nar + source.bonuses.nar) + source.bonuses.aar);
      if (Number.isFinite(oldD.mar)) source.bonuses.mar = oldD.mar - ((base.nmar + source.bonuses.nmar) + source.bonuses.aar);
      for (const k of ["ar", "mar", "aar", "nar", "nmar"]) delete oldD[k];
      delete source.combat;
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    for (const r of Object.values(this.resources)) r.value = Math.min(r.value, r.max);
    const p = this.details.power;
    // Resistances: built in from the monster's form and its elements (the Elements field), plus the bonus typed in.
    const elementKeys = Object.keys(ELARIA.resistanceElements);
    this.elementList = R.elementsInText(this.details.elements, elementKeys);
    const base = { ...R.elementResistances(this.elementList, ELARIA.elementAffinity), ...R.formResistances(this.details.form) };
    this.resistanceTotals = Object.fromEntries(Object.entries(this.resistances).map(([k, bonus]) => {
      const b = base[k] ?? 0;
      return [k, { base: b, bonus, total: b + bonus }];
    }));
    // Defence and combat: formula + the GM's bonus (same shape as a character's, so dice and damage code can read it).
    const mods = Object.fromEntries(Object.entries(this.stats).map(([k, s]) => [k, s.mod]));
    const b = this.bonuses;
    const sub = {};
    const put = (key, base) => (sub[key] = { base, bonus: b[key] ?? 0, total: base + (b[key] ?? 0) });
    const fbase = monsterBase(mods);
    put("nar", fbase.nar);
    put("nmar", fbase.nmar);
    put("aar", 0);
    put("ar", sub.nar.total + sub.aar.total);
    put("mar", sub.nmar.total + sub.aar.total);
    for (const k of ["critChance", "critDamage", "mv", "reacts", "passiveAwareness"]) put(k, fbase[k]);
    this.substats = sub;
    Object.assign(this.defence, { nar: sub.nar.total, nmar: sub.nmar.total, aar: sub.aar.total, ar: sub.ar.total, mar: sub.mar.total });
    this.combat = { critChance: sub.critChance.total, critDamage: sub.critDamage.total, mv: sub.mv.total,
      reacts: Math.max(0, sub.reacts.total), passiveAwareness: sub.passiveAwareness.total };
    this.natureDC = { overview: 10 + p, vitals: 8 + p, stats: 14 + p, loot: 12 + p, abilities: 16 + p };
    // Same shape as characters where the dice code looks (crit, initiative, check penalty).
    this.penalties = { check: 0, initiative: 0 };
  }

  getRollData() {
    const data = { ...this, initiativePenalty: 0, power: this.details.power };
    for (const [k, s] of Object.entries(this.stats)) data[k] = s.mod;
    return data;
  }
}
