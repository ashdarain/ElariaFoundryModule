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

## Installing

Elaria is a Foundry **game system** (not a module).

1. In Foundry's setup screen: **Game Systems → Install System**.
2. Paste the manifest URL at the bottom of the window and press **Install**:
   `https://github.com/<owner>/<repository>/releases/latest/download/system.json`
3. Create a world using **Elaria**.

Foundry checks the same link for updates, so new releases show up under *Update* on the Game Systems tab.

## Development

1. Clone this repository into your Foundry data folder as `Data/systems/elaria`, or symlink it there. The folder name must be `elaria` to match the system id, whatever the repository is called. On Windows, from an admin prompt:
   `mklink /D "%LOCALAPPDATA%\FoundryVTT\Data\systems\elaria" "C:\path\to\this\repository"`
   (adjust the first path if your user data lives elsewhere). A symlink means edits show up after a browser refresh.
2. Optional: `node tools/test-rules.mjs` and `node tools/test-build.mjs <sheet link or .xlsx>` check the maths and the importer outside Foundry (Node 18+). Players and GMs never need these.

## Publishing a release

1. Commit and push your changes.
2. On GitHub: **Releases → Draft a new release**, create a tag such as `v0.11.0`, and **Publish release**.
3. The workflow in `.github/workflows/release.yml` sets the version and links in `system.json`, builds `elaria.zip`, and attaches both to the release (a minute or two; see the **Actions** tab).

The manifest URL for GMs never changes: `https://github.com/<owner>/<repository>/releases/latest/download/system.json`.

## Importing masteries from the Google Sheet

Everything happens inside Foundry; there's nothing to install. No sheet link ships with the system: each GM pastes the link to their own copy of the sheet.

1. Make sure the Google Sheet is shared as **Anyone with the link → Viewer** (Share → General access).
2. In Foundry, as GM: Compendium sidebar → **Import from Google Sheet** (also under Game Settings → Configure Settings → Elaria).
3. Paste the sheet's link and press **Check**. Foundry downloads a read-only copy of the sheet, converts every mastery tab, and shows what would be added, changed or removed, plus anything in the sheet worth a look (typos, unknown tags, links it couldn't make).
4. Press **Import**.

**No link, or the sheet isn't shared?** Download it from Google Sheets with **File → Download → Microsoft Excel (.xlsx)**, then, under the link box, either **Choose .xlsx on this computer** (read straight from your computer, nothing is uploaded) or **Browse Foundry files** (an .xlsx you've put in Foundry's Data folder, e.g. with the file browser's Upload button). While a file is chosen, Check reads it instead of the link; the × next to it goes back to the link.

It creates up to twelve world compendiums (eleven listed here, plus **Elaria: Craftables** from the Professions tab, see *Crafting*): seven for masteries ("Elaria: Discipline Masteries", "… Elemental", "… Deity", "… Ancestry", "… Profession", "… Set", "… Bond"), each with a folder per discipline / element / god / race, and four for gear (see *Gear and inventory*). Run it again whenever the sheet changes: entries are updated in place (stable ids, nothing duplicated), and masteries already on characters are untouched because they're copies. Hand-made entries in those compendiums are never removed. The Backgrounds tab isn't a compendium: it's saved in the world for the Background section of character sheets (see *Character sheet: max resources and backgrounds*). The converted data is also saved as `worlds/<world>/elaria/elaria-data.json` so you can see exactly what was imported.

### Import config

`import-config.json` in the system folder changes what the importer brings in. It's optional: delete any line (or the whole file) to use the defaults. Edit it with any text editor, save, and press **Check** again; no restart needed.

| Setting | What it does |
|---|---|
| `defaultSheetLink` | A link to prefill the importer with in new worlds. Leave `""` to paste it in Foundry instead (the link is then saved in the world only). |
| `compendiums` | Set any of `discipline`, `elemental`, `deity`, `ancestry`, `profession`, `set`, `bond`, `weapons`, `armour`, `trinkets`, `uniques`, `crafting`, `backgrounds` to `false` to skip it. Skipped compendiums are left exactly as they are. |
| `tabs` | The tab names the importer reads: `general`, `disciplines` (list), `disciplineIndex`, `elemental`, `set`, `bond`, `deity`, `ancestry`, `professions` (list), `tags`, `gear`, `backgrounds`. Rename here if a tab is renamed in the sheet; set one to `""` to skip that tab. |
| `ignoredTabs` | Tabs that look like mastery tabs but should be skipped (old copies, helper tables). |
| `autoDetectDisciplines` | `true`: any new "… Masteries" tab not listed is converted as a discipline. |
| `gearBaseAliases` | Names in the Gear tab's "Base Weapons" table that differ from their evolution tree (e.g. `"fist": "cestus"`). |

The file must stay valid JSON (double quotes, commas between entries, no trailing comma); if it isn't, the importer says so and imports nothing. A system update replaces this file, so keep a copy of your changes.

**The sheet is never written to.** The only request the system makes to Google is an anonymous download of the "export as .xlsx" link (`module/importer/google-sheet.mjs`): a plain GET, no login, no cookies, no API key. Google only allows edits from a signed-in account with edit rights, so this request can't change the sheet even in principle.

Masteries shared by several disciplines (Wise, Speed Training …) are stored once, in the **Shared (several disciplines)** folder, and list every discipline they belong to. Shared masteries whose text differs between disciplines stay separate; the importer lists them.

## Rolling dice

Under the chat box are **Roll 3d6** and **Roll d20**.

- **Roll d20** rolls a plain d20 (background and social standing rolls).
- **Roll 3d6** opens the roll window, which every 3d6 roll uses (clicking a stat modifier on the sheet opens it with that stat chosen). It has:
  - **Character**: the selected token's actor, else your assigned character, else none.
  - **Stat**: whose modifier is added (default none).
  - **Add to roll**: one or more parts, each a number or dice formula with an optional name after it (`2`, `-1`, `1d4+1`, `2d6 Fire 4 Wind`, `1d4 Bless`). Spaces or + separate the parts. Skill mod rolls start with **each hit** ticked (the skill mod's bonus counts on every target's to-hit roll); damage rolls start with it unticked. With several separate targets (not AoE) and it unticked, the bonus is added **once**: **Bonus goes to** picks which target gets it; tick **each hit** to give it to every hit of every target. The chat card shows every part on its own ("+ 7 2d6 Fire · + 4 Wind"). On damage rolls, a part named after a damage type, element or form (Fire, Wind, True, Magical, Divine …) is extra damage of that type: the card shows the total split by type, and applying it gives that part its own armour and resistance (see *Applying damage*). Other names (Bless, Rage …) are just labels.
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
  - **AoE**: one damage roll and **one crit roll** shared by every target; the card shows a single result and who it hits. Applying it still uses each target's own armour and resistance.
  - Targets default to the number of tokens you have targeted (and use their names on the card), else 1. Masteries fill in hits from `x3` and tick AoE when they have the AOE tag.
  - The skill mod roll from a multi-target card rolls one to-hit per target. For an AoE it rolls once (the skill window opens with AoE ticked and the number of targets), and that one roll is judged against every target: each still gets its own Pass / Fail.
- Damage the importer couldn't fully read (`3d6+Wis/5d6+Wis`, `6d6+Sword Stacks Consumed`) still gets its first dice and stat; adjust the rest by hand.
- The window has a **Dice** field (3d6 unless a mastery sets it). Advantage rolls those dice twice and keeps the higher.
- Drag a mastery (from a sheet, the compendium or the Items sidebar) onto the hotbar to make a macro that uses it. Dropping a compendium mastery uses the selected token's character, else your assigned one.
- The mastery card has a dice button for damage masteries too.
- **Skill mod rolls.** A mastery's skill mod is its "hit chance" when the target reacts: roll 3d6 + skill mod against DC 10 + the skill mod of the target's reaction. Meet the DC and the ability hits and the reaction doesn't happen (the target still spends RAP and energy); miss and the reaction happens first. Posted mastery cards have **Roll skill mod** and **Roll damage** buttons. It opens the roll window with 3d6, the bonus and the stat filled in (for "Fin or Pre" the character's better stat), crit off, and the injury/exhaustion penalty on.
- **Hit or miss (skill mod cards).** A skill mod card has a row per target (named after your targeted tokens, else Target 1, 2 …; an AoE's one roll gets a row for every target). The **GM** presses **Pass** (hit) or **Fail** (missed) on each row, as with reactions, since the DC depends on the target's reaction; pressing it again clears it. Everyone sees HIT / MISS. The card's **Roll damage** waits until at least one target is hit, then rolls damage for the hit targets only, so only they get **Apply** buttons. ("No reaction" skips this: every target is hit.)
- Posting a damage mastery to chat also gives a **Roll damage** button.
- Macros can call `game.elaria.useMastery(uuid)` or `game.elaria.RollDialog.open({ dice, stat, bonus, label })`.

## Character sheet: max resources and backgrounds

**Max HP, Mana and Fatigue.** With the sheet unlocked (lock icon), a small bonus box appears next to each resource's maximum. The bonus (negative to lower it) is added to the formula, so the maximum still updates when Con / Wis / Res, level or exhaustion change. A max with a bonus shows in the accent colour; its tooltip gives the formula value and the bonus.

**Background** (Bio tab, beside Burst). Choose the type (Nobility, Military, Civilian, Criminal), then press **d20** to roll social standing (posted to chat and filled in) or type the number yourself; you may move the roll by Demeanor or Speechcraft mod ×2 (minimum 1). The matching background's **Description**, **Perk** and **Starting inventory** are shown below it, and its name is stored on the character. The data comes from the sheet's Backgrounds tab, saved when the GM imports; until then there's a plain text box. **Biography** is the large box under both.

## Ancestry and heritage

On the Bio tab, **Heritage** only lists the chosen race's heritages (Ancestry tab), and changing the race clears a heritage it doesn't have. Under it are the heritage's **stat modifiers** as written ("+1 Strength or Precision, -1 Smarts"); for an "or" pick which stat gets it. They're applied to the character: stat modifiers (the Mod column's tooltip shows the heritage part), NAR / NMAR / AR / MAR, crit chance / damage and max HP / MP / FTG. Older heritage names ("Bushido") are matched to the sheet's ("Bushido Clan"). The list is built in and refreshed by every import.

## Monsters

A simple **Monster** actor following the *Monster stat block* tab. When a GM creates an actor, **Monster** is preselected; players can only create characters (a GM can make a monster and give a player ownership in the usual Foundry way).

- **Header:** picture, name, type, power, size, elements, HP / FTG / MP (current / max, all typed in), and an **Initiative** button (3d6 + Fin). It rolls for the monster's combatants in the current combat; if it isn't in one, its tokens on the scene (the selected ones first, so unlinked copies work) are added and roll; with no token on the scene the roll is just posted to chat. GMs see the nature check DCs from the stat block (10 + Power for the overview, 8 + Power for HP/FTG/MP, 14 + Power for the stats, 12 + Power for loot, 16 + Power for abilities).
- **Stat block tab:** the 13 stat modifiers, typed in directly (monsters have no stat points; click a name or the die to open the roll window). **Defence** and **Combat** tables work like a character's: each number is worked out from the modifiers (NAR = Stf, NMAR = Wis, AR = NAR + AAR, MAR = NMAR + AAR, crit chance = Lck × 5 %, crit damage = Ins × 10 %, Mv = Fin + 4, reactions from Awa, passive awareness = Awa + 10) with a **Bonus** column on top; AAR has no formula for monsters (no armour items), so type it as a bonus. Monsters made before this keep their numbers (the difference moved into Bonus). Crit and reactions feed the roll window and the combat tracker pips.
- **Resistances** (stat block tab, laid out like characters'): a **Mortal / Divine / Demonic** toggle sets the built-in form resistances (Mortal: Divine +25 %, Demonic −25 %; Divine: Demonic +25 %, Mortal −25 %; Demonic: Mortal +25 %, Divine −25 %). The elements typed in the header (e.g. "Fire, Dark") add their built-in elemental resistances from Mechanics' *Elemental Weaknesses* table (several elements add together). Each cell shows built-in → your bonus → total, green for resist, red for weak. An old typed *Elemental Res* note stays visible under the grid until you clear it.
- **Abilities tab:** monster *abilities* (name, skill mod, damage, cost, tags, description, all optional). Click one to use it exactly like a mastery: skill mod first (with "No reaction"), then damage, or post to chat. Only a Damage field with dice in it (e.g. `2d6+Str`) counts as damage: blank, "—", "None" or plain text means there's nothing to roll, so the ability (or mastery) just posts its name and description to chat. Masteries can be dragged onto monsters too, and abilities can go on the hotbar.
- **Description & loot tab:** description, unique loot, loot tables.
- **Hidden rolls:** players who don't own a monster see only the results of its rolls (totals, per-hit values, crit or not) and its ability descriptions. The dice, formula, modifiers, crit chance, crit multiplier and an ability's skill mod / damage / cost are shown to the GM (and the monster's owners) only. Foundry's own roll messages for monsters, such as initiative, hide their formula and dice the same way.
- **Token tab:** token name, image, disposition, size and linking, plus a button for every other token setting. New monsters' tokens default to hostile and unlinked (each token has its own HP), with HP and FTG bars.

## Bestiary (monster importer and monster search)

GMs get two buttons at the top of the **Actors** tab:

- **Import monsters** reads the Bestiary sheet (link, or a downloaded .xlsx from this computer or Foundry's files, like the other importer; read-only). It doesn't go by tab names: **every tab is searched for the monster stat block pattern** (the name, then a `Type:` cell with `Power:` beside it, the Elements / Creature Size / description, Hp / Ftg / Mp, the stat modifiers, AR … Mv, Elemental Res, Unique Loot / Loot Tables and the Name | Skill mod | Cost | Description | Dmg | Tags abilities table). New tabs and monsters are picked up by themselves; the empty template is skipped.
  - Each monster becomes a Monster actor in the **Bestiary** folder (name changeable in the window), in a sub-folder per **power** (from the stat block's Power, not the tab): Power 1, Power 2 …. Abilities become its ability items.
  - The stat block's numbers are kept exactly: the monster sheet works defence and combat numbers out from the modifiers, so the difference goes into its Bonus column; Elemental Res likewise (the elements and form give the built-in part). Divine / Demonic in the type or elements sets the form. Crit cells formatted as % are read correctly.
  - **Check** shows how many per power are new / changed / the same, and lists anything odd in the sheet. **Import** creates and updates; ticking *Remove …* deletes imported monsters no longer in the sheet. Re-importing keeps each monster's picture and token settings. Monsters you make yourself are never touched.
- **Monsters** opens a search window over every monster in the world and in Actor compendiums: search (name, type, element, size), power range, type, element, size, where it's from, and sort by power / name / HP. **Drag a row onto the map** to place a token (or onto the combat tracker); click a name to open the sheet.

`node tools/test-bestiary.mjs path/to/bestiary.xlsx` lists what the importer finds and checks every monster's numbers come out as in the sheet.

**Monster sheet:** the Type box suggests Mob / Minion / Elite / Boss, and the GM sees a power guide under the header from the Notes tab (e.g. *Power 4 is built for party level 7–9: players have 34–49 HP, deal 15–25 (4–6d6), AR/MAR 1–8; highest monster mod about 8*).

## Token bars

Tokens show **HP in red at the bottom**, and **MP in blue with FTG in green stacked under it at the top**. New characters and monsters default to HP as bar 1 and MP as bar 2; FTG is added automatically as a third bar (unless one of the two bars already shows it). A resource with a max of 0 (a monster with no mana) isn't drawn and the next bar moves up. When bars are shown (always, on hover, owner only …) is still Foundry's token setting.

## GM Tools

GMs get a **GM Tools** button left of *React* at the bottom left of the hotbar. The window has a **Players** tab:

- **Players** (top): add characters (the list puts those with an online owner first; **Add the party** adds every character a player owns; or drag a character from the Actors sidebar). Each character gets a card where you line up what they'll get:
  - **Masteries** / **Gear** open the search window, whose + buttons line the item up for that character; masteries and gear can also be dragged onto the card (from compendiums, the Items sidebar or the search window; a whole folder works too).
  - **Materials** opens a table (material × tier) and **Coins** a row of coin boxes; the amounts are added to what's lined up.
  - Nothing changes until **Give** (one card) or **Give to everyone**: then the items go into the character's sheet (masteries unequipped, gear in the bag; known masteries are skipped), materials and coins are added, and a chat card lists what they received. × on a chip removes it; **Clear** empties the card. What's lined up is kept until given, even after a reload.
- **Party** (bottom): **Level up**, **Long rest** (full HP / MP / FTG, +1 life point, −1 exhaustion, −1 injury), **+ Exhaustion**, **+ Injury**, **− Life point**; the × box sets how many (levels, exhaustion, injuries, life points). They apply to the **Whole party** (every player-owned character) or only the **Ticked players** (the tick on each card above). A table shows each party member's level, HP, life points, exhaustion and injuries, and each action posts a chat card.

The **Combat** tab shows every combatant of the current combat in turn order, as a grid of cards (player characters with a blue border, everything else red; the current turn glows):

- portrait (click to select and pan to the token), name, initiative, level / power; characters also show injuries, exhaustion and life points;
- **HP / MP / FTG** with bars: type a value, or use − / + (by the **Amount** box at the top; − takes temp first, like damage);
- **Reactions**: the same pips as the combat tracker (click to cycle);
- **Status**: the token's status effects (click one to remove it) and a + list of Foundry's status effects to add one (Elaria's own status effects come later);
- 👁 hide / show (token and tracker entry together) and ☠ defeated.

It updates by itself as HP, statuses, turns and combatants change.

## Crafting

The character sheet's **Crafting** tab:

- **Materials**: how many of each material the character has, per tier (T1–T5): Metal, Wood, Leather, Fabric, Bone, Artifact, Soul, Alchemical Ingredient, Food Ingredient, Ether Core. Type the counts in; crafting takes them off.
- **Recipes** for the profession chosen on the Bio tab, sorted by required level, with the materials each costs (green: you have enough at that tier; red: not). A recipe's tier is the tier of the materials it uses.
  - Most professions craft from the Professions tab's lists, imported as the **Elaria: Craftables** compendium (a folder per profession).
  - **Enchanters** craft the evolution gear from the Gear tab (weapons, armour, trinkets; the materials listed are what it takes to evolve to that item, at its tier). If the character has the item it evolves from, **Evolve** swaps it for the new one (keeping its belt / worn spot).
  - **Instructors** craft the class trinkets ("2 Any": pick which material pays).
- **Craft** asks to confirm, takes the materials, adds the item (crafted items of the same name stack; "Ammo x5" makes 5) and posts it to chat. Players need the materials and the level; the GM can craft anyway.
- Search, **Only what I can craft**, and **Show above level n**. The ↻ button re-reads the compendiums after an import.

Not automated: the Exorcist / Necromancer tier conversions and the profession perks (type the new counts in).

## Applying damage

Damage rolls from masteries, monster abilities and weapons can be applied straight from the chat card, following Mechanics' *Damage Modifier*:

`final = (dmg rolled + flat dmg mods − relevant armour) × (crit dmg + other % mods − resistance)`

- The multiplier terms are **added**: a crit with +50 % crit damage against 25 % resistance is × (1.5 − 0.25) = × 1.25; no crit against 25 % resistance is × 0.75.
- **Resistance over 100 % heals:** every % over 100 turns the damage into healing. 4 Fire against 150 % Fire resistance is 4 × (1 − 1.5) = −2, so the target heals 2 (the card's button turns green: **Heal <name> for 2**). Healing raises HP up to its max and leaves temp HP alone; Undo takes it back. A crit can cancel it out (× (1.5 − 1.5) = 0).
- Armour comes off **every hit** separately; a hit never goes below 0. A once-only bonus (and the injury penalty) counts on the first hit by default; in the confirm window, the **Hit 1 / Hit 2 …** toggles move it to another hit (it matters when weak hits are stopped by armour). Typed bonus parts (`2d6 Fire`) are their own damage: their own armour (by their type) and their own resistance, with the same crit. The result is **rounded to the nearest whole number** (halves away from 0).
- **Armour by damage type:** Physical / Slashing full AR · Piercing ½ AR · Blunt AR without AAR · Chopping AR without NAR · Magical MAR · Magical Piercing ½ MAR · Magical Chopping MAR without NMAR · True: no armour and no resistance · Toxic: only the target's Con mod. The *AR Piercing* tag ignores all armour, *AAR Piercing* ignores AAR.
- **Resistance** = the target's resistance to the damage's element + to its form (Mortal by default).
- **Damage type** is read from the tags (Physical, Slashing, …, Magical, an element, Divine / Demonic, True Damage, Toxic; a weapon's damage type text like "Phy. Slashing"). An element without anything physical counts as magical; nothing at all counts as Physical, Mortal. *Weapon Damage* takes the type of the first weapon on the belt; *Elemental* asks for the element. The roll window shows the type (Damage type section) so it can be changed before rolling.

On the card, each targeted token gets **Apply n to <name>**, with n worked out for that target (hover for the breakdown). Clicking asks to confirm (the amount can be changed), then takes it from temp HP first, then HP. Afterwards the row shows **n applied · Undo**, and the same card can't be applied to that token twice. Without targets, **Apply to selected token(s)** uses the tokens selected when you click.

- The **GM** can apply any damage to anyone; **players** only to actors they own (e.g. a monster's hit on their own character). Players never see a monster's breakdown, only the number.
- Hitting **0 HP** only prompts: characters can take 1 injury; monsters can be marked defeated.
- Not automatic yet: hit locations (head, arms, legs), bleed from Slashing, Frozen's half damage, Scorch, blocking into a breakpoint, healing and lifesteal. Change the amount in the confirm window for those.

`node tools/test-damage.mjs` checks the maths.

## Combat tracker: reactions

Every combatant in the combat tracker (sidebar and popout) has a row of pips under its name, one per reaction (RAP) it has each round: 2, 3 at Awareness mod 6, 4 at mod 8, plus any bonus on the sheet. Creatures without an Elaria sheet get 2.

- Click a pip to cycle it: empty → **green** (passed reaction) → **red** (failed reaction) → empty. Right-click empties it.
- Only the combatant's owner and GMs can click; everyone sees the pips.
- All pips empty at the start of every round (when the round number changes).

### Reacting

Rolls are made from the player's side: when an enemy attacks a player, the player rolls to react (the enemy doesn't roll to hit). The **React** button at the bottom left of the hotbar opens a list for the selected token, or the player's character if nothing is selected (or their only character): a **General Reaction** plus every reaction (rxn) mastery or ability the unit has (unequipped masteries are greyed and listed last). Picking one opens the React window.

- **Reacting to** says what kind of action it is; it doesn't change the roll, it tells the GM which DC applies (Mechanics, "Reaction time goal numbers"): an action done to you `n + 10 + attacker's skill mod`; not done to you `n + 14 + skill mod`; an enemy leaving melee `n + 12 + skill mod`; your own action `n + 16`. **n** starts at 0 every round and rises by 2 for every *successful* reaction that round.
- Roll with Awareness by default (Overwatch can use Fin or Pre), plus any bonus and the injury/exhaustion penalty; advantage/disadvantage as usual.
- Players never see the DC. The card shows the total and waits; the GM sees the DC formula (with this round's n) and **Pass** / **Fail** buttons, and pressing one updates the card for everyone and, in combat, fills the reactor's next pip green or red. Pressing the other button later changes the verdict and that same pip. The windows warn when no reactions are left this round.
- **Reaction masteries (rxn):** using one (sheet, hotbar, mastery card) first asks **Roll as a reaction** or **Use normally**. As a reaction, the React window opens with the mastery shown at the top; once the GM marks it passed, the card gets a **Roll damage** button (the mastery's damage, e.g. 3d6 + Str); the reaction roll takes the place of the skill mod roll. With no damage, **Use <mastery>** posts it to chat instead. Masteries and abilities tagged *Reaction* (or *Rxn*) count as rxn even if the sheet didn't mark them.

## Browsing the compendiums

**Making a compendium:** the Create Compendium window's Document Type list has **Masteries (Item)** and **Gear (Item)** above *Item*. Either makes an Item compendium that holds only that kind: its Create Item button makes a mastery / gear straight away, the other kind can't be added, and it gets the matching banner. (The imported compendiums behave the same way.)

The Compendium sidebar has **Masteries** and **Gear** buttons at the top. They open the same search window as *Add mastery* / *Add item* (search, compendium and category/kind filters). With a token selected (or your assigned character) the + buttons add to it; otherwise the window just browses, and rows can be dragged onto any sheet or the hotbar.

The search window has:

- **Search** (name, source, tags), with **Descriptions** to search the description / effect text too; **compendium**, **category** (masteries) or **kind** (gear), and **Sort** (name, level, value or source; gear: name, level, tier, AAR, equip load).
- **More filters** (the number shows how many are on):
  - Masteries: **source type** (discipline, elemental, deity, ancestry, profession, set, bond, general) and **source** (e.g. one discipline, with counts), **value**, **reaction** (rxn only / none), **rolls** (deals damage / no damage / has a skill mod), **cost** (FTG, MP, HP, free), **AoE**, **Multi-hit**, **Hide already known**.
  - Gear: **family**, **tier** range, **armour weight**, **affinity**, **class trinkets** (only / none), **max equip load**, and **Fits** (only what the character can wield).
  - Both: **damage type** (Physical or Magical of any kind, a specific type, an element, Divine / Demonic; read from the tags as for applying damage), **required level** range, and **must have tags** (pick any number; results need all of them, and matching tags are highlighted).
- Results come 150 at a time: **Show more** / **Show all** at the bottom of the list. Set masteries count under the *Set* source type even though their sources are the disciplines they need (the **Source** list then shows those disciplines).
- **Only this character's sources** and **Up to level n** when adding to a character. The filter-clear button resets everything.

## Icons

Imported masteries use round purple medallions (a different glyph per compendium: disciplines, elements, deities, ancestries, professions, sets, bonds) and gear uses square leather tiles (weapon, armour, trinket, class trinket, item; unique gear in red). They live in `assets/icons/` and are made from [game-icons.net](https://game-icons.net) glyphs by Lorc and Delapouite, CC BY 3.0 (see `assets/icons/LICENSE.txt`). Re-import to update the compendium icons; items already on characters keep theirs.

## Gear and inventory

The importer also reads the **Gear** tab and fills four more compendiums: **Weapons**, **Armour**, **Trinkets** (including the class trinkets, in a *Class Trinkets* folder by tier) and **Unique Gear**. Each evolution tree is a folder (Straight Sword, Light Armour, Metal Trinket …); every item keeps its tier, level, base attack and damage type, AAR and weight, affinity, equip load, breakpoint, effects, description, materials and tags, and says what it evolves from.

Characters have an **Inventory** tab (Character Stats rows 106+):

- **Coins:** platinum, gold, silver, copper, ironne.
- **Belt** (weapons ready to use, 2 slots), **Armour** (worn, 1), **Trinkets** (worn, 5, at most 1 class trinket) and the **Bag** (max slots = (equip load + bag rank) × 4; each entry takes one slot and has a quantity). Over-full sections turn red. The coins show their total in silver beside them (copper and ironne as decimals); untick **Total** in edit mode to hide it.
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
elaria/
  system.json                 manifest (version and links filled in by the release workflow)
  import-config.json          optional importer settings (see Import config)
  .github/workflows/release.yml   builds elaria.zip and the manifest when you publish a GitHub release
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


