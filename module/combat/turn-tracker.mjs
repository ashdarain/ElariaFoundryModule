import { isOut, request, windowsEnabled, windowState, sideOf, hasActed, flagsOf, nextWindowOfSide, snapshot, SIDES } from "./turn-order.mjs";

/**
 * Combat tracker with action windows (see turn-order.mjs).
 * - Rows get their side's colour on the left edge; units that have acted this round a ✓.
 * - The acting row says who picked them.
 * - Rows still to come are windows, not turns: they read "Party window" / "Enemy window" (players don't see which
 *   enemy is coming, and hovering or clicking those rows doesn't point at the token), with the planned pick if
 *   there is one. GMs still see who sits there.
 * - A "Still to act" strip above the list: party portraits, and how many of the other sides are left.
 */

const L = k => game.i18n.localize(k);
const SIDE_ICON = { pc: "icons/svg/combat.svg", ally: "icons/svg/shield.svg", neutral: "icons/svg/mystery-man.svg",
  enemy: "icons/svg/skull.svg", secret: "icons/svg/skull.svg" };
const sideLabel = side => L(`ELARIA.Turn.side.${side}`);
const windowLabel = side => `${sideLabel(side)} ${L("ELARIA.Turn.window")}`;
const stop = ev => { ev.stopPropagation(); ev.stopImmediatePropagation?.(); };

export function decorateTracker(app, html) {
  html = html instanceof HTMLElement ? html : html?.[0];
  const combat = app?.viewed ?? game.combat;
  if (!html) return;
  html.querySelectorAll(".elaria-to-act, .elaria-window-note").forEach(el => el.remove());
  if (!combat?.started || !windowsEnabled()) return;

  const gm = game.user.isGM;
  const round = combat.round;
  const state = windowState(combat);
  const turns = snapshot(combat);
  const nextIndex = Object.fromEntries(SIDES.map(s => [s, nextWindowOfSide(turns, combat.turn, round, s)])
    .filter(([, w]) => w && w.round === round).map(([s, w]) => [s, w.index]));

  for (const row of html.querySelectorAll("[data-combatant-id]")) {
    const c = combat.combatants.get(row.dataset.combatantId);
    if (!c) continue;
    const i = combat.turns.indexOf(c);
    const side = sideOf(c);
    const ownSide = side === "pc";
    row.classList.add("elaria-window", `elaria-side-${side}`);
    const nameEl = row.querySelector(".token-name .name, .token-name strong, .token-name h4");
    const img = row.querySelector("img.token-image, img");
    const note = document.createElement("span");
    note.className = "elaria-window-note";
    const acted = hasActed(combat, c);
    const hasInit = Number.isFinite(c.initiative);

    if (isOut(c)) {
      if (hasInit) {
        note.textContent = L("ELARIA.Turn.removedNote");
        // Undo: bring the window back where it is (GM, or the unit's owner).
        if (c.isOwner) {
          const btn = document.createElement("a");
          btn.className = "elaria-restore-window";
          btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${L("ELARIA.Turn.restore")}`;
          btn.dataset.tooltip = L("ELARIA.Turn.restoreHint");
          for (const type of ["mousedown", "pointerdown", "dblclick"]) btn.addEventListener(type, stop);
          btn.addEventListener("click", ev => {
            stop(ev);
            request("restoreWindow", combat, { id: c.id });
          });
          note.append(" ", btn);
        }
      }
    } else if (!hasInit) {
      // no window yet
    } else if (i === combat.turn) {
      row.classList.add("elaria-acting");
      const by = combat.combatants.get(state.pickedBy);
      if (by && by.id !== c.id) note.textContent = game.i18n.format("ELARIA.Turn.pickedBy", { name: by.name });
    } else if (i < combat.turn) {
      if (acted) row.classList.add("elaria-acted");
      else if (gm || ownSide) note.textContent = L("ELARIA.Turn.notActedNote");
    } else {
      row.classList.add("elaria-future");
      const reserved = flagsOf(c).reserved === round;
      const planned = nextIndex[side] === i ? combat.combatants.get(state.next[side]) : null;
      if (gm) {
        note.textContent = [windowLabel(side), reserved ? game.i18n.format("ELARIA.Turn.delayedNote", { name: c.name }) : "",
          planned ? game.i18n.format("ELARIA.Turn.plannedNote", { name: planned.name }) : ""].filter(s => s).join(" · ");
      } else {
        if (nameEl) nameEl.textContent = windowLabel(side);
        if (ownSide && reserved) note.textContent = game.i18n.format("ELARIA.Turn.delayedNote", { name: c.name });
        else if (ownSide && planned) note.textContent = game.i18n.format("ELARIA.Turn.plannedNote", { name: planned.name });
        if (img) img.src = (ownSide && (planned ?? (reserved ? c : null))?.img) || SIDE_ICON[side];
        if (!ownSide) {
          // Don't point at the token behind an enemy window.
          for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "click", "dblclick", "contextmenu"]) {
            row.addEventListener(type, stop, true);
          }
        }
      }
    }
    if (acted && (gm || ownSide || i <= combat.turn) && !isOut(c)) {
      const tick = document.createElement("i");
      tick.className = "fa-solid fa-check elaria-acted-tick";
      tick.dataset.tooltip = L("ELARIA.Turn.actedHint");
      if (!row.querySelector(".elaria-acted-tick")) nameEl?.after(tick);
    }
    if (note.textContent) (row.querySelector(".token-name") ?? row).append(note);
  }

  // "Still to act" strip
  const list = html.querySelector("[data-combatant-id]")?.parentElement;
  if (!list) return;
  const strip = document.createElement("div");
  strip.className = "elaria-to-act";
  const groups = [];
  for (const side of SIDES) {
    const members = combat.turns.filter(c => sideOf(c) === side && !isOut(c) && Number.isFinite(c.initiative)
      && (gm || !c.hidden));
    if (!members.length) continue;
    const left = members.filter(c => !hasActed(combat, c));
    const showFaces = gm || side === "pc";
    const faces = showFaces
      ? left.map(c => `<img src="${c.img}" alt="" data-tooltip="${foundry.utils.escapeHTML(c.name)}">`).join("")
      : "";
    groups.push(`<span class="side elaria-side-${side}"><b>${sideLabel(side)}</b> ${faces}`
      + `${showFaces && left.length ? "" : `<em>${game.i18n.format("ELARIA.Turn.left", { n: left.length })}</em>`}</span>`);
  }
  strip.innerHTML = `<span class="title">${L("ELARIA.Turn.stillToAct")}</span>${groups.join("")}`;
  list.before(strip);
}
