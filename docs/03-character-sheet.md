# Character sheet design

> **Built so far (v0.1.2), layout "A: portrait column", minimum 700 px wide:** portrait on the left with ancestry, disciplines, elements and form stacked under it (form becomes a dropdown in full editing mode). Right of it: name, level, lock button; a vitals panel with HP / MP / FTG rows (−/+ buttons, bar, temp; FTG bar is green) and life point pips; conditions row; AR/MAR/Mv/Reacts/Passive Awa with Restore and an Initiative button. Stats tab: Scaling, Stat, Total, Points, Bonus, Mod (the Base column was dropped since base is always the level); Defence/Combat/Carrying panel with Base/Bonus/Total; resistances grid that wraps to fit. Bio tab bottom is split: **Burst** (gauge, mood, used today, alignment trigger, what fills the gauge, burst effect editor) | **Background** (type select, social standing number + d20 roll, then Description / Perk / Starting inventory from the imported Backgrounds tab), with a full-width **Biography** below. In edit mode the HP / MP / FTG maximums can be overridden (`resources.<key>.maxOverride`; ↺ resets to the formula).

Built with `foundry.applications.sheets.ActorSheetV2` + `HandlebarsApplicationMixin`. Each tab is a separate template part, so it re-renders on its own.

The layout follows the Google Sheet (B42 onward) so it'll feel familiar, split into tabs because a Foundry window is smaller than a spreadsheet.

## Header (always visible)

```
[portrait] Name ___________  Level [ 10 ▾]   Race: Alumen / Bushido   Classes: Rogue · Ninja
           HP [ 45 / 45 +0 ]  MP [ 16 / 16 +0 ]  FTG [ 16 / 16 +0 ]   Life Points ●●●○○
           AR 2 · MAR 2 · Mv 12 · Reacts 2 · Passive Awa 12 · Init 3d6+Fin [roll]   Form: Mortal
           Injuries [0]  Exhaustion [0/7]  Burst gauge [0/6]
```

## Tabs

### 1. Stats
The 13 stats grouped as Might / Reflexes / Intelligence / Luck, one row each:

| Scaling | Stat | Base | Points | Total | Bonus | **Mod** | roll |
|---|---|---|---|---|---|---|---|
| [Gen ▾] | Strength | 10 | [0] | 10 | [0] | **2** | 🎲 |

- Points and bonus are editable by the player (A14); base, total, mod are derived. Hovering the mod shows where it came from (base, manual bonus, heritage, effects).
- Points over `lvl + 3` in one stat highlight that row (warning only, A3).
- Footer: `Stat points 13 / 39` turning red on OVER, a warning if the Bst/Null trade-off doesn't balance, and a **Scaling on/off** checkbox (A9).
- The "+0" after HP/MP/FTG is Temp: damage and spending eat it first (A11).
- Side panel with the derived numbers: NAR, NMAR, AAR, crit chance, crit damage, equip load, life point max.
- Clicking a stat rolls `3d6 + mod` (A2), minus injuries. Shift-click (or a dialog) for advantage/disadvantage and an extra situational bonus.

### 2. Masteries
- Output bar: `Output 18 / 25`.
- Five category boxes (Basic, Utility, Offensive, Defensive, Support) each showing `used / cap`.
- Equipped masteries listed under their category with value, skill mod, damage, cost, tags. Clicking one posts it to chat; a roll button rolls its damage.
- "Available" list: masteries the character could equip, filtered by unlocked sources and level, drag-to-equip.
- "Sources" strip: General · Race · Heritage · Elements · Combo · Deity · Discipline 1 · Discipline 2 or Element 3 · Profession (from B70–B79).
- Heritage abilities show in their own always-on block, not in a category (A16).

### 3. Inventory
- Coins (5 denominations) with a "convert up" helper.
- Belt slots, armour, trinkets as item lists (equipped armour sums into AAR).
- Bag: `used / (equipLoad + bagRank) × 4` slots.

### 4. Conditions
- Status effects with stack counts (bleed, burn, chill, poison, fear…).
- Injuries, exhaustion (with the active level's effect text), second wind used, burst gauge and mood, overexert reminder.

### 5. Bio
- Prime elements (third appears when discipline slot 2 is "Extra element"), combo, form (Mortal by default), resistances, deity + role (only/primary/secondary) + piety, alignment trait, background, profession, free-text biography.

## Phase 1 scope (first deliverable)

Everything on the **Stats** tab and the **header**, fully automated; identity fields as plain dropdowns (strings) to start; masteries as a simple list with the five category totals and output. Drag-and-drop items, inventory and conditions come in phase 2.

## Monster (NPC) sheet (phase 2)

Mirrors the *Monster stat block* tab: header (name, type, power, elements, size, picture, description), HP/FTG/MP, stats and mods, defences + elemental res, combat numbers, loot, skills table.

Each block has a **nature-check DC** badge (`DC 14` etc.). Players who open the monster see only revealed blocks; the GM gets a lock/unlock toggle on each one. A "Nature check" button lets a player roll against a chosen block's DC and posts the result for the GM.
