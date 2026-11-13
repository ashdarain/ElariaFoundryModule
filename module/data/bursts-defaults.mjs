/**
 * Pre-made bursts (Bursts/Alignment tab, "Class specific bursts"). Used until the GM imports the sheet, after
 * which the world setting "elaria.bursts" replaces this copy.
 */
export const DEFAULT_BURSTS = [
  {
    "id": "guardian-stalwart-sentinel",
    "source": "Guardian",
    "name": "Stalwart Sentinel",
    "text": "Create a field of safety as a reaction negating all instances of damage to hp in a (steadfast)m radius around you until the end of your next turn. For the duration of this ability any form of damage to hp that occurs is negated and instead added to a pool of damage. If used as a reaction you must make a check against the highest skill mod in the radius using the skill mod of Awareness plus (character lvl/4). When this skill ends the pool of damage accumilated will be stored in any weapon you have as breakpoint for 3 turns."
  },
  {
    "id": "monk-hidden-potential",
    "source": "Monk",
    "name": "Hidden Potential",
    "text": "Release your hidden potential granting the following effects; Increases all momentum skills to maximum, all Rage or Tranquility meters to max, grants Temp hp equal to lvlx3, and Temp ftg and mana equal to lvl. When ever you use a skill with a melee tag add a charge to the beginning of the skill equal to (Finessex2) meters, if the skill already has a charge distance simply add this value to the max charge distance. Whenever moving during a skill deal blunt physical dmg equal to Strength to all you pass within 1m, this dmg cannot be blocked or dodged. Lasts 3 turns."
  },
  {
    "id": "brawler-unkillable",
    "source": "Brawler",
    "name": "Unkillable",
    "text": "Recover 1 Life point, when you hit 0 hp you no longer get KO'd instead you stay up at 0 hp. Whenever you take damage in this state there is a Con check against the DC of 10+the attacks Skill mod to see if you lose 1 life point or lose nothing. While in this state once for the duration you can add damage to a single attack equal to the amount of missing hp you have and increase the skill mod of that attack by your strength (if it already adds strength add it again). This adds only once to multi-hit abilities. Lasts 5 turns or 30 min out of combat."
  },
  {
    "id": "minstrel-dancer-dancers-finale",
    "source": "Minstrel(Dancer)",
    "name": "Dancers Finale",
    "text": "Dance about the battle field striking every enemy within (Demeanor+5)m once dealing (Finesse)d6 Dmg. If at least one target dies from this attack you strike a a second time hitting everyone on the battlefield again with the same attack, dealing bonus dmg equal to the amount of targets who died from the first attack x3. Skill mod (Character lvl/4)+Demeanor."
  },
  {
    "id": "occultist-blood-bone-armour",
    "source": "Occultist (Blood)",
    "name": "Bone Armour",
    "text": "Spend 50% of your current hp (min 1), and cover your self in bone armour. This armour grants a temp hp barrier equal to (strengthx5) plus the amount of hp you spent to cast this spell. Whenever you use a skill or basic attack that deals dmg you may add dmg to the attack equal to (Conx2). If used on a multi attack it only applies to one of the attacks. Whenever you are struck in melee while wearing this armour the assailant takes 1d6 true dmg and has bleed applied to them. Skill mod Con+(Character lvl/4) The armour lasts until destroyed or until 3 turns have passed."
  },
  {
    "id": "merchant-communal-wealth",
    "source": "Merchant",
    "name": "Communal Wealth",
    "text": "For the next three turns you can cast all Coin skills using the personal money of anyone currently on the battlefield. You also can use your coin skills an additional amount of times equal to your Luck mod for that battle. Does not increase the amount of coin uses for Pay to Win. Whenever you use a Coin skill while in this state you can add luck to the skill mod and dmg mod of the next skill you use. (if it already has plus luck, add twice)"
  }
];
