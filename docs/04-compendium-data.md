# Mastery compendiums from the Google Sheet

How the in-Foundry importer turns the Elaria Google Sheet into compendiums. Everything runs inside Foundry, in the GM's browser: nothing to install, no files to copy.

```
Google Sheet ──(read-only .xlsx download)──▶ xlsx.mjs ──▶ convert.mjs ──▶ build.mjs ──▶ world compendiums
                 google-sheet.mjs                 (tabs → mastery data)  (data → items)   + worlds/<world>/elaria/elaria-data.json
```

## 1. Reading the sheet: read-only

`module/importer/google-sheet.mjs` is the only code in the system that talks to Google.

- It accepts a Google Sheets link (or bare id) and turns it into exactly one URL:
  `https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx`. That's Google's "File → Download → Microsoft Excel" link, which returns a copy and has no way to change anything.
- It sends a plain `GET` with no body and `credentials: "omit"`: no cookies, no Google login, no API key. Google only accepts edits from a signed-in account with edit rights, so the request can't change the sheet even in principle.
- Links that aren't `https://docs.google.com/spreadsheets/d/…` (other sites, Google Docs, etc.) are rejected before any request is made.
- The sheet must be shared as **Anyone with the link → Viewer**. If it isn't, Google returns a sign-in page instead of a spreadsheet, and the importer says so.

Checked on 2026-10-30: from a browser page, Google serves this export with the cross-site permission browsers need, so the download works from Foundry. The live sheet downloaded in a real browser gave a cell grid identical (same SHA-256) to a copy fetched separately.

## 2. Reading the .xlsx

`xlsx.mjs` unzips with the browser's built-in `DecompressionStream` and reads the sheet XML directly. No libraries. It returns each tab as a grid of text with:
- formula cells as their last calculated value;
- booleans as `TRUE` / `FALSE`;
- whole numbers without `.0`;
- date-formatted cells as `YYYY-MM-DD HH:MM:SS`.

## 3. Converting tabs

`convert.mjs` finds the mastery tables on each tab and produces one document per discipline (plus General), element / element pair / "any", deity (plus Demi-God), race (with heritages), and profession, plus one each for set and bond masteries. Along the way it:
- normalises tags against the **Tags** tab;
- parses skill mods, damage dice, costs ("Costs 3 ftg") and usage limits ("once per battle"), always keeping the raw text;
- links shared masteries (`alsoIn`) and resolves set-mastery requirements to the masteries they name, with fuzzy matching for small typos;
- works out which "Profession: X" mastery unlocks each profession;
- collects side notes next to tables as designer notes or appendices.

Anything it had to guess about is reported in the importer under **Things to check in the sheet**. Tags that aren't on the Tags tab are listed too.

**Which tabs:** the list lives in `DEFAULT_CONFIG` at the top of `convert.mjs`. A new tab named `<Something> Masteries` is picked up automatically as a new discipline and mentioned in "Things to check". Old copies and helper tabs are ignored: Set Masteries (Discontinued), Summoner Masteries old, the sortable/data tables.

Parity: the converter was checked against an earlier conversion tool on the same sheet. All 156 documents were identical, with the same 96 warnings.

## 4. Building compendium entries

`build.mjs` turns those documents into Foundry Items and Folders.

| Compendium | Folders | Category | Notes |
|---|---|---|---|
| Elaria: Discipline Masteries | one per discipline, General, and "Shared (several disciplines)" | from the table | Shared masteries are one entry listing every discipline in `system.sources` (A25). Copies whose text differs stay separate and are listed. |
| Elaria: Elemental Masteries | Prime Elements / Combos / Any Element → element | from the table | |
| Elaria: Deity Masteries | one per god | `any` | |
| Elaria: Ancestry Masteries | one per race, a sub-folder per heritage | `any`; heritage abilities `none` | Heritage abilities are value 0, no level gate, tagged "Heritage" (A16) |
| Elaria: Profession Masteries | one per profession | `any` (A24) | |
| Elaria: Set Masteries | one per class group | `none` | Requirements kept as text and as structured links |
| Elaria: Bond Masteries | — | `none` | `minBondTier` |

The field mapping onto the `mastery` item (`module/data/item-mastery.mjs`):

| Sheet data | Item field |
|---|---|
| Req. Lvl | `reqLevel` (null = no level gate) |
| Value | `value` (null = uses no budget; Steal Lvl's 5 is allowed, A23) |
| table / tab | `category`, `sources[] {type, id, name}` |
| `(rxn)` in the name | `isReaction` (removed from the name) |
| Skill Mod | `skillMod {raw, bonus, stats}` |
| Dmg | `damage {raw, count, sides, stat, hits, perTarget}` |
| "Costs …" in the text | `costs[] {amount, resource}` + `cost` text |
| "once per …" in the text | `usageLimit {count, per}` |
| Tags | `tags[]` |
| verified checkbox | `verified` ("yes" / "no" / "") |
| Details | `details` (HTML paragraphs) |
| set requirements | `requirementsRaw`, `requirements[]`, `reqLevelAlt` |
| bond tier | `minBondTier` |
| reference | `ref`, e.g. `discipline:rogue/sorru` |

**Ids** are deterministic hashes of the reference, so re-importing updates the same entries instead of adding new ones. Each entry stores a content hash in `flags.elaria`, which is how the importer tells "changed" from "unchanged". Only entries the importer created (`flags.elaria.imported`) are ever removed; hand-made entries in the same compendiums are left alone.

## 5. Not imported yet

Discipline descriptions and availability, deity details (domains, piety, boons), race passives and heritage stat mods, profession crafting lists, and element descriptions are all converted (they're in `elaria-data.json`). They'll be used once race / heritage / discipline / profession / deity item types exist (roadmap phase 2–3).

## Testing without Foundry

```
node tools/test-build.mjs "https://docs.google.com/spreadsheets/d/…"   # or a downloaded .xlsx
```
This runs download → read → convert → build and checks every entry against the item model. Needs Node 18+.

## Gear (v0.11.0)

The *Gear* tab is read like the website's `converter/gear.py` (ported line for line and checked against its output: all 186 files identical, including the 28 gear files, class trinkets and gear overview).

| Compendium | From | Folders |
| --- | --- | --- |
| Elaria: Weapons | weapon evolution trees | one per tree (Straight Sword, Katana …) |
| Elaria: Armour | Light / Medium / Heavy Armour | one per tree |
| Elaria: Trinkets | trinket trees + class trinkets | one per tree; *Class Trinkets / <tier>* |
| Elaria: Unique Gear | trees below "Uniques" | one per tree |

Each item is a `gear` Item: `kind` (weapon / armour / trinket), `ref` (`gear:<tree>/<item>` or `class-trinket:<id>`), `family`, `tier`, `reqLevel`, `evolvesFrom` (item name), `proficiency`, `baseAttack` {raw, count, sides, stat, hits}, `damageType`, `armourRating`, `weight`, `affinity`, `equipLoad`, `breakpoint`, `classTrinket`, `grants`, `materials`, `tags`, `effects`, `description`; plus carried state `location` (bag / belt / worn), `quantity`, `broken`. The gear overview (glossary and rules text) isn't imported as items.
