const f = foundry.data.fields;
const text = () => new f.StringField({ required: true, blank: true, initial: "" });

/**
 * A monster ability (the abilities table on the "Monster stat block" tab): name, skill mod, cost, description,
 * damage, tags. Everything optional. It uses the same rolling as masteries: skill mod first (with "No reaction"),
 * then damage; with neither it is posted to chat.
 */
export class AbilityData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      skillMod: new f.SchemaField({ raw: text() }),   // e.g. "2+Str"
      damage: new f.SchemaField({ raw: text() }),     // e.g. "3d6+Str x2"
      cost: text(),                                   // e.g. "3 ftg"
      tags: new f.ArrayField(new f.StringField({ required: true, blank: false })),
      isReaction: new f.BooleanField({ initial: false }),
      details: new f.HTMLField({ required: true, blank: true, initial: "" })
    };
  }

  prepareDerivedData() {
    if (!this.isReaction && this.tags?.some(t => /^(reactions?|rxn)$/i.test(String(t).trim()))) this.isReaction = true;
  }

  get tagList() {
    return this.tags ?? [];
  }
}
