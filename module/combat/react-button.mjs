import { ElariaReactionPicker } from "../apps/reaction-picker.mjs";
import { ElariaGMTools } from "../apps/gm-tools.mjs";

/**
 * "React" button at the bottom left of the hotbar. Lists the selected token's (or the player's character's)
 * reactions plus a General Reaction; picking one opens the React window. Kept attached across hotbar re-renders.
 */
let button = null;
let gmButton = null;
let observer = null;

/** "GM Tools", left of React, GM only. */
function buildGM() {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "elaria-react-button elaria-gm-button";
  el.dataset.tooltip = game.i18n.localize("ELARIA.GMTools.buttonHint");
  el.innerHTML = `<i class="fa-solid fa-crown"></i><span>${game.i18n.localize("ELARIA.GMTools.button")}</span>`;
  el.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    ElariaGMTools.open();
  });
  return el;
}

/** Are the buttons first in the hotbar, in order (GM Tools, React)? */
function inPlace(hotbar) {
  if (game.user.isGM) return hotbar.firstElementChild === gmButton && gmButton.nextElementSibling === button;
  return hotbar.firstElementChild === button;
}

function build() {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "elaria-react-button";
  el.dataset.tooltip = game.i18n.localize("ELARIA.React.buttonHint");
  el.innerHTML = `<i class="fa-solid fa-shield-halved"></i><span>${game.i18n.localize("ELARIA.React.button")}</span>`;
  el.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    ElariaReactionPicker.open();
  });
  return el;
}

export function placeReactButton() {
  const hotbar = document.getElementById("hotbar");
  if (!hotbar) return;
  button ??= build();
  if (game.user.isGM) gmButton ??= buildGM();
  if (!inPlace(hotbar)) hotbar.prepend(...(game.user.isGM ? [gmButton, button] : [button]));
}

export function initReactButton() {
  placeReactButton();
  observer ??= new MutationObserver(() => {
    const hotbar = document.getElementById("hotbar");
    if (hotbar && button && !inPlace(hotbar)) requestAnimationFrame(placeReactButton);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
