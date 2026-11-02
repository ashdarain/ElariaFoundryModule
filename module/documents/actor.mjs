import { roll3d6 } from "../dice/check.mjs";

export class ElariaActor extends Actor {

  /**
   * The "Create Actor" dialog: GMs get Monster preselected (Character still available); players can only make
   * characters. A player who needs a monster gets one from the GM (made by the GM, ownership given to the player).
   */
  static async createDialog(data = {}, createOptions = {}, options = {}) {
    if (game.user.isGM) {
      data = { type: "monster", ...data };
      options = { types: ["monster", "character"], ...options };
    } else {
      data = { ...data, type: "character" };
      options = { ...options, types: ["character"] };
    }
    return super.createDialog(data, createOptions, options);
  }

  /**
   * Token defaults: monsters are unlinked and hostile; characters are linked and friendly. Both show HP as the
   * bottom bar and MP as the top bar (FTG is added under it by ElariaToken). Players can't make monsters.
   */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    if (this.type === "monster" && !user.isGM) {
      if (user.isSelf) ui.notifications.warn(game.i18n.localize("ELARIA.Monster.gmOnly"));
      return false;
    }
    const D = CONST.TOKEN_DISPOSITIONS;
    const token = this.type === "monster"
      ? { actorLink: false, disposition: D.HOSTILE, bar1: { attribute: "resources.hp" }, bar2: { attribute: "resources.mp" } }
      : { actorLink: true, disposition: D.FRIENDLY, bar1: { attribute: "resources.hp" }, bar2: { attribute: "resources.mp" } };
    // Only fill in what the creator didn't set (e.g. duplicating or importing keeps its own token).
    const current = data.prototypeToken ?? {};
    const update = {};
    for (const [k, v] of Object.entries(token)) if (current[k] === undefined) update[`prototypeToken.${k}`] = v;
    if (Object.keys(update).length) this.updateSource(update);
  }

  getRollData() {
    return this.system.getRollData?.() ?? super.getRollData();
  }

  /**
   * Roll a stat check straight away (no dialog): 3d6 + modifier (A2), minus injury / exhaustion penalties,
   * with this character's crit chance and crit damage.
   * @param {string} key                 Stat key, e.g. "fin".
   * @param {object} [options]
   * @param {"normal"|"advantage"|"disadvantage"} [options.mode]
   * @param {string|number} [options.bonus]   Extra situational bonus (number or dice formula).
   */
  /**
   * Roll initiative (3d6 + Fin). Core only finds an actor's *linked* tokens, so a monster opened from the Actors
   * sidebar (unlinked tokens) rolled nothing. Here:
   *  - combatants already in the combat for this actor (its token, or any token made from it) roll;
   *  - otherwise its tokens on the scene (the selected ones first) are added to the combat (made if needed) and roll;
   *  - with no token on the scene, the roll is just posted to chat.
   */
  async rollInitiative({ createCombatants = false, rerollInitiative = true, initiativeOptions = {} } = {}) {
    const tokenId = this.isToken ? this.token?.id : null;
    const mine = c => (tokenId ? c.tokenId === tokenId : c.actorId === this.id);
    let combat = game.combat;
    let ids = combat?.combatants.filter(mine).map(c => c.id) ?? [];

    if (!ids.length && createCombatants && canvas?.scene) {
      const placed = canvas.tokens.placeables.filter(t => (tokenId ? t.id === tokenId : t.document.actorId === this.id));
      const selected = placed.filter(t => t.controlled);
      const tokens = (selected.length ? selected : placed).map(t => t.document);
      if (tokens.length) {
        try {
          combat ??= await getDocumentClass("Combat").create({ scene: canvas.scene.id, active: true });
          await combat.createEmbeddedDocuments("Combatant", tokens.map(t => ({
            tokenId: t.id, sceneId: t.parent.id, actorId: t.actorId, hidden: t.hidden
          })));
          ids = combat.combatants.filter(mine).map(c => c.id);
        } catch (err) {
          console.warn("Elaria | couldn't add to the combat", err);   // e.g. a player without permission
        }
      }
    }

    if (combat && ids.length) {
      if (!rerollInitiative) ids = ids.filter(id => combat.combatants.get(id)?.initiative === null);
      if (ids.length) await combat.rollInitiative(ids, initiativeOptions);
      return combat;
    }

    // Not in a combat (or no token to add): post the roll so it isn't lost.
    const roll = await new Roll(CONFIG.Combat.initiative.formula, this.getRollData()).evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.format("COMBAT.RollsInitiative", { name: foundry.utils.escapeHTML(this.name) })
    });
    return null;
  }

  async rollStat(key, { mode = "normal", bonus = "" } = {}) {
    if (!this.system.stats?.[key]) return null;
    return roll3d6({
      actor: this, stat: key, bonus: String(bonus || ""), mode,
      penalty: this.system.penalties?.check ?? 0,
      critChance: this.system.combat?.critChance ?? 0,
      critDamage: this.system.combat?.critDamage ?? 0
    });
  }

  /** Open the 3d6 roll window for this character, optionally with a stat chosen. */
  openRollDialog(stat = "") {
    return game.elaria.RollDialog.open({ actor: this, stat });
  }

  /**
   * Spend or lose some of a resource. Temp is used up first (A11).
   * @param {"hp"|"mp"|"ftg"} resource
   * @param {number} amount   Positive to lose, negative to restore (restoring never touches temp).
   */
  async modifyResource(resource, amount) {
    const res = this.system.resources[resource];
    if (!res) return;
    let { value, temp, max } = res;
    if (amount > 0) {
      const fromTemp = Math.min(temp, amount);
      temp -= fromTemp;
      value = Math.max(0, value - (amount - fromTemp));
    } else {
      value = Math.min(max, value - amount);
    }
    return this.update({ [`system.resources.${resource}.value`]: value, [`system.resources.${resource}.temp`]: temp });
  }

  /** Refill HP, MP and FTG to max and clear temp (the 1-minute out-of-combat recovery). */
  async restoreResources() {
    const update = {};
    for (const key of ["hp", "mp", "ftg"]) {
      update[`system.resources.${key}.value`] = this.system.resources[key].max;
      update[`system.resources.${key}.temp`] = 0;
    }
    return this.update(update);
  }

  /** Token bar edits go through modifyResource so temp is respected. */
  async modifyTokenAttribute(attribute, value, isDelta = false, isBar = true) {
    const match = /^resources\.(hp|mp|ftg)$/.exec(attribute);
    if (match && isBar) {
      const current = this.system.resources[match[1]].value;
      const delta = isDelta ? value : value - current;
      return this.modifyResource(match[1], -delta);
    }
    return super.modifyTokenAttribute(attribute, value, isDelta, isBar);
  }
}
