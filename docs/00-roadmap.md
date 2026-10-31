# Roadmap

## Phase 0: plan (now)
- [x] Read *Mechanics* and *Character Stats*, pull the sheet's real formulas
- [x] Rules reference, data model, sheet design
- [x] Answers to `QUESTIONS.md` (Q1–Q17), folded into the docs
- [ ] Follow-ups Q18–Q21 (none block phase 1)

## Phase 1: character sheet MVP ✅ (v0.1.0)
- [x] `system.json`, `elaria.mjs`, `module/config.mjs` (stats, scalings, elements, categories, every dropdown list from the sheet)
- [x] `module/rules.mjs`: every formula as a pure function, tested by `tools/test-rules.mjs`
- [x] `CharacterData` TypeDataModel with every derived value from `01-rules-reference.md`
- [x] Character sheet: header (HP/MP/FTG with temp, life point pips, AR/MAR/Mv/reacts/passive awa/initiative, injuries, exhaustion, burst, second wind) and Stats tab (scaling, points, bonus, mod, OVER and cap warnings, boost/null balance warning, scaling toggle, defence/combat/carrying panel)
- [x] Stat checks (`3d6 + mod`, Shift = advantage, Ctrl = disadvantage, injury/exhaustion penalty) and initiative (`3d6 + fin`, −2 at exhaustion 1+)
- [x] Masteries tab: basic `mastery` item, equip toggle, five category caps, Maximum Output (incl. Plus 5 Output), "any"-category masteries, level warnings, post to chat
- [x] Bio tab: race, heritage, form, disciplines (slot 2: discipline / extra element / plus 5 output), profession, elements + combos, deity + role, alignment, background, biography
- [x] Token bars for HP/MP/FTG; token-bar damage eats temp first
- [x] **Test**: the sample character from the Google Sheet matches on every number (`node tools/test-rules.mjs`)
- [x] Fix: empty text fields crashed the sheet (v0.1.0 → fixed)
- [x] v0.1.1 sheet changes: ±1 resource buttons, Restore button, Initiative label, sub-stat Bonus columns, full editing mode (form, scaling), resistances section
- [x] v0.1.2: layout A (portrait column), 700 px minimum width, green FTG, Foundry core-style overrides
- [ ] **Your test in Foundry** (see README → Installing)

## Phase 2: masteries and items
- `mastery` item type and sheet; equip into categories; caps, output, level and source checks
- [x] v0.4.0: read-only mastery view with edit button; Add mastery → compendium picker or blank; drag-drop masteries and folders onto the sheet
- `race`, `heritage`, `discipline`, `profession` items with drag-and-drop onto the character
- [x] v0.11.0: Gear tab imported (weapons, armour, trinkets, class trinkets, uniques); Inventory tab (coins, belt, worn armour → AAR, trinkets, bag)
- Status effects as Active Effects with stacks; buffs as Active Effects feeding the stat-mod bonus
- [x] v0.9.0: monster actor + sheet from the *Monster stat block* tab (GM-only, default for GMs), monster abilities, token tab; nature-check DCs shown to the GM
- Nature-check reveals for players

## Phase 3: content
- [x] v0.2.0: mastery model carries every field from the sheet; GM importer builds 7 world compendiums
- [x] v0.3.0: importer reads the Google Sheet directly (paste link → Check → Import), read-only, nothing to install
- [ ] Race, heritage, discipline, profession, deity items from the same files
- Compendiums: masteries (all types), races + heritages, disciplines, professions, gear

## Phase 4: play automation
- [x] v0.5.0: Roll 3d6 / Roll d20 under the chat box; one 3d6 roll window (stat, bonus, penalty, crit chance/damage, advantage/disadvantage); crit shown with and without
- [x] v0.6.0: masteries with damage open the roll window pre-filled (dice, stat, crit); others post to chat; mastery hotbar macros; green crits
- [x] v0.7.0: stat names roll; reroll button on roll cards; skill mod roll buttons on mastery cards; sheet mastery rows draggable to the hotbar
- [x] v0.8.0: reaction pips per combatant in the combat tracker (pass/fail), emptied each round
- [x] v0.10.0: React button on the hotbar; reaction rolls vs n + 10/12/14/16 + skill mod, n from the pips; fills the pip
- Damage application with AR/MAR, damage types, elemental/form weakness and resistance
- Initiative party windows (custom combat tracker)
- Burst, exhaustion, injuries, rest buttons (1-minute recovery, long rest, dungeon breathers)
- Party actor with XP tracker
