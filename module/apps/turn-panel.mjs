import {
  windowsEnabled, windowState, sideOf, hasActed, flagsOf, pickChoices, canPickFor, request, promptDelay, SIDES
} from "../combat/turn-order.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = k => game.i18n.localize(k);
const sideLabel = side => L(`ELARIA.Turn.side.${side}`);

/**
 * The Turn panel (button beside React on the hotbar; opens by itself when it's your turn). Shows the window
 * that's open and who's acting, End turn / Delay for the acting unit, and for each of your sides who acts in its
 * next window: the one who picks clicks a portrait, everyone else sees the pick. GMs see every side, can make
 * someone else act in the current window, and can mark units as acted / not acted.
 */
export class ElariaTurnPanel extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "elaria-turn-panel",
    classes: ["elaria", "turn-panel"],
    position: { width: 310, height: "auto" },
    window: { title: "ELARIA.Turn.panelTitle", icon: "fa-solid fa-hourglass-half", resizable: false },
    actions: {
      endTurn: ElariaTurnPanel.#onEndTurn,
      delay: ElariaTurnPanel.#onDelay,
      pick: ElariaTurnPanel.#onPick,
      actNow: ElariaTurnPanel.#onActNow,
      toggleActed: ElariaTurnPanel.#onToggleActed
    }
  };

  static PARTS = {
    body: { template: "systems/elaria/templates/apps/turn-panel.hbs" }
  };

  static get instance() {
    return foundry.applications.instances.get("elaria-turn-panel");
  }

  static open() {
    // First time: bottom left, above the hotbar.
    const app = this.instance ?? new this({ position: { left: 115, top: Math.max(60, window.innerHeight - 560) } });
    return app.render({ force: true });
  }

  /** Re-render if open (combat changes). */
  static refresh() {
    const app = this.instance;
    if (app?.rendered) app.render();
  }

  async _prepareContext() {
    const combat = game.combat;
    if (!windowsEnabled()) return { message: L("ELARIA.Turn.off") };
    if (!combat?.started) return { message: L("ELARIA.Turn.noCombat") };
    const gm = game.user.isGM;
    const state = windowState(combat);
    const current = combat.combatant;
    const curSide = current ? sideOf(current) : "";
    const seeCurrent = current && (gm || !current.hidden);
    const by = combat.combatants.get(state.pickedBy);
    const canEnd = !!current && (gm || current.isOwner);
    const unit = c => ({ id: c.id, name: c.name, img: c.img, acted: hasActed(combat, c), defeated: c.isDefeated,
      reserved: flagsOf(c).reserved === combat.round, noWindow: !Number.isFinite(c.initiative) });

    const mine = c => c.actor?.testUserPermission(game.user, "OWNER");
    const sides = SIDES.filter(s => combat.combatants.some(c => sideOf(c) === s && !c.isDefeated
      && (gm || (s === "pc" && mine(c)))));
    const sideData = sides.map(side => {
      const { window: w, choices } = pickChoices(combat, side);
      const picker = combat.combatants.get(state.picker[side]);
      const planned = combat.combatants.get(state.next[side]);
      const canPick = canPickFor(combat, side);
      return {
        key: side, label: sideLabel(side), window: w, canPick,
        pickerName: picker && !picker.isDefeated ? picker.name : "",
        plannedName: planned?.name ?? "",
        choices: choices.map(t => combat.combatants.get(t.id)).filter(c => c)
          .map(c => ({ ...unit(c), selected: c.id === planned?.id })),
        members: gm ? combat.turns.filter(c => sideOf(c) === side).map(unit) : []
      };
    });

    const actNow = gm && current
      ? combat.turns.filter(c => c.id !== current.id && sideOf(c) === curSide && !c.isDefeated
        && Number.isFinite(c.initiative) && !hasActed(combat, c)).map(unit)
      : [];
    return {
      active: true, gm, round: combat.round,
      current: seeCurrent ? {
        name: current.name, img: current.img, side: curSide, initiative: current.initiative,
        windowLabel: `${sideLabel(curSide)} ${L("ELARIA.Turn.window")}`, mine: current.isOwner && !gm,
        pickedBy: by && by.id !== current.id ? by.name : ""
      } : null,
      canEnd, canDelay: canEnd && combat.turns.slice(combat.turn + 1).some(c => Number.isFinite(c.initiative) && !c.isDefeated),
      actNow, sides: sideData
    };
  }

  static #onEndTurn() {
    return game.combat?.nextTurn();
  }

  static #onDelay() {
    return promptDelay(game.combat);
  }

  static #onPick(event, target) {
    const combat = game.combat;
    const { side, id } = target.dataset;
    const already = windowState(combat).next[side] === id;
    return request("setNext", combat, { side, pickId: already ? "" : id });
  }

  static #onActNow(event, target) {
    return request("actNow", game.combat, { id: target.dataset.id });
  }

  static #onToggleActed(event, target) {
    return request("toggleActed", game.combat, { id: target.dataset.id });
  }
}

/** updateCombat: a new window opened (flags.elaria.windowKey changed): tell whoever acts, and open their panel. */
export function onWindowOpened(combat, changed) {
  ElariaTurnPanel.refresh();
  if (!windowsEnabled() || !combat.started) return;
  const key = foundry.utils.getProperty(changed, "flags.elaria.windowKey");
  if (key === undefined) return;
  const current = combat.combatant;
  const first = (combat.round === 1) && !(flagsOf(combat).history ?? []).length;
  if (current?.isOwner && !game.user.isGM) {
    const by = combat.combatants.get(windowState(combat).pickedBy);
    ui.notifications.info(by && by.id !== current.id
      ? game.i18n.format("ELARIA.Turn.yourTurnBy", { name: current.name, by: by.name })
      : game.i18n.format("ELARIA.Turn.yourTurn", { name: current.name }));
    const src = CONFIG.sounds?.notification;
    if (src) foundry.audio.AudioHelper.play({ src, volume: 0.8, autoplay: true, loop: false }, false);
    ElariaTurnPanel.open();
  } else if (first && (game.user.isGM || combat.combatants.some(c => c.isOwner))) {
    ElariaTurnPanel.open();
  }
}
