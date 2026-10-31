/**
 * Masteries on the hotbar. Dropping a mastery on a hotbar slot makes a macro that "uses" it:
 * masteries with damage open the roll window filled in for them, others are posted to chat.
 */

/** hotbarDrop hook. Returns false (handled) for masteries so core doesn't make its default "open sheet" macro. */
export function onHotbarDrop(bar, data, slot) {
  if (data?.type !== "Item" || !data.uuid) return;
  const entry = fromUuidSync(data.uuid);
  if (!["mastery", "ability", "gear"].includes(entry?.type)) return;
  createMasteryMacro(data.uuid, entry, slot);
  return false;
}

async function createMasteryMacro(uuid, entry, slot) {
  const command = `game.elaria.useMastery("${uuid}");`;
  let macro = game.macros.find(m => m.command === command && m.isOwner);
  macro ??= await Macro.implementation.create({
    name: entry.name,
    type: "script",
    img: entry.img,
    command,
    flags: { elaria: { masteryMacro: true } }
  });
  if (macro) await game.user.assignHotbarMacro(macro, slot);
}

/** Used by the hotbar macros (and handy in your own): game.elaria.useMastery("Actor.abc.Item.def"). */
export async function useMastery(uuid) {
  const item = await fromUuid(uuid);
  if (!item) {
    ui.notifications.warn(game.i18n.localize("ELARIA.Mastery.macroMissing"));
    return null;
  }
  return item.use();
}
