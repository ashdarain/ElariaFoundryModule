# Rules reference for the character sheet

Sources:
- **CS** = *Character Stats* tab. Cell refs are from the automated sheet that starts at B42 (formulas read from an .xlsx export of the Google Sheet, so these are the real formulas, not guesses).
- **M** = *Mechanics* tab.

- **A#** = Ash's answer to question # in `QUESTIONS.md` (these override both of the above).

Notation: `mod(x)` = the modifier of stat x. `floor` = round down. `lvl` = character level (1–20).

---

## 1. Stats

13 stats in 4 groups (the group names come from CS column B):

| Group        | Stat         | Code    | Major/Minor | What it does (CS text)                                    |
| ------------ | ------------ | ------- | ----------- | --------------------------------------------------------- |
| Might        | Strength     | `str`   | Major       | Physical attack dmg, jump distance, knockback             |
| Might        | Steadfast    | `stf`   | Minor       | Physical status resist, physical dmg reduction (NAR)      |
| Might        | Constitution | `con`   | Major       | HP, toxin resist, equip load, life points                 |
| Might        | Resilience   | `res`   | Minor       | Max fatigue, stamina and willpower checks                 |
| Reflexes     | Finesse      | `fin`   | Major       | Melee accuracy (phys + mag), movement, initiative         |
| Reflexes     | Precision    | `pre`   | Major       | Ranged accuracy, general accuracy                         |
| Reflexes     | Awareness    | `awa`   | Major       | Reactions, passive awareness                              |
| Reflexes     | Demeanor     | `dem`   | Minor       | Non-verbal charisma                                       |
| Intelligence | Smarts       | `smrts` | Major       | Magic attack dmg                                          |
| Intelligence | Speechcraft  | `spc`   | Minor       | Verbal charisma, known languages                          |
| Intelligence | Wisdom       | `wis`   | Major       | Magic status resist, magic dmg reduction (NMAR), max mana |
| Intelligence | Insight      | `ins`   | Minor       | Read intentions, crit damage                              |
| Luck         | Luck         | `lck`   | Minor       | Loot, encounters, crit chance                             |

Majors: str, con, fin, pre, awa, smrts, wis. Minors: stf, res, dem, spc, ins, lck.

### Scaling
Each stat is `Gen` (×1, default), `Bst` (×1.5) or `Null` (×0.5).
Boost/null trade rules (CS text, not enforced by the sheet):
- Boosting a **major** requires nulling 1 major **or** 2 minors.
- Boosting a **minor** requires nulling 1 stat (major or minor).
- Demeanor and Speechcraft share scaling.

**Scaling toggle** (CS C44, On/Off): Off treats every stat as Gen. It's a testing aid, not used much in play (A9). In Foundry it's a per-character checkbox, on by default, shown only in full editing mode (lock button, top right of the sheet).

### Total stat and modifier
```
base        = lvl                                    (CS E46 = C43)
total       = floor((base + statPoints) × scaling)   (CS G46; confirmed A1, points ARE scaled)
modifier    = floor(total / 4) + bonus               (CS I46; "bonus" is column H)
```
**Bonus** (A4) is every flat bonus to a stat *modifier*: racial/heritage mods, buffs, food buffs, mood buffs, drunkenness, etc. Some are permanent, some temporary. Any "+N Strength" style effect means **+N to the modifier**, not to the total stat. You plan to split these up later; in Foundry they'll be separate sources from the start (see `02-data-model.md`) but add up to the same single bonus.

### Stat points
```
available   = 12 + 3 × (lvl − 1)          (CS F62)
assigned    = sum of all statPoints        (CS E62) → "OVER" if assigned > available
perStatCap  = lvl + 3                      (A3) → warn, don't block
```
The per-stat cap counts **assigned points only** (not level, not scaling). Both limits warn, never block.

---

## 2. Resources

| Resource | Formula | Cell |
|---|---|---|
| HP max | `max(1, mod(con)×5 + lvl×3 + 5)` | L46 |
| MP max | `max(1, mod(wis)×3 + lvl)` | L47 |
| FTG max | `max(1, mod(res)×3 + lvl)` | L48 |
| Life Points max | `3 + (mod(con) ≥ 8 ? 2 : mod(con) ≥ 6 ? 1 : 0)` | L62 |

HP, MP and FTG each have **Current / Max / Temp** (A11). Temp is overflow: damage or spending takes it first, then current. Current can't exceed max.

**Life Points** (A12) aren't health: they're how many times you can be revived ("rez'd"). HP at 0 = KO'd. The sheet stores current life points (CS B43) against the max (L62); current can't go above max. The max rises at con mod 6 (+1) and 8 (+2). HP has no thresholds: it grows smoothly with level and con (A21).

Related rules (M, "Life and Death"):
- 1 min out of combat → HP, MP, FTG refill (if HP > 0). The sheet's **Restore** button (under Initiative) does this after a confirmation, and also clears temp.
- Ongoing limited-duration effects stop regeneration of the energy they used.
- HP hits 0 → +1 **injury** (not when revived by spell/ability/burst).
- Each injury: −1 to all attack, damage and skill-check rolls.
- Long rest: clear injuries, +1 life point, exhaustion −2.
- 0 HP and 0 life points → dead.
- Exhaustion 1–7 (stacking effects table in M). Exhaustion 3: −5 max FTG. Exhaustion 4: −2 to skill mods.
- Second Wind: once per long rest, MP and FTG to full.
- Overexert: cast without enough MP/FTG → that energy to 0, +2 exhaustion.

## 3. Sub-stat bonuses

Every value in the Defence, Combat and Carrying panels has a manual **Bonus** column (NAR, NMAR, AAR, AR, MAR, crit chance, crit damage, Mv, reacts, passive awareness, life point max, equip load, bag slots). Masteries often add to these and aren't automated yet, so the player types the bonus in. `total = base + bonus`. A bonus on NAR/NMAR/AAR flows into AR/MAR; a bonus on AR or MAR only changes that one. The equip load bonus flows into bag slots.

## 3a. Defence

| Value | Formula | Cell |
|---|---|---|
| NAR (natural armour) | `mod(stf)` | L58 |
| NMAR (natural magic armour) | `mod(wis)` | L59 |
| AAR (armour from gear) | sum of equipped armour (manual entry until armour items exist) | L52 |
| AR (physical) | `NAR + AAR` | L50 |
| MAR (magical) | `NMAR + AAR` | L51 |

Confirmed (A5): **AAR blocks physical and magical equally**, NAR only physical, NMAR only magical. Armour has no separate magic value.

Damage types interact with these (M): Piercing ignores ½ total AR; Blunt ignores all AAR; Chopping ignores all NAR; Magical Piercing ignores ½ MAR; Magical Chopping ignores all NMAR; Toxic is only blocked by con modifier; True ignores everything.

## 4. Combat numbers

| Value                               | Formula                                                   | Cell        |
| ----------------------------------- | --------------------------------------------------------- | ----------- |
| Movement (Mv, metres)               | `clamp(mod(fin) + 4, 1, 20)`                              | L60         |
| Passive Awareness                   | `mod(awa) + 10`                                           | L54         |
| Reacts per round (RAP)              | `floor(clamp(mod(awa)/2, 2, 4))` (heritages can exceed 4) | L55         |
| Crit chance                         | `mod(lck) × 5 %` (+50 % in stealth)                       | L56         |
| Crit damage                         | `mod(ins) × 10 %` → crit multiplier `1 + critDmg` (A6)    | L57         |
| Initiative                          | `3d6 + mod(fin)`                                          | M           |
| Equip load                          | `max(0, mod(con) + 2)`                                    | L61         |
| Max bag slots                       | `(equipLoad + bagRank) × 4`                               | D127 / H127 |
| Jump (horizontal / vertical)        | `str` m / `str/2` m                                       | M           |
| Knockback distance                  | `(str + knockbackMod) × 2` m                              | M           |
| Hold breath (calm / still / combat) | `con×15+15` s / `con×30+15` s / `con×4+4` s               | M           |

Turn economy (M): 2 AP, 1 bonus action, RAP (above), up to 6 free actions per turn.

Damage (M):
```
final = max(0, (rolled + flatMods − relevantArmour) × (critDmg + pctMods − resistance))
```
Read with A6: the multiplier starts at **1** (100 %). A crit adds the crit damage %, so Insight mod 0 → ×1 (crits do nothing extra), mod 2 → ×1.2. Percentage mods and weaknesses add, resistances subtract.

Multi-hit (`1d6+Str x2`): the flat mod and armour apply to each hit separately.

### Resistances on the character sheet
The Stats tab has a resistance box for each of the 10 elements and the 3 damage forms, in **percent**: positive = takes less, negative = takes more (−50 % Fire → takes 50 % more fire damage). Elements start at 0 (PCs have nothing innate). Forms start with the built-in value from the character's form (below) and the player adds to it.

All abilities and damage are **Mortal** unless they say Demonic or Divine.

### Damage form and elements on characters (A15)
- Every damage source and every creature has a **form**: Mortal, Divine or Demonic. Player characters are **Mortal** unless something says otherwise, so they take +25 % from Demonic and −25 % from Divine.

  Read the M table as **defender** rows (weakness column, then resistance column). Forms do **not** resist themselves (A19: that was a copy-over mistake in the sheet):

  | Defender form | Takes +25 % from | Takes −25 % from |
  |---|---|---|
  | Mortal | Demonic | Divine |
  | Divine | Mortal | Demonic |
  | Demonic | Divine | Mortal |

  Elements read the same way (Fire takes +25 % from Water, −25 % from Fire and Ice; Light/Dark/Nature/Poison resist their own element by 50 %). Form and element percentages **add together**. The sheet's worked examples are from an older version and should be ignored; follow the tables (A19). See Q22 for the Light/Dark weakness value.
- Player characters have **no innate elemental weaknesses or resistances** (monsters do). Theirs come only from ancestry and masteries, so the character stores a list of resistances fed by items/effects.

## 5. Rolls

**Core roll (A2): `3d6 + relevant stat modifier(s) + bonuses`** vs a DC, unless a rule says otherwise. The stat's *modifier* is what's added, never the full stat. Thresholds like "3 reacts at 6 awareness" also mean the modifier.

Exceptions: **background / social-standing** rolls are **1d20** (so "natural 20" means a d20 showing 20). Damage uses its listed dice.

- **Attacks** don't roll to hit. The defender may declare a **reaction**; they then roll against **DC = attacker's skill mod + 10** (plus `n`, which rises by 2 per successful react that round).
  - Reacting to your own action: `n + 16`
  - Action aimed at you: `n + 10 + skill mod`
  - Action not aimed at you: `n + 14 + skill mod (or stat)`
  - Enemy leaving melee: `n + 12 + skill mod (or fin)`
- **Status resist**: stf (physical) or wis (magical) vs attacker's skill mod + 10.
- **Advantage**: roll the whole check twice and keep the higher total (the 3d6 sum, not individual dice). Disadvantage (e.g. corruption auras) keeps the lower.
- **Injuries**: −1 per injury to attack, damage and skill-check rolls. **Exhaustion 4**: −2 to skill mods. Both apply automatically to rolls.

## 6. Mastery budget

Five categories: **Basic, Utility, Offensive, Defensive, Support**. Each has its own **cap**, **10 at every level** (A8); only "Mastery Modification" masteries raise it. Equipped masteries' **values** are summed against it.

On top of that, the sum of all five is limited by **Maximum Output**:
```
output = lvl×2 + 3
       + (lvl ≥ 5 ? 2 : 0) + (lvl ≥ 12 ? 3 : 0) + (lvl ≥ 18 ? 4 : 0) + (lvl ≥ 20 ? 3 : 0)
       + (discipline slot 2 = "Plus 5 Output" ? 5 : 0)                       (CS J66, A18)
```
Lvl 1 → 5, lvl 5 → 15, lvl 10 → 25, lvl 12 → 32, lvl 18 → 48, lvl 20 → 55.

**Available mastery sources** (CS B70–B79), i.e. which lists the character can pick from:
General · Race · Sub-race (heritage) · Element 1 · Element 2 · Element combo (`E1/E2`) · Deity · Discipline 1 · Discipline 2 **or** Element 3 (+ combos `E1/E3`, `E2/E3`) · Profession.

**Second discipline slot** (A7, A18): at character creation slot 2 is one of
- a second **discipline** (the usual pick),
- a **third element** (on top of the usual two); all three element pairs then unlock their combo masteries (A20),
- **Plus 5 Output**: no second discipline, +5 Maximum Output (rare).

"Extra Professions" is no longer an option (the Merchant discipline replaced it).

**Heritage abilities** (A16) are not picked or equipped: choosing a heritage grants all of its abilities automatically. They don't use mastery budget.

## 7. Identity fields (CS row 42–43)

Name, Level (1–20), Life Points, Prime Elements ×2 (Fire, Ice, Lightning, Wind, Water, Earth, Light, Dark, Poison, Nature), Combo (derived), Profession (14 options), Deity (27 options), Disciplines ×2 (29 options; slot 2 can be "Extra element" instead), Race (19), Sub-race (55 heritages), the scaling **On/Off** toggle at C44 (A9). Players can edit everything on their own sheet, including level and stat points (A14).

## 8. Inventory (CS rows 106+)

- Coins: Platinum, Gold, Silver, Copper, Ironne. 1 pp = 10 gp = 100 sp = 1 000 cp = 10 000 ironne (*Shops and Inventory*).
- Belt slots: description, dmg & type, break point, effects.
- Armour: description, AAR, break point, effects.
- Trinkets: description, effects.
- Bag: numbered slots with quantity + item, count = max bag slots. **Bag rank** comes from buying better bags; everyone starts with a rank 1 bag (A10).

## 9. Other trackers that belong on a character

From other tabs; not on the CS sheet yet:
- **Burst gauge** — max set by **Mood** (Bursts/Alignment E12): Encouraged 3, Normal 6, Discouraged 8, Stressed 10, Overwhelmed 15. The sheet derives the max; it isn't typed in.
- **Alignment** (10-trait wheel) plus an optional **second alignment**. Each gives its own +2 burst trigger. The sheet warns (doesn't block) if the second is one of the first's opposing traits. *Bursts/Alignment*
- **Exhaustion** 0–7, **Injuries** — *Mechanics*
- **Piety** and rank per deity (only / primary / secondary) — *Piety (WIP)*
- **Background** (social-standing scale + result, perk, starting inventory) — *Backgrounds*
- **Status effects**: bleed (5) → rupture, burn (3) → scorch, chill (3) → frozen, poison, toxins, blind, drunkenness 1–4, immobilized, restrained, silenced, knockdown, soul burn, fear 1–3, stun, stealth, stagger — *Mechanics*
- **XP** is tracked per **party**, not per character (*XP* tab).

## 10. Monster stat block (new *Monster stat block* tab)

An empty template, so no formulas yet. What it shows:
- Name, Type, **Power**, Elements, Creature size, picture, description.
- HP, FTG, MP.
- The 13 stats with stat and mod columns (laid out Might / Reflexes / Intelligence + Luck).
- AR, MAR, AAR, NAR, NMAR, **Elemental Res**, Passive Awa, Rxn per round, Crit chance, Crit damage, Mv.
- Unique loot, loot tables.
- Skills: Name, Skill mod, Cost, Description, Dmg, Tags.

**Nature checks**: each part of the block has its own knowledge-check DC, so players learn a monster in pieces:

| Part revealed | DC |
|---|---|
| HP / FTG / MP | 8 + Power |
| Name, type, elements, size, description | 10 + Power |
| Loot | 12 + Power |
| Stats and defences | 14 + Power |
| Skills | 16 + Power |

The *Mechanics* "Players Stats" power-tier table is a balance guide only; NPCs are not generated from it (A17).
