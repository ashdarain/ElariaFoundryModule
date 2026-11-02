import { ElariaReactDialog, reactingUnit } from "./react-dialog.mjs";
import { findCombatant, reactionSummary } from "../combat/reactions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = k => game.i18n.localize(k);

/**
 * The React button's window: every reaction (rxn) the unit has (masteries, monster abilities, gear) plus a
 * General Reaction. Picking one opens the React window for it.
 */
export class ElariaReactionPicker extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "elaria-reaction-picker",
    classes: ["elaria", "reaction-picker"],
    position: { width: 380, height: "auto" },
    window: { title: "ELARIA.React.pickerTitle", icon: "fa-solid fa-shield-halved" },
    actions: { pick: ElariaReactionPicker.#onPick }
  };

  static PARTS = {
    body: { template: "systems/elaria/templates/apps/reaction-picker.hbs" }
  };

  /** Open for the selected token / the user's character (or a given actor). */
  static open({ actor = null, token = null } = {}) {
    if (!actor) ({ actor, token } = reactingUnit());
    const app = foundry.applications.instances.get("elaria-reaction-picker") ?? new this();
    app.#actorUuid = actor?.uuid ?? "";
    app.#tokenId = token?.id ?? null;
    return app.render({ force: true });
  }

  #actorUuid = "";
  #tokenId = null;

  get actor() {
    return this.#actorUuid ? fromUuidSync(this.#actorUuid) : null;
  }

  get token() {
    return this.#tokenId ? canvas?.tokens?.get(this.#tokenId) ?? null : null;
  }

  async _prepareContext(options) {
    const actor = this.actor;
    const actors = game.actors.filter(a => ["character", "monster"].includes(a.type) && a.isOwner)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "character" ? -1 : 1));
    if (actor && !actors.includes(actor)) actors.unshift(actor);
    const strip = h => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const short = t => (t.length > 140 ? `${t.slice(0, 137).trimEnd()}…` : t);

    const reactions = (actor?.items ?? [])
      .filter(i => i.system?.isReaction)
      .map(i => {
        const s = i.system;
        const unequipped = i.type === "mastery" && !s.equipped;
        const bits = [L(`TYPES.Item.${i.type}`)];
        if (s.cost) bits.push(s.cost);
        if (s.skillMod?.raw) bits.push(game.i18n.format("ELARIA.React.skillBit", { s: s.skillMod.raw }));
        return { id: i.id, name: i.name, img: i.img, meta: bits.join(" · "), unequipped,
          text: short(strip(s.details ?? s.description ?? "")) };
      })
      .sort((a, b) => (a.unequipped - b.unequipped) || a.name.localeCompare(b.name));

    const combatant = findCombatant(actor, this.token);
    const summary = reactionSummary(combatant, actor);
    return {
      actorChoices: { "": L("ELARIA.Dice.noActor"), ...Object.fromEntries(actors.map(a => [a.uuid, a.name])) },
      actorUuid: this.#actorUuid,
      hasActor: !!actor,
      reactions,
      rapText: combatant ? game.i18n.format("ELARIA.React.rap", { used: summary.used, n: summary.count }) : "",
      outOfRap: combatant && summary.used >= summary.count
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[name=actor]")?.addEventListener("change", ev => {
      this.#actorUuid = ev.target.value;
      this.#tokenId = null;
      this.render();
    });
  }

  static #onPick(event, target) {
    const actor = this.actor;
    if (!actor) return ui.notifications.warn(L("ELARIA.React.pickUnit"));
    const item = target.dataset.itemId ? actor.items.get(target.dataset.itemId) : null;
    ElariaReactDialog.open({ actor, item, token: this.token });
    return this.close();
  }
}
