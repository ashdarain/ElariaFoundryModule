const L = k => game.i18n.localize(k);
const esc = s => foundry.utils.escapeHTML(String(s));

/**
 * Skill mod cards: one row per target with its verdict. The GM presses Pass (hit) or Fail (missed) for each
 * target, as with reactions (the DC depends on the target's reaction, which players don't know). Pressing the
 * chosen one again clears it. The card's "Roll damage" button only works once at least one target is hit, and
 * the damage roll is then made for the hit targets only (so only they get Apply buttons).
 */
export function renderVerdicts(message, html) {
  const data = message.flags?.elaria?.verdict;
  const box = html?.querySelector(".skill-verdicts");
  if (!data || !box) return;
  const gm = game.user.isGM;
  box.replaceChildren();
  data.targets.forEach((t, i) => {
    const state = data.results[i];
    const row = document.createElement("div");
    row.className = `verdict-row ${state === true ? "pass" : state === false ? "fail" : "pending"}`;
    const label = state === true ? L("ELARIA.Dice.hit") : state === false ? L("ELARIA.Dice.miss") : L("ELARIA.React.pending");
    row.innerHTML = `<span class="who">${esc(t.name || L("ELARIA.Dice.target"))}</span>`
      + (gm
        ? `<button type="button" class="pass ${state === true ? "chosen" : ""}" data-result="pass"><i class="fa-solid fa-check"></i> ${L("ELARIA.React.markPass")}</button>`
          + `<button type="button" class="fail ${state === false ? "chosen" : ""}" data-result="fail"><i class="fa-solid fa-xmark"></i> ${L("ELARIA.React.markFail")}</button>`
        : `<span class="state">${esc(label)}</span>`);
    for (const button of row.querySelectorAll("button")) {
      button.addEventListener("click", ev => {
        ev.preventDefault();
        const want = button.dataset.result === "pass";
        const results = [...data.results];
        results[i] = results[i] === want ? null : want;
        message.update({ "flags.elaria.verdict.results": results });
      });
    }
    box.append(row);
  });

  // The damage button waits for at least one hit.
  const next = html.querySelector("[data-elaria-action=next]");
  if (next) {
    const hits = data.results.filter(r => r === true).length;
    const decided = data.results.every(r => r !== null);
    if (!hits) {
      next.disabled = true;
      next.classList.add("waiting");
      next.dataset.tooltip = L(decided ? "ELARIA.Dice.allMissed" : "ELARIA.Dice.waitForHit");
    } else if (data.targets.length > 1) {
      next.querySelector("span.hit-count")?.remove();
      next.insertAdjacentHTML("beforeend", ` <span class="hit-count">(${game.i18n.format("ELARIA.Dice.hitTargets", { n: hits })})</span>`);
    }
  }
}

/** The targets marked hit on a skill card ({uuid, name}), or null when the card has no verdicts. */
export function hitTargets(message) {
  const data = message.flags?.elaria?.verdict;
  if (!data) return null;
  return data.targets.filter((_, i) => data.results[i] === true);
}
