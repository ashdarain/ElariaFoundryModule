import { ElariaRollDialog } from "../apps/roll-dialog.mjs";
import { rollD20, defaultRollActor } from "./check.mjs";

/**
 * "Roll 3d6" and "Roll d20" buttons directly under the chat box.
 *
 * Foundry moves the chat input around: it sits at the bottom of the screen while the sidebar is collapsed and
 * inside the chat tab while it's open, and it can be re-rendered. So there is one button bar, and whenever the
 * interface changes we put it back right after the chat input, wherever that is now.
 */

let bar = null;
let observer = null;
let queued = false;

function buildBar() {
  const L = k => game.i18n.localize(k);
  const el = document.createElement("div");
  el.className = "elaria-dice-bar";
  el.innerHTML = `
    <button type="button" data-elaria-roll="3d6"><i class="fa-solid fa-dice"></i> ${L("ELARIA.Dice.roll3d6")}</button>
    <button type="button" data-elaria-roll="d20"><i class="fa-solid fa-dice-d20"></i> ${L("ELARIA.Dice.rollD20")}</button>`;
  el.addEventListener("click", ev => {
    const button = ev.target.closest("[data-elaria-roll]");
    if (!button) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (button.dataset.elariaRoll === "3d6") ElariaRollDialog.open();
    else rollD20({ actor: defaultRollActor() });
  });
  return el;
}

/** Put the bar right after the visible chat input. */
export function placeChatDiceButtons() {
  queued = false;
  const input = document.getElementById("chat-message");
  if (!input) return;
  bar ??= buildBar();
  if (bar.previousElementSibling !== input) input.insertAdjacentElement("afterend", bar);
  // Remove copies left by an older version or a re-render.
  for (const old of document.querySelectorAll(".elaria-dice-bar")) if (old !== bar) old.remove();
}

/** Start following the chat input. Called once on ready. */
export function initChatDiceButtons() {
  placeChatDiceButtons();
  // The input is moved by Foundry when the sidebar opens or closes; any DOM change re-checks (cheaply, once per frame).
  observer ??= new MutationObserver(() => {
    if (queued) return;
    const input = document.getElementById("chat-message");
    if (input && bar?.previousElementSibling === input) return;
    queued = true;
    requestAnimationFrame(placeChatDiceButtons);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
