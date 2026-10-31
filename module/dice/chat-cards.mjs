import { ElariaRollDialog } from "../apps/roll-dialog.mjs";
import { rollD20, defaultRollActor } from "./check.mjs";
import { skillRollPreset } from "./skill.mjs";

/**
 * Buttons on Elaria chat cards:
 *  - reroll (top right of roll cards): opens the roll window with the same settings (d20: rolls again)
 *  - "Roll skill mod": opens the roll window for the mastery's skill mod roll
 *  - "Roll damage" (mastery cards): opens the roll window for the mastery's damage
 * Only the person who made the message (and GMs) see them.
 */
export function onRenderChatMessage(message, html) {
  html = html instanceof HTMLElement ? html : html?.[0];
  const buttons = html?.querySelectorAll("[data-elaria-action]");
  if (!buttons?.length) return;
  const mine = message.isAuthor || game.user.isGM;
  for (const button of buttons) {
    if (!mine) {
      button.remove();
      continue;
    }
    button.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      onCardButton(message, button.dataset.elariaAction);
    });
  }
}

const actorFrom = uuid => (uuid ? fromUuidSync(uuid) : null);

async function onCardButton(message, action) {
  const flags = message.flags?.elaria ?? {};
  switch (action) {
    case "reroll": {
      const r = flags.roll;
      if (!r) return;
      if (r.type === "d20") return rollD20({ actor: actorFrom(r.actorUuid) });
      return ElariaRollDialog.open({
        actor: actorFrom(r.actorUuid), dice: r.dice, stat: r.stat, bonus: r.bonus, penalty: r.penalty,
        hits: r.hits ?? 1, targets: r.targets ?? 1, aoe: !!r.aoe, bonusPerHit: !!r.bonusPerHit,
        critChanceBonus: r.critChanceBonus ?? 0, critDamageBonus: r.critDamageBonus ?? 0, fixedCrit: !!r.fixedCrit,
        label: r.label, note: r.note, img: r.img,
        skill: flags.skill ? { raw: flags.skill.raw, stats: flags.skill.stats, bonus: flags.skill.bonus } : null,
        next: flags.next ?? null
      });
    }
    case "skill": {
      // Mastery cards: go through the mastery so the skill card can carry on to damage.
      const item = flags.mastery?.itemUuid ? await fromUuid(flags.mastery.itemUuid) : null;
      const s = flags.skill;
      if (item) return ElariaRollDialog.open(item.skillRollPreset(actorFrom(flags.mastery.actorUuid) ?? item.actor ?? undefined));
      if (!s) return;
      return ElariaRollDialog.open(skillRollPreset({
        actor: actorFrom(s.actorUuid), skill: s, name: s.name, img: s.img, targets: s.targets, aoe: !!s.aoe
      }));
    }
    case "useAfterReact": {
      // A passed reaction with a reaction mastery: carry on with the mastery (skill mod → damage, or chat).
      const r = flags.react;
      const item = r?.itemUuid ? await fromUuid(r.itemUuid) : null;
      if (!item) return ui.notifications.warn(game.i18n.localize("ELARIA.Mastery.macroMissing"));
      return item.use({ normal: true });
    }
    case "next": {
      // After a skill mod roll: open the mastery's damage roll.
      const n = flags.next;
      const item = n?.itemUuid ? await fromUuid(n.itemUuid) : null;
      if (!item) return ui.notifications.warn(game.i18n.localize("ELARIA.Mastery.macroMissing"));
      return ElariaRollDialog.open(item.damageRollPreset(actorFrom(n.actorUuid) ?? item.actor ?? defaultRollActor(), { targets: n.targets }));
    }
    case "damage": {
      const item = flags.mastery?.itemUuid ? await fromUuid(flags.mastery.itemUuid) : null;
      if (!item) return ui.notifications.warn(game.i18n.localize("ELARIA.Mastery.macroMissing"));
      return item.use({ skipSkill: true });
    }
  }
}
