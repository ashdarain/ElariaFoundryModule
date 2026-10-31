# Data model

> Phase 1 implements the `character` actor and a basic `mastery` item (`module/data/`). Everything else here is still a proposal.

Foundry splits things into **Actors** (characters, monsters) and **Items** (anything an actor owns or that sits in a compendium). Each gets a `TypeDataModel` that defines its stored fields and computes derived values in `prepareDerivedData()`.

Rule of thumb used here: **store only what a player chooses or what changes in play; derive everything else.** Derived values are never saved, so they can't drift out of sync the way a hand-edited sheet can.

---

## Actor types

### `character` (phase 1)

**Stored** (`system.*`)

```js
level: 1                        // 1–20, player-editable (A14)
scalingEnabled: true            // the C44 On/Off toggle; false = treat all as Gen (A9)
stats: {
  str: { scaling: "gen", points: 0, bonus: 0 },   // scaling: gen | bst | null
                                                  // bonus = manual flat bonus to the MODIFIER (A4)
  stf: {…}, con: {…}, res: {…},
  fin: {…}, pre: {…}, awa: {…}, dem: {…},
  smrts: {…}, spc: {…}, wis: {…}, ins: {…},
  lck: {…}
}
resources: {
  hp:  { value, temp },  mp: { value, temp },  ftg: { value, temp },  // temp = overflow, spent first (A11)
  lifePoints: { value }                                               // revives left, ≤ max (A12)
}
conditions: {
  injuries: 0, exhaustion: 0,       // 0–7
  burst: { value: 0, mood: "Normal", usedToday: false },   // max derived from mood; + identity.burstEffect (HTML)
  secondWindUsed: false
}
identity: {
  element1: "", element2: "",       // prime elements
  element3: "",                     // only counts if discipline slot 2 is "extraElement" (A7)
  race: "", heritage: "", discipline1: "", discipline2: "", profession: "",   // strings in phase 1, items in phase 2
  form: "mortal",                   // mortal | divine | demonic, PCs default mortal (A15)
  deity: "", deityRole: "only",     // only | primary | secondary  (Piety)
  alignment: "", alignment2: "",    // wheel traits; the second is optional
  background: { scale: "", name: "" },
  biography: ""
}
armour: { aar: 0 }                  // until armour items exist (see below)
bonuses: { nar, nmar, aar, ar, mar, critChance, critDamage, mv, reacts,
           passiveAwareness, lifePointsMax, equipLoad, bagSlots }   // manual sub-stat bonuses
resistances: { fire … nature, mortal, divine, demonic }            // manual %, + = takes less
currency: { platinum, gold, silver, copper, ironne }
bagRank: 1
```

Race, heritage (sub-race), disciplines and profession are **Items** (below), not strings. Dropping one on the sheet sets it. That way the sheet can read their masteries, stat mods and descriptions straight from the item. Phase 1 starts with plain dropdowns and switches to items in phase 2.

**Discipline slot 2** holds a second discipline, or the marker `"extraElement"` (unlocks `elements[2]`, A7) or `"plusOutput"` (+5 Maximum Output, A18).

### Where stat bonuses come from (A4)
The Google Sheet lumps every flat modifier bonus into one column. Foundry keeps the sources apart, then adds them up:

```
mod(x) = floor(total / 4)
       + stats.x.bonus                 // manual, typed on the sheet (catch-all, like column H)
       + heritage stat mods            // from the heritage item, incl. the "Str OR Pre" choice
       + Active Effects on system.stats.x.effectBonus   // buffs, food, mood, drunkenness…
```
The sheet shows the breakdown on hover. Temporary bonuses are Active Effects with a duration, so they expire on their own; permanent ones live on the item that grants them.

### Defensive affinities (A15)
```
resistanceTotals: { fire: { base, bonus, total }, … }   // derived: form built-ins + the manual resistances
substats: { nar: { base, bonus, total }, … }            // derived: formula + manual bonus
effectBonuses: { reacts, mv, categoryCap, output }      // Active Effect targets, never saved
```
PCs get no innate elemental resistances. Form (`identity.form`) supplies the form weakness/resistance.

**Derived** (`prepareDerivedData`, see `01-rules-reference.md` for formulas)

```
stats.X.base, .total, .mod
statPoints.available, .assigned, .over, .perStatCap (lvl + 3), stats.X.overCap  // warnings only (A3)
resources.hp.max, mp.max, ftg.max, lifePoints.max
defence.nar, nmar, aar, ar, mar
combat.mv, passiveAwareness, reacts, critChance, critDamage, initiativeFormula ("3d6 + @fin.mod")
rollPenalty      // −injuries (attack, damage, checks) and −2 to skill mods at exhaustion ≥ 4
equipLoad, bagSlots
mastery.output.max / .used, mastery.categories.{basic,utility,offensive,defensive,support}.{cap,used}
mastery.sources  // which lists are unlocked (general, race, element combo, …)
combos           // ["Fire/Ice"] or, with a third element, all three pairs (A20)
```

### `npc` (phase 2, from the *Monster stat block* tab)
Everything is entered directly; there's no level/scaling/points maths.

```js
power: 1                         // drives the nature-check DCs
type: "", size: "", elements: [], form: "mortal"
description: ""
stats: { str: { value, mod }, … }   // mod defaults to floor(value/4) but can be overridden
resources: { hp, mp, ftg }          // { value, max, temp }
defence: { nar, nmar, aar }         // AR/MAR derived the same way as PCs
resistances: { fire: 25, … }        // monsters DO have innate elemental res
combat: { mv, reacts, critChance, critDamage }   // derived from mods like PCs, overridable
loot: { unique: "", tables: [] }
knowledge: { basics, resources, loot, stats, skills }   // which parts players have revealed
```
Skills are `mastery` items (name, skill mod, cost, description, dmg, tags), so one roll path serves both.

**Nature checks**: the players' view of a monster hides each section until a check beats its DC (8/10/12/14/16 + Power, see rules ref §10). The GM sees everything; a "reveal" toggle per section lets the GM unlock it after a successful roll.

### `party` (later, optional)
XP is tracked per party (current XP, party level, current and end goals, personal goals, group achievements). A small `party` actor is the cleanest home for that.

---

## Item types

| Type         | Phase | Key fields                                                                                                                                                                                                                                                                                               | Notes                                                                                                                                                                  |
| ------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mastery`    | 1–3   | `ref`, `reqLevel` (null = no gate), `value` (null = no budget; 0–5), `category` (basic…support / `any` / `none`), `equippedCategory`, `equipped`, `sources[] {type,id,name}`, `isReaction`, `skillMod {raw,bonus,stats}`, `damage {raw,count,sides,stat,hits,perTarget}`, `cost` + `costs[] {amount,resource}`, `usageLimit {count,per}`, `tags[]`, `verified`, set `requirements[]`/`requirementsRaw`/`reqLevelAlt`, bond `minBondTier`, `details` | Carries every field the sheet importer produces (v0.2.0+). Old v0.1 masteries migrate automatically. |
| `race`       | 1     | `description`, `passives`, `heroic` (bool)                                                                                                                                                                                                                                                               | Owns its ancestral masteries by reference                                                                                                                              |
| `heritage`   | 1     | `race`, `description`, `statMods[] {stat, amount, choice}`, `statModsRaw`, `abilities[]`                                                                                                                                                                                                                 | e.g. Bushido: "+1 Str **or** Pre, −1 Smarts" → a choice the player makes when it's dropped. Abilities are granted automatically, all of them, no budget cost (A16)     |
| `discipline` | 1     | `description`, `status` (wip/final)                                                                                                                                                                                                                                                                      | Two slots; slot 2 may instead be "Extra element" or "Plus 5 Output" (A7, A18)                                                                                       |
| `profession` | 1     | `description`, `crafting`                                                                                                                                                                                                                                                                                | One slot                                                                                                                                                               |
| `weapon`     | 2     | `baseAttack`, `damageType`, `affinity`, `equipLoad` (1–8), `breakpoint` (1–60), `evolution`, `effects`, `tags`, `location` (belt / bag)                                                                                                                                                                  | From *Gear*                                                                                                                                                            |
| `armour`     | 2     | `weight` (light/medium/heavy), `aar`, `breakpoint`, `effects`                                                                                                                                                                                                                                            | AAR = sum of equipped armour; counts toward both AR and MAR (A5)                                                                                                       |
| `trinket`    | 2     | `effects`, `tier`                                                                                                                                                                                                                                                                                        |                                                                                                                                                                        |
| `item`       | 2     | `quantity`, `rarity` (1–5), `price`, `description`, `bagRank` (bags only)                                                                                                                                                                                                                                | Generic bag contents, consumables, materials. Equipping a bag sets bag rank; start at rank 1 (A10)                                                                     |
| `background` | 3     | `scale`, `range`, `perk`, `inventory`                                                                                                                                                                                                                                                                    | Optional; could also stay as plain text                                                                                                                                |
| `deity`      | 3     | `description`, `boons`, `curses`, `ranks`                                                                                                                                                                                                                                                                | Needed once Piety is finished                                                                                                                                          |

### Mastery equip rules the sheet must enforce
1. `reqLevel ≤ level` (deity: shifted by −2 / 0 / +2 for only / primary / secondary).
2. The mastery's source is one the character has unlocked (`mastery.sources`).
3. Category used + value ≤ category cap.
4. Total used ≤ max output.
5. Set masteries: their listed requirements are equipped.

Breaking a rule should **warn** (red "OVER" like the Google Sheet) rather than block, since GMs bend rules and the game is still WIP.

### Active Effects
Foundry's Active Effects handle temporary and passive modifiers (heritage stat mods, status effects, mastery passives like "+1 reaction per round"). Each status effect becomes a `CONFIG.statusEffects` entry, so it shows on tokens. Stacking statuses (bleed, burn, chill, poison, fear) need a stack counter; that's a phase-2 job.
