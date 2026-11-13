import { DEFAULT_BURSTS } from "../data/bursts-defaults.mjs";

/** The pre-made bursts: the imported list, or the built-in copy if the GM hasn't imported one. */
export function burstList() {
  try {
    const data = game.settings.get("elaria", "bursts");
    if (Array.isArray(data?.bursts) && data.bursts.length) return data.bursts;
  } catch { /* setting not registered yet */ }
  return DEFAULT_BURSTS;
}

/** "Meta Mage (Time)" / "War Priest" / "Minstrel(Bard)" → "metamage" / "warpriest" / "minstrel", for matching. */
const key = s => String(s ?? "").replace(/\(.*?\)/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Is this burst from one of the character's disciplines or elements? */
export function burstIsOwn(burst, actor) {
  const sys = actor?.system ?? {};
  const mine = new Set([...(sys.disciplineList ?? []), ...(sys.elementList ?? [])].map(key).filter(k => k));
  return mine.has(key(burst.source));
}

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Ask which pre-made burst to use. The character's own disciplines / elements are listed first.
 * @returns {Promise<{name:string, text:string}|"clear"|null>}
 */
export async function chooseBurst(actor) {
  const L = k => game.i18n.localize(k);
  const all = burstList().map((b, i) => ({ ...b, i, own: burstIsOwn(b, actor) }));
  all.sort((a, b) => (b.own - a.own) || a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  const current = actor.system.identity.burstName;
  // Plain rows (no radio buttons, which core styles in ways that broke the layout): click one to select it.
  const rows = all.map(b => `
    <div class="burst-choice ${b.own ? "own" : ""} ${b.name === current ? "selected" : ""}" data-index="${b.i}" tabindex="0"
      data-search="${esc(`${b.source} ${b.name} ${b.text}`.toLowerCase())}">
      <div class="head"><b>${esc(b.name)}</b> <span class="source">${esc(b.source)}${b.own ? ` · ${L("ELARIA.Burst.yours")}` : ""}</span></div>
      <div class="text">${esc(b.text)}</div>
    </div>`).join("");
  const selected = all.find(b => b.name === current);
  const content = `
    <input type="hidden" name="burst" value="${selected ? selected.i : ""}">
    <input type="search" class="burst-search" placeholder="${esc(L("ELARIA.Burst.search"))}">
    <div class="burst-choices">${rows || `<p class="hint">${L("ELARIA.Burst.noneListed")}</p>`}</div>
    <p class="hint">${L("ELARIA.Burst.chooseHint")}</p>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("ELARIA.Burst.chooseTitle", { name: actor.name }), icon: "fa-solid fa-burst" },
    classes: ["elaria", "burst-dialog"],
    position: { width: 560 },
    content,
    buttons: [
      { action: "pick", label: L("ELARIA.Burst.use"), icon: "fa-solid fa-check", default: true,
        callback: (event, button) => button.form.elements.burst?.value ?? "" },
      { action: "clear", label: L("ELARIA.Burst.clear"), icon: "fa-solid fa-eraser" }
    ],
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      const list = root.querySelector(".burst-choices");
      const hidden = root.querySelector("input[name=burst]");
      const select = el => {
        for (const other of list.querySelectorAll(".burst-choice")) other.classList.toggle("selected", other === el);
        hidden.value = el.dataset.index;
      };
      for (const el of list.querySelectorAll(".burst-choice")) {
        el.addEventListener("click", () => select(el));
        el.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(el); } });
      }
      const search = root.querySelector(".burst-search");
      search?.addEventListener("input", () => {
        const words = search.value.toLowerCase().split(/\s+/).filter(w => w);
        for (const el of list.querySelectorAll(".burst-choice")) el.hidden = !words.every(w => el.dataset.search.includes(w));
      });
      list.scrollTop = 0;
    },
    rejectClose: false
  });
  if (result === "clear") return "clear";
  if (result === null || result === undefined || result === "" || result === "pick") return null;
  const picked = burstList()[Number(result)];
  return picked ? { name: picked.name, text: picked.text } : null;
}
