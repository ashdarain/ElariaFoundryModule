import { ELARIA } from "../config.mjs";
import { labelDamageProfile, profileLabel } from "../combat/damage.mjs";
import { parseBonus } from "./bonus.mjs";

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
 * @param {object} [options.damage]        Damage profile (type, element, form, pierce): the card can apply the damage
 * @param {string[]} [options.targetTokens] Token UUIDs of the targets (same order as targetNames)
 */
export async function rollDice({ actor = null, stat = "", bonus = "", bonusPerHit = false, penalty = 0,
  critChance = 0, critDamage = 0, mode = "normal", dice: diceSpec = "3d6", hits = 1, targets = 1, targetNames = [],
  aoe = false, label = "", note = "", img = "", skill = null, next = null,
  critChanceBonus = 0, critDamageBonus = 0, fixedCrit = false, damage = null, targetTokens = [] } = {}) {
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

  // The bonus field's parts ("2d6 Fire 4 Wind"): each rolled on its own and shown on its own. On a damage roll,
  // a part named after a damage type / element / form is its own damage (an "extra"); the rest adds to the hit.
  const bonusTerms = parseBonus(bonus).terms.map(t => ({ ...t,
    profile: damage && t.label ? labelDamageProfile(t.label, damage) : null }));
  const rollData = actor?.getRollData?.() ?? {};
  const rollBonus = async () => {
    const parts = [];
    for (const t of bonusTerms) {
      const r = await new Roll(t.formula, rollData).evaluate();
      if (r.dice.length) allRolls.push(r);
      parts.push({ value: t.sign * r.total, formula: t.formula, label: t.label, profile: t.profile,
        dice: r.dice.length > 0 });
    }
    const plain = parts.filter(p => !p.profile).reduce((n, p) => n + p.value, 0);
    return { parts, plain, total: parts.reduce((n, p) => n + p.value, 0) };
  };
  const noBonus = { parts: [], plain: 0, total: 0 };

  /**
   * One target's damage: the dice are rolled separately for every hit (so hits differ); each hit adds the stat
   * (and the bonus, if "each hit"). A once-only bonus and the penalty apply to the total.
   */
  const rollDamage = async () => {
    const hitList = [];
    for (let h = 0; h < hits; h++) {
      const pool = await rollPool();
      const hitBonus = bonusPerHit ? await rollBonus() : noBonus;
      hitList.push({ ...pool, bonus: hitBonus, main: pool.diceTotal + mod + hitBonus.plain,
        value: pool.diceTotal + mod + hitBonus.total });
    }
    const once = bonusPerHit ? noBonus : await rollBonus();
    const raw = hitList.reduce((n, x) => n + x.value, 0) + once.total - penalty;
    return { hitList, once, raw, sets: hitList[0].sets, diceTotal: hitList[0].diceTotal };
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
      tokenUuid: targetTokens[i] ?? "",
      name: targetNames[i] || (targets > 1 ? game.i18n.format("ELARIA.Dice.targetN", { n: i + 1 }) : ""),
      dmg, crit,
      total: Math.max(0, dmg.raw),
      critTotal: Math.max(0, Math.floor(dmg.raw * multiplier))
    });
  }

  // ---- Card ----
  const sign = n => (n < 0 ? `− ${Math.abs(n)}` : `+ ${n}`);
  const setsHTML = d => `<div class="sets">${d.sets.map(x => `
      <div class="set ${x.kept ? "kept" : "dropped"}">
        ${x.faces.map(f => `<span class="die d6">${f}</span>`).join("")}
        <span class="eq">= ${x.total}</span>
      </div>`).join("")}</div>`;
  // Every bonus part on its own: "+ 7 (2d6 Fire)", "+ 4 Wind", "+ 2".
  const bonusPart = b => b.parts.map(p => {
    const name = [p.dice ? p.formula : "", p.label].filter(Boolean).join(" ");
    return `<span class="part bonus-part ${p.profile ? "typed" : ""}">${sign(p.value)}${name ? ` <small>${esc(name)}</small>` : ""}</span>`;
  }).join(" ");
  const tailHTML = d => (bonus && !bonusPerHit ? ` ${bonusPart(d.once)}` : "")
    + (penalty ? ` <span class="part">− ${penalty} <small>${L("ELARIA.Dice.penaltyShort")}</small></span>` : "");
  // Damage rolls with typed parts: the total split by type ("11 Physical · 7 Fire · 4 Wind").
  const extrasOf = d => {
    const map = new Map();
    const add = (p, v) => {
      const key = JSON.stringify(p.profile);
      if (!map.has(key)) map.set(key, { profile: p.profile, label: p.label, values: [] });
      map.get(key).values.push(v);
    };
    for (const h of d.hitList) for (const p of h.bonus.parts) if (p.profile) add(p, p.value);
    for (const p of d.once.parts) if (p.profile) add(p, p.value);
    return [...map.values()];
  };
  const byTypeHTML = d => {
    const extras = damage ? extrasOf(d) : [];
    if (!extras.length) return "";
    const main = d.hitList.reduce((n, h) => n + h.main, 0) + d.once.plain - penalty;
    const bits = [`${main} <small>${esc(profileLabel(damage))}</small>`,
      ...extras.map(x => `${x.values.reduce((a, b) => a + b, 0)} <small>${esc(x.label)}</small>`)];
    return `<div class="by-type">${bits.join(" · ")}</div>`;
  };
  const breakdownHTML = d => {
    if (hits > 1) {
      // Hit 1 [4][3] = 7 + 3 Strength = 10 …, then the sum.
      const rows = d.hitList.map((h, i) => {
        const parts = [`<span class="part">${h.diceTotal}</span>`];
        if (stat) parts.push(`<span class="part">${sign(mod)}</span>`);
        if (bonus && bonusPerHit) parts.push(bonusPart(h.bonus));
        return `<div class="hit-row">
            <span class="hit-label">${game.i18n.format("ELARIA.Dice.hitN", { n: i + 1 })}</span>
            ${setsHTML(h)}
            <span class="hit-math">${parts.join(" ")} = <b>${h.value}</b></span>
          </div>`;
      }).join("");
      const sum = d.hitList.map(h => h.value).join(" + ");
      return `<div class="hit-list">${rows}</div>
        <div class="breakdown">${diceSpec}${stat ? ` ${sign(mod)} <small>${esc(statLabel)}</small>` : ""} ${L("ELARIA.Dice.perHit")} · `
        + `<span class="part">${sum}</span>${tailHTML(d)}</div>${byTypeHTML(d)}`;
    }
    const parts = [`<span class="part">${diceSpec} <b>${d.diceTotal}</b></span>`];
    if (stat) parts.push(`<span class="part">${sign(mod)} <small>${esc(statLabel)}</small></span>`);
    if (bonus && bonusPerHit) parts.push(bonusPart(d.hitList[0].bonus));
    return `<div class="breakdown">${parts.join(" ")}${tailHTML(d)}</div>${byTypeHTML(d)}`;
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
        <div class="result crit"><span class="label">${L("ELARIA.Dice.withCritShort")}<span class="crit-x"> (×${xLabel})</span></span><span class="value">${r.critTotal}</span></div>
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
    : hidesRollDetails(actor) ? L("ELARIA.Dice.monsterRoll") : game.i18n.format("ELARIA.Dice.rollOf", { dice: diceSpec }));
  const tagsHTML = [
    hits > 1 ? `<span class="tag">${game.i18n.format("ELARIA.Dice.hits", { n: hits })}</span>` : "",
    targets > 1 ? `<span class="tag">${game.i18n.format("ELARIA.Dice.targetsTag", { n: targets })}</span>` : "",
    aoe ? `<span class="tag">${L("ELARIA.Dice.aoe")}</span>` : "",
    damage ? `<span class="tag damage-type">${esc(profileLabel(damage))}</span>` : ""
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
      ${damage ? `<div class="damage-apply"></div>` : ""}
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
    // What applying the damage needs: each target's hits (stat and per-hit bonus included), the once-only flat
    // mods (bonus − penalty), whether it crit, and the damage profile.
    ...(damage ? { damage: {
      profile: damage, critDamage,
      targets: results.map(r => ({
        tokenUuid: r.tokenUuid, name: r.name,
        hits: r.dmg.hitList.map(h => h.main),
        flat: r.dmg.once.plain - penalty,
        crit: !!r.crit?.hit,
        extras: extrasOf(r.dmg)
      }))
    } } : {}),
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
/**
 * What makes up a roll (dice faces, formula, modifiers, crit chance, the mastery's damage text) is a secret for
 * monsters: players who don't own the monster only see the results. Those parts get the class "roll-detail",
 * which onRenderChatMessage removes for them.
 */
export const ROLL_DETAIL = ".sets, .breakdown, .hit-math .part, .crit-check, .titles .note, .roll-tags, .crit-x, .by-type";

export function markRollDetails(content, selectors = ROLL_DETAIL) {
  const doc = new DOMParser().parseFromString(`<div>${content}</div>`, "text/html");
  doc.body.firstElementChild.querySelectorAll(selectors).forEach(el => el.classList.add("roll-detail"));
  return doc.body.firstElementChild.innerHTML;
}

/** Does this actor's roll breakdown stay hidden from players? (Monsters.) */
export function hidesRollDetails(actor) {
  return actor?.type === "monster";
}

export async function postRolls(rolls, { actor, content, flags = {} }) {
  if (hidesRollDetails(actor)) content = markRollDetails(content);
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
