import { ELARIA } from "../config.mjs";

/**
 * Crafting (Professions tab). A recipe is an Item in a compendium: the Craftables pack (one per profession), or
 * for Enchanters the evolution gear (weapons, armour, trinkets) and for Instructors the class trinkets, both on
 * the Gear tab. `system.materials` ("2 Leather, 2 Bone, 1 Soul") is paid in materials of `system.tier`.
 * Crafting takes the materials off the character and adds a copy of the item; evolving a weapon / armour /
 * trinket swaps the item it evolves from for the new one.
 */

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Older or differently spelled profession names → the Professions tab's. */
const PROFESSION_ALIASES = { craftsmen: "craftsman", excorsist: "exorcist", thief: "thiefspecialist",
  gnomishengineer: "gnomishengineering", mechnomancer: "mechnomancy" };
export const professionKey = name => {
  const n = norm(name);
  return PROFESSION_ALIASES[n] ?? n;
};

/** "Alchemical Ingrediants" → "alchemical", "Artifacts" → "artifact", "Any" → "any"; unknown → null. */
export function materialKey(name) {
  const n = norm(name).replace(/s$/, "");
  if (!n) return null;
  if (n.startsWith("alchem")) return "alchemical";
  if (n.startsWith("food")) return "food";
  if (n.startsWith("ether")) return "etherCore";
  if (n === "any") return "any";
  if (n.startsWith("artifact") || n.startsWith("artefact")) return "artifact";
  return Object.keys(ELARIA.materials).find(k => norm(k) === n) ?? null;
}

/**
 * "2 Leather, 2 Bone, 1 Soul" → [{amount: 2, key: "leather"}, …]. A bare name counts as 1.
 * @returns {{parts: {amount: number, key: string, name: string}[], unknown: string[]}}
 */
export function parseRecipe(text) {
  const parts = [], unknown = [];
  for (const piece of String(text ?? "").split(/,|\band\b|\+/i)) {
    const m = /^\s*(\d+)?\s*x?\s*([A-Za-z][A-Za-z .'-]*?)\s*$/.exec(piece);
    if (!m) { if (piece.trim()) unknown.push(piece.trim()); continue; }
    const key = materialKey(m[2]);
    if (!key) { unknown.push(piece.trim()); continue; }
    const amount = Number(m[1]) || 1;
    const same = parts.find(p => p.key === key);
    if (same) same.amount += amount;
    else parts.push({ amount, key, name: m[2].trim() });
  }
  return { parts, unknown };
}

export const materialLabel = key => (key === "any" ? game.i18n.localize("ELARIA.Material.any")
  : game.i18n.localize(ELARIA.materials[key] ?? key));

/** How many of a material (at a tier) the character has. */
export const owned = (actor, key, tier) => actor.system.materials?.[key]?.[`t${tier}`] ?? 0;

/**
 * Can the character pay for it? For "Any", the best single material at that tier counts.
 * @returns {{ok: boolean, parts: {amount, key, have, ok}[]}}
 */
export function checkCost(actor, recipe) {
  const tier = Math.clamp(Number(recipe.tier) || 1, 1, 5);
  const named = recipe.parts.filter(p => p.key !== "any");
  const parts = named.map(p => ({ ...p, have: owned(actor, p.key, tier), ok: owned(actor, p.key, tier) >= p.amount }));
  for (const p of recipe.parts.filter(x => x.key === "any")) {
    // What's left of each material after the named parts, best one first.
    const left = Object.keys(ELARIA.materials).map(k => owned(actor, k, tier) - (named.find(n => n.key === k)?.amount ?? 0));
    const have = Math.max(0, ...left);
    parts.push({ ...p, have, ok: have >= p.amount });
  }
  return { ok: parts.every(p => p.ok), parts, tier };
}

/* -------------------------------------------- */
/*  Recipes                                     */
/* -------------------------------------------- */

const INDEX_FIELDS = ["system.materials", "system.tier", "system.reqLevel", "system.kind", "system.classTrinket",
  "system.profession", "system.evolvesFrom", "system.family", "system.description", "system.effects", "system.quantity"];

let cache = null;

/** Every gear item in the Item compendiums (indexed once; Refresh clears it). */
async function allGear() {
  if (cache) return cache;
  const out = [];
  for (const pack of game.packs.filter(p => p.documentName === "Item" && p.visible)) {
    const index = await pack.getIndex({ fields: INDEX_FIELDS });
    for (const e of index) if (e.type === "gear") out.push({ ...e, packLabel: pack.metadata.label, packName: pack.metadata.name });
  }
  cache = out;
  return out;
}

export function clearRecipeCache() {
  cache = null;
}

/** The recipes a profession can craft, sorted by required level. */
export async function recipesFor(profession) {
  const key = professionKey(profession);
  if (!key) return [];
  const gear = await allGear();
  const pick = e => {
    const s = e.system ?? {};
    // Enchanters: evolution gear (not unique gear, which isn't crafted from the trees).
    if (key === "enchanter") return ["weapon", "armour", "trinket"].includes(s.kind) && !s.classTrinket
      && e.packName !== "elaria-unique-gear";
    if (key === "instructor") return !!s.classTrinket;
    return professionKey(s.profession) === key;
  };
  const strip = h => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
  return gear.filter(pick).map(e => {
    const s = e.system ?? {};
    const parsed = parseRecipe(s.materials);
    return {
      uuid: e.uuid, name: e.name, img: e.img, packLabel: e.packLabel,
      reqLevel: s.reqLevel ?? 0, tier: s.tier ?? 1, kind: s.kind, family: s.family ?? "",
      evolvesFrom: s.evolvesFrom ?? "", materialsText: s.materials ?? "",
      parts: parsed.parts, unknown: parsed.unknown,
      text: strip(`${s.effects ?? ""} ${s.description ?? ""}`)
    };
  }).sort((a, b) => (a.reqLevel - b.reqLevel) || a.family.localeCompare(b.family) || (a.tier - b.tier) || a.name.localeCompare(b.name));
}

/* -------------------------------------------- */
/*  Crafting                                    */
/* -------------------------------------------- */

/**
 * Craft (or evolve into) a recipe: asks to confirm (and which material pays for "Any"), takes the materials,
 * adds the item, removes the item it evolved from, and posts a chat card.
 */
export async function craftRecipe(actor, recipe, { evolve = false } = {}) {
  const L = k => game.i18n.localize(k);
  const esc = foundry.utils.escapeHTML;
  const cost = checkCost(actor, recipe);
  const tier = cost.tier;
  const from = evolve ? actor.items.find(i => i.type === "gear" && i.name === recipe.evolvesFrom) : null;
  if (evolve && !from) return ui.notifications.warn(game.i18n.format("ELARIA.Craft.noBase", { name: recipe.evolvesFrom }));
  // Players need the materials and the level; the GM can craft anyway (the counts stop at 0).
  if (!game.user.isGM) {
    if ((recipe.reqLevel ?? 0) > (actor.system.level ?? 0)) {
      return ui.notifications.warn(game.i18n.format("ELARIA.Craft.lockedHint", { n: recipe.reqLevel }));
    }
    if (!cost.ok) return ui.notifications.warn(L("ELARIA.Craft.notEnough"));
  }

  // "Any": choose which material pays (only those with enough at this tier).
  const anyPart = recipe.parts.find(p => p.key === "any");
  const anyChoices = anyPart ? Object.keys(ELARIA.materials)
    .filter(k => owned(actor, k, tier) - (recipe.parts.find(p => p.key === k)?.amount ?? 0) >= anyPart.amount) : [];
  const costList = recipe.parts.length
    ? recipe.parts.map(p => `${p.amount} ${esc(materialLabel(p.key))}`).join(", ") + ` (${game.i18n.format("ELARIA.Craft.tierN", { n: tier })})`
    : L("ELARIA.Craft.noMaterials");
  const content = `<p>${esc(game.i18n.format(evolve ? "ELARIA.Craft.confirmEvolve" : "ELARIA.Craft.confirm",
      { item: recipe.name, from: from?.name ?? "" }))}</p>
    <p><b>${L("ELARIA.Craft.cost")}</b> ${costList}</p>
    ${anyPart ? `<label class="any-row"><span>${esc(game.i18n.format("ELARIA.Craft.payAny", { n: anyPart.amount }))}</span>
      <select name="any">${anyChoices.map(k => `<option value="${k}">${esc(materialLabel(k))} (${owned(actor, k, tier)})</option>`).join("")}</select></label>` : ""}
    ${recipe.unknown.length ? `<p class="hint">${esc(game.i18n.format("ELARIA.Craft.unknownParts", { parts: recipe.unknown.join(", ") }))}</p>` : ""}
    ${!cost.ok ? `<p class="hint warn">${L("ELARIA.Craft.notEnoughGM")}</p>` : ""}`;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: recipe.name, icon: "fa-solid fa-hammer" },
    classes: ["elaria", "craft-dialog"],
    content,
    buttons: [
      { action: "craft", label: L(evolve ? "ELARIA.Craft.evolve" : "ELARIA.Craft.craft"), icon: "fa-solid fa-hammer", default: true,
        callback: (event, button) => ({ any: button.form.elements.any?.value ?? "" }) },
      { action: "cancel", label: L("ELARIA.Damage.cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!choice || choice === "cancel") return null;
  if (anyPart && !choice.any) return ui.notifications.warn(L("ELARIA.Craft.notEnough"));

  // Pay (never below 0: the GM can allow crafting short of materials, the counts just stop at 0).
  const update = {};
  for (const p of recipe.parts) {
    const key = p.key === "any" ? choice.any : p.key;
    const path = `system.materials.${key}.t${tier}`;
    const current = foundry.utils.getProperty(update, path) ?? owned(actor, key, tier);
    update[path] = Math.max(0, current - p.amount);
  }
  if (Object.keys(update).length) await actor.update(update);

  const source = await fromUuid(recipe.uuid);
  if (!source) return ui.notifications.error(game.i18n.format("ELARIA.Craft.missing", { name: recipe.name }));
  const data = source.toObject();
  delete data._id;
  foundry.utils.setProperty(data, "flags.core.sourceId", source.uuid);
  foundry.utils.setProperty(data, "_stats.compendiumSource", source.uuid);
  if (from) {
    // Keeps where the old one was (belt / worn) and its condition.
    data.system.location = from.system.location;
    data.system.broken = false;
    await from.delete();
  } else {
    data.system.location = "bag";
  }
  // The same craftable already in the bag stacks.
  const stack = !from && data.system.kind === "item"
    ? actor.items.find(i => i.type === "gear" && i.name === data.name && i.system.kind === "item") : null;
  let item;
  if (stack) item = await stack.update({ "system.quantity": (stack.system.quantity ?? 1) + (data.system.quantity ?? 1) });
  else [item] = await actor.createEmbeddedDocuments("Item", [data]);

  const used = recipe.parts.map(p => `${p.amount} ${materialLabel(p.key === "any" ? choice.any : p.key)}`).join(", ");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="elaria chat-card craft-card"><header><img src="${esc(source.img)}" alt="">
      <h3>${esc(game.i18n.format(from ? "ELARIA.Craft.evolvedCard" : "ELARIA.Craft.craftedCard",
        { name: actor.name, item: source.name, from: from?.name ?? "" }))}</h3></header>
      ${used ? `<p class="note">${esc(game.i18n.format("ELARIA.Craft.usedCard", { used, n: tier }))}</p>` : ""}</div>`
  });
  return item;
}
