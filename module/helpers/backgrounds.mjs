/**
 * Backgrounds (the Backgrounds tab): four social-standing scales, each with a background per range of the
 * d20 social standing roll (1, 2–7, 8–13, 14–19, 20+). The importer saves the data as the world setting
 * "elaria.backgrounds".
 */

/** The imported backgrounds, or null if the GM hasn't imported them yet. */
export function backgroundData() {
  try {
    const data = game.settings.get("elaria", "backgrounds");
    return data?.scales?.length ? data : null;
  } catch {
    return null;
  }
}

/** The background for a scale id and a social standing number, or null. Below the lowest range counts as it. */
export function findBackground(scaleId, standing, data = backgroundData()) {
  const scale = data?.scales.find(s => s.id === scaleId);
  if (!scale || standing === null || standing === undefined || standing === "") return null;
  const n = Number(standing);
  if (!Number.isFinite(n)) return null;
  const tiers = scale.tiers;
  return tiers.find(t => n >= t.min && (t.max === null || n <= t.max))
    ?? (n < tiers[0]?.min ? tiers[0] : null)
    ?? null;
}

/** How far the roll may be moved (Backgrounds rules): Demeanor or Speechcraft ×2, minimum 1. */
export function standingAdjustment(actor) {
  const s = actor?.system?.stats ?? {};
  return Math.max(1, 2 * Math.max(s.dem?.mod ?? 0, s.spc?.mod ?? 0));
}
