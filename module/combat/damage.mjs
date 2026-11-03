import { ELARIA } from "../config.mjs";

/**
 * Damage dealing (Mechanics, "Damage Modifier"):
 *
 *   final = (dmg rolled + flat dmg mods − relevant armour) × (crit dmg + other % dmg mods − resistance)
 *
 * - The multiplier terms are added (Ash, 2026-11-02): a crit at +50 % crit damage against 25 % resistance is
 *   × (1.5 − 0.25) = × 1.25; no crit against 25 % resistance is × 0.75. It never goes below 0.
 * - Armour comes off every hit separately (Multi Attacks); a hit can't go below 0. Flat mods that apply once
 *   (a once-only bonus, the injury penalty) are added to the first hit.
 * - Rounded to the nearest whole number at the end (Ash, 2026-11-02); final damage is never negative.
 * - Resistance = the target's resistance to the damage's element + to its form (Mortal by default); they add.
 *
 * Damage types (Mechanics, "Physical / Magical Damage Types", "Unique types"):
 *   physical, slashing: full AR · piercing: half AR · blunt: AR without AAR · chopping: AR without NAR
 *   magical: MAR · magical piercing: half MAR · magical chopping: MAR without NMAR
 *   true: no armour, no resistance · toxic: blocked only by the target's Con mod
 * The "AR Piercing" tag ignores all armour, "AAR Piercing" ignores AAR.
 */
export const DAMAGE_TYPES = {
  physical: "ELARIA.Damage.type.physical",
  slashing: "ELARIA.Damage.type.slashing",
  piercing: "ELARIA.Damage.type.piercing",
  blunt: "ELARIA.Damage.type.blunt",
  chopping: "ELARIA.Damage.type.chopping",
  magical: "ELARIA.Damage.type.magical",
  magicalPiercing: "ELARIA.Damage.type.magicalPiercing",
  magicalChopping: "ELARIA.Damage.type.magicalChopping",
  true: "ELARIA.Damage.type.true",
  toxic: "ELARIA.Damage.type.toxic"
};

export const PIERCE_OPTIONS = { "": "ELARIA.Damage.pierce.none", aar: "ELARIA.Damage.pierce.aar", all: "ELARIA.Damage.pierce.all" };

/** A blank damage profile: plain physical, Mortal, no element. */
export const defaultProfile = () => ({ type: "physical", element: "", form: "mortal", pierce: "", askElement: false, weapon: false });

/**
 * Read a damage profile from tags and/or a weapon's damage type text ("Phy. Slashing", "Magical Fire").
 * Unknown words are ignored. With an element but nothing physical, the damage counts as magical.
 * @param {string[]} texts
 */
export function profileFromText(texts) {
  const p = defaultProfile();
  let magical = false, physical = false, sub = "";
  const elements = Object.keys(ELARIA.resistanceElements);
  for (const raw of texts ?? []) {
    const t = String(raw ?? "").toLowerCase().replace(/\bdmg\b|\bdamage\b/g, "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t === "ar piercing") { p.pierce = "all"; continue; }
    if (t === "aar piercing") { p.pierce ||= "aar"; continue; }
    if (t === "weapon") { p.weapon = true; continue; }
    if (t === "elemental") { p.askElement = true; continue; }
    const words = t.split(/[^a-z]+/).filter(Boolean);
    if (words.includes("true")) { p.type = "true"; continue; }
    if (words.includes("toxic")) { p.type = "toxic"; continue; }
    if (words.some(w => w === "magical" || w === "magic" || w === "mag")) magical = true;
    if (words.some(w => w === "physical" || w === "phy" || w === "phys")) physical = true;
    for (const s of ["slashing", "piercing", "blunt", "chopping"]) if (words.includes(s)) sub = s;
    for (const e of elements) if (words.includes(e)) p.element = e;
    for (const f of Object.keys(ELARIA.forms)) if (words.includes(f)) p.form = f;
  }
  if (p.type === "true" || p.type === "toxic") return p;
  if (!physical && !sub && (p.element || p.askElement)) magical = true;
  if (magical && !physical && sub !== "slashing" && sub !== "blunt") {
    p.type = sub === "piercing" ? "magicalPiercing" : sub === "chopping" ? "magicalChopping" : "magical";
  } else p.type = sub || "physical";
  return p;
}

/**
 * The damage profile named by a bonus part's label ("Fire", "True", "Divine", "Magical Ice"), or null when the
 * label names no damage type, element or form (then the part is just more of the main damage).
 * A label without a form keeps the main damage's form.
 */
export function labelDamageProfile(label, main = defaultProfile()) {
  const words = String(label ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const known = new Set(["true", "toxic", "magical", "magic", "physical", "slashing", "piercing", "blunt", "chopping",
    ...Object.keys(ELARIA.resistanceElements), ...Object.keys(ELARIA.forms)]);
  if (!words.some(w => known.has(w))) return null;
  const p = profileFromText([label]);
  if (!words.some(w => w in ELARIA.forms)) p.form = main.form || "mortal";
  return p;
}

/**
 * The damage profile of a mastery / ability / weapon. "Weapon Damage" takes the type of the first weapon on the
 * user's belt (the roll window lets the player change it).
 */
export function itemDamageProfile(item, actor = item?.actor) {
  const s = item?.system ?? {};
  const texts = [...(s.tagList ?? []), s.damageType ?? ""];
  const p = profileFromText(texts);
  if (p.weapon && actor) {
    const weapon = actor.items.find(i => i.type === "gear" && i.system.kind === "weapon" && i.system.location === "belt"
      && i.system.damageType);
    if (weapon) {
      const w = profileFromText([weapon.system.damageType, ...(weapon.system.tagList ?? [])]);
      p.type = w.type;
      p.element ||= w.element;
      p.weaponName = weapon.name;
    }
  }
  return p;
}

/** Short label, e.g. "Slashing · Fire · Divine · ignores AAR". */
export function profileLabel(p) {
  const L = k => game.i18n.localize(k);
  return [
    L(DAMAGE_TYPES[p.type] ?? DAMAGE_TYPES.physical),
    p.element ? ELARIA.resistanceElements[p.element] : "",
    p.form && p.form !== "mortal" ? L(ELARIA.forms[p.form]) : "",
    p.pierce ? L(PIERCE_OPTIONS[p.pierce]) : ""
  ].filter(Boolean).join(" · ");
}

/** The target's defences in one shape (characters derive them, monsters type them in). */
function defencesOf(actor) {
  const d = actor?.system?.defence ?? {};
  return { ar: d.ar ?? 0, mar: d.mar ?? 0, aar: d.aar ?? 0, nar: d.nar ?? 0, nmar: d.nmar ?? 0,
    con: actor?.system?.stats?.con?.mod ?? 0 };
}

/** The armour that applies to this damage, as {value, label}. */
export function armourFor(actor, p) {
  const d = defencesOf(actor);
  const noAar = p.pierce === "aar";
  if (p.pierce === "all" || p.type === "true") return { value: 0, label: "—" };
  const physical = { physical: 1, slashing: 1, piercing: 1, blunt: 1, chopping: 1 }[p.type];
  const pos = n => Math.max(0, n);
  switch (p.type) {
    case "toxic": return { value: pos(d.con), label: "Con" };
    case "piercing": return { value: pos(d.ar - (noAar ? d.aar : 0)) / 2, label: "½ AR" };
    case "blunt": return { value: pos(d.ar - d.aar), label: "AR − AAR" };
    case "chopping": return { value: pos(d.ar - d.nar - (noAar ? d.aar : 0)), label: "AR − NAR" };
    case "magicalPiercing": return { value: pos(d.mar - (noAar ? d.aar : 0)) / 2, label: "½ MAR" };
    case "magicalChopping": return { value: pos(d.mar - d.nmar - (noAar ? d.aar : 0)), label: "MAR − NMAR" };
    case "magical": return { value: pos(d.mar - (noAar ? d.aar : 0)), label: noAar ? "MAR − AAR" : "MAR" };
    default: return physical ? { value: pos(d.ar - (noAar ? d.aar : 0)), label: noAar ? "AR − AAR" : "AR" } : { value: 0, label: "—" };
  }
}

/** The target's resistance (%) to this damage: element + form. True damage ignores resistance. */
export function resistanceFor(actor, p) {
  if (p.type === "true") return { value: 0, parts: [] };
  const res = actor?.system?.resistanceTotals ?? {};
  const parts = [];
  if (p.element && res[p.element]) parts.push([ELARIA.resistanceElements[p.element], res[p.element].total]);
  const form = p.form || "mortal";
  if (res[form]) parts.push([game.i18n.localize(ELARIA.forms[form]), res[form].total]);
  return { value: parts.reduce((n, [, v]) => n + v, 0), parts };
}

/**
 * Work out one target's damage.
 * @param {object} entry   {hits: number[], flat: number, crit: boolean}
 * @param {object} p       damage profile
 * @param {number} critDamage  crit damage % (50 → crit multiplier 1.5)
 * @param {Actor} actor    the target
 */
export function computeDamage(entry, p, critDamage, actor) {
  const armour = armourFor(actor, p);
  const res = resistanceFor(actor, p);
  const critTerm = entry.crit ? 1 + (Number(critDamage) || 0) / 100 : 1;
  const multiplier = Math.max(0, critTerm - res.value / 100);
  const hits = (entry.hits ?? []).map((value, i) => {
    const rolled = value + (i === 0 ? (entry.flat ?? 0) : 0);
    const after = Math.max(0, rolled - armour.value);
    return { rolled, after, dealt: after * multiplier };
  });
  // Bonus parts with their own damage type ("2d6 Fire"): their own armour, resistance and multiplier.
  const extras = (entry.extras ?? []).map(x => {
    const xArmour = armourFor(actor, x.profile);
    const xRes = resistanceFor(actor, x.profile);
    const xMult = Math.max(0, critTerm - xRes.value / 100);
    const parts = x.values.map(v => {
      const after = Math.max(0, v - xArmour.value);
      return { rolled: v, after, dealt: after * xMult };
    });
    return { profile: x.profile, label: x.label, armour: xArmour, res: xRes, multiplier: xMult, parts,
      dealt: parts.reduce((n, h) => n + h.dealt, 0) };
  });
  const exact = hits.reduce((n, h) => n + h.dealt, 0) + extras.reduce((n, x) => n + x.dealt, 0);
  return { armour, res, critTerm, multiplier, hits, extras, exact, final: Math.max(0, Math.round(exact)) };
}

/** A readable breakdown for the GM (and for players hit by characters, whose numbers aren't secret). */
export function breakdownHTML(c, p) {
  const esc = foundry.utils.escapeHTML;
  const L = k => game.i18n.localize(k);
  const n = x => (Math.round(x * 100) / 100).toString();
  const hitRows = c.hits.map((h, i) => `<li>${c.hits.length > 1 ? `${game.i18n.format("ELARIA.Dice.hitN", { n: i + 1 })}: ` : ""}`
    + `${n(h.rolled)} − ${n(c.armour.value)} <small>${esc(c.armour.label)}</small> = ${n(h.after)}</li>`).join("");
  const resText = c.res.parts.length
    ? c.res.parts.map(([k, v]) => `${v >= 0 ? "−" : "+"} ${Math.abs(v) / 100} <small>${esc(k)}</small>`).join(" ")
    : "";
  const critText = `${n(c.critTerm)} <small>${c.critTerm !== 1 ? L("ELARIA.Damage.crit") : L("ELARIA.Damage.noCrit")}</small>`;
  const resOf = r => r.parts.map(([k, v]) => `${v >= 0 ? "−" : "+"} ${Math.abs(v) / 100} <small>${esc(k)}</small>`).join(" ");
  const extraRows = (c.extras ?? []).map(x => `<p class="type">+ ${esc(x.label || profileLabel(x.profile))}</p>
      <ul>${x.parts.map(h => `<li>${n(h.rolled)} − ${n(x.armour.value)} <small>${esc(x.armour.label)}</small> = ${n(h.after)}</li>`).join("")}</ul>
      <p>× (${critText} ${resOf(x.res)}) = × ${n(x.multiplier)} → ${n(x.dealt)}</p>`).join("");
  return `<div class="damage-breakdown">
      <p class="type">${esc(profileLabel(p))}</p>
      <ul>${hitRows}</ul>
      <p>× (${critText} ${resText}) = × ${n(c.multiplier)}${c.extras?.length ? ` → ${n(c.hits.reduce((s, h) => s + h.dealt, 0))}` : ""}</p>
      ${extraRows}
      <p class="final">${n(c.exact)} → <b>${c.final}</b></p>
    </div>`;
}

/* -------------------------------------------- */
/*  Applying damage                             */
/* -------------------------------------------- */

const logKey = (messageId, index) => `${messageId}-${index}`;

/** Has this card's damage for this target already been applied to the actor? */
export function appliedEntry(actor, messageId, index) {
  return actor?.getFlag("elaria", "damageLog")?.[logKey(messageId, index)] ?? null;
}

/** Who may apply damage to this actor: the GM to anyone, players to actors they own (Ash, 2026-11-02). */
export function canApplyTo(actor) {
  return !!actor && (game.user.isGM || actor.isOwner);
}

/**
 * Take damage: temp HP first, then HP (never below 0). Logged on the actor so it can't be applied twice and
 * can be undone. A drop to 0 HP opens a prompt (injury / defeated), nothing automatic.
 */
export async function applyDamage(actor, amount, { messageId, index, label = "" } = {}) {
  if (!canApplyTo(actor)) return ui.notifications.warn(game.i18n.localize("ELARIA.Damage.notYours"));
  if (appliedEntry(actor, messageId, index)) return ui.notifications.warn(game.i18n.format("ELARIA.Damage.already", { name: actor.name }));
  const hp = actor.system.resources?.hp;
  if (!hp) return;
  amount = Math.max(0, Math.round(amount));
  const fromTemp = Math.min(hp.temp ?? 0, amount);
  const fromHp = Math.min(hp.value ?? 0, amount - fromTemp);
  const before = hp.value ?? 0;
  await actor.update({
    "system.resources.hp.temp": (hp.temp ?? 0) - fromTemp,
    "system.resources.hp.value": before - fromHp,
    [`flags.elaria.damageLog.${logKey(messageId, index)}`]: { amount, temp: fromTemp, hp: fromHp, label, time: Date.now() }
  });
  ui.notifications.info(game.i18n.format("ELARIA.Damage.applied", { n: amount, name: actor.name }));
  if (before > 0 && before - fromHp <= 0) await zeroHpPrompt(actor);
  return amount;
}

/** Give back what a card took (temp and HP as they were taken). */
export async function undoDamage(actor, messageId, index) {
  const entry = appliedEntry(actor, messageId, index);
  if (!entry || !canApplyTo(actor)) return;
  const hp = actor.system.resources.hp;
  await actor.update({
    "system.resources.hp.temp": (hp.temp ?? 0) + (entry.temp ?? 0),
    "system.resources.hp.value": Math.min(hp.max ?? Infinity, (hp.value ?? 0) + (entry.hp ?? 0)),
    [`flags.elaria.damageLog.${logKey(messageId, index)}`]: null
  });
  ui.notifications.info(game.i18n.format("ELARIA.Damage.undone", { n: entry.amount, name: actor.name }));
}

/** 0 HP: just a prompt (Ash, 2026-11-02). Characters can take an injury; monsters can be marked defeated. */
async function zeroHpPrompt(actor) {
  const L = k => game.i18n.localize(k);
  const isChar = actor.type === "character";
  const buttons = [
    isChar
      ? { action: "injury", label: L("ELARIA.Damage.addInjury"), icon: "fa-solid fa-user-injured", default: true }
      : { action: "defeated", label: L("ELARIA.Damage.markDefeated"), icon: "fa-solid fa-skull", default: true },
    { action: "close", label: L("ELARIA.Damage.leave"), icon: "fa-solid fa-xmark" }
  ];
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("ELARIA.Damage.zeroTitle", { name: actor.name }), icon: "fa-solid fa-heart-crack" },
    classes: ["elaria", "zero-hp-dialog"],
    content: `<p>${L(isChar ? "ELARIA.Damage.zeroChar" : "ELARIA.Damage.zeroMonster")}</p>`,
    buttons, rejectClose: false
  });
  if (choice === "injury") return actor.update({ "system.conditions.injuries": (actor.system.conditions?.injuries ?? 0) + 1 });
  if (choice === "defeated") {
    const token = actor.token?.object ?? actor.getActiveTokens()[0];
    const combatant = token ? game.combat?.combatants.find(c => c.tokenId === token.id) : null;
    if (combatant) await combatant.update({ defeated: true });
    const id = CONFIG.specialStatusEffects.DEFEATED;
    if (id && !actor.statuses.has(id)) await actor.toggleStatusEffect(id, { active: true, overlay: true });
  }
}
