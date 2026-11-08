import { ELARIA } from "../config.mjs";
import { statCode } from "../importer/convert.mjs";
import { defaultRollActor, hidesRollDetails, skillButton } from "../dice/check.mjs";
import { itemDamageProfile } from "../combat/damage.mjs";
import { itemTypesFor } from "../apps/compendium-types.mjs";
import { readSkillMod, skillRollPreset } from "../dice/skill.mjs";

/**
 * Item types that can be "used" (skill mod → damage → chat): character masteries, monster abilities and gear
 * (weapons roll their base attack; other gear is posted to chat).
 */
export const USABLE_TYPES = ["mastery", "ability", "gear"];

export class ElariaItem extends Item {

  /** Inside a Masteries / Gear compendium, Create Item makes that kind only. */
  static async createDialog(data = {}, createOptions = {}, options = {}) {
    const types = itemTypesFor(createOptions);
    if (types) {
      data = { ...data, type: types[0] };
      options = { ...options, types };
    }
    return super.createDialog(data, createOptions, options);
  }

  /** Default icons for new items (systems/elaria/assets/icons). */
  static getDefaultArtwork(itemData = {}) {
    const icons = "systems/elaria/assets/icons/";
    const byType = { mastery: "mastery.svg", ability: "ability.svg", gear: "gear-item.svg" };
    const kind = itemData.system?.kind;
    const gearIcon = { weapon: "gear-weapon.svg", armour: "gear-armour.svg", trinket: "gear-trinket.svg" }[kind];
    const file = itemData.type === "gear" && gearIcon ? gearIcon : byType[itemData.type];
    return file ? { img: icons + file } : super.getDefaultArtwork(itemData);
  }

  get isUsable() {
    return USABLE_TYPES.includes(this.type);
  }

  /**
   * Does this mastery / ability deal damage? Only if its Damage field has dice to roll ("2d6+Str", "1d8 x3"):
   * an empty field or text without dice ("—", "N/A", "None", "Heals an ally") means there's nothing to roll,
   * so using it just posts its name and description to chat.
   */
  get hasDamage() {
    if (!this.isUsable) return false;
    const d = this.system.damage ?? {};
    if (d.count && d.sides) return true;
    return /\d+\s*d\s*\d+/i.test(d.raw ?? "");
  }

  /** This mastery's skill mod as {stats, bonus, raw}, or null. */
  get skillInfo() {
    return this.isUsable ? readSkillMod(this.system.skillMod) : null;
  }

  /** Does using this item roll anything (damage or a skill mod)? Others just open their sheet when clicked. */
  get canRoll() {
    return this.hasDamage || !!this.skillInfo;
  }

  /** Does this mastery have the AOE tag (one shared damage roll, one shared skill mod roll)? */
  get isAoe() {
    return this.isUsable && this.system.tagList.some(t => /^aoe$/i.test(t.trim()) || /area of effect/i.test(t));
  }

  /**
   * Roll window preset for this mastery's skill mod roll. If the mastery deals damage, the skill mod card gets a
   * "Roll damage" button to carry on.
   */
  skillRollPreset(actor = this.actor ?? defaultRollActor(), { targets = null } = {}) {
    const skill = this.skillInfo;
    if (!skill) return null;
    targets ??= game.user.targets?.size || 1;
    const preset = skillRollPreset({ actor, skill, name: this.name, img: this.img, targets, aoe: this.isAoe });
    // The damage roll that follows gets the same number of targets (an AoE skill roll is one roll for all of them).
    if (this.hasDamage) preset.next = { itemUuid: this.uuid, actorUuid: actor?.uuid ?? "", targets, aoe: this.isAoe };
    return preset;
  }

  /**
   * What the roll window is filled with for this mastery's damage: dice and stat from the Damage field
   * ("4d6+Str x3" → 4d6, Strength), crit from the character. Damage the importer couldn't read
   * ("3d6+Wis/5d6+Wis") still gets its first dice and stat, and the text is shown so the player can adjust.
   */
  damageRollPreset(actor = this.actor, { targets = null } = {}) {
    const d = this.system.damage ?? {};
    let dice = d.count && d.sides ? `${d.count}d${d.sides}` : "";
    let stat = statCode(d.stat || "") || d.stat || "";
    // Fill whatever the importer left blank from the text ("3d6+Str x2" → 3d6, Strength).
    const m = /(\d+)\s*d\s*(\d+)(?:\s*\+\s*([A-Za-z]+))?/i.exec(d.raw ?? "");
    if (m) {
      dice ||= `${m[1]}d${m[2]}`;
      stat ||= (m[3] && statCode(m[3])) || "";
    }
    if (stat && !ELARIA.stats[stat]) stat = "";
    const note = [
      `${game.i18n.localize("ELARIA.Mastery.FIELDS.damage")}: ${d.raw}`,
      this.system.cost ? `${game.i18n.localize("ELARIA.Mastery.FIELDS.cost")}: ${this.system.cost}` : ""
    ].filter(x => x).join(" · ");
    // "x3" = 3 hits on each target; an AOE tag = one shared damage roll for every target.
    const hits = /^\d+$/.test(String(d.hits ?? "")) ? Number(d.hits) : (Number(/x\s*(\d+)/i.exec(d.raw ?? "")?.[1] ?? /^\s*(\d+)\s*x\s/i.exec(d.raw ?? "")?.[1]) || 1);
    return { actor: actor ?? null, dice: dice || "3d6", stat, bonus: "", label: this.name, note, img: this.img, penalty: 0,
      hits, aoe: this.isAoe, targets, damage: itemDamageProfile(this, actor ?? this.actor) };
  }

  /**
   * Use the mastery (clicking it on the sheet, its hotbar macro …):
   *  - with a skill mod: the skill mod roll comes first. Its window also has a "No reaction" button that skips
   *    straight to the damage (or posts the mastery if it has none); after the skill mod roll, its chat card has a
   *    "Roll damage" button.
   *  - with damage only: the damage roll window.
   *  - otherwise: posted to chat.
   * A mastery that isn't on a character (compendium, Items sidebar) uses the selected token / assigned character.
   * @param {object} [options]
   * @param {boolean} [options.skipSkill]  Go straight to damage (the target didn't react).
   * @param {boolean} [options.normal]     For reaction (rxn) masteries: skip the "react or use normally?" question.
   */
  async use({ skipSkill = false, normal = false, targets = null } = {}) {
    const actor = this.actor ?? defaultRollActor();
    const L = k => game.i18n.localize(k);

    // Reaction masteries (rxn): ask whether to roll the reaction first or use it normally.
    if (this.isUsable && this.system.isReaction && !normal && !skipSkill) {
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: this.name, icon: "fa-solid fa-shield-halved" },
        classes: ["elaria", "use-rxn-dialog"],
        content: `<p>${game.i18n.format("ELARIA.React.useRxnPrompt", { name: foundry.utils.escapeHTML(this.name) })}</p>`,
        buttons: [
          { action: "react", label: L("ELARIA.React.useAsReaction"), icon: "fa-solid fa-shield-halved", default: true },
          { action: "normal", label: L("ELARIA.React.useNormally"), icon: "fa-solid fa-dice" }
        ],
        rejectClose: false
      });
      if (choice === "react") return game.elaria.ReactDialog.open({ actor, item: this });
      if (choice !== "normal") return;
    }

    if (this.skillInfo && !skipSkill) {
      return game.elaria.RollDialog.open({
        ...this.skillRollPreset(actor),
        skip: {
          label: this.hasDamage ? L("ELARIA.Dice.noReactionDamage") : L("ELARIA.Dice.noReactionPost"),
          hint: L("ELARIA.Dice.noReactionHint"),
          // Keeps the number of targets typed in the skill mod window.
          action: ({ targets } = {}) => this.use({ skipSkill: true, targets })
        }
      });
    }
    if (this.hasDamage) return game.elaria.RollDialog.open(this.damageRollPreset(actor, { targets }));
    // Nothing (left) to roll: post the card. Coming from the skill mod step, it doesn't offer the skill mod again.
    return this.toChat({ skillButton: !skipSkill && !this.skillInfo });
  }

  /**
   * Post a mastery card to chat.
   * @param {object} [options]
   * @param {boolean} [options.skillButton=true]  Add the "Roll skill mod" button (off once the skill mod is done).
   */
  async toChat({ skillButton: withSkill = true } = {}) {
    const s = this.system;
    const rows = [];
    if (this.type === "mastery") {
      const L = k => game.i18n.localize(k);
      const cat = s.category === "any"
        ? `${L("ELARIA.Category.any")} → ${L(ELARIA.masteryCategories[s.slotCategory])}`
        : s.category === "none" ? L("ELARIA.Category.none") : L(ELARIA.masteryCategories[s.category]);
      if (s.sourceLabel) rows.push([L("ELARIA.Mastery.sourcesLabel"), s.sourceLabel]);
      rows.push([L("ELARIA.Mastery.FIELDS.category"), cat]);
      if (s.value !== null) rows.push([L("ELARIA.Mastery.FIELDS.value"), s.value]);
      if (s.reqLevel !== null) rows.push([L("ELARIA.Mastery.FIELDS.reqLevel"), s.reqLevel]);
      if (s.skillMod?.raw) rows.push([L("ELARIA.Mastery.FIELDS.skillMod"), s.skillMod.raw]);
      if (s.damage?.raw) rows.push([L("ELARIA.Mastery.FIELDS.damage"), s.damage.raw]);
      if (s.cost) rows.push([L("ELARIA.Mastery.FIELDS.cost"), s.cost]);
      if (s.usageLimit?.count) rows.push([L("ELARIA.Mastery.usage"), `${s.usageLimit.count}× ${game.i18n.format("ELARIA.Mastery.per", { per: s.usageLimit.per })}`]);
      if (s.minBondTier) rows.push([L("ELARIA.Mastery.bondTier"), s.minBondTier]);
      if (s.requirementsRaw) rows.push([L("ELARIA.Mastery.requirements"), s.requirementsRaw]);
    } else if (this.type === "gear") {
      const L = k => game.i18n.localize(k);
      rows.push([L("ELARIA.Gear.kindLabel"), L(ELARIA.gearKinds[s.kind] ?? s.kind) + (s.classTrinket ? ` (${L("ELARIA.Gear.classTrinket")})` : "")]);
      if (s.family) rows.push([L("ELARIA.Gear.family"), s.tier ? `${s.family} · ${game.i18n.format("ELARIA.Gear.tierN", { n: s.tier })}` : s.family]);
      if (s.reqLevel !== null) rows.push([L("ELARIA.Mastery.FIELDS.reqLevel"), s.reqLevel]);
      if (s.baseAttack?.raw) rows.push([L("ELARIA.Gear.baseAttack"), s.baseAttack.raw + (s.damageType ? ` (${s.damageType})` : "")]);
      if (s.armourRating !== null) rows.push(["AAR", s.armourRating + (s.weight ? ` (${s.weight})` : "")]);
      if (s.affinity) rows.push([L("ELARIA.Gear.affinity"), s.affinity]);
      if (s.equipLoad !== null) rows.push([L("ELARIA.Gear.equipLoad"), s.equipLoad]);
      if (s.breakpoint !== null) rows.push([L("ELARIA.Gear.breakpoint"), s.breakpoint]);
      if (s.grants) rows.push([L("ELARIA.Gear.grants"), s.grants]);
    } else if (this.type === "ability") {
      const L = k => game.i18n.localize(k);
      if (s.skillMod?.raw) rows.push([L("ELARIA.Mastery.FIELDS.skillMod"), s.skillMod.raw]);
      if (s.damage?.raw) rows.push([L("ELARIA.Mastery.FIELDS.damage"), s.damage.raw]);
      if (s.cost) rows.push([L("ELARIA.Mastery.FIELDS.cost"), s.cost]);
    }
    const details = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.type === "gear" ? `${s.effects ?? ""}${s.description ?? ""}` : (s.details ?? ""), {
      relativeTo: this, rollData: this.actor?.getRollData()
    });
    const esc = foundry.utils.escapeHTML;
    // Buttons on mastery cards: roll its damage, roll its skill mod.
    const skill = this.skillInfo;
    const buttons = [];
    if (this.hasDamage) {
      buttons.push(`<button type="button" class="damage-roll" data-elaria-action="damage">`
        + `<i class="fa-solid fa-dice"></i> ${game.i18n.format("ELARIA.Dice.rollDamage", { dmg: esc(s.damage.raw) })}</button>`);
    }
    if (skill && withSkill) buttons.push(skillButton(skill));
    const content = `
      <div class="elaria chat-card">
        <header><img src="${this.img}" alt=""><h3>${esc(this.name)}${s.isReaction ? " <em>(rxn)</em>" : ""}</h3></header>
        <dl class="${hidesRollDetails(this.actor) ? "roll-detail" : ""}">${rows.map(([k, v]) => `<dt>${esc(String(k))}</dt><dd>${esc(String(v))}</dd>`).join("")}</dl>
        ${details ? `<div class="details">${details}</div>` : ""}
        ${s.tagList?.length ? `<p class="tags">${s.tagList.map(t => `<span>${esc(t)}</span>`).join("")}</p>` : ""}
        ${buttons.length ? `<div class="card-buttons">${buttons.join("")}</div>` : ""}
      </div>`;
    const actor = this.actor ?? null;
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      flags: { elaria: {
        mastery: { itemUuid: this.uuid, actorUuid: actor?.uuid ?? "" },
        ...(skill ? { skill: { ...skill, name: this.name, img: this.img, actorUuid: actor?.uuid ?? "" } } : {})
      } }
    });
  }
}
