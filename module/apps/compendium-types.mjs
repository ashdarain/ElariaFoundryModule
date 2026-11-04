import { PACKS, MASTERY_PACKS, GEAR_PACKS } from "../importer/build.mjs";

/**
 * Masteries and gear are both Foundry "Item"s, so a new compendium could only be made as "Item". This adds
 * "Masteries" and "Gear" to the Document Type list of the Create Compendium window. Such a compendium is an Item
 * compendium marked (flags.elaria.itemType) as holding only that kind: its Create Item button then makes a
 * mastery / gear straight away, items of the other kind can't be added to it, and it gets the matching banner.
 * The imported Elaria compendiums count as marked too.
 */
export const KINDS = { mastery: "ELARIA.Compendium.masteries", gear: "ELARIA.Compendium.gear" };
const VALUE = { mastery: "ElariaMastery", gear: "ElariaGear" };

/** "mastery", "gear" or null for a compendium (collection, pack id or metadata). */
export function packItemType(pack) {
  if (!pack) return null;
  const p = typeof pack === "string" ? game.packs.get(pack) : pack;
  const meta = p?.metadata ?? p;
  if (meta?.type && meta.type !== "Item") return null;
  const flagged = meta?.flags?.elaria?.itemType;
  if (flagged) return flagged;
  const key = Object.entries(PACKS).find(([, m]) => m.name === meta?.name)?.[0];
  return MASTERY_PACKS.includes(key) ? "mastery" : GEAR_PACKS.includes(key) ? "gear" : null;
}

/** Create Compendium: turn our two choices into an Item compendium with the flag. Called once at init. */
export function patchCreateCompendium() {
  const CC = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
  if (!CC?.createCompendium || CC.createCompendium._elaria) return;
  const original = CC.createCompendium;
  const patched = async function (metadata = {}, options = {}) {
    const kind = Object.entries(VALUE).find(([, v]) => v === metadata.type)?.[0];
    if (kind) {
      metadata = foundry.utils.mergeObject(foundry.utils.deepClone(metadata),
        { type: "Item", flags: { elaria: { itemType: kind } } }, { inplace: false });
      if (!metadata.banner && CONFIG[kind === "mastery" ? "JournalEntry" : "Item"]?.compendiumBanner) {
        metadata.banner = CONFIG[kind === "mastery" ? "JournalEntry" : "Item"].compendiumBanner;
      }
    }
    return original.call(this, metadata, options);
  };
  patched._elaria = true;
  CC.createCompendium = patched;
}

/** renderDialogV2 / renderApplication: add the two choices to the Create Compendium window's type list. */
export function addCompendiumTypeChoices(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
  const select = root?.querySelector?.("select[name=type]");
  if (!select || select.querySelector("option[value=ElariaMastery]")) return;
  const item = select.querySelector("option[value=Item]");
  // Only the Create Compendium window: it has the type list and a label field.
  if (!item || !root.querySelector("input[name=label]")) return;
  const options = Object.entries(KINDS).map(([kind, label]) => {
    const o = document.createElement("option");
    o.value = VALUE[kind];
    o.textContent = game.i18n.localize(label);
    return o;
  });
  item.before(...options);
  select.value = VALUE.mastery;
}

/** The Create Item window inside a marked compendium only offers its kind. */
export function itemTypesFor(createOptions = {}) {
  const kind = packItemType(createOptions.pack);
  return kind ? [kind] : null;
}

/** preCreateItem: keep the other kind out of a marked compendium (e.g. dragged in). */
export function onPreCreateItem(item, data, options, userId) {
  const kind = packItemType(options.pack ?? item.pack);
  if (!kind || item.type === kind) return;
  if (userId === game.user.id) {
    ui.notifications.warn(game.i18n.format("ELARIA.Compendium.wrongKind", {
      type: game.i18n.localize(`TYPES.Item.${item.type}`), kind: game.i18n.localize(KINDS[kind]) }));
  }
  return false;
}
