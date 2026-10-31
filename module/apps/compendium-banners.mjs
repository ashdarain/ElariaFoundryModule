import { PACKS, MASTERY_PACKS, GEAR_PACKS } from "../importer/build.mjs";

/**
 * Compendium sidebar banners for the imported packs, using Foundry's own banner art:
 * every mastery compendium gets the journal banner (books and scrolls), every gear compendium the item banner.
 */
export function packBanner(packKey) {
  if (MASTERY_PACKS.includes(packKey)) return CONFIG.JournalEntry?.compendiumBanner ?? null;
  if (GEAR_PACKS.includes(packKey)) return CONFIG.Item?.compendiumBanner ?? null;
  return null;
}

const bannerByCollection = () => Object.fromEntries(Object.entries(PACKS)
  .map(([key, meta]) => [`world.${meta.name}`, packBanner(key)]).filter(([, b]) => b));

/** On ready: set the banner on the packs themselves, so every view of them uses it. */
export function applyPackBanners() {
  for (const [id, banner] of Object.entries(bannerByCollection())) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    try {
      pack.metadata.banner = banner;
    } catch (err) { /* metadata may be read-only; the sidebar patch below still applies */ }
  }
}

/** renderCompendiumDirectory: make sure the sidebar shows the right banner even if the pack metadata didn't take. */
export function patchBannersInSidebar(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const [id, banner] of Object.entries(bannerByCollection())) {
    const entry = root.querySelector(`[data-pack="${id}"]`) ?? root.querySelector(`[data-entry-id="${id}"]`);
    if (!entry) continue;
    const img = entry.querySelector("img.compendium-banner, .compendium-banner img, img.banner, img");
    if (img) img.src = banner;
    else entry.style.backgroundImage = `url("${banner}")`;
  }
}
