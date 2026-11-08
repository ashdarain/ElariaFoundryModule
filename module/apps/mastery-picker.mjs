import { ELARIA } from "../config.mjs";
import { sourceLabelFor, hasJackOfAllTrades, JOAT_SOURCES } from "../data/item-mastery.mjs";
import { actorHasMastery, addMasteriesToActor, addGearToActor } from "../helpers/masteries.mjs";
import { DAMAGE_TYPES, profileFromText } from "../combat/damage.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** How many results are drawn at first; "Show more" adds this many again. */
const PAGE_ROWS = 150;

const INDEX_FIELDS = {
  mastery: [
    "system.ref", "system.reqLevel", "system.value", "system.category", "system.sources",
    "system.isReaction", "system.tags", "system.cost", "system.damage.raw", "system.skillMod.raw", "system.details",
    "system.usageLimit"
  ],
  gear: [
    "system.ref", "system.reqLevel", "system.kind", "system.family", "system.tier", "system.tags", "system.classTrinket",
    "system.baseAttack.raw", "system.damageType", "system.armourRating", "system.weight", "system.equipLoad",
    "system.breakpoint", "system.affinity", "system.description", "system.effects"
  ]
};

const PHYSICAL = new Set(["physical", "slashing", "piercing", "blunt", "chopping"]);
const MAGICAL = new Set(["magical", "magicalPiercing", "magicalChopping"]);
const strip = h => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

/** Every filter, at its "off" value. */
const BLANK_FILTERS = {
  text: "", inText: false, pack: "", category: "", sort: "name", tags: [],
  levelMin: "", levelMax: "", level: false,
  // masteries
  sourceType: "", sourceName: "", value: "", rxn: "", damage: "", dmgType: "", cost: "", aoe: false, multi: false,
  mine: false, hideOwned: false,
  // gear
  family: "", tierMin: "", tierMax: "", weight: "", affinity: "", classTrinket: "", loadMax: "", fitsLoad: false
};

/**
 * Browse every mastery (or, with itemType "gear", every piece of gear) in the Item compendiums and the world's
 * Items, and add them to a character. Rows can also be dragged straight onto the character sheet.
 */
export class ElariaMasteryPicker extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {object} [options.onPick]   Instead of adding to a character, + calls this with the item (GM Tools).
   * @param {string} [options.forName]  Shown in the title with onPick.
   */
  constructor({ actor, itemType = "mastery", onPick = null, forName = "", ...options } = {}) {
    super({ id: `elaria-${itemType}-picker-${onPick ? "pick" : actor?.id ?? "browse"}`, ...options });
    this.actor = actor;
    this.itemType = itemType;
    this.onPick = onPick;
    this.forName = forName;
  }

  get isGear() {
    return this.itemType === "gear";
  }

  static DEFAULT_OPTIONS = {
    classes: ["elaria", "mastery-picker"],
    position: { width: 640, height: 700 },
    window: { resizable: true, icon: "fa-solid fa-book-open" },
    actions: {
      add: ElariaMasteryPicker.#onAdd,
      view: ElariaMasteryPicker.#onView,
      clear: ElariaMasteryPicker.#onClear
    }
  };

  static PARTS = {
    body: { template: "systems/elaria/templates/apps/mastery-picker.hbs" }
  };

  /** Open (or bring forward) the picker for an actor. */
  /**
   * @param {Actor|null} actor   The character to add to; null just browses (rows can still be dragged anywhere).
   * @param {"mastery"|"gear"} itemType
   */
  static open(actor, itemType = "mastery", { onPick = null, forName = "" } = {}) {
    const existing = foundry.applications.instances.get(`elaria-${itemType}-picker-${onPick ? "pick" : actor?.id ?? "browse"}`);
    if (existing) {
      if (onPick) { existing.onPick = onPick; existing.forName = forName; }
      return existing.render({ force: true });
    }
    return new this({ actor, itemType, onPick, forName }).render({ force: true });
  }

  get title() {
    if (this.onPick) return game.i18n.format(this.isGear ? "ELARIA.GMTools.pickGearFor" : "ELARIA.GMTools.pickMasteriesFor", { name: this.forName });
    if (!this.actor) return game.i18n.localize(this.isGear ? "ELARIA.Picker.browseGear" : "ELARIA.Picker.browseMasteries");
    return game.i18n.format(this.isGear ? "ELARIA.Picker.gearTitle" : "ELARIA.Picker.title", { name: this.actor.name });
  }

  /** All mastery entries, loaded once per window: {uuid, name, img, pack, packLabel, system, search}. */
  #entries = null;

  /** How many rows are drawn (grows with "Show more"; back to one page when a filter changes). */
  #limit = PAGE_ROWS;

  /** Current filter values (kept across re-renders). */
  #filters = foundry.utils.deepClone(BLANK_FILTERS);

  async #loadEntries() {
    const entries = [];
    const packs = game.packs.filter(p => p.documentName === "Item" && p.visible);
    for (const pack of packs) {
      const index = await pack.getIndex({ fields: INDEX_FIELDS[this.itemType] });
      for (const e of index) {
        if (e.type !== this.itemType) continue;
        entries.push(this.#makeEntry(e, pack.collection, pack.metadata.label));
      }
    }
    for (const item of game.items) {
      if (item.type !== this.itemType || !item.visible) continue;
      entries.push(this.#makeEntry(item, "world", game.i18n.localize("ELARIA.Picker.worldItems")));
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  }

  #makeEntry(e, pack, packLabel) {
    const system = e.system ?? {};
    const sources = system.sources ?? [];
    const sourceLabel = this.isGear ? [system.family, system.classTrinket ? game.i18n.localize("ELARIA.Gear.classTrinket") : ""]
      .filter(x => x).join(" · ") : sourceLabelFor(sources);
    const tags = (system.tags ?? []).map(t => String(t).trim()).filter(Boolean);
    const lowTags = tags.map(t => t.toLowerCase());
    // Damage: masteries with dice in their Damage field (type from the tags); gear from its base attack + type.
    const dmgRaw = this.isGear ? system.baseAttack?.raw : system.damage?.raw;
    const hasDamage = /\d+\s*d\s*\d+/i.test(dmgRaw ?? "");
    const profile = hasDamage ? profileFromText([...tags, system.damageType ?? ""]) : null;
    const cost = String(system.cost ?? "").toLowerCase();
    const text = strip(this.isGear ? `${system.effects ?? ""} ${system.description ?? ""}` : system.details);
    // Source types this entry counts under. Set masteries list the disciplines they need as sources, so they
    // also count as "set" (and bond masteries as "bond") by their ref.
    const ref = String(system.ref ?? "");
    const sourceTypes = new Set(sources.map(src => src.type || "general"));
    if (ref.startsWith("set:")) sourceTypes.add("set");
    if (ref.startsWith("bond:")) sourceTypes.add("bond");
    return {
      uuid: e.uuid, name: e.name, img: e.img, pack, packLabel, system, sources, sourceTypes, sourceLabel, tags, lowTags,
      hasDamage, profile,
      isReaction: !!system.isReaction || lowTags.some(t => /^(reactions?|rxn)$/.test(t)),
      isAoe: lowTags.some(t => t.startsWith("aoe") || t.includes("area of effect")),
      isMulti: lowTags.some(t => t.startsWith("multi")) || /x\s*(\d+|#)/i.test(dmgRaw ?? ""),
      costs: {
        ftg: /\bftg\b|fatigue/.test(cost), mp: /\bmp\b|mana/.test(cost), hp: /\bhp\b|health/.test(cost),
        free: !cost || /^(0|none|free|n\/a|-|—)$/.test(cost.trim())
      },
      search: [e.name, sourceLabel, ...tags].join(" ").toLowerCase(),
      fullText: text.toLowerCase()
    };
  }

  async _prepareContext(options) {
    this.#entries ??= await this.#loadEntries();
    const packChoices = { "": game.i18n.localize("ELARIA.Picker.allCompendiums") };
    for (const e of this.#entries) packChoices[e.pack] ??= e.packLabel;
    const L = k => game.i18n.localize(k);
    return {
      filters: this.#filters,
      packChoices,
      isGear: this.isGear,
      categoryChoices: this.isGear
        ? { "": L("ELARIA.Picker.allKinds"), ...Object.fromEntries(Object.entries(ELARIA.gearKinds).map(([k, v]) => [k, L(v)])) }
        : {
          "": L("ELARIA.Picker.allCategories"),
          ...Object.fromEntries(Object.entries(ELARIA.masteryCategories).map(([k, v]) => [k, L(v)])),
          any: L("ELARIA.Category.any"),
          none: L("ELARIA.Mastery.noCategory")
        },
      hasActor: !!this.actor,
      isCharacter: this.actor?.type === "character",
      level: this.actor?.system?.level ?? "",
      equipLoad: this.actor?.system?.combat?.equipLoad ?? "",
      total: this.#entries.length,
      ...this.#choices(),
      activeCount: this.#activeCount(),
      moreOpen: this._moreOpen ?? this.#activeCount() > 0
    };
  }

  /** Options for the detailed filters, built from what's actually in the compendiums. */
  #choices() {
    const L = k => game.i18n.localize(k);
    const entries = this.#entries;
    const count = new Map();
    for (const e of entries) for (const t of e.tags) count.set(t, (count.get(t) ?? 0) + 1);
    const tagChoices = { "": L("ELARIA.Picker.addTag") };
    for (const [t, n] of [...count].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!this.#filters.tags.includes(t)) tagChoices[t] = `${t} (${n})`;
    }
    const dmgTypeChoices = {
      "": L("ELARIA.Picker.anyDamageType"),
      "group:physical": L("ELARIA.Picker.anyPhysical"),
      "group:magical": L("ELARIA.Picker.anyMagical"),
      ...Object.fromEntries(Object.entries(DAMAGE_TYPES).map(([k, v]) => [`type:${k}`, L(v)])),
      ...Object.fromEntries(Object.entries(ELARIA.resistanceElements).map(([k, v]) => [`el:${k}`, `${L("ELARIA.Damage.element")}: ${v}`])),
      "form:divine": `${L("ELARIA.Damage.form")}: ${L("ELARIA.Form.divine")}`,
      "form:demonic": `${L("ELARIA.Damage.form")}: ${L("ELARIA.Form.demonic")}`
    };
    const sortChoices = this.isGear
      ? { name: L("ELARIA.Picker.sortName"), level: L("ELARIA.Picker.sortLevel"), tier: L("ELARIA.Picker.sortTier"),
        aar: "AAR", load: L("ELARIA.Gear.equipLoad") }
      : { name: L("ELARIA.Picker.sortName"), level: L("ELARIA.Picker.sortLevel"), value: L("ELARIA.Mastery.FIELDS.value"),
        source: L("ELARIA.Picker.sortSource") };
    if (this.isGear) {
      const families = [...new Set(entries.map(e => e.system.family).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const weights = [...new Set(entries.map(e => String(e.system.weight ?? "").trim()).filter(Boolean))].sort();
      const affinities = [...new Set(entries.flatMap(e => String(e.system.affinity ?? "").split(/[,/]/).map(a => a.trim()))
        .filter(Boolean))].sort((a, b) => a.localeCompare(b));
      return {
        tagChoices, dmgTypeChoices, sortChoices,
        familyChoices: { "": L("ELARIA.Picker.allFamilies"), ...Object.fromEntries(families.map(f => [f, f])) },
        weightChoices: { "": L("ELARIA.Picker.anyWeight"), ...Object.fromEntries(weights.map(w => [w, w])) },
        affinityChoices: { "": L("ELARIA.Picker.anyAffinity"), ...Object.fromEntries(affinities.map(a => [a, a])) },
        trinketChoices: { "": L("ELARIA.Picker.anyTrinket"), only: L("ELARIA.Picker.classOnly"), exclude: L("ELARIA.Picker.classExclude") }
      };
    }
    // Source names for the chosen source type (e.g. every discipline), with counts.
    const names = new Map();
    const type = this.#filters.sourceType;
    for (const e of entries) {
      if (type && !e.sourceTypes.has(type)) continue;
      // For a type the entry has directly, only its sources of that type; set / bond (by ref) list all of them.
      const own = e.sources.filter(src => (src.type || "general") === type);
      for (const src of (type && own.length ? own : e.sources)) {
        if (src.name) names.set(src.name, (names.get(src.name) ?? 0) + 1);
      }
    }
    const values = [...new Set(entries.map(e => e.system.value).filter(v => v != null))].sort((a, b) => a - b);
    return {
      tagChoices, dmgTypeChoices, sortChoices,
      sourceTypeChoices: { "": L("ELARIA.Picker.allSourceTypes"),
        ...Object.fromEntries(Object.entries(ELARIA.masterySources).map(([k, v]) => [k, L(v)])) },
      sourceNameChoices: { "": L("ELARIA.Picker.allSources"),
        ...Object.fromEntries([...names].sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => [n, `${n} (${c})`])) },
      valueChoices: { "": L("ELARIA.Picker.anyValue"), ...Object.fromEntries(values.map(v => [v, String(v)])) },
      rxnChoices: { "": L("ELARIA.Picker.rxnAny"), only: L("ELARIA.Picker.rxnOnly"), exclude: L("ELARIA.Picker.rxnExclude") },
      damageChoices: { "": L("ELARIA.Picker.dmgAny"), damage: L("ELARIA.Picker.dmgYes"), none: L("ELARIA.Picker.dmgNo"),
        skill: L("ELARIA.Picker.hasSkill") },
      costChoices: { "": L("ELARIA.Picker.costAny"), ftg: L("ELARIA.Resource.ftg"), mp: L("ELARIA.Resource.mp"),
        hp: L("ELARIA.Resource.hp"), free: L("ELARIA.Picker.costFree") }
    };
  }

  /** How many detailed filters are on (shown on the "More filters" toggle). */
  #activeCount() {
    const f = this.#filters;
    const skip = new Set(["text", "pack", "category", "sort", "tags", "mine", "level"]);
    return Object.entries(f).filter(([k, v]) => !skip.has(k) && v !== "" && v !== false).length + f.tags.length;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const read = (ev) => {
      for (const input of el.querySelectorAll("[data-filter]")) {
        const key = input.dataset.filter;
        this.#filters[key] = input.type === "checkbox" ? input.checked : input.value;
      }
      // Picking a tag adds it to the list; a new source type resets the source name.
      if (ev?.target?.name === "addTag" && ev.target.value) {
        this.#filters.tags = [...new Set([...this.#filters.tags, ev.target.value])];
        return this.render();
      }
      if (ev?.target?.dataset.filter === "sourceType") {
        this.#filters.sourceName = "";
        return this.render();
      }
      this.#limit = PAGE_ROWS;
      this.#renderResults();
      this.#updateBadge();
    };
    for (const input of el.querySelectorAll("input[type=search], input[type=number]")) {
      input.addEventListener("input", foundry.utils.debounce(read, 150));
    }
    for (const input of el.querySelectorAll("select, input[type=checkbox]")) input.addEventListener("change", read);
    for (const chip of el.querySelectorAll(".tag-chip")) chip.addEventListener("click", () => {
      this.#filters.tags = this.#filters.tags.filter(t => t !== chip.dataset.tag);
      this.render();
    });
    const more = el.querySelector("details.more-filters");
    more?.addEventListener("toggle", () => (this._moreOpen = more.open));

    // Rows can be dragged onto any actor sheet; the sheet's drop handler does the rest.
    const list = el.querySelector(".results");
    list.addEventListener("click", ev => {
      const more = ev.target.closest("[data-more]");
      if (!more) return;
      ev.preventDefault();
      this.#limit = more.dataset.more === "all" ? Infinity : this.#limit + PAGE_ROWS;
      this.#renderResults();
    });
    list.addEventListener("dragstart", ev => {
      const row = ev.target.closest("[data-uuid]");
      if (!row) return;
      ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: row.dataset.uuid }));
    });
    this.#renderResults();
    el.querySelector("[name=text]").focus();
  }

  #updateBadge() {
    const badge = this.element.querySelector(".more-filters .badge");
    if (!badge) return;
    const n = this.#activeCount();
    badge.textContent = n;
    badge.hidden = !n;
  }

  /** Names this character's masteries can come from (race, heritage, elements, deity, disciplines, profession). */
  #characterSources() {
    const sys = this.actor.system;
    const id = sys.identity ?? {};
    return new Set([
      id.race, id.heritage, id.race && id.heritage ? `${id.race} · ${id.heritage}` : "",
      ...(sys.elementList ?? []), ...(sys.combos ?? []), id.deity, ...(sys.disciplineList ?? []), id.profession
    ].filter(s => s).map(s => s.toLowerCase()));
  }

  #matches() {
    const f = this.#filters;
    const words = f.text.toLowerCase().split(/\s+/).filter(w => w);
    const mine = f.mine && !this.isGear && this.actor?.type === "character" ? this.#characterSources() : null;
    const joat = !!mine && hasJackOfAllTrades(this.actor);
    const level = this.actor?.system?.level;
    const num = v => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
    const lvMin = num(f.levelMin), lvMax = num(f.levelMax), tMin = num(f.tierMin), tMax = num(f.tierMax);
    const loadMax = f.fitsLoad && Number.isFinite(this.actor?.system?.combat?.equipLoad)
      ? this.actor.system.combat.equipLoad : num(f.loadMax);
    const tags = f.tags.map(t => t.toLowerCase());
    const out = this.#entries.filter(e => {
      const s = e.system;
      if (f.pack && e.pack !== f.pack) return false;
      if (f.category && (this.isGear ? s.kind : s.category) !== f.category) return false;
      const req = s.reqLevel;
      if (f.level && Number.isFinite(level) && req != null && req > level) return false;
      if (lvMin !== null && (req == null || req < lvMin)) return false;
      if (lvMax !== null && req != null && req > lvMax) return false;
      if (tags.length && !tags.every(t => e.lowTags.includes(t))) return false;
      if (f.dmgType && !this.#damageMatches(e, f.dmgType)) return false;
      if (this.isGear) {
        if (f.family && s.family !== f.family) return false;
        if (tMin !== null && (s.tier == null || s.tier < tMin)) return false;
        if (tMax !== null && s.tier != null && s.tier > tMax) return false;
        if (f.weight && String(s.weight ?? "").trim() !== f.weight) return false;
        if (f.affinity && !String(s.affinity ?? "").split(/[,/]/).map(a => a.trim()).includes(f.affinity)) return false;
        if (f.classTrinket === "only" && !s.classTrinket) return false;
        if (f.classTrinket === "exclude" && s.classTrinket) return false;
        if (loadMax !== null && s.equipLoad != null && s.equipLoad > loadMax) return false;
      } else {
        if (f.sourceType && !e.sourceTypes.has(f.sourceType)) return false;
        if (f.sourceName && !e.sources.some(src => src.name === f.sourceName)) return false;
        if (f.value !== "" && String(s.value) !== String(f.value)) return false;
        if (f.rxn === "only" && !e.isReaction) return false;
        if (f.rxn === "exclude" && e.isReaction) return false;
        if (f.damage === "damage" && !e.hasDamage) return false;
        if (f.damage === "none" && e.hasDamage) return false;
        if (f.damage === "skill" && !s.skillMod?.raw) return false;
        if (f.cost && !e.costs[f.cost]) return false;
        if (f.aoe && !e.isAoe) return false;
        if (f.multi && !e.isMulti) return false;
        if (mine && !e.sources.some(src => ["bond", "general"].includes(src.type) || (joat && JOAT_SOURCES.has(src.type))
          || mine.has(String(src.name).toLowerCase()))) {
          return false;
        }
        if (f.hideOwned && this.actor && actorHasMastery(this.actor, e)) return false;
      }
      return words.every(w => e.search.includes(w) || (f.inText && e.fullText.includes(w)));
    });
    return this.#sort(out);
  }

  /** "group:physical", "type:slashing", "el:fire", "form:divine" */
  #damageMatches(e, key) {
    const p = e.profile;
    if (!p) return false;
    const [kind, value] = key.split(":");
    if (kind === "group") return value === "physical" ? PHYSICAL.has(p.type) : MAGICAL.has(p.type);
    if (kind === "type") return p.type === value;
    if (kind === "el") return p.element === value;
    if (kind === "form") return p.form === value;
    return true;
  }

  #sort(list) {
    const by = this.#filters.sort;
    const n = v => (v == null ? Infinity : Number(v));
    const keyed = {
      level: e => n(e.system.reqLevel), value: e => n(e.system.value), tier: e => n(e.system.tier),
      aar: e => -(e.system.armourRating ?? -Infinity), load: e => n(e.system.equipLoad),
      source: e => e.sourceLabel || "\uffff"
    }[by];
    if (!keyed) return list;
    return [...list].sort((a, b) => {
      const x = keyed(a), y = keyed(b);
      if (x < y) return -1;
      if (x > y) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  #renderResults() {
    const el = this.element;
    const list = el.querySelector(".results");
    const matches = this.#matches();
    const scroll = list.scrollTop;
    const esc = foundry.utils.escapeHTML;
    const L = k => game.i18n.localize(k);
    const catLabel = c => c === "any" ? L("ELARIA.Category.any") : c === "none" ? "" : L(ELARIA.masteryCategories[c] ?? c);
    list.innerHTML = matches.slice(0, this.#limit).map(e => {
      const s = e.system;
      // Gear can be owned several times, so it never shows as "already known".
      const owned = !this.isGear && !!this.actor && actorHasMastery(this.actor, e);
      const meta = (this.isGear ? [
        L(ELARIA.gearKinds[s.kind] ?? s.kind),
        s.tier ? game.i18n.format("ELARIA.Gear.tierN", { n: s.tier }) : "",
        s.reqLevel != null ? `${L("ELARIA.Mastery.lvl")} ${s.reqLevel}` : "",
        s.baseAttack?.raw ? `${s.baseAttack.raw}${s.damageType ? ` ${s.damageType}` : ""}` : "",
        s.armourRating != null ? `AAR ${s.armourRating}${s.weight ? ` ${s.weight}` : ""}` : "",
        s.equipLoad != null ? `${L("ELARIA.Gear.equipLoadShort")} ${s.equipLoad}` : ""
      ] : [
        catLabel(s.category),
        s.reqLevel != null ? `${L("ELARIA.Mastery.lvl")} ${s.reqLevel}` : "",
        s.value != null ? `${L("ELARIA.Mastery.FIELDS.value")} ${s.value}` : "",
        s.skillMod?.raw, s.damage?.raw, s.cost
      ]).filter(m => m).map(m => `<span>${esc(String(m))}</span>`).join("")
        + (this.#filters.tags.length || this.#filters.dmgType
          ? e.tags.filter(t => this.#filters.tags.includes(t)).map(t => `<span class="tag-hit">${esc(t)}</span>`).join("") : "");
      return `
        <li class="pick ${owned ? "owned" : ""}" data-uuid="${e.uuid}" draggable="true">
          <img src="${esc(e.img ?? "")}" alt="">
          <div class="pick-main">
            <a class="pick-name" data-action="view">${esc(e.name)}${s.isReaction || (s.tags ?? []).some(t => /^(reactions?|rxn)$/i.test(String(t).trim())) ? " <em>(rxn)</em>" : ""}</a>
            <div class="pick-source">${esc(e.sourceLabel)}${this.#filters.pack ? "" : ` <span class="pack">· ${esc(e.packLabel)}</span>`}</div>
            <div class="pick-meta">${meta}</div>
          </div>
          ${!this.actor && !this.onPick ? ""
            : owned
              ? `<span class="pick-owned" data-tooltip="${L("ELARIA.Picker.owned")}"><i class="fa-solid fa-check"></i></span>`
              : `<a class="pick-add" data-action="add" data-tooltip="${L("ELARIA.Picker.add")}"><i class="fa-solid fa-plus"></i></a>`}
        </li>`;
    }).join("") + (matches.length > this.#limit ? `<li class="show-more">
        <a data-more="page"><i class="fa-solid fa-angles-down"></i> ${game.i18n.format("ELARIA.Picker.showMore",
          { n: Math.min(PAGE_ROWS, matches.length - this.#limit), left: matches.length - this.#limit })}</a>
        <a data-more="all">${game.i18n.format("ELARIA.Picker.showAll", { n: matches.length })}</a></li>` : "")
      || `<li class="empty">${L("ELARIA.Picker.noResults")}</li>`;
    list.scrollTop = scroll;
    const count = el.querySelector(".count");
    count.textContent = matches.length > this.#limit
      ? game.i18n.format("ELARIA.Picker.countLimited", { shown: this.#limit, n: matches.length })
      : game.i18n.format("ELARIA.Picker.count", { n: matches.length });
  }

  static async #onAdd(event, target) {
    const row = target.closest("[data-uuid]");
    const item = await fromUuid(row.dataset.uuid);
    if (!item) return;
    if (this.onPick) {
      await this.onPick(item);
      return ui.notifications.info(game.i18n.format("ELARIA.GMTools.queued", { item: item.name, name: this.forName }));
    }
    target.classList.add("busy");
    const [created] = this.isGear ? await addGearToActor(this.actor, [item]) : await addMasteriesToActor(this.actor, [item]);
    if (created) ui.notifications.info(game.i18n.format("ELARIA.Picker.added", { item: created.name, name: this.actor.name }));
    this.#renderResults();
  }

  static async #onView(event, target) {
    const item = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    item?.sheet.render({ force: true });
  }

  static #onClear() {
    this.#filters = foundry.utils.deepClone(BLANK_FILTERS);
    this.#limit = PAGE_ROWS;
    return this.render();
  }

  /** Keep the owned ticks current while the window is open. */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const refresh = (item) => { if (this.actor && item.parent === this.actor && this.rendered) this.#renderResults(); };
    this._hooks = [
      ["createItem", Hooks.on("createItem", refresh)],
      ["deleteItem", Hooks.on("deleteItem", refresh)]
    ];
  }

  _onClose(options) {
    super._onClose(options);
    for (const [hook, id] of this._hooks ?? []) Hooks.off(hook, id);
  }
}
