import { applyDamage, appliedEntry, breakdownHTML, canApplyTo, computeDamage, undoDamage } from "../combat/damage.mjs";
import { hidesRollDetails } from "./check.mjs";

const L = k => game.i18n.localize(k);
const esc = s => foundry.utils.escapeHTML(String(s));

/**
 * Damage cards: under the roll, one "Apply" button per target (or "Apply to selected" when no token was
 * targeted). The number on the button is worked out for that target now (armour, resistance, crit).
 * The GM sees every button; players only those for actors they own (Ash, 2026-11-02). Once applied, the button
 * turns into "Applied n · Undo".
 */
export function renderDamageApply(message, html) {
  const box = html?.querySelector(".damage-apply");
  const data = message.flags?.elaria?.damage;
  if (!box || !data) return;
  box.replaceChildren();
  const attacker = ChatMessage.getSpeakerActor(message.speaker);
  // The breakdown shows the attacker's numbers: secret for monsters unless you're the GM (or own it).
  const showBreakdown = game.user.isGM || !hidesRollDetails(attacker) || attacker?.isOwner;

  data.targets.forEach((entry, index) => {
    const tokenDoc = entry.tokenUuid ? fromUuidSync(entry.tokenUuid) : null;
    const actor = tokenDoc?.actor ?? null;
    if (entry.tokenUuid) {
      if (!actor || !canApplyTo(actor)) return;
      box.append(targetRow({ message, data, entry, index, actor, showBreakdown }));
    } else {
      // Not targeted at roll time: apply to whichever tokens are selected when clicking.
      if (!game.user.isGM && !game.actors.some(a => a.isOwner && a.type === "character")) return;
      box.append(selectedRow({ message, data, entry, index, showBreakdown }));
    }
  });
}

function targetRow({ message, data, entry, index, actor, showBreakdown }) {
  const row = document.createElement("div");
  row.className = "apply-row";
  const done = appliedEntry(actor, message.id, index);
  if (done) {
    row.classList.add("done");
    const text = done.amount < 0
      ? game.i18n.format("ELARIA.Damage.healedTo", { n: -done.hp, name: actor.name })
      : game.i18n.format("ELARIA.Damage.appliedTo", { n: done.amount, name: actor.name });
    row.innerHTML = `<span><i class="fa-solid fa-check"></i> ${esc(text)}</span>`
      + `<a class="undo" data-tooltip="${esc(L("ELARIA.Damage.undoHint"))}"><i class="fa-solid fa-rotate-left"></i> ${L("ELARIA.Damage.undo")}</a>`;
    row.querySelector(".undo").addEventListener("click", async ev => {
      ev.preventDefault();
      await undoDamage(actor, message.id, index);
      refresh(message);
    });
    return row;
  }
  const calc = computeDamage(entry, data.profile, data.critDamage, actor);
  row.innerHTML = calc.final < 0
    ? `<button type="button" class="apply heal"><i class="fa-solid fa-heart-pulse"></i> `
      + `${esc(game.i18n.format("ELARIA.Damage.healTo", { n: -calc.final, name: actor.name }))}</button>`
    : `<button type="button" class="apply"><i class="fa-solid fa-heart-crack"></i> `
      + `${esc(game.i18n.format("ELARIA.Damage.applyTo", { n: calc.final, name: actor.name }))}</button>`;
  if (showBreakdown) row.querySelector(".apply").dataset.tooltip = breakdownHTML(calc, data.profile);
  row.querySelector(".apply").addEventListener("click", async ev => {
    ev.preventDefault();
    const amount = await confirmAmount({ actor, calc, profile: data.profile, showBreakdown });
    if (amount === null) return;
    await applyDamage(actor, amount, { messageId: message.id, index, label: message.flags.elaria.roll?.label ?? "" });
    refresh(message);
  });
  return row;
}

function selectedRow({ message, data, entry, index, showBreakdown }) {
  const row = document.createElement("div");
  row.className = "apply-row";
  const name = entry.name ? ` (${esc(entry.name)})` : "";
  row.innerHTML = `<button type="button" class="apply"><i class="fa-solid fa-heart-crack"></i> ${L("ELARIA.Damage.applySelected")}${name}</button>`;
  row.querySelector(".apply").addEventListener("click", async ev => {
    ev.preventDefault();
    const actors = [...new Set((canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(a => a && canApplyTo(a)))];
    if (!actors.length) return ui.notifications.warn(L("ELARIA.Damage.selectFirst"));
    for (const actor of actors) {
      if (appliedEntry(actor, message.id, index)) {
        ui.notifications.warn(game.i18n.format("ELARIA.Damage.already", { name: actor.name }));
        continue;
      }
      const calc = computeDamage(entry, data.profile, data.critDamage, actor);
      const amount = await confirmAmount({ actor, calc, profile: data.profile, showBreakdown });
      if (amount === null) continue;
      await applyDamage(actor, amount, { messageId: message.id, index, label: message.flags.elaria.roll?.label ?? "" });
    }
    refresh(message);
  });
  // Already-applied selected tokens can be undone from their sheet's log; show a small note for owned ones.
  return row;
}

/** Confirm (and optionally change) the amount before it's taken off. Returns the amount, or null. */
async function confirmAmount({ actor, calc, profile, showBreakdown }) {
  const content = `
    <p>${esc(game.i18n.format("ELARIA.Damage.confirm", { name: actor.name }))}</p>
    ${showBreakdown ? breakdownHTML(calc, profile) : ""}
    <label class="amount-row"><span>${L("ELARIA.Damage.amount")}</span>
      <input type="number" name="amount" value="${calc.final}" step="1" autofocus></label>
    <p class="hint">${L("ELARIA.Damage.negativeHeals")}</p>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("ELARIA.Damage.applyTitle", { name: actor.name }), icon: "fa-solid fa-heart-crack" },
    classes: ["elaria", "apply-damage-dialog"],
    content,
    buttons: [
      { action: "apply", label: L("ELARIA.Damage.apply"), icon: "fa-solid fa-check", default: true,
        callback: (event, button) => Number(button.form.elements.amount.value) },
      { action: "cancel", label: L("ELARIA.Damage.cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  return typeof result === "number" && Number.isFinite(result) ? Math.round(result) : null;
}

/** Re-draw the card here so the button shows "Applied". */
function refresh(message) {
  ui.chat?.updateMessage?.(message);
  for (const app of foundry.applications.instances.values()) {
    if (app.constructor.name === "ChatPopout" && app.message === message) app.render();
  }
}

/**
 * updateActor hook: when someone applies or undoes damage, re-draw the cards that target that actor, so every
 * client sees "Applied" (and nobody applies it twice by accident).
 */
export function onUpdateActorDamage(actor, changes) {
  if (!foundry.utils.hasProperty(changes, "flags.elaria.damageLog")) return;
  const uuids = new Set(actor.isToken ? [actor.token.uuid] : actor.getActiveTokens(false, true).map(t => t.uuid));
  for (const message of game.messages.contents.slice(-100)) {
    const targets = message.flags?.elaria?.damage?.targets;
    if (targets?.some(t => uuids.has(t.tokenUuid))) refresh(message);
  }
}
