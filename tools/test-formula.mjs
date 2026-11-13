/** Roll text and cost parsing (node tools/test-formula.mjs). */
import { parseDamageText, parseSkillText } from "../module/dice/formula.mjs";
import { readSkillMod } from "../module/dice/skill.mjs";
import { itemCosts } from "../module/combat/costs.mjs";
import { splitBurst } from "../module/importer/convert.mjs";

let failed = 0;
const same = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};
const dmg = (dice, stat, bonus = "", hits = 1) => ({ dice, stat, bonus, hits });

same("3d6+Str+1", parseDamageText("3d6+Str+1"), dmg("3d6", "str", "1"));
same("3d6+1+Str", parseDamageText("3d6+1+Str"), dmg("3d6", "str", "1"));
same("spaces", parseDamageText(" 3d6 + 1 + Str "), dmg("3d6", "str", "1"));
same("minus", parseDamageText("1d6+Str-2"), dmg("1d6", "str", "- 2"));
same("hits", parseDamageText("3d6+1+Str x2"), dmg("3d6", "str", "1", 2));
same("hits glued", parseDamageText("2d6+Strx2"), dmg("2d6", "str", "", 2));
same("hits glued 2", parseDamageText("4d6+Smartx2"), dmg("4d6", "smrts", "", 2));
same("hits first", parseDamageText("3 x 2d6+Str"), dmg("2d6", "str", "", 3));
same("variable hits", parseDamageText("1d6+Strx#"), dmg("1d6", "str"));
same("alternatives", parseDamageText("3d6+Wis/5d6+Wis"), dmg("3d6", "wis"));
same("extra dice and stat", parseDamageText("2d6+Str+1d4+Fin"), dmg("2d6", "str", "1d4 + @fin"));
same("two numbers", parseDamageText("2d6+2+Str+3"), dmg("2d6", "str", "2 + 3"));
same("words ignored", parseDamageText("Base weapon damage + 2d6 + 1d6 per stack"), dmg("2d6", ""));
same("no dice", parseDamageText("N/A"), dmg("", ""));
same("exotic stat word", parseDamageText("2d6+Sex"), dmg("2d6", ""));

same("2+Fin", parseSkillText("2+Fin"), { stats: ["fin"], bonus: 2 });
same("Fin+1", parseSkillText("Fin+1"), { stats: ["fin"], bonus: 1 });
same("2+Fin+1", parseSkillText("2+Fin+1"), { stats: ["fin"], bonus: 3 });
same("or", parseSkillText("1+Pre or Smrts"), { stats: ["pre", "smrts"], bonus: 1 });
same("n/a", parseSkillText("N/A"), null);
same("read: text wins over stale fields", readSkillMod({ raw: "Fin+3", stats: ["str"], bonus: 1 }), { raw: "Fin+3", stats: ["fin"], bonus: 3 });
same("read: fixed", readSkillMod({ raw: "Fin (melee) or Pre (thrown)", stats: ["fin"], bonus: 0, fixed: true }),
  { raw: "Fin (melee) or Pre (thrown)", stats: ["fin"], bonus: 0 });
same("read: none", readSkillMod({ raw: "—" }), null);

const item = (cost, costs = []) => ({ system: { cost, costs } });
same("cost ftg", itemCosts(item("3 ftg")), { ftg: 3, mp: 0 });
same("cost mana", itemCosts(item("Costs 5 Mana.")), { ftg: 0, mp: 5 });
same("cost both", itemCosts(item("2 mp, 1 ftg")), { ftg: 1, mp: 2 });
same("cost other", itemCosts(item("1 ap, 2 hp")), { ftg: 0, mp: 0 });
same("cost variable", itemCosts(item("X mp")), { ftg: 0, mp: 0 });
same("cost from list", itemCosts(item("", [{ amount: 4, resource: "mp" }, { amount: null, resource: "ftg" }])), { ftg: 0, mp: 4 });
same("cost none", itemCosts(item("")), { ftg: 0, mp: 0 });

same("burst colon", splitBurst("Stalwart Sentinel: Create a field."), { name: "Stalwart Sentinel", text: "Create a field." });
same("burst comma", splitBurst("Bone Armour, Spend 50% of your hp."), { name: "Bone Armour", text: "Spend 50% of your hp." });
same("burst no name", splitBurst("Heal everyone nearby for a lot of hit points and then some more."), { name: "", text: "Heal everyone nearby for a lot of hit points and then some more." });

console.log(failed ? `${failed} check(s) failed` : "All formula checks passed");
process.exit(failed ? 1 : 0);
