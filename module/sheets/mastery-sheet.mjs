import { ELARIA } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const localized = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, game.i18n.localize(v)]));

export class ElariaMasterySheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["elaria", "sheet", "item", "mastery"],
    position: { width: 560, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleEdit: ElariaMasterySheet.#onToggleEdit,
      postToChat: ElariaMasterySheet.#onPostToChat,
      rollDamage: ElariaMasterySheet.#onRollDamage
    }
  };

  /** Masteries open read-only; the pen button switches to the edit form. Per window, not saved. */
  #editMode = false;

  get editMode() {
    return this.#editMode && this.isEditable;
  }

  set editMode(value) {
    this.#editMode = !!value;
  }

  static PARTS = {
    body: { template: "systems/elaria/templates/item/mastery.hbs", scrollable: [""] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const sys = item.system;
    const [first, ...others] = sys.sources;
    const L = k => game.i18n.localize(k);
    const categoryLabel = sys.category === "any"
      ? (item.actor && sys.equipped ? `${L("ELARIA.Category.any")} → ${L(ELARIA.masteryCategories[sys.slotCategory])}` : L("ELARIA.Category.any"))
      : sys.category === "none" ? L("ELARIA.Mastery.noCategory") : L(ELARIA.masteryCategories[sys.category] ?? sys.category);
    const statBlocks = [
      [L("ELARIA.Mastery.FIELDS.skillMod"), sys.skillMod?.raw],
      [L("ELARIA.Mastery.FIELDS.damage"), sys.damage?.raw],
      [L("ELARIA.Mastery.FIELDS.cost"), sys.cost],
      [L("ELARIA.Mastery.usage"), sys.usageLimit?.count
        ? `${sys.usageLimit.count}× ${sys.usageLimit.per ? game.i18n.format("ELARIA.Mastery.per", { per: sys.usageLimit.per }) : ""}`.trim()
        : ""]
    ].filter(([, v]) => v).map(([label, value]) => ({ label, value }));
    Object.assign(context, {
      item,
      system: sys,
      editing: this.editMode,
      owned: !!item.actor,
      hasDamage: item.hasDamage || !!item.skillInfo,
      categoryLabel,
      statBlocks,
      sourceLabel: sys.sourceLabel,
      categories: {
        ...localized(ELARIA.masteryCategories),
        any: game.i18n.localize("ELARIA.Category.any"),
        none: game.i18n.localize("ELARIA.Category.none")
      },
      equipCategories: localized(ELARIA.masteryCategories),
      sourceTypes: localized(ELARIA.masterySources),
      firstSource: first ?? { type: "general", name: "" },
      otherSources: others,
      usagePers: { "": "—", turn: "turn", round: "round", battle: "battle", day: "day", week: "week", "long-rest": "long rest" },
      tagsText: sys.tags.join(", "),
      detailsHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.details, {
        relativeTo: item, secrets: item.isOwner
      })
    });
    return context;
  }

  /** Switch between the read-only view and the edit form. */
  static #onToggleEdit() {
    this.#editMode = !this.#editMode;
    return this.render();
  }

  static #onRollDamage() {
    return this.document.use();
  }

  static #onPostToChat() {
    return this.document.toChat();
  }

  /** Turn the helper inputs (comma-separated tags, first source) back into the stored arrays. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    if (typeof data.tagsText === "string") {
      foundry.utils.setProperty(data, "system.tags", data.tagsText.split(",").map(t => t.trim()).filter(t => t));
    }
    delete data.tagsText;
    if (data.firstSource) {
      const sources = this.document.system.sources.map(s => ({ ...s }));
      sources[0] = { type: "general", id: "", ...(sources[0] ?? {}), ...data.firstSource };
      foundry.utils.setProperty(data, "system.sources", sources);
    }
    delete data.firstSource;
    return data;
  }
}
