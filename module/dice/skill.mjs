import { statCode } from "../importer/convert.mjs";

/**
 * Skill mod rolls (the "hit chance" when the target reacts):
 * the caster rolls 3d6 + the mastery's skill mod against DC 10 + the skill mod of the target's reaction.
 * Meet the DC: the ability hits and the reaction doesn't happen (the target still spends RAP and energy).
 * Miss: the reaction happens first.
 * Several targets: one to-hit roll per target, except AoEs, where one roll is used against every target.
 */

/**
 * Read a mastery's skill mod into {stats, bonus, raw}, or null if it has none.
 * "2+Fin" → {stats: ["fin"], bonus: 2}; "1+Pre or Smrts" → {stats: ["pre", "smrts"], bonus: 1}.
 */
export function readSkillMod(skillMod) {
  const raw = String(skillMod?.raw ?? "").trim();
  if (!raw) return null;
  let stats = Array.isArray(skillMod.stats) ? [...skillMod.stats] : [];
  let bonus = Number.isFinite(skillMod.bonus) ? skillMod.bonus : null;
  if (!stats.length || bonus === null) {
    const m = /(\d+)?\s*\+?\s*([A-Za-z]+)(?:\s*(?:or|\/)\s*([A-Za-z]+))?/i.exec(raw);
    const found = [m?.[2], m?.[3]].map(w => (w ? statCode(w) : null)).filter(s => s);
    if (!stats.length) stats = found;
    if (bonus === null) bonus = parseInt(/^\s*(\d+)/.exec(raw)?.[1] ?? "0", 10);
  }
  return { raw, stats, bonus: bonus ?? 0 };
}

/** Roll window preset for a skill mod roll. With "Pre or Smrts" the character's better stat is chosen. */
export function skillRollPreset({ actor = null, skill, name = "", img = "", targets = null, aoe = false }) {
  const mods = actor?.system.stats ?? {};
  const stat = skill.stats.reduce((best, s) => (best === "" || (mods[s]?.mod ?? -99) > (mods[best]?.mod ?? -99) ? s : best), "");
  return {
    actor,
    dice: "3d6",
    stat,
    bonus: skill.bonus ? String(skill.bonus) : "",
    label: name ? game.i18n.format("ELARIA.Dice.skillLabel", { name }) : game.i18n.localize("ELARIA.Dice.skillCheck"),
    note: game.i18n.format("ELARIA.Dice.skillNote", { mod: skill.raw })
      + (aoe ? ` · ${game.i18n.localize("ELARIA.Dice.skillAoeOnce")}` : ""),
    img,
    fixedCrit: true,
    hits: 1,
    // One to-hit roll per target; an AoE rolls once (AoE ticked) for all of them, each still judged on its own.
    targets: Math.max(1, Number(targets) || 1),
    // A skill mod is part of every to-hit roll, so its bonus goes on each target (damage rolls: once, by default).
    bonusPerHit: true,
    // The card gets a Pass / Fail per target (an AoE's one roll is judged against each target).
    isSkill: true,
    aoe: !!aoe
  };
}
