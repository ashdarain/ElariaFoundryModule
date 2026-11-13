/**
 * Paying for masteries, abilities and attacks: the FTG / MP in an item's Cost ("3 ftg", "5 mana, 1 ftg") comes
 * off the user automatically, after the first roll of using it (the skill mod or reaction roll, or the damage roll
 * if there's no skill mod roll), or straight away when there's nothing to roll.
 * Characters can turn this off (edit mode → "Spend FTG / MP automatically"); monsters always pay.
 * Temporary FTG / MP is used up first. Other costs (HP, AP, rage …) and variable costs ("X mp") are left to the player.
 */

const RESOURCES = { ftg: "ftg", fatigue: "ftg", stamina: "ftg", mp: "mp", mana: "mp" };
const COST_RE = /(\d+)\s*(ftg|fatigue|stamina|mp|mana)\b/gi;

/** The item's FTG / MP cost as { ftg, mp } (0 when none). Read from the Cost text, so hand-edited costs count. */
export function itemCosts(item) {
  const out = { ftg: 0, mp: 0 };
  const sys = item?.system ?? {};
  const text = String(sys.cost ?? "");
  let found = false;
  for (const m of text.matchAll(COST_RE)) { out[RESOURCES[m[2].toLowerCase()]] += Number(m[1]); found = true; }
  if (!found && !text.trim()) {
    for (const c of sys.costs ?? []) {
      const key = RESOURCES[String(c.resource ?? "").toLowerCase()];
      if (key && Number.isInteger(c.amount)) out[key] += c.amount;
    }
  }
  return out;
}

/** Does this actor pay costs automatically? */
export function autoSpends(actor) {
  if (!actor) return false;
  if (actor.type === "character") return actor.system.autoSpend !== false;
  return actor.type === "monster";
}

/**
 * Take the item's FTG / MP cost off the actor (if it pays automatically and you may change it).
 * @param {Item} item
 * @param {Actor} [actor]         defaults to the item's owner
 * @param {object} [options]
 * @param {string} [options.messageId]  A chat card the use started from: it is only paid for once.
 * @returns {Promise<{resource: string, amount: number, from: number, to: number, short: number}[]>}  what was paid ([] = nothing)
 */
export async function spendItemCosts(item, actor = item?.actor, { messageId = "" } = {}) {
  if (!item || !actor || !autoSpends(actor) || !actor.isOwner) return [];
  const message = messageId ? game.messages.get(messageId) : null;
  if (message?.getFlag("elaria", "paid")) return [];
  const costs = itemCosts(item);
  const update = {};
  const paid = [];
  for (const [key, amount] of Object.entries(costs)) {
    const res = actor.system.resources?.[key];
    if (!amount || !res) continue;
    const value = Number(res.value) || 0, temp = Number(res.temp) || 0;
    const fromTemp = Math.min(temp, amount);
    const fromValue = Math.min(value, amount - fromTemp);
    if (fromTemp) update[`system.resources.${key}.temp`] = temp - fromTemp;
    if (fromValue) update[`system.resources.${key}.value`] = value - fromValue;
    paid.push({ resource: key, amount, from: value + temp, to: value + temp - fromTemp - fromValue, short: amount - fromTemp - fromValue });
  }
  if (!paid.length) return [];
  if (Object.keys(update).length) await actor.update(update);
  if (message?.isOwner) await message.setFlag("elaria", "paid", true);
  const short = paid.filter(p => p.short > 0);
  if (short.length) ui.notifications.warn(game.i18n.format("ELARIA.Cost.short", {
    name: actor.name, item: item.name,
    list: short.map(p => `${p.amount} ${game.i18n.localize(`ELARIA.Resource.${p.resource}`)} (${p.from})`).join(", ")
  }));
  return paid;
}

/** A line for chat cards: "−3 FTG (4 → 1)". */
export function spentHTML(paid, { hidden = false } = {}) {
  if (!paid?.length) return "";
  const L = k => game.i18n.localize(k);
  const parts = paid.map(p => `<span class="cost ${p.resource} ${p.short ? "short" : ""}">−${p.amount} ${L(`ELARIA.Resource.${p.resource}`)} `
    + `<small>(${p.from} → ${p.to}${p.short ? `, ${game.i18n.format("ELARIA.Cost.shortBy", { n: p.short })}` : ""})</small></span>`);
  return `<div class="spent ${hidden ? "roll-detail" : ""}"><i class="fa-solid fa-bolt"></i> ${parts.join(" ")}</div>`;
}
