import { ELARIA } from "../config.mjs";
import { sourceLabelFor } from "../data/item-mastery.mjs";
import { actorHasMastery, addMasteriesToActor, addGearToActor } from "../helpers/masteries.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** How many results are drawn at once. The search narrows the rest. */
const MAX_ROWS = 150;

const INDEX_FIELDS = {
  mastery: [
    "system.ref", "system.reqLevel", "system.value", "system.category", "system.sources",
    "system.isReaction", "system.tags", "system.cost", "system.damage.raw", "system.skillMod.raw"
  ],
  gear: [
    "system.ref", "system.reqLevel", "system.kind", "system.family", "system.tier", "system.tags", "system.classTrinket",
    "system.baseAttack.raw", "system.damageType", "system.armourRating", "system.weight", "system.equipLoad"
  ]
};

/**
 * Browse every mastery (or, with itemType "gear", every piece of gear) in the Item compendiums and the world's
 * Items, and add them to a character. Rows can also be dragged straight onto the character sheet.
 */
export class ElariaMasteryPicker extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor({ actor, itemType = "mastery", ...options } = {}) {
    super({ id: `elaria-${itemType}-picker-${actor?.id ?? "browse"}`, ...options });
    this.actor = actor;
    this.itemType = itemType;
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
  static open(actor, itemType = "mastery") {
    const existing = foundry.applications.instances.get(`elaria-${itemType}-picker-${actor?.id ?? "browse"}`);
    if (existing) return existing.render({ force: true });
    return new this({ actor, itemType }).render({ force: true });
  }

  get title() {
    if (!this.actor) return game.i18n.localize(this.isGear ? "ELARIA.Picker.browseGear" : "ELARIA.Picker.browseMasteries");
    return game.i18n.format(this.isGear ? "ELARIA.Picker.gearTitle" : "ELARIA.Picker.title", { name: this.actor.name });
  }

  /** All mastery entries, loaded once per window: {uuid, name, img, pack, packLabel, system, search}. */
  #entries = null;

  /** Current filter values (kept across re-renders). */
  #filters = { text: "", pack: "", category: "", mine: false, level: false };

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
    const tags = system.tags ?? [];
    return {
      uuid: e.uuid, name: e.name, img: e.img, pack, packLabel, system, sources, sourceLabel,
      search: [e.name, sourceLabel, ...tags].join(" ").toLowerCase()
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
      level: this.actor?.system?.level ?? "",
      total: this.#entries.length
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const read = () => {
      this.#filters = {
        text: el.querySelector("[name=text]").value,
        pack: el.querySelector("[name=pack]").value,
        category: el.querySelector("[name=category]").value,
        mine: el.querySelector("[name=mine]").checked,
        level: el.querySelector("[name=level]").checked
      };
      this.#renderResults();
    };
    el.querySelector("[name=text]").addEventListener("input", foundry.utils.debounce(read, 150));
    for (const input of el.querySelectorAll("select, input[type=checkbox]")) input.addEventListener("change", read);

    // Rows can be dragged onto any actor sheet; the sheet's drop handler does the rest.
    const list = el.querySelector(".results");
    list.addEventListener("dragstart", ev => {
      const row = ev.target.closest("[data-uuid]");
      if (!row) return;
      ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: row.dataset.uuid }));
    });
    this.#renderResults();
    el.querySelector("[name=text]").focus();
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
    const mine = f.mine && !this.isGear && this.actor ? this.#characterSources() : null;
    const level = this.actor?.system?.level;
    return this.#entries.filter(e => {
      if (f.pack && e.pack !== f.pack) return false;
      if (f.category && (this.isGear ? e.system.kind : e.system.category) !== f.category) return false;
      if (f.level && Number.isFinite(level) && e.system.reqLevel != null && e.system.reqLevel > level) return false;
      if (mine && !e.sources.some(s => ["bond", "general"].includes(s.type) || mine.has(String(s.name).toLowerCase()))) {
        return false;
      }
      return words.every(w => e.search.includes(w));
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
    list.innerHTML = matches.slice(0, MAX_ROWS).map(e => {
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
      ]).filter(m => m).map(m => `<span>${esc(String(m))}</span>`).join("");
      return `
        <li class="pick ${owned ? "owned" : ""}" data-uuid="${e.uuid}" draggable="true">
          <img src="${esc(e.img ?? "")}" alt="">
          <div class="pick-main">
            <a class="pick-name" data-action="view">${esc(e.name)}${s.isReaction || (s.tags ?? []).some(t => /^(reactions?|rxn)$/i.test(String(t).trim())) ? " <em>(rxn)</em>" : ""}</a>
            <div class="pick-source">${esc(e.sourceLabel)}${this.#filters.pack ? "" : ` <span class="pack">· ${esc(e.packLabel)}</span>`}</div>
            <div class="pick-meta">${meta}</div>
          </div>
          ${!this.actor ? ""
            : owned
              ? `<span class="pick-owned" data-tooltip="${L("ELARIA.Picker.owned")}"><i class="fa-solid fa-check"></i></span>`
              : `<a class="pick-add" data-action="add" data-tooltip="${L("ELARIA.Picker.add")}"><i class="fa-solid fa-plus"></i></a>`}
        </li>`;
    }).join("") || `<li class="empty">${L("ELARIA.Picker.noResults")}</li>`;
    list.scrollTop = scroll;
    const count = el.querySelector(".count");
    count.textContent = matches.length > MAX_ROWS
      ? game.i18n.format("ELARIA.Picker.countLimited", { shown: MAX_ROWS, n: matches.length })
      : game.i18n.format("ELARIA.Picker.count", { n: matches.length });
  }

  static async #onAdd(event, target) {
    const row = target.closest("[data-uuid]");
    const item = await fromUuid(row.dataset.uuid);
    if (!item) return;
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
    this.#filters = { text: "", pack: "", category: "", mine: false, level: false };
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
