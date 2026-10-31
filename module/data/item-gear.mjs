import { ELARIA } from "../config.mjs";

const f = foundry.data.fields;
const text = () => new f.StringField({ required: true, blank: true, initial: "" });
const html = () => new f.HTMLField({ required: true, blank: true, initial: "" });
const nullInt = (opts = {}) => new f.NumberField({ required: true, nullable: true, integer: true, initial: null, ...opts });

/**
 * Gear from the *Gear* tab (weapons, armour, trinkets, class trinkets and uniques), plus anything else a character
 * carries (kind "item": potions, materials, loot …).
 *
 * Where it is: `location` "bag" (default), "belt" (weapons ready to use) or "worn" (armour and trinkets).
 * Worn armour adds its AAR to the character; worn trinkets are capped at 5 (1 class trinket).
 */
export class GearData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      kind: new f.StringField({ required: true, initial: "item", choices: () => ELARIA.gearKinds }),
      ref: text(),                           // imported: "gear:<family>/<item>" or "class-trinket:<id>"
      family: text(),                        // evolution tree, e.g. "Straight Sword"
      tier: nullInt({ min: 0 }),
      reqLevel: nullInt({ min: 0 }),
      evolvesFrom: text(),                   // name of the item it evolves from
      proficiency: text(),
      baseAttack: new f.SchemaField({        // weapons: e.g. "2d6+Str" or "2d6+Strx2"
        raw: text(),
        count: nullInt({ min: 0 }),
        sides: nullInt({ min: 1 }),
        stat: text(),
        hits: text()
      }),
      damageType: text(),                    // e.g. "Phy. Slashing"
      armourRating: nullInt({ min: 0 }),     // armour: AAR
      weight: text(),                        // armour: light / medium / heavy
      affinity: text(),                      // e.g. "Light or Fire"
      equipLoad: nullInt({ min: 0 }),        // equip load needed to wield it
      breakpoint: nullInt({ min: 0 }),       // damage that breaks it
      classTrinket: new f.BooleanField({ initial: false }),
      grants: text(),                        // class trinkets: the ability it grants
      materials: text(),                     // e.g. "2 Metal, 1 Wood"
      tags: new f.ArrayField(new f.StringField({ required: true, blank: false })),
      effects: html(),
      description: html(),
      // carried state
      location: new f.StringField({ required: true, initial: "bag", choices: () => ELARIA.gearLocations }),
      quantity: new f.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
      broken: new f.BooleanField({ initial: false })
    };
  }

  prepareDerivedData() {
    // (Too heavy for the character's equip load is worked out by the sheet: items are prepared before the actor.)
    const actor = this.parent?.actor;
    this.levelTooHigh = !!actor && this.reqLevel !== null && Number.isFinite(actor.system.level) && actor.system.level < this.reqLevel;
  }

  get tagList() {
    return this.tags ?? [];
  }

  /** Same shape as a mastery's damage, so weapons roll through the same roll window. */
  get damage() {
    return this.baseAttack;
  }

  /** Where it can go when equipped: weapons on the belt, armour and trinkets worn. */
  get equipSlot() {
    return this.kind === "weapon" ? "belt" : ["armour", "trinket"].includes(this.kind) ? "worn" : null;
  }

  get equipped() {
    return this.location !== "bag";
  }
}
