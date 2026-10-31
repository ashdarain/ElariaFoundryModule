import { ElariaMasteryPicker } from "./mastery-picker.mjs";
import { defaultRollActor } from "../dice/check.mjs";

/**
 * "Browse masteries" and "Browse gear" buttons at the top of the Compendium sidebar. They open the same search
 * window as Add mastery / Add item. With a token selected (or an assigned character) its + buttons add to that
 * character; otherwise it just browses, and rows can be dragged onto any sheet or the hotbar.
 */
export function addCompendiumBrowseButtons(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".elaria-browse-buttons")) return;
  const target = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
  if (!target) return;
  const L = k => game.i18n.localize(k);
  const row = document.createElement("div");
  row.className = "elaria-browse-buttons";
  row.innerHTML = `
    <button type="button" data-browse="mastery"><i class="fa-solid fa-book-open"></i> ${L("ELARIA.Picker.browseMasteriesShort")}</button>
    <button type="button" data-browse="gear"><i class="fa-solid fa-shield-halved"></i> ${L("ELARIA.Picker.browseGearShort")}</button>`;
  row.addEventListener("click", ev => {
    const button = ev.target.closest("[data-browse]");
    if (!button) return;
    ev.preventDefault();
    const actor = defaultRollActor();
    ElariaMasteryPicker.open(actor?.isOwner ? actor : null, button.dataset.browse);
  });
  target.prepend(row);
}
