/**
 * Elaria system entry point.
 */
import { ELARIA } from "./module/config.mjs";
import * as rules from "./module/rules.mjs";
import { CharacterData } from "./module/data/actor-character.mjs";
import { MasteryData } from "./module/data/item-mastery.mjs";
import { MonsterData } from "./module/data/actor-monster.mjs";
import { AbilityData } from "./module/data/item-ability.mjs";
import { GearData } from "./module/data/item-gear.mjs";
import { ElariaActor } from "./module/documents/actor.mjs";
import { ElariaItem } from "./module/documents/item.mjs";
import { ElariaToken } from "./module/canvas/token.mjs";
import { ElariaCharacterSheet } from "./module/sheets/character-sheet.mjs";
import { ElariaMasterySheet } from "./module/sheets/mastery-sheet.mjs";
import { ElariaMonsterSheet } from "./module/sheets/monster-sheet.mjs";
import { ElariaAbilitySheet } from "./module/sheets/ability-sheet.mjs";
import { ElariaGearSheet } from "./module/sheets/gear-sheet.mjs";
import { ElariaDataImporter } from "./module/apps/data-importer.mjs";
import { addCompendiumBrowseButtons } from "./module/apps/compendium-buttons.mjs";
import { ElariaGMTools, onActorChangeForGMTools } from "./module/apps/gm-tools.mjs";
import { addCompendiumTypeChoices, onPreCreateItem, patchCreateCompendium } from "./module/apps/compendium-types.mjs";
import { applyPackBanners, patchBannersInSidebar } from "./module/apps/compendium-banners.mjs";
import { ElariaRollDialog } from "./module/apps/roll-dialog.mjs";
import { roll3d6, rollDice, rollD20 } from "./module/dice/check.mjs";
import { onHotbarDrop, useMastery } from "./module/helpers/hotbar.mjs";
import { onRenderChatMessage } from "./module/dice/chat-cards.mjs";
import { onUpdateActorDamage } from "./module/dice/damage-card.mjs";
import { onRenderCombatTracker, onUpdateCombat } from "./module/combat/reactions.mjs";
import { initReactButton } from "./module/combat/react-button.mjs";
import { ElariaReactDialog, rollReaction } from "./module/apps/react-dialog.mjs";
import { ElariaReactionPicker } from "./module/apps/reaction-picker.mjs";
import { initChatDiceButtons, placeChatDiceButtons } from "./module/dice/chat-buttons.mjs";

Hooks.once("init", () => {
  console.log("Elaria | Initializing system");

  CONFIG.ELARIA = ELARIA;
  game.elaria = { config: ELARIA, rules, DataImporter: ElariaDataImporter, RollDialog: ElariaRollDialog, ReactDialog: ElariaReactDialog, ReactionPicker: ElariaReactionPicker, GMTools: ElariaGMTools, rollReaction, roll3d6, rollDice, rollD20, useMastery };

  // GM importer: Google Sheet → world compendiums
  ElariaDataImporter.registerSettings();

  // Documents and data models
  CONFIG.Actor.documentClass = ElariaActor;
  CONFIG.Item.documentClass = ElariaItem;
  CONFIG.Token.objectClass = ElariaToken;   // HP red at the bottom, MP blue + FTG green at the top
  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Item.dataModels.mastery = MasteryData;
  CONFIG.Actor.dataModels.monster = MonsterData;
  CONFIG.Item.dataModels.ability = AbilityData;
  CONFIG.Item.dataModels.gear = GearData;

  // Token bars
  CONFIG.Actor.trackableAttributes = {
    character: {
      bar: ["resources.hp", "resources.mp", "resources.ftg"],
      value: ["resources.lifePoints.value", "conditions.injuries", "conditions.exhaustion", "combat.mv"]
    },
    monster: {
      bar: ["resources.hp", "resources.ftg", "resources.mp"],
      value: ["combat.mv", "details.power"]
    }
  };

  // Initiative: 3d6 + Fin modifier, −2 at exhaustion 1+ (Mechanics)
  CONFIG.Combat.initiative = { formula: "3d6 + @fin - @initiativePenalty", decimals: 0 };

  // Handlebars partials
  foundry.applications.handlebars.loadTemplates({
    masteryRow: "systems/elaria/templates/actor/parts/mastery-row.hbs",
    resistCell: "systems/elaria/templates/actor/parts/resist-cell.hbs",
    gearRow: "systems/elaria/templates/actor/parts/gear-row.hbs"
  });

  // Sheets
  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(Actor, "elaria", ElariaCharacterSheet, {
    types: ["character"], makeDefault: true, label: "ELARIA.Sheet.character"
  });
  DocumentSheetConfig.registerSheet(Item, "elaria", ElariaMasterySheet, {
    types: ["mastery"], makeDefault: true, label: "ELARIA.Sheet.mastery"
  });
  DocumentSheetConfig.registerSheet(Actor, "elaria", ElariaMonsterSheet, {
    types: ["monster"], makeDefault: true, label: "ELARIA.Sheet.monster"
  });
  DocumentSheetConfig.registerSheet(Item, "elaria", ElariaAbilitySheet, {
    types: ["ability"], makeDefault: true, label: "ELARIA.Sheet.ability"
  });
  DocumentSheetConfig.registerSheet(Item, "elaria", ElariaGearSheet, {
    types: ["gear"], makeDefault: true, label: "ELARIA.Sheet.gear"
  });
});

// Buttons on chat cards (reroll, skill mod, damage)
Hooks.on("renderChatMessageHTML", onRenderChatMessage);
Hooks.on("updateActor", onUpdateActorDamage);

// Reaction pips in the combat tracker; emptied every round
Hooks.on("renderCombatTracker", onRenderCombatTracker);
Hooks.on("updateCombat", onUpdateCombat);

// "React" button at the bottom left of the hotbar
Hooks.once("ready", () => initReactButton());

// Masteries dragged to the hotbar
Hooks.on("hotbarDrop", onHotbarDrop);

// Dice buttons under the chat box
Hooks.once("ready", () => initChatDiceButtons());
Hooks.on("renderChatLog", () => requestAnimationFrame(placeChatDiceButtons));
Hooks.on("collapseSidebar", () => requestAnimationFrame(placeChatDiceButtons));

// Compendium banners: masteries share one Foundry banner, gear another
Hooks.once("ready", () => {
  applyPackBanners();
  ui.compendium?.render?.();
});

// Create Compendium: "Masteries" and "Gear" next to "Item"; marked compendiums only take their kind.
Hooks.once("init", () => patchCreateCompendium());
Hooks.on("renderDialogV2", addCompendiumTypeChoices);
Hooks.on("renderApplicationV2", addCompendiumTypeChoices);
Hooks.on("preCreateItem", onPreCreateItem);

// GM Tools (button left of React)
Hooks.once("init", () => ElariaGMTools.registerSettings());
for (const hook of ["updateActor", "updateCombat", "createCombatant", "updateCombatant", "deleteCombatant", "createCombat",
  "deleteCombat", "updateToken", "createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
  Hooks.on(hook, onActorChangeForGMTools);
}

Hooks.on("renderCompendiumDirectory", (app, html) => {
  patchBannersInSidebar(app, html);
  addCompendiumBrowseButtons(app, html);           // Browse masteries / Browse gear (everyone)
  ElariaDataImporter.addSidebarButton(app, html);  // Import from Google Sheet (GM)
});
