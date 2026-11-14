import { ELARIA } from "../config.mjs";
import { ElariaMasteryPicker } from "../apps/mastery-picker.mjs";
import { addMasteriesToActor, addGearToActor } from "../helpers/masteries.mjs";
import { chooseBurst } from "../helpers/bursts.mjs";
import { backgroundData, findBackground, standingAdjustment } from "../helpers/backgrounds.mjs";
import { ancestryData, findHeritage, findRace } from "../helpers/ancestry.mjs";
import { checkCost, clearRecipeCache, craftRecipe, materialLabel, recipesFor } from "../helpers/crafting.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const TEMPLATES = "systems/elaria/templates/actor";

/** Turn a string list into {value: label} choices with a blank first entry. */
const choicesFrom = (list, blank = "—") => ({ "": blank, ...Object.fromEntries(list.map(v => [v, v])) });

export class ElariaCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["elaria", "sheet", "actor", "character"],
    position: { width: 760, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollStat: ElariaCharacterSheet.#onRollStat,
      rollInitiative: ElariaCharacterSheet.#onRollInitiative,
      adjustResource: ElariaCharacterSheet.#onAdjustResource,
      restoreResources: ElariaCharacterSheet.#onRestoreResources,
      toggleEditMode: ElariaCharacterSheet.#onToggleEditMode,
      rollBackground: ElariaCharacterSheet.#onRollBackground,
      setLifePoints: ElariaCharacterSheet.#onSetLifePoints,
      createMastery: ElariaCharacterSheet.#onCreateMastery,
      editItem: ElariaCharacterSheet.#onEditItem,
      deleteItem: ElariaCharacterSheet.#onDeleteItem,
      toggleEquip: ElariaCharacterSheet.#onToggleEquip,
      postItem: ElariaCharacterSheet.#onPostItem,
      createGear: ElariaCharacterSheet.#onCreateGear,
      toggleGearEquip: ElariaCharacterSheet.#onToggleGearEquip,
      useItem: ElariaCharacterSheet.#onUseItem,
      craft: ElariaCharacterSheet.#onCraft,
      viewRecipe: ElariaCharacterSheet.#onViewRecipe,
      refreshRecipes: ElariaCharacterSheet.#onRefreshRecipes,
      chooseBurst: ElariaCharacterSheet.#onChooseBurst,
      addBurstGauge: ElariaCharacterSheet.#onAddBurstGauge,
      resetBurstGauge: ElariaCharacterSheet.#onResetBurstGauge,
      useBurst: ElariaCharacterSheet.#onUseBurst
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    stats: { template: `${TEMPLATES}/tab-stats.hbs`, scrollable: [""] },
    masteries: { template: `${TEMPLATES}/tab-masteries.hbs`, scrollable: [""] },
    inventory: { template: `${TEMPLATES}/tab-inventory.hbs`, scrollable: [""] },
    crafting: { template: `${TEMPLATES}/tab-crafting.hbs`, scrollable: [""] },
    bio: { template: `${TEMPLATES}/tab-bio.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "stats" }, { id: "masteries" }, { id: "inventory" }, { id: "crafting" }, { id: "bio" }],
      initial: "stats",
      labelPrefix: "ELARIA.Tab"
    }
  };

  /** Narrowest width at which the header resources and stat table still fit. */
  static MIN_WIDTH = 700;
  static MIN_HEIGHT = 500;

  /** Stop the window from being resized (or opened) smaller than the layout needs. */
  _updatePosition(position) {
    const { MIN_WIDTH, MIN_HEIGHT } = ElariaCharacterSheet;
    if (typeof position.width === "number") position.width = Math.max(position.width, MIN_WIDTH);
    if (typeof position.height === "number") position.height = Math.max(position.height, MIN_HEIGHT);
    return super._updatePosition(position);
  }

  /** Full editing mode: shows rarely used options (scaling toggle, damage form). Per client, not saved. */
  #editMode = false;

  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;
    Object.assign(context, {
      actor,
      system,
      config: ELARIA,
      editMode: this.#editMode && this.isEditable,
      formChoices: Object.fromEntries(Object.entries(ELARIA.forms).map(([k, v]) => [k, game.i18n.localize(v)])),
      tabs: this._prepareTabs("primary"),
      lifePips: Array.fromRange(system.resources.lifePoints.max).map(i => ({
        index: i + 1, filled: i < system.resources.lifePoints.value
      })),
      resourceList: ["hp", "mp", "ftg"].map(key => {
        const r = system.resources[key];
        return { key, label: `ELARIA.Resource.${key}`, value: r.value, max: r.max, temp: r.temp,
          formulaMax: r.formulaMax, maxBonus: r.maxBonus, hasBonus: !!r.maxBonus,
          maxTip: game.i18n.format("ELARIA.Resource.maxBonusTip", { n: r.formulaMax, b: r.maxBonus >= 0 ? `+${r.maxBonus}` : r.maxBonus }),
          pct: r.max ? Math.clamp(Math.round(r.value / r.max * 100), 0, 100) : 0 };
      }),
      exhaustionTooltip: system.conditions.exhaustion
        ? Array.fromRange(system.conditions.exhaustion).map(i => `${i + 1}: ${ELARIA.exhaustion[i + 1]}`).join("<br>")
        : game.i18n.localize("ELARIA.Condition.noExhaustion"),
      critChance: `${system.combat.critChance}%`,
      critDamage: `${system.combat.critDamage}%`,
      initiativeLabel: `3d6 + ${system.stats.fin.mod}${system.penalties.initiative ? ` − ${system.penalties.initiative}` : ""}`,
      identityLine: [system.identity.race, system.identity.heritage].filter(s => s).join(" · "),
      disciplineLine: system.disciplineList.join(" · ")
    });
    // The burst (written on the Bio tab) has its name, gauge and buttons in the header, always visible.
    const burstText = system.identity.burstEffect ?? "";
    const hasText = !!burstText.replace(/<[^>]+>/g, "").trim();
    context.burstEffectHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(burstText, {
      secrets: actor.isOwner, relativeTo: actor
    });
    const gauge = system.conditions.burst;
    const full = gauge.value >= gauge.max;
    const lp = system.resources.lifePoints.value;
    const why = !full ? game.i18n.format("ELARIA.Burst.needGauge", { value: gauge.value, max: gauge.max })
      : gauge.usedToday ? game.i18n.localize("ELARIA.Burst.alreadyUsed")
        : lp < 1 ? game.i18n.localize("ELARIA.Burst.noLifePoints") : "";
    context.burst = {
      name: system.identity.burstName || (hasText ? game.i18n.localize("ELARIA.Burst.custom") : ""),
      hasText, full, pct: Math.round(100 * Math.min(1, gauge.max ? gauge.value / gauge.max : 0)),
      canUse: !why && this.isEditable,
      useHint: why || game.i18n.localize("ELARIA.Burst.useHint")
    };
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    switch (partId) {
      case "stats": this.#prepareStats(context); break;
      case "masteries": this.#prepareMasteries(context); break;
      case "inventory": this.#prepareInventory(context); break;
      case "crafting": await this.#prepareCrafting(context); break;
      case "bio": await this.#prepareBio(context); break;
    }
    return context;
  }

  #prepareStats(context) {
    const system = context.system;
    const scalingChoices = Object.fromEntries(Object.entries(ELARIA.scalings).map(([k, v]) => [k, game.i18n.localize(v)]));
    context.statGroups = Object.entries(ELARIA.statGroups).map(([groupKey, groupLabel]) => ({
      label: groupLabel,
      stats: Object.entries(ELARIA.stats).filter(([, cfg]) => cfg.group === groupKey).map(([key, cfg]) => {
        const s = system.stats[key];
        return {
          key, ...s,
          label: cfg.label,
          major: cfg.major,
          scalingChoices,
          modTooltip: game.i18n.format("ELARIA.Stats.modBreakdown", {
            base: Math.floor(s.total / 4), bonus: s.bonus, effects: s.effectBonus
          }) + (s.heritage ? ` ${game.i18n.format("ELARIA.Stats.heritagePart", { n: s.heritage > 0 ? `+${s.heritage}` : s.heritage })}` : "")
        };
      })
    }));
    context.substatGroups = Object.values(ELARIA.substats).map(group => ({
      label: group.label,
      rows: Object.entries(group.rows).map(([key, cfg]) => ({
        key, ...cfg, ...system.substats[key],
        inputValue: cfg.input ? foundry.utils.getProperty(this.document, cfg.input) : null
      }))
    }));
    const resRow = (key, label) => {
      const r = system.resistanceTotals[key];
      return {
        key, label, ...r,
        state: r.total > 0 ? "is-resist" : r.total < 0 ? "is-weak" : "",
        tooltip: r.total === 0 ? game.i18n.localize("ELARIA.Resist.neutral")
          : game.i18n.format(r.total > 0 ? "ELARIA.Resist.less" : "ELARIA.Resist.more", { n: Math.abs(r.total) })
      };
    };
    context.resistElements = Object.entries(ELARIA.resistanceElements).map(([k, label]) => resRow(k, label));
    context.resistForms = Object.entries(ELARIA.forms).map(([k, label]) => resRow(k, game.i18n.localize(label)));
    context.scalingWarning = !system.scaling.balanced || system.scaling.demSpcMismatch;
    context.scalingWarningText = [
      !system.scaling.balanced ? game.i18n.format("ELARIA.Stats.scalingUnbalanced", system.scaling) : null,
      system.scaling.demSpcMismatch ? game.i18n.localize("ELARIA.Stats.demSpcMismatch") : null
    ].filter(t => t).join(" ");
  }

  #prepareMasteries(context) {
    const system = context.system;
    const byCat = Object.fromEntries(Object.keys(ELARIA.masteryCategories).map(k => [k, []]));
    const unequipped = [];
    const noBudget = [];
    const categoryChoices = Object.fromEntries(Object.entries(ELARIA.masteryCategories)
      .map(([k, v]) => [k, game.i18n.localize(v)]));
    const items = this.document.items.filter(i => i.type === "mastery").sort((a, b) => a.sort - b.sort);
    for (const item of items) {
      const entry = {
        id: item.id, name: item.name, img: item.img, system: item.system,
        anyCategory: item.system.category === "any",
        tags: item.system.tagList,
        sourceLabel: item.system.sourceLabel,
        hasDamage: item.hasDamage,
        canRoll: item.hasDamage || !!item.skillInfo,
      };
      if (item.system.equipped && byCat[item.system.slotCategory]) byCat[item.system.slotCategory].push(entry);
      else if (item.system.equipped && item.system.slotCategory === "none") noBudget.push(entry);
      else unequipped.push(entry);
    }
    context.categoryChoices = categoryChoices;
    context.categories = Object.entries(ELARIA.masteryCategories).map(([key, label]) => ({
      key, label, ...system.mastery.categories[key], items: byCat[key]
    }));
    context.unequipped = unequipped;
    context.noBudget = noBudget;
    context.sources = [
      "General",
      system.identity.race, system.identity.heritage,
      ...system.elementList, ...system.combos,
      system.identity.deity, ...system.disciplineList, system.identity.profession
    ].filter(s => s);
  }

  /** Inventory tab: coins, belt, worn armour and trinkets, and the bag (Character Stats rows 106+). */
  #prepareInventory(context) {
    const system = context.system;
    const L = k => game.i18n.localize(k);
    const load = system.combat.equipLoad;
    const strip = h => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const rows = { belt: [], armour: [], trinkets: [], bag: [] };
    const gear = this.document.items.filter(i => i.type === "gear").sort((a, b) => a.sort - b.sort);
    for (const item of gear) {
      const s = item.system;
      const tooHeavy = s.equipLoad !== null && s.equipLoad > load;
      const entry = {
        id: item.id, name: item.name, img: item.img, system: s,
        kindLabel: L(ELARIA.gearKinds[s.kind] ?? s.kind),
        canEquip: !!s.equipSlot,
        equipped: s.location !== "bag",
        canRoll: item.hasDamage,
        tooHeavy,
        tooHeavyTip: tooHeavy ? game.i18n.format("ELARIA.Gear.tooHeavy", { need: s.equipLoad, have: load }) : "",
        effects: strip(s.effects).slice(0, 200),
        stats: [
          s.baseAttack?.raw ? `${s.baseAttack.raw}${s.damageType ? ` · ${s.damageType}` : ""}` : "",
          s.armourRating !== null ? `AAR ${s.armourRating}${s.weight ? ` · ${s.weight}` : ""}` : "",
          s.breakpoint !== null ? `${L("ELARIA.Gear.breakpointShort")} ${s.breakpoint}` : "",
          s.equipLoad !== null ? `${L("ELARIA.Gear.equipLoadShort")} ${s.equipLoad}` : "",
          s.affinity ? `${L("ELARIA.Gear.affinity")} ${s.affinity}` : ""
        ].filter(x => x)
      };
      if (s.location === "belt") rows.belt.push(entry);
      else if (s.location === "worn" && s.kind === "armour") rows.armour.push(entry);
      else if (s.location === "worn") rows.trinkets.push(entry);
      else rows.bag.push(entry);
    }
    const lim = ELARIA.inventory;
    const classWorn = rows.trinkets.filter(t => t.system.classTrinket).length;
    const section = (key, list, max, extra = {}) => ({ key, label: `ELARIA.Inventory.${key}`, items: list, used: list.length, max,
      over: max !== null && list.length > max, ...extra });
    context.inventory = {
      coins: Object.entries(ELARIA.coins).map(([k, label]) => ({ key: k, label, value: system.coins[k] })),
      coinTotal: system.coinTotalSp.toLocaleString(game.i18n.lang, { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
      showCoinTotal: system.showCoinTotal,
      equipLoad: load,
      aar: system.wornArmourAAR,
      sections: [
        section("belt", rows.belt, lim.beltSlots, { hint: "ELARIA.Inventory.beltHint" }),
        section("armour", rows.armour, lim.armourSlots, { hint: "ELARIA.Inventory.armourHint", note: game.i18n.format("ELARIA.Inventory.aarFromArmour", { n: system.wornArmourAAR }) }),
        section("trinkets", rows.trinkets, lim.trinketSlots, {
          hint: "ELARIA.Inventory.trinketsHint",
          note: classWorn ? game.i18n.format("ELARIA.Inventory.classTrinkets", { n: classWorn, max: lim.classTrinketSlots }) : "",
          noteOver: classWorn > lim.classTrinketSlots
        }),
        section("bag", rows.bag, system.combat.bagSlots, { hint: "ELARIA.Inventory.bagHint", isBag: true })
      ]
    };
  }

  /** Recipes shown on the Crafting tab (kept for the Craft buttons). */
  #recipes = [];

  /**
   * Crafting tab: materials owned (per tier) and everything the character's profession can craft, with what each
   * costs and whether they have it.
   */
  async #prepareCrafting(context) {
    const actor = this.document;
    const system = context.system;
    const profession = system.identity.profession;
    const level = system.level ?? 0;
    const L = k => game.i18n.localize(k);
    this.#recipes = profession ? await recipesFor(profession) : [];
    const ownedNames = new Set(actor.items.filter(i => i.type === "gear").map(i => i.name));
    context.crafting = {
      profession,
      tiers: ELARIA.materialTiers,
      materials: Object.keys(ELARIA.materials).map(key => ({
        key, label: materialLabel(key),
        tiers: ELARIA.materialTiers.map(t => ({ t, name: `system.materials.${key}.t${t}`, value: system.materials[key][`t${t}`] }))
      })),
      recipes: this.#recipes.map((r, index) => {
        const cost = checkCost(actor, r);
        const locked = r.reqLevel > level;
        const canEvolve = !!r.evolvesFrom && ownedNames.has(r.evolvesFrom);
        return {
          index, ...r, locked, ok: cost.ok, canEvolve,
          search: [r.name, r.family, r.text, r.evolvesFrom].join(" ").toLowerCase(),
          costParts: cost.parts.map(p => ({ text: `${p.amount} ${materialLabel(p.key)}`, ok: p.ok, have: p.have })),
          noMaterials: !r.parts.length,
          kindLabel: r.kind && r.kind !== "item" ? L(ELARIA.gearKinds[r.kind] ?? r.kind) : "",
          short: r.text.length > 160 ? `${r.text.slice(0, 157)}…` : r.text
        };
      }),
      level,
      editable: this.isEditable
    };
    context.crafting.count = context.crafting.recipes.length;
  }

  async #prepareBio(context) {
    const system = context.system;
    const id = system.identity;
    // Ancestry: the race list and only that race's heritages (Ancestry tab). Old names ("Bushido") match the
    // sheet's ("Bushido Clan").
    const anc = ancestryData();
    const race = findRace(id.race, anc);
    const heritage = system.heritageData;
    context.raceValue = race?.name ?? id.race;
    context.heritageValue = heritage?.name ?? id.heritage;
    const statLabel = k => game.i18n.localize(ELARIA.stats[k]?.label ?? k);
    context.heritageInfo = heritage ? {
      text: heritage.statModsRaw || game.i18n.localize("ELARIA.Bio.noHeritageMods"),
      choices: system.heritageMods.choices.map(c => ({
        index: c.index, chosen: c.chosen,
        label: game.i18n.format(c.amount >= 0 ? "ELARIA.Bio.heritagePlus" : "ELARIA.Bio.heritageMinus", { n: Math.abs(c.amount) }),
        options: { "": game.i18n.localize("ELARIA.Bio.pickStat"), ...Object.fromEntries(c.options.map(o => [o, statLabel(o)])) }
      })),
      applied: [
        ...Object.entries(system.heritageMods.stats).filter(([, v]) => v).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${ELARIA.stats[k]?.abbr ?? k}`),
        ...Object.entries(system.heritageMods.derived).map(([k, v]) => `${v > 0 ? "+" : ""}${v}${/crit/.test(k) ? "%" : ""} ${game.i18n.localize(`ELARIA.Bio.derived.${k}`)}`),
        ...Object.entries(system.heritageMods.resources).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${game.i18n.localize(`ELARIA.Resource.${k}`)} max`)
      ].join(", ")
    } : null;
    const keep = (list, value) => (value && !list.includes(value) ? [...list, value] : list);
    context.choices = {
      races: choicesFrom(keep(anc.map(r => r.name), context.raceValue)),
      heritages: race
        ? choicesFrom(keep((race.heritages ?? []).map(h => h.name), context.heritageValue))
        : { "": game.i18n.localize("ELARIA.Bio.pickRaceFirst"), ...(id.heritage ? { [id.heritage]: id.heritage } : {}) },
      disciplines: choicesFrom(ELARIA.disciplines),
      slot2: {
        "": "—",
        ...Object.fromEntries(Object.entries(ELARIA.slot2Options).map(([k, v]) => [k, game.i18n.localize(v)])),
        ...Object.fromEntries(ELARIA.disciplines.map(d => [d, d]))
      },
      professions: choicesFrom(keep(ELARIA.professions, id.profession)),
      elements: choicesFrom(ELARIA.elements),
      deities: choicesFrom(ELARIA.deities),
      alignments: choicesFrom(ELARIA.alignments),
      alignments2: choicesFrom(ELARIA.alignments, "— none —"),
      deityRoles: Object.fromEntries(Object.entries(ELARIA.deityRoles).map(([k, v]) => [k, game.i18n.localize(v)]))
    };
    context.showThirdElement = id.discipline2 === "extraElement";
    context.alignmentTriggers = [id.alignment, id.alignment2].filter((a, i, arr) => a && arr.indexOf(a) === i)
      .map(name => ({ name, trigger: ELARIA.alignmentBurst[name] ?? "", ...(ELARIA.alignmentInfo[name] ?? {}) }));
    const opposes = ELARIA.alignmentInfo[id.alignment]?.opposes ?? [];
    context.alignmentConflict = id.alignment2 && opposes.includes(id.alignment2)
      ? game.i18n.format("ELARIA.Burst.opposing", { a: id.alignment, b: id.alignment2 }) : "";
    context.moodChoices = Object.fromEntries(Object.entries(ELARIA.moods)
      .map(([mood, max]) => [mood, game.i18n.format("ELARIA.Burst.moodOption", { mood, max })]));
    context.burstSources = [
      { label: game.i18n.localize("ELARIA.Burst.alignmentSource"), n: ELARIA.alignmentBurstGauge },
      ...ELARIA.burstGaugeSources.map(([label, n]) => ({ label, n }))
    ];
    // Background: scale, social standing, and the matching background's description / perk / inventory.
    const bgData = backgroundData();
    const bg = findBackground(id.backgroundScale, id.backgroundRoll, bgData);
    context.background = {
      hasData: !!bgData,
      scaleChoices: { "": game.i18n.localize("ELARIA.Background.pickScale"),
        ...Object.fromEntries((bgData?.scales ?? []).map(sc => [sc.id, sc.name])) },
      ranges: bgData?.scales.find(sc => sc.id === id.backgroundScale)?.tiers.map(t => ({ range: t.range, name: t.name,
        current: t === bg })) ?? [],
      current: bg,
      adjust: standingAdjustment(this.document),
      canRoll: !!id.backgroundScale && this.isEditable
    };
        context.biographyHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(id.biography, {
      secrets: this.document.isOwner, relativeTo: this.document
    });
  }

  /* -------------------------------------------- */

  /** Crafting filters (search, only craftable, show higher levels), kept across re-renders. */
  #craftFilters = { text: "", ready: false, locked: false };

  #applyCraftFilters() {
    const root = this.element.querySelector(".tab.crafting");
    if (!root) return;
    const f = this.#craftFilters;
    const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const row of root.querySelectorAll(".recipe[data-recipe]")) {
      const show = (!words.length || words.every(w => row.dataset.search.includes(w)))
        && (!f.ready || row.dataset.ok === "true")
        && (f.locked || row.dataset.locked !== "true");
      row.hidden = !show;
      if (show) shown++;
    }
    const count = root.querySelector(".recipe-count");
    if (count) count.textContent = game.i18n.format("ELARIA.Craft.count", { n: shown });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const craft = this.element.querySelector(".tab.crafting");
    if (craft) {
      const search = craft.querySelector("[data-craft-filter=text]");
      if (search) {
        search.value = this.#craftFilters.text;
        search.addEventListener("input", () => { this.#craftFilters.text = search.value; this.#applyCraftFilters(); });
        search.addEventListener("change", ev => ev.stopPropagation());
      }
      for (const box of craft.querySelectorAll("input[type=checkbox][data-craft-filter]")) {
        box.checked = this.#craftFilters[box.dataset.craftFilter];
        box.addEventListener("change", ev => {
          ev.stopPropagation();
          this.#craftFilters[box.dataset.craftFilter] = box.checked;
          this.#applyCraftFilters();
        });
      }
      this.#applyCraftFilters();
    }
    // Inputs that mirror a field shown elsewhere on the sheet. They have no name (so the form never submits
    // the same field twice) and save directly instead.
    for (const el of this.element.querySelectorAll("[data-actor-field]")) {
      el.addEventListener("change", ev => {
        ev.stopPropagation();
        let value = el.type === "checkbox" ? el.checked : el.value;
        if (el.type === "number") value = Number.isFinite(el.valueAsNumber) ? Math.round(el.valueAsNumber) : 0;
        this.document.update({ [el.dataset.actorField]: value });
      });
    }
    // Inputs that edit an embedded item rather than the actor.
    for (const el of this.element.querySelectorAll("[data-item-field]")) {
      el.addEventListener("change", ev => {
        ev.stopPropagation();
        const item = this.document.items.get(el.closest("[data-item-id]")?.dataset.itemId);
        item?.update({ [el.dataset.itemField]: el.type === "checkbox" ? el.checked : el.value });
      });
    }
  }

  /**
   * The edit-mode max boxes show the current max. Only a changed number becomes an override; typing the
   * formula's own value (or clearing the box) goes back to the formula.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    // Ancestry: a new race clears a heritage it doesn't have; a new heritage clears its stat picks; the stat
    // picks come in as {0: "str"} and are stored as an array.
    const idNow = this.document.system.identity;
    const idNew = foundry.utils.getProperty(data, "system.identity");
    if (idNew) {
      const raceName = idNew.race ?? idNow.race;
      const heritageName = idNew.heritage ?? idNow.heritage;
      // "Changed" means a different race / heritage, not just an old name ("Bushido") saved as the new one.
      const raceChanged = "race" in idNew && findRace(idNew.race)?.name !== findRace(idNow.race)?.name;
      const race = findRace(raceName);
      if (raceChanged && heritageName && !findHeritage(race, heritageName)) idNew.heritage = "";
      const heritageChanged = raceChanged || ("heritage" in idNew
        && findHeritage(race, idNew.heritage)?.name !== findHeritage(findRace(idNow.race), idNow.heritage)?.name);
      let picks = idNew.heritageChoices;
      if (picks && !Array.isArray(picks)) {
        const arr = [...(idNow.heritageChoices ?? [])];
        for (const [i, v] of Object.entries(picks)) arr[Number(i)] = v ?? "";
        picks = Array.from(arr, v => v ?? "");
      }
      if (heritageChanged) picks = [];
      if (picks !== undefined) idNew.heritageChoices = picks;
    }
    // Choosing a scale or standing also stores the background's name (shown elsewhere and kept if data changes).
    const scalePath = "system.identity.backgroundScale", rollPath = "system.identity.backgroundRoll";
    if (foundry.utils.hasProperty(data, scalePath) || foundry.utils.hasProperty(data, rollPath)) {
      const id = this.document.system.identity;
      const scale = foundry.utils.getProperty(data, scalePath) ?? id.backgroundScale;
      const roll = foundry.utils.getProperty(data, rollPath) ?? id.backgroundRoll;
      const bg = findBackground(scale, roll === "" ? null : roll);
      if (bg) foundry.utils.setProperty(data, "system.identity.background", bg.name);
    }
    return data;
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /**
   * A mastery dropped from a compendium, the Items directory or another actor is copied in (unequipped).
   * Dropping one of this actor's own masteries just re-sorts it, as in core.
   */
  async _onDropItem(event, item) {
    if (!this.isEditable) return null;
    if (item.parent === this.document) return super._onDropItem(event, item);
    if (item.type === "gear") {
      const [created] = await addGearToActor(this.document, [item]);
      if (created) this.changeTab("inventory", "primary");
      return created ?? null;
    }
    if (item.type !== "mastery") {
      ui.notifications.warn(game.i18n.localize("ELARIA.Mastery.onlyMasteries"));
      return null;
    }
    const [created] = await addMasteriesToActor(this.document, [item]);
    if (created) this.changeTab("masteries", "primary");
    return created ?? null;
  }

  /** Dropping a folder of masteries (e.g. a whole discipline from the compendium) adds them all, after a check. */
  async _onDropFolder(event, folder) {
    if (!this.isEditable || folder.type !== "Item") return super._onDropFolder(event, folder);
    const items = folder.pack
      ? await game.packs.get(folder.pack).getDocuments({ folder: folder.id })
      : folder.contents;
    const masteries = items.filter(i => i.type === "mastery");
    const gear = items.filter(i => i.type === "gear");
    if (!masteries.length && gear.length) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("ELARIA.Gear.addTitle") },
        content: `<p>${game.i18n.format("ELARIA.Gear.addFolder", {
          n: gear.length, folder: foundry.utils.escapeHTML(folder.name), name: foundry.utils.escapeHTML(this.document.name)
        })}</p>`
      });
      if (!ok) return null;
      await addGearToActor(this.document, gear);
      this.changeTab("inventory", "primary");
      return folder;
    }
    if (!masteries.length) return null;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("ELARIA.Mastery.addTitle") },
      content: `<p>${game.i18n.format("ELARIA.Mastery.addFolder", {
        n: masteries.length, folder: foundry.utils.escapeHTML(folder.name), name: foundry.utils.escapeHTML(this.document.name)
      })}</p>`
    });
    if (!confirmed) return null;
    await addMasteriesToActor(this.document, masteries);
    this.changeTab("masteries", "primary");
    return folder;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** Click: open the roll window with this stat. Shift-click / Ctrl-click: roll at once with (dis)advantage. */
  static #onRollStat(event, target) {
    const stat = target.dataset.stat;
    if (event.shiftKey) return this.document.rollStat(stat, { mode: "advantage" });
    if (event.ctrlKey || event.metaKey) return this.document.rollStat(stat, { mode: "disadvantage" });
    return this.document.openRollDialog(stat);
  }

  static #onRollInitiative() {
    return this.document.rollInitiative({ createCombatants: true });
  }

  /** +1 / −1 buttons. Losing goes through temp first; gaining stops at max. */
  static #onAdjustResource(event, target) {
    const delta = Number(target.dataset.delta);
    return this.document.modifyResource(target.dataset.resource, -delta);
  }

  static async #onRestoreResources() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("ELARIA.Resource.restoreTitle") },
      content: `<p>${game.i18n.format("ELARIA.Resource.restoreConfirm", { name: this.document.name })}</p>`
    });
    if (confirmed) return this.document.restoreResources();
  }

  /** Roll the d20 social standing for the chosen scale, post it, and fill in the standing. */
  static async #onRollBackground() {
    const actor = this.document;
    const id = actor.system.identity;
    const data = backgroundData();
    const scale = data?.scales.find(sc => sc.id === id.backgroundScale);
    if (!scale) return ui.notifications.warn(game.i18n.localize("ELARIA.Background.pickScaleFirst"));
    const roll = await new Roll("1d20").evaluate();
    const bg = findBackground(scale.id, roll.total, data);
    const esc = foundry.utils.escapeHTML;
    const adjust = standingAdjustment(actor);
    const content = `
      <div class="elaria roll-card background-roll">
        <header><div class="titles"><h3>${esc(game.i18n.format("ELARIA.Background.rollTitle", { scale: scale.name }))}</h3>
          <span class="note">${esc(game.i18n.format("ELARIA.Background.adjustNote", { n: adjust }))}</span></div></header>
        <div class="results two">
          <div class="result ${roll.total === 20 ? "nat20" : roll.total === 1 ? "nat1" : ""}"><span class="label">d20</span><span class="value">${roll.total}</span></div>
          <div class="result"><span class="label">${esc(bg?.range ?? "")}</span><span class="value bg-name">${esc(bg?.name ?? "—")}</span></div>
        </div>
      </div>`;
    const msg = { author: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content, rolls: [roll], sound: CONFIG.sounds.dice };
    if (typeof ChatMessage.applyMode === "function") ChatMessage.applyMode(msg, game.settings.get("core", "messageMode"));
    else ChatMessage.applyRollMode(msg, game.settings.get("core", "rollMode"));
    await ChatMessage.implementation.create(msg);
    return actor.update({ "system.identity.backgroundRoll": roll.total, ...(bg ? { "system.identity.background": bg.name } : {}) });
  }

  static #onToggleEditMode() {
    this.#editMode = !this.#editMode;
    return this.render();
  }

  /** Click a pip to set life points; clicking the last filled pip empties it. */
  static #onSetLifePoints(event, target) {
    const index = Number(target.dataset.index);
    const current = this.document.system.resources.lifePoints.value;
    return this.document.update({ "system.resources.lifePoints.value": index === current ? index - 1 : index });
  }

  /** "Add mastery": choose between a blank new mastery and the compendium picker. */
  static async #onCreateMastery() {
    const L = k => game.i18n.localize(k);
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: L("ELARIA.Mastery.addTitle"), icon: "fa-solid fa-plus" },
      classes: ["elaria", "add-mastery-dialog"],
      content: `<p>${game.i18n.format("ELARIA.Mastery.addPrompt", { name: foundry.utils.escapeHTML(this.document.name) })}</p>`,
      buttons: [
        { action: "compendium", label: L("ELARIA.Mastery.fromCompendium"), icon: "fa-solid fa-book-open", default: true },
        { action: "new", label: L("ELARIA.Mastery.createBlank"), icon: "fa-solid fa-file-circle-plus" }
      ],
      rejectClose: false
    });
    if (choice === "compendium") return ElariaMasteryPicker.open(this.document);
    if (choice !== "new") return;
    const [item] = await this.document.createEmbeddedDocuments("Item", [{
      name: L("ELARIA.Mastery.new"), type: "mastery"
    }]);
    if (!item) return;
    item.sheet.editMode = true;
    item.sheet.render({ force: true });
  }

  static #onEditItem(event, target) {
    this.document.items.get(target.closest("[data-item-id]").dataset.itemId)?.sheet.render(true);
  }

  static #onDeleteItem(event, target) {
    return this.document.items.get(target.closest("[data-item-id]").dataset.itemId)?.deleteDialog();
  }

  static async #onToggleEquip(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]").dataset.itemId);
    if (!item) return;
    const equipping = !item.system.equipped;
    await item.update({ "system.equipped": equipping });
    // Jack of all Trades: warn when this pushes a discipline / element past lvl/2.
    const joat = item.type === "mastery" && equipping ? this.document.system.mastery?.joat : null;
    const names = new Set(item.system.sources?.map(s => s.name) ?? []);
    const over = joat?.over.filter(g => names.has(g.name)) ?? [];
    if (over.length) ui.notifications.warn(game.i18n.format("ELARIA.Mastery.joatOver", {
      list: over.map(g => `${g.name} ${g.used}/${joat.cap}`).join(", ")
    }));
  }

  /** Crafting tab: craft a recipe (or evolve the owned item it evolves from). */
  static async #onCraft(event, target) {
    const recipe = this.#recipes[Number(target.closest("[data-recipe]")?.dataset.recipe)];
    if (!recipe) return;
    target.classList.add("busy");
    try {
      await craftRecipe(this.document, recipe, { evolve: target.dataset.evolve === "true" });
    } finally {
      target.classList.remove("busy");
    }
  }

  static async #onViewRecipe(event, target) {
    const recipe = this.#recipes[Number(target.closest("[data-recipe]")?.dataset.recipe)];
    (await fromUuid(recipe?.uuid ?? ""))?.sheet.render({ force: true });
  }

  /** Re-read the compendiums (after an import). */
  static #onRefreshRecipes() {
    clearRecipeCache();
    return this.render({ parts: ["crafting"] });
  }

  /** Click a mastery's / gear's name: things that roll open the roll window, others open their sheet (description). */
  static #onUseItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]").dataset.itemId);
    if (!item) return;
    return item.canRoll ? item.use() : item.sheet.render({ force: true });
  }

  /** "Add item": a blank item, or pick gear from the compendiums. */
  static async #onCreateGear() {
    const L = k => game.i18n.localize(k);
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: L("ELARIA.Gear.addTitle"), icon: "fa-solid fa-plus" },
      classes: ["elaria", "add-mastery-dialog"],
      content: `<p>${game.i18n.format("ELARIA.Gear.addPrompt", { name: foundry.utils.escapeHTML(this.document.name) })}</p>`,
      buttons: [
        { action: "compendium", label: L("ELARIA.Mastery.fromCompendium"), icon: "fa-solid fa-book-open", default: true },
        { action: "new", label: L("ELARIA.Gear.createBlank"), icon: "fa-solid fa-file-circle-plus" }
      ],
      rejectClose: false
    });
    if (choice === "compendium") return ElariaMasteryPicker.open(this.document, "gear");
    if (choice !== "new") return;
    const [item] = await this.document.createEmbeddedDocuments("Item", [{
      name: L("ELARIA.Gear.new"), type: "gear"
    }]);
    if (!item) return;
    item.sheet.editMode = true;
    item.sheet.render({ force: true });
  }

  /** Move gear between the bag and the belt (weapons) or worn (armour, trinkets). */
  static #onToggleGearEquip(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]").dataset.itemId);
    if (!item?.system.equipSlot) return;
    return item.update({ "system.location": item.system.location === "bag" ? item.system.equipSlot : "bag" });
  }

  /**
   * Bio: fill the burst's name and text from one of the pre-made bursts (or empty them). Asks first when that
   * would replace something already written there.
   */
  static async #onChooseBurst() {
    const actor = this.document;
    const picked = await chooseBurst(actor);
    if (!picked) return;
    const id = actor.system.identity;
    const written = !!(id.burstName.trim() || (id.burstEffect ?? "").replace(/<[^>]+>/g, "").trim());
    if (written) {
      const esc = foundry.utils.escapeHTML;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("ELARIA.Burst.replaceTitle") },
        content: `<p>${picked === "clear"
          ? game.i18n.format("ELARIA.Burst.clearConfirm", { old: esc(id.burstName || game.i18n.localize("ELARIA.Burst.custom")) })
          : game.i18n.format("ELARIA.Burst.replaceConfirm", { old: esc(id.burstName || game.i18n.localize("ELARIA.Burst.custom")), name: esc(picked.name) })}</p>`,
        rejectClose: false
      });
      if (!ok) return;
    }
    if (picked === "clear") return actor.update({ "system.identity.burstName": "", "system.identity.burstEffect": "" });
    const html = picked.text.split(/\n+/).map(p => `<p>${foundry.utils.escapeHTML(p)}</p>`).join("");
    return actor.update({ "system.identity.burstName": picked.name, "system.identity.burstEffect": html });
  }

  /** Header: empty the burst gauge. */
  static #onResetBurstGauge() {
    return this.document.update({ "system.conditions.burst.value": 0 });
  }

  /**
   * Header: add to the burst gauge (Bursts/Alignment). A window of tick boxes: one per alignment the character
   * has (+2 each, with its trigger), then the general reasons. Everything ticked is added at once, never past
   * the gauge's maximum, with a line in chat saying why.
   */
  static async #onAddBurstGauge() {
    const actor = this.document;
    const esc = foundry.utils.escapeHTML;
    const L = k => game.i18n.localize(k);
    const id = actor.system.identity;
    const gauge = actor.system.conditions.burst;
    const alignments = [...new Set([id.alignment, id.alignment2].filter(a => a))];
    const options = [
      ...alignments.map(a => ({
        label: game.i18n.format("ELARIA.Burst.alignmentOption", { alignment: a }), n: ELARIA.alignmentBurstGauge,
        hint: ELARIA.alignmentBurst[a] ?? ""
      })),
      ...ELARIA.burstGaugeSources.map(([label, n]) => ({ label, n, hint: "" }))
    ];
    const row = (o, i) => `
      <label class="burst-source">
        <input type="checkbox" name="src" value="${i}">
        <span>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ""}</span>
        <b>+${o.n}</b>
      </label>`;
    const alignmentRows = alignments.length ? options.slice(0, alignments.length).map(row).join("")
      : `<p class="hint">${L("ELARIA.Burst.noAlignmentPicked")}</p>`;
    const content = `
      <p class="hint">${game.i18n.format("ELARIA.Burst.addIntro", { value: gauge.value, max: gauge.max })}</p>
      <div class="burst-sources-list">
        <h4>${L("ELARIA.Burst.alignmentHeading")}</h4>
        ${alignmentRows}
        <h4>${L("ELARIA.Burst.otherHeading")}</h4>
        ${options.slice(alignments.length).map((o, i) => row(o, i + alignments.length)).join("")}
      </div>
      <p class="burst-total">${L("ELARIA.Burst.total")} <b class="sum">+0</b> → <b class="result">${gauge.value}</b> / ${gauge.max}</p>`;
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("ELARIA.Burst.addTitle", { name: actor.name }), icon: "fa-solid fa-burst" },
      classes: ["elaria", "burst-dialog"],
      position: { width: 460 },
      content,
      buttons: [
        { action: "add", label: L("ELARIA.Burst.addButton"), icon: "fa-solid fa-plus", default: true,
          callback: (event, button) => [...button.form.querySelectorAll("input[name=src]:checked")].map(el => Number(el.value)) },
        { action: "cancel", label: L("Cancel"), icon: "fa-solid fa-xmark" }
      ],
      render: (event, dialog) => {
        const root = dialog.element ?? dialog;
        const update = () => {
          const sum = [...root.querySelectorAll("input[name=src]:checked")].reduce((t, el) => t + options[Number(el.value)].n, 0);
          root.querySelector(".burst-total .sum").textContent = `+${sum}`;
          root.querySelector(".burst-total .result").textContent = Math.min(gauge.max, gauge.value + sum);
        };
        root.querySelectorAll("input[name=src]").forEach(el => el.addEventListener("change", update));
      },
      rejectClose: false
    });
    if (!Array.isArray(picked) || !picked.length) return;
    const chosen = picked.map(i => options[i]).filter(o => o);
    const n = chosen.reduce((t, o) => t + o.n, 0);
    const now = actor.system.conditions.burst;
    const to = Math.min(now.max, now.value + n);
    await actor.update({ "system.conditions.burst.value": to });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="elaria chat-card burst-card"><p><i class="fa-solid fa-burst"></i> `
        + `${game.i18n.format("ELARIA.Burst.gained", { n, value: to, max: now.max })}`
        + `${to >= now.max ? ` <b>${L("ELARIA.Burst.gaugeFull")}</b>` : ""}</p>`
        + `<ul class="burst-reasons">${chosen.map(o => `<li>${esc(o.label)} <b>+${o.n}</b></li>`).join("")}</ul></div>`
    });
  }

  /**
   * Header: burst! (Only with a full gauge, a life point left and no burst yet today.) Posts the burst's name and
   * effect to chat and, unless unticked, does what bursting does: spends a life point, heals half max HP (reviving
   * from 0), and refills FTG and MP. Marks the burst as used today.
   */
  static async #onUseBurst() {
    const actor = this.document;
    const sys = actor.system;
    const gauge = sys.conditions.burst;
    if (gauge.value < gauge.max || gauge.usedToday || sys.resources.lifePoints.value < 1) return;
    const esc = foundry.utils.escapeHTML;
    const id = sys.identity;
    const name = id.burstName || game.i18n.localize("ELARIA.Burst.custom");
    const answer = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("ELARIA.Burst.useTitle", { name: actor.name }), icon: "fa-solid fa-burst" },
      content: `<p>${game.i18n.format("ELARIA.Burst.useConfirm", { name: esc(name) })}</p>
        <label class="checkbox"><input type="checkbox" name="apply" checked> ${game.i18n.localize("ELARIA.Burst.applyEffects")}</label>`,
      buttons: [
        { action: "burst", label: game.i18n.localize("ELARIA.Burst.useButton"), icon: "fa-solid fa-burst", default: true,
          callback: (event, button) => (button.form.elements.apply.checked ? "apply" : "post") },
        { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if (answer !== "apply" && answer !== "post") return;

    const update = { "system.conditions.burst.usedToday": true };
    const notes = [];
    if (answer === "apply") {
      const res = sys.resources;
      const heal = Math.floor(res.hp.max / 2);
      const hp = Math.min(res.hp.max, Math.max(0, res.hp.value) + heal);
      update["system.resources.hp.value"] = hp;
      update["system.resources.mp.value"] = res.mp.max;
      update["system.resources.ftg.value"] = res.ftg.max;
      update["system.resources.lifePoints.value"] = res.lifePoints.value - 1;
      if (res.hp.value <= 0) notes.push(game.i18n.localize("ELARIA.Burst.revived"));
      notes.push(game.i18n.format("ELARIA.Burst.applied", { heal, hp, max: res.hp.max, lp: res.lifePoints.value - 1 }));
    }
    await actor.update(update);
    const text = await foundry.applications.ux.TextEditor.implementation.enrichHTML(id.burstEffect, { relativeTo: actor });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="elaria chat-card burst-card"><header><h3><i class="fa-solid fa-burst"></i> `
        + `${game.i18n.localize("ELARIA.Burst.title")}: ${esc(name)}</h3></header>`
        + `<div class="details">${text || `<p><em>${game.i18n.localize("ELARIA.Burst.noEffect")}</em></p>`}</div>`
        + `${notes.length ? `<p class="burst-applied">${notes.join(" ")}</p>` : ""}</div>`
    });
  }

  static #onPostItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]").dataset.itemId);
    return item?.toChat({ spend: !item.canRoll });   // nothing to roll: posting it is using it
  }
}
