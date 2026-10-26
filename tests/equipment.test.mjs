// The equipment module: layout rules, the inventory templates, drag and drop, the wear button and the world step.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app/");
const Handlebars = require("handlebars");
const Q = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const F = new URL("../scripts", import.meta.url).href;

const getProperty = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const setProperty = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); let t = o; for (const k of ks) { t = t[k] ??= {}; } t[last] = v; };
const en = JSON.parse(readFileSync(`${Q}/languages/en.json`, "utf8"));
const ru = JSON.parse(readFileSync(`${Q}/languages/ru.json`, "utf8"));
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
assert.deepEqual(flat(ru).sort(), flat(en).sort(), "ru and en have the same keys");
const missing = new Set();
const localize = key => {
	const value = getProperty(en, key);
	if (typeof value !== "string") {
		if (key.startsWith("MIST_EQUIP")) { missing.add(key); }
		return key;
	}
	return value;
};
const format = (key, data) => localize(key).replace(/{(\w+)}/g, (m, k) => data[k] ?? m);
const hooks = {};
const settings = new Map();
const notes = [];
class Collection extends Map { [Symbol.iterator]() { return this.values(); } }
globalThis.foundry = {
	utils: { getProperty, escapeHTML: s => s },
	applications: { handlebars: { loadTemplates: paths => { globalThis.loaded = paths; } } }
};
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, once: (name, fn) => { (hooks[name] ??= []).push(fn); } };
globalThis.ui = { notifications: { info: text => notes.push(text), warn: text => notes.push(`warn: ${text}`), error: text => notes.push(`error: ${text}`) } };
globalThis.game = {
	i18n: { localize, format },
	user: { isGM: true },
	users: { activeGM: { isSelf: true } },
	settings: { get: (m, key) => settings.get(`${m}.${key}`), set: async (m, key, value) => settings.set(`${m}.${key}`, value), register: (m, key, data) => { if (!settings.has(`${m}.${key}`)) { settings.set(`${m}.${key}`, data.default); } } },
	modules: new Map([["mist-age-toolkit", { active: true, api: { getItemLoad: item => (item.system.quantity ?? 1) * (item.slots ?? 1) } }]])
};

const layout = await import(`${F}/layout.js`);

// Items: equipped armor and a crossbow, a worn backpack (container) holding bolts, a rope and a pouch (container)
// with a ring; a loose rapier and potion; a bag lying in the pouch's loop with itself is at hand.
let nextSort = 0;
const updates = [];
const item = (id, name, type, extra = {}) => {
	const doc = { id, name, type, img: `${id}.webp`, sort: nextSort++, uuid: `Actor.a.Item.${id}`, flags: {}, effects: [], system: { quantity: 1, equipped: false, description: "" }, ...extra };
	doc.update = async changes => { updates.push([id, changes]); for (const [key, value] of Object.entries(changes)) { setProperty(doc, key, value); } };
	return doc;
};
const flags = (equipment = {}, weight = {}) => ({ "mist-age-equipment": equipment, "mist-age-weight": weight });
const armor = item("armor", "Brigandine", "armor", { system: { equipped: true, quantity: 1 } });
const crossbow = item("xbow", "Hand Crossbow", "weapon", { system: { equipped: true, quantity: 1 } });
const rapier = item("rapier", "Rapier", "weapon");
const backpack = item("pack", "Backpack (HB)", "loot", { flags: flags({ wearable: true, container: true }, { worn: true }) });
const bolts = item("bolts", "Crossbow Bolts", "consumable", { flags: flags({ inside: "pack" }), system: { quantity: 37 }, slots: 0.05 });
const rope = item("rope", "Rope", "loot", { flags: flags({ inside: "pack" }), slots: 2 });
const pouch = item("pouch", "Pouch", "loot", { flags: flags({ container: true, inside: "pack" }) });
const ring = item("ring", "Silver Ring", "loot", { flags: flags({ inside: "pouch" }), slots: 0 });
const potion = item("potion", "Health Potion", "consumable");
const loopA = item("loopA", "Bag A", "loot", { flags: flags({ container: true, inside: "loopB" }) });
const loopB = item("loopB", "Bag B", "loot", { flags: flags({ container: true, inside: "loopA" }) });
const ghost = item("ghost", "Lost Map", "loot", { flags: flags({ inside: "gone" }) });
const feature = item("feat", "Pack Tactics", "feature");
const items = [armor, crossbow, rapier, backpack, bolts, rope, pouch, ring, potion, loopA, loopB, ghost, feature];

const view = layout.buildLayout(items, { load: game.modules.get("mist-age-toolkit").api.getItemLoad });
assert.deepEqual(view.worn.map(entry => entry.id), ["xbow", "armor", "pack"], "worn: weapons, armor, then loot");
assert.deepEqual(view.loose.map(category => [category.type, category.items.map(entry => entry.id)]), [["weapon", ["rapier"]], ["consumable", ["potion"]], ["loot", ["loopA", "loopB", "ghost"]]], "a loop of containers and a missing container leave items at hand");
assert.equal(view.looseCount, 5);
assert.deepEqual(view.containers.map(section => section.id), ["pack", "loopA", "loopB"]);
const pack = view.containers[0];
assert.deepEqual([pack.worn, pack.count, pack.categories.map(category => [category.type, category.icon, category.items.length])], [true, 3, [["consumable", "fa-solid fa-flask", 1], ["loot", "fa-solid fa-gem", 2]]]);
assert.deepEqual(pack.containers.map(section => [section.id, section.count, section.load]), [["pouch", 1, 0]]);
assert.equal(pack.load, 4.85, "37 × 0.05 bolts + 2 rope + 1 pouch + 0 ring");
assert.equal(layout.canHold(items, pouch, backpack), false, "the backpack cannot go into the pouch inside it");
assert.equal(layout.canHold(items, backpack, pouch), true);
assert.equal(layout.canHold(items, pouch, pouch), false);
assert.equal(layout.canHold(items, pouch, rapier), true);
assert.equal(layout.canHold(items, rope, rapier), false, "not a container");

// The templates, with the real Handlebars and a stub of the Daggerheart row.
const T = path => readFileSync(`${Q}/templates/${path}`, "utf8");
Handlebars.registerHelper("localize", (key, options) => (options?.hash && Object.keys(options.hash).length ? format(key, options.hash) : localize(key)));
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("and", (...args) => args.slice(0, -1).every(Boolean));
Handlebars.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
Handlebars.registerHelper("ifThen", (cond, a, b) => (cond ? a : b));
Handlebars.registerHelper("concat", (...args) => args.slice(0, -1).join(""));
Handlebars.registerPartial("daggerheart.inventory-item", `<li class="inventory-item" data-item-id="{{item.id}}" data-type="{{type}}" data-quantifiable="{{isQuantifiable}}" data-actions="{{showActions}}" data-actor-type="{{actorType}}">{{item.name}}</li>`);
Handlebars.registerPartial("systems/daggerheart/templates/sheets/global/partials/gold.hbs", `<div class="gold-section">gold</div>`);
await import(`${F}/inventory.js`).then(module => module.registerInventory());
for (const [name, path] of Object.entries(globalThis.loaded)) {
	Handlebars.registerPartial(name, T(path.split("/").pop()));
}
const render = context => Handlebars.compile(T("inventory.hbs"))(context);
const context = { tabs: { inventory: { id: "inventory", cssClass: "active", group: "primary" } }, document: { type: "character" }, editable: true, inventory: { hasCurrency: true }, equipment: { ...view, canWear: true, searchable: true, createTypes: ["weapon", "armor", "consumable", "loot"] } };
const html = render(context);
const sectionOf = id => {
	const index = html.indexOf(`data-item-id="${id}"`);
	const before = html.slice(0, index);
	return [...before.matchAll(/data-mist-section="(\w+)"(?: data-container-id="(\w+)")?/g)].at(-1).slice(1, 3).filter(Boolean).join(":");
};
assert.ok(html.includes('class="search-inventory"') && html.includes("gold-section") && html.includes('class="items-section mist-equipment"'));
assert.deepEqual(["armor", "xbow", "pack", "rapier", "potion", "bolts", "rope", "pouch", "ring", "loopA", "ghost"].map(sectionOf), ["worn", "worn", "worn", "loose", "loose", "container:pack", "container:pack", "container:pack", "container:pouch", "loose", "loose"]);
assert.ok(html.indexOf('data-container-id="pouch"') > html.indexOf('data-container-id="pack"') && html.indexOf('data-container-id="pouch"') < html.indexOf('data-container-id="loopA"'), "the pouch is drawn inside the backpack's section");
assert.ok(html.includes('data-item-id="bolts" data-type="consumable" data-quantifiable="true"') && html.includes('data-item-id="xbow" data-type="weapon" data-quantifiable="false"'));
assert.ok(html.includes('data-item-id="rope" data-type="loot" data-quantifiable="true" data-actions="true"'));
assert.ok(html.includes("4.85 slots") && /<i class="fa-solid fa-flask" inert><\/i>\s*<span class="label">TYPES.Item.consumable<\/span>\s*<span class="count">1<\/span>/.test(html));
assert.equal((html.match(/data-action="addNewItem"/g) ?? []).length, 4);
assert.equal((html.match(/Empty. Drag items here/g) ?? []).length, 2, "the two looped bags are empty");
assert.ok(!html.includes("Nothing worn") && !html.includes("Nothing at hand"));
const empty = render({ ...context, editable: false, document: { type: "adversary" }, inventory: {}, equipment: { worn: [], loose: [], looseCount: 0, containers: [], canWear: true, searchable: false, createTypes: [] } });
assert.ok(empty.includes("Nothing worn") && empty.includes("Nothing at hand") && !empty.includes("search-inventory") && !empty.includes("gold-section"));

// A party: no Worn section, the compendium browser, and the party's rows.
const partyView = layout.buildLayout(items, { wearing: false });
const partyHtml = render({ ...context, document: { type: "party" }, equipment: { ...partyView, canWear: false, searchable: true, storage: true, createTypes: ["loot"] } });
assert.ok(!partyHtml.includes('data-mist-section="worn"') && partyHtml.includes('data-action="tempBrowser"'));
assert.ok(partyHtml.includes('data-item-id="armor" data-type="armor" data-quantifiable="true"'), "a party counts everything");
assert.deepEqual(partyView.worn, []);
assert.ok(partyView.loose.some(category => category.items.some(entry => entry.id === "armor")), "equipped armor in a party is just stored");

// The sheets: the tab template, the layout in the inventory context, and drops.
const original = [];
class BaseSheet {
	async _preparePartContext(partId, context) { return context; }
	async _onDropItem(event, dropped) { original.push(dropped.id); if (dropped.created) { await dropped.create(); } return dropped; }
}
class CharacterSheet extends BaseSheet {}
CharacterSheet.PARTS = { inventory: { template: "systems/daggerheart/character/inventory.hbs", scrollable: [".items-section"] } };
class AdversarySheet extends BaseSheet {}
AdversarySheet.PARTS = { inventory: { template: "modules/mist-age-toolkit/templates/inventory-tab.hbs" } };
class EnvironmentSheet extends BaseSheet {}
EnvironmentSheet.PARTS = {};
game.system = { api: { applications: { sheets: { actors: { Character: CharacterSheet, Adversary: AdversarySheet, Environment: EnvironmentSheet } } } } };
for (const fn of hooks.setup) { fn(); }
assert.equal(CharacterSheet.PARTS.inventory.template, "modules/mist-age-equipment/templates/inventory.hbs");
assert.deepEqual(CharacterSheet.PARTS.inventory.scrollable, [".items-section"]);
assert.equal(AdversarySheet.PARTS.inventory.template, "modules/mist-age-equipment/templates/inventory.hbs");
const actor = { uuid: "Actor.a", type: "character", items: new Collection(items.map(entry => [entry.id, entry])) };
for (const entry of items) { entry.parent = actor; }
const sheet = Object.assign(new CharacterSheet(), { document: actor });
const partContext = await sheet._preparePartContext("inventory", { inventory: {} }, {});
assert.deepEqual([partContext.equipment.worn.length, partContext.equipment.searchable, partContext.equipment.containers[0].load], [3, true, 4.85]);
assert.equal((await sheet._preparePartContext("features", {}, {})).equipment, undefined);

const section = (kind, container) => ({ target: { closest: () => ({ dataset: { mistSection: kind, ...(container ? { containerId: container } : {}) } }) } });
updates.length = 0;
await sheet._onDropItem(section("container", "pouch"), rapier);
assert.deepEqual(updates.at(-1), ["rapier", { "flags.mist-age-equipment.inside": "pouch" }]);
await sheet._onDropItem(section("container", "pack"), crossbow);
assert.deepEqual(updates.at(-1), ["xbow", { "flags.mist-age-equipment.inside": "pack", "system.equipped": false }], "an equipped weapon is put away");
await sheet._onDropItem(section("loose"), rope);
assert.deepEqual(updates.at(-1), ["rope", { "flags.mist-age-equipment.inside": null }]);
await sheet._onDropItem(section("worn"), backpack);
assert.deepEqual(updates.at(-1), ["pack", { "flags.mist-age-weight.worn": true, "flags.mist-age-equipment.inside": null }]);
const count = updates.length;
await sheet._onDropItem(section("worn"), potion);
await sheet._onDropItem(section("container", "pouch"), backpack);
assert.equal(updates.length, count, "a potion cannot be worn; the backpack cannot go into its own pouch");
assert.ok(notes.at(-1).startsWith("warn: A container cannot"));
await sheet._onDropItem({ target: { closest: () => null } }, potion);
assert.equal(updates.length, count, "a drop outside the sections only sorts");
assert.equal(original.length, 7, "the sheet's own drop always runs");

// An item from elsewhere goes where it was dropped; one created any other way leaves its old container behind.
const created = [];
const incoming = (name, type, extra = {}) => {
	const doc = { id: name, name, type, parent: actor, flags: {}, system: { equipped: false }, ...extra };
	doc.updateSource = changes => { for (const [key, value] of Object.entries(changes)) { setProperty(doc, key, value); } };
	doc.created = true;
	doc.create = async () => { for (const fn of hooks.preCreateItem) { fn(doc); } created.push(doc); };
	return doc;
};
const tent = incoming("Tent", "loot");
await sheet._onDropItem(section("container", "pack"), { ...tent, parent: { uuid: "Actor.other" }, create: tent.create, created: true });
assert.equal(getProperty(tent, "flags.mist-age-equipment.inside"), "pack");
const cloak = incoming("Cloak", "loot", { flags: flags({ wearable: true }) });
await sheet._onDropItem(section("worn"), { ...cloak, parent: null, create: cloak.create, created: true });
assert.equal(getProperty(cloak, "flags.mist-age-weight.worn"), true);
const traded = incoming("Lantern", "loot", { flags: flags({ inside: "theirBag" }) });
await traded.create();
assert.equal(getProperty(traded, "flags.mist-age-equipment.inside"), null, "a container id from another actor is dropped");

// Wearing: the item settings, the wear button and capacity bonuses only while worn.
const wear = await import(`${F}/wear.js`);
wear.registerWear();
class DhActiveEffect { get isSuppressed() { return this.systemSuppressed === true; } }
globalThis.CONFIG = { ActiveEffect: { documentClass: DhActiveEffect } };
for (const fn of hooks.setup.slice(-1)) { fn(); }
const bonusEffect = parent => Object.assign(new DhActiveEffect(), { transfer: true, parent, system: { changes: [{ key: "flags.mist-age-weight.bonusSlots", value: 10 }] } });
for (const entry of items) { entry.documentName = "Item"; entry.actor = actor; }
backpack.flags["mist-age-weight"].worn = false;
assert.equal(bonusEffect(backpack).isSuppressed, true, "a backpack in hand adds nothing");
backpack.flags["mist-age-weight"].worn = true;
assert.equal(bonusEffect(backpack).isSuppressed, false);
assert.equal(bonusEffect(pouch).isSuppressed, false, "loot that is not wearable keeps its bonus");
const other = Object.assign(new DhActiveEffect(), { transfer: true, parent: rapier, systemSuppressed: true, system: { changes: [] } });
assert.equal(other.isSuppressed, true, "the system's own suppression still applies");

// A tiny DOM for the rows and the settings tab.
class Element {
	constructor(classes = "", dataset = {}) { this.className = classes; this.dataset = dataset; this.children = []; this.parent = null; this.listeners = {}; this.html = ""; this.attributes = {}; }
	get classes() { return this.className.split(/\s+/).filter(Boolean); }
	append(child) { child.parent = this; this.children.push(child); return child; }
	prepend(child) { child.parent = this; this.children.unshift(child); }
	after(child) { const list = this.parent.children; child.parent = this.parent; list.splice(list.indexOf(this) + 1, 0, child); }
	remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
	setAttribute(name, value) { this.attributes[name] = value; }
	addEventListener(type, fn) { this.listeners[type] = fn; }
	insertAdjacentHTML(position, html) { this.html += html; }
	set innerHTML(value) { this.html = value; }
	all() { return this.children.flatMap(child => [child, ...child.all()]); }
	matches(selector) { return selector.split(".").filter(Boolean).every(name => this.classes.includes(name)); }
	querySelectorAll(selector) {
		if (selector === "li.inventory-item[data-item-id]") { return this.all().filter(e => e.matches("inventory-item") && e.dataset.itemId); }
		if (selector === "section.tab[data-tab='settings'] fieldset") { return this.all().filter(e => e.matches("settings-fieldset")); }
		if (selector.startsWith(":scope > ")) { return this.children.filter(e => e.matches(selector.slice(9))); }
		const parts = selector.split(" ");
		return this.all().filter(e => e.matches(parts.at(-1)) && (parts.length === 1 || this.all().some(a => a.matches(parts[0]) && a.all().includes(e))));
	}
	querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
globalThis.document = { createElement: () => new Element() };
const row = id => {
	const li = new Element("inventory-item", { itemId: id });
	li.append(new Element("inventory-item-header")).append(new Element("controls"));
	return li;
};
const element = new Element();
for (const id of ["pack", "pouch", "rapier"]) { element.append(row(id)); }
actor.system = { metadata: { hasInventory: true } };
const renderSheet = (target, editable = true) => { for (const fn of hooks.renderActorSheetV2) { fn({ document: actor, isEditable: editable }, target); } };
renderSheet(element);
const buttons = element.all().filter(e => e.matches("mist-wear"));
assert.deepEqual(buttons.map(button => [button.parent.parent.parent.dataset.itemId, button.className, button.dataset.tooltip]), [["pack", "mist-wear", "Take off"]]);
await buttons[0].listeners.click({ preventDefault() {}, stopPropagation() {} });
assert.deepEqual(updates.at(-1), ["pack", { "flags.mist-age-weight.worn": false }]);
renderSheet(element);
assert.equal(element.all().filter(e => e.matches("mist-wear")).length, 1, "rendering again does not add a second button");
const readOnly = new Element();
readOnly.append(row("pack"));
renderSheet(readOnly, false);
assert.equal(readOnly.all().filter(e => e.matches("mist-wear")).length, 0);
const settingsTab = new Element();
const fieldset = settingsTab.append(new Element("settings-fieldset"));
for (const fn of hooks.renderItemSheetV2) { fn({ document: backpack, isEditable: true }, settingsTab); }
assert.ok(fieldset.html.includes('name="flags.mist-age-equipment.wearable" checked') && fieldset.html.includes('name="flags.mist-age-equipment.container" checked'));
const weaponSettings = new Element();
const weaponFieldset = weaponSettings.append(new Element("settings-fieldset"));
for (const fn of hooks.renderItemSheetV2) { fn({ document: rapier, isEditable: true }, weaponSettings); }
assert.equal(weaponFieldset.html, "", "only loot can be worn or hold things");

assert.deepEqual([...missing], [], "missing texts");
console.log("equipment test passed");
