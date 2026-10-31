import { ELARIA } from "../config.mjs";
import * as R from "../rules.mjs";

const f = foundry.data.fields;

const int = (initial = 0, opts = {}) => new f.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

/** A resource with a stored current value and temp (overflow, spent first: A11). Max is derived. */
const resourceField = () => new f.SchemaField({
  value: new f.NumberField({ required: true, nullable: true, integer: true, initial: null, min: 0 }),
  temp: int(0, { min: 0 })
});

const statField = () => new f.SchemaField({
  scaling: new f.StringField({ required: true, initial: "gen", choices: () => ELARIA.scalings }),
  points: int(0, { min: 0 }),
  bonus: int(0)
});

/**
 * Player character. Stored fields are what a player picks or what changes in play.
 * Everything else is derived in prepareDerivedData() from module/rules.mjs.
 */
const SUBSTAT_BONUS_KEYS = Object.values(ELARIA.substats)
  .flatMap(g => Object.entries(g.rows).filter(([, r]) => !r.noBonus).map(([k]) => k));
const RESISTANCE_KEYS = [...Object.keys(ELARIA.resistanceElements), ...Object.keys(ELARIA.forms)];

export class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      level: int(1, { min: 1, max: 20 }),
      scalingEnabled: new f.BooleanField({ initial: true }),
      stats: new f.SchemaField(Object.fromEntries(Object.keys(ELARIA.stats).map(k => [k, statField()]))),
      resources: new f.SchemaField({
        hp: resourceField(),
        mp: resourceField(),
        ftg: resourceField(),
        lifePoints: new f.SchemaField({
          value: new f.NumberField({ required: true, nullable: true, integer: true, initial: null, min: 0 })
        })
      }),
      conditions: new f.SchemaField({
        injuries: int(0, { min: 0 }),
        exhaustion: int(0, { min: 0, max: ELARIA.maxExhaustion }),
        burst: new f.SchemaField({
          value: int(0, { min: 0 }),
          // max is derived from mood (Bursts/Alignment E12); not stored.
          mood: new f.StringField({ required: true, blank: true, initial: ELARIA.defaultMood }),
          usedToday: new f.BooleanField({ initial: false })
        }),
        secondWindUsed: new f.BooleanField({ initial: false })
      }),
      identity: new f.SchemaField({
        race: new f.StringField({ required: true, blank: true, initial: "" }),
        heritage: new f.StringField({ required: true, blank: true, initial: "" }),
        discipline1: new f.StringField({ required: true, blank: true, initial: "" }),
        discipline2: new f.StringField({ required: true, blank: true, initial: "" }),   // a discipline, "extraElement" or "plusOutput"
        profession: new f.StringField({ required: true, blank: true, initial: "" }),
        element1: new f.StringField({ required: true, blank: true, initial: "" }),
        element2: new f.StringField({ required: true, blank: true, initial: "" }),
        element3: new f.StringField({ required: true, blank: true, initial: "" }),     // only counts when discipline2 is "extraElement" (A7)
        form: new f.StringField({ required: true, initial: "mortal", choices: () => ELARIA.forms }),
        deity: new f.StringField({ required: true, blank: true, initial: "" }),
        deityRole: new f.StringField({ required: true, initial: "only", choices: () => ELARIA.deityRoles }),
        alignment: new f.StringField({ required: true, blank: true, initial: "" }),
        alignment2: new f.StringField({ required: true, blank: true, initial: "" }),   // optional second alignment
        background: new f.StringField({ required: true, blank: true, initial: "" }),
        burstEffect: new f.HTMLField({ required: true, blank: true, initial: "" }),   // the ability a burst grants
        biography: new f.HTMLField({ required: true, blank: true, initial: "" })
      }),
      armour: new f.SchemaField({
        aar: int(0, { min: 0 })   // old manual AAR (before armour items); moved into bonuses.aar by migrateData
      }),
      // Manual flat bonuses to sub-stats, for masteries that aren't automated yet.
      bonuses: new f.SchemaField(Object.fromEntries(SUBSTAT_BONUS_KEYS.map(k => [k, int(0)]))),
      // Manual resistance % per element and damage form. Positive = takes less, negative = takes more.
      resistances: new f.SchemaField(Object.fromEntries(RESISTANCE_KEYS.map(k => [k, int(0)]))),
      bagRank: int(1, { min: 1 }),
      // Coins (Shops and Inventory): 1 pp = 10 gp = 100 sp = 1 000 cp = 10 000 ironne
      coins: new f.SchemaField(Object.fromEntries(Object.keys(ELARIA.coins).map(k => [k, int(0, { min: 0 })])))
    };
  }

  /** v0.11: AAR now comes from worn armour; a manually typed AAR moves into the AAR bonus column. */
  static migrateData(source) {
    const old = source.armour?.aar;
    if (Number.isInteger(old) && old > 0) {
      source.bonuses ??= {};
      source.bonuses.aar = (source.bonuses.aar ?? 0) + old;
      source.armour.aar = 0;
    }
    return super.migrateData(source);
  }

  /** Give Active Effects a numeric target for each stat and for a few derived bonuses. */
  prepareBaseData() {
    for (const stat of Object.values(this.stats)) stat.effectBonus = 0;
    // Targets for Active Effects (kept apart from the stored manual bonuses so effects never get saved into them).
    this.effectBonuses = { reacts: 0, mv: 0, categoryCap: 0, output: 0 };
  }

  prepareDerivedData() {
    const lvl = this.level;

    // Stats (CS G46 / I46)
    let assigned = 0;
    const cap = R.perStatPointCap(lvl);
    for (const [key, stat] of Object.entries(this.stats)) {
      stat.base = lvl;
      stat.total = R.statTotal(lvl, stat.points, stat.scaling, this.scalingEnabled);
      stat.mod = R.statMod(stat.total, stat.bonus + stat.effectBonus);
      stat.overCap = stat.points > cap;
      stat.label = ELARIA.stats[key].label;
      assigned += stat.points;
    }
    const m = Object.fromEntries(Object.entries(this.stats).map(([k, s]) => [k, s.mod]));

    const available = R.statPointsAvailable(lvl);
    this.statPoints = { available, assigned, over: assigned > available, perStatCap: cap };
    this.scaling = R.scalingBalance(this.stats, ELARIA.majorStats);

    // Sub-stats: base from the formulas, plus a manual bonus column (and effects where supported).
    const b = this.bonuses, eff = this.effectBonuses;
    const sub = {};
    const put = (key, base, extra = 0) => (sub[key] = { base, bonus: b[key] ?? 0, total: base + (b[key] ?? 0) + extra });
    put("nar", m.stf);
    put("nmar", m.wis);
    // AAR: worn armour that isn't broken (A5), plus the manual bonus column.
    const worn = this.parent?.items?.filter(i => i.type === "gear" && i.system.location === "worn" && !i.system.broken) ?? [];
    this.wornArmourAAR = worn.filter(i => i.system.kind === "armour").reduce((n, i) => n + (i.system.armourRating ?? 0), 0);
    put("aar", this.wornArmourAAR + this.armour.aar);
    put("ar", sub.nar.total + sub.aar.total);                 // A5: AR = NAR + AAR
    put("mar", sub.nmar.total + sub.aar.total);               //     MAR = NMAR + AAR
    put("critChance", R.critChance(m.lck));
    put("critDamage", R.critDamage(m.ins));
    put("mv", R.movement(m.fin), eff.mv);
    put("reacts", R.reactsPerRound(m.awa), eff.reacts);
    put("passiveAwareness", R.passiveAwareness(m.awa));
    put("lifePointsMax", R.lifePointsMax(m.con));
    put("equipLoad", R.equipLoad(m.con));
    sub.bagRank = { base: this.bagRank, bonus: 0, total: this.bagRank };
    put("bagSlots", R.bagSlots(sub.equipLoad.total, this.bagRank));
    this.substats = sub;

    // Resources (CS L46–L48, L62)
    const exh = this.conditions.exhaustion;
    this.resources.hp.max = R.hpMax(m.con, lvl);
    this.resources.mp.max = R.mpMax(m.wis, lvl);
    this.resources.ftg.max = R.ftgMax(m.res, lvl, exh);
    this.resources.lifePoints.max = Math.max(0, sub.lifePointsMax.total);
    for (const res of Object.values(this.resources)) {
      // A fresh character (value null) starts full. Current never shows above max (A12).
      res.value = Math.min(res.value ?? res.max, res.max);
    }

    // Short names used by the header and roll data
    this.defence = { nar: sub.nar.total, nmar: sub.nmar.total, aar: sub.aar.total, ar: sub.ar.total, mar: sub.mar.total };
    this.combat = {
      mv: sub.mv.total,
      passiveAwareness: sub.passiveAwareness.total,
      reacts: sub.reacts.total,
      critChance: sub.critChance.total,
      critDamage: sub.critDamage.total,
      equipLoad: sub.equipLoad.total,
      bagSlots: sub.bagSlots.total
    };

    // Resistances: elements are manual only (PCs have none innate, A15); forms add the built-in values.
    const formBase = R.formResistances(this.identity.form);
    this.resistanceTotals = Object.fromEntries(Object.entries(this.resistances).map(([k, bonus]) => {
      const base = formBase[k] ?? 0;
      return [k, { base, bonus, total: base + bonus }];
    }));

    // Burst gauge maximum from mood. Unknown moods (e.g. old free-text values) count as Normal.
    const burst = this.conditions.burst;
    if (!(burst.mood in ELARIA.moods)) burst.mood = ELARIA.defaultMood;
    burst.max = ELARIA.moods[burst.mood];

    // Roll penalties (M: injuries, exhaustion)
    this.penalties = {
      check: this.conditions.injuries + (exh >= 4 ? 2 : 0),
      initiative: exh >= 1 ? 2 : 0
    };

    // Elements and mastery sources (CS B70–B79, A7, A18, A20)
    const id = this.identity;
    const extraElement = id.discipline2 === "extraElement";
    const elements = [id.element1, id.element2, extraElement ? id.element3 : ""].filter(e => e);
    this.elementList = elements;
    this.combos = R.elementCombos(elements);
    this.disciplineList = [id.discipline1, extraElement || id.discipline2 === "plusOutput" ? "" : id.discipline2]
      .filter(d => d);

    this.mastery = this.#prepareMasteries(lvl, id.discipline2 === "plusOutput");
  }

  /** Category totals and Maximum Output from equipped mastery items (CS E69–J83, J66). */
  #prepareMasteries(lvl, plusOutput) {
    const capBase = ELARIA.baseCategoryCap + this.effectBonuses.categoryCap;
    const categories = Object.fromEntries(Object.keys(ELARIA.masteryCategories)
      .map(k => [k, { cap: capBase, used: 0, over: false }]));
    let used = 0;
    for (const item of this.parent.items) {
      if (item.type !== "mastery" || !item.system.equipped) continue;
      const cat = item.system.slotCategory;
      if (!categories[cat]) continue;            // "none": set, bond, heritage abilities use no budget
      const value = item.system.value ?? 0;
      categories[cat].used += value;
      used += value;
    }
    for (const c of Object.values(categories)) c.over = c.used > c.cap;
    const max = R.maxOutput(lvl, plusOutput) + this.effectBonuses.output;
    return { categories, output: { used, max, over: used > max } };
  }

  /** Shortcuts for roll formulas: @str … @lck are modifiers, @lvl is level. */
  getRollData() {
    const data = { ...this, lvl: this.level, initiativePenalty: this.penalties?.initiative ?? 0 };
    for (const [k, s] of Object.entries(this.stats)) data[k] = s.mod;
    return data;
  }
}
