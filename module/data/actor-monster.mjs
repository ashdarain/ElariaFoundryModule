import { ELARIA } from "../config.mjs";

const f = foundry.data.fields;
const int = (initial = 0, opts = {}) => new f.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });
const text = () => new f.StringField({ required: true, blank: true, initial: "" });
const html = () => new f.HTMLField({ required: true, blank: true, initial: "" });

/** A monster resource: everything typed in by the GM (no formulas). Temp is spent first, like characters. */
const resourceField = (max = 10) => new f.SchemaField({
  value: int(max, { min: 0 }),
  max: int(max, { min: 0 }),
  temp: int(0, { min: 0 })
});

/**
 * Monster, following the "Monster stat block" tab: name, type, power, elements, size, description;
 * HP / FTG / MP; the 13 stats (the modifier is stat ÷ 4, rounded down); defences and combat numbers typed in
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
        description: html()
      }),
      resources: new f.SchemaField({
        hp: resourceField(10),
        ftg: resourceField(10),
        mp: resourceField(10)
      }),
      stats: new f.SchemaField(Object.fromEntries(Object.keys(ELARIA.stats).map(k => [k, new f.SchemaField({
        value: int(0)
      })]))),
      defence: new f.SchemaField({
        ar: int(0), mar: int(0), aar: int(0), nar: int(0), nmar: int(0),
        elementalRes: text()
      }),
      combat: new f.SchemaField({
        passiveAwareness: int(10),
        reacts: int(2, { min: 0 }),
        critChance: int(0),
        critDamage: int(0),
        mv: int(6)
      }),
      loot: new f.SchemaField({
        unique: html(),
        tables: html()
      })
    };
  }

  prepareDerivedData() {
    for (const s of Object.values(this.stats)) s.mod = Math.floor(s.value / 4);
    for (const r of Object.values(this.resources)) r.value = Math.min(r.value, r.max);
    const p = this.details.power;
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
