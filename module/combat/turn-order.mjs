/**
 * Initiative with action windows (Elaria 2.2).
 *
 * Every combatant rolls initiative (3d6 + Fin) as usual, but a roll isn't that combatant's turn: it is an action
 * window for its side (the party, the enemies …). When a window opens, anyone on that side who hasn't acted yet
 * this round may act in it. The last member of a side to act picks who acts in the side's next window (in round
 * one, the side's highest roller). Everyone acts once a round, in whichever of the side's windows.
 *
 * How it is kept in Foundry: combatants stay the units, and their initiative values are the side's windows. When
 * someone fills a window, the two swap initiative, so the one acting is always the current combatant (turn
 * highlight, token pan, "your turn" all keep working) and the side keeps exactly the same windows.
 *
 * Kept on the combat (flags.elaria):            Kept on each combatant (flags.elaria):
 *   next.<side>    picked for the side's next      acted        round in which it last acted
 *                  window (combatant id)           reserved     round of a delayed window it must act in
 *                                                  out          KO'd or defeated: has no window
 *                                                  keepWindow   window restored by hand: stays while still
 *                                                               KO'd / defeated (cleared once back up)
 *                                                  tieRoll      the d6 for ties, rolled with initiative
 *   nextBy.<side>  who picked it                   order        tie-break for equal initiative (high first)
 *   picker.<side>  who picks next for the side     removeWindow (defeated) the window it chose to remove
 *   pickedBy       who picked the current actor
 *   windowKey      "round:turn:actor", changes whenever a window opens
 *   history        the last turns, for Previous turn
 *
 * Delay: the acting unit moves its window to just after a later window; the window stays there in later rounds
 * and the unit acts in it this round. Out of the fight (KO'd at 0 HP, or marked defeated): the unit's owner picks
 * one of the side's windows to remove (applied when the current turn ends). A unit that comes back rolls a new
 * window and may act this round if one of its side's windows is still to come.
 *
 * Ties: higher Finesse first, then a d6 rolled for each when initiative is rolled (higher first), then player
 * characters first. Windows moved by picks or delays keep their exact place (flags.elaria.order).
 *
 * Players can't change other combatants, so their requests go to the GM's client (socket "system.elaria").
 * The whole thing can be turned off (world setting "Action windows"), giving Foundry's normal initiative.
 */

const BaseCombat = foundry.documents?.Combat ?? globalThis.Combat;
const SOCKET = "system.elaria";
export const SETTING = "actionWindows";
export const SIDES = ["pc", "ally", "neutral", "enemy", "secret"];
const HISTORY = 30;

/* ------------------------------------------------------------------ */
/*  Pure logic (tested by tools/test-turns.mjs)                        */
/* ------------------------------------------------------------------ */

/**
 * A turn order entry: { id, side, initiative, order, acted, reserved, defeated }.
 * acted / reserved are round numbers (or null).
 */
const hasWindow = t => t.initiative !== null && t.initiative !== undefined && !t.defeated;
const canAct = (t, round) => hasWindow(t) && t.acted !== round;

/** Who acts when window j opens in this round (null: nobody on that side can). */
export function pickForWindow(turns, j, round, next = {}) {
  const w = turns[j];
  if (!w || !hasWindow(w)) return null;
  const side = w.side;
  const free = t => t.side === side && canAct(t, round) && t.reserved !== round;
  if (w.reserved === round && canAct(w, round)) return w.id;          // a delayed window: its delayer acts
  const pick = turns.find(t => t.id === next[side]);
  if (pick && free(pick)) return pick.id;                              // picked by the side's last actor
  if (free(w)) return w.id;                                            // otherwise whoever sits there
  return turns.find(free)?.id ?? null;                                 // or the first who hasn't acted
}

/**
 * The next window to open after index `from` of `round` (from = -1: the round's first window).
 * @returns {{index:number, round:number, actorId:string, skipped:{index:number, round:number, side:string}[]}|null}
 */
export function findNextWindow(turns, from, round, next = {}) {
  const skipped = [];
  for (let r = round, start = from + 1, guard = 0; guard < 3; r++, start = 0, guard++) {
    for (let j = Math.max(0, start); j < turns.length; j++) {
      if (!hasWindow(turns[j])) continue;
      const actorId = pickForWindow(turns, j, r, next);
      if (actorId) return { index: j, round: r, actorId, skipped };
      skipped.push({ index: j, round: r, side: turns[j].side });
    }
  }
  return null;
}

/** The side's next window after the current one: { index, round } (round > current: next round). */
export function nextWindowOfSide(turns, from, round, side) {
  for (let j = from + 1; j < turns.length; j++) if (hasWindow(turns[j]) && turns[j].side === side) return { index: j, round };
  const j = turns.findIndex(t => hasWindow(t) && t.side === side);
  return j < 0 ? null : { index: j, round: round + 1 };
}

/** Initiative / order keys with the tie runs holding any of `ids` numbered (high first), for exact placement. */
function keysWithTies(turns, ids) {
  const key = new Map(turns.map(t => [t.id, { initiative: t.initiative, order: Number(t.order) || 0 }]));
  for (let i = 0; i < turns.length;) {
    let j = i;
    while (j + 1 < turns.length && turns[j + 1].initiative === turns[i].initiative) j++;
    const run = turns.slice(i, j + 1);
    if (j > i && run.some(t => ids.includes(t.id))) run.forEach((t, k) => { key.get(t.id).order = run.length - k; });
    i = j + 1;
  }
  return key;
}

/** Turn the changed keys into combatant updates. */
function keyUpdates(turns, key) {
  return turns
    .filter(t => key.get(t.id).initiative !== t.initiative || key.get(t.id).order !== (Number(t.order) || 0))
    .map(t => ({ _id: t.id, initiative: key.get(t.id).initiative, "flags.elaria.order": key.get(t.id).order }));
}

/** Combatant updates that swap two places in the turn order. */
export function swapUpdates(turns, fromId, toId) {
  const key = keysWithTies(turns, [fromId, toId]);
  const a = key.get(fromId), b = key.get(toId);
  if (!a || !b) return [];
  key.set(fromId, b);
  key.set(toId, a);
  return keyUpdates(turns, key);
}

/** Combatant updates that move one unit's window to just after another window. */
export function delayUpdates(turns, moverId, afterId) {
  const others = turns.filter(t => t.id !== moverId);
  const key = keysWithTies(others, [afterId]);
  const after = key.get(afterId);
  const mover = turns.find(t => t.id === moverId);
  if (!after || !mover) return [];
  key.set(moverId, { initiative: after.initiative, order: after.order - 0.5 });
  return keyUpdates(turns, key);
}

/* ------------------------------------------------------------------ */
/*  Reading a combat                                                    */
/* ------------------------------------------------------------------ */

export function windowsEnabled() {
  try { return game.settings.get("elaria", SETTING) !== false; } catch { return true; }
}

/** Which side a combatant is on: the party (player characters and player-owned units), or by token disposition. */
export function sideOf(combatant) {
  if (combatant?.actor?.type === "character" || combatant?.hasPlayerOwner) return "pc";
  const d = combatant?.token?.disposition ?? -1;
  return d === 1 ? "ally" : d === 0 ? "neutral" : d === -2 ? "secret" : "enemy";
}

export const flagsOf = doc => doc?.flags?.elaria ?? {};

/** Finesse modifier (ties) and "is a player character" (last tie rule). */
const finOf = c => Number(c.actor?.system?.stats?.fin?.mod) || 0;
const isPC = c => c.actor?.type === "character" || !!c.hasPlayerOwner;

/** Out of the fight (KO'd or defeated): no window. */
export const isOut = c => !!(c?.isDefeated || flagsOf(c).out);

/** The combat's turn order as plain entries. */
export function snapshot(combat) {
  return combat.turns.map(c => {
    const f = flagsOf(c);
    return {
      id: c.id, side: sideOf(c), initiative: Number.isFinite(c.initiative) ? c.initiative : null,
      order: Number(f.order) || 0, acted: f.acted ?? null, reserved: f.reserved ?? null,
      defeated: isOut(c), removeWindow: f.removeWindow ?? null
    };
  });
}

/** The side's pick / picker / … map from the combat flags (every side present, null if unset). */
const sideMap = obj => Object.fromEntries(SIDES.map(s => [s, obj?.[s] ?? null]));
const sideFlags = (prefix, obj) => Object.fromEntries(SIDES.map(s => [`flags.elaria.${prefix}.${s}`, obj[s] ?? null]));

export function windowState(combat) {
  const f = flagsOf(combat);
  return { next: sideMap(f.next), nextBy: sideMap(f.nextBy), picker: sideMap(f.picker), pickedBy: f.pickedBy ?? null };
}

/** Has this combatant acted this round? */
export const hasActed = (combat, c) => flagsOf(c).acted === combat.round;

/** May this user pick for the side (GM, the side's picker's owner, or anyone on the side if it has no picker)? */
export function canPickFor(combat, side, user = game.user) {
  if (user.isGM) return true;
  const picker = combat.combatants.get(windowState(combat).picker[side]);
  if (picker && !isOut(picker)) return !!picker.actor?.testUserPermission(user, "OWNER");
  return combat.combatants.some(c => sideOf(c) === side && !isOut(c) && c.actor?.testUserPermission(user, "OWNER"));
}

/** Who may be picked for the side's next window: un-acted members, or everyone if that window is next round. */
export function pickChoices(combat, side) {
  const turns = snapshot(combat);
  const nw = nextWindowOfSide(turns, combat.turn ?? -1, combat.round, side);
  if (!nw) return { window: null, choices: [] };
  const choices = turns.filter(t => t.side === side && hasWindow(t) && t.reserved !== nw.round
    && (nw.round > combat.round || t.acted !== combat.round));
  return { window: { ...nw, initiative: turns[nw.index].initiative, nextRound: nw.round > combat.round }, choices };
}

/* ------------------------------------------------------------------ */
/*  The combat document                                                 */
/* ------------------------------------------------------------------ */

export class ElariaCombat extends BaseCombat {
  /**
   * Initiative (high first); then a place set by a pick or delay (flags.elaria.order, high first); then the
   * tie rules: higher Finesse, higher tie d6, player characters first; then core's id order.
   */
  _sortCombatants(a, b) {
    const ia = Number.isFinite(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isFinite(b.initiative) ? b.initiative : -Infinity;
    if (ib !== ia) return ib - ia;
    const oa = Number(a.flags?.elaria?.order) || 0, ob = Number(b.flags?.elaria?.order) || 0;
    if (ob !== oa) return ob - oa;
    const fa = finOf(a), fb = finOf(b);
    if (fb !== fa) return fb - fa;
    const ta = Number(a.flags?.elaria?.tieRoll) || 0, tb = Number(b.flags?.elaria?.tieRoll) || 0;
    if (tb !== ta) return tb - ta;
    const pa = isPC(a), pb = isPC(b);
    if (pa !== pb) return pa ? -1 : 1;
    return a.id > b.id ? 1 : -1;
  }

  /** Rolling initiative also rolls the tie d6, and a fresh roll takes no place set earlier. */
  async rollInitiative(ids, options = {}) {
    const result = await super.rollInitiative(ids, options);
    const list = (typeof ids === "string" ? [ids] : Array.from(ids ?? [])).filter(id => this.combatants.get(id)?.isOwner);
    if (list.length) {
      await this.updateEmbeddedDocuments("Combatant", list.map(id => ({ _id: id,
        "flags.elaria.tieRoll": Math.ceil(CONFIG.Dice.randomUniform() * 6) || 1, "flags.elaria.order": 0 })));
    }
    return result;
  }

  async startCombat() {
    if (!windowsEnabled()) return super.startCombat();
    await super.startCombat();
    if (!this.turns.some(c => Number.isFinite(c.initiative))) {
      ui.notifications.warn(game.i18n.localize("ELARIA.Turn.rollFirst"));
      return this;
    }
    // Round one: each side's highest roller picks for that side; then the first window opens.
    const picker = {};
    for (const c of this.turns) {
      const side = sideOf(c);
      if (!picker[side] && Number.isFinite(c.initiative) && !isOut(c)) picker[side] = c.id;
    }
    await this.update({ ...sideFlags("picker", picker), ...sideFlags("next", {}), ...sideFlags("nextBy", {}),
      "flags.elaria.history": [] });
    await advance(this, { from: -1, round: 1, keepHistory: false });   // (history was just emptied)
    return this;
  }

  async nextTurn() {
    if (!windowsEnabled() || !this.started) return super.nextTurn();
    if (!game.user.isGM) return request("endTurn", this);
    return advance(this);
  }

  async nextRound() {
    if (!windowsEnabled() || !this.started) return super.nextRound();
    if (!game.user.isGM) return request("endTurn", this);
    return advance(this, { from: this.turns.length - 1 });
  }

  async previousTurn() {
    if (!windowsEnabled() || !game.user.isGM) return super.previousTurn();
    const history = flagsOf(this).history ?? [];
    if (!history.length) return super.previousTurn();
    return restore(this, history.length - 1);
  }

  async previousRound() {
    if (!windowsEnabled() || !game.user.isGM) return super.previousRound();
    const history = flagsOf(this).history ?? [];
    const i = history.findIndex(h => h.round === this.round - 1);
    if (i < 0) return super.previousRound();
    return restore(this, i);
  }
}

/* ------------------------------------------------------------------ */
/*  GM-side actions                                                     */
/* ------------------------------------------------------------------ */

/** One change at a time (double clicks, two players at once). */
let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn).catch(err => console.error("Elaria | turn order", err)));

const L = k => game.i18n.localize(k);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const sideLabel = side => L(`ELARIA.Turn.side.${side}`);

/** What Previous turn goes back to. */
function historyEntry(combat) {
  const s = windowState(combat);
  return {
    round: combat.round, turn: combat.turn, ...s, windowKey: flagsOf(combat).windowKey ?? "",
    units: combat.combatants.map(c => ({ _id: c.id, initiative: c.initiative, order: Number(flagsOf(c).order) || 0,
      acted: flagsOf(c).acted ?? null, reserved: flagsOf(c).reserved ?? null }))
  };
}

const pushHistory = (combat, entry) => [...(flagsOf(combat).history ?? []), entry].slice(-HISTORY);

/** Merge combatant updates by id. */
function merge(...lists) {
  const byId = new Map();
  for (const u of lists.flat()) byId.set(u._id, { ...(byId.get(u._id) ?? {}), ...u });
  return [...byId.values()];
}

/** Pending window removals (defeated units' choices), applied before the next window opens. */
async function applyRemovals(combat) {
  const turns = snapshot(combat);
  const updates = [];
  const lines = [];
  for (const dead of turns.filter(t => t.defeated && t.removeWindow)) {
    const now = snapshot(combat);
    const target = now.find(t => t.id === dead.removeWindow);
    updates.push({ _id: dead.id, "flags.elaria.removeWindow": null });
    if (!target || target.defeated || target.side !== dead.side) continue;
    updates.push(...swapUpdates(now, dead.id, target.id));
    lines.push(game.i18n.format("ELARIA.Turn.windowRemoved", { name: esc(combat.combatants.get(dead.id)?.name),
      init: target.initiative }));
  }
  if (!updates.length) return;
  await combat.updateEmbeddedDocuments("Combatant", merge(updates), { combatTurn: combat.turn, turnEvents: false });
  for (const line of lines) await announce(combat, line, "pc");
}

/**
 * Open the next window (the current turn is over): pick who acts in it, swap them in, mark them as acted and
 * make them the side's picker.
 */
export function advance(combat, options = {}) {
  return serial(() => advanceNow(combat, options));
}

async function advanceNow(combat, { from = combat.turn ?? -1, round = combat.round || 1, keepHistory = true } = {}) {
  {
    if (!game.user.isGM) return;
    const entry = historyEntry(combat);
    await applyRemovals(combat);
    const turns = snapshot(combat);
    const state = windowState(combat);
    const found = findNextWindow(turns, from, round, state.next);
    if (!found) return ui.notifications.warn(L("ELARIA.Turn.nobody"));
    const { index, actorId, skipped } = found;
    const window = turns[index];
    const side = window.side;
    const picked = state.next[side] === actorId;
    const updates = merge(
      actorId === window.id ? [] : swapUpdates(turns, actorId, window.id),
      [{ _id: actorId, "flags.elaria.acted": found.round }]
    );
    await combat.updateEmbeddedDocuments("Combatant", updates, { combatTurn: index, turnEvents: false });

    const roundChange = found.round !== combat.round;
    // (round only when it changes: it is sent as is, and a round in the update starts a new round elsewhere)
    const update = {
      ...(roundChange ? { round: found.round } : {}), turn: index,
      [`flags.elaria.next.${side}`]: null, [`flags.elaria.nextBy.${side}`]: null,
      [`flags.elaria.picker.${side}`]: actorId,
      "flags.elaria.pickedBy": picked ? state.nextBy[side] : null,
      "flags.elaria.windowKey": `${found.round}:${index}:${actorId}:${foundry.utils.randomID(4)}`,
      "flags.elaria.history": keepHistory ? pushHistory(combat, entry) : (flagsOf(combat).history ?? [])
    };
    const options = { direction: 1, diff: false,
      worldTime: { delta: roundChange ? CONFIG.time.roundTime : CONFIG.time.turnTime } };
    Hooks.callAll(roundChange ? "combatRound" : "combatTurn", combat, update, options);
    await combat.update(update, options);
    for (const s of skipped) {
      await announce(combat, game.i18n.format("ELARIA.Turn.skipped", { side: sideLabel(s.side),
        init: turns[s.index].initiative }), s.side);
    }
  }
}

/** Go back to a history entry (Previous turn / round). */
function restore(combat, i) {
  return serial(async () => {
    const history = flagsOf(combat).history ?? [];
    const h = history[i];
    if (!h) return;
    const units = h.units.filter(u => combat.combatants.has(u._id)).map(u => ({ _id: u._id, initiative: u.initiative,
      "flags.elaria.order": u.order, "flags.elaria.acted": u.acted, "flags.elaria.reserved": u.reserved }));
    await combat.updateEmbeddedDocuments("Combatant", units, { combatTurn: h.turn, turnEvents: false });
    await combat.update({
      ...(h.round !== combat.round ? { round: h.round } : {}), turn: h.turn, ...sideFlags("next", h.next), ...sideFlags("nextBy", h.nextBy),
      ...sideFlags("picker", h.picker), "flags.elaria.pickedBy": h.pickedBy, "flags.elaria.windowKey": h.windowKey,
      "flags.elaria.history": history.slice(0, i)
    }, { direction: -1, diff: false });
  });
}

/** Set who acts in a side's next window. */
function doSetNext(combat, side, pickId, byId) {
  return serial(async () => {
    const { choices } = pickChoices(combat, side);
    if (pickId && !choices.some(t => t.id === pickId)) return;
    await combat.update({ [`flags.elaria.next.${side}`]: pickId || null, [`flags.elaria.nextBy.${side}`]: pickId ? byId : null });
  });
}

/** GM: someone else acts in the current window instead (the one there now hasn't acted after all). */
function doActNow(combat, id) {
  return serial(async () => {
    const current = combat.combatant;
    const turns = snapshot(combat);
    const unit = turns.find(t => t.id === id);
    if (!current || !unit || unit.id === current.id || !canAct(unit, combat.round)) return;
    const updates = merge(swapUpdates(turns, id, current.id),
      [{ _id: id, "flags.elaria.acted": combat.round }, { _id: current.id, "flags.elaria.acted": null }]);
    await combat.updateEmbeddedDocuments("Combatant", updates, { combatTurn: combat.turn, turnEvents: false });
    await combat.update({ turn: combat.turn, [`flags.elaria.picker.${sideOf(current)}`]: id, "flags.elaria.pickedBy": null,
      "flags.elaria.windowKey": `${combat.round}:${combat.turn}:${id}:${foundry.utils.randomID(4)}` }, { diff: false });
  });
}

/** GM: mark a unit as having acted this round, or not. */
function doToggleActed(combat, id) {
  return serial(async () => {
    const c = combat.combatants.get(id);
    if (!c) return;
    await c.update({ "flags.elaria.acted": hasActed(combat, c) ? null : combat.round });
  });
}

/** The acting unit delays: its window moves to just after `afterId`, and the window now opening is picked by it. */
function doDelay(combat, afterId, nextPick) {
  return serial(async () => {
    const current = combat.combatant;
    const turns = snapshot(combat);
    const after = turns.find(t => t.id === afterId);
    const t = combat.turn;
    if (!current || !after || turns.indexOf(after) <= t || after.defeated) return;
    const entry = historyEntry(combat);
    const side = sideOf(current);
    const updates = merge(delayUpdates(turns, current.id, afterId),
      [{ _id: current.id, "flags.elaria.acted": null, "flags.elaria.reserved": combat.round }]);
    await combat.updateEmbeddedDocuments("Combatant", updates, { combatTurn: t, turnEvents: false });
    const pick = nextPick && combat.combatants.has(nextPick) ? nextPick : null;
    await combat.update({ [`flags.elaria.picker.${side}`]: current.id,
      [`flags.elaria.next.${side}`]: pick, [`flags.elaria.nextBy.${side}`]: pick ? current.id : null,
      "flags.elaria.history": pushHistory(combat, entry) });
    await announce(combat, game.i18n.format("ELARIA.Turn.delayed", { name: esc(current.name), side: sideLabel(side),
      after: esc(windowName(combat, combat.combatants.get(afterId), { forPlayers: true })), init: after.initiative }), side);
    // The window that slid into this place opens now (its history entry is the delay's).
    await advanceNow(combat, { from: t - 1, keepHistory: false });
  });
}

/** A defeated unit's window choice: remembered, applied when the current turn ends. */
function doRemoveWindow(combat, deadId, targetId) {
  return serial(async () => {
    const dead = combat.combatants.get(deadId);
    if (!isOut(dead)) return;
    await dead.update({ "flags.elaria.removeWindow": targetId === deadId ? null : targetId });
  });
}

/**
 * Undo a removed window: the unit is back in the turn order where it sits now (no new roll), no longer marked
 * defeated, and keeps the window even while still at 0 HP. Its "acted this round" mark is kept.
 */
function doRestoreWindow(combat, id) {
  return serial(async () => {
    const c = combat.combatants.get(id);
    if (!c || !isOut(c) || !Number.isFinite(c.initiative)) return;
    await c.update({ defeated: false, "flags.elaria.out": false, "flags.elaria.keepWindow": true,
      "flags.elaria.removeWindow": null });
    const status = CONFIG.specialStatusEffects?.DEFEATED;
    if (status && c.actor?.statuses?.has(status)) await c.actor.toggleStatusEffect(status, { active: false, overlay: true });
    await announce(combat, game.i18n.format("ELARIA.Turn.windowRestored", { name: esc(c.name), init: c.initiative }), sideOf(c));
  });
}

/** A short line in chat about the turn order (whispered to GMs for sides players don't see). */
async function announce(combat, html, side) {
  const gmOnly = side !== "pc";
  return ChatMessage.create({
    speaker: { alias: L("ELARIA.Turn.turnOrder") },
    content: `<div class="elaria chat-card turn-note"><p><i class="fa-solid fa-hourglass-half"></i> ${html}</p></div>`,
    ...(gmOnly ? { whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id) } : {})
  });
}

/** "Party window" etc., or the unit's name for GMs / own side. */
export function windowName(combat, c, { forPlayers = false } = {}) {
  if (!c) return "";
  const side = sideOf(c);
  if (forPlayers && side !== "pc") return `${sideLabel(side)} ${L("ELARIA.Turn.window")}`;
  return c.name;
}

/* ------------------------------------------------------------------ */
/*  Requests from players                                               */
/* ------------------------------------------------------------------ */

const ACTIONS = {
  endTurn: (combat, d, user) => (combat.combatant?.actor?.testUserPermission(user, "OWNER") ? advance(combat) : null),
  setNext: (combat, d, user) => (canPickFor(combat, d.side, user)
    ? doSetNext(combat, d.side, d.pickId, windowState(combat).picker[d.side]) : null),
  delay: (combat, d, user) => (combat.combatant?.actor?.testUserPermission(user, "OWNER") ? doDelay(combat, d.afterId, d.nextPick) : null),
  removeWindow: (combat, d, user) => (combat.combatants.get(d.deadId)?.actor?.testUserPermission(user, "OWNER")
    ? doRemoveWindow(combat, d.deadId, d.targetId) : null),
  actNow: (combat, d, user) => (user.isGM ? doActNow(combat, d.id) : null),
  restoreWindow: (combat, d, user) => (combat.combatants.get(d.id)?.actor?.testUserPermission(user, "OWNER")
    ? doRestoreWindow(combat, d.id) : null),
  toggleActed: (combat, d, user) => (user.isGM ? doToggleActed(combat, d.id) : null)
};

/** Do it here (GM) or ask the GM's client. */
export function request(action, combat, data = {}) {
  if (!combat) return;
  if (game.user.isGM) return ACTIONS[action]?.(combat, data, game.user);
  if (!game.users.activeGM) return ui.notifications.warn(L("ELARIA.Turn.needsGM"));
  game.socket.emit(SOCKET, { action: `turn.${action}`, combatId: combat.id, userId: game.user.id, ...data });
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                               */
/* ------------------------------------------------------------------ */

export function registerTurnSettings() {
  game.settings.register("elaria", SETTING, {
    name: "ELARIA.Turn.settingName", hint: "ELARIA.Turn.settingHint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => ui.combat?.render()
  });
}

export function initTurnOrder() {
  game.socket.on(SOCKET, data => {
    if (!String(data?.action).startsWith("turn.") || !game.users.activeGM?.isSelf) return;
    const combat = game.combats.get(data.combatId);
    const user = game.users.get(data.userId);
    const fn = ACTIONS[data.action.slice(5)];
    if (combat && user && fn) return fn(combat, data, user);
  });
}

/**
 * GM: keep flags.elaria.out in step with the unit: out when KO'd (0 HP) or marked defeated, back in when neither.
 * Going out asks for a window to remove; coming back rolls a new window (see onUpdateCombatantWindows).
 */
export function syncOut(combatant) {
  const combat = combatant?.combat;
  if (!windowsEnabled() || !combat?.started || !game.users.activeGM?.isSelf) return;
  const hp = combatant.actor?.system?.resources?.hp;
  const ko = !!hp && Number(hp.max) > 0 && Number(hp.value) <= 0;
  const down = !!combatant.isDefeated || ko;
  // A window restored by hand stays until the unit is back up; after that the usual rules apply again.
  if (flagsOf(combatant).keepWindow) {
    if (!down) return combatant.update({ "flags.elaria.keepWindow": false });
    if (!flagsOf(combatant).out) return;
  }
  const out = down;
  if (out === !!flagsOf(combatant).out) return;
  return combatant.update(out ? { "flags.elaria.out": true }
    : { "flags.elaria.out": false, "flags.elaria.acted": null, "flags.elaria.removeWindow": null, "flags.elaria.reserved": null });
}

/** updateActor / updateToken: a unit's HP changed (KO'd or back up). */
export function onUnitChanged(doc) {
  if (!game.users.activeGM?.isSelf) return;
  const actor = doc.documentName === "Token" ? doc.actor : doc;
  for (const combat of game.combats.filter(c => c.started)) {
    for (const c of combat.combatants) {
      if ((doc.documentName === "Token" ? c.tokenId === doc.id : (c.actor === actor || c.actor?.uuid === actor?.uuid))) syncOut(c);
    }
  }
}

/** updateCombatant: marked (not) defeated → sync; went out → pick a window to remove; came back → roll a window. */
export function onUpdateCombatantWindows(combatant, changes) {
  const combat = combatant.combat;
  if (!windowsEnabled() || !combat?.started) return;
  if ("defeated" in changes) syncOut(combatant);
  const out = foundry.utils.getProperty(changes, "flags.elaria.out");
  if (out === undefined) return;
  const owner = game.users.find(u => u.active && !u.isGM && combatant.actor?.testUserPermission(u, "OWNER"));
  const answerer = owner ?? game.users.activeGM;
  if (!answerer?.isSelf) return;
  // Monsters and other GM units just lose their own window (no question); player units' owners choose.
  if (out) return combatant.hasPlayerOwner ? chooseWindowToRemove(combat, combatant) : null;
  // Restored by hand keeps its place; coming back up rolls a new window.
  if (foundry.utils.getProperty(changes, "flags.elaria.keepWindow")) return;
  return combat.rollInitiative([combatant.id]);
}

async function chooseWindowToRemove(combat, dead) {
  const side = sideOf(dead);
  const windows = combat.turns.filter(c => sideOf(c) === side && Number.isFinite(c.initiative)
    && (c.id === dead.id || !isOut(c)));
  if (windows.length < 2) return;
  const rows = windows.map(c => `<label class="window-choice"><input type="radio" name="window" value="${c.id}" ${c.id === dead.id ? "checked" : ""}>
    <b>${c.initiative}</b> <span>${c.id === dead.id ? game.i18n.format("ELARIA.Turn.ownWindow", { name: dead.name }) : `${sideLabel(side)} ${L("ELARIA.Turn.window")}`}</span></label>`).join("");
  const targetId = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("ELARIA.Turn.removeTitle", { name: dead.name }), icon: "fa-solid fa-skull" },
    position: { width: 380 },
    classes: ["elaria", "turn-dialog"],
    content: `<p>${game.i18n.format("ELARIA.Turn.removeIntro", { name: esc(dead.name), side: sideLabel(side) })}</p>
      <div class="window-choices">${rows}</div>`,
    buttons: [{ action: "ok", label: L("ELARIA.Turn.removeButton"), icon: "fa-solid fa-check", default: true,
      callback: (event, button) => button.form.elements.window.value }],
    rejectClose: false
  });
  if (targetId && targetId !== dead.id) request("removeWindow", combat, { deadId: dead.id, targetId });
}

/** The acting unit's Delay button: where to move the window, and who acts in the window opening now. */
export async function promptDelay(combat) {
  const current = combat?.combatant;
  if (!current) return;
  const side = sideOf(current);
  const later = combat.turns.slice(combat.turn + 1).filter(c => Number.isFinite(c.initiative) && !isOut(c));
  if (!later.length) return ui.notifications.warn(L("ELARIA.Turn.noLater"));
  const gm = game.user.isGM;
  const afterOptions = later.map(c => `<option value="${c.id}">${c.initiative}: ${esc(sideOf(c) === side || gm
    ? `${sideLabel(sideOf(c))} ${L("ELARIA.Turn.window")}${gm ? ` (${c.name})` : ""}` : windowName(combat, c, { forPlayers: true }))}</option>`).join("");
  // If the window sliding into this place is the side's, the delayer picks who acts in it.
  const nextUp = later[0];
  const members = sideOf(nextUp) === side
    ? combat.turns.filter(c => sideOf(c) === side && c.id !== current.id && !isOut(c) && Number.isFinite(c.initiative)
      && !hasActed(combat, c) && flagsOf(c).reserved !== combat.round) : [];
  const pickRow = members.length ? `<label class="row"><span>${L("ELARIA.Turn.delayNext")}</span>
    <select name="nextPick">${members.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>` : "";
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("ELARIA.Turn.delayTitle", { name: current.name }), icon: "fa-solid fa-hourglass-half" },
    classes: ["elaria", "turn-dialog"],
    content: `<p>${L("ELARIA.Turn.delayIntro")}</p>
      <label class="row"><span>${L("ELARIA.Turn.delayAfter")}</span><select name="afterId">${afterOptions}</select></label>${pickRow}`,
    buttons: [
      { action: "ok", label: L("ELARIA.Turn.delay"), icon: "fa-solid fa-hourglass-half", default: true,
        callback: (event, button) => ({ afterId: button.form.elements.afterId.value, nextPick: button.form.elements.nextPick?.value ?? "" }) },
      { action: "cancel", label: L("Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (result?.afterId) return request("delay", combat, result);
}
