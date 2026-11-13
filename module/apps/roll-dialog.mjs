import { ELARIA } from "../config.mjs";
import { rollDice, defaultRollActor, DICE_RE } from "../dice/check.mjs";
import { DAMAGE_TYPES, PIERCE_OPTIONS } from "../combat/damage.mjs";
import { bonusIsValid } from "../dice/bonus.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The one window for every 3d6 roll (and mastery damage rolls): pick a character and a stat, add a bonus, check
 * crit chance / damage (filled in from the sheet), then Roll, Roll with Advantage or Roll with Disadvantage.
 */
export class ElariaRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor({ preset = {}, ...options } = {}) {
    super(options);
    this.#setPreset(preset);
  }

  static DEFAULT_OPTIONS = {
    id: "elaria-roll-dialog",
    tag: "form",
    classes: ["elaria", "roll-dialog"],
    position: { width: 430, height: "auto" },
    window: { title: "ELARIA.Dice.dialogTitle", icon: "fa-solid fa-dice" },
    form: { handler: ElariaRollDialog.#onSubmit, closeOnSubmit: false },
    actions: {
      roll: ElariaRollDialog.#onRoll,
      skip: ElariaRollDialog.#onSkip
    }
  };

  static PARTS = {
    body: { template: "systems/elaria/templates/apps/roll-dialog.hbs" }
  };

  /**
   * Open the dialog (reusing the open one).
   * @param {object} [preset]
   * @param {Actor|null} [preset.actor]   Defaults to the selected token's actor or the user's character.
   * @param {string} [preset.stat]        Stat to preselect ("" = none).
   * @param {string} [preset.dice]        Dice to roll, default "3d6".
   * @param {string} [preset.bonus]       Prefilled "Add to roll".
   * @param {string} [preset.label]       Heading for the window and the chat card (e.g. a mastery name).
   * @param {string} [preset.note]        Extra line shown in the window and on the card (e.g. "4d6+Str ×3 hits").
   * @param {string} [preset.img]         Icon for the card.
   * @param {number|null} [preset.penalty] Injury/exhaustion penalty; null = the character's check penalty.
   * @param {number} [preset.critChanceBonus]  Added on top of the character's crit chance (the base).
   * @param {number} [preset.critDamageBonus]  Added on top of the character's crit damage (the base).
   * @param {boolean} [preset.fixedCrit]       No base crit from the character (skill mod rolls).
   * @param {number} [preset.hits]          Hits per target (from "x3" on a mastery).
   * @param {number} [preset.targets]       Number of targets; defaults to how many tokens you have targeted (or 1).
   * @param {boolean} [preset.aoe]          One shared damage roll for all targets.
   * @param {boolean} [preset.bonusPerHit]  Add the bonus to every hit.
   * @param {object|null} [preset.next]   After this roll, the card offers the mastery's damage ({itemUuid, actorUuid, targets}).
   * @param {object|null} [preset.spend]  First roll of using an item ({itemUuid, messageId?}): pays its FTG / MP.
   * @param {object|null} [preset.skip]   Extra button that closes the window and runs skip.action (e.g. "No reaction").
   * @param {object|null} [preset.skill]   A mastery's skill mod: the chat card gets a "Roll skill mod" button.
   */
  static open(preset = {}) {
    if (preset.actor === undefined) preset.actor = defaultRollActor();
    const existing = foundry.applications.instances.get("elaria-roll-dialog");
    if (existing) {
      existing.#setPreset(preset);
      return existing.render({ force: true });
    }
    return new this({ preset }).render({ force: true });
  }

  #actorUuid = "";
  #preset = {};

  #setPreset({ actor = null, stat = "", dice = "3d6", bonus = "", label = "", note = "", img = "", penalty = null,
    critChanceBonus = 0, critDamageBonus = 0, fixedCrit = false, skill = null,
    hits = 1, targets = null, aoe = false, bonusPerHit = false, next = null, skip = null, damage = null,
    isSkill = false, verdictCount = null, targetList = null, spend = null } = {}) {
    this.#actorUuid = actor?.uuid ?? "";
    this.#preset = {
      stat, dice: dice || "3d6", bonus: String(bonus ?? ""), label, note, img, skill, fixedCrit, next, skip, spend,
      penaltyOverride: penalty, critChanceBonus: Number(critChanceBonus) || 0, critDamageBonus: Number(critDamageBonus) || 0,
      hits: Math.max(1, Number(hits) || 1),
      // Default: one target per token you have targeted.
      targets: Math.max(1, Number(targets) || game.user.targets?.size || 1),
      aoe: !!aoe, bonusPerHit: !!bonusPerHit,
      // A damage roll (mastery / ability / weapon): its damage type, so the card can apply the damage.
      damage: damage ? { ...damage } : null,
      // Skill mod rolls get Pass / Fail per target. targetList: the targets carried over from a skill roll
      // (the ones that were hit), used instead of the current targets.
      isSkill: !!isSkill, verdictCount, targetList: targetList?.length ? targetList : null
    };
  }

  get title() {
    return this.#preset?.label || game.i18n.localize("ELARIA.Dice.dialogTitle");
  }

  get actor() {
    return this.#actorUuid ? fromUuidSync(this.#actorUuid) : null;
  }

  async _prepareContext(options) {
    const actor = this.actor;
    const L = k => game.i18n.localize(k);
    const actors = game.actors.filter(a => ["character", "monster"].includes(a.type) && a.isOwner)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "character" ? -1 : 1));
    if (actor && !actors.includes(actor)) actors.unshift(actor);
    const sign = n => (n >= 0 ? `+${n}` : `${n}`);
    const statChoices = { "": L("ELARIA.Dice.noStat") };
    for (const [key, cfg] of Object.entries(ELARIA.stats)) {
      const mod = actor?.system.stats?.[key]?.mod;
      statChoices[key] = mod === undefined ? L(cfg.label) : `${L(cfg.label)} (${sign(mod)})`;
    }
    const combat = actor?.system.combat ?? {};
    return {
      skipLabel: this.#preset.skip?.label ?? "",
      skipHint: this.#preset.skip?.hint ?? "",
      actorChoices: { "": L("ELARIA.Dice.noActor"), ...Object.fromEntries(actors.map(a => [a.uuid, a.name])) },
      actorUuid: this.#actorUuid,
      hasActor: !!actor,
      statChoices,
      ...this.#preset,
      stat: actor ? this.#preset.stat : "",
      // Checks take the injury/exhaustion penalty; damage rolls (masteries) don't.
      penalty: this.#preset.penaltyOverride ?? actor?.system.penalties?.check ?? 0,
      // The character's crit is the base; the inputs add to it.
      critChanceBase: this.#critBase().chance,
      critDamageBase: this.#critBase().damage,
      critChanceBonus: this.#preset.critChanceBonus,
      critDamageBonus: this.#preset.critDamageBonus,
      damageChoices: this.#preset.damage ? {
        type: Object.fromEntries(Object.entries(DAMAGE_TYPES).map(([k, v]) => [k, L(v)])),
        element: { "": L("ELARIA.Damage.noElement"), ...ELARIA.resistanceElements },
        form: Object.fromEntries(Object.entries(ELARIA.forms).map(([k, v]) => [k, L(v)])),
        pierce: Object.fromEntries(Object.entries(PIERCE_OPTIONS).map(([k, v]) => [k, L(v)]))
      } : null,
      critSource: this.#preset.fixedCrit ? L("ELARIA.Dice.critSkill")
        : actor ? game.i18n.format("ELARIA.Dice.critFromSheet", { name: actor.name }) : L("ELARIA.Dice.critNoActor")
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const form = this.element;
    form.querySelector("[name=actor]").addEventListener("change", ev => {
      this.#actorUuid = ev.target.value;
      this.#remember();
      this.render();
    });
    for (const el of form.querySelectorAll("input, select")) el.addEventListener("input", () => this.#updatePreview());
    this.#updatePreview();
    form.querySelector("[name=bonus]").focus();
  }

  /** Keep the typed values when the form re-renders for another character. */
  #remember() {
    const v = this.#values();
    Object.assign(this.#preset, {
      stat: v.stat, dice: v.dice, bonus: v.bonus, critChanceBonus: v.critChanceBonus, critDamageBonus: v.critDamageBonus,
      hits: v.hits, targets: v.targets, aoe: v.aoe, bonusPerHit: v.bonusPerHit, damage: v.damage, bonusTarget: v.bonusTarget
    });
  }

  /** Crit from the character's sheet (0 with no character, or for skill mod rolls). */
  #critBase() {
    const combat = this.#preset.fixedCrit ? {} : (this.actor?.system.combat ?? {});
    return { chance: combat.critChance ?? 0, damage: combat.critDamage ?? 0 };
  }

  #values() {
    const f = new foundry.applications.ux.FormDataExtended(this.element).object;
    const base = this.#critBase();
    const critChanceBonus = Number(f.critChanceBonus) || 0;
    const critDamageBonus = Number(f.critDamageBonus) || 0;
    return {
      hits: Math.clamp(Math.round(Number(f.hits) || 1), 1, 50),
      targets: Math.clamp(Math.round(Number(f.targets) || 1), 1, 50),
      aoe: !!f.aoe,
      bonusPerHit: !!f.bonusPerHit,
      bonusTarget: Math.max(0, Number(f.bonusTarget) || 0),
      critChanceBonus,
      critDamageBonus,
      critChance: base.chance + critChanceBonus,
      critDamage: base.damage + critDamageBonus,
      dice: String(f.dice ?? "").trim().toLowerCase() || "3d6",
      stat: f.stat ?? "",
      bonus: String(f.bonus ?? "").trim(),
      penalty: Number(f.penalty) || 0,
      damage: this.#preset.damage ? {
        ...this.#preset.damage,
        type: DAMAGE_TYPES[f.dmgType] ? f.dmgType : "physical",
        element: f.dmgElement ?? "",
        form: f.dmgForm || "mortal",
        pierce: f.dmgPierce ?? ""
      } : null
    };
  }

  #problem(v) {
    if (!DICE_RE.test(v.dice)) return game.i18n.localize("ELARIA.Dice.badDice");
    if (v.bonus && !bonusIsValid(v.bonus)) return game.i18n.localize("ELARIA.Dice.badBonus");
    return "";
  }

  /** "4d6 + 3 Strength + 1d4 − 1 penalty" under the inputs. */
  #updatePreview() {
    const v = this.#values();
    const actor = this.actor;
    const esc = foundry.utils.escapeHTML;
    const parts = [esc(v.dice)];
    if (v.stat) {
      const mod = actor?.system.stats?.[v.stat]?.mod ?? 0;
      parts.push(`${mod < 0 ? "−" : "+"} ${Math.abs(mod)} <small>${game.i18n.localize(ELARIA.stats[v.stat].label)}</small>`);
    }
    const bonusText = v.bonus ? (v.bonus.startsWith("-") ? `− ${esc(v.bonus.slice(1).trim())}` : `+ ${esc(v.bonus)}`) : "";
    if (bonusText && (v.bonusPerHit || v.hits === 1)) parts.push(bonusText);
    if (v.hits > 1) {
      parts.unshift("(");
      parts.push(`) × ${v.hits} <small>${game.i18n.localize("ELARIA.Dice.eachRolled")}</small>`);
      if (bonusText && !v.bonusPerHit) parts.push(bonusText);
    }
    if (v.targets > 1) parts.push(`<small>· ${game.i18n.format(v.aoe ? "ELARIA.Dice.previewAoe" : "ELARIA.Dice.previewTargets", { n: v.targets })}</small>`);
    if (v.penalty) parts.push(`− ${v.penalty} <small>${game.i18n.localize("ELARIA.Dice.penaltyShort")}</small>`);
    // The AoE / "each hit" options only matter with several targets / hits.
    this.element.querySelector(".aoe-option")?.classList.toggle("inactive", v.targets < 2);
    // "Each hit" matters with several hits, or several separate targets (else the bonus goes to one target).
    const separateTargets = v.targets > 1 && !v.aoe;
    this.element.querySelector(".per-hit-option")?.classList.toggle("inactive", v.hits < 2 && !separateTargets);
    // Once-only bonus with several separate targets: which target gets it.
    const row = this.element.querySelector(".bonus-target-row");
    if (row) {
      const show = !!v.bonus && !v.bonusPerHit && separateTargets;
      row.hidden = !show;
      const select = row.querySelector("select");
      if (show && select.options.length !== v.targets) {
        const targeted = [...(game.user.targets ?? [])].map(t => t.name);
        const names = targeted.length === v.targets ? targeted : [];
        const keep = Math.min(v.bonusTarget, v.targets - 1);
        select.innerHTML = Array.from({ length: v.targets }, (_, i) => {
          const label = names[i] || game.i18n.format("ELARIA.Dice.targetN", { n: i + 1 });
          return `<option value="${i}" ${i === keep ? "selected" : ""}>${foundry.utils.escapeHTML(label)}</option>`;
        }).join("");
      }
    }
    // Crit totals: base + input
    const setTotal = (sel, n) => { const el = this.element.querySelector(sel); if (el) el.textContent = `${n}%`; };
    setTotal(".crit-total.chance", Math.clamp(v.critChance, 0, 100));
    setTotal(".crit-total.damage", v.critDamage);
    // Make a non-zero penalty stand out, so one typed by accident gets noticed.
    this.element.querySelector("[name=penalty]")?.classList.toggle("has-penalty", v.penalty !== 0);
    const problem = this.#problem(v);
    const preview = this.element.querySelector(".preview");
    preview.innerHTML = parts.join(" ");
    preview.classList.toggle("invalid", !!problem);
    const err = this.element.querySelector(".bonus-error");
    err.textContent = problem;
    err.hidden = !problem;
  }

  static async #onRoll(event, target) {
    const v = this.#values();
    const problem = this.#problem(v);
    if (problem) return ui.notifications.warn(problem);
    const { label, note, img, skill, fixedCrit, next, isSkill, verdictCount, targetList, spend } = this.#preset;
    // Name the targets: the ones carried over from the skill roll, else the tokens you have targeted, when the
    // counts match.
    const targeted = targetList ?? [...(game.user.targets ?? [])].map(t => ({ uuid: t.document.uuid, name: t.name }));
    const match = targeted.length === v.targets;
    const targetNames = match ? targeted.map(t => t.name) : [];
    const targetTokens = match ? targeted.map(t => t.uuid) : [];
    // Skill rolls: who gets a Pass / Fail. An AoE skill roll is one roll judged against every target.
    let verdictTargets = null;
    if (isSkill) {
      const n = verdictCount ?? v.targets;
      const named = targeted.length === n ? targeted : [];
      verdictTargets = Array.from({ length: n }, (_, i) => ({ uuid: named[i]?.uuid ?? "",
        name: named[i]?.name ?? (n > 1 ? game.i18n.format("ELARIA.Dice.targetN", { n: i + 1 }) : "") }));
    }
    await rollDice({ actor: this.actor, ...v, targetNames, targetTokens, mode: target.dataset.mode ?? "normal", label, note, img, skill,
      fixedCrit, next, verdictTargets, spend });
    this.#setPreset({});
    return this.close();
  }

  /** "No reaction": close and carry on (e.g. straight to the damage roll). */
  static async #onSkip() {
    const action = this.#preset.skip?.action;
    const { targets } = this.#values();
    const carry = targets;
    await this.close();
    return action?.({ targets: carry });
  }

  /** Enter in a field = normal roll. */
  static #onSubmit(event) {
    event.preventDefault?.();
    return ElariaRollDialog.#onRoll.call(this, event, this.element.querySelector("[data-mode=normal]"));
  }
}
