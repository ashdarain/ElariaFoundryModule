const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/** Monster ability sheet: a read-only card with an edit button, like the mastery sheet. */
export class ElariaAbilitySheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["elaria", "sheet", "item", "mastery", "ability"],
    position: { width: 520, height: 560 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleEdit: ElariaAbilitySheet.#onToggleEdit,
      postToChat: ElariaAbilitySheet.#onPostToChat,
      rollDamage: ElariaAbilitySheet.#onUse
    }
  };

  static PARTS = {
    body: { template: "systems/elaria/templates/item/ability.hbs", scrollable: [""] }
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
    const sys = item.system;
    const L = k => game.i18n.localize(k);
    Object.assign(context, {
      item, system: sys,
      editing: this.editMode,
      canRoll: item.hasDamage || !!item.skillInfo,
      statBlocks: [
        [L("ELARIA.Mastery.FIELDS.skillMod"), sys.skillMod.raw],
        [L("ELARIA.Mastery.FIELDS.damage"), sys.damage.raw],
        [L("ELARIA.Mastery.FIELDS.cost"), sys.cost]
      ].filter(([, v]) => v).map(([label, value]) => ({ label, value })),
      tagsText: sys.tags.join(", "),
      detailsHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.details, {
        relativeTo: item, secrets: item.isOwner
      })
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
    return this.document.toChat({ spend: !this.document.canRoll });
  }

  static #onUse() {
    return this.document.use();
  }
}
