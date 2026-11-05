import { ElariaMonsterImporter } from "./monster-importer.mjs";
import { ElariaMonsterBrowser } from "./monster-browser.mjs";

/** renderActorDirectory: "Import monsters" and "Monsters" (search) buttons for the GM, at the top of the Actors tab. */
export function addBestiaryButtons(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".elaria-bestiary-buttons")) return;
  const target = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
  if (!target) return;
  const L = k => game.i18n.localize(k);
  const row = document.createElement("div");
  row.className = "elaria-browse-buttons elaria-bestiary-buttons";
  row.innerHTML = `
    <button type="button" data-bestiary="browse"><i class="fa-solid fa-dragon"></i> ${L("ELARIA.Bestiary.browseShort")}</button>
    <button type="button" data-bestiary="import"><i class="fa-solid fa-file-import"></i> ${L("ELARIA.Bestiary.importShort")}</button>`;
  row.addEventListener("click", ev => {
    const button = ev.target.closest("[data-bestiary]");
    if (!button) return;
    ev.preventDefault();
    if (button.dataset.bestiary === "browse") ElariaMonsterBrowser.open();
    else (foundry.applications.instances.get("elaria-monster-importer") ?? new ElariaMonsterImporter()).render({ force: true });
  });
  target.prepend(row);
}
