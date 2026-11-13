import { ELARIA } from "../config.mjs";
import * as R from "../rules.mjs";
import { hasJackOfAllTrades, JOAT_SOURCES } from "./item-mastery.mjs";
import { findHeritage, findRace, heritageMods } from "../helpers/ancestry.mjs";

const f = foundry.data.fields;

const int = (initial = 0, opts = {}) => new f.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

/** A resource with a stored current value and temp (overflow, spent first: A11). Max is derived. */
const resourceField = () => new f.SchemaField({
  value: new f.NumberField({ required: true, nullable: true, integer: true, initial: null, min: 0 }),
  temp: int(0, { min: 0 }),
  // Set in full editing mode (the lock): added to the formula maximum (negative lowers it).
  maxBonus: int(0)
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
        // For heritage mods like "+1 Strength or Precision": the stat picked for each "or" (by mod index).
        heritageChoices: new f.ArrayField(new f.StringField({ required: true, blank: true, initial: "" })),
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
        background: new f.StringField({ required: true, blank: true, initial: "" }),   // name (or free text if no background data)
        backgroundScale: new f.StringField({ required: true, blank: true, initial: "" }),  // nobility / military / civilian / criminal
        backgroundRoll: new f.NumberField({ required: true, nullable: true, integer: true, initial: null }),  // social standing
        burstName: new f.StringField({ required: true, blank: true, initial: "" }),   // the chosen burst's name
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
      coins: new f.SchemaField(Object.fromEntries(Object.keys(ELARIA.coins).map(k => [k, int(0, { min: 0 })]))),
      // Crafting materials owned: count per material per tier (t1 … t5).
      materials: new f.SchemaField(Object.fromEntries(Object.keys(ELARIA.materials).map(k => [k, new f.SchemaField(
        Object.fromEntries(ELARIA.materialTiers.map(t => [`t${t}`, int(0, { min: 0 })])))]))),
      // Inventory: show the total of all coins in silver beside them (toggle in edit mode).
      showCoinTotal: new f.BooleanField({ initial: true }),
      // Take FTG / MP costs off automatically when a mastery, ability or attack is used (toggle in edit mode).
      autoSpend: new f.BooleanField({ initial: true })
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
    // v0.12 dev builds stored a max override; it became a bonus on top of the formula.
    for (const key of ["hp", "mp", "ftg"]) {
      const r = source.resources?.[key];
      if (r && "maxOverride" in r) delete r.maxOverride;
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

    // Heritage stat modifiers (Ancestry tab), e.g. Bushido: +1 Str or Pre (chosen), −1 Smarts.
    const race = findRace(this.identity.race);
    this.heritageData = findHeritage(race, this.identity.heritage);
    this.heritageMods = heritageMods(this.heritageData, this.identity.heritageChoices ?? [], Object.keys(this.stats));
    const hm = this.heritageMods;

    // Stats (CS G46 / I46)
    let assigned = 0;
    const cap = R.perStatPointCap(lvl);
    for (const [key, stat] of Object.entries(this.stats)) {
      stat.base = lvl;
      stat.total = R.statTotal(lvl, stat.points, stat.scaling, this.scalingEnabled);
      stat.heritage = hm.stats[key] ?? 0;
      stat.mod = R.statMod(stat.total, stat.bonus + stat.effectBonus + stat.heritage);
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
    const put = (key, base, extra = 0) => {
      const heritage = hm.derived[key] ?? 0;
      return (sub[key] = { base, bonus: b[key] ?? 0, heritage, total: base + (b[key] ?? 0) + extra + heritage });
    };
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
    const formulaMax = { hp: R.hpMax(m.con, lvl), mp: R.mpMax(m.wis, lvl), ftg: R.ftgMax(m.res, lvl, exh) };
    for (const key of ["hp", "mp", "ftg"]) {
      const r = this.resources[key];
      r.formulaMax = formulaMax[key];
      r.heritage = hm.resources[key] ?? 0;
      r.max = Math.max(0, formulaMax[key] + (r.maxBonus ?? 0) + r.heritage);
    }
    this.resources.lifePoints.max = Math.max(0, sub.lifePointsMax.total);
    // Total coin value in silver, rounded to the smallest coin (ironne = 0.01 sp).
    this.coinTotalSp = Math.round(Object.entries(ELARIA.coinValueSp)
      .reduce((n, [k, v]) => n + (this.coins[k] ?? 0) * v, 0) * 100) / 100;
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
    return { categories, output: { used, max, over: used > max }, joat: this.#prepareJoat(lvl) };
  }

  /**
   * Jack of all Trades: equipped output from any single discipline or element may not exceed lvl/2 (rounded down, min 1).
   * A mastery listed under several disciplines counts toward whichever of them has the least so far.
   * @returns {{cap:number, groups:{name:string, used:number, over:boolean}[], over:object[]}|null}
   */
  #prepareJoat(lvl) {
    if (!hasJackOfAllTrades(this.parent)) return null;
    const cap = Math.max(1, Math.floor((lvl ?? 0) / 2));
    const used = new Map();
    const items = this.parent.items.filter(i => i.type === "mastery" && i.system.equipped && (i.system.value ?? 0) > 0
      && !/jack of all trades|\bjoat\b/i.test(i.name));
    for (const item of items) {
      const names = [...new Set(item.system.sources.filter(s => JOAT_SOURCES.has(s.type) && s.name).map(s => s.name))];
      if (!names.length) continue;
      const pick = names.reduce((a, b) => ((used.get(b) ?? 0) < (used.get(a) ?? 0) ? b : a));
      used.set(pick, (used.get(pick) ?? 0) + item.system.value);
    }
    const groups = [...used].map(([name, n]) => ({ name, used: n, over: n > cap })).sort((a, b) => a.name.localeCompare(b.name));
    return { cap, groups, over: groups.filter(g => g.over) };
  }

  /** Shortcuts for roll formulas: @str … @lck are modifiers, @lvl is level. */
  getRollData() {
    const data = { ...this, lvl: this.level, initiativePenalty: this.penalties?.initiative ?? 0 };
    for (const [k, s] of Object.entries(this.stats)) data[k] = s.mod;
    return data;
  }
}
