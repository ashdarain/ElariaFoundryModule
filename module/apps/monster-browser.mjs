const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = k => game.i18n.localize(k);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const PAGE = 150;

const INDEX_FIELDS = ["system.details.type", "system.details.power", "system.details.elements", "system.details.size",
  "system.resources.hp.max", "system.details.form"];

/**
 * Monster search (Actors sidebar, GM): every monster in the world (the imported Bestiary and hand-made ones) and
 * in Actor compendiums, with search, power range, type, element, size and source filters. Drag a row onto the
 * map to place a token (Foundry's own actor drop), or onto the combat tracker / a scene as usual; click the name
 * to open the sheet.
 */
export class ElariaMonsterBrowser extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "elaria-monster-browser",
    classes: ["elaria", "mastery-picker", "monster-browser"],
    window: { title: "ELARIA.Bestiary.browseTitle", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 640, height: 680 },
    actions: {
      view: ElariaMonsterBrowser.#onView,
      clear: ElariaMonsterBrowser.#onClear,
      refresh: ElariaMonsterBrowser.#onRefresh
    }
  };

  static PARTS = { body: { template: "systems/elaria/templates/apps/monster-browser.hbs" } };

  static open() {
    return (foundry.applications.instances.get("elaria-monster-browser") ?? new this()).render({ force: true });
  }

  #entries = null;
  #limit = PAGE;
  #filters = { text: "", powerMin: "", powerMax: "", type: "", element: "", size: "", source: "", sort: "power" };

  async #load() {
    const out = [];
    const add = (e, source, sourceLabel, folderPath) => {
      const d = e.system?.details ?? {};
      out.push({
        uuid: e.uuid, name: e.name, img: e.img, source, sourceLabel: folderPath ? `${sourceLabel} · ${folderPath}` : sourceLabel,
        type: String(d.type ?? "").trim(), power: Number.isFinite(Number(d.power)) ? Number(d.power) : null,
        elements: String(d.elements ?? ""), size: String(d.size ?? "").trim(), hp: e.system?.resources?.hp?.max ?? null,
        search: [e.name, d.type, d.elements, d.size].join(" ").toLowerCase()
      });
    };
    for (const a of game.actors) {
      if (a.type !== "monster" || !a.visible) continue;
      const path = [];
      for (let f = a.folder; f; f = f.folder) path.unshift(f.name);
      add(a, "world", L("ELARIA.Bestiary.world"), path.join(" / "));
    }
    for (const pack of game.packs.filter(p => p.documentName === "Actor" && p.visible)) {
      const index = await pack.getIndex({ fields: INDEX_FIELDS });
      for (const e of index) if (e.type === "monster") add(e, pack.collection, pack.metadata.label, "");
    }
    return out;
  }

  async _prepareContext() {
    this.#entries ??= await this.#load();
    const uniq = (list, f) => [...new Set(list.map(f).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
    const elements = Object.values(CONFIG.ELARIA?.resistanceElements ?? {});
    const sources = {};
    for (const e of this.#entries) sources[e.source] ??= e.source === "world" ? L("ELARIA.Bestiary.world") : e.sourceLabel;
    return {
      filters: this.#filters,
      typeChoices: { "": L("ELARIA.Bestiary.anyType"), ...Object.fromEntries(uniq(this.#entries, e => e.type).map(t => [t, t])) },
      sizeChoices: { "": L("ELARIA.Bestiary.anySize"), ...Object.fromEntries(uniq(this.#entries, e => e.size).map(t => [t, t])) },
      elementChoices: { "": L("ELARIA.Bestiary.anyElement"), ...Object.fromEntries((elements.length ? elements
        : ["Fire", "Ice", "Lightning", "Wind", "Water", "Earth", "Light", "Dark", "Poison", "Nature"]).map(e => [e, e])) },
      sourceChoices: { "": L("ELARIA.Bestiary.anySource"), ...sources },
      sortChoices: { power: L("ELARIA.Bestiary.sortPower"), name: L("ELARIA.Picker.sortName"), hp: L("ELARIA.Bestiary.sortHp") },
      powerMinChoices: { "": L("ELARIA.Picker.min"), ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, i + 1])) },
      powerMaxChoices: { "": L("ELARIA.Picker.max"), ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, i + 1])) }
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const read = () => {
      for (const input of el.querySelectorAll("[data-filter]")) this.#filters[input.dataset.filter] = input.value;
      this.#limit = PAGE;
      this.#renderResults();
    };
    el.querySelector("[data-filter=text]")?.addEventListener("input", foundry.utils.debounce(read, 150));
    for (const input of el.querySelectorAll("select[data-filter], input[type=number][data-filter]")) input.addEventListener("change", read);
    const list = el.querySelector(".results");
    list.addEventListener("dragstart", ev => {
      const row = ev.target.closest("[data-uuid]");
      if (row) ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: row.dataset.uuid }));
    });
    list.addEventListener("click", ev => {
      const more = ev.target.closest("[data-more]");
      if (!more) return;
      this.#limit = more.dataset.more === "all" ? Infinity : this.#limit + PAGE;
      this.#renderResults();
    });
    this.#renderResults();
    el.querySelector("[data-filter=text]")?.focus();
  }

  #matches() {
    const f = this.#filters;
    const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
    const min = f.powerMin === "" ? null : Number(f.powerMin), max = f.powerMax === "" ? null : Number(f.powerMax);
    const out = this.#entries.filter(e => {
      if (f.source && e.source !== f.source) return false;
      if (f.type && e.type !== f.type) return false;
      if (f.size && e.size !== f.size) return false;
      if (f.element && !new RegExp(`\\b${f.element}`, "i").test(e.elements)) return false;
      if (min !== null && (e.power === null || e.power < min)) return false;
      if (max !== null && (e.power === null || e.power > max)) return false;
      return words.every(w => e.search.includes(w));
    });
    const key = { power: e => e.power ?? 99, hp: e => -(e.hp ?? -1), name: () => 0 }[f.sort] ?? (() => 0);
    return out.sort((a, b) => (key(a) - key(b)) || a.name.localeCompare(b.name));
  }

  #renderResults() {
    const list = this.element.querySelector(".results");
    const matches = this.#matches();
    list.innerHTML = matches.slice(0, this.#limit).map(e => `
      <li class="pick monster-row" data-uuid="${e.uuid}" draggable="true">
        <img src="${esc(e.img)}" alt="">
        <div class="pick-main">
          <a class="pick-name" data-action="view">${esc(e.name)}</a>
          <div class="pick-source">${esc(e.sourceLabel)}</div>
          <div class="pick-meta">
            ${e.power !== null ? `<span class="power">${esc(game.i18n.format("ELARIA.Bestiary.powerN", { n: e.power }))}</span>` : ""}
            ${e.type ? `<span>${esc(e.type)}</span>` : ""}
            ${e.hp !== null ? `<span>HP ${e.hp}</span>` : ""}
            ${e.size ? `<span>${esc(e.size)}</span>` : ""}
            ${e.elements ? `<span>${esc(e.elements)}</span>` : ""}
          </div>
        </div>
        <span class="drag-hint" data-tooltip="${esc(L("ELARIA.Bestiary.dragHint"))}"><i class="fa-solid fa-grip-vertical"></i></span>
      </li>`).join("")
      + (matches.length > this.#limit ? `<li class="show-more"><a data-more="page">${game.i18n.format("ELARIA.Picker.showMore",
        { n: Math.min(PAGE, matches.length - this.#limit), left: matches.length - this.#limit })}</a>
        <a data-more="all">${game.i18n.format("ELARIA.Picker.showAll", { n: matches.length })}</a></li>` : "")
      || `<li class="empty">${L("ELARIA.Bestiary.noResults")}</li>`;
    this.element.querySelector(".count").textContent = game.i18n.format("ELARIA.Bestiary.count", { n: matches.length });
  }

  static async #onView(event, target) {
    (await fromUuid(target.closest("[data-uuid]").dataset.uuid))?.sheet.render({ force: true });
  }

  static #onClear() {
    this.#filters = { text: "", powerMin: "", powerMax: "", type: "", element: "", size: "", source: "", sort: "power" };
    return this.render();
  }

  static #onRefresh() {
    return this.reload();
  }

  /** Read the monsters again (after an import, or when one is made / changed / deleted). */
  reload() {
    this.#entries = null;
    return this.render();
  }
}

/** Keep the list current when monsters are made, changed or deleted. */
let timer = null;
export function refreshMonsterBrowser(doc) {
  if (doc?.type !== "monster") return;
  const app = foundry.applications.instances.get("elaria-monster-browser");
  if (!app?.rendered) return;
  clearTimeout(timer);
  timer = setTimeout(() => app.reload(), 300);
}
