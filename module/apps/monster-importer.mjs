import { downloadSheet, parseSheetLink } from "../importer/google-sheet.mjs";
import { readXlsx } from "../importer/xlsx.mjs";
import { convertBestiary, monsterActorData } from "../importer/bestiary.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SETTING_LINK = "bestiarySheetLink";
const L = k => game.i18n.localize(k);

/**
 * Import monsters (Actors sidebar, GM): a Bestiary Google Sheet (or .xlsx) → Monster actors in the world, in a
 * "Bestiary" folder with a sub-folder per power ("Power 1" …). Every tab is searched for the monster stat block
 * pattern (importer/bestiary.mjs), so new tabs and monsters are found without configuration.
 * Re-running it updates the imported monsters in place (their picture and token settings are kept), adds new
 * ones and, if ticked, removes imported monsters no longer in the sheet. Monsters made by hand are never touched.
 * Like the other importer, it only ever downloads the sheet (read-only).
 */
export class ElariaMonsterImporter extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "elaria-monster-importer",
    classes: ["elaria", "data-importer", "monster-importer"],
    window: { title: "ELARIA.Bestiary.importTitle", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 640, height: "auto" },
    actions: {
      check: ElariaMonsterImporter.#onCheck,
      pickLocalFile: ElariaMonsterImporter.#onPickLocalFile,
      pickFoundryFile: ElariaMonsterImporter.#onPickFoundryFile,
      clearFile: ElariaMonsterImporter.#onClearFile,
      runImport: ElariaMonsterImporter.#onImport
    }
  };

  static PARTS = { body: { template: "systems/elaria/templates/apps/monster-importer.hbs" } };

  static registerSettings() {
    game.settings.register("elaria", SETTING_LINK, { scope: "world", config: false, type: String, default: "" });
    game.settings.register("elaria", "bestiaryFolder", { scope: "world", config: false, type: String, default: "Bestiary" });
  }

  #state = "idle";      // idle | loading | ready | importing | done | error
  #error = "";
  #file = null;         // { name, buffer } or { name, path }
  #result = null;       // { monsters, warnings, tabs }
  #plan = null;         // [{ m, data, actor, status }]
  #removed = [];        // imported actors no longer in the sheet
  #removeMissing = true;
  #summary = null;
  #progress = { pct: 0, label: "" };

  get link() {
    return game.settings.get("elaria", SETTING_LINK);
  }

  async _prepareContext() {
    const powers = new Map();
    for (const p of this.#plan ?? []) {
      const row = powers.get(p.m.power) ?? { power: p.m.power, total: 0, new: 0, changed: 0, same: 0, names: [] };
      row.total++;
      row[p.status]++;
      row.names.push(`${p.m.name} (${p.m.type || "—"})`);
      powers.set(p.m.power, row);
    }
    return {
      link: this.link,
      linkValid: !this.link || !!parseSheetLink(this.link),
      file: this.#file ? { name: this.#file.name, where: this.#file.path ? "foundry" : "computer" } : null,
      busy: this.#state === "loading" || this.#state === "importing",
      error: this.#error,
      progress: this.#progress,
      ready: this.#state === "ready",
      checked: !!this.#plan,
      rows: [...powers.values()].sort((a, b) => a.power - b.power).map(r => ({ ...r, names: r.names.join(", ") })),
      tabs: this.#result?.tabs.join(", ") ?? "",
      count: this.#plan?.length ?? 0,
      removed: this.#removed.map(a => a.name).join(", "),
      removedCount: this.#removed.length,
      removeMissing: this.#removeMissing,
      warnings: this.#result?.warnings ?? [],
      summary: this.#summary,
      folder: game.settings.get("elaria", "bestiaryFolder")
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    el.querySelector("input.xlsx-input")?.addEventListener("change", async ev => {
      const f = ev.target.files?.[0];
      if (!f) return;
      this.#file = { name: f.name, buffer: await f.arrayBuffer() };
      this.#reset();
      this.render();
    });
    el.querySelector("input[name=removeMissing]")?.addEventListener("change", ev => (this.#removeMissing = ev.target.checked));
    el.querySelector("input[name=folder]")?.addEventListener("change", ev =>
      game.settings.set("elaria", "bestiaryFolder", ev.target.value.trim() || "Bestiary"));
  }

  #reset() {
    if (this.#state === "loading" || this.#state === "importing") return;
    this.#state = "idle";
    this.#plan = null;
    this.#result = null;
    this.#removed = [];
    this.#summary = null;
    this.#error = "";
  }

  #setProgress(pct, label) {
    this.#progress = { pct, label };
    const bar = this.element?.querySelector(".importer-progress .fill");
    if (bar) bar.style.width = `${pct}%`;
    const lab = this.element?.querySelector(".importer-progress .label");
    if (lab) lab.textContent = label;
  }

  /** Imported monsters already in the world, by ref. */
  static importedActors() {
    return game.actors.filter(a => a.type === "monster" && a.getFlag("elaria", "bestiary"));
  }

  static async #onCheck() {
    const input = this.element.querySelector("input[name=link]");
    if (input && input.value.trim() !== this.link) await game.settings.set("elaria", SETTING_LINK, input.value.trim());
    if (!this.#file && !this.link) {
      this.#error = L("ELARIA.Bestiary.needSource");
      return this.render();
    }
    this.#state = "loading";
    this.#error = "";
    this.#summary = null;
    this.#setProgress(10, L("ELARIA.Importer.step.download"));
    await this.render();
    try {
      let buffer;
      if (this.#file?.buffer) buffer = this.#file.buffer;
      else if (this.#file?.path) {
        const res = await fetch(foundry.utils.getRoute?.(this.#file.path) ?? this.#file.path, { cache: "no-store" });
        if (!res.ok) throw new Error(game.i18n.format("ELARIA.Importer.fileMissing", { name: this.#file.path, status: res.status }));
        buffer = await res.arrayBuffer();
      } else buffer = await downloadSheet(this.link);
      this.#setProgress(50, L("ELARIA.Bestiary.reading"));
      const workbook = await readXlsx(buffer);
      this.#result = convertBestiary(workbook);
      if (!this.#result.monsters.length) throw new Error(L("ELARIA.Bestiary.noneFound"));
      // What would change.
      const existing = new Map(ElariaMonsterImporter.importedActors().map(a => [a.getFlag("elaria", "ref"), a]));
      this.#plan = this.#result.monsters.map(m => {
        const data = monsterActorData(m);
        const actor = existing.get(data.flags.elaria.ref);
        existing.delete(data.flags.elaria.ref);
        const status = !actor ? "new" : actor.getFlag("elaria", "hash") === data.flags.elaria.hash ? "same" : "changed";
        return { m, data, actor, status };
      });
      this.#removed = [...existing.values()];
      this.#state = "ready";
    } catch (err) {
      console.error("Elaria | bestiary import", err);
      this.#state = "error";
      this.#error = err.message ?? String(err);
    }
    return this.render();
  }

  /** The "Bestiary" folder and its "Power n" sub-folders (made when missing; found by flag, so renaming is fine). */
  async #folders(powers) {
    const name = game.settings.get("elaria", "bestiaryFolder") || "Bestiary";
    let root = game.folders.find(f => f.type === "Actor" && f.getFlag("elaria", "bestiaryRoot"));
    root ??= await Folder.create({ name, type: "Actor", color: "#5b3a29", sorting: "a", flags: { elaria: { bestiaryRoot: true } } });
    if (root.name !== name) await root.update({ name });
    const out = new Map();
    for (const p of powers) {
      let f = game.folders.find(x => x.type === "Actor" && x.folder?.id === root.id && x.getFlag("elaria", "bestiaryPower") === p);
      f ??= await Folder.create({ name: game.i18n.format("ELARIA.Bestiary.powerFolder", { n: p }), type: "Actor", folder: root.id,
        sort: p * 1000, sorting: "a", flags: { elaria: { bestiaryPower: p } } });
      out.set(p, f.id);
    }
    // Power folders in power order.
    if (root.sorting !== "m") await root.update({ sorting: "m" });
    return out;
  }

  static async #onImport() {
    if (this.#state !== "ready" || !this.#plan) return;
    this.#state = "importing";
    await this.render();
    const summary = { created: 0, updated: 0, unchanged: 0, removed: 0 };
    try {
      const folders = await this.#folders([...new Set(this.#plan.map(p => Math.round(p.m.power)))]);
      let done = 0;
      for (const p of this.#plan) {
        this.#setProgress(5 + Math.round(90 * done++ / this.#plan.length), p.m.name);
        const folder = folders.get(Math.round(p.m.power));
        const items = p.data.items.map(i => foundry.utils.mergeObject(i, { flags: { elaria: { bestiaryItem: true } } }, { inplace: false }));
        if (!p.actor) {
          await Actor.implementation.create({ ...p.data, items, folder });
          summary.created++;
        } else if (p.status === "changed" || p.actor.folder?.id !== folder) {
          // Picture and token settings stay as the GM left them.
          await p.actor.update({ name: p.data.name, folder, system: p.data.system,
            "flags.elaria.hash": p.data.flags.elaria.hash, "flags.elaria.source": p.data.flags.elaria.source });
          const old = p.actor.items.filter(i => i.getFlag("elaria", "bestiaryItem")).map(i => i.id);
          if (old.length) await p.actor.deleteEmbeddedDocuments("Item", old);
          if (items.length) await p.actor.createEmbeddedDocuments("Item", items);
          summary.updated++;
        } else summary.unchanged++;
      }
      if (this.#removeMissing && this.#removed.length) {
        await Actor.implementation.deleteDocuments(this.#removed.map(a => a.id));
        summary.removed = this.#removed.length;
      }
      this.#summary = summary;
      this.#state = "done";
      this.#plan = null;
      this.#removed = [];
      ui.notifications.info(game.i18n.format("ELARIA.Bestiary.doneNote", summary));
    } catch (err) {
      console.error("Elaria | bestiary import", err);
      this.#state = "error";
      this.#error = err.message ?? String(err);
    }
    return this.render();
  }

  static #onPickLocalFile() {
    this.element.querySelector("input.xlsx-input")?.click();
  }

  static #onPickFoundryFile() {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "any",
      callback: path => {
        if (!/\.xlsx$/i.test(path)) return ui.notifications.warn(L("ELARIA.Importer.pickXlsx"));
        this.#file = { name: decodeURIComponent(path.split("/").pop()), path };
        this.#reset();
        this.render();
      }
    }).render(true);
  }

  static #onClearFile() {
    this.#file = null;
    this.#reset();
    return this.render();
  }
}
