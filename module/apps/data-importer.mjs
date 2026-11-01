import { downloadSheet, parseSheetLink, SheetError } from "../importer/google-sheet.mjs";
import { readXlsx } from "../importer/xlsx.mjs";
import { convertWorkbook, DEFAULT_CONFIG } from "../importer/convert.mjs";
import { buildCompendiumData, PACKS } from "../importer/build.mjs";
import { packBanner } from "./compendium-banners.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const SETTING_LINK = "sheetLink";
/** The optional config file a GM can edit in the system folder (see README → Import config). */
const CONFIG_FILE = "import-config.json";
const CHUNK = 200;

/**
 * GM tool: downloads the Elaria Google Sheet (read-only, see google-sheet.mjs), converts every mastery tab, and
 * creates or updates one world compendium per mastery type. Re-running it updates the compendiums in place;
 * ids are stable, so nothing is duplicated.
 */
export class ElariaDataImporter extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "elaria-data-importer",
    tag: "form",
    classes: ["elaria", "data-importer"],
    window: { title: "ELARIA.Importer.title", icon: "fa-solid fa-file-import", resizable: true },
    position: { width: 660, height: "auto" },
    form: { handler: ElariaDataImporter.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      check: ElariaDataImporter.#onCheck,
      runImport: ElariaDataImporter.#onImport
    }
  };

  static PARTS = {
    body: { template: "systems/elaria/templates/apps/data-importer.hbs" }
  };

  /** Register the sheet-link setting and the settings-menu entry. Called from init. */
  static registerSettings() {
    game.settings.register("elaria", SETTING_LINK, {
      name: "ELARIA.Importer.linkSetting",
      scope: "world", config: false, type: String, default: ""
    });
    game.settings.registerMenu("elaria", "dataImporter", {
      name: "ELARIA.Importer.title",
      label: "ELARIA.Importer.open",
      hint: "ELARIA.Importer.menuHint",
      icon: "fa-solid fa-file-import",
      type: ElariaDataImporter,
      restricted: true
    });
  }

  /** Add an "Import from Google Sheet" button to the Compendium sidebar for GMs. */
  static addSidebarButton(app, html) {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".elaria-import-button")) return;
    const target = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
    if (!target) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "elaria-import-button";
    button.innerHTML = `<i class="fa-solid fa-file-import"></i> ${game.i18n.localize("ELARIA.Importer.open")}`;
    button.addEventListener("click", () => new ElariaDataImporter().render(true));
    target.append(button);
  }

  /* -------------------------------------------- */

  #state = "idle";          // idle | loading | ready | importing | done | error
  #error = "";
  #conversion = null;       // { index, docs, warnings, notes, unknownTags }
  #build = null;            // result of buildCompendiumData
  #diff = null;
  #downloadedAt = null;
  #progress = { pct: 0, label: "" };
  #removeMissing = true;
  #summary = null;

  /** The sheet link saved for this world; if none yet, the import config's defaultSheetLink (if any). */
  get sheetLink() {
    return game.settings.get("elaria", SETTING_LINK) || this.#importConfig?.defaultSheetLink || "";
  }

  /** Contents of import-config.json (null until loaded; {} if there is none). */
  #importConfig = null;
  #configNote = "";

  /**
   * Read import-config.json from the system folder and merge it over the built-in defaults.
   * Returns { converter: config for convertWorkbook, enabled: Set of compendium keys to import }.
   */
  async #loadImportConfig() {
    let user = {};
    this.#configNote = "";
    try {
      const res = await fetch(`systems/${game.system.id}/${CONFIG_FILE}`, { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        try {
          user = JSON.parse(text);
        } catch (err) {
          throw new Error(game.i18n.format("ELARIA.Importer.configBroken", { file: CONFIG_FILE, detail: err.message }));
        }
      }
    } catch (err) {
      if (err.message?.includes(CONFIG_FILE)) throw err;   // broken JSON: stop and say so
      user = {};                                           // no file: defaults
    }
    this.#importConfig = user;
    const converter = foundry.utils.deepClone(DEFAULT_CONFIG);
    if (user.tabs && typeof user.tabs === "object") Object.assign(converter.sheets, user.tabs);
    if (Array.isArray(user.ignoredTabs)) converter.ignoredSheets = user.ignoredTabs;
    if (typeof user.autoDetectDisciplines === "boolean") converter.autoDetectDisciplines = user.autoDetectDisciplines;
    if (user.gearBaseAliases && typeof user.gearBaseAliases === "object") converter.gearBaseAliases = user.gearBaseAliases;
    const enabled = new Set(Object.keys(PACKS).filter(k => user.compendiums?.[k] !== false));
    const off = Object.keys(PACKS).filter(k => !enabled.has(k)).map(k => PACKS[k].label);
    if (off.length) this.#configNote = game.i18n.format("ELARIA.Importer.configOff", { file: CONFIG_FILE, list: off.join(", ") });
    return { converter, enabled };
  }

  async _prepareContext() {
    const busy = this.#state === "loading" || this.#state === "importing";
    const diffRows = this.#diff ? Object.values(this.#diff) : [];
    const sum = key => diffRows.reduce((n, r) => n + r[key], 0);
    if (this.#importConfig === null) {
      try { await this.#loadImportConfig(); } catch (err) { this.#configNote = err.message; }
    }
    let linkValid = true;
    if (this.sheetLink) {
      try { parseSheetLink(this.sheetLink); } catch { linkValid = false; }
    }
    const conv = this.#conversion;
    return {
      link: this.sheetLink,
      hasLink: !!this.sheetLink,
      linkValid,
      configNote: this.#configNote,
      state: this.#state,
      busy,
      error: this.#error,
      progress: this.#progress,
      report: this.#build?.report,
      downloadedAt: this.#downloadedAt ? this.#downloadedAt.toLocaleString() : "",
      sheetWarnings: conv ? conv.warnings.map(([where, msg]) => ({ where, msg })) : [],
      unknownTags: conv ? conv.unknownTags.map(([tag, n]) => ({ tag, n })) : [],
      diffRows,
      totals: diffRows.length ? {
        total: sum("total"), created: sum("created"), changed: sum("changed"),
        unchanged: sum("unchanged"), removed: sum("removed")
      } : null,
      canImport: this.#state === "ready" || this.#state === "done",
      removeMissing: this.#removeMissing,
      summary: this.#summary
    };
  }

  /* -------------------------------------------- */
  /*  Download, convert, compare                  */
  /* -------------------------------------------- */

  #setProgress(pct, label) {
    this.#progress = { pct: Math.round(pct), label };
    const bar = this.element?.querySelector(".importer-progress .fill");
    const text = this.element?.querySelector(".importer-progress .label");
    if (bar) bar.style.width = `${this.#progress.pct}%`;
    if (text) text.textContent = label;
  }

  /** Let the progress bar paint between the heavy steps. */
  #yield() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  #errorMessage(err) {
    if (err instanceof SheetError) {
      return game.i18n.format(`ELARIA.Importer.error.${err.code}`, { detail: err.detail });
    }
    return err.message;
  }

  async #check() {
    this.#state = "loading";
    this.#error = "";
    this.#summary = null;
    await this.render();
    const L = k => game.i18n.localize(`ELARIA.Importer.step.${k}`);
    try {
      if (!this.sheetLink) throw new Error(game.i18n.localize("ELARIA.Importer.noLink"));
      const { converter, enabled } = await this.#loadImportConfig();
      this.#setProgress(5, L("download"));
      const buffer = await downloadSheet(this.sheetLink);
      this.#downloadedAt = new Date();

      this.#setProgress(35, L("read"));
      await this.#yield();
      const workbook = await readXlsx(buffer);

      this.#setProgress(55, L("convert"));
      await this.#yield();
      this.#conversion = convertWorkbook(workbook, {
        config: converter,
        source: { downloadedAt: this.#downloadedAt.toISOString() }
      });

      this.#setProgress(75, L("build"));
      await this.#yield();
      const { index, docs } = this.#conversion;
      this.#build = await buildCompendiumData(index, async p => docs.get(p));
      // Compendiums turned off in import-config.json are left alone (not created, updated or emptied).
      for (const key of Object.keys(this.#build.packs)) if (!enabled.has(key)) delete this.#build.packs[key];

      this.#setProgress(90, L("compare"));
      this.#diff = await this.#computeDiff();
      this.#state = "ready";
    } catch (err) {
      console.error("Elaria | Sheet check failed", err);
      this.#error = this.#errorMessage(err);
      this.#state = "error";
    }
    return this.render();
  }

  #packFor(key) {
    return game.packs.get(`world.${PACKS[key].name}`);
  }

  async #computeDiff() {
    const diff = {};
    for (const [key, built] of Object.entries(this.#build.packs)) {
      const pack = this.#packFor(key);
      const row = { key, label: built.meta.label, exists: !!pack, total: built.items.length, created: 0, changed: 0, unchanged: 0, removed: 0 };
      const existing = new Map();
      if (pack) {
        const index = await pack.getIndex({ fields: ["flags.elaria"] });
        for (const e of index) existing.set(e._id, e.flags?.elaria);
      }
      const incoming = new Set();
      for (const it of built.items) {
        incoming.add(it._id);
        const old = existing.get(it._id);
        if (!old) row.created++;
        else if (old.hash !== it.flags.elaria.hash) row.changed++;
        else row.unchanged++;
      }
      for (const [id, flags] of existing) if (!incoming.has(id) && flags?.imported) row.removed++;
      diff[key] = row;
    }
    return diff;
  }

  /* -------------------------------------------- */
  /*  Import into compendiums                     */
  /* -------------------------------------------- */

  async #import() {
    if (!this.#build) return;
    this.#state = "importing";
    this.#summary = null;
    await this.render();
    const ItemCls = CONFIG.Item.documentClass;
    const FolderCls = CONFIG.Folder.documentClass;
    const CompendiumCollection = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
    const summary = { created: 0, updated: 0, removed: 0, savedTo: "" };
    const entries = Object.entries(this.#build.packs);
    try {
      for (let p = 0; p < entries.length; p++) {
        const [key, built] = entries[p];
        const base = (p / entries.length) * 95;
        const step = 95 / entries.length;
        this.#setProgress(base, built.meta.label);

        let pack = this.#packFor(key);
        if (!pack) {
          pack = await CompendiumCollection.createCompendium({
            type: "Item", label: built.meta.label, name: built.meta.name, package: "world",
            ...(packBanner(key) ? { banner: packBanner(key) } : {})
          });
        }
        if (pack.locked) await pack.configure({ locked: false });
        const opts = { pack: pack.collection };

        // Folders (parents first; the builder emits them in that order)
        const haveFolders = new Set(pack.folders.map(f => f.id));
        const newFolders = built.folders.filter(f => !haveFolders.has(f._id));
        if (newFolders.length) await FolderCls.createDocuments(newFolders, { ...opts, keepId: true });
        const renamed = built.folders.filter(f => haveFolders.has(f._id) && pack.folders.get(f._id)?.name !== f.name)
          .map(f => ({ _id: f._id, name: f.name }));
        if (renamed.length) await FolderCls.updateDocuments(renamed, opts);

        // Items
        const index = await pack.getIndex({ fields: ["flags.elaria"] });
        const existing = new Map(index.map(e => [e._id, e.flags?.elaria]));
        const toCreate = [], toUpdate = [];
        const incoming = new Set();
        for (const it of built.items) {
          incoming.add(it._id);
          const old = existing.get(it._id);
          if (!old) toCreate.push(it);
          else if (old.hash !== it.flags.elaria.hash) toUpdate.push(it);
        }
        const toDelete = this.#removeMissing
          ? [...existing].filter(([id, f]) => !incoming.has(id) && f?.imported).map(([id]) => id) : [];

        const work = toCreate.length + toUpdate.length + toDelete.length || 1;
        let done = 0;
        const tick = n => { done += n; this.#setProgress(base + step * (done / work), `${built.meta.label}: ${done} / ${work}`); };

        for (let i = 0; i < toCreate.length; i += CHUNK) {
          const chunk = toCreate.slice(i, i + CHUNK);
          await ItemCls.createDocuments(chunk, { ...opts, keepId: true });
          tick(chunk.length);
        }
        for (let i = 0; i < toUpdate.length; i += CHUNK) {
          const chunk = toUpdate.slice(i, i + CHUNK);
          // recursive: false replaces system/flags wholesale, so removed tags, sources etc. really go away.
          await ItemCls.updateDocuments(chunk, { ...opts, recursive: false, diff: false });
          tick(chunk.length);
        }
        for (let i = 0; i < toDelete.length; i += CHUNK) {
          const chunk = toDelete.slice(i, i + CHUNK);
          await ItemCls.deleteDocuments(chunk, opts);
          tick(chunk.length);
        }
        summary.created += toCreate.length;
        summary.updated += toUpdate.length;
        summary.removed += toDelete.length;
      }

      this.#setProgress(97, game.i18n.localize("ELARIA.Importer.step.save"));
      summary.savedTo = await this.#saveSnapshot();

      this.#setProgress(100, game.i18n.localize("ELARIA.Importer.finished"));
      this.#summary = summary;
      this.#diff = await this.#computeDiff();
      this.#state = "done";
      ui.notifications.info(game.i18n.format("ELARIA.Importer.doneNotice", summary));
    } catch (err) {
      console.error("Elaria | Import failed", err);
      this.#error = this.#errorMessage(err);
      this.#state = "error";
    }
    return this.render();
  }

  /**
   * Save the converted data as JSON in this world's folder (worlds/<world>/elaria/elaria-data.json), so the GM can
   * see exactly what was imported. Writes only to Foundry's own data folder. Failure here never blocks the import.
   * @returns {Promise<string>} the saved path, or "" if it couldn't be saved
   */
  async #saveSnapshot() {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const dir = `worlds/${game.world.id}/elaria`;
    const { index, docs, warnings, unknownTags } = this.#conversion;
    const data = { index, warnings, unknownTags, documents: Object.fromEntries(docs) };
    try {
      try { await FP.createDirectory("data", dir, {}); } catch { /* already exists */ }
      const file = new File([JSON.stringify(data, null, 2)], "elaria-data.json", { type: "application/json" });
      await FP.upload("data", dir, file, {}, { notify: false });
      return `${dir}/elaria-data.json`;
    } catch (err) {
      console.warn("Elaria | Couldn't save the data snapshot", err);
      return "";
    }
  }

  /* -------------------------------------------- */
  /*  Handlers                                    */
  /* -------------------------------------------- */

  /** Store the link / checkbox as they change. No re-render here, so a click on Check right after typing isn't lost. */
  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    if (typeof data.link === "string") await this.#saveLink(data.link);
    if ("removeMissing" in data) this.#removeMissing = !!data.removeMissing;
  }

  async #saveLink(value) {
    const link = String(value ?? "").trim();
    if (link === this.sheetLink) return;
    await game.settings.set("elaria", SETTING_LINK, link);
    this.#conversion = null;
    this.#build = null;
    this.#diff = null;
  }

  static async #onCheck() {
    const input = this.element.querySelector('input[name="link"]');
    if (input) await this.#saveLink(input.value);
    return this.#check();
  }

  static async #onImport() {
    if (!this.#build) return;
    const t = Object.values(this.#diff ?? {});
    const removed = this.#removeMissing ? t.reduce((n, r) => n + r.removed, 0) : 0;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("ELARIA.Importer.title") },
      content: `<p>${game.i18n.format("ELARIA.Importer.confirm", {
        created: t.reduce((n, r) => n + r.created, 0),
        changed: t.reduce((n, r) => n + r.changed, 0),
        removed
      })}</p>`
    });
    if (ok) return this.#import();
  }
}
