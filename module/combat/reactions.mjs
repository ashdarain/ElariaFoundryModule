/**
 * Reaction pips in the combat tracker (sidebar and popout).
 *
 * Every combatant gets one pip per reaction (RAP) it has this round: 2 at base, 3 at Awareness mod 6, 4 at mod 8,
 * plus any bonus on the sheet (system.combat.reacts). Click a pip to cycle it: empty → pass (green) → fail (red)
 * → empty. Right-click empties it. Only the combatant's owner and GMs can click. All pips empty at the start of
 * every round.
 *
 * State lives on the combatant: flags.elaria.reactions = ["pass", "fail", "", …].
 */

const STATES = ["", "pass", "fail"];
const DEFAULT_REACTS = 2;

/** How many reaction pips a combatant has. */
export function reactionCount(combatant) {
  const n = combatant.actor?.system?.combat?.reacts;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : DEFAULT_REACTS;
}

export function reactionStates(combatant) {
  const saved = combatant.getFlag("elaria", "reactions");
  return Array.isArray(saved) ? saved : [];
}

/** renderCombatTracker hook: add the pips to every combatant row. */
export function onRenderCombatTracker(app, html) {
  html = html instanceof HTMLElement ? html : html?.[0];
  const combat = app.viewed ?? game.combat;
  if (!html || !combat) return;
  const L = k => game.i18n.localize(k);

  for (const row of html.querySelectorAll("[data-combatant-id]")) {
    const combatant = combat.combatants.get(row.dataset.combatantId);
    if (!combatant) continue;
    row.querySelector(".elaria-reactions")?.remove();

    const count = reactionCount(combatant);
    const states = reactionStates(combatant);
    const canEdit = combatant.isOwner || game.user.isGM;
    const used = states.slice(0, count).filter(s => s).length;

    const pips = document.createElement("div");
    pips.className = `elaria-reactions ${canEdit ? "editable" : ""}`;
    pips.dataset.tooltip = game.i18n.format("ELARIA.Combat.reactionsTooltip", { used, n: count })
      + (canEdit ? `<br>${L("ELARIA.Combat.reactionsHint")}` : "");
    pips.innerHTML = Array.from({ length: count }, (_, i) => {
      const state = STATES.includes(states[i]) ? states[i] : "";
      return `<span class="pip ${state}" data-index="${i}"></span>`;
    }).join("");

    if (canEdit) {
      // Clicks on the pips must not also select / pan to the token, so stop them here.
      for (const type of ["mousedown", "pointerdown", "dblclick"]) pips.addEventListener(type, ev => ev.stopPropagation());
      pips.addEventListener("click", ev => onPipClick(ev, combatant, count, false));
      pips.addEventListener("contextmenu", ev => onPipClick(ev, combatant, count, true));
    }

    // Under the name (inside the name column), else at the end of the row.
    (row.querySelector(".token-name") ?? row).append(pips);
  }
}

async function onPipClick(event, combatant, count, clear) {
  const pip = event.target.closest(".pip");
  event.preventDefault();
  event.stopPropagation();
  if (!pip) return;
  const index = Number(pip.dataset.index);
  const states = Array.from({ length: count }, (_, i) => reactionStates(combatant)[i] ?? "");
  states[index] = clear ? "" : STATES[(STATES.indexOf(states[index] ?? "") + 1) % STATES.length];
  return combatant.setFlag("elaria", "reactions", states);
}

/** updateCombat hook: a new round (or the combat starting) empties everyone's reactions. Run by one GM only. */
export function onUpdateCombat(combat, changed) {
  if (!("round" in changed) || !game.users.activeGM?.isSelf) return;
  const updates = combat.combatants
    .filter(c => reactionStates(c).some(s => s))
    .map(c => ({ _id: c.id, "flags.elaria.reactions": [] }));
  if (updates.length) return combat.updateEmbeddedDocuments("Combatant", updates);
}

/** The combatant for an actor (or token) in the current combat, if any. */
export function findCombatant(actor, token = null) {
  const combat = game.combat;
  if (!combat || !actor) return null;
  const tokenId = token?.id ?? token?.document?.id ?? actor.token?.id;
  return combat.combatants.find(c => (tokenId && c.tokenId === tokenId))
    ?? combat.combatants.find(c => !actor.isToken && c.actorId === actor.id && c.actor?.id === actor.id) ?? null;
}

/** Reactions so far this round: {count, used, passes, n}. n (the DC increase) is 2 per successful reaction. */
export function reactionSummary(combatant, actor = combatant?.actor) {
  const count = combatant ? reactionCount(combatant) : (actor?.system?.combat?.reacts ?? DEFAULT_REACTS);
  const states = combatant ? reactionStates(combatant).slice(0, count) : [];
  const passes = states.filter(s => s === "pass").length;
  return { count, used: states.filter(s => s).length, passes, n: passes * 2 };
}

/** Fill the first empty pip with "pass" or "fail". Returns false if every pip is already used. */
export async function recordReaction(combatant, result) {
  if (!combatant) return false;
  const count = reactionCount(combatant);
  const states = Array.from({ length: count }, (_, i) => reactionStates(combatant)[i] ?? "");
  const free = states.indexOf("");
  if (free === -1) return false;
  states[free] = result;
  await combatant.setFlag("elaria", "reactions", states);
  return true;
}
