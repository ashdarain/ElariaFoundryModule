import { ElariaReactDialog } from "../apps/react-dialog.mjs";

/**
 * "React" button at the bottom left of the hotbar. Opens the React window for the selected token
 * (or the player's character). Kept attached across hotbar re-renders.
 */
let button = null;
let observer = null;

function build() {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "elaria-react-button";
  el.dataset.tooltip = game.i18n.localize("ELARIA.React.buttonHint");
  el.innerHTML = `<i class="fa-solid fa-shield-halved"></i><span>${game.i18n.localize("ELARIA.React.button")}</span>`;
  el.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    ElariaReactDialog.open();
  });
  return el;
}

export function placeReactButton() {
  const hotbar = document.getElementById("hotbar");
  if (!hotbar) return;
  button ??= build();
  if (button.parentElement !== hotbar || hotbar.firstElementChild !== button) hotbar.prepend(button);
}

export function initReactButton() {
  placeReactButton();
  observer ??= new MutationObserver(() => {
    const hotbar = document.getElementById("hotbar");
    if (hotbar && hotbar.firstElementChild !== button) requestAnimationFrame(placeReactButton);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
