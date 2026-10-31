# Open questions

Q1–Q17 are answered and folded into `01-rules-reference.md`, `02-data-model.md` and `03-character-sheet.md`. Follow-ups Q18–Q21 are answered too. Anything still open is at the bottom.

## Blocking phase 1

**Q1. Do stat points get multiplied by scaling?**
The written rule: base = lvl × scaling, total = base + points. So lvl 10 Bst Finesse with 13 points = 15 + 13 = **28**.
The sheet formula (G46): total = floor((lvl + points) × scaling) = floor(23 × 1.5) = **34**.
Which is right?
**A1.** It’s (lvl + points) × scaling

**Q2. What dice do checks use?**
Initiative is `3d6 + Fin`. Damage is d6s. But reaction rolls, status resists, skill checks ("roll awareness against DC 10 + skill mod") don't say. And the background roll mentions a "natural 20".
- Is every check `3d6 + modifier` vs DC?
- Is the background/social-standing roll a d20?
- Do checks add the **modifier** (stat ÷ 4) or the full stat? (The rules say "the modifier added to relevant dice rolls is equal to your stat divided by 4", so I'm assuming modifier everywhere, including "3d6 + Fin" and the "6 awareness" thresholds.)
**A2.** 
- Unless stated otherwise all checks are 3d6+Relevant stat mods and bonuses. 
- Background and Social standing rolls are d20s

**Q3. Per-stat point cap.** Rules say stat points in one stat "can be a maximum of lvl plus 3". Is that cap on the *points* put into a stat, and should the sheet enforce it (warn)?
**A3.** the cap is for assigned points only, not including lvl or scaling. the sheet should warn if you go over but not hard enforce.

**Q4. The "Bonus" column (H).** It adds straight to the modifier. Is that where heritage stat mods ("+1 Strength or Precision, −1 Smarts"), drunkenness (−1 fin) and mastery buffs ("+2 strength") go? I.e. do all "+N stat" effects mean +N **modifier**, not +N to the total stat?
**A4.** It is currently where all flat bonuses to stat mod currently go, which would be racial bonuses, buffs, food buffs, mood buffs etc. In the future I plan on separating these things and making it easier to manage but yes, currently its for all those bonuses, some of which are permanent bonuses and some that are temporary.

## Shapes the data model

**Q5. MAR uses AAR.** MAR = NMAR + AAR, the same armour value as AR. Does armour protect equally against magic, or should armour have its own magic armour value (AMAR)?
**A5.** AAR blocks both physical and magical equally, NMAR is only magical, and NAR is only physical. So MAR is AAR plus NMAR, and AR is AAR plus NAR. AAR adds to both

**Q6. Crit damage.** Crit damage = Insight mod × 10 % (20 % at mod 2). On a crit, is the damage multiplier `1 + critDamage` (×1.2), or is there a base like ×1.5 that this adds to? And with 0 Insight, does a crit do nothing extra?
**A6.** With 0 insight a crit does 0 extra dmg, so it would be x1 at 0% crit dmg. x1.2 at 20% crit dmg and so on.

**Q7. Second class slot.** The sheet's formulas treat class slot 2 as possibly "Extra Element" (→ Third Element masteries), "Professional" (→ Extra Professions) or "Plus 5 Output", but the dropdown only offers classes and "Extra element". When does a character get a second class, and which of these alternatives are real options?
**A7.** The second discipline is available in character creation, you are meant to pick 2. However you can forgo picking a second discipline and instead pick a third element, in addition to the 2 elements you are meant to already pick. The extra profession option is no longer a real option now that the merchant discipline exists.

**Q8. Category caps.** All five caps are 10 in the sheet. Are they always 10 at every level, raised only by "Mastery Modification" masteries? Or do they grow with level?
**A8.** They are 10 unless modified by a mastery, they do not increase with lvl.

**Q9. What does the On/Off toggle at C44 do?**
**A9.** Turns off scaling, its the same effect as making all the scaling Gen, was more for testing not really used in play often.

**Q10. Bag rank.** Max bag slots = (equip load + bag rank) × 4. Where does bag rank come from (buying better bags, a gear evolution, something else)?
**A10.** Buying better bags, at character creation you start with a rank 1 bag.

**Q11. Temp column for HP/MP/FTG.** Temporary HP that's lost first, like 5e? Or temporary max increase?
**A11.** Temp is lost first, its like overflow hp.

**Q12. Life Points.** Is the "Life Points: 3" in B43 the current value (goes down when spent) with L62 the max? Can current ever exceed max (e.g. long rest when at max)?
**A12.** Life Points are not HP, but rather how many times you can revive/”rez“. 1. hp is health points, when it hits 0 you are KO'd and need to be rez'd. Current HP cannot exceed max. Max HP increases at certain Con mod values.

## Foundry setup

**Q13. Foundry version.** I'm planning for **v14** (current stable). Which version do you run, and is it self-hosted or on The Forge?
**A13.** v14 is correct. 

**Q14. Players vs GM view.** Should players be able to edit their own level and stat points, or is that GM-only after creation?
**A14.** Players should be able to edit it.

**Q15. Elements on characters.** Damage forms (Mortal/Divine/Demonic) and elements give weaknesses/resistances. Does a *character* have a form and element for defence (e.g. a Light Mortal), and where does it come from (race? prime element?)
**A15.** Divine, demonic or mortal and will take 25% extra damage from their weakness, unless stated otherwise a player character is mortal, meaning they take 25% more dmg from demonic tagged abilities and 25% less from divine. Elemental resistances for players comes from ancestry and masteries, not innate like monsters.

**Q16. Heritage abilities.** Value-0 masteries from level 1, or level-gated? (Some say "Eye Powers"; are those all known at once or picked?)
**A16.** You don't pick them, they are applied to your character if you picked the heritage. Not optional.

**Q17. Hyper-focus columns.** *Mechanics* has a "Players Stats" table with "Top player mod" and "Monster mods" per power tier. Is that just a balance guide for you, or should NPCs be generated from it?
**A17.** Just a guide, npc's shouldn't be generated from it. I could send you what a monster stat block looks like. Added a new tab called `Monster stat block` to the right of Character Stats, its just an empty template

## Follow-ups (from the answers)

**Q18. "Plus 5 Output".** The Max Output formula (J66) adds +5 when the second slot says "Plus 5 Output", but A7 lists only a second discipline or a third element. Is "Plus 5 Output" a third choice for slot 2, or leftover and safe to drop?
**A18.** Plus 5 output is still an option, you can choose to get nothing as your second discipline and get plus 5 mastery output instead. Rare option but still a thing.

**Q19. Damage forms against themselves.** Read as defender rows, the Mechanics table says Mortal takes −25 % from Mortal (and Divine from Divine, Demonic from Demonic). So two Mortals hitting each other is always −25 %. Is that intended? Also, the sheet's first worked example ("Dark Divine does 50 % more to a Light Mortal") doesn't fit that reading (Light's weakness to Dark +25 %, Mortal's resistance to Divine −25 % = 0 %). The second example (Lightning Demonic vs Water Divine = 0 %) does fit. Which is right?
**A19.** Mortal, Divine ,and Demonic should not resist themselves, that is a mistake from copying over the elemental templates. As for the examples below they were written back when the resistances and weaknesses were higher so are not accurate, the charts above should be followed, a Dark Divine attack should do 25% more dmg to a light mortal (because mortal has 25% resistance and light has 50% weakness)

**Q20. Combos with three elements.** With a third element, which combo masteries are open: all three pairs (A/B, A/C, B/C), or still only one combo?
**A20.** All three pairs

**Q21. "Max HP increases at certain Con mod values" (A12).** The sheet's HP formula is smooth (`con mod × 5 + lvl × 3 + 5`) with no thresholds; the con-mod thresholds (6 and 8) are on Life Points max. Did you mean life points there, or should HP also jump at certain con mods?
**A21.** Life points increase with specific CON values, HP is indeed a smooth increase with both lvl and CON contributing.

## Still open

**Q22. Light/Dark weakness size.** A19 says a Dark Divine attack does +25 % to a Light Mortal "because mortal has 25 % resistance and light has 50 % weakness". The table lists Light's weakness to Dark as **−25 %** (it's the *resistance* to Light that's 50 %). Is Light's weakness to Dark 25 % (so that example nets 0 %) or 50 % (nets +25 %)? Same question for Dark → Light, Nature ↔ Poison. Doesn't block anything until damage automation in phase 4.

## Compendium import (see `04-compendium-data.md`)

**Q23. Steal Lvl** (Saboteur, lvl 18) has Value **5**; every other mastery is 0–4. Typo, or intentionally above the normal max?
**A23.** Its intentional, value 5 is correct.

**Q24. Profession masteries** (45) have a Value but no category on the sheet. Which category budget do they use: any (like deity/ancestry), none, or something else?
**A24.** Any, like deity/ancestry

**Q25. Duplicated proficiencies** (Wise, Speed Training … appear in up to 16 disciplines). One compendium entry listing all its disciplines (recommended), or a separate copy in each discipline's folder?
**A25.** One entry is fine, they are the same mastery just in multiple disciplines. However since different classes have access to those when selecting masteries for later the classes need to have the correct ones included. I leave how up to you. 

