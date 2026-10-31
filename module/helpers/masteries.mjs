/**
 * Adding masteries to a character: from a compendium, the world's Items directory or another actor.
 * Used by drag-and-drop on the character sheet and by the "Add from compendium" picker.
 */

/** Does the actor already know this mastery? Works on Item documents and compendium index entries. */
export function actorHasMastery(actor, entry) {
  const ref = entry.system?.ref || "";
  const uuid = entry.uuid;
  const name = entry.name?.toLowerCase();
  return actor.items.some(i => {
    if (i.type !== "mastery") return false;
    if (uuid && i._stats?.compendiumSource === uuid) return true;
    if (ref && i.system.ref) return i.system.ref === ref;
    return !ref && !i.system.ref && i.name.toLowerCase() === name;
  });
}

/**
 * Copy masteries onto an actor (unequipped). Skips non-masteries and ones the actor already knows.
 * @param {Actor} actor
 * @param {Item[]} items
 * @returns {Promise<Item[]>} the created items
 */
export async function addMasteriesToActor(actor, items) {
  const toCreate = [];
  const skipped = [];
  for (const item of items) {
    if (item.type !== "mastery") continue;
    if (actorHasMastery(actor, item) || toCreate.some(d => d.name === item.name && d.system.ref === item.system.ref)) {
      skipped.push(item.name);
      continue;
    }
    const data = item.pack
      ? game.items.fromCompendium(item, { keepId: false, clearFolder: true, clearSort: true })
      : item.toObject();
    delete data._id;
    delete data.folder;
    delete data.sort;
    delete data.ownership;
    if (!item.pack && !item.parent) foundry.utils.setProperty(data, "_stats.compendiumSource", item.uuid);
    foundry.utils.setProperty(data, "system.equipped", false);
    toCreate.push(data);
  }
  if (skipped.length === 1) {
    ui.notifications.info(game.i18n.format("ELARIA.Mastery.alreadyKnown", { name: skipped[0] }));
  } else if (skipped.length > 1) {
    ui.notifications.info(game.i18n.format("ELARIA.Mastery.alreadyKnownMany", { n: skipped.length }));
  }
  if (!toCreate.length) return [];
  const created = await actor.createEmbeddedDocuments("Item", toCreate);
  if (created.length > 1) {
    ui.notifications.info(game.i18n.format("ELARIA.Mastery.addedMany", { n: created.length, name: actor.name }));
  }
  return created;
}

/**
 * Copy gear onto an actor, into the bag. Gear can be owned several times (no duplicate check).
 * @param {Actor} actor
 * @param {Item[]} items
 * @returns {Promise<Item[]>}
 */
export async function addGearToActor(actor, items) {
  const toCreate = [];
  for (const item of items) {
    if (item.type !== "gear") continue;
    const data = item.pack ? game.items.fromCompendium(item, { keepId: false, clearFolder: true, clearSort: true }) : item.toObject();
    delete data._id;
    delete data.folder;
    delete data.sort;
    delete data.ownership;
    if (!item.pack && !item.parent) foundry.utils.setProperty(data, "_stats.compendiumSource", item.uuid);
    foundry.utils.setProperty(data, "system.location", "bag");
    toCreate.push(data);
  }
  if (!toCreate.length) return [];
  const created = await actor.createEmbeddedDocuments("Item", toCreate);
  if (created.length > 1) ui.notifications.info(game.i18n.format("ELARIA.Gear.addedMany", { n: created.length, name: actor.name }));
  return created;
}
