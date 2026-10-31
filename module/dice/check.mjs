import { ELARIA } from "../config.mjs";

/**
 * Elaria rolls.
 *
 * A 3d6 roll is `3d6 + stat mod + bonus − penalty` (A2). Advantage rolls the 3d6 twice and keeps the higher sum,
 * disadvantage keeps the lower (the modifiers are the same either way). The crit d100 is rolled once, whatever the
 * mode: it crits when the d100 is at or under the crit chance. A crit multiplies the result by 1 + crit damage %
 * (A6), rounded down. Results never go below 0.
 */

const esc = s => foundry.utils.escapeHTML(String(s));
const L = k => game.i18n.localize(k);

/** Clamp a crit chance into 0–100. */
const pct = n => Math.clamp(Math.round(Number(n) || 0), 0, 100);

/** Dice the roll window accepts: "3d6", "10d6", "1d8" … */
export const DICE_RE = /^([1-9]\d?)d([1-9]\d{0,2})$/;

/** Kept for macros written against v0.5.0. */
export function roll3d6(options = {}) {
  return rollDice({ ...options, dice: "3d6" });
}

/**
 * Roll (3d6 by default, or a mastery's damage dice) and post it to chat.
 *
 * Multi-hit and multi-target rules:
 *  - Every hit rolls its own dice: "2d6+Str x2" rolls 2d6 + Str twice per target and adds them, so hits differ.
 *    The stat counts on every hit; the "Add to roll" bonus counts once unless "each hit" is ticked.
 *  - Crit is rolled once per target. If a target is crit, every hit on it crits.
 *  - AoE: one damage roll shared by every target, but each target still gets its own crit roll.
 *  - Skill mod (to-hit) rolls: one per target.
 *
 * @param {object} options
 * @param {Actor|null} [options.actor]
 * @param {string} [options.stat]          Stat key ("" = none)
 * @param {string} [options.bonus]         Extra number or dice formula, e.g. "2" or "1d4+1"
 * @param {boolean} [options.bonusPerHit]  Add the bonus to every hit instead of once
 * @param {number} [options.penalty]       Injury/exhaustion penalty to subtract (once per target)
 * @param {number} [options.critChance]    0–100
 * @param {number} [options.critDamage]    percent, e.g. 20 → ×1.2
 * @param {"normal"|"advantage"|"disadvantage"} [options.mode]
 * @param {string} [options.dice]          Dice, e.g. "3d6" (default) or "4d6"
 * @param {number} [options.hits]          Hits per target (default 1)
 * @param {number} [options.targets]       Number of targets (default 1)
 * @param {string[]} [options.targetNames] Names for the targets (e.g. the user's targeted tokens)
 * @param {boolean} [options.aoe]          One shared damage roll for all targets
 * @param {string} [options.label]         Heading for the chat card (e.g. the mastery name)
 * @param {string} [options.note]          Small line under the heading (e.g. the mastery's damage as written)
 * @param {string} [options.img]           Icon for the heading
 * @param {object} [options.skill]         A mastery's skill mod ({stats, bonus, raw}): adds a "Roll skill mod" button
 */
export async function rollDice({ actor = null, stat = "", bonus = "", bonusPerHit = false, penalty = 0,
  critChance = 0, critDamage = 0, mode = "normal", dice: diceSpec = "3d6", hits = 1, targets = 1, targetNames = [],
  aoe = false, label = "", note = "", img = "", skill = null, next = null,
  critChanceBonus = 0, critDamageBonus = 0, fixedCrit = false } = {}) {
  diceSpec = DICE_RE.test(String(diceSpec).trim().toLowerCase()) ? String(diceSpec).trim().toLowerCase() : "3d6";
  const mod = stat && actor ? actor.system.stats?.[stat]?.mod ?? 0 : 0;
  const statLabel = stat ? L(ELARIA.stats[stat]?.label ?? stat) : "";
  bonus = String(bonus ?? "").trim();
  penalty = Math.max(0, Math.round(Number(penalty) || 0));
  hits = Math.clamp(Math.round(Number(hits) || 1), 1, 50);
  targets = Math.clamp(Math.round(Number(targets) || 1), 1, 50);
  aoe = !!aoe && targets > 1;
  critChance = pct(critChance);
  critDamage = Math.round(Number(critDamage) || 0);
  const multiplier = 1 + critDamage / 100;
  const allRolls = [];

  /** Roll the dice (twice with advantage/disadvantage) and the bonus once. */
  /** Roll the dice once (twice with advantage/disadvantage, keeping one). */
  const rollPool = async () => {
    const poolFormula = mode === "advantage" ? `{${diceSpec}, ${diceSpec}}kh` : mode === "disadvantage" ? `{${diceSpec}, ${diceSpec}}kl` : diceSpec;
    const roll = await new Roll(poolFormula).evaluate();
    allRolls.push(roll);
    const sets = roll.dice.slice(0, mode === "normal" ? 1 : 2).map(die => {
      const faces = die.results.map(x => x.result);
      return { faces, total: faces.reduce((a, b) => a + b, 0), kept: true };
    });
    if (sets.length === 2) {
      const keep = mode === "advantage" ? (sets[0].total >= sets[1].total ? 0 : 1) : (sets[0].total <= sets[1].total ? 0 : 1);
      sets[1 - keep].kept = false;
    }
    return { sets, diceTotal: sets.find(x => x.kept)?.total ?? 0 };
  };

  const rollBonus = async () => {
    if (!bonus) return 0;
    const b = await new Roll(bonus).evaluate();
    if (b.dice.length) allRolls.push(b);
    return b.total;
  };

  /**
   * One target's damage: the dice are rolled separately for every hit (so hits differ); each hit adds the stat
   * (and the bonus, if "each hit"). A once-only bonus and the penalty apply to the total.
   */
  const rollDamage = async () => {
    const hitList = [];
    for (let h = 0; h < hits; h++) {
      const pool = await rollPool();
      const hitBonus = bonusPerHit ? await rollBonus() : 0;
      hitList.push({ ...pool, bonusValue: hitBonus, value: pool.diceTotal + mod + hitBonus });
    }
    const onceBonus = bonusPerHit ? 0 : await rollBonus();
    const raw = hitList.reduce((n, x) => n + x.value, 0) + onceBonus - penalty;
    return { hitList, onceBonus, raw, sets: hitList[0].sets, diceTotal: hitList[0].diceTotal, bonusValue: bonusPerHit ? hitList[0].bonusValue : onceBonus };
  };


  const rollCrit = async () => {
    if (critChance <= 0) return null;
    const r = await new Roll("1d100").evaluate();
    allRolls.push(r);
    return { value: r.total, hit: r.total <= critChance };
  };

  // One damage roll per target (or one shared for AoE), one crit roll per target.
  const shared = aoe ? await rollDamage() : null;
  const results = [];
  for (let i = 0; i < targets; i++) {
    const dmg = shared ?? await rollDamage();
    const crit = await rollCrit();
    results.push({
      name: targetNames[i] || (targets > 1 ? game.i18n.format("ELARIA.Dice.targetN", { n: i + 1 }) : ""),
      dmg, crit,
      total: Math.max(0, dmg.raw),
      critTotal: Math.max(0, Math.floor(dmg.raw * multiplier))
    });
  }

  // ---- Card ----
  const sign = n => (n < 0 ? `− ${Math.abs(n)}` : `+ ${n}`);
  const plainBonus = /^[+-]?\s*\d+$/.test(bonus);
  const setsHTML = d => `<div class="sets">${d.sets.map(x => `
      <div class="set ${x.kept ? "kept" : "dropped"}">
        ${x.faces.map(f => `<span class="die d6">${f}</span>`).join("")}
        <span class="eq">= ${x.total}</span>
      </div>`).join("")}</div>`;
  const bonusPart = v => `<span class="part">${sign(v)}${plainBonus ? "" : ` <small>${esc(bonus)}</small>`}</span>`;
  const tailHTML = d => (bonus && !bonusPerHit ? ` ${bonusPart(d.onceBonus)}` : "")
    + (penalty ? ` <span class="part">− ${penalty} <small>${L("ELARIA.Dice.penaltyShort")}</small></span>` : "");
  const breakdownHTML = d => {
    if (hits > 1) {
      // Hit 1 [4][3] = 7 + 3 Strength = 10 …, then the sum.
      const rows = d.hitList.map((h, i) => {
        const parts = [`<span class="part">${h.diceTotal}</span>`];
        if (stat) parts.push(`<span class="part">${sign(mod)}</span>`);
        if (bonus && bonusPerHit) parts.push(bonusPart(h.bonusValue));
        return `<div class="hit-row">
            <span class="hit-label">${game.i18n.format("ELARIA.Dice.hitN", { n: i + 1 })}</span>
            ${setsHTML(h)}
            <span class="hit-math">${parts.join(" ")} = <b>${h.value}</b></span>
          </div>`;
      }).join("");
      const sum = d.hitList.map(h => h.value).join(" + ");
      return `<div class="hit-list">${rows}</div>
        <div class="breakdown">${diceSpec}${stat ? ` ${sign(mod)} <small>${esc(statLabel)}</small>` : ""} ${L("ELARIA.Dice.perHit")} · `
        + `<span class="part">${sum}</span>${tailHTML(d)}</div>`;
    }
    const parts = [`<span class="part">${diceSpec} <b>${d.diceTotal}</b></span>`];
    if (stat) parts.push(`<span class="part">${sign(mod)} <small>${esc(statLabel)}</small></span>`);
    if (bonus && bonusPerHit) parts.push(bonusPart(d.bonusValue));
    return `<div class="breakdown">${parts.join(" ")}${tailHTML(d)}</div>`;
  };
  const critHTML = c => !c ? "" : `<div class="crit-check ${c.hit ? "hit" : "miss"}">
      <span class="die d100">${c.value}</span>
      ${c.hit
        ? `<b>${L("ELARIA.Dice.crit")}</b> <small>${game.i18n.format("ELARIA.Dice.critAgainst", { n: critChance })}</small>`
        : `<span>${game.i18n.format("ELARIA.Dice.noCrit", { n: critChance })}</span>`}
    </div>`;
  const xLabel = multiplier.toFixed(2).replace(/\.?0+$/, "");
  const resultsHTML = r => r.crit?.hit
    ? `<div class="results two">
        <div class="result"><span class="label">${L("ELARIA.Dice.withoutCrit")}</span><span class="value">${r.total}</span></div>
        <div class="result crit"><span class="label">${game.i18n.format("ELARIA.Dice.withCrit", { x: xLabel })}</span><span class="value">${r.critTotal}</span></div>
      </div>`
    : `<div class="results"><div class="result"><span class="label">${L("ELARIA.Dice.total")}</span><span class="value">${r.total}</span></div></div>`;

  let body;
  if (targets === 1) {
    const r = results[0];
    body = (hits > 1 ? "" : setsHTML(r.dmg)) + breakdownHTML(r.dmg) + critHTML(r.crit) + resultsHTML(r);
  } else {
    const blocks = results.map(r => `
      <div class="target ${r.crit?.hit ? "is-crit" : ""}">
        <div class="target-name"><i class="fa-solid fa-crosshairs"></i> ${esc(r.name)}</div>
        ${aoe ? "" : (hits > 1 ? "" : setsHTML(r.dmg)) + breakdownHTML(r.dmg)}
        ${critHTML(r.crit)}
        ${resultsHTML(r)}
      </div>`).join("");
    body = (aoe ? `<div class="aoe-shared"><span class="aoe-label">${L("ELARIA.Dice.aoeShared")}</span>${hits > 1 ? "" : setsHTML(shared)}${breakdownHTML(shared)}</div>` : "")
      + `<div class="targets">${blocks}</div>`;
  }

  const modeLabel = mode === "normal" ? "" : L(`ELARIA.Dice.${mode}`);
  const heading = label || (stat ? game.i18n.format("ELARIA.Roll.check", { stat: statLabel })
    : game.i18n.format("ELARIA.Dice.rollOf", { dice: diceSpec }));
  const tagsHTML = [
    hits > 1 ? `<span class="tag">${game.i18n.format("ELARIA.Dice.hits", { n: hits })}</span>` : "",
    targets > 1 ? `<span class="tag">${game.i18n.format("ELARIA.Dice.targetsTag", { n: targets })}</span>` : "",
    aoe ? `<span class="tag">${L("ELARIA.Dice.aoe")}</span>` : ""
  ].join("");

  const anyCrit = results.some(r => r.crit?.hit);
  const content = `
    <div class="elaria roll-card ${anyCrit ? "is-crit" : ""}">
      <header>
        ${img ? `<img src="${esc(img)}" alt="">` : ""}
        <div class="titles"><h3>${esc(heading)}</h3>${note ? `<span class="note">${esc(note)}</span>` : ""}</div>
        ${modeLabel ? `<span class="mode ${mode}">${esc(modeLabel)}</span>` : ""}
        ${rerollButton()}
      </header>
      ${tagsHTML ? `<div class="roll-tags">${tagsHTML}</div>` : ""}
      ${body}
      ${skill ? skillButton(skill) : ""}
      ${next ? `<button type="button" class="next-roll" data-elaria-action="next"><i class="fa-solid fa-burst"></i> ${L("ELARIA.Dice.thenDamage")}</button>` : ""}
    </div>`;

  // Everything needed to open the roll window again with the same settings, and for the skill button.
  const flags = {
    roll: {
      type: "dice", actorUuid: actor?.uuid ?? "", dice: diceSpec, stat, bonus, bonusPerHit, penalty, critChance, critDamage,
      critChanceBonus, critDamageBonus, fixedCrit, hits, targets, aoe, label, note, img
    },
    ...(next ? { next } : {}),
    ...(skill ? { skill: { ...skill, name: label, img, actorUuid: actor?.uuid ?? "", targets, aoe } } : {})
  };
  return postRolls(allRolls, { actor, content, flags });
}

/** Plain d20 (background / social standing rolls), no modifiers. */
export async function rollD20({ actor = null } = {}) {
  const roll = new Roll("1d20");
  await roll.evaluate();
  const content = `
    <div class="elaria roll-card d20">
      <header><h3>${L("ELARIA.Dice.rollD20")}</h3>${rerollButton()}</header>
      <div class="results"><div class="result ${roll.total === 20 ? "nat20" : roll.total === 1 ? "nat1" : ""}">
        <span class="label">d20</span><span class="value">${roll.total}</span></div></div>
    </div>`;
  return postRolls([roll], { actor, content, flags: { roll: { type: "d20", actorUuid: actor?.uuid ?? "" } } });
}

/** Small button in the card's top right: roll this again (opens the roll window with the same settings). */
export function rerollButton() {
  return `<a class="reroll" data-elaria-action="reroll" data-tooltip="${L("ELARIA.Dice.reroll")}">`
    + `<i class="fa-solid fa-rotate-right"></i></a>`;
}

/** "Roll skill mod (3+Ins)" button for masteries with a skill mod. */
export function skillButton(skill) {
  return `<button type="button" class="skill-roll" data-elaria-action="skill">`
    + `<i class="fa-solid fa-bullseye"></i> ${game.i18n.format("ELARIA.Dice.rollSkill", { mod: esc(skill.raw) })}</button>`;
}

/**
 * Create the chat message. The rolls are attached so roll privacy (public / GM / blind / self) and dice
 * animations work; our own HTML replaces the default roll display.
 */
export async function postRolls(rolls, { actor, content, flags = {} }) {
  const data = {
    author: game.user.id,
    speaker: ChatMessage.getSpeaker(actor ? { actor } : {}),
    content,
    rolls,
    sound: CONFIG.sounds.dice,
    flags: { elaria: flags }
  };
  applyMessageMode(data);
  return ChatMessage.implementation.create(data);
}

/** Apply the roll privacy chosen under the chat box (v14 calls it "message mode", v13 "roll mode"). */
function applyMessageMode(data) {
  if (typeof ChatMessage.applyMode === "function") {
    ChatMessage.applyMode(data, game.settings.get("core", "messageMode"));
  } else {
    ChatMessage.applyRollMode(data, game.settings.get("core", "rollMode"));
  }
}

/** The actor rolls default to: the selected token's, else the user's assigned character. */
export function defaultRollActor() {
  return canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
}
