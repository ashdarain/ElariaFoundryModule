/**
 * Elaria constants. Lists come from the data-validation dropdowns on the Google Sheet's
 * "Character Stats" tab (B42 onward) so the Foundry sheet offers the same choices.
 */
export const ELARIA = {};

/** The 13 stats, in sheet order. `group` is the CS column B heading. */
ELARIA.stats = {
  str:   { label: "ELARIA.Stat.str",   abbr: "Str",    group: "might",        major: true  },
  stf:   { label: "ELARIA.Stat.stf",   abbr: "Stf",    group: "might",        major: false },
  con:   { label: "ELARIA.Stat.con",   abbr: "Con",    group: "might",        major: true  },
  res:   { label: "ELARIA.Stat.res",   abbr: "Res",    group: "might",        major: false },
  fin:   { label: "ELARIA.Stat.fin",   abbr: "Fin",    group: "reflexes",     major: true  },
  pre:   { label: "ELARIA.Stat.pre",   abbr: "Pre",    group: "reflexes",     major: true  },
  awa:   { label: "ELARIA.Stat.awa",   abbr: "Awa",    group: "reflexes",     major: true  },
  dem:   { label: "ELARIA.Stat.dem",   abbr: "Dem",    group: "reflexes",     major: false },
  smrts: { label: "ELARIA.Stat.smrts", abbr: "Smrts",  group: "intelligence", major: true  },
  spc:   { label: "ELARIA.Stat.spc",   abbr: "Spc",    group: "intelligence", major: false },
  wis:   { label: "ELARIA.Stat.wis",   abbr: "Wis",    group: "intelligence", major: true  },
  ins:   { label: "ELARIA.Stat.ins",   abbr: "Ins",    group: "intelligence", major: false },
  lck:   { label: "ELARIA.Stat.lck",   abbr: "Lck",    group: "luck",         major: false }
};

ELARIA.majorStats = new Set(Object.entries(ELARIA.stats).filter(([, s]) => s.major).map(([k]) => k));

ELARIA.statGroups = {
  might: "ELARIA.StatGroup.might",
  reflexes: "ELARIA.StatGroup.reflexes",
  intelligence: "ELARIA.StatGroup.intelligence",
  luck: "ELARIA.StatGroup.luck"
};

ELARIA.scalings = {
  gen: "ELARIA.Scaling.gen",
  bst: "ELARIA.Scaling.bst",
  null: "ELARIA.Scaling.null"
};

ELARIA.masteryCategories = {
  basic: "ELARIA.Category.basic",
  utility: "ELARIA.Category.utility",
  offensive: "ELARIA.Category.offensive",
  defensive: "ELARIA.Category.defensive",
  support: "ELARIA.Category.support"
};

/** Category cap before "Mastery Modification" masteries (A8). */
ELARIA.baseCategoryCap = 10;

ELARIA.masterySources = {
  general: "ELARIA.Source.general",
  discipline: "ELARIA.Source.discipline",
  elemental: "ELARIA.Source.elemental",
  set: "ELARIA.Source.set",
  bond: "ELARIA.Source.bond",
  deity: "ELARIA.Source.deity",
  ancestry: "ELARIA.Source.ancestry",
  profession: "ELARIA.Source.profession"
};

ELARIA.forms = {
  mortal: "ELARIA.Form.mortal",
  divine: "ELARIA.Form.divine",
  demonic: "ELARIA.Form.demonic"
};

ELARIA.elements = ["Fire", "Ice", "Lightning", "Wind", "Water", "Earth", "Light", "Dark", "Poison", "Nature"];

ELARIA.disciplines = [
  "Rogue", "Skirmisher", "Ranger", "Assassin", "Samurai", "Warrior", "Guardian", "Cavalier", "Ninja",
  "Monk", "Brawler", "Dragon Mage", "Spellblade", "Space Mage", "Summoner", "Meta Mage", "Scholar",
  "Minstrel", "Psychic", "Shapeshifter", "Occultist", "Merchant", "Warpriest", "Divine", "Sword Saint",
  "Shaman", "Demonic Lineage", "Crow", "Raven"
];

/** Special values for discipline slot 2 (A7, A18). */
ELARIA.slot2Options = {
  extraElement: "ELARIA.Slot2.extraElement",
  plusOutput: "ELARIA.Slot2.plusOutput"
};

ELARIA.professions = [
  "Alchemist", "Arcane Artisan", "Craftsmen", "Devout", "Enchanter", "Excorsist", "Instructor",
  "Mystic Chef", "Necromancer", "Survivalist", "Technomancer", "Gnomish Engineer", "Thief"
];

ELARIA.races = [
  "Alumen", "Saaren", "Hagalaz", "Somar", "Astrren", "Dryad", "Ilfyra", "Herran", "Auroch", "Drake", "Raki",
  "Nyad", "Fairy", "Gnome", "Nightingale", "Teocuit", "Giant", "Vampire Origin", "Shur'tagal"
];

ELARIA.heritages = [
  "Bushido", "Ninjutsu", "Ronin", "Naraka Tribe", "Scholars Guild", "Desert Nomads", "Celestial Tribe",
  "Tensei Tribe", "Kotodama Tribe", "Koruna Family", "Zlato Family", "Penz Family", "Seishin Tribe",
  "Fantomu Tribe", "Hitsujikai Tribe", "Iron Wood Tree", "Willow Tree", "Yew Tree", "Sages of Old",
  "Autumn Knights", "High Judges", "Thunder Clan", "Sky Clan", "Fog Clan", "Gonglu Family", "Jiqiao Family",
  "Yonggan Family", "Hephaestus Clan", "Kriger Clan", "Darlig Clan", "Rihun Clan", "Surea Clan", "Alsumu Clan",
  "Ocean Nyad", "Lake Nyad", "River Nyad", "Yggdrasil Fairy", "Shadow Fae", "Magnus Fairy", "Architects",
  "Steelmancers", "Ether Corp.", "Meisnyo", "Talonight", "Ibrisakage", "Soothsayers", "Runemancers",
  "Divine Acolytes", "Frost Giant", "Rune Giant", "Mountain Giant", "Savage", "Ademre", "Royal"
];

ELARIA.deities = [
  "Abellone", "Absyrtus", "Cereberum", "Dante", "Dixes", "Faleran", "Galatea", "Gade", "Gaze", "Grim", "GPK",
  "Hecate", "Helena", "Iris", "Ithrah", "Jin", "Kain", "Lanacia", "Mercius", "Neon", "Shalia", "Siira",
  "Tallius", "Tine", "Tox", "Ugathor", "Veles"
];

ELARIA.deityRoles = {
  only: "ELARIA.DeityRole.only",
  primary: "ELARIA.DeityRole.primary",
  secondary: "ELARIA.DeityRole.secondary"
};

ELARIA.alignments = [
  "Cruel", "Imperious", "Dogmatic", "Obedient", "Principled",
  "Humane", "Selfless", "Righteous", "Independent", "Ambitious"
];

/** Exhaustion levels (Mechanics). Each level includes all previous ones. */
ELARIA.exhaustion = {
  1: "−1 to knowledge checks, −2 to initiative.",
  2: "Resilience check DC 12 every 4 hours or faint and take a long rest.",
  3: "−5 max FTG; if that brings max FTG to 0 you faint and take a long rest.",
  4: "−2 to skill mods. Falling unconscious for any reason starts a long rest.",
  5: "Whenever you lose HP, Resilience check DC 18 or faint and take a long rest.",
  6: "The every-4-hours check becomes DC 20 every 2 hours.",
  7: "The check happens every hour; each pass deals 4d6 true damage."
};
ELARIA.maxExhaustion = 7;

/** Mood → burst gauge maximum (Bursts/Alignment E12). Order matches the sheet's dropdown. */
ELARIA.moods = { Encouraged: 3, Normal: 6, Discouraged: 8, Stressed: 10, Overwhelmed: 15 };
ELARIA.defaultMood = "Normal";
ELARIA.defaultBurstMax = 6;

/** Elements as resistance keys (lowercase) → display label. */
ELARIA.resistanceElements = Object.fromEntries(ELARIA.elements.map(e => [e.toLowerCase(), e]));

/**
 * Sub-stats shown in the Stats tab side panel. Each gets a manual Bonus column (masteries aren't
 * automated yet). `input` = the base itself is typed in (bag rank).
 */
ELARIA.substats = {
  defence: {
    label: "ELARIA.Defence.title",
    rows: {
      nar: { label: "ELARIA.Defence.nar", hint: "ELARIA.Defence.narHint" },
      nmar: { label: "ELARIA.Defence.nmar", hint: "ELARIA.Defence.nmarHint" },
      aar: { label: "ELARIA.Defence.aar", hint: "ELARIA.Defence.aarHint" },
      ar: { label: "ELARIA.Defence.ar", hint: "ELARIA.Defence.arHint", strong: true },
      mar: { label: "ELARIA.Defence.mar", hint: "ELARIA.Defence.marHint", strong: true }
    }
  },
  combat: {
    label: "ELARIA.Combat.title",
    rows: {
      critChance: { label: "ELARIA.Combat.critChance", suffix: "%" },
      critDamage: { label: "ELARIA.Combat.critDamage", suffix: "%" },
      mv: { label: "ELARIA.Combat.mv", suffix: "m" },
      reacts: { label: "ELARIA.Combat.reacts" },
      passiveAwareness: { label: "ELARIA.Combat.passiveAwareness" },
      lifePointsMax: { label: "ELARIA.Resource.lifePointsMax" }
    }
  },
  carrying: {
    label: "ELARIA.Inventory.title",
    rows: {
      equipLoad: { label: "ELARIA.Inventory.equipLoad" },
      bagRank: { label: "ELARIA.Inventory.bagRank", input: "system.bagRank", noBonus: true },
      bagSlots: { label: "ELARIA.Inventory.bagSlots" }
    }
  }
};

/** Alignment-wheel burst triggers (Bursts/Alignment tab). Worth +2 to the burst gauge. */
ELARIA.alignmentBurst = {
  Cruel: "When something powerful is attempting to quash you in order to stop you from enacting your cruel desires.",
  Imperious: "When something or someone is taking power away from you.",
  Dogmatic: "When something or someone is breaking the law and resisting.",
  Obedient: "When your master or ideology is in peril.",
  Principled: "When something or someone tries to stop your plans for the greater good.",
  Humane: "When inhumane acts are occurring and you are trying to stop it.",
  Selfless: "When risking yourself to save one or more individuals.",
  Righteous: "When stopping “Evil” doers.",
  Independent: "When being told you can’t do something, forcefully.",
  Ambitious: "When attempting to enact one’s specific ambitious goal."
};

/** What fills the burst gauge (Bursts/Alignment tab). */
ELARIA.burstGaugeSources = [
  ["Your alignment wheel trigger", 2],
  ["Deal a finishing blow", 1],
  ["Heal someone at 25% HP or less", 1],
  ["Someone you buffed deals a finishing blow", 1],
  ["Someone you debuffed is KO'd by an ally", 1],
  ["An ally is KO'd", 2],
  ["You are KO'd", 3]
];

/** Alignment wheel details (Bursts/Alignment tab): motivation, motto, opposing traits. */
ELARIA.alignmentInfo = {
  Cruel:       { motivation: "Malice",      motto: "Show no mercy",               opposes: ["Humane", "Selfless", "Principled"] },
  Imperious:   { motivation: "Power",       motto: "Might makes right",           opposes: ["Selfless", "Righteous", "Humane"] },
  Dogmatic:    { motivation: "Order",       motto: "The law is the law",          opposes: ["Righteous", "Independent", "Selfless"] },
  Obedient:    { motivation: "Duty",        motto: "Just following orders",       opposes: ["Independent", "Righteous", "Ambitious"] },
  Principled:  { motivation: "Unity",       motto: "For the greater good",        opposes: ["Ambitious", "Independent", "Cruel"] },
  Humane:      { motivation: "Altruism",    motto: "Kindness is never wasted",    opposes: ["Cruel", "Ambitious", "Imperious"] },
  Selfless:    { motivation: "Service",     motto: "Living is service to others", opposes: ["Imperious", "Cruel", "Dogmatic"] },
  Righteous:   { motivation: "Justice",     motto: "More justice; less law",      opposes: ["Dogmatic", "Imperious", "Obedient"] },
  Independent: { motivation: "Freedom",     motto: "Live in the moment",          opposes: ["Obedient", "Dogmatic", "Principled"] },
  Ambitious:   { motivation: "Achievement", motto: "First come, first serve",     opposes: ["Principled", "Obedient", "Humane"] }
};


/* Gear / inventory ---------------------------------------------------------------- */

ELARIA.gearKinds = {
  weapon: "ELARIA.Gear.kind.weapon",
  armour: "ELARIA.Gear.kind.armour",
  trinket: "ELARIA.Gear.kind.trinket",
  item: "ELARIA.Gear.kind.item"
};

ELARIA.gearLocations = {
  bag: "ELARIA.Gear.location.bag",
  belt: "ELARIA.Gear.location.belt",
  worn: "ELARIA.Gear.location.worn"
};

/** Slots on the character sheet's Inventory section (Character Stats rows 113–125). */
ELARIA.inventory = { beltSlots: 3, armourSlots: 2, trinketSlots: 5, classTrinketSlots: 1 };

/** Coins (Shops and Inventory): 1 pp = 10 gp = 100 sp = 1 000 cp = 10 000 ironne. */
ELARIA.coins = {
  pp: "ELARIA.Coins.pp", gp: "ELARIA.Coins.gp", sp: "ELARIA.Coins.sp", cp: "ELARIA.Coins.cp", ironne: "ELARIA.Coins.ironne"
};
