import { ELARIA } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const localized = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, game.i18n.localize(v)]));

/** Gear sheet: a read-only card with an edit button, like masteries. */
export class ElariaGearSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["elaria", "sheet", "item", "mastery", "gear"],
    position: { width: 540, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleEdit: ElariaGearSheet.#onToggleEdit,
      postToChat: ElariaGearSheet.#onPostToChat,
      rollDamage: ElariaGearSheet.#onUse
    }
  };

  static PARTS = {
    body: { template: "systems/elaria/templates/item/gear.hbs", scrollable: [""] }
  };

  #editMode = false;

  get editMode() {
    return this.#editMode && this.isEditable;
  }

  set editMode(value) {
    this.#editMode = !!value;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const s = item.system;
    const L = k => game.i18n.localize(k);
    const enrich = h => foundry.applications.ux.TextEditor.implementation.enrichHTML(h ?? "", { relativeTo: item, secrets: item.isOwner });
    Object.assign(context, {
      item, system: s,
      editing: this.editMode,
      owned: !!item.actor,
      kindLabel: L(ELARIA.gearKinds[s.kind] ?? s.kind),
      kinds: localized(ELARIA.gearKinds),
      locations: localized(ELARIA.gearLocations),
      locationLabel: L(ELARIA.gearLocations[s.location] ?? s.location),
      canRoll: item.hasDamage,
      statBlocks: [
        [L("ELARIA.Gear.baseAttack"), s.baseAttack.raw],
        [L("ELARIA.Gear.damageType"), s.damageType],
        ["AAR", s.armourRating],
        [L("ELARIA.Gear.weight"), s.weight],
        [L("ELARIA.Gear.affinity"), s.affinity],
        [L("ELARIA.Gear.equipLoad"), s.equipLoad],
        [L("ELARIA.Gear.breakpoint"), s.breakpoint]
      ].filter(([, v]) => v !== null && v !== "" && v !== undefined).map(([label, value]) => ({ label, value })),
      tagsText: s.tags.join(", "),
      effectsHTML: await enrich(s.effects),
      descriptionHTML: await enrich(s.description)
    });
    return context;
  }

  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    if (typeof data.tagsText === "string") {
      foundry.utils.setProperty(data, "system.tags", data.tagsText.split(",").map(t => t.trim()).filter(t => t));
    }
    delete data.tagsText;
    return data;
  }

  static #onToggleEdit() {
    this.#editMode = !this.#editMode;
    return this.render();
  }

  static #onPostToChat() {
    return this.document.toChat();
  }

  static #onUse() {
    return this.document.use();
  }
}
