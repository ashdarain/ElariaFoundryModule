# Elaria — Foundry VTT System

A Foundry Virtual Tabletop game system for **Elaria** (rules version 2.2, work in progress).
The rules and data live in the *Elaria 2.2* Google Sheet. This folder holds the Foundry system code and its design docs.

> Status: **v0.11.0**: automated character sheet (stats, resources, defences, masteries, burst), mastery compendiums imported from the Google Sheet, adding masteries from the compendiums, the dice roller, mastery damage rolls / hotbar macros, reaction pips in the combat tracker, monsters, and gear with a character inventory. See `docs/00-roadmap.md`.

## Docs

| File | What it covers |
|---|---|
| `docs/00-roadmap.md` | The plan, phase by phase, starting with the character sheet |
| `docs/01-rules-reference.md` | Every character-sheet formula, taken from the actual cell formulas in *Character Stats* (B42 onward) and the *Mechanics* tab |
| `docs/02-data-model.md` | Proposed Actor and Item types and their fields |
| `docs/03-character-sheet.md` | Layout and behaviour of the character sheet |
| `docs/04-compendium-data.md` | How the Google Sheet importer works: what it reads, how sheet data becomes compendium entries, and why it can't write to the sheet |
| `docs/QUESTIONS.md` | Open questions about the rules that block or shape the work |

## Target platform

- **Foundry VTT v14** (current stable line as of Oct 2026), with `minimum: 13` if that costs nothing.
- Plain ES modules, no build step at first. `TypeDataModel` for data, `ApplicationV2` + Handlebars for sheets.
- System id: `elaria`.

## Installing (for testing)

1. Copy or symlink this `Foundry` folder into your Foundry data folder as `Data/systems/elaria`. The folder name must be `elaria` to match the system id. On Windows, from an admin prompt:
   `mklink /D "%LOCALAPPDATA%\FoundryVTT\Data\systems\elaria" "A:\Elaria\Foundry"`
   (adjust the first path if your user data lives elsewhere). A symlink means edits here show up after a browser refresh.
2. Restart Foundry, create a world using **Elaria**, create an Actor of type **Character**.
3. Optional, for development: `node tools/test-rules.mjs` and `node tools/test-build.mjs <sheet link>` check the maths and the importer outside Foundry (needs Node 18+). Players and GMs never need these.

## Importing masteries from the Google Sheet

Everything happens inside Foundry; there's nothing to install and no files to edit.

1. Make sure the Google Sheet is shared as **Anyone with the link → Viewer** (Share → General access).
2. In Foundry, as GM: Compendium sidebar → **Import from Google Sheet** (also under Game Settings → Configure Settings → Elaria).
3. Paste the sheet's link and press **Check**. Foundry downloads a read-only copy of the sheet, converts every mastery tab, and shows what would be added, changed or removed, plus anything in the sheet worth a look (typos, unknown tags, links it couldn't make).
4. Press **Import**.

It creates seven world compendiums ("Elaria: Discipline Masteries", "… Elemental", "… Deity", "… Ancestry", "… Profession", "… Set", "… Bond"), each with a folder per discipline / element / god / race. Run it again whenever the sheet changes: entries are updated in place (stable ids, nothing duplicated), and masteries already on characters are untouched because they're copies. Hand-made entries in those compendiums are never removed. The converted data is also saved as `worlds/<world>/elaria/elaria-data.json` so you can see exactly what was imported.

**The sheet is never written to.** The only request the system makes to Google is an anonymous download of the "export as .xlsx" link (`module/importer/google-sheet.mjs`): a plain GET, no login, no cookies, no API key. Google only allows edits from a signed-in account with edit rights, so this request can't change the sheet even in principle.

Masteries shared by several disciplines (Wise, Speed Training …) are stored once, in the **Shared (several disciplines)** folder, and list every discipline they belong to. Shared masteries whose text differs between disciplines stay separate; the importer lists them.

## Rolling dice

Under the chat box are **Roll 3d6** and **Roll d20**.

- **Roll d20** rolls a plain d20 (background and social standing rolls).
- **Roll 3d6** opens the roll window, which every 3d6 roll uses (clicking a stat modifier on the sheet opens it with that stat chosen). It has:
  - **Character**: the selected token's actor, else your assigned character, else none.
  - **Stat**: whose modifier is added (default none).
  - **Add to roll**: a number or dice formula (`2`, `-1`, `1d4+1`).
  - **Injury / exhaustion**: the check penalty from the sheet.
  - **Crit chance / crit damage**: from the character's sheet, 0 with no character.
  - **Roll**, **Roll with Advantage**, **Roll with Disadvantage**. Advantage rolls the 3d6 twice and keeps the higher sum; disadvantage keeps the lower.
- The crit d100 is rolled once per roll, whatever the mode: it crits at or under the crit chance. A crit multiplies the result by 1 + crit damage % (A6), rounded down. The chat card then shows the result both **without** and **with** the crit.
- Results never go below 0.
- Clicking a stat's name works the same as clicking its modifier.
- Every roll card has a small ↻ button in its top right: it opens the roll window again with exactly the same settings (a d20 card just rolls again). Only the person who rolled and GMs see the card buttons.
- Shift-click a stat modifier on the sheet to roll it straight away with advantage, Ctrl-click with disadvantage.
- Roll privacy (public / GM / blind / self) follows the setting under the chat box.

### Masteries

- Clicking a mastery's name on the sheet (or its hotbar macro) *uses* it, in rules order:
  1. **Skill mod first** (masteries with a skill mod): the roll window opens for the skill mod roll. Its **No reaction** button skips the skill mod (the target didn't react, so the ability just hits) and goes straight to damage, or posts the mastery if it has no damage.
  2. After the skill mod roll, its chat card has a **Roll damage** button that opens the damage roll.
  3. Masteries with damage but no skill mod open the damage roll straight away; masteries with neither are posted to chat.
- **Several hits and targets.** The roll window has *Dice × hits per target*, *Targets* and *AoE*:
  - Every hit rolls its own dice: `2d6+Str x2` rolls 2d6 + Str twice for each target and adds them, so hits do different damage. The card lists each hit. "Add to roll" counts once unless **each hit** is ticked (stats always count per hit).
  - Crit is rolled once per target; a crit target takes every hit as a crit.
  - **AoE**: one damage roll shared by every target, each target with its own crit roll.
  - Targets default to the number of tokens you have targeted (and use their names on the card), else 1. Masteries fill in hits from `x3` and tick AoE when they have the AOE tag.
  - The skill mod roll from a multi-target card rolls one to-hit per target. For an AoE it rolls once, and that one roll is used against every target.
- Damage the importer couldn't fully read (`3d6+Wis/5d6+Wis`, `6d6+Sword Stacks Consumed`) still gets its first dice and stat; adjust the rest by hand.
- The window has a **Dice** field (3d6 unless a mastery sets it). Advantage rolls those dice twice and keeps the higher.
- Drag a mastery (from a sheet, the compendium or the Items sidebar) onto the hotbar to make a macro that uses it. Dropping a compendium mastery uses the selected token's character, else your assigned one.
- The mastery card has a dice button for damage masteries too.
- **Skill mod rolls.** A mastery's skill mod is its "hit chance" when the target reacts: roll 3d6 + skill mod against DC 10 + the skill mod of the target's reaction. Meet the DC and the ability hits and the reaction doesn't happen (the target still spends RAP and energy); miss and the reaction happens first. Posted mastery cards have **Roll skill mod** and **Roll damage** buttons. It opens the roll window with 3d6, the bonus and the stat filled in (for "Fin or Pre" the character's better stat), crit off, and the injury/exhaustion penalty on.
- Posting a damage mastery to chat also gives a **Roll damage** button.
- Macros can call `game.elaria.useMastery(uuid)` or `game.elaria.RollDialog.open({ dice, stat, bonus, label })`.

## Monsters

A simple **Monster** actor following the *Monster stat block* tab. When a GM creates an actor, **Monster** is preselected; players can only create characters (a GM can make a monster and give a player ownership in the usual Foundry way).

- **Header:** picture, name, type, power, size, elements, HP / FTG / MP (current / max, all typed in). GMs see the nature check DCs from the stat block (10 + Power for the overview, 8 + Power for HP/FTG/MP, 14 + Power for the stats, 12 + Power for loot, 16 + Power for abilities).
- **Stat block tab:** the 13 stats (modifier = stat ÷ 4; click a name or modifier to open the roll window), defence (AR, MAR, AAR, NAR, NMAR, elemental res) and combat (passive awareness, reactions per round, crit chance, crit damage, Mv). Crit and reactions feed the roll window and the combat tracker pips.
- **Abilities tab:** monster *abilities* (name, skill mod, damage, cost, tags, description, all optional). Click one to use it exactly like a mastery: skill mod first (with "No reaction"), then damage, or post to chat. Masteries can be dragged onto monsters too, and abilities can go on the hotbar.
- **Description & loot tab:** description, unique loot, loot tables.
- **Token tab:** token name, image, disposition, size and linking, plus a button for every other token setting. New monsters' tokens default to hostile and unlinked (each token has its own HP), with HP and FTG bars.

## Token bars

Tokens show **HP in red at the bottom**, and **MP in blue with FTG in green stacked under it at the top**. New characters and monsters default to HP as bar 1 and MP as bar 2; FTG is added automatically as a third bar (unless one of the two bars already shows it). A resource with a max of 0 (a monster with no mana) isn't drawn and the next bar moves up. When bars are shown (always, on hover, owner only …) is still Foundry's token setting.

## Combat tracker: reactions

Every combatant in the combat tracker (sidebar and popout) has a row of pips under its name, one per reaction (RAP) it has each round: 2, 3 at Awareness mod 6, 4 at mod 8, plus any bonus on the sheet. Creatures without an Elaria sheet get 2.

- Click a pip to cycle it: empty → **green** (passed reaction) → **red** (failed reaction) → empty. Right-click empties it.
- Only the combatant's owner and GMs can click; everyone sees the pips.
- All pips empty at the start of every round (when the round number changes).

### Reacting

Rolls are made from the player's side: when an enemy attacks a player, the player rolls to react (the enemy doesn't roll to hit). The **React** button at the bottom left of the hotbar opens the React window for the selected token, or the player's character if nothing is selected (or their only character).

- **Reacting to** sets the DC (Mechanics, "Reaction time goal numbers"): an action done to you `n + 10 + skill mod`; not done to you `n + 14 + skill mod`; an enemy leaving melee `n + 12 + skill mod`; your own action `n + 16`. Type the attacker's skill mod.
- **n** starts at 0 every round and rises by 2 for every *successful* reaction that round, so each pass makes the next reaction harder. It's filled in from the reaction pips. **Other DC change** covers the GM's call (head shot −2, back +1 …).
- Roll with Awareness by default (Overwatch can use Fin or Pre), plus any bonus and the injury/exhaustion penalty; advantage/disadvantage as usual.
- The card shows PASS or FAIL, and in combat it fills the reactor's next pip green or red. The window warns when no reactions are left this round.
- **Reaction masteries (rxn):** using one (sheet, hotbar, mastery card) first asks **Roll as a reaction** or **Use normally**. As a reaction, the React window opens for that character with the mastery shown at the top; a PASS card then has a **Use <mastery>** button that carries on with it (skill mod → damage, or chat). Masteries and abilities tagged *Reaction* (or *Rxn*) count as rxn even if the sheet didn't mark them; re-import to update the compendium copies (17 masteries on the current sheet).

## Browsing the compendiums

The Compendium sidebar has **Masteries** and **Gear** buttons at the top. They open the same search window as *Add mastery* / *Add item* (search, compendium and category/kind filters). With a token selected (or your assigned character) the + buttons add to it; otherwise the window just browses, and rows can be dragged onto any sheet or the hotbar.

## Icons

Imported masteries use round purple medallions (a different glyph per compendium: disciplines, elements, deities, ancestries, professions, sets, bonds) and gear uses square leather tiles (weapon, armour, trinket, class trinket, item; unique gear in red). They live in `assets/icons/` and are made from [game-icons.net](https://game-icons.net) glyphs by Lorc and Delapouite, CC BY 3.0 (see `assets/icons/LICENSE.txt`). Re-import to update the compendium icons; items already on characters keep theirs.

## Gear and inventory

The importer also reads the **Gear** tab (the same way the website did) and fills four more compendiums: **Weapons**, **Armour**, **Trinkets** (including the class trinkets, in a *Class Trinkets* folder by tier) and **Unique Gear**. Each evolution tree is a folder (Straight Sword, Light Armour, Metal Trinket …); every item keeps its tier, level, base attack and damage type, AAR and weight, affinity, equip load, breakpoint, effects, description, materials and tags, and says what it evolves from.

Characters have an **Inventory** tab (Character Stats rows 106+):

- **Coins:** platinum, gold, silver, copper, ironne.
- **Belt** (weapons ready to use, 3 slots), **Armour** (worn, 2), **Trinkets** (worn, 5, at most 1 class trinket) and the **Bag** (max slots = (equip load + bag rank) × 4; each entry takes one slot and has a quantity). Over-full sections turn red.
- The circle on each row moves gear between the bag and the belt (weapons) or worn (armour, trinkets). **Worn armour adds its AAR** to the character's AAR, and so to AR and MAR (broken armour doesn't count). A manually typed AAR from older versions moved into the AAR Bonus column.
- Gear that needs a higher equip load than the character has is marked *Too heavy*; gear above the character's level shows its level in red.
- Click a weapon's name to roll its base attack in the roll window (crit, hits, targets as usual); other gear is posted to chat. Gear can go on the hotbar too.
- **Add item** asks for a blank item (potions, materials, loot …) or the compendium browser for gear. Gear can also be dragged in from a compendium, the Items sidebar or another character, or a whole folder at once.

## Adding masteries to a character

- **Add mastery** on the Masteries tab asks whether to *choose from the compendium* or *create a new one*.
- The compendium picker searches every Item compendium (and the world's Items) by name, source or tag, with filters for compendium, category, "only this character's sources" and "up to this character's level". Press **+** to add, click a name to read it, or drag a row onto the sheet. Masteries the character already knows show a tick and can't be added twice.
- You can also drag a mastery straight from a compendium, the Items sidebar or another character onto the sheet. Dragging a whole compendium **folder** (e.g. one discipline) adds every mastery in it after a confirmation.
- Added masteries arrive unequipped.

Mastery sheets open as a read-only card (category, level, value, skill mod, damage, cost, usage, requirements, description, tags). Users who can edit the mastery get a pen button to switch to the edit form, and a tick to go back. A newly created mastery opens straight in the edit form.

## Folder layout

```
Foundry/
  system.json                 manifest
  elaria.mjs                  entry point (registers everything in Hooks.once("init"))
  module/
    config.mjs                ELARIA constants and every dropdown list from the sheet
    rules.mjs                 all formulas as pure functions (no Foundry needed)
    data/
      actor-character.mjs     CharacterData: stored fields + prepareDerivedData
      item-mastery.mjs        MasteryData
      actor-monster.mjs       MonsterData
      item-ability.mjs        AbilityData (monster abilities)
      item-gear.mjs           GearData (weapons, armour, trinkets, items)
    documents/
      actor.mjs               ElariaActor: rollStat, modifyResource (temp first), token bars
      item.mjs                ElariaItem: toChat
    sheets/
      character-sheet.mjs     ApplicationV2 character sheet
      mastery-sheet.mjs       ApplicationV2 mastery sheet (read-only view + edit form)
      monster-sheet.mjs       monster sheet (stat block, abilities, description & loot, token)
      ability-sheet.mjs       monster ability sheet
      gear-sheet.mjs          gear sheet
    canvas/
      token.mjs               token bars: HP red (bottom), MP blue + FTG green (top)
    combat/
      reactions.mjs           reaction pips in the combat tracker, reset each round
      react-button.mjs        React button on the hotbar
    dice/
      check.mjs               3d6 / d20 rolls, crit, chat cards
      chat-buttons.mjs        Roll 3d6 / Roll d20 under the chat box
      chat-cards.mjs          reroll / skill mod / damage buttons on chat cards
      skill.mjs               mastery skill mod rolls
    helpers/
      masteries.mjs           copy masteries onto an actor (drag-drop and picker), duplicate check
      hotbar.mjs              mastery hotbar macros (game.elaria.useMastery)
  templates/actor/            header, stats, masteries, bio tabs (+ parts/mastery-row)
  templates/item/mastery.hbs
  styles/elaria.css
  lang/en.json
    importer/
      google-sheet.mjs        the only network code: read-only .xlsx download of the sheet
      xlsx.mjs                reads the .xlsx (built-in unzip + XML scan, no libraries)
      convert.mjs             sheet tabs → mastery data (one document per discipline, element, god, race …)
      difflib.mjs             fuzzy name matching used to link set-mastery requirements
      build.mjs               mastery data → compendium items and folders
    apps/
      data-importer.mjs       the GM "Import from Google Sheet" window
      mastery-picker.mjs      "Add masteries" compendium browser
      roll-dialog.mjs         the 3d6 roll window
      react-dialog.mjs        the React window and reaction roll
  templates/apps/data-importer.hbs, mastery-picker.hbs, roll-dialog.hbs
  tools/test-rules.mjs        checks rules.mjs against the Google Sheet sample character
  tools/test-build.mjs        whole importer without Foundry: node tools/test-build.mjs <sheet link | file.xlsx>
  docs/
```


