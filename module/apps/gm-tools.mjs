import { ELARIA } from "../config.mjs";
import { addGearToActor, addMasteriesToActor } from "../helpers/masteries.mjs";
import { materialLabel } from "../helpers/crafting.mjs";
import { ElariaMasteryPicker } from "./mastery-picker.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = k => game.i18n.localize(k);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const SETTING = "gmTools";
const blankMaterials = () => Object.fromEntries(Object.keys(ELARIA.materials)
  .map(k => [k, Object.fromEntries(ELARIA.materialTiers.map(t => [`t${t}`, 0]))]));
const blankCoins = () => Object.fromEntries(Object.keys(ELARIA.coins).map(k => [k, 0]));

/**
 * GM Tools (button left of React, GM only).
 *
 * Players: add player characters, then line up what each one gets: masteries and gear (picked from the
 * compendiums or dragged onto their card), materials and coins. Nothing changes until **Give** (one character)
 * or **Give to everyone**. What's lined up is kept (world setting) until given or removed.
 *
 * Party: level up, long rest (full HP / MP / FTG, +1 life point, −1 exhaustion, −1 injury), add exhaustion or
 * injuries, take life points; for the whole party (every character a player owns) or the ticked players above.
 */
export class ElariaGMTools extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "elaria-gm-tools",
    classes: ["elaria", "gm-tools"],
    position: { width: 820, height: 760 },
    window: { title: "ELARIA.GMTools.title", icon: "fa-solid fa-crown", resizable: true },
    actions: {
      addPlayer: ElariaGMTools.#onAddPlayer,
      addParty: ElariaGMTools.#onAddParty,
      removePlayer: ElariaGMTools.#onRemovePlayer,
      openSheet: ElariaGMTools.#onOpenSheet,
      pickItems: ElariaGMTools.#onPickItems,
      addMaterials: ElariaGMTools.#onAddMaterials,
      addCoins: ElariaGMTools.#onAddCoins,
      removePending: ElariaGMTools.#onRemovePending,
      clearPending: ElariaGMTools.#onClearPending,
      give: ElariaGMTools.#onGive,
      giveAll: ElariaGMTools.#onGiveAll,
      party: ElariaGMTools.#onParty
    }
  };

  static PARTS = {
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    players: { template: "systems/elaria/templates/apps/gm-tools.hbs", scrollable: [".gm-players", ".party-table-wrap"] }
  };

  static TABS = {
    primary: { tabs: [{ id: "players", icon: "fa-solid fa-users" }], initial: "players", labelPrefix: "ELARIA.GMTools.tab" }
  };

  static registerSettings() {
    game.settings.register("elaria", SETTING, { scope: "world", config: false, type: Object, default: { players: [] } });
  }

  static open() {
    if (!game.user.isGM) return;
    const app = foundry.applications.instances.get("elaria-gm-tools") ?? new this();
    return app.render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Stored state                                */
  /* -------------------------------------------- */

  #state = null;

  get state() {
    this.#state ??= foundry.utils.deepClone(game.settings.get("elaria", SETTING) ?? { players: [] });
    this.#state.players ??= [];
    return this.#state;
  }

  async #save() {
    await game.settings.set("elaria", SETTING, this.state);
    return this.render();
  }

  #entry(uuid) {
    return this.state.players.find(p => p.actorUuid === uuid);
  }

  #addPlayer(actor) {
    if (!actor || actor.type !== "character") return false;
    if (this.#entry(actor.uuid)) return false;
    this.state.players.push({ actorUuid: actor.uuid, selected: true, items: [], materials: blankMaterials(), coins: blankCoins() });
    return true;
  }

  /** Characters a player owns: the party. */
  static partyActors() {
    return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tabs = this._prepareTabs("primary");
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId !== "players") return context;
    context.tab = context.tabs.players;
    const added = new Set(this.state.players.map(p => p.actorUuid));
    const owners = a => game.users.filter(u => !u.isGM && a.testUserPermission(u, "OWNER"));
    // Characters with an active owner first.
    context.candidates = game.actors.filter(a => a.type === "character" && !added.has(a.uuid))
      .map(a => ({ uuid: a.uuid, name: a.name, active: owners(a).some(u => u.active), owner: owners(a).map(u => u.name).join(", ") }))
      .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name))
      .map(c => ({ ...c, label: `${c.name}${c.owner ? ` (${c.owner}${c.active ? ", online" : ""})` : ""}` }));
    context.players = this.state.players.map(p => {
      const actor = fromUuidSync(p.actorUuid);
      if (!actor) return null;
      const mats = [];
      for (const [key, tiers] of Object.entries(p.materials ?? {})) {
        for (const [t, n] of Object.entries(tiers)) if (n) mats.push({ key, tier: t, label: `${n} ${materialLabel(key)} ${t.toUpperCase()}` });
      }
      const coins = Object.entries(p.coins ?? {}).filter(([, n]) => n)
        .map(([k, n]) => ({ key: k, label: `${n} ${L(ELARIA.coins[k])}` }));
      const sys = actor.system;
      return {
        uuid: p.actorUuid, name: actor.name, img: actor.img, selected: p.selected !== false,
        owner: owners(actor).map(u => u.name).join(", "),
        stats: `${L("ELARIA.Level")} ${sys.level} · HP ${sys.resources.hp.value}/${sys.resources.hp.max}`,
        items: p.items, mats, coins,
        empty: !p.items.length && !mats.length && !coins.length
      };
    }).filter(Boolean);
    context.anyPending = context.players.some(p => !p.empty);
    const party = ElariaGMTools.partyActors();
    context.party = party.map(a => {
      const s = a.system;
      return { uuid: a.uuid, name: a.name, img: a.img, level: s.level,
        hp: `${s.resources.hp.value}/${s.resources.hp.max}`,
        lp: `${s.resources.lifePoints.value}/${s.resources.lifePoints.max}`,
        exhaustion: s.conditions.exhaustion, injuries: s.conditions.injuries, picked: added.has(a.uuid) && this.#entry(a.uuid)?.selected !== false };
    });
    context.partyTarget = this._partyTarget ?? "all";
    context.amount = this._amount ?? 1;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    // Ticks on the player cards (who the party actions apply to when not the whole party).
    for (const box of el.querySelectorAll("input[name=selected]")) {
      box.addEventListener("change", () => {
        const entry = this.#entry(box.closest("[data-actor]").dataset.actor);
        if (entry) { entry.selected = box.checked; this.#save(); }
      });
    }
    for (const radio of el.querySelectorAll("input[name=partyTarget]")) {
      radio.addEventListener("change", () => { this._partyTarget = radio.value; this.render(); });
    }
    el.querySelector("input[name=amount]")?.addEventListener("change", ev => {
      this._amount = Math.max(1, Math.round(Number(ev.target.value) || 1));
    });
    // Drops: an actor anywhere in the players area adds it; an item (or folder of items) on a card lines it up.
    const zone = el.querySelector(".gm-players-zone");
    zone?.addEventListener("dragover", ev => ev.preventDefault());
    zone?.addEventListener("drop", ev => this.#onDrop(ev));
  }

  async #onDrop(event) {
    event.preventDefault();
    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type === "Actor") {
      const actor = await fromUuid(data.uuid);
      if (this.#addPlayer(actor)) return this.#save();
      return;
    }
    const card = event.target.closest("[data-actor]");
    if (!card) return ui.notifications.warn(L("ELARIA.GMTools.dropOnCard"));
    const entry = this.#entry(card.dataset.actor);
    if (data?.type === "Item") {
      const item = await fromUuid(data.uuid);
      if (this.#queueItem(entry, item)) return this.#save();
    } else if (data?.type === "Folder") {
      const folder = await fromUuid(data.uuid);
      const items = folder?.contents ?? [];
      let n = 0;
      for (const it of items) if (this.#queueItem(entry, it)) n++;
      if (n) return this.#save();
    }
  }

  #queueItem(entry, item) {
    if (!entry || !item || !["mastery", "gear"].includes(item.type)) return false;
    entry.items.push({ uuid: item.uuid, name: item.name, img: item.img, type: item.type });
    return true;
  }

  /* -------------------------------------------- */
  /*  Players                                     */
  /* -------------------------------------------- */

  static async #onAddPlayer() {
    const uuid = this.element.querySelector("select[name=newPlayer]")?.value;
    if (!uuid) return;
    if (this.#addPlayer(await fromUuid(uuid))) return this.#save();
  }

  static async #onAddParty() {
    let n = 0;
    for (const a of ElariaGMTools.partyActors()) if (this.#addPlayer(a)) n++;
    if (n) return this.#save();
    ui.notifications.info(L("ELARIA.GMTools.partyAlreadyAdded"));
  }

  static #onRemovePlayer(event, target) {
    const uuid = target.closest("[data-actor]").dataset.actor;
    this.state.players = this.state.players.filter(p => p.actorUuid !== uuid);
    return this.#save();
  }

  static async #onOpenSheet(event, target) {
    (await fromUuid(target.closest("[data-actor]").dataset.actor))?.sheet.render({ force: true });
  }

  /** Mastery / gear search window; its + buttons line items up for this character. */
  static async #onPickItems(event, target) {
    const uuid = target.closest("[data-actor]").dataset.actor;
    const actor = await fromUuid(uuid);
    ElariaMasteryPicker.open(null, target.dataset.kind, {
      forName: actor?.name ?? "",
      onPick: async item => {
        if (this.#queueItem(this.#entry(uuid), item)) await this.#save();
      }
    });
  }

  /** Materials pop-up: a count per material and tier, added to what's lined up. */
  static async #onAddMaterials(event, target) {
    const entry = this.#entry(target.closest("[data-actor]").dataset.actor);
    const actor = await fromUuid(entry.actorUuid);
    const head = ELARIA.materialTiers.map(t => `<th>${esc(game.i18n.format("ELARIA.Craft.tierShort", { n: t }))}</th>`).join("");
    const rows = Object.keys(ELARIA.materials).map(k => `<tr><td class="label">${esc(materialLabel(k))}</td>${ELARIA.materialTiers
      .map(t => `<td><input type="number" name="${k}.t${t}" value="0" min="0" step="1"></td>`).join("")}</tr>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("ELARIA.GMTools.materialsFor", { name: actor?.name ?? "" }), icon: "fa-solid fa-cubes" },
      classes: ["elaria", "gm-grant-dialog"],
      position: { width: 460 },
      content: `<table class="materials-table"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`,
      buttons: [
        { action: "ok", label: L("ELARIA.GMTools.lineUp"), icon: "fa-solid fa-plus", default: true,
          callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
        { action: "cancel", label: L("ELARIA.Damage.cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if (!result || typeof result !== "object") return;
    for (const [path, value] of Object.entries(foundry.utils.flattenObject(result))) {
      const n = Math.max(0, Math.round(Number(value) || 0));
      if (!n) continue;
      const cur = foundry.utils.getProperty(entry.materials, path) ?? 0;
      foundry.utils.setProperty(entry.materials, path, cur + n);
    }
    return this.#save();
  }

  /** Coins pop-up. */
  static async #onAddCoins(event, target) {
    const entry = this.#entry(target.closest("[data-actor]").dataset.actor);
    const actor = await fromUuid(entry.actorUuid);
    const inputs = Object.entries(ELARIA.coins).map(([k, label]) => `<label class="coin ${k}"><span>${esc(L(label))}</span>
      <input type="number" name="${k}" value="0" min="0" step="1"></label>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("ELARIA.GMTools.coinsFor", { name: actor?.name ?? "" }), icon: "fa-solid fa-coins" },
      classes: ["elaria", "gm-grant-dialog"],
      content: `<div class="coins">${inputs}</div>`,
      buttons: [
        { action: "ok", label: L("ELARIA.GMTools.lineUp"), icon: "fa-solid fa-plus", default: true,
          callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
        { action: "cancel", label: L("ELARIA.Damage.cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if (!result || typeof result !== "object") return;
    for (const k of Object.keys(ELARIA.coins)) entry.coins[k] = (entry.coins[k] ?? 0) + Math.max(0, Math.round(Number(result[k]) || 0));
    return this.#save();
  }

  static #onRemovePending(event, target) {
    const entry = this.#entry(target.closest("[data-actor]").dataset.actor);
    const { kind, index, key, tier } = target.dataset;
    if (kind === "item") entry.items.splice(Number(index), 1);
    if (kind === "material") entry.materials[key][tier] = 0;
    if (kind === "coin") entry.coins[key] = 0;
    return this.#save();
  }

  static #onClearPending(event, target) {
    const entry = this.#entry(target.closest("[data-actor]").dataset.actor);
    Object.assign(entry, { items: [], materials: blankMaterials(), coins: blankCoins() });
    return this.#save();
  }

  /** Hand over everything lined up for one character, and post what they got. */
  async #give(entry) {
    const actor = await fromUuid(entry.actorUuid);
    if (!actor) return false;
    const got = [];
    const items = (await Promise.all(entry.items.map(i => fromUuid(i.uuid)))).filter(Boolean);
    const masteries = await addMasteriesToActor(actor, items.filter(i => i.type === "mastery"));
    const gear = await addGearToActor(actor, items.filter(i => i.type === "gear"));
    got.push(...[...(masteries ?? []), ...(gear ?? [])].map(i => i.name));
    const update = {};
    for (const [key, tiers] of Object.entries(entry.materials)) {
      for (const [t, n] of Object.entries(tiers)) {
        if (!n) continue;
        update[`system.materials.${key}.${t}`] = (actor.system.materials?.[key]?.[t] ?? 0) + n;
        got.push(`${n} ${materialLabel(key)} (${t.toUpperCase()})`);
      }
    }
    for (const [k, n] of Object.entries(entry.coins)) {
      if (!n) continue;
      update[`system.coins.${k}`] = (actor.system.coins?.[k] ?? 0) + n;
      got.push(`${n} ${L(ELARIA.coins[k])}`);
    }
    if (Object.keys(update).length) await actor.update(update);
    Object.assign(entry, { items: [], materials: blankMaterials(), coins: blankCoins() });
    if (got.length) {
      await ChatMessage.create({
        speaker: { alias: L("ELARIA.GMTools.gm") },
        content: `<div class="elaria chat-card gm-grant"><header><img src="${esc(actor.img)}" alt="">
          <h3>${esc(game.i18n.format("ELARIA.GMTools.receivedCard", { name: actor.name }))}</h3></header>
          <ul>${got.map(g => `<li>${esc(g)}</li>`).join("")}</ul></div>`
      });
    }
    return true;
  }

  static async #onGive(event, target) {
    const entry = this.#entry(target.closest("[data-actor]").dataset.actor);
    target.disabled = true;
    await this.#give(entry);
    return this.#save();
  }

  static async #onGiveAll(event, target) {
    target.disabled = true;
    for (const entry of this.state.players) {
      const empty = !entry.items.length && !Object.values(entry.coins).some(n => n)
        && !Object.values(entry.materials).some(t => Object.values(t).some(n => n));
      if (!empty) await this.#give(entry);
    }
    return this.#save();
  }

  /* -------------------------------------------- */
  /*  Party                                       */
  /* -------------------------------------------- */

  /** The whole party, or the ticked player cards. */
  async #targets() {
    if ((this._partyTarget ?? "all") === "all") return ElariaGMTools.partyActors();
    const picked = this.state.players.filter(p => p.selected !== false);
    return (await Promise.all(picked.map(p => fromUuid(p.actorUuid)))).filter(a => a?.type === "character");
  }

  static async #onParty(event, target) {
    const action = target.dataset.party;
    const n = Math.max(1, Math.round(Number(this.element.querySelector("input[name=amount]")?.value) || 1));
    this._amount = n;
    const actors = await this.#targets();
    if (!actors.length) return ui.notifications.warn(L("ELARIA.GMTools.noTargets"));
    const lines = [];
    for (const a of actors) {
      const s = a.system;
      const res = s.resources, con = s.conditions;
      switch (action) {
        case "levelUp": {
          const to = Math.min(20, s.level + n);
          await a.update({ "system.level": to });
          lines.push(game.i18n.format("ELARIA.GMTools.line.level", { name: a.name, n: to }));
          break;
        }
        case "longRest": {
          // Full HP / MP / FTG (temp cleared), +1 life point, −1 exhaustion, −1 injury.
          const update = {};
          for (const k of ["hp", "mp", "ftg"]) {
            update[`system.resources.${k}.value`] = res[k].max;
            update[`system.resources.${k}.temp`] = 0;
          }
          update["system.resources.lifePoints.value"] = Math.min(res.lifePoints.max, res.lifePoints.value + 1);
          update["system.conditions.exhaustion"] = Math.max(0, con.exhaustion - 1);
          update["system.conditions.injuries"] = Math.max(0, con.injuries - 1);
          await a.update(update);
          lines.push(a.name);
          break;
        }
        case "exhaustion": {
          const to = Math.min(ELARIA.maxExhaustion, con.exhaustion + n);
          await a.update({ "system.conditions.exhaustion": to });
          lines.push(game.i18n.format("ELARIA.GMTools.line.exhaustion", { name: a.name, n: to }));
          break;
        }
        case "injury": {
          const to = con.injuries + n;
          await a.update({ "system.conditions.injuries": to });
          lines.push(game.i18n.format("ELARIA.GMTools.line.injuries", { name: a.name, n: to }));
          break;
        }
        case "lifePoint": {
          const to = Math.max(0, res.lifePoints.value - n);
          await a.update({ "system.resources.lifePoints.value": to });
          lines.push(game.i18n.format("ELARIA.GMTools.line.lifePoints", { name: a.name, n: to, max: res.lifePoints.max }));
          break;
        }
      }
    }
    await ChatMessage.create({
      speaker: { alias: L("ELARIA.GMTools.gm") },
      content: `<div class="elaria chat-card gm-party"><h3>${esc(game.i18n.format(`ELARIA.GMTools.card.${action}`, { n }))}</h3>
        <ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>`
    });
    return this.render();
  }
}

/** Re-draw the window when a party member changes (HP, level …). */
export function onActorChangeForGMTools(actor) {
  if (actor.type !== "character") return;
  const app = foundry.applications.instances.get("elaria-gm-tools");
  if (app?.rendered) app.render();
}
