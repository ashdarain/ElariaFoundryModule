/**
 * Turn passing: swapping two places in a turn order, including ties (node tools/test-turns.mjs).
 * Foundry's globals are stubbed just enough to load the module.
 */
globalThis.foundry = { documents: { Combat: class {} } };
globalThis.game = { settings: { get: () => true } };
globalThis.Number.isNumeric ??= v => v !== null && v !== "" && Number.isFinite(Number(v));
const { swapUpdates, delayUpdates, findNextWindow, pickForWindow, nextWindowOfSide, ElariaCombat } =
  await import("../module/combat/turn-order.mjs");

let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) { failed++; console.log(`FAIL ${name} ${extra}`); } };

/** Apply updates and sort the way ElariaCombat does. */
function apply(turns, updates) {
  const next = turns.map(t => ({ ...t, flags: { elaria: { order: t.order ?? 0 } } }));
  for (const u of updates) {
    const t = next.find(x => x.id === u._id);
    t.initiative = u.initiative;
    t.flags.elaria.order = u["flags.elaria.order"];
  }
  const sorter = new ElariaCombat();
  return next.sort((a, b) => sorter._sortCombatants(a, b)).map(t => t.id);
}
const order = turns => apply(turns, []);

// Every pair in a mixed order with ties: after the swap only those two have changed places.
const base = [["a", 17], ["b", 15], ["c", 15], ["d", 15], ["e", 14], ["f", 14], ["g", 13], ["h", 12], ["i", 12]]
  .map(([id, initiative]) => ({ id, initiative, order: 0 }));
check("base order", order(base).join("") === "abcdefghi", order(base).join(""));
let turns = base;
let expected = base.map(t => t.id);
let n = 0;
// A long chain of swaps, each applied on top of the last (so earlier tie-breaks are in play).
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < expected.length; i++) for (let j = i + 1; j < expected.length; j++) {
    const from = expected[i], to = expected[j];
    const updates = swapUpdates(expected.map(id => {
      const t = turns.find(x => x.id === id);
      return { id, initiative: t.initiative, order: t.order };
    }), from, to);
    turns = turns.map(t => {
      const u = updates.find(x => x._id === t.id);
      return u ? { ...t, initiative: u.initiative, order: u["flags.elaria.order"] } : t;
    });
    [expected[i], expected[j]] = [expected[j], expected[i]];
    const got = order(turns).join("");
    check(`swap ${from}↔${to}`, got === expected.join(""), `got ${got}, want ${expected.join("")}`);
    n++;
  }
}
check("unknown id", swapUpdates(base, "a", "zz").length === 0);
// Swapping two with different initiative and no ties touches only those two.
check("minimal updates", swapUpdates(base, "a", "g").length === 2, JSON.stringify(swapUpdates(base, "a", "g")));

/* ---------------- Action windows ---------------- */

/** A small engine over plain entries, doing what the GM's client does. */
function makeCombat(units) {
  const sorter = new ElariaCombat();
  const st = {
    turns: units.map(([id, side, initiative]) => ({ id, side, initiative, order: 0, acted: null, reserved: null, defeated: false })),
    round: 1, turn: -1, next: {}, log: []
  };
  const sort = () => {
    st.turns.sort((a, b) => sorter._sortCombatants({ ...a, flags: { elaria: { order: a.order } } }, { ...b, flags: { elaria: { order: b.order } } }));
  };
  const apply = updates => {
    for (const u of updates) {
      const t = st.turns.find(x => x.id === u._id);
      if ("initiative" in u) t.initiative = u.initiative;
      if ("flags.elaria.order" in u) t.order = u["flags.elaria.order"];
    }
    sort();
  };
  sort();
  st.advance = (from = st.turn) => {
    const found = findNextWindow(st.turns, from, st.round, st.next);
    if (!found) return null;
    const w = st.turns[found.index];
    if (found.actorId !== w.id) apply(swapUpdates(st.turns, found.actorId, w.id));
    const actor = st.turns.find(t => t.id === found.actorId);
    actor.acted = found.round;
    st.round = found.round;
    st.turn = st.turns.indexOf(actor);
    check(`actor at window ${found.actorId}`, st.turn === found.index, `${st.turn} vs ${found.index}`);
    st.next[actor.side] = null;
    st.log.push(`${found.round}:${actor.id}@${actor.initiative}`);
    return actor.id;
  };
  st.delay = afterId => {
    const cur = st.turns[st.turn];
    const t = st.turn;
    apply(delayUpdates(st.turns, cur.id, afterId));
    cur.acted = null;
    cur.reserved = st.round;
    return st.advance(t - 1);
  };
  st.windows = side => st.turns.filter(x => x.side === side && x.initiative !== null && !x.defeated).map(x => x.initiative).sort((a, b) => b - a).join(",");
  return st;
}

// Party P1..P3 (17, 15, 12), enemies E1, E2 (16, 12): a party window, an enemy window, a party window, two at 12.
{
  const c = makeCombat([["P1", "pc", 17], ["P2", "pc", 15], ["P3", "pc", 12], ["E1", "enemy", 16], ["E2", "enemy", 12]]);
  const partyWindows = c.windows("pc"), enemyWindows = c.windows("enemy");
  // Round 1: P1 opens, picks P3; E1; then the 15 window: P3 (picked); E2 (12) and the last party window: P2.
  check("r1 first", c.advance() === "P1");
  c.next.pc = "P3";
  check("r1 enemy", c.advance() === "E1");
  check("r1 picked", c.advance() === "P3");
  const rest = [c.advance(), c.advance()].sort().join();
  check("r1 rest", rest === "E2,P2", rest);
  // Round 2: nobody picked: whoever sits in each window acts, everyone once.
  const r2 = [c.advance(), c.advance(), c.advance(), c.advance(), c.advance()];
  check("r2 each once", [...r2].sort().join() === "E1,E2,P1,P2,P3", r2.join());
  check("r2 round", c.round === 2);
  check("windows unchanged", c.windows("pc") === partyWindows && c.windows("enemy") === enemyWindows,
    `${c.windows("pc")} / ${c.windows("enemy")}`);
  // A pick of someone who already acted this round is ignored.
  c.advance();                       // round 3, first window
  const first = c.turns[c.turn];
  c.next.pc = first.side === "pc" ? first.id : "P1";
  const seen = new Set([c.turns[c.turn].id]);
  for (let i = 0; i < 4; i++) seen.add(c.advance());
  check("r3 everyone once", seen.size === 5, [...seen].join());
}

// Delay: P1 (17) delays to after E1 (14): the party's window moves to 14.x, and P1 acts there this round.
{
  const c = makeCombat([["P1", "pc", 17], ["P2", "pc", 15], ["E1", "enemy", 14], ["E2", "enemy", 10]]);
  check("d first", c.advance() === "P1");
  const next = c.delay("E1");
  check("d next window opens", next === "P2", next);
  check("d enemy", c.advance() === "E1");
  check("d delayed acts", c.advance() === "P1", c.log.join(" "));
  check("d window moved", c.windows("pc") === "15,14", c.windows("pc"));
  check("d enemy last", c.advance() === "E2");
  // Next round the moved window stays; P1 is no longer reserved.
  const r2 = [c.advance(), c.advance(), c.advance(), c.advance()];
  check("d r2 once each", [...r2].sort().join() === "E1,E2,P1,P2", r2.join());
  check("d r2 order", c.log.slice(-4).map(l => l.split("@")[1]).join() === "15,14,14,10", c.log.join(" "));
}

// Delay between tied windows lands exactly after the chosen one.
{
  const turns = [["A", 14], ["B", 14], ["C", 14], ["D", 9]].map(([id, initiative]) => ({ id, initiative, order: 0 }));
  const sorter = new ElariaCombat();
  const moved = turns.map(t => ({ ...t }));
  for (const u of delayUpdates(turns, "A", "B")) {
    const t = moved.find(x => x.id === u._id);
    t.initiative = u.initiative;
    t.order = u["flags.elaria.order"];
  }
  const got = moved.sort((a, b) => sorter._sortCombatants({ ...a, flags: { elaria: { order: a.order } } }, { ...b, flags: { elaria: { order: b.order } } }))
    .map(t => t.id).join("");
  check("delay into a tie", got === "BACD", got);
}

// Removed windows (defeated) and windows nobody can fill are skipped.
{
  const turns = [
    { id: "P1", side: "pc", initiative: 18, acted: null },
    { id: "X", side: "pc", initiative: 16, acted: null, defeated: true },
    { id: "E1", side: "enemy", initiative: 14, acted: null },
    { id: "P2", side: "pc", initiative: 12, acted: 1 },
    { id: "P3", side: "pc", initiative: 11, acted: 1 }
  ];
  check("removed skipped", pickForWindow(turns, 1, 1) === null);
  const found = findNextWindow(turns, -1, 1);
  check("first", found.actorId === "P1");
  check("a later window takes whoever hasn't acted", findNextWindow(turns, 2, 1).actorId === "P1");
  turns[0].acted = 1;
  const after = findNextWindow(turns, 2, 1);
  check("empty party windows skipped into next round", after.round === 2 && after.index === 0 && after.skipped.length === 2,
    JSON.stringify(after));
  check("side's next window", JSON.stringify(nextWindowOfSide(turns, 0, 1, "pc")) === JSON.stringify({ index: 3, round: 1 }));
  check("side's next window, next round", JSON.stringify(nextWindowOfSide(turns, 3, 1, "enemy")) === JSON.stringify({ index: 2, round: 2 }));
}

// Ties: higher Finesse, then the tie d6, then player characters first; a set place (order) beats all of them.
{
  const sorter = new ElariaCombat();
  const unit = (id, fin, tieRoll, type = "monster", order = 0) =>
    ({ id, initiative: 12, flags: { elaria: { tieRoll, order } }, actor: { type, system: { stats: { fin: { mod: fin } } } } });
  const sorted = list => [...list].sort((a, b) => sorter._sortCombatants(a, b)).map(u => u.id).join("");
  check("tie: finesse", sorted([unit("a", 1, 6), unit("b", 3, 1)]) === "ba");
  check("tie: d6", sorted([unit("a", 2, 2), unit("b", 2, 5)]) === "ba");
  check("tie: player first", sorted([unit("m", 2, 4), unit("p", 2, 4, "character")]) === "pm");
  check("tie: placed first", sorted([unit("a", 5, 6), unit("b", 0, 1, "monster", 2)]) === "ba");
}

console.log(failed ? `${failed} check(s) failed` : `All turn order checks passed (${n} swaps)`);
process.exit(failed ? 1 : 0);
