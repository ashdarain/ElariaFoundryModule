import { ELARIA } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const TEMPLATES = "systems/elaria/templates/actor/monster";
const enrich = (html, doc) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", {
  secrets: doc.isOwner, relativeTo: doc
});

/** Monster sheet: stat block, abilities, description & loot, token. Kept simple: every number is typed in. */
export class ElariaMonsterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["elaria", "sheet", "actor", "monster"],
    position: { width: 640, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollStat: ElariaMonsterSheet.#onRollStat,
      createAbility: ElariaMonsterSheet.#onCreateAbility,
      useItem: ElariaMonsterSheet.#onUseItem,
      postItem: ElariaMonsterSheet.#onPostItem,
      editItem: ElariaMonsterSheet.#onEditItem,
      deleteItem: ElariaMonsterSheet.#onDeleteItem,
      openTokenConfig: ElariaMonsterSheet.#onOpenTokenConfig
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    stats: { template: `${TEMPLATES}/tab-stats.hbs`, scrollable: [""] },
    abilities: { template: `${TEMPLATES}/tab-abilities.hbs`, scrollable: [""] },
    notes: { template: `${TEMPLATES}/tab-notes.hbs`, scrollable: [""] },
    token: { template: `${TEMPLATES}/tab-token.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "stats" }, { id: "abilities" }, { id: "notes" }, { id: "token" }],
      initial: "stats",
      labelPrefix: "ELARIA.MonsterTab"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;
    const L = k => game.i18n.localize(k);
    Object.assign(context, {
      actor, system,
      isGM: game.user.isGM,
      tabs: this._prepareTabs("primary"),
      resourceList: ["hp", "ftg", "mp"].map(key => {
        const r = system.resources[key];
        return { key, label: `ELARIA.Resource.${key}`, value: r.value, max: r.max,
          pct: r.max ? Math.clamp(Math.round(r.value / r.max * 100), 0, 100) : 0 };
      })
    });
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    const actor = this.document;
    const system = actor.system;
    const L = k => game.i18n.localize(k);
    switch (partId) {
      case "stats":
        context.statGroups = Object.entries(ELARIA.statGroups).map(([group, label]) => ({
          label,
          stats: Object.entries(ELARIA.stats).filter(([, s]) => s.group === group)
            .map(([key, s]) => ({ key, label: s.label, mod: system.stats[key].mod }))
        }));
        context.defenceRows = [["ar", "AR"], ["mar", "MAR"], ["aar", "AAR"], ["nar", "NAR"], ["nmar", "NMAR"]]
          .map(([key, label]) => ({ key, label, value: system.defence[key] }));
        context.combatRows = [
          ["passiveAwareness", L("ELARIA.Monster.passiveAwa")], ["reacts", L("ELARIA.Monster.reacts")],
          ["critChance", L("ELARIA.Monster.critChance")], ["critDamage", L("ELARIA.Monster.critDamage")],
          ["mv", L("ELARIA.Monster.mv")]
        ].map(([key, label]) => ({ key, label, value: system.combat[key] }));
        break;
      case "abilities":
        context.abilities = actor.items.filter(i => i.isUsable).sort((a, b) => a.sort - b.sort).map(item => ({
          id: item.id, name: item.name, img: item.img,
          isReaction: item.system.isReaction,
          skillMod: item.system.skillMod?.raw ?? "",
          damage: item.system.damage?.raw ?? "",
          cost: item.system.cost ?? "",
          tags: item.system.tagList,
          canRoll: item.hasDamage || !!item.skillInfo,
          summary: String(item.system.details ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)
        }));
        break;
      case "notes":
        context.descriptionHTML = await enrich(system.details.description, actor);
        context.uniqueLootHTML = await enrich(system.loot.unique, actor);
        context.lootTablesHTML = await enrich(system.loot.tables, actor);
        break;
      case "token": {
        context.token = actor.prototypeToken;
        context.dispositions = Object.fromEntries(Object.entries(CONST.TOKEN_DISPOSITIONS)
          .map(([k, v]) => [v, L(`TOKEN.DISPOSITION.${k}`)]));
        break;
      }
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /** Abilities and masteries dropped on a monster are copied onto it. */
  async _onDropItem(event, item) {
    if (!this.isEditable) return null;
    if (item.parent === this.document) return super._onDropItem(event, item);
    if (!item.isUsable) {
      ui.notifications.warn(game.i18n.localize("ELARIA.Monster.onlyAbilities"));
      return null;
    }
    const data = item.pack ? game.items.fromCompendium(item, { keepId: false }) : item.toObject();
    delete data._id;
    delete data.folder;
    delete data.sort;
    const [created] = await this.document.createEmbeddedDocuments("Item", [data]);
    if (created) this.changeTab("abilities", "primary");
    return created ?? null;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onRollStat(event, target) {
    const stat = target.dataset.stat;
    if (event.shiftKey) return this.document.rollStat(stat, { mode: "advantage" });
    if (event.ctrlKey || event.metaKey) return this.document.rollStat(stat, { mode: "disadvantage" });
    return this.document.openRollDialog(stat);
  }

  static async #onCreateAbility() {
    const [item] = await this.document.createEmbeddedDocuments("Item", [{
      name: game.i18n.localize("ELARIA.Ability.new"), type: "ability"
    }]);
    if (!item) return;
    item.sheet.editMode = true;
    item.sheet.render({ force: true });
  }

  #item(target) {
    return this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  }

  static #onUseItem(event, target) {
    return this.#item(target)?.use();
  }

  static #onPostItem(event, target) {
    return this.#item(target)?.toChat();
  }

  static #onEditItem(event, target) {
    return this.#item(target)?.sheet.render({ force: true });
  }

  static #onDeleteItem(event, target) {
    return this.#item(target)?.deleteDialog();
  }

  static #onOpenTokenConfig() {
    const cls = foundry.applications.sheets.PrototypeTokenConfig;
    if (cls) return new cls({ prototype: this.document.prototypeToken }).render({ force: true });
    return new CONFIG.Token.prototypeSheetClass(this.document.prototypeToken).render(true);
  }
}
