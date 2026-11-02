import { ELARIA } from "../config.mjs";
import { postRolls } from "../dice/check.mjs";
import { findCombatant, reactionCount, reactionStates, reactionSummary, recordReaction } from "../combat/reactions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const esc = s => foundry.utils.escapeHTML(String(s));
const L = k => game.i18n.localize(k);

/**
 * Reaction DCs (Mechanics, "Reaction time goal numbers"). n starts at 0 each round and rises by 2 for every
 * successful reaction that round (failed reactions don't raise it). The reactor rolls 3d6 + Awareness; the DC
 * involves the attacker's skill mod, which players don't know, so the card waits for the GM to press Pass or Fail.
 * The GM sees the DC formula on the card.
 */
export const REACTION_TYPES = {
  towards: { base: 10, skill: true },     // an action done towards you: n + 10 + attacker's skill mod
  notTowards: { base: 14, skill: true },  // an action not done towards you: n + 14 + skill mod (or relevant stat)
  leavingMelee: { base: 12, skill: true },// an enemy leaving melee: n + 12 + skill mod (or Fin)
  own: { base: 16, skill: false }         // your own action (a trap you're about to trigger, tripping): n + 16
};

/** The GM's DC reminder for a reaction type, e.g. "n 2 + 10 + attacker's skill mod". */
function dcFormula(type, n) {
  const t = REACTION_TYPES[type] ?? REACTION_TYPES.towards;
  return `n ${n} + ${t.base}${t.skill ? ` + ${L(`ELARIA.React.skillFor.${type}`)}` : ""}`;
}

/** Who is reacting: the selected token, else the user's character (or their only character). */
export function reactingUnit() {
  const token = canvas?.tokens?.controlled?.[0];
  if (token?.actor) return { actor: token.actor, token };
  if (game.user.character) return { actor: game.user.character, token: null };
  if (!game.user.isGM) {
    const owned = game.actors.filter(a => a.type === "character" && a.isOwner);
    if (owned.length === 1) return { actor: owned[0], token: null };
  }
  return { actor: null, token: null };
}

/**
 * React window: pick what you're reacting to and roll (Awareness by default). The chat card shows the total;
 * the GM presses Pass or Fail on it, which fills the reactor's next reaction pip (green / red).
 */
export class ElariaReactDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor({ actor = null, token = null, item = null, ...options } = {}) {
    super(options);
    this.#actorUuid = actor?.uuid ?? "";
    this.#tokenId = token?.id ?? null;
    this.#itemUuid = item?.uuid ?? "";
  }

  static DEFAULT_OPTIONS = {
    id: "elaria-react-dialog",
    tag: "form",
    classes: ["elaria", "roll-dialog", "react-dialog"],
    position: { width: 420, height: "auto" },
    window: { title: "ELARIA.React.title", icon: "fa-solid fa-shield-halved" },
    form: { handler: ElariaReactDialog.#onSubmit, closeOnSubmit: false },
    actions: { roll: ElariaReactDialog.#onRoll }
  };

  static PARTS = {
    body: { template: "systems/elaria/templates/apps/react-dialog.hbs" }
  };

  /**
   * @param {object} [options]
   * @param {Actor} [options.actor]  Who reacts (default: the selected token, else the user's character).
   * @param {Item} [options.item]    The reaction mastery / ability being used: shown at the top, and a passed
   *                                 reaction's card gets a button to carry on with it.
   */
  static open({ actor = null, item = null, token = null } = {}) {
    if (actor) token ??= canvas?.tokens?.controlled?.find(t => t.actor === actor) ?? null;
    else ({ actor, token } = reactingUnit());
    const existing = foundry.applications.instances.get("elaria-react-dialog");
    if (existing) {
      existing.#actorUuid = actor?.uuid ?? existing.#actorUuid;
      existing.#tokenId = token?.id ?? null;
      existing.#itemUuid = item?.uuid ?? "";
      return existing.render({ force: true });
    }
    return new this({ actor, token, item }).render({ force: true });
  }

  #actorUuid = "";
  #tokenId = null;
  #itemUuid = "";

  get item() {
    return this.#itemUuid ? fromUuidSync(this.#itemUuid) : null;
  }

  get title() {
    const item = this.item;
    return item ? game.i18n.format("ELARIA.React.titleWith", { name: item.name }) : game.i18n.localize("ELARIA.React.title");
  }
  #values = { type: "towards", stat: "awa", bonus: "" };

  get actor() {
    return this.#actorUuid ? fromUuidSync(this.#actorUuid) : null;
  }

  get combatant() {
    const token = this.#tokenId ? canvas?.tokens?.get(this.#tokenId) : null;
    return findCombatant(this.actor, token);
  }

  async _prepareContext(options) {
    const actor = this.actor;
    const actors = game.actors.filter(a => ["character", "monster"].includes(a.type) && a.isOwner)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "character" ? -1 : 1));
    if (actor && !actors.includes(actor)) actors.unshift(actor);
    const combatant = this.combatant;
    const summary = reactionSummary(combatant, actor);
    const sign = n => (n >= 0 ? `+${n}` : `${n}`);
    const statChoices = Object.fromEntries(Object.entries(ELARIA.stats).map(([k, s]) => {
      const mod = actor?.system.stats?.[k]?.mod;
      return [k, mod === undefined ? L(s.label) : `${L(s.label)} (${sign(mod)})`];
    }));
    return {
      actorChoices: { "": L("ELARIA.Dice.noActor"), ...Object.fromEntries(actors.map(a => [a.uuid, a.name])) },
      actorUuid: this.#actorUuid,
      typeChoices: Object.fromEntries(Object.keys(REACTION_TYPES).map(k => [k, L(`ELARIA.React.type.${k}`)])),
      statChoices,
      ...this.#values,
      inCombat: !!combatant,
      rapText: combatant ? game.i18n.format("ELARIA.React.rap", { used: summary.used, n: summary.count }) : L("ELARIA.React.noCombat"),
      outOfRap: combatant && summary.used >= summary.count,
      penalty: actor?.system.penalties?.check ?? 0,
      noActor: !actor,
      item: this.item ? { name: this.item.name, img: this.item.img } : null
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const form = this.element;
    form.querySelector("[name=actor]").addEventListener("change", ev => {
      this.#remember();
      this.#actorUuid = ev.target.value;
      this.#tokenId = null;
      this.render();
    });
    for (const el of form.querySelectorAll("input, select")) el.addEventListener("input", () => this.#updatePreview());
    this.#updatePreview();
    form.querySelector("[data-mode=normal]")?.focus();
  }

  #remember() {
    const v = this.#read();
    this.#values = { type: v.type, stat: v.stat, bonus: v.bonus };
  }

  #read() {
    const f = new foundry.applications.ux.FormDataExtended(this.element).object;
    const type = REACTION_TYPES[f.type] ? f.type : "towards";
    return {
      type,
      stat: f.stat || "awa",
      bonus: String(f.bonus ?? "").trim(),
      penalty: Math.max(0, Math.round(Number(f.penalty) || 0))
    };
  }

  #updatePreview() {
    const v = this.#read();
    const el = this.element;
    el.querySelector("[name=penalty]")?.classList.toggle("has-penalty", v.penalty !== 0);
    const bad = v.bonus && !Roll.validate(v.bonus);
    el.querySelector(".bonus-error").hidden = !bad;
  }

  static async #onRoll(event, target) {
    const actor = this.actor;
    if (!actor) return ui.notifications.warn(L("ELARIA.React.pickUnit"));
    const v = this.#read();
    if (v.bonus && !Roll.validate(v.bonus)) return ui.notifications.warn(L("ELARIA.Dice.badBonus"));
    const combatant = this.combatant;
    await rollReaction({ actor, combatant, ...v, item: this.item, mode: target.dataset.mode ?? "normal" });
    return this.close();
  }

  static #onSubmit(event) {
    event.preventDefault?.();
    return ElariaReactDialog.#onRoll.call(this, event, this.element.querySelector("[data-mode=normal]"));
  }
}

/** Roll the reaction and post the card. The GM decides pass / fail on the card (see resolveReaction). */
export async function rollReaction({ actor, combatant = null, type = "towards", stat = "awa", bonus = "", penalty = 0,
  item = null, mode = "normal" }) {
  const mod = actor.system.stats?.[stat]?.mod ?? 0;
  const dice = mode === "advantage" ? "{3d6, 3d6}kh" : mode === "disadvantage" ? "{3d6, 3d6}kl" : "3d6";
  let formula = `${dice} + ${mod}`;
  if (bonus) formula += ` + (${bonus})`;
  if (penalty) formula += ` - ${penalty}`;
  const roll = await new Roll(formula).evaluate();

  const sets = roll.dice.slice(0, mode === "normal" ? 1 : 2).map(d => {
    const faces = d.results.map(x => x.result);
    return { faces, total: faces.reduce((a, b) => a + b, 0), kept: true };
  });
  if (sets.length === 2) {
    const keep = mode === "advantage" ? (sets[0].total >= sets[1].total ? 0 : 1) : (sets[0].total <= sets[1].total ? 0 : 1);
    sets[1 - keep].kept = false;
  }
  const kept = sets.find(s => s.kept)?.total ?? 0;
  const bonusValue = roll.total - kept - mod + penalty;
  const sign = x => (x < 0 ? `− ${Math.abs(x)}` : `+ ${x}`);
  const n = reactionSummary(combatant, actor).n;

  const modeLabel = mode === "normal" ? "" : L(`ELARIA.Dice.${mode}`);
  const content = `
    <div class="elaria roll-card react-card pending">
      <header>
        ${item ? `<img src="${esc(item.img)}" alt="">` : ""}
        <div class="titles"><h3>${esc(item
          ? game.i18n.format("ELARIA.React.cardTitleWith", { name: actor.name, item: item.name })
          : game.i18n.format("ELARIA.React.cardTitle", { name: actor.name }))}</h3>
          <span class="note">${esc(L(`ELARIA.React.type.${type}`))}</span></div>
        ${modeLabel ? `<span class="mode ${mode}">${esc(modeLabel)}</span>` : ""}
      </header>
      <div class="sets">${sets.map(s => `
        <div class="set ${s.kept ? "kept" : "dropped"}">${s.faces.map(f => `<span class="die d6">${f}</span>`).join("")}
          <span class="eq">= ${s.total}</span></div>`).join("")}</div>
      <div class="breakdown">3d6 <b>${kept}</b> ${sign(mod)} <small>${esc(L(ELARIA.stats[stat]?.label ?? stat))}</small>
        ${bonus ? ` ${sign(bonusValue)}` : ""}${penalty ? ` − ${penalty} <small>${L("ELARIA.Dice.penaltyShort")}</small>` : ""}</div>
      <div class="dc-line gm-only">${L("ELARIA.React.dc")}: ${esc(dcFormula(type, n))}</div>
      <div class="results two">
        <div class="result"><span class="label">${L("ELARIA.Dice.total")}</span><span class="value">${roll.total}</span></div>
        <div class="result verdict pending"><span class="label">${L("ELARIA.React.result")}</span>
          <span class="value">${L("ELARIA.React.pending")}</span></div>
      </div>
      <div class="gm-verdict gm-only">
        <button type="button" class="pass" data-elaria-action="reactPass"><i class="fa-solid fa-check"></i> ${L("ELARIA.React.markPass")}</button>
        <button type="button" class="fail" data-elaria-action="reactFail"><i class="fa-solid fa-xmark"></i> ${L("ELARIA.React.markFail")}</button>
      </div>
      <p class="react-foot">${L("ELARIA.React.pendingNote")}</p>
    </div>`;
  return postRolls([roll], { actor, content, flags: { react: {
    type, passed: null, itemUuid: item?.uuid ?? "", actorUuid: actor.uuid,
    combatId: combatant?.parent?.id ?? null, combatantId: combatant?.id ?? null
  } } });
}

/**
 * GM only: mark a reaction card passed or failed. Updates the card, and fills the reactor's next reaction pip.
 * Pressing the other button later changes the verdict (and that pip) instead of using another one.
 */
export async function resolveReaction(message, passed) {
  if (!game.user.isGM) return;
  const r = message.flags?.elaria?.react;
  if (!r) return;
  const actor = r.actorUuid ? fromUuidSync(r.actorUuid) : null;
  const item = r.itemUuid ? fromUuidSync(r.itemUuid) : null;
  const combatant = r.combatId ? game.combats.get(r.combatId)?.combatants.get(r.combatantId) ?? null : null;

  // The pip: change the one this card filled, or fill the next free one.
  let pipNote = "", pipIndex = r.pipIndex ?? null;
  if (combatant) {
    if (pipIndex !== null) {
      const states = Array.from({ length: reactionCount(combatant) }, (_, i) => reactionStates(combatant)[i] ?? "");
      states[pipIndex] = passed ? "pass" : "fail";
      await combatant.setFlag("elaria", "reactions", states);
    } else {
      const free = Array.from({ length: reactionCount(combatant) }, (_, i) => reactionStates(combatant)[i] ?? "").indexOf("");
      if (await recordReaction(combatant, passed ? "pass" : "fail")) pipIndex = free;
    }
    const s = reactionSummary(combatant, actor);
    pipNote = pipIndex !== null ? game.i18n.format("ELARIA.React.rap", { used: s.used, n: s.count }) : L("ELARIA.React.noRapLeft");
  }

  const doc = new DOMParser().parseFromString(`<div>${message.content}</div>`, "text/html");
  const card = doc.querySelector(".react-card");
  if (!card) return;
  card.classList.remove("pending", "passed", "failed");
  card.classList.add(passed ? "passed" : "failed");
  const verdict = card.querySelector(".result.verdict");
  verdict.className = `result verdict ${passed ? "pass" : "fail"}`;
  verdict.querySelector(".value").textContent = passed ? L("ELARIA.React.pass") : L("ELARIA.React.fail");
  for (const b of card.querySelectorAll(".gm-verdict button")) b.classList.toggle("chosen", b.classList.contains(passed ? "pass" : "fail"));
  card.querySelector(".react-foot").textContent = (passed ? L("ELARIA.React.passNote") : L("ELARIA.React.failNote"))
    + (pipNote ? ` · ${pipNote}` : "");
  // A passed reaction mastery carries on: its damage (the counter-attack), its skill mod, or just the card.
  card.querySelector(".react-next")?.remove();
  card.querySelector(".next-roll")?.remove();
  if (passed && item) {
    const buttons = [];
    if (item.hasDamage) buttons.push(`<button type="button" class="damage-roll" data-elaria-action="reactDamage">`
      + `<i class="fa-solid fa-dice"></i> ${esc(game.i18n.format("ELARIA.Dice.rollDamage", { dmg: item.system.damage.raw }))}</button>`);
    if (item.skillInfo) buttons.push(`<button type="button" class="skill-roll" data-elaria-action="reactSkill">`
      + `<i class="fa-solid fa-bullseye"></i> ${esc(game.i18n.format("ELARIA.Dice.rollSkill", { mod: item.skillInfo.raw }))}</button>`);
    if (!buttons.length) buttons.push(`<button type="button" class="next-roll" data-elaria-action="useAfterReact">`
      + `<i class="fa-solid fa-bolt"></i> ${esc(game.i18n.format("ELARIA.React.thenUse", { name: item.name }))}</button>`);
    card.insertAdjacentHTML("beforeend", `<div class="card-buttons react-next">${buttons.join("")}</div>`);
  }
  return message.update({ content: doc.body.firstElementChild.innerHTML,
    "flags.elaria.react.passed": passed, "flags.elaria.react.pipIndex": pipIndex });
}
