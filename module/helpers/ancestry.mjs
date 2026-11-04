import { ANCESTRY_DEFAULTS } from "../data/ancestry-defaults.mjs";

/**
 * Races, their heritages and the heritage stat modifiers (Ancestry tab). The importer saves the sheet's current
 * data as the world setting "elaria.ancestries"; until then the built-in copy is used.
 */
export function ancestryData() {
  try {
    const data = game.settings.get("elaria", "ancestries");
    if (Array.isArray(data) && data.length) return data;
  } catch { /* settings not ready */ }
  return ANCESTRY_DEFAULTS;
}

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Match a stored name to a list entry: exact, then ignoring case/punctuation, then "Bushido" ~ "Bushido Clan". */
function match(list, name) {
  const n = norm(name);
  if (!n) return null;
  return list.find(x => x.name === name) ?? list.find(x => norm(x.name) === n)
    ?? list.find(x => norm(x.name).startsWith(n) || n.startsWith(norm(x.name))) ?? null;
}

export const findRace = (name, data = ancestryData()) => match(data, name);
export const findHeritage = (race, name) => (race ? match(race.heritages ?? [], name) : null);

/** Where each heritage target goes on the character. Stats are stat keys; the rest: */
const DERIVED_TARGETS = {
  nar: "nar", nmar: "nmar", aar: "aar", ar: "ar", mar: "mar",
  "crit-chance": "critChance", "crit-damage": "critDamage",
  "max-hp": "hp", "max-mana": "mp", "max-fatigue": "ftg"
};

/**
 * The heritage's modifiers as applied, given the character's choices (one chosen target per "pick one" mod).
 * @returns {{stats: Record<string, number>, derived: Record<string, number>, resources: Record<string, number>,
 *           choices: {index: number, amount: number, options: string[], chosen: string}[], text: string}}
 */
export function heritageMods(heritage, chosen = [], statKeys = []) {
  const out = { stats: {}, derived: {}, resources: {}, choices: [], text: heritage?.statModsRaw ?? "" };
  if (!heritage) return out;
  const add = (map, k, v) => (map[k] = (map[k] ?? 0) + v);
  (heritage.statMods ?? []).forEach((mod, index) => {
    let targets = mod.targets ?? [];
    if (mod.choice === "one" && targets.length > 1) {
      const pick = targets.includes(chosen[index]) ? chosen[index] : "";
      out.choices.push({ index, amount: mod.amount, options: targets, chosen: pick });
      targets = pick ? [pick] : [];
    }
    for (const t of targets) {
      if (t === "all") for (const k of statKeys) add(out.stats, k, mod.amount);
      else if (statKeys.includes(t)) add(out.stats, t, mod.amount);
      else if (["hp", "mp", "ftg"].includes(DERIVED_TARGETS[t])) add(out.resources, DERIVED_TARGETS[t], mod.amount);
      else if (DERIVED_TARGETS[t]) add(out.derived, DERIVED_TARGETS[t], mod.amount);
    }
  });
  return out;
}
